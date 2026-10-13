import "dotenv/config";
import { loadConfig } from "../config.js";
import { createAuthedClient } from "../auth.js";
import { RecognizerRuntime } from "../recognizer/runtime.js";

// `npm run build-index` — builds (first time) or updates the card library on
// this PC, then runs the self-test. Safe to stop with Ctrl+C at any point:
// finished fingerprints are kept and the next run continues from there.
// Normally unnecessary — the bridge does this by itself in the background —
// but handy for the first, overnight build, or to see progress in a window.

async function main() {
  const config = loadConfig();
  const { supabase } = await createAuthedClient(config);
  console.log(`Signed in as ${config.staffEmail}. Card library folder: ${config.recognizer.dataDir}`);
  const runtime = new RecognizerRuntime({
    config: { ...config.recognizer, enabled: true, autoUpdate: true },
    supabase,
    isBusy: () => false,
    log: (m) => console.log(m),
  });

  let lastLine = "";
  const timer = setInterval(() => {
    const s = runtime.status;
    let line = s.message;
    if (s.modelDownload) {
      const mb = (n: number) => (n / 1048576).toFixed(0);
      line = `Downloading the model: ${mb(s.modelDownload.receivedBytes)} of ${s.modelDownload.totalBytes ? mb(s.modelDownload.totalBytes) : "?"} MB`;
    } else if (s.build) {
      const b = s.build;
      const elapsed = (Date.now() - Date.parse(b.startedAt)) / 1000;
      const rate = elapsed > 0 ? b.done / elapsed : 0;
      const left = rate > 0 ? Math.round((b.total - b.done) / rate / 60) : null;
      line =
        b.phase === "fingerprinting"
          ? `Fingerprinting: ${b.done.toLocaleString("en-US")} / ${b.total.toLocaleString("en-US")}` +
            (b.failed ? ` (${b.failed} couldn't be downloaded)` : "") +
            (left !== null ? ` — about ${left} min left` : "")
          : b.phase === "reading_card_list"
            ? `Reading the card list: ${b.done.toLocaleString("en-US")} printings`
            : "Saving…";
    } else if (s.selfTestRunning) {
      line = "Running the self-test…";
    }
    if (line !== lastLine) {
      console.log(line);
      lastLine = line;
    }
  }, 2000);

  await runtime.start();
  // start() kicks off a build only when there's no library yet; an explicit
  // run always checks for new cards too.
  runtime.requestUpdate();
  await runtime.waitForBuild();
  clearInterval(timer);

  if (runtime.status.state !== "ready") {
    console.error(runtime.status.message);
    process.exit(1);
  }
  const report = runtime.status.selfTest;
  console.log(runtime.status.message);
  if (report) {
    console.log(
      `Self-test on ${report.samples} cards: ${(report.exactPrinting * 100).toFixed(1)}% exact printing, ` +
        `${(report.rightName * 100).toFixed(1)}% right card; "sure" ${report.sureCorrect}/${report.sure} correct; ` +
        `${report.check} to check, ${report.none} not found; ~${report.meanMs} ms per card.`,
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
