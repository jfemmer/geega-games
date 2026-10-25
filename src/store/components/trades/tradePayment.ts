import { formatCents } from "../../lib/money";

// Helpers for the trade card payments (the refundable deposit and the rest
// of a trade): the button label, and where Stripe sends the customer back to
// after a bank check.

/** "Pay $20.00". */
export function payLabelFor(cents: number, what = ""): string {
  return `Pay ${formatCents(cents)}${what ? ` ${what}` : ""}`;
}

/** The current page with `pay=<kind>` added, for Stripe to come back to after a bank check. */
export function returnUrlFor(kind: "deposit" | "balance"): string {
  const url = new URL(window.location.href);
  url.searchParams.set("pay", kind);
  url.searchParams.delete("payment_intent");
  url.searchParams.delete("payment_intent_client_secret");
  url.searchParams.delete("redirect_status");
  return url.toString();
}
