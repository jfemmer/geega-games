import { useState, type FormEvent } from "react";
import { carrierLabel, trackingUrlFor } from "../../lib/tracking";
import { useNow } from "../../lib/useNow";
import {
  TRADE_CARRIERS,
  cleanTrackingNumber,
  formatDeadline,
  printingLabel,
  timeLeft,
  tradeLabel,
  type CustomerTrade,
  type TradeTerms,
} from "../../lib/tradeCenter";

// After preliminary approval: where to mail the cards, how to pack them, the
// ship-by date and the trade ID, which cards to send (and which to leave
// out), and the tracking number. Once it's in, the package is on its way and
// nothing about the trade expires.

export function TradeShippingPanel({
  trade,
  terms,
  busy,
  onTracking,
}: {
  trade: CustomerTrade;
  terms: TradeTerms | null;
  busy: boolean;
  onTracking: (carrier: string, trackingNumber: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(trade.status === "awaiting_shipment");
  const [carrier, setCarrier] = useState<string>(trade.inboundCarrier ?? "USPS");
  const [number, setNumber] = useState(trade.inboundTracking ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const label = tradeLabel(trade.tradeNumber);
  const approved = trade.offered.filter((c) => c.reviewStatus === "approved" && (c.approvedQuantity ?? 0) > 0);
  const leaveOut = trade.offered.filter((c) => c.reviewStatus === "rejected");
  const trackingUrl = trackingUrlFor(trade.inboundCarrier, trade.inboundTracking);
  const now = useNow();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!cleanTrackingNumber(number)) {
      setProblem("That tracking number doesn't look right. Check it and try again.");
      return;
    }
    setProblem(null);
    if (await onTracking(carrier, number)) setEditing(false);
  }

  return (
    <section className="gg-tc-panel" aria-labelledby="gg-tc-ship-title">
      <h2 id="gg-tc-ship-title">{trade.status === "in_transit" ? "Your package is on its way" : "Mail your cards"}</h2>

      {trade.status === "awaiting_shipment" && trade.shipBy && (
        <p className="gg-tc-deadline">
          Mail them by <strong>{formatDeadline(trade.shipBy)}</strong> ({timeLeft(Date.parse(trade.shipBy), now)} left), then add the
          tracking number below.
        </p>
      )}

      {trade.status === "awaiting_shipment" && (
        <div className="gg-tc-ship">
          {trade.mailTo ? (
            <div className="gg-tc-address">
              <span className="gg-tc-address__label">Mail to</span>
              <address>
                {trade.mailTo.name && (
                  <>
                    {trade.mailTo.name}
                    <br />
                  </>
                )}
                {trade.mailTo.line1}
                <br />
                {trade.mailTo.line2 && (
                  <>
                    {trade.mailTo.line2}
                    <br />
                  </>
                )}
                {trade.mailTo.city}, {trade.mailTo.state} {trade.mailTo.postalCode}
              </address>
            </div>
          ) : (
            <p className="gg-alert gg-alert-warn">We&rsquo;ll email you the address to mail your cards to.</p>
          )}
          <div className="gg-tc-ship__steps">
            <p>
              <strong>Put your trade ID, {label}, on a slip of paper inside.</strong>
            </p>
            {trade.packingInstructions && <p>{trade.packingInstructions}</p>}
            <p>
              {terms?.shippingPaidBy === "store"
                ? "We cover shipping your cards to us. Reply to your approval email before you ship and we'll arrange it."
                : "You pay to ship your cards to us. Please use a tracked service."}
            </p>
          </div>
        </div>
      )}

      {trade.approvalConditions && (
        <p className="gg-tc-note">
          <strong>Approved on this condition:</strong> {trade.approvalConditions}
        </p>
      )}

      {trade.status === "awaiting_shipment" && (
        <div className="gg-tc-sendlist">
          <h3>What to send</h3>
          <ul>
            {approved.map((c) => (
              <li key={c.id}>
                {c.approvedQuantity} × {c.cardName} <span className="gg-tc-line__meta">{printingLabel(c)}</span>
              </li>
            ))}
          </ul>
          {leaveOut.length > 0 && (
            <>
              <h3>Leave these out</h3>
              <ul className="gg-tc-sendlist__out">
                {leaveOut.map((c) => (
                  <li key={c.id}>
                    {c.cardName} <span className="gg-tc-line__meta">{c.reviewNote ?? "We can't take this one."}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {trade.status === "in_transit" && !editing && (
        <p className="gg-tc-tracking">
          {carrierLabel(trade.inboundCarrier)} tracking{" "}
          {trackingUrl ? (
            <a href={trackingUrl} target="_blank" rel="noopener noreferrer">
              {trade.inboundTracking}
            </a>
          ) : (
            <strong>{trade.inboundTracking}</strong>
          )}
          .{" "}
          <button type="button" className="gg-linkbtn" onClick={() => setEditing(true)}>
            Fix the tracking number
          </button>
        </p>
      )}

      {editing && (
        <form className="gg-tc-trackform" onSubmit={(e) => void submit(e)}>
          <label className="gg-field">
            <span>Carrier</span>
            <select value={carrier} onChange={(e) => setCarrier(e.target.value)}>
              {TRADE_CARRIERS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="gg-field gg-tc-trackform__number">
            <span>Tracking number</span>
            <input value={number} onChange={(e) => setNumber(e.target.value)} autoComplete="off" inputMode="text" spellCheck={false} />
          </label>
          <button type="submit" className="gg-btn" disabled={busy || !number.trim()}>
            {busy ? "Saving…" : trade.status === "in_transit" ? "Update tracking" : "Add tracking number"}
          </button>
          {trade.status === "in_transit" && (
            <button type="button" className="gg-linkbtn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          )}
          {problem && (
            <p className="gg-alert gg-alert-error" role="alert">
              {problem}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
