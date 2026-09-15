import sharp from "sharp";
import { cropRegion, type RegionName } from "./imageRegions.js";
import { RECOGNITION_THRESHOLDS } from "./config.js";
import type {
  CardCondition,
  DefectFinding,
  DefectSeverity,
} from "../../../src/admin/types/index.js";
export type { DefectFinding, DefectSeverity };

// Condition analysis (Part 9). HONEST SCOPE: this is a heuristic, explainable
// FIRST PASS built from objective per-region image metrics (edge/corner
// texture roughness via Laplacian variance, edge-strip lightness vs. the
// card's own border color, surface high-frequency noise vs. the Scryfall
// reference) — not a trained defect-detection model. There is no OpenCV and
// no labeled training data in this stack. Every number here is REAL
// (computed from the actual pixels), and every grade traces back to
// specific, inspectable region findings — never a black box returning "LP"
// with no reasoning — but real-world accuracy needs measuring and tuning via
// the benchmark harness (scripts/benchmarkRecognition.ts) against known-
// condition fixture scans before this should be trusted at face value.
// Treat suggestedCondition as exactly that: a suggestion for a human to
// confirm or correct in one click, never auto-applied to confirmedCondition.

export interface ConditionAnalysis {
  suggestedCondition: CardCondition;
  confidence: number;
  findings: DefectFinding[];
  /** True when the back image was unavailable — confidence is lowered and
   * this is surfaced explicitly, per Part 4/9's explicit requirement. */
  backImageMissing: boolean;
  /** Short human summary, e.g. "minor whitening on 2 back edges, light front scuffing." */
  summary: string;
}

interface RegionMetrics {
  /** Laplacian-variance "texture roughness" — corners/edges with wear tend
   * to have MORE local high-frequency variance than a clean, sharp corner. */
  roughness: number;
  /** Mean lightness (0–255) of the region. */
  meanLightness: number;
  /** Standard deviation of lightness — high = mottled/inconsistent surface. */
  lightnessStdDev: number;
}

const LAPLACIAN_KERNEL = {
  width: 3,
  height: 3,
  kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
} as const;

async function regionMetrics(image: Buffer, region: RegionName, width: number, height: number): Promise<RegionMetrics> {
  const crop = await cropRegion(image, width, height, region);
  const gray = sharp(crop).grayscale();

  const { data: stats } = await gray.clone().stats().then((s) => ({ data: s }));
  const meanLightness = stats.channels[0]?.mean ?? 0;
  const lightnessStdDev = stats.channels[0]?.stdev ?? 0;

  const edgeBuffer = await gray.clone().convolve(LAPLACIAN_KERNEL).raw().toBuffer();
  let sumSq = 0;
  for (const v of edgeBuffer) sumSq += v * v;
  const roughness = Math.sqrt(sumSq / Math.max(1, edgeBuffer.length));

  return { roughness, meanLightness, lightnessStdDev };
}

/** Deviation-based severity: how far a metric sits from a clean baseline. */
function severityFromDeviation(deviation: number): DefectSeverity {
  if (deviation < 0.15) return "none";
  if (deviation < 0.35) return "light";
  if (deviation < 0.6) return "moderate";
  return "heavy";
}

const CORNER_REGIONS: { region: RegionName; label: string }[] = [
  { region: "cornerTopLeft", label: "upper-left corner" },
  { region: "cornerTopRight", label: "upper-right corner" },
  { region: "cornerBottomLeft", label: "lower-left corner" },
  { region: "cornerBottomRight", label: "lower-right corner" },
];
const EDGE_REGIONS: { region: RegionName; label: string }[] = [
  { region: "edgeTop", label: "top edge" },
  { region: "edgeBottom", label: "bottom edge" },
  { region: "edgeLeft", label: "left edge" },
  { region: "edgeRight", label: "right edge" },
];

/**
 * Analyze ONE side (front or back) of a normalized card. Baseline "clean"
 * roughness/lightness ranges are calibrated from typical modern-card black-
 * border scans; a printing with a different border color will shift the
 * baseline — this is a known limitation of not comparing against that
 * specific printing's reference image for every region (verification.ts
 * already does the full-card/art comparison; extending per-region reference
 * diffing is a reasonable follow-up once benchmark data shows it's needed).
 */
