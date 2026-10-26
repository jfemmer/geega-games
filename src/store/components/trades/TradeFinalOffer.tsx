import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../../../supabase";
import { formatCents } from "../../lib/money";
import { UsStateSelect } from "../UsStateSelect";
import { shippingLabel } from "../../lib/tradeShipping";
import {
  CONDITION_NAMES,
  TRADE_LIMITS,
  offerChanges,
  printingLabel,
  tradeComparison,
  tradeShippingTerms,
  type CustomerTrade,
  type TradeShipToInput,
} from "../../lib/tradeCenter";

// The final offer, after inspection: what we estimated before they shipped
// and what we're offering now, card by card with the reason for every
// change, and what that does to the money (trade credit covers our cards;
// shipping them is paid by card); then the customer's answer.
// Accepting asks where to ship our cards (a saved address or a new one);
// asking for an adjustment is a message to staff; declining shows the
// return policy first and never costs the deposit. Nothing is final until
// they accept, and there's no deadline to answer.

interface SavedAddress {
  id: string;
  label: string | null;
  recipient: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  is_default: boolean;
}

type Mode = "accept" | "adjust" | "decline" | null;

export function TradeFinalOffer({
  trade,
  busy,
  onAccept,
  onAdjust,
  onDecline,
}: {
  trade: CustomerTrade;
  busy: boolean;
  onAccept: (shipTo: { addressId: string } | { address: TradeShipToInput }) => Promise<boolean>;
  onAdjust: (message: string) => Promise<boolean>;
  onDecline: (reason: string | null) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const cards = trade.offered.filter((c) => c.reviewStatus === "approved" || c.inspected);
  const cash = trade.excessHandling === "cash" && trade.cashPayoutCents ? trade.cashPayoutCents : null;
  const changes = offerChanges(trade.offered);
  const changeById = new Map(changes.map((c) => [c.cardId, c]));
  const approvedValue = trade.approvedValueCents ?? 0;
  const finalValue = trade.finalValueCents ?? 0;
  const diff = finalValue - approvedValue;
  const money = {
    wantedCents: trade.wantedTotalCents,
    ratePercent: trade.creditRatePercent,
    feeCents: trade.processingFeeCents,
    shippingCents: trade.shippingCents ?? undefined,
    shipping: tradeShippingTerms(trade),
  };
  const before = tradeComparison({ ...money, offeredValueCents: approvedValue });
  const after = tradeComparison({ ...money, offeredValueCents: finalValue });
  const bottom = (c: typeof before) =>
    c.cashDueCents > 0 ? `${formatCents(c.cashDueCents)} to pay by card` : `${formatCents(c.excessCents)} credit left over`;
  // Still held (normally it's refunded once the carrier accepts the package):
  // declining refunds it too.
  const depositBack = trade.deposit.status === "paid" || trade.deposit.status === "forfeiture_review";

  return (
    <section className="gg-tc-panel" aria-labelledby="gg-tc-final-title">
      <h2 id="gg-tc-final-title">{changes.length > 0 ? "Your revised offer" : "Your final offer"}</h2>
      <p>
        {changes.length > 0
          ? "We inspected your cards and a few things changed from what we approved before you shipped. Each change and its reason is below."
          : "We inspected your cards and everything matched what we approved."}
      </p>
      <dl className="gg-tc-compare">
        <div>
          <dt>Estimated before you shipped</dt>
          <dd>{formatCents(approvedValue)}</dd>
        </div>
        <div>
          <dt>Final value after inspection</dt>
          <dd>{formatCents(finalValue)}</dd>
        </div>
        {diff !== 0 && (
          <div className={diff < 0 ? "gg-tc-compare__down" : "gg-tc-compare__up"}>
            <dt>Difference</dt>
            <dd>
              {diff < 0 ? "−" : "+"}
              {formatCents(Math.abs(diff))}
            </dd>
          </div>
        )}
        <div>
          <dt>Trade credit</dt>
          <dd>
            {formatCents(trade.finalCreditCents ?? after.creditCents)}
            {diff !== 0 && <span className="gg-tc-facts__sub">was {formatCents(before.creditCents)}</span>}
          </dd>
        </div>
        <div>
          <dt>Shipping our cards to you</dt>
          <dd>
            {shippingLabel(after.shippingCents, after.wantedCents)}
            <span className="gg-tc-facts__sub">{after.shippingCents > 0 ? "Paid by card, not out of your credit" : "Tracked, on us"}</span>
          </dd>
        </div>
        <div className="gg-tc-compare__total">
          <dt>You&rsquo;d pay by card</dt>
          <dd>
            {formatCents(after.cashDueCents)}
            <span className="gg-tc-facts__sub">
              {after.cardBalanceCents > 0
                ? `${formatCents(after.cardBalanceCents)} for our cards + ${shippingLabel(after.shippingCents, after.wantedCents).toLowerCase()} shipping`
                : after.shippingCents > 0
                  ? "Shipping only: your credit covers our cards"
                  : "Your credit covers everything"}
            </span>
            {diff !== 0 && <span className="gg-tc-facts__sub">before: {bottom(before)}</span>}
          </dd>
        </div>
        {after.excessCents > 0 && (
          <div className="gg-tc-compare__up">
            <dt>Credit left over</dt>
            <dd>
              {formatCents(after.excessCents)}
              <span className="gg-tc-facts__sub">{cash !== null ? `Paid to you as ${formatCents(cash)} cash` : "Kept as store credit"}</span>
            </dd>
          </div>
        )}
      </dl>
      <div className="gg-tc-table-wrap">
        <table className="gg-tc-table gg-tc-table--stack">
          <thead>
            <tr>
              <th scope="col">Card</th>
              <th scope="col">Approved</th>
              <th scope="col">Final</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => {
              const finalQty = c.inspected ? (c.finalQuantity ?? 0) : 0;
              const change = changeById.get(c.id);
              return (
                <tr key={c.id} className={change ? "gg-tc-table__changed" : undefined}>
                  <td>
                    <span className="gg-tc-line__name">{c.cardName}</span>
                    <span className="gg-tc-line__meta">
                      {printingLabel(c)} · {CONDITION_NAMES[c.verifiedCondition ?? c.reportedCondition]}
                    </span>
                    {change && change.reasons.length > 0 && (
                      <ul className="gg-tc-reasons">
                        {change.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td data-label="Approved">
                    {c.approvedQuantity ?? 0} × {formatCents(c.approvedUnitCents ?? 0)}
                  </td>
                  <td data-label="Final">
                    <strong>{finalQty > 0 ? `${finalQty} × ${formatCents(c.finalUnitCents ?? 0)}` : "Not taken"}</strong>
                  </td>
                  <td data-label="Change">
                    {change && change.differenceCents !== 0
                      ? `${change.differenceCents < 0 ? "−" : "+"}${formatCents(Math.abs(change.differenceCents))}`
                      : "None"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="gg-tc-nopenalty">
        You&rsquo;re free to decline with no penalty, whatever the reason: we&rsquo;ll mail your cards back
        {depositBack ? ", and your deposit is refunded in full either way" : ""}.
      </p>
      {cash !== null && (
        <p className="gg-tc-note">
          Instead of store credit for what&rsquo;s left over after your order, we&rsquo;ll pay you <strong>{formatCents(cash)}</strong> in
          cash.
        </p>
      )}

      <div className="gg-tc-answer">
        <button type="button" className="gg-btn" onClick={() => setMode("accept")} disabled={busy}>
          Accept the offer
        </button>
        <button type="button" className="gg-btn gg-btn-ghost" onClick={() => setMode("adjust")} disabled={busy}>
          Ask for an adjustment
        </button>
        <button type="button" className="gg-linkbtn gg-tc-answer__decline" onClick={() => setMode("decline")} disabled={busy}>
          Decline and get my cards back
        </button>
      </div>

      {mode === "accept" && <AcceptForm busy={busy} dueCents={after.cashDueCents} onAccept={onAccept} onCancel={() => setMode(null)} />}
      {mode === "adjust" && (
        <AdjustForm
          busy={busy}
          onAdjust={async (message) => {
            const ok = await onAdjust(message);
            if (ok) setMode(null);
            return ok;
          }}
          onCancel={() => setMode(null)}
        />
      )}
      {mode === "decline" && (
        <DeclineForm returnPolicy={trade.returnPolicy} busy={busy} onDecline={onDecline} onCancel={() => setMode(null)} />
      )}
    </section>
  );
}

function AcceptForm({
  busy,
  dueCents,
  onAccept,
  onCancel,
}: {
  busy: boolean;
  /** Paid by card once they accept: our cards the credit doesn't cover, and shipping. */
  dueCents: number;
  onAccept: (shipTo: { addressId: string } | { address: TradeShipToInput }) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [saved, setSaved] = useState<SavedAddress[] | null>(null);
  const [choice, setChoice] = useState<string>("new");
  const [address, setAddress] = useState<TradeShipToInput>({ name: "", line1: "", line2: "", city: "", state: "", postalCode: "" });

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("addresses")
      .select("id, label, recipient, line1, line2, city, state, postal_code, is_default")
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (cancelled) return;
        const rows = (data ?? []) as SavedAddress[];
        setSaved(rows);
        if (rows.length > 0) setChoice(rows[0].id);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    void onAccept(choice === "new" ? { address } : { addressId: choice });
  }

  const set = (key: keyof TradeShipToInput) => (value: string) => setAddress((a) => ({ ...a, [key]: value }));

  return (
    <form className="gg-tc-subform" onSubmit={submit}>
      <h3>Where should we ship your new cards?</h3>
      {saved === null ? (
        <p className="gg-tc-line__meta">Loading your saved addresses…</p>
      ) : (
        <fieldset className="gg-tc-addresses">
          <legend className="visually-hidden">Shipping address</legend>
          {saved.map((a) => (
            <label key={a.id} className="gg-tc-addresses__option">
              <input type="radio" name="gg-tc-address" value={a.id} checked={choice === a.id} onChange={() => setChoice(a.id)} />
              <span>
                <strong>{a.label || a.recipient || "Saved address"}</strong>
                <span className="gg-tc-line__meta">
                  {a.line1}
                  {a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state} {a.postal_code}
                </span>
              </span>
            </label>
          ))}
          <label className="gg-tc-addresses__option">
            <input type="radio" name="gg-tc-address" value="new" checked={choice === "new"} onChange={() => setChoice("new")} />
            <span>
              <strong>{saved.length > 0 ? "A different address" : "Enter an address"}</strong>
            </span>
          </label>
        </fieldset>
      )}
      {choice === "new" && (
        <div className="gg-tc-addressfields">
          <label className="gg-field">
            <span>Name</span>
            <input value={address.name} onChange={(e) => set("name")(e.target.value)} autoComplete="name" />
          </label>
          <label className="gg-field">
            <span>Street address</span>
            <input value={address.line1} onChange={(e) => set("line1")(e.target.value)} autoComplete="address-line1" required />
          </label>
          <label className="gg-field">
            <span>Apartment, suite (optional)</span>
            <input value={address.line2 ?? ""} onChange={(e) => set("line2")(e.target.value)} autoComplete="address-line2" />
          </label>
          <div className="gg-tc-addressfields__row">
            <label className="gg-field">
              <span>City</span>
              <input value={address.city} onChange={(e) => set("city")(e.target.value)} autoComplete="address-level2" required />
            </label>
            <div className="gg-field">
              <label htmlFor="gg-tc-state">State</label>
              <UsStateSelect id="gg-tc-state" value={address.state} onChange={set("state")} />
            </div>
            <label className="gg-field">
              <span>ZIP code</span>
              <input value={address.postalCode} onChange={(e) => set("postalCode")(e.target.value)} autoComplete="postal-code" inputMode="numeric" required />
            </label>
          </div>
        </div>
      )}
      <p className="gg-tc-line__meta">
        {dueCents > 0
          ? `Next you'll pay ${formatCents(dueCents)} by card. Once it's paid, we pack and ship your new cards with tracking.`
          : "Your credit covers everything, so accepting finishes your trade and we pack and ship your new cards with tracking."}
      </p>
      <div className="gg-tc-pick__actions">
        <button type="submit" className="gg-btn" disabled={busy || saved === null}>
          {busy ? "Accepting…" : "Accept and finish my trade"}
        </button>
        <button type="button" className="gg-linkbtn" onClick={onCancel} disabled={busy}>
          Not yet
        </button>
      </div>
    </form>
  );
}

function AdjustForm({ busy, onAdjust, onCancel }: { busy: boolean; onAdjust: (message: string) => Promise<boolean>; onCancel: () => void }) {
  const [message, setMessage] = useState("");
  return (
    <form
      className="gg-tc-subform"
      onSubmit={(e) => {
        e.preventDefault();
        if (message.trim()) void onAdjust(message.trim());
      }}
    >
      <label className="gg-field">
        <span>What would you like us to look at again?</span>
        <textarea rows={4} maxLength={TRADE_LIMITS.maxMessage} value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <p className="gg-tc-line__meta">We&rsquo;ll take another look and reply here. Your offer stays open meanwhile.</p>
      <div className="gg-tc-pick__actions">
        <button type="submit" className="gg-btn" disabled={busy || !message.trim()}>
          {busy ? "Sending…" : "Send"}
        </button>
        <button type="button" className="gg-linkbtn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function DeclineForm({
  returnPolicy,
  busy,
  onDecline,
  onCancel,
}: {
  returnPolicy: string;
  busy: boolean;
  onDecline: (reason: string | null) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <form
      className="gg-tc-subform gg-tc-subform--warn"
      onSubmit={(e) => {
        e.preventDefault();
        void onDecline(reason.trim() || null);
      }}
    >
      <h3>Decline the offer?</h3>
      <p>There&rsquo;s no penalty for declining, and it never affects your deposit.</p>
      <p>{returnPolicy}</p>
      <label className="gg-field">
        <span>Anything you&rsquo;d like us to know (optional)</span>
        <textarea rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="gg-tc-pick__actions">
        <button type="submit" className="gg-btn gg-tc-btn-danger" disabled={busy}>
          {busy ? "Declining…" : "Decline and return my cards"}
        </button>
        <button type="button" className="gg-linkbtn" onClick={onCancel} disabled={busy}>
          Keep the offer open
        </button>
      </div>
    </form>
  );
}
