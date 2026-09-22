# ASCII ONLY in this file, deliberately, including comments: a real run
# against actual hardware hit a cascading "missing terminator" parse error
# traced to em-dashes in comments and a string literal. Windows PowerShell
# 5.1 (powershell.exe, not pwsh.exe) reads a .ps1 file with no UTF-8 BOM
# using the system's ANSI codepage, not UTF-8 - on a typical US Windows
# install that's Windows-1252, where the em-dash's UTF-8 bytes (E2 80 94)
# decode to "a[EUR]" followed by a literal right-curly-quote character,
# which corrupts the parser's quote-tracking from that point on. Keep this
# file plain ASCII (a plain hyphen instead of an em-dash, straight quotes
# only) rather than relying on BOM handling being right on every machine
# this ever runs on.
<#
.SYNOPSIS
  Drives a WIA-registered scanner (the Ricoh fi-8170's own driver package
  includes a WIA driver alongside PaperStream IP/TWAIN/ISIS) directly, with
  no PaperStream IP window involved - Phase 2 of the admin dashboard's
  "scan without PaperStream" flow. Saves sequential TIFFs into -OutputFolder,
  which should be the SAME folder scanner-bridge already watches: once a
  page lands there, the existing chokidar watcher/pairing/upload/recognition
  pipeline (watcher.ts) picks it up completely unchanged, exactly as if
  PaperStream IP had written it.

.NOTES
  UNTESTED AGAINST REAL HARDWARE. Written from Microsoft's WIA driver docs
  and the long-documented, stable WIA scripting property IDs (unchanged
  since Windows Vista), not verified against an actual fi-8170 - this
  environment has no Windows machine or physical scanner to run it against.
  Run with -ListDevicesOnly FIRST (see README) before ever attempting a
  real batch scan: that alone confirms WIA can see the device at all,
  with no risk to a real card.

  Known assumptions, spelled out here so a real failure is easy to place:
   - The fi-8170 is feeder-only (no flatbed), so WIA_DPS_DOCUMENT_HANDLING_
     SELECT (device property 3088) is assumed to be the only source-select
     needed - no separate "pick the feeder item" step.
   - Document Handling Select flag values (FEEDER=1, DUPLEX=4) and Pages
     (property 3096, 0 = "until the feeder is empty") come from Microsoft's
     WIA driver documentation (wia-dps-document-handling-select,
     wia-dps-pages) - these are device-level properties.
   - Horizontal/Vertical Resolution (6147/6148) and Current Intent (6146,
     0x1 = color) are item-level properties, set once before the transfer
     loop, from the long-standing WIA Automation Layer (wiaaut.dll)
     scripting reference used across VBScript/PowerShell/VBA WIA examples.
   - "Feeder is empty" is detected by pattern-matching the exception text
     from a failed Transfer() (WIA_ERROR_PAPER_EMPTY, HRESULT 0x80210003)
     rather than trusting a single exact numeric match, since how
     PowerShell's COM interop surfaces that HRESULT wasn't verifiable here
     - deliberately hedged with a string match as a second signal so a
     close-but-not-exact match still ends the batch cleanly instead of
     surfacing as a scary uncaught error after the last real card.

  Every property set is wrapped in Set-WiaProperty, which tries the
  property's friendly NAME first (self-documenting, and the automation
  layer's preferred addressing mode) and falls back to its numeric ID -
  and reports which one worked, or that neither did, rather than failing
  silently. If a run doesn't behave as expected, that per-property log
  line is the first thing to check.

.PARAMETER OutputFolder
  Where to save scanned pages. Pass the bridge's WATCH_FOLDER.

.PARAMETER FilePrefix
  Base name for saved files - becomes "<prefix>_00001.tif", "<prefix>_00002.tif", etc.
  Pass something unique per run (the Node caller uses a timestamp) so a WIA
  batch's files can never collide with leftover PaperStream-written files
  sitting in the same folder.

.PARAMETER DeviceNameMatch
  Case-insensitive substring to find the right WIA device by name, in case
  more than one scanner is ever registered on this PC. Defaults to "8170".

.PARAMETER Duplex
  Scan both sides of each card. Omit for a front-only (card_matching mode) batch.

