# Geega scanner bridge

Watches a folder on a Windows PC for scans PaperStream IP saves from a Ricoh
fi-8170, and pushes them into a Geega scan session over the same staff-gated
API the browser admin app uses — real Supabase Storage uploads, real
`card_scans` rows, real recognition, never fake data.

## Why a watched folder instead of talking to the scanner SDK directly

Ricoh's Scanner Control / TWAIN SDK for the fi-8170 requires a separate
developer registration/approval process to obtain. That could not be
completed in this environment, so this bridge uses **Option B**: PaperStream
IP (the software Ricoh ships with the fi-8170) already knows how to drive
the scanner at exactly the settings Part 4 requires and save the output to a
folder — this bridge's job is just to notice new files there and get them
into Geega. If you later obtain SDK access, a direct-SDK bridge could hook
into the scan event instead of a filesystem watch; everything from
`uploader.ts` onward would be unchanged.

## What this is (and isn't)

- It is real, working, buildable TypeScript. `npm install && npm run
  typecheck` and `npm test` (the pairing-logic unit tests in
  `src/pairing.test.ts`) both run and pass in this environment.
- It has **not** been run against a physical fi-8170, a real PaperStream IP
  install, or Windows, because none of those are available here. Validate it
  against your actual scanner and folder before relying on it for real
  inventory.

## 1. Configure the PaperStream IP scan profile

Create a new scan profile in PaperStream IP (e.g. named "Geega MTG Cards")
with these settings, per Part 4's condition-analysis-grade requirements:

| Setting | Value | Why |
|---|---|---|
| Image mode | 24-bit Color | Preserves foil/holo color and print detail condition analysis needs. |
| Resolution | 600 DPI | High enough to read collector numbers/set symbols and see edge wear. |
| Duplex | On (scan both sides), unless `SCAN_MODE=card_matching` | Front is required for ID; front + back for condition grading. |
| File format | TIFF, uncompressed (or LZW) | Lossless — JPEG's compression artifacts corrupt edge/corner analysis. |
| Image processing | Off (no auto-crop/auto-color/auto-rotate "enhancement") | The pipeline does its own deskew/crop from a consistent, unprocessed source; destructive scanner-side processing works against it. |
| Orientation | Fixed, consistent per batch | The pipeline expects a consistent orientation; don't mix portrait/landscape within one run. |
| Output | Save to folder | Point this at the folder you'll set as `WATCH_FOLDER` below. |
| File naming | A fixed prefix + sequential number, e.g. `card_00001.tif` | This bridge pairs files by sequence number — see "How pairing works" below. |

Feed a stack of cards through the ADF in one run per batch. PaperStream
writes one file per physical page, in feed order.

## 2. How pairing works

With duplex scanning, PaperStream writes pages in strict feed order: front
of card 1, back of card 1, front of card 2, back of card 2, and so on. This
bridge sorts the files it sees by the trailing number in their filename
(`card_00001.tif`, `card_00002.tif`, ...) and pairs them two at a time in
that order. Whether it expects pairs at all follows directly from
`SCAN_MODE` — there's no separate duplex setting: `card_matching` treats
every file as its own front-only card (identification only needs a front),
while `condition` and `both` expect front+back pairs (condition grading
needs to see the back). Scan your ADF in duplex or single-sided accordingly.

If your batch ever loses strict alternation (a jam, a re-feed out of order),
don't resume mid-batch — clear the watch folder and re-scan that batch from
the start, or the pairing will be wrong. The review UI will still show you
exactly what got paired with what before you approve anything, so a mistake
here is inspectable, never silently committed to inventory.

## 3. Install and configure

Requires [Node.js](https://nodejs.org/) 20 or later on the Windows PC.

```powershell
cd scanner-bridge
npm install
copy .env.example .env
notepad .env
```

If `npm install` fails with an arborist/peer-dependency error, run `npm
install --legacy-peer-deps` instead — a known npm bug in resolving one dev
dependency's peer set, unrelated to this project's own dependencies.

Fill in every value in `.env` — see the comments in `.env.example` for what
each one means. You'll need:

- Your deployed Geega app's URL.
- Your Supabase project's URL and anon/publishable key (Project Settings →
  API in the Supabase dashboard — safe to use here, it's the same key the
  browser app ships with).
