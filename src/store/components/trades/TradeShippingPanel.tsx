import { useState, type FormEvent } from "react";
import { carrierLabel, trackingUrlFor } from "../../lib/tracking";
import { useNow } from "../../lib/useNow";
import type { TradeTrackingInput } from "../../lib/tradeCenterApi";
import {
  TRADE_CARRIERS,
  formatDeadline,
  printingLabel,
  timeLeft,
  tradeLabel,
  type CustomerTrade,
  type TradeTerms,
} from "../../lib/tradeCenter";
import { storeDateKey } from "../../lib/tradeDeadlines";
import { checkTrackingNumber, detectCarrier, normalizeTracking, scanStatusLabel } from "../../lib/tradeTracking";
import {
  PACKAGING_CONFIRMATION,
  PROTECT_YOUR_CARDS,
  SHIPPING_GUIDE,
  SHIPPING_GUIDE_REMINDER,
  SHIPPING_GUIDE_TITLE,
} from "../../lib/tradeShipping";
import { TradeProofForm } from "./TradeProofForm";
import { TradeAskForTime } from "./TradeAskForTime";
import { ShippingIllustration } from "./ShippingIllustration";

// Once our cards are reserved: the shipping deadline, the notice on
// protecting cards in the mail (always shown while they pack), where to mail
// the cards, the first-time shipper guide (collapsible, with a one-line
// reminder that stays visible), which cards to send, and the tracking number
// with an optional ship date. A new tracking number (first or replacement
// shipment) needs their packaging confirmation, which the server checks
// too; fixing the carrier or adding a date doesn't. A tracking number alone
// doesn't count as shipped: the carrier's first scan does, and the page says
// which it's waiting for. Once the carrier has the package in time, our cards
// stay reserved however long it takes to arrive.

