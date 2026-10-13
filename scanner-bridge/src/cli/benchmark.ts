import "dotenv/config";
import { loadConfig } from "../config.js";
import { createAuthedClient } from "../auth.js";
import { explainRecognizerLoadFailure } from "../recognizer/loadFailure.js";

/** The recognizer's code, or a plain-English reason it can't run on this PC. */
async function loadRuntime() {
  try {
    return (await import("../recognizer/runtime.js")).RecognizerRuntime;
  } catch (err) {
    const why = explainRecognizerLoadFailure(err);
    console.error(why.message.replace(/ Until then.*$/, ""));
    if (why.help) console.error(`${why.help.label}: ${why.help.url}`);
    console.error(`(${why.detail})`);
    process.exit(1);
  }
}

// `npm run benchmark [samples]` — runs the self-test against the card library
// already on this PC (see src/recognizer/selfTest.ts) and prints the misses.
// Doesn't build or update anything.

async function main() {
  const samples = Number.parseInt(process.argv[2] ?? "", 10);
  const config = loadConfig();
  const { supabase } = await createAuthedClient(config);
  const RecognizerRuntime = await loadRuntime();
  const runtime = new RecognizerRuntime({
    config: { ...config.recognizer, enabled: true, autoUpdate: false },
    supabase,
    isBusy: () => false,
    log: (m) => console.log(m),
    retryFailedStart: false,
  });
  await runtime.start();
  if (runtime.status.state !== "ready") {
    console.error(runtime.status.message);
    process.exit(1);
  }
  const n = Number.isFinite(samples) && samples > 0 ? samples : config.recognizer.selfTestSamples;
  console.log(`Self-testing on ${n} cards…`);
  const report = await runtime.selfTest(n);
  if (!report) {
    console.error("The self-test didn't run.");
    process.exit(1);
  }
  console.log(JSON.stringify({ ...report, misses: undefined }, null, 2));
  if (report.visualCorrectMedian !== null) {
    console.log(
      `Correct matches pixel-check at ${report.visualCorrectMedian} (median), ${report.visualCorrectP10} (lowest tenth); "sure" needs 0.55.`,
    );
  }
  for (const miss of report.misses) {
    console.log(`  expected ${miss.expectedLabel} → got ${miss.gotLabel ?? "nothing"} (${miss.decision})`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
