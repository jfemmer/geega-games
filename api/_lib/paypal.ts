import { requireEnv, optionalEnv } from "./env.js";

// Server-only PayPal REST client (Orders v2 + webhook verification). PayPal
// is also how Venmo is accepted: the browser's PayPal JS SDK renders a Venmo
// button for eligible US buyers, and a Venmo payment is captured through the
// exact same PayPal order/capture APIs below.
//
// No SDK dependency: the handful of endpoints we need are plain REST calls.
// Credentials are read lazily (at call time) so every other function keeps
// working before PayPal is configured — mirroring getStripe().
//
// Env:
//   PAYPAL_CLIENT_ID      — REST app client id (same value as VITE_PAYPAL_CLIENT_ID)
//   PAYPAL_CLIENT_SECRET  — REST app secret (server-only, never VITE_)
//   PAYPAL_WEBHOOK_ID     — id of the webhook registered for /api/webhooks/paypal
//   PAYPAL_ENV            — "live" or "sandbox" (default "sandbox" so a
//                           misconfigured deploy can never take real money
//                           against test credentials, or vice versa silently)

export type PayPalAmount = { currency_code: string; value: string };

export type PayPalCapture = {
  id: string;
  status: "COMPLETED" | "DECLINED" | "PARTIALLY_REFUNDED" | "PENDING" | "REFUNDED" | "FAILED";
  amount?: PayPalAmount;
  custom_id?: string;
  invoice_id?: string;
  status_details?: { reason?: string };
};

export type PayPalOrder = {
  id: string;
  status:
    | "CREATED"
    | "SAVED"
    | "APPROVED"
    | "VOIDED"
    | "COMPLETED"
    | "PAYER_ACTION_REQUIRED";
  purchase_units?: Array<{
    custom_id?: string;
    invoice_id?: string;
    amount?: PayPalAmount;
    payments?: { captures?: PayPalCapture[] };
  }>;
};

export class PayPalApiError extends Error {
  status: number;
  /** PayPal's machine-readable issue code, e.g. INSTRUMENT_DECLINED. */
  issue: string | null;
  constructor(status: number, message: string, issue: string | null) {
    super(message);
    this.status = status;
    this.issue = issue;
  }
}

export function paypalApiBase(): string {
  return optionalEnv("PAYPAL_ENV", "sandbox").toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

export function isPayPalServerConfigured(): boolean {
  return Boolean(optionalEnv("PAYPAL_CLIENT_ID") && optionalEnv("PAYPAL_CLIENT_SECRET"));
}

// Access tokens live ~9 hours; cache per warm function instance and refresh a
// minute early so an in-flight request never uses an expiring token.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const clientId = requireEnv("PAYPAL_CLIENT_ID");
  const secret = requireEnv("PAYPAL_CLIENT_SECRET");
  const res = await fetch(`${paypalApiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const body = (await res.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number }
    | null;
  if (!res.ok || !body?.access_token) {
    throw new PayPalApiError(res.status, "PayPal authentication failed.", null);
  }
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 300) * 1000,
  };
  return body.access_token;
}

async function paypalRequest<T>(
  method: "GET" | "POST",
  path: string,
  opts: { body?: unknown; requestId?: string } = {},
): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  // PayPal-Request-Id makes POSTs idempotent on PayPal's side: a retried
  // capture with the same id returns the original result instead of
  // capturing twice.
  if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;

  const res = await fetch(`${paypalApiBase()}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const json = (await res.json().catch(() => null)) as
    | (T & { name?: string; message?: string; details?: Array<{ issue?: string }> })
    | null;
  if (!res.ok) {
    const issue = json?.details?.[0]?.issue ?? json?.name ?? null;
    throw new PayPalApiError(res.status, json?.message || `PayPal ${method} ${path} failed.`, issue);
  }
  return json as T;
}

/** Cents → PayPal's decimal string ("12.34"). Integer math only. */
export function centsToPayPalValue(cents: number): string {
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, "0");
  return `${whole}.${frac}`;
}

/** PayPal's decimal string → cents, or null if it isn't a clean 2dp amount. */
export function payPalValueToCents(value: string | undefined): number | null {
  if (!value || !/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, frac = ""] = value.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function createPayPalOrder(params: {
  orderId: string;
  amountCents: number;
  description: string;
}): Promise<PayPalOrder> {
  return paypalRequest<PayPalOrder>("POST", "/v2/checkout/orders", {
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          // custom_id ties the PayPal order back to OUR order; it's what the
          // capture path and webhook read to know which order to mark paid.
          custom_id: params.orderId,
          description: params.description.slice(0, 127),
          amount: { currency_code: "USD", value: centsToPayPalValue(params.amountCents) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Geega Games",
            // We already collected (and priced) the shipping address; don't
            // let PayPal collect a different one.
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
          },
        },
      },
    },
  });
}

export function getPayPalOrder(paypalOrderId: string): Promise<PayPalOrder> {
  return paypalRequest<PayPalOrder>("GET", `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
}

export function capturePayPalOrder(paypalOrderId: string): Promise<PayPalOrder> {
  return paypalRequest<PayPalOrder>(
    "POST",
    `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
    { body: {}, requestId: `capture-${paypalOrderId}` },
  );
}

/**
 * Verifies a webhook delivery really came from PayPal for OUR webhook, using
 * PayPal's verify-webhook-signature API. The event must be passed as the
 * parsed object of the exact raw body PayPal sent.
 */
export async function verifyPayPalWebhook(
  headers: Record<string, string | string[] | undefined>,
  event: unknown,
): Promise<boolean> {
  const h = (name: string) => {
    const v = headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  const required = {
    auth_algo: h("paypal-auth-algo"),
    cert_url: h("paypal-cert-url"),
    transmission_id: h("paypal-transmission-id"),
    transmission_sig: h("paypal-transmission-sig"),
    transmission_time: h("paypal-transmission-time"),
  };
  if (Object.values(required).some((v) => !v)) return false;

  const result = await paypalRequest<{ verification_status?: string }>(
    "POST",
    "/v1/notifications/verify-webhook-signature",
    {
      body: {
        ...required,
        webhook_id: requireEnv("PAYPAL_WEBHOOK_ID"),
        webhook_event: event,
      },
    },
  );
  return result.verification_status === "SUCCESS";
}