.PARAMETER Resolution
  DPI for both axes. Defaults to 600, matching the PaperStream IP profile
  Part 4 requires for condition-analysis-grade scans.

.PARAMETER ListDevicesOnly
  Enumerate visible WIA devices and exit - no scan attempted, nothing
  touches the feeder. Run this first, always.

.PARAMETER Diagnose
  Connects to the matched device and the feeder item, sets the same
  resolution/Current Intent the normal scan path sets (so the item is in
  the same state a real scan would leave it in, not driver defaults),
  prints every device- and item-level property this driver actually
  reports (name, id, current value, and valid range/list where the
  driver exposes one), then tries Transfer() several different ways (no
  format argument at all, then each known WIA format GUID in turn, then
  CommonDialog.ShowTransfer as a fallback transfer method) and reports
  which ones succeed or fail. Never saves an image either way - purely
  diagnostic, safe to run repeatedly. Use this when a plain scan attempt
  fails with an unhelpful generic error (e.g. "The parameter is
  incorrect.") and the reason isn't obvious from that message alone.
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$OutputFolder,

    [string]$FilePrefix = "wia_scan",

    [string]$DeviceNameMatch = "8170",

    [switch]$Duplex,

    [int]$Resolution = 600,

    [switch]$ListDevicesOnly,

    [switch]$Diagnose
)

$ErrorActionPreference = "Stop"

function Write-Result {
    param([string]$Status, [string]$Message)
    # Single machine-parseable line the Node caller looks for, always last.
    Write-Host "RESULT:${Status}:${Message}"
}

function Set-WiaProperty {
    param($Target, [string]$Name, [int]$Id, $Value)
    try {
        $Target.Properties.Item($Name).Value = $Value
        Write-Host "SET:$Name=$Value (by name)"
        return $true
    }
    catch {
        try {
            $Target.Properties.Item($Id).Value = $Value
            Write-Host "SET:$Name=$Value (by id $Id)"
            return $true
        }
        catch {
            Write-Host "WARN:could not set '$Name' (id $Id) to $Value : $($_.Exception.Message)"
            return $false
        }
    }
}

# -Diagnose only: prints what this driver actually reports for every
# property on $device or $item, including its valid range/list where the
# driver exposes one (SubType: 1=Range, 2=List, 3=Flag - see Microsoft's
# WIA Automation Layer Property object reference). This is ground truth
# from the real device, not an assumption about what a "normal" WIA
# scanner supports.
function Show-WiaProperties {
    param($Target, [string]$Label)
    Write-Host "PROPS:$Label"
    foreach ($p in $Target.Properties) {
        try {
            $name = $p.Name
            $id = $p.PropertyID
            $value = try { $p.Value } catch { "(unreadable)" }
            $extra = ""
            $subType = try { $p.SubType } catch { -1 }
            if ($subType -eq 1) {
                $extra = "range $($p.SubTypeMin)-$($p.SubTypeMax) step $($p.SubTypeStep)"
            }
            elseif ($subType -eq 2 -or $subType -eq 3) {
                $vals = @()
                for ($i = 1; $i -le $p.SubTypeValues.Count; $i++) {
                    $vals += $p.SubTypeValues.Item($i)
                }
                $extra = "values: $($vals -join ', ')"
            }
            Write-Host "  PROP:$name (id=$id) = $value  $extra"
        }
        catch {
            Write-Host "  PROP:(could not read one property: $($_.Exception.Message))"
        }
    }
}

if (-not (Test-Path $OutputFolder)) {
    Write-Result -Status "ERROR" -Message "OutputFolder does not exist: $OutputFolder"
    exit 1
}

try {
    $deviceManager = New-Object -ComObject WIA.DeviceManager
}
catch {
    Write-Result -Status "ERROR" -Message "Could not create the WIA.DeviceManager COM object: $($_.Exception.Message). Confirm the 'Windows Image Acquisition (WIA)' service is running (services.msc) and the scanner's driver package is installed."
    exit 1
}

