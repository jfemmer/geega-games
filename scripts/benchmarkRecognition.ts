#!/usr/bin/env node
// Recognition benchmark harness (Part 11). Runs the REAL pipeline
// (api/_lib/recognition/pipeline.ts — the exact same code the live
// /api/admin/scans/:scanId/recognize endpoint calls, never a simulated or
// simplified copy of it) against a local set of known-answer fixtures, and
// reports the metrics Part 11 asks for: identity precision, auto-match
// rate, manual-review rate, per-field OCR accuracy, condition agreement,
// and error rate broken down by era and treatment.
//
// Fixtures are local-only and gitignored (benchmark/fixtures/) — see
// benchmark/README.md for how to build a real manifest. This script only
// ships a small documented example (manifest.example.json) since fixture
// images are real scan photos and Scryfall reference art, both of which
// must never be committed to the repo.
//
// Requires SUPABASE_URL and SUPABASE_SECRET_KEY (same service-role
// credentials refreshScryfallBulkIndex.ts uses) plus
// GOOGLE_CLOUD_VISION_API_KEY if you want OCR-dependent metrics to be
// meaningful rather than reporting the honest "OCR unavailable" result.

import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database.js";
import type { CardCondition } from "../src/admin/types/index.js";
import { runRecognitionPipeline } from "../api/_lib/recognition/pipeline.js";

const FIXTURES_DIR = path.resolve(process.cwd(), "benchmark/fixtures");
const MANIFEST_PATH = path.join(FIXTURES_DIR, "manifest.json");

interface Fixture {
  id: string;
  frontImage?: string;
  backImage?: string;
  expectedScryfallId: string;
  expectedName?: string;
  expectedSetCode?: string;
  expectedCollectorNumber?: string;
  expectedCondition?: CardCondition;
  era?: string;
  treatments?: string[];
  note?: string;
}

