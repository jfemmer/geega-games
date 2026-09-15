// Recognition thresholds — the ONE place magic numbers for auto-match vs.
// manual-review decisions live (Part 10). Nothing downstream hardcodes a
// confidence cutoff; everything reads from here so tuning is a one-file
// change, not a hunt through the pipeline.
//
// Philosophy: precision over recall. A wrong auto-match is far more costly
// than an extra manual review, so thresholds start conservative. Track
// real accuracy via the benchmark harness (scripts/benchmarkRecognition.ts)
// before loosening any of these.

export const RECOGNITION_THRESHOLDS = {
  /**
   * Overall identity confidence required to auto-select a Scryfall printing
   * without human review. Everything below this — regardless of how
   * confident any ONE signal is — goes to needs_manual_match.
   */
  autoMatchOverallConfidence: 0.9,

  /** A single candidate must beat the runner-up by at least this much to
   * count as "clearly the best" rather than "ambiguous". */
  autoMatchMinMarginOverRunnerUp: 0.15,

  /** OCR field confidence below this is treated as "didn't really read it",
   * not as weak-but-usable evidence. */
  ocrFieldMinUsableConfidence: 0.55,

  /** Visual (perceptual hash) similarity, 0–1, required to count as a
   * verified art match. Same threshold used for the front-card structural
   * check and the dedicated art-crop check. */
  visualMatchMinSimilarity: 0.82,

  /** Set-symbol shape-match distance ceiling (lower = more similar; see
   * setSymbol.ts's hashDistance) to accept a symbol candidate at all. */
  setSymbolMaxHashDistance: 12,

  /** Condition suggestion confidence below this is shown but flagged as
   * low-confidence in the review UI rather than presented as settled. */
  conditionMinDisplayConfidence: 0.4,
} as const;

/** Per-field confidence Record key names, kept in one place for consistency. */
export const CONFIDENCE_FIELDS = [
  "name",
  "collectorNumber",
  "setCode",
  "setSymbol",
  "exactPrinting",
  "overallIdentity",
  "condition",
] as const;
export type ConfidenceField = (typeof CONFIDENCE_FIELDS)[number];