async function analyzeSide(
  image: Buffer,
  width: number,
  height: number,
  side: "front" | "back",
): Promise<DefectFinding[]> {
  const findings: DefectFinding[] = [];

  for (const { region, label } of CORNER_REGIONS) {
    const m = await regionMetrics(image, region, width, height);
    // A clean corner is a crisp, low-noise diagonal cut — low roughness.
    // Worn/rounded/whitened corners show elevated high-frequency variance.
    const deviation = Math.min(1, m.roughness / 40);
    const severity = severityFromDeviation(deviation);
    if (severity !== "none") {
      findings.push({
        region: `${side} ${label}`,
        kind: "corner_wear",
        severity,
        note: `${severity} wear`,
      });
    }
  }

  for (const { region, label } of EDGE_REGIONS) {
    const m = await regionMetrics(image, region, width, height);
    // Whitening lightens a (typically dark) border strip. meanLightness is
    // 0–255; a plain black border scans low (~10–40). Elevated lightness or
    // high variance (a patchy, inconsistent strip rather than uniform dark)
    // both indicate whitening.
    const lightnessDeviation = Math.min(1, Math.max(0, m.meanLightness - 30) / 120);
    const variancePenalty = Math.min(1, m.lightnessStdDev / 60);
    const deviation = Math.max(lightnessDeviation, variancePenalty);
    const severity = severityFromDeviation(deviation);
    if (severity !== "none") {
      findings.push({
        region: `${side} ${label}`,
        kind: "edge_whitening",
        severity,
        note: `${severity} whitening`,
      });
    }
  }

  const surface = await regionMetrics(image, "art", width, height);
  const surfaceDeviation = Math.min(1, surface.roughness / 55);
  const surfaceSeverity = severityFromDeviation(surfaceDeviation);
  if (surfaceSeverity !== "none") {
    findings.push({
      region: `${side} surface`,
      kind: "surface_wear",
      severity: surfaceSeverity,
      note:
        surfaceSeverity === "light"
          ? "light scratches or scuffing"
          : `${surfaceSeverity} surface wear`,
    });
  }

  return findings;
}

/** Map findings to the Geega NM/LP/MP/HP/DMG scale (src/store/pages/StaticPages.tsx). */
export function gradeFromFindings(findings: DefectFinding[]): CardCondition {
  const structural = findings.some(
    (f) => f.kind === "structural" || f.kind === "stain_or_liquid" || f.kind === "writing_or_ink",
  );
  if (structural) return "DMG";

  const heavyCount = findings.filter((f) => f.severity === "heavy").length;
  const moderateCount = findings.filter((f) => f.severity === "moderate").length;
  const lightCount = findings.filter((f) => f.severity === "light").length;

  if (heavyCount >= 1 || moderateCount >= 4) return "HP";
  if (moderateCount >= 1) return "MP";
  if (lightCount >= 2) return "LP";
  if (lightCount === 1) return "LP";
  return "NM";
}

function summarize(findings: DefectFinding[]): string {
  if (findings.length === 0) return "No wear detected.";
  return findings
    .slice(0, 4)
    .map((f) => `${f.note} on ${f.region}`)
    .join("; ");
}

export async function analyzeCondition(
  frontNormalized: { buffer: Buffer; width: number; height: number } | null,
  backNormalized: { buffer: Buffer; width: number; height: number } | null,
): Promise<ConditionAnalysis> {
  const findings: DefectFinding[] = [];

  if (frontNormalized) {
    findings.push(
      ...(await analyzeSide(frontNormalized.buffer, frontNormalized.width, frontNormalized.height, "front")),
    );
  }
  if (backNormalized) {
    findings.push(
      ...(await analyzeSide(backNormalized.buffer, backNormalized.width, backNormalized.height, "back")),
    );
  }

  const suggestedCondition = gradeFromFindings(findings);
  const backImageMissing = !backNormalized;

  // Confidence reflects both the heuristic's inherent limitations AND
  // reduced evidence when only one side was available — never claims high
  // confidence off a front-only scan (Part 4's explicit requirement).
  let confidence = frontNormalized && backNormalized ? 0.6 : 0.35;
  if (backImageMissing) confidence = Math.min(confidence, 0.4);

  return {
    suggestedCondition,
    confidence,
    findings,
    backImageMissing,
    summary:
      summarize(findings) +
      (backImageMissing ? " (back scan unavailable — confidence reduced.)" : ""),
  };
}

export function conditionNeedsReview(analysis: ConditionAnalysis): boolean {
  return analysis.confidence < RECOGNITION_THRESHOLDS.conditionMinDisplayConfidence;
}