interface Manifest {
  fixtures: Fixture[];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function loadFixtures(): Promise<Fixture[]> {
  let raw: string;
  try {
    raw = await readFile(MANIFEST_PATH, "utf8");
  } catch {
    throw new Error(
      `No manifest at ${MANIFEST_PATH}. Copy benchmark/fixtures/manifest.example.json there ` +
        `and fill it in with real fixture images — see benchmark/README.md.`,
    );
  }
  const manifest = JSON.parse(raw) as Manifest;
  if (!Array.isArray(manifest.fixtures) || manifest.fixtures.length === 0) {
    throw new Error(`${MANIFEST_PATH} has no fixtures.`);
  }
  return manifest.fixtures;
}

async function loadImage(fileName: string | undefined): Promise<Buffer | null> {
  if (!fileName) return null;
  return readFile(path.join(FIXTURES_DIR, fileName));
}

type Outcome = "correct_auto_match" | "wrong_auto_match" | "manual_review" | "no_candidates";

interface FixtureResult {
  fixture: Fixture;
  outcome: Outcome;
  actualScryfallId: string | null;
  nameCorrect: boolean | null;
  setCodeCorrect: boolean | null;
  collectorNumberCorrect: boolean | null;
  conditionCorrect: boolean | null;
  conditionOffByOne: boolean | null;
}

const CONDITION_ORDER: CardCondition[] = ["NM", "LP", "MP", "HP", "DMG"];

function conditionDistance(a: CardCondition, b: CardCondition): number {
  return Math.abs(CONDITION_ORDER.indexOf(a) - CONDITION_ORDER.indexOf(b));
}

async function runFixture(
  admin: ReturnType<typeof createClient<Database>>,
  fixture: Fixture,
): Promise<FixtureResult> {
  const [front, back] = await Promise.all([
    loadImage(fixture.frontImage),
    loadImage(fixture.backImage),
  ]);

  const { recognitionResult, autoMatchedPrinting, condition } = await runRecognitionPipeline(
    admin,
    front,
    back,
  );

  let outcome: Outcome;
  let actualScryfallId: string | null = null;
  if (autoMatchedPrinting) {
    actualScryfallId = autoMatchedPrinting.scryfallId;
    outcome =
      autoMatchedPrinting.scryfallId === fixture.expectedScryfallId
        ? "correct_auto_match"
        : "wrong_auto_match";
  } else if (recognitionResult.candidatePrintings.length > 0) {
    outcome = "manual_review";
  } else {
    outcome = "no_candidates";
  }

  const nameCorrect = fixture.expectedName
    ? (recognitionResult.detectedName ?? "").toLowerCase() === fixture.expectedName.toLowerCase()
    : null;
  const setCodeCorrect = fixture.expectedSetCode
    ? (recognitionResult.detectedSetCode ?? "").toUpperCase() === fixture.expectedSetCode.toUpperCase()
    : null;
  const collectorNumberCorrect = fixture.expectedCollectorNumber
    ? recognitionResult.detectedCollectorNumber === fixture.expectedCollectorNumber
    : null;

  const conditionCorrect = fixture.expectedCondition && condition
    ? condition.suggestedCondition === fixture.expectedCondition
    : null;
  const conditionOffByOne = fixture.expectedCondition && condition
    ? conditionDistance(condition.suggestedCondition, fixture.expectedCondition) <= 1
    : null;

  return {
    fixture,
    outcome,
    actualScryfallId,
    nameCorrect,
    setCodeCorrect,
    collectorNumberCorrect,
    conditionCorrect,
    conditionOffByOne,
  };
}

function rate(numerator: number, denominator: number): string {
  if (denominator === 0) return "n/a";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function summarizeGroup(label: string, results: FixtureResult[]): void {
  const total = results.length;
  const correct = results.filter((r) => r.outcome === "correct_auto_match").length;
  const wrong = results.filter((r) => r.outcome === "wrong_auto_match").length;
  const manual = results.filter((r) => r.outcome === "manual_review").length;
  const none = results.filter((r) => r.outcome === "no_candidates").length;
  const autoMatched = correct + wrong;

  console.log(`\n${label} (${total} fixture${total === 1 ? "" : "s"})`);
  console.log(`  Auto-match rate:        ${rate(autoMatched, total)} (${autoMatched}/${total})`);
  console.log(
    `  Identity precision:     ${rate(correct, autoMatched)} of auto-matches were correct (${correct}/${autoMatched})`,
  );
  console.log(`  Manual-review rate:     ${rate(manual + none, total)} (${manual + none}/${total})`);
  if (wrong > 0) {
    console.log(`  ⚠ WRONG AUTO-MATCHES:   ${wrong} — this must be zero. See details below.`);
  }

  const withName = results.filter((r) => r.nameCorrect !== null);
  if (withName.length > 0) {
    console.log(
      `  Name OCR accuracy:      ${rate(withName.filter((r) => r.nameCorrect).length, withName.length)}`,
    );
  }
  const withSet = results.filter((r) => r.setCodeCorrect !== null);
  if (withSet.length > 0) {
    console.log(
      `  Set code OCR accuracy:  ${rate(withSet.filter((r) => r.setCodeCorrect).length, withSet.length)}`,
    );
  }
  const withCollector = results.filter((r) => r.collectorNumberCorrect !== null);
  if (withCollector.length > 0) {
    console.log(
      `  Collector # accuracy:   ${rate(withCollector.filter((r) => r.collectorNumberCorrect).length, withCollector.length)}`,
    );
  }
  const withCondition = results.filter((r) => r.conditionCorrect !== null);
  if (withCondition.length > 0) {
    console.log(
      `  Condition exact match:  ${rate(withCondition.filter((r) => r.conditionCorrect).length, withCondition.length)}`,
    );
    console.log(
      `  Condition within 1:     ${rate(withCondition.filter((r) => r.conditionOffByOne).length, withCondition.length)}`,
    );
  }
}

async function main() {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const supabaseSecretKey = requireEnv("SUPABASE_SECRET_KEY");
  const admin = createClient<Database>(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const fixtures = await loadFixtures();
  console.log(`Running the recognition pipeline against ${fixtures.length} fixture(s)...`);

  const results: FixtureResult[] = [];
  for (const fixture of fixtures) {
    process.stdout.write(`  ${fixture.id}... `);
    const result = await runFixture(admin, fixture);
    console.log(result.outcome);
    results.push(result);
  }

  summarizeGroup("OVERALL", results);

  const byEra = new Map<string, FixtureResult[]>();
  for (const r of results) {
    const key = r.fixture.era ?? "(unlabeled)";
    byEra.set(key, [...(byEra.get(key) ?? []), r]);
  }
  for (const [era, group] of byEra) {
    summarizeGroup(`Era: ${era}`, group);
  }

  const byTreatment = new Map<string, FixtureResult[]>();
  for (const r of results) {
    const treatments = r.fixture.treatments?.length ? r.fixture.treatments : ["(none)"];
    for (const t of treatments) {
      byTreatment.set(t, [...(byTreatment.get(t) ?? []), r]);
    }
  }
  for (const [treatment, group] of byTreatment) {
    summarizeGroup(`Treatment: ${treatment}`, group);
  }

  const wrongMatches = results.filter((r) => r.outcome === "wrong_auto_match");
  if (wrongMatches.length > 0) {
    console.log(`\n⚠ ${wrongMatches.length} WRONG AUTO-MATCH(ES) — never acceptable, investigate before shipping:`);
    for (const r of wrongMatches) {
      console.log(
        `  ${r.fixture.id}: expected ${r.fixture.expectedScryfallId}, got ${r.actualScryfallId}`,
      );
    }
    process.exitCode = 1;
  } else {
    console.log("\nNo wrong auto-matches — precision-over-recall goal held for this fixture set.");
  }
}

main().catch((err) => {
  console.error("benchmark:recognition failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
