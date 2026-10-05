import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database.js";
import { ServerEnv } from "../_lib/env.js";
import { optionalEnv } from "../_lib/env.js";
import { getStripe } from "../_lib/stripe.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { readJsonBody, sendJson } from "../_lib/http.js";
import { releaseHold, releaseUserHolds } from "../_lib/checkoutHolds.js";
import { normalizeEmail } from "../_lib/tokens.js";
import { guestTokensAvailable, signGuestToken, verifyGuestToken } from "../_lib/guestAccess.js";
import { checkRateLimit, getClientIp } from "../_lib/rateLimit.js";
import { checkUsAddress, US_ONLY_MESSAGE } from "../../src/store/lib/usAddress.js";

// POST /api/checkout/create-payment-intent
//
// Flow (server is the ONLY pricing authority):
//   1. Identify the buyer:
//        signed in -> their Supabase access token;
//        guest     -> no token, a `guest` block with email + cart lines
//                     (inventory ids and quantities only — never prices).
//   1b. Release the buyer's earlier unpaid checkout holds (cancelling their
//      Stripe PaymentIntents first), so going back and checking out again
//      never finds their own cards "sold out". Guests prove the earlier
//      hold is theirs with its signed guest token.
//   1c. Check where it ships. Orders go to US addresses only
//      (src/store/lib/usAddress.ts): anything else is refused here, before
//      an order exists or stock is held, with a message the customer can
//      act on. The database refuses it too (checkout_place_order_core), so
//      this isn't the only lock on the door.
//   2. Create the canonical order in the DB, which atomically revalidates
//      SELLABLE stock (physical minus active reservations) and computes
//      canonical totals:
//        signed in -> checkout_create_order AS THAT USER (their JWT, so
//                     auth.uid() and RLS apply; items come from their cart);
//        guest     -> checkout_create_guest_order via service_role (items
//                     from the request, re-priced from inventory).
//   3. If amount_due == 0 (store credit covered it), the RPC already marked the
//      order paid; return that — no Stripe needed. (Guests have no credit.)
//   4. Otherwise create a Stripe PaymentIntent for EXACTLY amount_due_cents
//      (server value), attach order_id in metadata, return client_secret.
//      Its id is stored in orders.payment_reference so the hold-expiry
//      worker can cancel it. Without Stripe configured (PayPal-only), no
//      PaymentIntent is created and the page offers PayPal/Venmo alone.
//
// Guests get back `guestToken` (see api/_lib/guestAccess.ts): proof that this
// browser placed the order, used to pay for it and to attach it to an
// account afterwards.
//
// The browser never supplies the amount. A tampered client can at most create
// its own pending order for its own cart; it cannot change the price or buy
// reserved stock.

