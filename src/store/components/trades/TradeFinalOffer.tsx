import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../../../supabase";
import { formatCents } from "../../lib/money";
import { UsStateSelect } from "../UsStateSelect";
import {
  CONDITION_NAMES,
  TRADE_LIMITS,
  printingLabel,
  type CustomerTrade,
  type TradeShipToInput,
} from "../../lib/tradeCenter";

// The final offer, after inspection: card by card what was approved and what
// we're taking now, with the reason for any change; then the customer's
// answer. Accepting asks where to ship our cards (a saved address or a new
// one); asking for an adjustment is a message to staff; declining shows the
// return policy first. Nothing is final until they accept, and there's no
// deadline to answer.

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

  return (
    <section className="gg-tc-panel" aria-labelledby="gg-tc-final-title">
      <h2 id="gg-tc-final-title">Your final offer</h2>
      <p>We inspected your cards. Here&rsquo;s what we&rsquo;re taking and what each is worth.</p>
      <div className="gg-tc-table-wrap">
        <table className="gg-tc-table">
          <thead>
            <tr>
              <th scope="col">Card</th>
              <th scope="col">Approved</th>
              <th scope="col">Final</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => {
              const finalQty = c.inspected ? (c.finalQuantity ?? 0) : 0;
              const changed =
                finalQty !== (c.approvedQuantity ?? 0) || (finalQty > 0 && c.finalUnitCents !== c.approvedUnitCents);
              return (
                <tr key={c.id} className={changed ? "gg-tc-table__changed" : undefined}>
                  <td>
                    <span className="gg-tc-line__name">{c.cardName}</span>
                    <span className="gg-tc-line__meta">
                      {printingLabel(c)} · {CONDITION_NAMES[c.verifiedCondition ?? c.reportedCondition]}
                    </span>
                    {c.inspectionNote && <span className="gg-tc-review__note">{c.inspectionNote}</span>}
                    {c.flags.length > 0 && <span className="gg-tc-flag gg-tc-flag--bad">{c.flags.join(", ")}</span>}
                  </td>
                  <td>
                    {c.approvedQuantity ?? 0} × {formatCents(c.approvedUnitCents ?? 0)}
                  </td>
                  <td>
                    <strong>{finalQty > 0 ? `${finalQty} × ${formatCents(c.finalUnitCents ?? 0)}` : "Not taken"}</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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

      {mode === "accept" && <AcceptForm busy={busy} onAccept={onAccept} onCancel={() => setMode(null)} />}
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
  onAccept,
  onCancel,
}: {
  busy: boolean;
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
        Accepting finishes your trade. If your trade credit doesn&rsquo;t cover everything, you&rsquo;ll pay the rest by card next.
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
