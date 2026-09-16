// Centralised, validated access to server-side environment variables.
// These are NEVER prefixed with VITE_ and are never bundled into the browser.
//
// Access a variable through requireEnv() at call time (not module load) so a
// single missing secret fails only the specific function that needs it, with a
// clear log line, rather than crashing every function at cold start.

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    // Do not include the value (there is none) or any other secret.
    throw new Error(`Missing required server environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string, fallback = ""): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

// Convenience typed getters for the values used across functions.
export const ServerEnv = {
  supabaseUrl: () => requireEnv("SUPABASE_URL"),
  supabaseSecretKey: () => requireEnv("SUPABASE_SECRET_KEY"),
  resendApiKey: () => requireEnv("RESEND_API_KEY"),
  resendWebhookSecret: () => requireEnv("RESEND_WEBHOOK_SECRET"),
  emailTokenSecret: () => requireEnv("EMAIL_TOKEN_SECRET"),
  publicSiteUrl: () => requireEnv("PUBLIC_SITE_URL").replace(/\/+$/, ""),
  // Sender identities are configurable; sensible defaults keep local dev working.
  fromMarketing: () =>
    optionalEnv("RESEND_FROM_EMAIL", "Geega Games <updates@geega-games.com>"),
  fromOrders: () =>
    optionalEnv("RESEND_FROM_ORDERS", "Geega Games <orders@geega-games.com>"),
  replyTo: () => optionalEnv("RESEND_REPLY_TO", "support@geega-games.com"),
  // Where new-lead notifications for Sell Your Cards submissions are sent.
  // Defaults to the general reply-to address so the feature works without
  // extra setup, but the store owner should point this at whichever inbox
  // they actually want new buying leads to land in.
  sellLeadsNotificationEmail: () =>
    optionalEnv("SELL_LEADS_NOTIFICATION_EMAIL", optionalEnv("RESEND_REPLY_TO", "support@geega-games.com")),
  // Stripe (server-only secrets; never expose to the browser). These are read
  // lazily so only the payment/webhook functions require them — the rest of the
  // API keeps working before Stripe is configured.
  stripeSecretKey: () => requireEnv("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: () => requireEnv("STRIPE_WEBHOOK_SECRET"),
  // Optional: an upgrade path, not a requirement. Without this set, OCR
  // uses the free, local tesseract provider (see api/_lib/ocr) — setting
  // this switches to the paid Google Cloud Vision API instead.
  googleCloudVisionApiKey: () => optionalEnv("GOOGLE_CLOUD_VISION_API_KEY"),
} as const;