type ShipBody = {
  recipient?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

type CreateBody = {
  accessToken?: string;
  shippingMethod?: "tracked" | "pwe";
  storeCreditRequestedCents?: number;
  ship?: ShipBody;
  guest?: {
    email?: unknown;
    items?: unknown;
    previousOrder?: { id?: unknown; token?: unknown };
  };
};

type CreatedOrder = {
  order_id: string;
  amount_due_cents: number;
};

/** Where an order ships, tidied: state as its USPS code, ZIP normalized, country "US". */
type ShipTo = {
  recipient: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

type ShipToResult = { ok: true; address: ShipTo } | { ok: false; message: string };

const trimmed = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * The address the browser sent, checked: it must be complete and in the
 * United States. A guest has no profile to name the package after, so their
 * recipient name is required too.
 */
function shipToFrom(ship: ShipBody | undefined, opts: { recipientRequired: boolean }): ShipToResult {
  const recipient = trimmed(ship?.recipient);
  const line1 = trimmed(ship?.line1);
  const city = trimmed(ship?.city);
  const postalCode = trimmed(ship?.postalCode);
  if (!line1 || !city || !postalCode || (opts.recipientRequired && !recipient)) {
    return {
      ok: false,
      message: opts.recipientRequired
        ? "Please provide your name and a complete shipping address."
        : "Please provide a complete shipping address.",
    };
  }
  const check = checkUsAddress({ state: ship?.state, postalCode, country: ship?.country });
  if (!check.ok) return { ok: false, message: check.message };
  return {
    ok: true,
    address: {
      recipient: recipient || null,
      line1,
      line2: trimmed(ship?.line2) || null,
      city,
      state: check.state,
      postalCode: check.postalCode,
      country: check.country,
    },
  };
}

/** A shipping address we can't use: the page shows `message` as it is. */
function addressRefused(res: VercelResponse, message: string) {
  return sendJson(res, 400, { ok: false, code: "shipping_address", message });
}

const ID_RE = /^[0-9a-f-]{36}$/i;
const MAX_GUEST_LINES = 100;
// A guest's cart arrives in the request itself: up to MAX_GUEST_LINES lines
// of about 72 bytes each, plus the address. (readJsonBody's default cap is
// sized for an email form, and cut guests off at about 50 different cards.)
const MAX_BODY_BYTES = 16 * 1024;
// Guest checkout creates a stock hold without an account, so cap how fast one
// visitor can do it (each hold still expires on its own after 30 minutes).
const GUEST_CHECKOUTS_PER_WINDOW = 8;
const GUEST_WINDOW_MS = 10 * 60_000;

function checkoutErrorResponse(res: VercelResponse, rawMessage: string) {
  const msg = rawMessage.toLowerCase();
  if (msg.includes("orders paused")) {
    return sendJson(res, 503, {
      ok: false,
      code: "orders_paused",
      message: "We’re not taking orders right now. Please check back soon.",
    });
  }
  if (msg.includes("insufficient stock") || msg.includes("no longer available")) {
    return sendJson(res, 409, {
      ok: false,
      code: "stock_conflict",
      message: "Some items changed availability. Please review your cart.",
    });
  }
  if (msg.includes("no price")) {
    return sendJson(res, 409, { ok: false, message: "An item isn’t priced and can’t be purchased." });
  }
  if (msg.includes("cart is empty")) {
    return sendJson(res, 400, { ok: false, message: "Your cart is empty." });
  }
  if (msg.includes("guest email required")) {
    return sendJson(res, 400, { ok: false, message: "Please enter a valid email address." });
  }
  if (msg.includes("shipping address required")) {
    return addressRefused(res, "Please provide a complete shipping address.");
  }
  if (msg.includes("us shipping only")) {
    // The database's own check. shipToFrom() should have caught it first.
    return addressRefused(res, `${US_ONLY_MESSAGE} Please check the state and ZIP code.`);
  }
  return sendJson(res, 400, { ok: false, message: "Could not create order." });
}

/** Cart lines from the browser: inventory ids + quantities only. */
function parseGuestItems(raw: unknown): { inventory_item_id: string; quantity: number }[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_GUEST_LINES) return null;
  const items: { inventory_item_id: string; quantity: number }[] = [];
  for (const line of raw) {
    const id = (line as { inventoryItemId?: unknown })?.inventoryItemId;
    const qty = (line as { quantity?: unknown })?.quantity;
    if (typeof id !== "string" || !ID_RE.test(id)) return null;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 99) return null;
    items.push({ inventory_item_id: id, quantity: qty });
  }
  return items;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { ok: false, message: "Method not allowed." });
  }

  let body: CreateBody;
  try {
    body = (await readJsonBody(req, MAX_BODY_BYTES)) as CreateBody;
  } catch {
    return sendJson(res, 400, { ok: false, message: "Bad request body." });
  }

  if (body.shippingMethod !== "tracked" && body.shippingMethod !== "pwe") {
    return sendJson(res, 400, { ok: false, message: "Invalid shipping method." });
  }

  const accessToken =
    body.accessToken ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

  if (!accessToken) {
    if (!body.guest) {
      return sendJson(res, 401, { ok: false, message: "Not authenticated." });
    }
    return guestCheckout(req, res, body);
  }

  // A per-request client bound to the caller's JWT: the RPC runs as the user,
  // so auth.uid() and RLS are enforced exactly as in the browser.
  const userClient = createClient<Database>(
    ServerEnv.supabaseUrl(),
    // The publishable/anon key is fine here; the JWT provides the identity.
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  // Verify the token maps to a real user before doing anything.
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return sendJson(res, 401, { ok: false, message: "Session expired. Please sign in again." });
  }

  // A signed-in customer's package is named after their profile when they
  // give no recipient.
  const shipTo = shipToFrom(body.ship, { recipientRequired: false });
  if (!shipTo.ok) return addressRefused(res, shipTo.message);

  // Vacation mode. Checked before releasing the customer's earlier holds so
  // a paused store doesn't drop a hold they could still pay for.
  // checkout_create_order enforces the same rule in the DB.
  const { data: storeStatus } = await userClient.rpc("store_ordering_status");
  const storeRow = Array.isArray(storeStatus) ? storeStatus[0] : null;
  if (storeRow?.paused) {
    return sendJson(res, 503, {
      ok: false,
      code: "orders_paused",
      message: storeRow.message,
    });
  }

  // Never fatal: if a release fails, the RPC's stock check still protects
  // correctness and the expiry worker releases the old hold later.
  try {
    await releaseUserHolds(userData.user.id);
  } catch (err) {
    console.error("[checkout] releasing earlier holds failed", err);
  }

  // Create the canonical order in the DB (atomic sellable-stock revalidation).
  const { data, error } = await userClient.rpc("checkout_create_order", {
    p_shipping_method: body.shippingMethod,
    p_store_credit_requested_cents: Math.max(
      0,
      Math.floor(body.storeCreditRequestedCents ?? 0),
    ),
    p_ship_recipient: shipTo.address.recipient ?? undefined,
    p_ship_line1: shipTo.address.line1,
    p_ship_line2: shipTo.address.line2 ?? undefined,
    p_ship_city: shipTo.address.city,
    p_ship_state: shipTo.address.state,
    p_ship_postal_code: shipTo.address.postalCode,
    p_ship_country: shipTo.address.country,
  });

  if (error) return checkoutErrorResponse(res, error.message);

  const order = (Array.isArray(data) ? data[0] : data) as CreatedOrder | null;
  if (!order) {
    return sendJson(res, 500, { ok: false, message: "Order creation returned no result." });
  }

  return startPayment(res, order, { user_id: userData.user.id }, {});
}