$deviceNames = New-Object System.Collections.Generic.List[string]
$matchedInfo = $null
foreach ($info in $deviceManager.DeviceInfos) {
    $name = $info.Properties.Item("Name").Value
    $deviceNames.Add($name)
    if (-not $matchedInfo -and $name -like "*$DeviceNameMatch*") {
        $matchedInfo = $info
    }
}

if ($ListDevicesOnly) {
    if ($deviceNames.Count -eq 0) {
        Write-Host "DEVICES:none found"
    }
    else {
        foreach ($n in $deviceNames) { Write-Host "DEVICE:$n" }
    }
    Write-Result -Status "OK" -Message "listed $($deviceNames.Count) device(s)"
    exit 0
}

if ($null -eq $matchedInfo) {
    $seen = if ($deviceNames.Count -gt 0) { $deviceNames -join ", " } else { "(none)" }
    Write-Result -Status "ERROR" -Message "No WIA device found matching '*$DeviceNameMatch*'. Devices seen: $seen"
    exit 1
}

try {
    $device = $matchedInfo.Connect()
}
catch {
    Write-Result -Status "ERROR" -Message "Found a matching device but could not connect to it: $($_.Exception.Message)"
    exit 1
}

# --- Device-level: feeder + duplex mode, and "scan every page in the feeder" ---
$WIA_FEEDER = 0x1
$WIA_DUPLEX = 0x4
$handlingValue = $WIA_FEEDER
if ($Duplex) { $handlingValue = $handlingValue -bor $WIA_DUPLEX }

$handlingOk = Set-WiaProperty -Target $device -Name "Document Handling Select" -Id 3088 -Value $handlingValue
if (-not $handlingOk) {
    Write-Result -Status "ERROR" -Message "Could not set feeder/duplex mode on this device - it may not support ADF control via WIA. Try scanning via PaperStream IP instead."
    exit 1
}
Set-WiaProperty -Target $device -Name "Pages" -Id 3096 -Value 0 | Out-Null   # 0 = every page until the feeder is empty

try {
    $item = $device.Items.Item(1)
}
catch {
    Write-Result -Status "ERROR" -Message "Could not get the device's scan item: $($_.Exception.Message)"
    exit 1
}

# --- Item-level: resolution + color, applied once - persists across every Transfer() below. ---
# Set BEFORE branching into -Diagnose too, not just the normal scan path: real hardware showed
# every Transfer()/ShowTransfer() variant fail identically with E_INVALIDARG ("The parameter is
# incorrect.", HResult 0x80070057) - including bare Transfer() with NO format argument at all,
# which rules out the format argument itself as the cause. Meanwhile this driver's own reported
# valid values for Current Intent are 1, 2, 4, 65536, 131072, 262144 - NOT including its actual
# default of 0. A failure that doesn't change based on which (or whether any) format is passed
# points at the item's own property state being rejected before the format is ever considered.
# Diagnose mode never exercised this until now, since it used to branch off before this ran.
Set-WiaProperty -Target $item -Name "Horizontal Resolution" -Id 6147 -Value $Resolution | Out-Null
Set-WiaProperty -Target $item -Name "Vertical Resolution" -Id 6148 -Value $Resolution | Out-Null
Set-WiaProperty -Target $item -Name "Current Intent" -Id 6146 -Value 0x1 | Out-Null   # 1 = color

