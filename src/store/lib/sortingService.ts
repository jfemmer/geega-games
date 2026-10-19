// Collection sorting: the shipping policy's wording, the request and quote
// statuses, and the arithmetic, shared by the storefront (service page,
// calculator, request form, quote page, account), the API (requests, quotes,
// payments, emails) and the admin. The database holds the same rules
// (supabase/migrations/20261017230000_collection_sorting_service.sql): a
// quote's total is always the sum of its items, and a sent quote never
// changes.
//
// Pure module (no browser or Node APIs, no imports): safe to import from api/.

export const SORTING_PATH = "/collection-sorting";
export const SORTING_QUOTE_PATH = "/collection-sorting/quote";
export const SORTING_ACCOUNT_PATH = "/account/sorting";

/* ------------------------------------------------------------------ *
 * The shipping policy (owner, 2026-10-17). Customer-facing wording lives
 * here once, so the page, the form, the quote and the emails can't drift.
 * ------------------------------------------------------------------ */

/** The service page's "Shipping Information" notice, word for word. */
export const SORTING_SHIPPING_NOTICE =
  "Shipping your collection to us? Customers are responsible for all packaging supplies and shipping costs to Geega Games. Return shipping and necessary packaging costs will be calculated and included in your final quoted price, so you'll know the complete cost before approving your service.";

/**
 * The request form's required checkbox for shipped collections, word for
 * word. The exact text is stored with the request when it's ticked.
 */
export const SORTING_SHIPPING_TERMS =
  "I understand that I am responsible for shipping my cards to Geega Games, including packing supplies and shipping charges. I also understand that return shipping and packaging costs will be included in my final service quote.";

/** What a customer shipping their collection to us takes care of. */
export const SORTING_INBOUND_RESPONSIBILITIES: readonly string[] = [
  "Buying all the packing and shipping supplies you need.",
  "Packing your cards properly so they aren't damaged on the way.",
  "Paying the full cost of shipping your collection to Geega Games.",
  "Arranging and paying for shipping insurance, if you want it.",
];

export const SORTING_NO_INBOUND_LABELS =
  "Geega Games doesn't provide free inbound shipping labels or packing materials.";

/** How return shipping works, in the order customers ask about it. */
export const SORTING_RETURN_POLICY: readonly string[] = [
  "Return shipping isn't included in our per-1,000-card sorting rates.",
  "We work out return shipping from your collection's size, weight, packaging needs and destination.",
  "Any return packaging or shipping supplies your collection needs are included in your final quote.",
  "Your quote lists the sorting service, return shipping, return packaging and the total price.",
  "Return shipping and packaging are part of the total you approve and pay.",
  "Once you've approved and paid that total, we won't charge you separately for return shipping unless you agree to a change.",
];

/** Under the rates: what a per-1,000-card rate covers. */
export const SORTING_RATES_NOTE =
  "Rates cover sorting only. Return shipping and packaging for shipped collections aren't included — they're added to your final quote.";

/* ------------------------------------------------------------------ *
 * Requests
 * ------------------------------------------------------------------ */

export type SortingDeliveryMethod = "drop_off" | "ship";

export const SORTING_DELIVERY_METHODS: readonly SortingDeliveryMethod[] = ["drop_off", "ship"];

export const SORTING_DELIVERY_LABELS: Record<SortingDeliveryMethod, string> = {
  drop_off: "Drop off locally",
  ship: "Ship it to us",
};

export type SortingRequestStatus =
  | "new"
  | "awaiting_cards"
  | "received"
  | "quoted"
  | "approved"
  | "sorting"
  | "ready"
  | "returned"
  | "cancelled";

export const SORTING_STATUSES: readonly SortingRequestStatus[] = [
  "new",
  "awaiting_cards",
  "received",
  "quoted",
  "approved",
  "sorting",
  "ready",
  "returned",
  "cancelled",
];

/**
 * The statuses staff set by hand. "quoted" and "approved" only ever come
 * from sending a quote and the customer approving it.
 */
export const SORTING_MANUAL_STATUSES: readonly SortingRequestStatus[] = [
  "new",
  "awaiting_cards",
  "received",
  "sorting",
  "ready",
  "returned",
  "cancelled",
];

export function isSortingStatus(value: unknown): value is SortingRequestStatus {
  return typeof value === "string" && (SORTING_STATUSES as readonly string[]).includes(value);
}