- A dedicated staff account for this bridge (create one on the Users page
  of the admin app, or directly in Supabase Auth, with the staff role) —
  don't reuse a human's personal login.
- The folder path PaperStream IP saves scans into.

## 4. Run it

```powershell
npm run build
npm start
```

For development/iteration without a build step: `npm run dev`.

Leave it running while you scan. Console output shows each state
transition (watching → uploading → done, or an error with a plain-English
reason) — never a silent failure. A local status snapshot is always
available at `http://127.0.0.1:8787/status` (or whatever `STATUS_PORT` you
set) for troubleshooting; it is bound to `127.0.0.1` only and never reachable
from the network.

The admin dashboard's Scan Sessions page shows this same status live (state,
pending files, counts, last error) and lets you end the current session
without leaving the browser — see "Resuming after a restart" below. The
first time it connects, Chrome may show a one-time "use devices on your
local network?" permission prompt for the dashboard's site — that's Chrome's
Local Network Access protection (a public site reaching a loopback address),
not a Geega prompt; click Allow, or the panel will just show "not
connected" indefinitely.

### Running it continuously (as a background service)

The simplest option is a scheduled task that starts it at logon:

1. Task Scheduler → Create Task.
2. Trigger: "At log on."
3. Action: "Start a program" → Program: `node`, Arguments:
   `dist/index.js`, "Start in": the full path to this `scanner-bridge`
   folder.
4. Under Settings, check "If the task fails, restart every" (e.g. 1 minute)
   so a transient crash recovers on its own.

