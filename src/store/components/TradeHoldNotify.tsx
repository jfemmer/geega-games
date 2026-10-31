import { useId, useState } from "react";
import { useAuth } from "../lib/AuthContext";
import { watchHeldCopy } from "../lib/tradeHolds";

/**
 * "Notify me if it's released" for one copy a trade is holding. A signed-in
 * shopper taps once (their account email is used); a guest enters an email.
 * Used on the card page, in the cart and at checkout.
 */
export default function TradeHoldNotify({
  inventoryItemId,
  cardName,
  onAvailable,
}: {
  inventoryItemId: string;
  cardName: string;
  /** Nothing is holding it any more (the page can reload what's for sale). */
  onAvailable?: () => void;
}) {
  const { user } = useAuth();
  const accountEmail = user?.email || null;
  const inputId = useId();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "watching" | "available" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setState("saving");
    setError(null);
    try {
      const result = await watchHeldCopy(inventoryItemId, accountEmail ?? email);
      setState(result.status);
      if (result.status === "available") onAvailable?.();
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }

  if (state === "watching") {
    return (
      <p className="gg-alert gg-alert-ok gg-tradehold__done" role="status">
        We&rsquo;ll email {accountEmail ?? "you"} if this {cardName} is released.
      </p>
    );
  }
  if (state === "available") {
    return (
      <p className="gg-alert gg-alert-ok gg-tradehold__done" role="status">
        Good news: this copy isn&rsquo;t held any more, so you can buy it now.
      </p>
    );
  }

  const saving = state === "saving";
  return (
    <form className="gg-notify-form gg-tradehold__notify" onSubmit={submit}>
      {accountEmail ? (
        <button className="gg-btn gg-btn-sm gg-btn-ghost" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Notify me if it’s released"}
        </button>
      ) : (
        <>
          <label htmlFor={inputId}>Notify me if it&rsquo;s released</label>
          <div className="gg-notify-form__row">
            <input
              id={inputId}
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={saving}
            />
            <button className="gg-btn gg-btn-sm" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Notify me"}
            </button>
          </div>
        </>
      )}
      {state === "error" && error && (
        <p className="gg-alert gg-alert-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