/** How a status reads to the customer: some depend on whether the cards came by mail. */
export function sortingStatusLabel(status: SortingRequestStatus, delivery: SortingDeliveryMethod): string {
  const shipped = delivery === "ship";
  switch (status) {
    case "new":
      return "Request received";
    case "awaiting_cards":
      return shipped ? "Waiting for your cards to arrive" : "Waiting for your drop-off";
    case "received":
      return "Cards received";
    case "quoted":
      return "Quote ready for your approval";
    case "approved":
      return "Quote approved";
    case "sorting":
      return "Sorting in progress";
    case "ready":
      return shipped ? "Sorted — getting ready to ship back" : "Ready for pickup";
    case "returned":
      return shipped ? "Shipped back" : "Picked up";
    case "cancelled":
      return "Cancelled";
  }
}

/** Short staff-facing names (the admin list and its filters). */
export const SORTING_STATUS_ADMIN_LABELS: Record<SortingRequestStatus, string> = {
  new: "New",
  awaiting_cards: "Awaiting cards",
  received: "Cards received",
  quoted: "Quote sent",
  approved: "Quote approved",
  sorting: "Sorting",
  ready: "Ready",
  returned: "Returned",
  cancelled: "Cancelled",
};

/* ------------------------------------------------------------------ *
 * Quotes
 * ------------------------------------------------------------------ */

export type SortingQuoteStatus = "draft" | "sent" | "accepted" | "declined" | "superseded";

export interface SortingOtherCharge {
  label: string;
  amountCents: number;
}

export interface SortingQuoteItems {
  sortingServiceCents: number;
  returnShippingCents: number;
  returnPackagingCents: number;
  otherCharges: SortingOtherCharge[];
}

export const SORTING_LIMITS = {
  /** Cards a customer can estimate on the request form. */
  maxEstimatedCards: 1_000_000,
  /** Cards staff can count on a quote. */
  maxCountedCards: 10_000_000,
  /** Any one quote item, in cents ($100,000). */
  maxChargeCents: 10_000_000,
  maxOtherCharges: 5,
  maxOtherChargeLabel: 80,
  maxCustomerNotes: 2000,
  maxNoteToCustomer: 1000,
  maxDeclineReason: 1000,
} as const;

/**
 * The sorting estimate for `cards` cards at a per-1,000-card rate, in cents,
 * pro-rated and rounded to the cent: 2,500 cards at $20.00 per 1,000 is
 * $50.00. Never includes shipping.
 */
export function sortingEstimateCents(ratePerThousandCents: number, cards: number): number {
  if (!Number.isFinite(ratePerThousandCents) || !Number.isFinite(cards)) return 0;
  if (ratePerThousandCents <= 0 || cards <= 0) return 0;
  return Math.round((ratePerThousandCents * cards) / 1000);
}

/** A quote's total: always the sum of its items (the database computes it the same way). */
export function sortingQuoteTotalCents(items: SortingQuoteItems): number {
  return (
    items.sortingServiceCents +
    items.returnShippingCents +
    items.returnPackagingCents +
    items.otherCharges.reduce((sum, charge) => sum + charge.amountCents, 0)
  );
}

/** "12,000", "12000" or " 12 000 " → 12000. Not a whole number of cards → null. */
export function parseCardCount(input: string): number | null {
  const digits = input.replace(/[\s,]/g, "");
  if (!/^\d{1,9}$/.test(digits)) return null;
  const n = Number.parseInt(digits, 10);
  return Number.isSafeInteger(n) ? n : null;
}

/** "12.50" or "$1,012.5" → 1250 / 101250. Blank → 0. Not a valid amount → null. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (cleaned === "") return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number.parseFloat(cleaned) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function isWholeCents(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= SORTING_LIMITS.maxChargeCents;
}

export type QuoteItemsCheck = { ok: true; items: SortingQuoteItems } | { ok: false; message: string };

/**
 * Checks quote items the way the database will (so staff get a clear message
 * before saving): whole cents from $0 to $100,000 each, and up to five other
 * charges, each with a short description. Trims the descriptions.
 */