For a true Windows Service (survives without any user logged in), use
[NSSM](https://nssm.cc/) to wrap `node dist/index.js` — outside this
repo's scope to script here since it depends on where you install NSSM, but
it's a standard, well-documented tool for exactly this.

## 5. What happens to the physical files

- Successfully uploaded and ingested files move to `_processed/` inside the
  watch folder (or wherever `PROCESSED_FOLDER` points).
- Files whose upload failed after retries move to `_failed/` for manual
  attention — check the console log for the reason.
- If an entire batch fails (e.g. the API was briefly unreachable), files are
  left in place and retried automatically on the next quiet period — no
  manual intervention needed for a transient error.

Recognition happens automatically per card after ingest, same as a browser
upload (Part 15) — there's nothing more to click. Review the results in the
admin app's Scan Review page, same as any other session.

## 6. Resuming after a restart

The bridge remembers the current session id in a hidden file
(`.geega-session-id`) inside the watch folder, so stopping and restarting it
continues the same session instead of starting a new one each time. Click
"End session" on the admin dashboard's Scan Sessions page if you
deliberately want the next batch to start a fresh session — or delete that
file by hand if you'd rather not leave the bridge running to do it.

## 7. Scanning directly from the dashboard (no PaperStream)

The admin dashboard's Scan Sessions page has a "Scan now" button that
drives the fi-8170 directly — no PaperStream IP window, no manual profile
selection. Scanned pages land in `WATCH_FOLDER` exactly like a
PaperStream-written file would, so everything from pairing onward (sections
2 and 5 above) works completely unchanged.

This is driven by [NAPS2](https://www.naps2.com/download), a free,
actively-maintained third-party scanning utility, via its console mode
(`NAPS2.Console.exe`) — **install it separately on the scanning PC first**,
using the default install location if asked. The bridge just shells out to
it; nothing about your NAPS2 install needs to be configured through its own
GUI for this to work, though opening NAPS2 once after installing (and
closing it again) is a reasonable first step before ever trying "Scan now",
in case it has any one-time first-run setup of its own.

### Why NAPS2, and not scripting Windows' WIA driver directly

An earlier version of this feature scripted Windows' WIA (Image
Acquisition) layer directly, with no extra software required beyond
Windows itself. That was tested against the real fi-8170 and found to
fail: the driver's property read/write worked correctly, but every attempt
to actually transfer a scanned page — through every documented method,
every image format, and with item properties confirmed valid — failed
identically with `E_INVALIDARG` ("The parameter is incorrect."), including
with no format argument supplied at all. That uniformity, plus the
device's own status flags confirming paper was loaded throughout testing,
pointed at this specific driver's WIA support simply not implementing
Transfer, not at any particular setting being wrong. PaperStream IP
drives the same hardware successfully, almost certainly via TWAIN (the
backend Fujitsu/PFU's production scanner software is built around) rather
than WIA — so this now uses NAPS2, which supports TWAIN directly, instead
of continuing to fight a layer with no working transfer path on this
device. `SCANNER_DRIVER` in `.env` defaults to `twain` for this reason;
`wia` is available to try instead if you ever want to (NAPS2's own WIA
support goes through a different, lower-level API than the one that
failed here, so it isn't necessarily affected by the same bug) — see
`.env.example`.

**The NAPS2 command line itself has not yet been verified against the
real fi-8170** — its options are confirmed from NAPS2's own source code,
but no Windows PC or physical scanner was available while wiring this up.
Everything downstream of "a TIFF lands in the watch folder" (pairing,
upload, recognition) has its own real, passing tests; only NAPS2's actual
conversation with the scanner hardware is untested. **Keep PaperStream IP
installed and working as a fallback** — don't rely on this exclusively
until you've validated it end-to-end.

### Validating it on your machine, in order

1. **Check scanner connection** (the button next to "Scan now"). This
   asks NAPS2 to list devices through the configured driver (`twain` by
   default) — it never touches the feeder, so there's no risk in trying
   it. If it doesn't find the fi-8170: confirm the device shows up under
   NAPS2's own device picker (open NAPS2's normal window → "Select
   Source") first — if it's not there either, this is a driver/NAPS2
   install issue, not a Geega one. If it IS there but under a different
   name than expected, set `SCANNER_DEVICE_NAME_MATCH` in `.env` to match.
   If TWAIN finds nothing at all, try `SCANNER_DRIVER=wia` as a fallback
   before assuming the device itself is the problem.
2. **One small real scan.** Load a handful of cards you don't mind
   re-scanning if something's off (not your most valuable ones, the first
   time) and click "Scan now". Watch the bridge's console output — with
   `-v`/verbose on, NAPS2 reports its own progress there, and any failure
   message comes straight from NAPS2 rather than being invented by the
   bridge.
3. **Check the result in Scan Review**, same as any session, but look
   specifically at whether the card sits well-cropped and upright in the
   image, the way a PaperStream-scanned card does. Not every driver/backend
   includes the same auto-crop/deskew PaperStream IP provides — if cards
   come through noticeably rougher (skewed, a visible scan-bed border,
   wrong orientation), recognition accuracy will suffer even though nothing
   "failed": say so, with a sample image if you can, since fixing that is a
   separate, real piece of work (real crop/deskew logic in the recognition
   pipeline), not a one-line tweak.
4. **A full-size batch** only once 2 and 3 look right — front/back pairing
   depends on pages arriving at a steady enough pace (see `WatcherControl`
   in `watcher.ts`, which deliberately holds off auto-processing for the
   whole scan's duration specifically so pacing can't split a batch's
   pairs), which hasn't been exercised at real ADF-batch scale either.

If a scan fails partway through (a jam, the feeder running dry
unexpectedly), whatever pages it DID save before failing are still picked
up normally — nothing scanned successfully is discarded just because the
run as a whole errored.

## Limitations

- **Batches over ~200 cards**: uploads and database inserts happen in
  chunks internally. If one batch's upload step fails partway through
  (e.g. the network drops between chunks) after an earlier chunk already
  created some `card_scans` rows, the whole batch is retried from scratch,
  which can create a few duplicate review-queue rows for the cards that
  already succeeded. Nothing reaches real inventory until a human approves
  a row in Scan Review, so this is a "reject the duplicate row" cleanup,
  never silently duplicated stock. Keep individual scanning runs under
  ~200 cards to avoid this case entirely.
- **Strict page-order pairing**: a jam or an out-of-order re-feed mid-batch
  will pair the wrong front with the wrong back. Re-scan the affected batch
  from a clean watch folder rather than resuming mid-stream — see "How
  pairing works" above.
- **Not yet run against real hardware**: this has been typechecked, unit
  tested (the pure pairing logic), and built successfully, but not
  exercised against an actual fi-8170, PaperStream IP install, or Windows,
  none of which are available in the environment this was built in.