/** "Oct 26" for a YYYY-MM-DD ship date. */
function shipDateLabel(key: string): string {
  const noon = Date.parse(`${key}T12:00:00Z`);
  if (!Number.isFinite(noon)) return key;
  return new Date(noon).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

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
  onTracking: (shipment: TradeTrackingInput) => Promise<boolean>;
  onProof: (note: string, files: File[]) => Promise<boolean>;
  onAskForTime: (note: string) => Promise<boolean>;
}) {
  const status = trade.status;
  const s = trade.shipment;
  const [editing, setEditing] = useState(status === "awaiting_shipment");
  const [carrier, setCarrier] = useState<string>(s.carrier ?? "USPS");
  const [number, setNumber] = useState(s.tracking ?? "");
  const [shippedOn, setShippedOn] = useState(s.shippedOn ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const label = tradeLabel(trade.tradeNumber);
  const approved = trade.offered.filter((c) => c.reviewStatus === "approved" && (c.approvedQuantity ?? 0) > 0);
  const leaveOut = trade.offered.filter((c) => c.reviewStatus === "rejected");
  const trackingUrl = trackingUrlFor(s.carrier, s.tracking);
  const now = useNow();
  const shipBy = trade.shipBy ? Date.parse(trade.shipBy) : null;
  const pastDeadline = shipBy !== null && now > shipBy;
  const guess = number.trim() ? detectCarrier(number) : null;
  const canEdit = status === "awaiting_shipment" || status === "tracking_submitted";
  const formOpen = editing && canEdit;
  // A different number is a new (or replacement) shipment: it needs the packaging confirmation again.
  const newShipment = normalizeTracking(number) !== (s.tracking ?? "");
  const today = storeDateKey(now);
  const earliest = storeDateKey(Date.parse(trade.reservedAt ?? trade.createdAt));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const check = checkTrackingNumber(carrier, number);
    if (!check.ok) {
      setProblem(check.message);
      if (check.suggestion) setCarrier(check.suggestion);
      return;
    }
    if (shippedOn && (shippedOn < earliest || shippedOn > today)) {
      setProblem("The ship date has to be between the day your cards were reserved and today.");
      return;
    }
    if (check.tracking !== (s.tracking ?? "") && !confirmed) {
      setProblem("Tick the box to confirm your cards are packaged securely and shipped with tracking.");
      return;
    }
    setProblem(null);
    const ok = await onTracking({
      carrier: check.carrier,
      trackingNumber: check.tracking,
      packagingConfirmed: check.tracking !== (s.tracking ?? "") ? confirmed : false,
      shippedOn: shippedOn || null,
    });
    if (ok) {
      setEditing(false);
      setConfirmed(false);
    }
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

      {(status === "awaiting_shipment" || formOpen) && <ProtectYourCards />}

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
                : "You buy the shipping label for your cards to us, with tracking. That's separate from shipping our cards to you."}
            </p>
          </div>
        </div>
      )}

      {status === "awaiting_shipment" && <ShippingGuide />}

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

      {s.tracking && !formOpen && (
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
          {(s.shippedOn || s.packagingConfirmedAt) && (
            <p className="gg-tc-line__meta">
              {s.shippedOn ? `Shipped ${shipDateLabel(s.shippedOn)}` : ""}
              {s.shippedOn && s.packagingConfirmedAt ? " · " : ""}
              {s.packagingConfirmedAt ? `Packaging confirmed ${formatDeadline(s.packagingConfirmedAt)}` : ""}
            </p>
          )}
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

      {formOpen && (
        <form className="gg-tc-trackform" onSubmit={(e) => void submit(e)} aria-labelledby="gg-tc-trackform-title">
          <h3 id="gg-tc-trackform-title" className="gg-tc-trackform__title">
            {s.tracking ? "Update your tracking" : "Add your tracking number"}
          </h3>
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
          <label className="gg-field gg-tc-trackform__date">
            <span>Date shipped (optional)</span>
            <input type="date" value={shippedOn} min={earliest} max={today} onChange={(e) => setShippedOn(e.target.value)} />
          </label>
          {guess && guess !== carrier && carrier !== "Other" && !problem && (
            <p className="gg-tc-line__meta gg-tc-trackform__hint">That looks like a {guess} number.</p>
          )}
          {newShipment ? (
            <label className="gg-tc-ack gg-tc-trackform__confirm">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} aria-required="true" />
              <span>{PACKAGING_CONFIRMATION}</span>
            </label>
          ) : (
            s.packagingConfirmedAt && (
              <p className="gg-tc-line__meta gg-tc-trackform__hint">
                You confirmed this package&rsquo;s packaging {formatDeadline(s.packagingConfirmedAt)}. A new tracking number needs a new
                confirmation.
              </p>
            )
          )}
          <div className="gg-tc-trackform__actions">
            <button type="submit" className="gg-btn" disabled={busy === "tracking" || !number.trim()}>
              {busy === "tracking" ? "Saving…" : s.tracking ? "Update tracking" : "Add tracking number"}
            </button>
            {s.tracking && (
              <button
                type="button"
                className="gg-linkbtn"
                onClick={() => {
                  setEditing(false);
                  setNumber(s.tracking ?? "");
                  setCarrier(s.carrier ?? "USPS");
                  setShippedOn(s.shippedOn ?? "");
                  setConfirmed(false);
                  setProblem(null);
                }}
              >
                Cancel
              </button>
            )}
          </div>
          {problem && (
            <p className="gg-alert gg-alert-error" role="alert">
              {problem}
            </p>
          )}
        </form>
      )}

      {canEdit && (
        <>
          <TradeProofForm trade={trade} busy={busy === "proof"} onSend={onProof} />
          {!pastDeadline && <TradeAskForTime what="ship" busy={busy === "ask"} onAsk={onAskForTime} />}
        </>
      )}
    </section>
  );
}

/** The notice on protecting cards in the mail, and what damage on the way means for the value. */
function ProtectYourCards() {
  return (
    <aside className="gg-tc-protect" aria-labelledby="gg-tc-protect-title">
      <h3 id="gg-tc-protect-title">{PROTECT_YOUR_CARDS.title}</h3>
      {PROTECT_YOUR_CARDS.paragraphs.map((p) => (
        <p key={p}>{p}</p>
      ))}
      <p className="gg-tc-protect__damage">{PROTECT_YOUR_CARDS.damage}</p>
    </aside>
  );
}

/** The first-time shipper guide: collapsed by default, with its one-line reminder always showing. */
function ShippingGuide() {
  return (
    <details className="gg-tc-guide">
      <summary className="gg-tc-guide__summary">
        <span className="gg-tc-guide__title">{SHIPPING_GUIDE_TITLE}</span>
        <span className="gg-tc-guide__reminder">{SHIPPING_GUIDE_REMINDER}</span>
        <span className="gg-tc-guide__toggle" aria-hidden="true" />
      </summary>
      <ol className="gg-tc-guide__steps">
        {SHIPPING_GUIDE.map((step, i) => (
          <li key={step.title} className="gg-tc-guide__step">
            <h4>
              <span className="gg-tc-guide__num">Step {i + 1}</span> {step.title}
            </h4>
            <p>{step.intro}</p>
            <ul>
              {step.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            {step.illustrations.length > 0 && (
              <div className="gg-tc-pack">
                {step.illustrations.map((ill) => (
                  <figure key={ill.kind} className="gg-tc-pack__item">
                    <ShippingIllustration kind={ill.kind} />
                    <figcaption>{ill.caption}</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