export function checkQuoteItems(raw: unknown): QuoteItemsCheck {
  if (!raw || typeof raw !== "object") return { ok: false, message: "Enter the quote amounts." };
  const r = raw as Record<string, unknown>;
  const named: [keyof Omit<SortingQuoteItems, "otherCharges">, string][] = [
    ["sortingServiceCents", "The sorting service cost"],
    ["returnShippingCents", "The return shipping charge"],
    ["returnPackagingCents", "The return packaging cost"],
  ];
  for (const [key, label] of named) {
    if (!isWholeCents(r[key])) return { ok: false, message: `${label} must be between $0 and $100,000.` };
  }
  const others = r.otherCharges ?? [];
  if (!Array.isArray(others) || others.length > SORTING_LIMITS.maxOtherCharges) {
    return { ok: false, message: `Add at most ${SORTING_LIMITS.maxOtherCharges} other charges.` };
  }
  const otherCharges: SortingOtherCharge[] = [];
  for (const item of others) {
    const o = (item ?? {}) as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.trim() : "";
    if (!label || label.length > SORTING_LIMITS.maxOtherChargeLabel) {
      return { ok: false, message: "Give each other charge a short description (up to 80 characters)." };
    }
    if (!isWholeCents(o.amountCents)) {
      return { ok: false, message: `"${label}" must be between $0 and $100,000.` };
    }
    otherCharges.push({ label, amountCents: o.amountCents });
  }
  return {
    ok: true,
    items: {
      sortingServiceCents: r.sortingServiceCents as number,
      returnShippingCents: r.returnShippingCents as number,
      returnPackagingCents: r.returnPackagingCents as number,
      otherCharges,
    },
  };
}

export interface SortingQuoteLine {
  key: string;
  label: string;
  amountCents: number;
}

/**
 * A quote as the customer reads it, line by line. Shipped collections always
 * show return shipping and return packaging (even at $0), so the customer
 * can see they're included; drop-offs show them only if charged.
 */
export function sortingQuoteLines(
  quote: SortingQuoteItems & { countedCards?: number | null },
  delivery: SortingDeliveryMethod,
): SortingQuoteLine[] {
  const shipped = delivery === "ship";
  const counted =
    quote.countedCards != null && quote.countedCards > 0
      ? ` (${quote.countedCards.toLocaleString("en-US")} cards)`
      : "";
  const lines: SortingQuoteLine[] = [
    { key: "sorting", label: `Sorting service${counted}`, amountCents: quote.sortingServiceCents },
  ];
  if (shipped || quote.returnShippingCents > 0) {
    lines.push({ key: "return_shipping", label: "Return shipping", amountCents: quote.returnShippingCents });
  }
  if (shipped || quote.returnPackagingCents > 0) {
    lines.push({
      key: "return_packaging",
      label: "Return packaging & supplies",
      amountCents: quote.returnPackagingCents,
    });
  }
  quote.otherCharges.forEach((charge, i) => {
    lines.push({ key: `other_${i}`, label: charge.label, amountCents: charge.amountCents });
  });
  return lines;
}

/** Where a customer's quote stands, in their words. */
export const SORTING_QUOTE_STATUS_LABELS: Record<SortingQuoteStatus, string> = {
  draft: "Draft",
  sent: "Waiting for your approval",
  accepted: "Approved",
  declined: "Declined",
  superseded: "Replaced by a newer quote",
};

/* ------------------------------------------------------------------ *
 * Payments
 * ------------------------------------------------------------------ */

export type SortingPaymentMethod = "card_online" | "in_store_card" | "cash" | "other";

/** Methods staff record by hand (card_online only comes from Stripe). */
export const SORTING_MANUAL_PAYMENT_METHODS: readonly SortingPaymentMethod[] = ["in_store_card", "cash", "other"];

export const SORTING_PAYMENT_METHOD_LABELS: Record<SortingPaymentMethod, string> = {
  card_online: "Card (online)",
  in_store_card: "Card (in person)",
  cash: "Cash",
  other: "Other",
};

/** What's still owed on the approved total (never negative). */
export function sortingBalanceDueCents(acceptedTotalCents: number | null, amountPaidCents: number): number {
  if (acceptedTotalCents == null) return 0;
  return Math.max(0, acceptedTotalCents - amountPaidCents);
}

/** "$20.00 per 1,000 cards" — dollars and cents, US style. */
export function formatRatePerThousand(cents: number): string {
  return `${formatUsdCents(cents)} per 1,000 cards`;
}

/** $1,234.50 — the one money format for this feature's shared text (emails and the API). */
export function formatUsdCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}