if ($Diagnose) {
    Show-WiaProperties -Target $device -Label "device"
    Show-WiaProperties -Target $item -Label "item"

    Write-Host "TRY:bare Transfer() with no format argument"
    try {
        $img = $item.Transfer()
        Write-Host "TRY-OK:bare Transfer()"
    }
    catch {
        Write-Host "TRY-FAIL:bare Transfer(): $($_.Exception.Message) [HResult=$($_.Exception.HResult)] [$($_.Exception.GetType().FullName)]"
    }

    $formatsToTry = [ordered]@{
        "BMP"  = "{B96B3CAB-0728-11D3-9D7B-0000F81EF32E}"
        "PNG"  = "{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}"
        "GIF"  = "{B96B3CB0-0728-11D3-9D7B-0000F81EF32E}"
        "JPEG" = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}"
        "TIFF" = "{B96B3CB1-0728-11D3-9D7B-0000F81EF32E}"
    }
    foreach ($fmtName in $formatsToTry.Keys) {
        try {
            $img = $item.Transfer($formatsToTry[$fmtName])
            Write-Host "TRY-OK:Transfer($fmtName)"
        }
        catch {
            Write-Host "TRY-FAIL:Transfer($fmtName): $($_.Exception.Message) [HResult=$($_.Exception.HResult)] [$($_.Exception.GetType().FullName)]"
        }
    }

    # Item.Transfer() failing uniformly across every format (including the
    # device's own reported "Preferred Format") on otherwise-valid-looking
    # properties matches a documented real-world pattern: some WIA drivers'
    # Item.Transfer automation method is unreliable even when the device
    # itself works fine, and CommonDialog.ShowTransfer (a different
    # wiaaut.dll code path, the same one behind the driver's own capture
    # UI) succeeds where it doesn't. ShowProgressBar=$false keeps this
    # headless - no dialog shown - it operates on the item we already
    # selected and configured, it does not prompt to pick a device/image.
    try {
        $dialog = New-Object -ComObject WIA.CommonDialog
        Write-Host "TRY:CommonDialog.ShowTransfer(item, BMP, ShowProgressBar=false)"
        try {
            $img = $dialog.ShowTransfer($item, $formatsToTry["BMP"], $false)
            Write-Host "TRY-OK:CommonDialog.ShowTransfer(BMP)"
        }
        catch {
            Write-Host "TRY-FAIL:CommonDialog.ShowTransfer(BMP): $($_.Exception.Message) [HResult=$($_.Exception.HResult)] [$($_.Exception.GetType().FullName)]"
        }
        Write-Host "TRY:CommonDialog.ShowTransfer(item, no format, ShowProgressBar=false)"
        try {
            $img = $dialog.ShowTransfer($item, $null, $false)
            Write-Host "TRY-OK:CommonDialog.ShowTransfer(no format)"
        }
        catch {
            Write-Host "TRY-FAIL:CommonDialog.ShowTransfer(no format): $($_.Exception.Message) [HResult=$($_.Exception.HResult)] [$($_.Exception.GetType().FullName)]"
        }
    }
    catch {
        Write-Host "TRY-FAIL:could not create WIA.CommonDialog at all: $($_.Exception.Message)"
    }

    Write-Result -Status "OK" -Message "diagnostics complete - see PROPS/TRY-OK/TRY-FAIL lines above"
    exit 0
}

# {B96B3CAE-...} is wiaFormatJPEG, not TIFF - real hardware caught this:
# Transfer() rejected it outright with "The parameter is incorrect." The
# correct wiaFormatTIFF GUID, verified against Microsoft's own FormatID
# constants reference, is {B96B3CB1-...}.
$wiaFormatTIFF = "{B96B3CB1-0728-11D3-9D7B-0000F81EF32E}"
$savedCount = 0

while ($true) {
    try {
        $image = $item.Transfer($wiaFormatTIFF)
    }
    catch {
        $msg = $_.Exception.Message
        $hr = $_.Exception.HResult
        # 0x80210003 (WIA_ERROR_PAPER_EMPTY) as a signed 32-bit int is
        # -2145320957 - verified by direct computation, not hand arithmetic,
        # after an earlier version of this file had that wrong too.
        $feederEmpty = ($hr -eq -2145320957) -or ($msg -match "(?i)paper|empty|no.*document|feeder")
        if ($feederEmpty) {
            Write-Host "INFO:feeder empty after $savedCount page(s) - this ends the batch normally: $msg"
            break
        }
        Write-Result -Status "ERROR" -Message "Scan failed after $savedCount page(s) saved: $msg"
        exit 1
    }

    $savedCount += 1
    $fileName = "{0}_{1:D5}.tif" -f $FilePrefix, $savedCount
    $fullPath = Join-Path $OutputFolder $fileName
    $image.SaveFile($fullPath)
    Write-Host "SAVED:$fileName"
}

if ($savedCount -eq 0) {
    Write-Result -Status "ERROR" -Message "No pages were scanned - was anything in the feeder?"
    exit 1
}

Write-Result -Status "OK" -Message "$savedCount page(s) scanned"
exit 0
