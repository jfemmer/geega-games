import { useState, type FormEvent } from "react";
import { carrierLabel, trackingUrlFor } from "../../lib/tracking";
import { useNow } from "../../lib/useNow";
import {
  TRADE_CARRIERS,
  formatDeadline,
  printingLabel,
  timeLeft,
  tradeLabel,
  type CustomerTrade,
  type TradeTerms,
} from "../../lib/tradeCenter";
import { checkTrackingNumber, detectCarrier, scanStatusLabel } from "../../lib/tradeTracking";
import { TradeProofForm } from "./TradeProofForm";
import { TradeAskForTime } from "./TradeAskForTime";

// Once our cards are reserved: the shipping deadline, where to mail the
// cards and how to pack them, which cards to send (and which to leave out),
// and the tracking number. A tracking number alone doesn't count as
// shipped: the carrier's first scan does, and the page says which it's
// waiting for. Once the carrier has the package in time, our cards stay
// reserved however long it takes to arrive.

export function TradeShippingPanel({
  trade,
  terms,
  busy,
  onTracking,
  onProof,
  onAskForTime,
}: {
  trade: CustomerTrade;
  terms: TradeTerms | null;
  busy: string | null;
  onTracking: (carrier: string, trackingNumber: string) => Promise<boolean>;
  onProof: (note: string, files: File[]) => Promise<boolean>;
  onAskForTime: (note: string) => Promise<boolean>;
}) {
  const status = trade.status;
  const s = trade.shipment;
  const [editing, setEditing] = useState(status === "awaiting_shipment");
  const [carrier, setCarrier] = useState<string>(s.carrier ?? "USPS");
  const [number, setNumber] = useState(s.tracking ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const label = tradeLabel(trade.tradeNumber);
  const approved = trade.offered.filter((c) => c.reviewStatus === "approved" && (c.approvedQuantity ?? 0) > 0);
  const leaveOut = trade.offered.filter((c) => c.reviewStatus === "rejected");
  const trackingUrl = trackingUrlFor(s.carrier, s.tracking);
  const now = useNow();
  const shipBy = trade.shipBy ? Date.parse(trade.shipBy) : null;
  const pastDeadline = shipBy !== null && now > shipBy;
  const guess = number.trim() ? detectCarrier(number) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const check = checkTrackingNumber(carrier, number);
    if (!check.ok) {
      setProblem(check.message);
      if (check.suggestion) setCarrier(check.suggestion);
      return;
    }
    setProblem(null);
    if (await onTracking(check.carrier, check.tracking)) setEditing(false);
  }

  const heading =
    status === "in_transit" ? "Shipment verified" : status === "tracking_submitted" ? "Waiting for the carrier's first scan" : "Ship your cards";

  return (
    <section className="gg-tc-panel" aria-labelledby="gg-tc-ship-title">
      <h2 id="gg-tc-ship-title">{heading}</h2>

      {status !== "in_transit" && trade.shipBy && (
        <p className={pastDeadline ? "gg-tc-deadline gg-tc-deadline--past" : "gg-tc-deadline"}>
          {pastDeadline ? (
            <>
              Your shipping deadline was <strong>{formatDeadline(trade.shipBy)}</strong>.{" "}
              {status === "tracking_submitted"
                ? "We're still checking for the carrier's scan. If you shipped in time, send us proof below."
                : "If you've already shipped, add the tracking number now."}
            </>
          ) : (
            <>
              Ship by <strong>{formatDeadline(trade.shipBy)}</strong> ({timeLeft(shipBy as number, now)} left
              {trade.shipDays ? `; ${trade.shipDays} days, Sundays don't count` : ""}). The carrier has to scan your package by then: a label
              on its own doesn&rsquo;t count.
            </>
          )}
        </p>
      )}

      {status === "in_transit" && (
        <p className="gg-tc-verified">
          The carrier accepted your package{s.acceptedAt ? ` on ${formatDeadline(s.acceptedAt)}` : ""}, in time. Our cards stay reserved for
          you while it travels, however long the carrier takes.
        </p>
      )}

      {status === "awaiting_shipment" && (
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
                ? "We cover shipping your cards to us. Message us before you ship and we'll arrange it."
                : "You pay to ship your cards to us. Please use a tracked service."}
            </p>
          </div>
        </div>
      )}

      {trade.approvalConditions && status === "awaiting_shipment" && (
        <p className="gg-tc-note">
          <strong>Approved on this condition:</strong> {trade.approvalConditions}
        </p>
      )}

      {status === "awaiting_shipment" && (
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

      {s.tracking && !editing && (
        <div className="gg-tc-tracking">
          <p>
            {carrierLabel(s.carrier)} tracking{" "}
            {trackingUrl ? (
              <a href={trackingUrl} target="_blank" rel="noopener noreferrer">
                {s.tracking}
              </a>
            ) : (
              <strong>{s.tracking}</strong>
            )}
            {status === "tracking_submitted" && (
              <>
                {" "}
                <button type="button" className="gg-linkbtn" onClick={() => setEditing(true)}>
                  Fix the tracking number
                </button>
              </>
            )}
          </p>
          {status === "tracking_submitted" && (
            <p className="gg-tc-line__meta">
              {s.autoTracked
                ? `We check with the carrier regularly. Carrier status: ${scanStatusLabel(s.carrierStatus)}.`
                : "We'll confirm the carrier's acceptance scan ourselves and email you."}
            </p>
          )}
          {s.scans.length > 0 && (
            <details className="gg-tc-scans">
              <summary>Carrier history ({s.scans.length})</summary>
              <ol>
                {[...s.scans].reverse().map((scan, i) => (
                  <li key={`${scan.at}-${i}`}>
                    <span className="gg-tc-scans__when">{scan.at ? formatDeadline(scan.at) : ""}</span>
                    <span>
                      {scan.message ?? scanStatusLabel(scan.status)}
                      {scan.location ? <span className="gg-tc-line__meta"> · {scan.location}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}

      {editing && (status === "awaiting_shipment" || status === "tracking_submitted") && (
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
          <button type="submit" className="gg-btn" disabled={busy === "tracking" || !number.trim()}>
            {busy === "tracking" ? "Saving…" : s.tracking ? "Update tracking" : "Add tracking number"}
          </button>
          {s.tracking && (
            <button type="button" className="gg-linkbtn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          )}
          {guess && guess !== carrier && carrier !== "Other" && !problem && (
            <p className="gg-tc-line__meta gg-tc-trackform__hint">That looks like a {guess} number.</p>
          )}
          {problem && (
            <p className="gg-alert gg-alert-error" role="alert">
              {problem}
            </p>
          )}
        </form>
      )}

      {(status === "awaiting_shipment" || status === "tracking_submitted") && (
        <>
          <TradeProofForm trade={trade} busy={busy === "proof"} onSend={onProof} />
          {!pastDeadline && <TradeAskForTime what="ship" busy={busy === "ask"} onAsk={onAskForTime} />}
        </>
      )}
    </section>
  );
}