async function guestCheckout(req: VercelRequest, res: VercelResponse, body: CreateBody) {
  const ip = getClientIp(req);
  const rl = checkRateLimit("checkout-guest", ip, GUEST_CHECKOUTS_PER_WINDOW, GUEST_WINDOW_MS);
  if (!rl.allowed) {
    res.setHeader("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)));
    return sendJson(res, 429, {
      ok: false,
      message: "Too many checkout attempts. Please wait a few minutes and try again.",
    });
  }

  // Without the signing secret a guest couldn't pay for (or later claim) the
  // order, so refuse before creating a stock hold.
  if (!guestTokensAvailable()) {
    return sendJson(res, 503, {
      ok: false,
      message: "Guest checkout isn’t available right now. Please sign in to check out.",
    });
  }

  const guest = body.guest ?? {};
  const email = normalizeEmail(guest.email);
  if (!email) {
    return sendJson(res, 400, { ok: false, message: "Please enter a valid email address." });
  }
  const items = parseGuestItems(guest.items);
  if (!items) {
    return sendJson(res, 400, { ok: false, message: "Your cart is empty or couldn’t be read. Please refresh and try again." });
  }
  const shipTo = shipToFrom(body.ship, { recipientRequired: true });
  if (!shipTo.ok) return addressRefused(res, shipTo.message);
  const ship = shipTo.address;

  const admin = getSupabaseAdmin() as any;

  // Vacation mode, before touching the guest's earlier hold (DB enforces it too).
  const { data: storeStatus } = await admin.rpc("store_ordering_status");
  const storeRow = Array.isArray(storeStatus) ? storeStatus[0] : null;
  if (storeRow?.paused) {
    return sendJson(res, 503, { ok: false, code: "orders_paused", message: storeRow.message });
  }

  // "Back to checkout" then "Continue to payment" again: release this
  // browser's previous guest hold so its cards aren't blocked by itself.
  const prev = guest.previousOrder;
  if (prev && verifyGuestToken("order", prev.id, prev.token)) {
    try {
      const { data: hold } = await admin
        .from("orders")
        .select("id, payment_reference")
        .eq("id", prev.id)
        .is("user_id", null)
        .eq("channel", "online")
        .eq("status", "pending_payment")
        .eq("payment_status", "unpaid")
        .maybeSingle();
      if (hold) await releaseHold(hold, "Replaced by a new checkout");
    } catch (err) {
      console.error("[checkout] releasing earlier guest hold failed", err);
    }
  }

  const { data, error } = await admin.rpc("checkout_create_guest_order", {
    p_email: email,
    p_items: items,
    p_shipping_method: body.shippingMethod,
    p_ship_recipient: ship.recipient,
    p_ship_line1: ship.line1,
    p_ship_line2: ship.line2,
    p_ship_city: ship.city,
    p_ship_state: ship.state,
    p_ship_postal_code: ship.postalCode,
    p_ship_country: ship.country,
  });
  if (error) return checkoutErrorResponse(res, error.message);

  const order = (Array.isArray(data) ? data[0] : data) as CreatedOrder | null;
  if (!order) {
    return sendJson(res, 500, { ok: false, message: "Order creation returned no result." });
  }

  const guestToken = signGuestToken("order", order.order_id);
  return startPayment(res, order, { guest: "1" }, { guestToken });
}

/** Shared tail: zero-balance short-circuit, else a PaymentIntent for exactly amount_due. */
async function startPayment(
  res: VercelResponse,
  order: CreatedOrder,
  metadata: Record<string, string>,
  extra: Record<string, unknown>,
) {
  // Store-credit fully covered it: RPC already marked it paid. No Stripe.
  if (order.amount_due_cents === 0) {
    return sendJson(res, 200, {
      ok: true,
      orderId: order.order_id,
      amountDueCents: 0,
      paid: true,
      ...extra,
    });
  }

  if (!optionalEnv("STRIPE_SECRET_KEY")) {
    return sendJson(res, 200, {
      ok: true,
      orderId: order.order_id,
      amountDueCents: order.amount_due_cents,
      clientSecret: null,
      ...extra,
    });
  }

  // Create a PaymentIntent for EXACTLY the server-computed amount.
  try {
    const stripe = getStripe();
    const intent = await stripe.paymentIntents.create(
      {
        amount: order.amount_due_cents, // server value, never the browser's
        currency: "usd",
        metadata: { order_id: order.order_id, ...metadata },
        // Cards only — deliberately NOT automatic_payment_methods, which
        // would show whatever is switched on in the Stripe Dashboard (Klarna,
        // bank payments, Cash App, ...). Apple Pay and Google Pay still
        // appear: Stripe treats them as cards. PayPal/Venmo are a separate
        // integration (api/checkout/paypal.ts), not Stripe methods.
        payment_method_types: ["card"],
      },
      // Idempotency: retrying the same order won't create duplicate intents.
      { idempotencyKey: `pi_${order.order_id}` },
    );

    // Lets the hold-expiry worker find and cancel this exact PaymentIntent.
    // (mark_order_paid overwrites it with the final payment reference.)
    const { error: refErr } = await getSupabaseAdmin()
      .from("orders")
      .update({ payment_reference: intent.id })
      .eq("id", order.order_id)
      .eq("payment_status", "unpaid");
    if (refErr) console.error("[checkout] storing PaymentIntent id failed", refErr);

    return sendJson(res, 200, {
      ok: true,
      orderId: order.order_id,
      amountDueCents: order.amount_due_cents,
      clientSecret: intent.client_secret,
      ...extra,
    });
  } catch (err) {
    // The order exists as pending_payment; a later retry can create the intent.
    console.error("[stripe] paymentIntents.create failed", err);
    return sendJson(res, 502, {
      ok: false,
      orderId: order.order_id,
      // Lets the checkout page still offer PayPal/Venmo for this order.
      amountDueCents: order.amount_due_cents,
      message:
        "Your order was created but we couldn’t start payment. It’s saved as pending; please try again shortly.",
      ...extra,
    });
  }
}
