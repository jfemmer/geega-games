// The seller forms whose progress is tracked (formTracking.ts) and their
// steps, in order. Kept free of React and browser code so the admin Overview
// can label its "Seller forms: where people stop" funnel with the same names.

export type TrackedForm = "quick_quote" | "sell" | "referral";

/** Each form's steps, in order (step 1 is the first). The admin labels its funnel with these. */
export const FORM_STEPS: Record<TrackedForm, readonly string[]> = {
  quick_quote: ["What you're selling", "Where to send your offer"],
  sell: ["What you're selling", "Collection details", "Your info", "Review & submit"],
  referral: ["The form"],
};

/** How the admin names each form. */
export const FORM_NAMES: Record<TrackedForm, string> = {
  quick_quote: "Quick photo quote",
  sell: "Full sell form",
  referral: "Partner-store form",
};
