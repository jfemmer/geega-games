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
