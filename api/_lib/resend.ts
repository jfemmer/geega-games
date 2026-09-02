import { Resend } from "resend";
import { ServerEnv } from "./env.js";

// Lazily-constructed Resend client. Constructed on first use so functions that
// never send email do not require RESEND_API_KEY at cold start.
let cached: Resend | null = null;

export function getResend(): Resend {
  if (cached) return cached;
  cached = new Resend(ServerEnv.resendApiKey());
  return cached;
}
