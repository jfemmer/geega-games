# Geega scanner bridge

Runs on the Windows PC next to the Ricoh fi-8170. It drives scans ("Scan
now" in the admin dashboard, through NAPS2) or watches the folder PaperStream
IP saves into, **identifies each card right here on the PC** (free — no paid
service, no per-scan cost), and pushes the scans into a Geega scan session
over the same staff-gated API the browser admin app uses — real Supabase
Storage uploads, real `card_scans` rows, never fake data.

The workflow it's built for: click **Scan now** → the cards appear in Scan
Review already matched → glance, fix the odd one → **Add to inventory**.
See [section 8](#8-card-recognition-on-this-pc) for how the recognition
works and how to set it up.

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
  typecheck` and `npm test` (pairing, upload, status server, and the card
  recognizer end to end on synthetic cards) all run and pass.
- It has **not** been run against a physical fi-8170, a real PaperStream IP
  install, or Windows, because none of those are available here. Validate it
  against your actual scanner and folder before relying on it for real
  inventory.

## 1. Configure the PaperStream IP scan profile

Only needed if you scan from PaperStream IP instead of the dashboard's
"Scan now" button. Create a scan profile (e.g. "Geega MTG Cards"):

| Setting | Value | Why |
|---|---|---|
| Image mode | 24-bit Color | Identification and foil/holo detail need colour. Use the sRGB colour profile for chrome/prism cards (Ricoh's own card advice). |
| Resolution | 300 DPI | The fi-8170's full speed (about 70 cards a minute, both sides) and all identification needs. Use 600 DPI only for condition-grading sessions. |
| Duplex | On (scan both sides), unless `SCAN_MODE=card_matching` | Both sides let the bridge find the card's face whichever way it went in, and read double-faced cards. |
| File format | JPEG (quality ~90) or TIFF | The bridge crops each card and re-saves it as a small JPEG before uploading, so the source format doesn't matter much. |
| Background | White (the default) | Black-bordered cards (almost all modern Magic) stand out cleanly against it. |
| Auto-crop / deskew | Either | The bridge finds and straightens the card itself; the driver's crop is fine too. |
| Hole punch removal, edge correction | Off | Ricoh: hole punch removal leaves "digital squares" on cards. |
| Continuous scan | On | So a big stack can go through in several loads. |
| Output | Save to folder | Point this at the folder you'll set as `WATCH_FOLDER` below. |
| File naming | A fixed prefix + sequential number, e.g. `card_00001.jpg` | This bridge pairs files by sequence number — see "How pairing works" below. |

Feed a stack of cards through the ADF in one run per batch. PaperStream
writes one file per physical page, in feed order.

**Feeding tips** (from Ricoh's and TCGplayer's card-scanning guidance):
batches of 40–50 cards; no sleeves, toploaders or card savers through the
feeder; keep high-value cards out of the feeder altogether (add those by
hand); put foils in their own batch and flip the **Foil** switch next to
"Scan now" first. Cards don't all need to face the same way — upside-down
and face-down cards are handled.

**Scan types.** Next to "Scan now" there's also a scan type switch:

| Type | What it does | How it scans |
| --- | --- | --- |
| **Inventory** (the default) | Identifies each card. No grading — set condition in review. | Fronts only, at `SCAN_DPI` (300). Feed cards face up. |
| **Condition** | Grades each card. No matching — use Find Match in review. | Both sides at 600 dpi. |
| **Inventory + condition** | Identifies and grades each card. | Both sides at 600 dpi. |

600 dpi is slower than 300, so grade only the batches that need it. Each
type goes into its own session ("Inventory Scan #N", "Condition Scan #N",
"Inventory + Condition Scan #N"), so a session never mixes types; "End
sessions" ends them all. Grades are suggestions to check in Scan Review,
never applied on their own. The switch goes back to Inventory when the
bridge restarts. Files PaperStream drops in the folder still follow
`SCAN_MODE`.

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

Requires 64-bit Windows 10/11, [Node.js](https://nodejs.org/) 22 or later (the LTS installer),
an internet connection, and about 2.5 GB of free disk space for the card
recognizer (see section 8). The card recognizer also needs Microsoft's free
[Visual C++ Redistributable (x64)](https://aka.ms/vs/17/release/vc_redist.x64.exe),
which most PCs already have. Without it, the bridge still scans and uploads,
and the dashboard's Scanner panel says the recognizer needs it and links to
the download.

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

**Updating** to a new version of the bridge: stop it, then from this folder
run `git pull`, `npm install`, `npm run build`, and start it again. All
three steps matter: a new version can add packages, and `npm install` is
what fetches them. Your `.env`, card library and image cache are kept.

"Stop it" includes the copy Task Scheduler starts at log-on (it has no
window): end its **Node.js** task in Task Manager. Otherwise that old copy
keeps running, and the new one refuses to start because the old one has its
port (it says so, naming both versions).

The dashboard's Scanner panel shows which version is running ("Bridge version
1.1.0, running since …") and tells you when it's out of date or an update is
only half done: **Finish updating** means the files were pulled but not
built (`npm install`, `npm run build`, restart); **Restart … to finish
updating** means they were built but the old version is still running. Every
recognized card also records the version that identified it.

The bridge reads `.env` from this folder, whichever folder it's started
from. If it ever stops on its own, the reason is also written to
`bridge-error.log` here, which is useful when Task Scheduler runs it without
a window. See section 9 if the dashboard says it's not connected.

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

Recognition happens automatically per card, same as a browser upload (Part
15) — there's nothing more to click. With the card library ready (section
8), each card is identified on this PC before upload and goes up as a
cropped, straightened JPEG of a few hundred KB (a 600 dpi scan goes up at
its full resolution, so condition grading keeps the detail); until then,
cards go up as the raw scan and the cloud recognizer reads them. Review the
results in the admin app's Scan Review page, same as any other session.

The raw scans in `_processed/` aren't needed after upload — delete old ones
whenever you like to free disk space.

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

Each scanned side is saved as a quality-95 JPEG named
`scan_<time>_0001.jpg`, `scan_<time>_0002.jpg`, … in feed order (NAPS2's
`$(nnnn)` numbering): `geega-inventory_<time>_0001.jpg`,
`geega-condition_<time>_0001.jpg` or `geega-condition-inventory_<time>_0001.jpg`
for the three scan types. The name is how the bridge keeps each type in its
own batch and session. Inventory scans use `SCAN_DPI` (300 by default);
the two that grade always scan both sides at 600. The fi-8170's driver trims each page to the card plus about 1 mm
of grey margin (with a dark shadow along the card's trailing edge) but
doesn't straighten it; the bridge finds the card's exact edges and
straightens it itself. JPEG rather than TIFF keeps each page small (a few
hundred KB) in case the driver's crop is ever turned off and pages come back
the whole feeder width (~16 MB per side as TIFF).

**The NAPS2 command line itself has not yet been verified against the
real fi-8170** — its options are confirmed from NAPS2's own documentation,
but no Windows PC or physical scanner was available while wiring this up.
Everything downstream of "an image lands in the watch folder" (pairing,
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
3. **Check the result in Scan Review**, same as any session. Once the
   card library is ready (section 8), the bridge finds, crops and
   straightens every card itself, so each card in Scan Review should sit
   upright and tightly cropped, with no grey margin or dark shadow band. If
   one doesn't, its warnings say why (two cards stuck together, card cut
   off, blank page).
4. **A full-size batch** only once 2 and 3 look right — front/back pairing
   depends on pages arriving at a steady enough pace (see `WatcherControl`
   in `watcher.ts`, which deliberately holds off auto-processing for the
   whole scan's duration specifically so pacing can't split a batch's
   pairs), which hasn't been exercised at real ADF-batch scale either.

If a scan fails partway through (a jam, the feeder running dry
unexpectedly), whatever pages it DID save before failing are still picked
up normally — nothing scanned successfully is discarded just because the
run as a whole errored.

## 8. Card recognition on this PC

### How it works

Instead of reading the card's text first (slow, and easily thrown off by a
crooked scan), the bridge identifies each card by its **picture**:

1. **Finds the card** in the scan, crops it and straightens it — any angle,
   upside down, face-down, white or black scanner background, with or
   without the driver's own crop.
2. **Fingerprints it** with DINOv2, a free, open-source image model from Meta
   (Apache-2.0), running on this PC's processor through ONNX Runtime.
3. **Searches a library of fingerprints of every paper Magic printing** —
   built on this PC from the shop's own Scryfall card list (the
   `scryfall_bulk_cards` table) and Scryfall's card images.
4. **Pixel-checks the closest printings** against their Scryfall images,
   including every reprint with the same art, and tells look-alikes apart by
   the spots where they differ: set symbol, collector-number corner, promo
   stamps, frame.
5. **Reads the collector number** with PaddleOCR's text reader (Apache-2.0)
   when two printings still look identical — and, on modern cards, to
   double-check every *sure* match: if the corner names a different set
   (a reprint from a set newer than the shop's card list), the card goes to
   *check* instead of being matched to the older printing.
6. **Decides**: *sure* (pre-matched for review), *check* (the top choices
   are shown as pictures; you pick), or *none* (use Find match). "Sure" is
   only given when every look-alike was ruled out.

**The List** (Scryfall set PLST) reprints cards down to the original's own
set symbol and collector line; only a small planeswalker symbol in the
bottom-left corner differs. A scan can't tell them apart, so The List's copy
is never picked over the original: the original (far more common) is listed
first and the card comes up as *check*, with that hint. The website applies
the same rule to results from older bridge versions.

Scans the fi-8170's driver trims close to the card are straightened from the
card's edges, even when the driver trims the leading margin away entirely
(the card is then centred in the image, which is accurate to a few pixels).
A card is only flagged "may be cut off" when its outline runs more than 1 %
of its length past the image's edge: a sheet feeder's scale along the feed
is only that exact, and that little border missing doesn't change which card
it is.

Each card takes about half a second on a typical desktop PC (about a second
on a slow two-core machine) — enough to keep up with the scanner's ~70 cards
a minute. Cards already in the session never wait for the rest of the
batch: they're processed and uploaded a dozen at a time.

### First run

**Before the first build**, check when the shop's Scryfall card list was
last refreshed (the Scanner panel shows it once the library exists; the
card list is what the library is built from). If new sets have come out
since, refresh it first from the main app folder: `npm run scryfall:refresh`
(needs the main app's `.env`; takes a few minutes).

Then there's nothing to do but leave the bridge running. On first start it:

1. downloads the fingerprint model (88 MB, once; checked against its
   published SHA-256 before use), then
2. builds the card library: downloads each paper printing's Scryfall image
   once (about 110,000 images, roughly 7–8 GB of download, not kept),
   fingerprints it, and keeps only the fingerprints (~70 MB). Expect a few
   hours — overnight is ideal. It pauses while you scan, and if the PC
   restarts it carries on where it stopped.
3. runs a **self-test**: fake scans made from Scryfall images (crooked,
   blurred, colour-shifted, some upside down, half of them trimmed the way
   the fi-8170's driver delivers its scans) through the full recognizer.
   The score shows in the dashboard's Scanner panel.

Until the library is ready, scans keep working — they just go to the old
cloud recognizer. The Scanner panel shows progress. If the model download or
the build fails (no internet for a while, say), it tries again by itself,
after 2 minutes at first and then hourly; **Try again** in the Scanner panel
retries straight away. If the recognizer can't run on this PC at all, the
panel shows **Needs setup** with what to install (section 9).

To watch progress in a window instead (or to build before starting the
bridge): `npm run build-index`. Ctrl+C is safe; run it again to continue.

### Keeping it current

- The library refreshes itself weekly (and on **Update card library** in
  the Scanner panel), fingerprinting only what changed.
- It can only contain cards that are in the shop's Scryfall card list. When a
  new set comes out, refresh that list from the main app
  (`npm run scryfall:refresh`, run where the main app's `.env` is), then
  click **Update card library**. The Scanner panel shows when the list was
  last refreshed.

### Settings (`.env`)

All optional — see `.env.example`. `RECOGNIZER=off` turns it off entirely
(every card then goes to the cloud recognizer). `DATA_DIR` moves the model,
library and image cache (default `%LOCALAPPDATA%\GeegaScannerBridge`).
`SCAN_DPI` sets the "Scan now" resolution. `REFERENCE_CACHE_MB` caps the
folder of Scryfall images kept for the pixel check (default 2 GB).

### Checking how well it's doing

- `npm run benchmark [samples]` re-runs the self-test and lists every miss.
- Real accuracy comes from real cards: every card you review records
  whether the first suggestion was right. After your first few hundred
  reviewed cards, the "sure" cut-off can be tuned from that.

### Approving a batch quickly

**Quick approve** in Scan Review shows every card of the session that isn't
in inventory yet as your scan next to the printing it matched. Sure matches
are ticked already; close calls and unsure matches show their best guess,
one tap to tick (tap the pictures to compare up close or pick another
printing). Choose the condition for cards nobody graded (remembered on that
device) and, optionally, a storage location, then **Add to inventory**:
everything ticked is approved at today's Scryfall price for its finish
(raised to your price floors) and added in one go. Cards that can't be (no
Scryfall price, say) are marked in red with what to do.

In the one-card review screen, **Enter** approves the card and moves on; on
a card with no match yet it approves suggestion **A** in the same step, with
the default condition shown above the list unless you set one (keys 1–5).

### Re-running a card

"Re-run" in Scan Review re-recognizes a card with this PC's current library
(the dashboard asks the bridge, which downloads the stored images, so it
works from the scanning PC's browser). Nothing is re-uploaded.

### What it can't do

- **Foil vs non-foil** isn't reliably visible in a scan — use the Foil
  switch per batch (printings that only exist in foil are set
  automatically).
- **Non-English cards** match the English printing with the same art; set
  the language in review.
- A few old printings are nearly identical (Alpha / Beta / Unlimited, for
  example). They come up as *check*, never *sure*.

## 9. Troubleshooting

The bridge's status server starts before anything else, so as long as the
bridge is running, the dashboard's Scanner panel (Scan Sessions page)
shows what's wrong. Work from what the panel says.

**"Not connected from this computer"**: the dashboard can't reach the bridge
on this PC.

1. Is it running? Start it (`npm start` in this folder) and wait for
   `Ready.` in its window. If it stops, the window and `bridge-error.log`
   in this folder say why. "The scanner bridge is already running on this
   PC" means another copy has it covered (another window, or Task
   Scheduler); use that one, or end it in Task Manager to restart.
2. Just updated? Run `npm install` and `npm run build` in this folder, then
   start it again.
3. Open `http://127.0.0.1:8787/status` in Chrome on this PC. If that shows
   text, the bridge is fine and the browser is the problem: see the next
   two entries (the panel usually names which one).

**"Update the scanner bridge on this PC"** (or **Finish updating** /
**Restart the scanner bridge to finish updating**): the PC is running an
older version than the website expects. Scanning keeps working, but card
recognition misses the latest fixes. Do what the panel says: usually stop
the bridge (including its Task Scheduler copy, as **Node.js** in Task
Manager), run `git pull`, `npm install` and `npm run build` in this folder,
and start it again.

**"Chrome is blocking the scanner bridge"**: this site was denied access to
apps on this PC, and Chrome won't ask again by itself. Click the icon at the
left end of the address bar, open **Site settings**, set **Apps on device**
(older Chrome: **Local network access**) to **Allow**, and reload.

**"Scanner bridge is set up for a different address"**: the bridge only
talks to the site address in `GEEGA_API_BASE_URL`. Set it to the address
you open the dashboard at (e.g. `https://geega-games.com`) in `.env` and
restart the bridge.

**Bridge badge "Error" with a sign-in message**: the bridge couldn't sign in
as its staff account. "Couldn't reach Supabase" means no internet yet (it
retries by itself); "Could not sign in" means the email or password in
`.env` is wrong, or the account isn't staff. Fix `.env` and restart.

**Card recognition "Needs setup"**: it can't run on this PC, and the
message says why. Scanning carries on meanwhile (the website identifies the
cards, as before). The usual reason is Windows missing the
[Visual C++ Redistributable (x64)](https://aka.ms/vs/17/release/vc_redist.x64.exe):
install it, then restart the bridge. Other reasons it names: run
`npm install` (a package is missing), or install a newer Node.js.

**Card recognition "Needs attention"**: the model download or the library
build failed; the message says why. It retries by itself; **Try again**
retries now.

**"Check scanner connection" doesn't list the fi-8170**: see "Validating it
on your machine" in section 7. The scanner must be switched on and
connected by USB, with its PaperStream IP (TWAIN) driver installed.

## Limitations

- **Interrupted batches**: cards go to the server a dozen at a time. If the
  connection drops partway through a batch, the cards already sent stay in
  the session and only the rest are retried (after 30 s), so an interruption
  never creates duplicate review rows. If a whole batch fails before
  anything is sent, it's retried from the start.
- **Strict page-order pairing**: a jam or an out-of-order re-feed mid-batch
  will pair the wrong front with the wrong back. Re-scan the affected batch
  from a clean watch folder rather than resuming mid-stream — see "How
  pairing works" above.
- **Not yet run against real hardware**: this has been typechecked, unit
  tested and built, and the recognizer tested end to end on synthetic
  cards — but not exercised against an actual fi-8170, PaperStream IP or
  NAPS2 install, Windows, or the real card library, none of which are
  available in the environment this was built in. The self-test on your PC
  and your first reviewed batches are the real check.
