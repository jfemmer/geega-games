# Recognition benchmark harness

Measures the real recognition pipeline's accuracy against a set of scans
with known correct answers — the "how good is this actually?" question
Part 11 asks for, run against `api/_lib/recognition/pipeline.ts` directly
(the exact same code the live `/api/admin/scans/:scanId/recognize` endpoint
calls), never a separate simulated copy.

## Why fixtures aren't in the repo

A fixture is a real scan photo of a real card, and the pipeline compares it
against real Scryfall reference images. Both are copyrighted. `benchmark/
fixtures/` is gitignored (except this README and the example manifest) —
build your own local fixture set and keep it out of version control.

## Building a fixture set

1. Create `benchmark/fixtures/` if it doesn't already exist.
2. Drop scan images into it (front + optionally back per card), in whatever
   format the real pipeline receives from scanning (600 DPI, 24-bit color —
   matching real conditions makes the benchmark meaningful).
3. Copy `manifest.example.json` to `manifest.json` in that same folder and
   add one entry per fixture:

   ```json
   {
     "id": "modern-bolt-nm",
     "frontImage": "modern-bolt-nm-front.jpg",
     "backImage": "modern-bolt-nm-back.jpg",
     "expectedScryfallId": "the-real-scryfall-id-for-this-exact-printing",
     "expectedName": "Lightning Bolt",
     "expectedSetCode": "MH2",
     "expectedCollectorNumber": "138",
     "expectedCondition": "NM",
     "era": "modern",
     "treatments": []
   }
   ```

   Only `id` and `expectedScryfallId` are required. Every other field is
   optional and only affects which metrics that fixture contributes to —
   omit `expectedCondition` for a fixture you haven't graded by hand yet,
   omit `backImage` to specifically exercise the missing-back-scan path,
   and so on. `era` and `treatments` are free-text labels used purely to
   group the results (they don't have to match the pipeline's internal
   `RecognitionEra` enum exactly) — use them to build a set that covers
   Part 7's eras (modern / exodus-to-premodern / vintage) and Part 17's
   treatment list (showcase, borderless, extended art, retro frame,
   full art, promo, DFC, alternate language) deliberately, not just
   whatever's easiest to scan first.

For a trustworthy precision measurement, deliberately include a few
genuinely hard/ambiguous cards (same name across multiple sets, a showcase
treatment that shares art with the normal printing, a vintage card with no
collector number) — a benchmark made only of easy modern commons will
report a precision number that doesn't reflect real usage.

## Running it

```bash
npm run benchmark
```

Requires `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the environment (same
service-role credentials `scryfall:refresh` uses), and
`GOOGLE_CLOUD_VISION_API_KEY` if you want OCR-dependent metrics to reflect
real OCR rather than the honest "OCR unavailable" fallback result.

## Reading the output

The script prints an overall summary, then breaks the same metrics down by
era and by treatment, then lists every WRONG auto-match by fixture id —
that list should always be empty. A wrong auto-match is a precision
failure (a confident wrong guess), which Part 10's philosophy treats as far
worse than an extra manual review; the script exits with a non-zero code
when one occurs, so it can gate a CI check if you wire it into one.
