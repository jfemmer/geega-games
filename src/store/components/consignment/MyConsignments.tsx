import { useEffect, useState } from "react";
import { Link } from "../../lib/router";
import { CHANNEL_LABELS, CONSIGNMENT_CHANNELS, type ConsignmentChannel } from "../../lib/consignmentMath";
import { consignmentLabel, describeChannelFees } from "../../lib/consignmentAgreement";
import { formatBps } from "../../lib/consignmentMath";
import { formatCents } from "../../lib/money";
import {
  loadMyConsignments,
  signedAgreementUrl,
  useEstimatorConfig,
  type MyAgreement,
  type MyConsignedCard,
  type MyConsignment,
} from "../../lib/consignmentApi";
import { PayoutEstimator } from "./PayoutEstimator";

// Account > Consignments: each of the consignor's consignments with its
// status, the channels and insurance choice in force, the terms they signed,
// their signed agreement (PDF), and the payout estimator limited to the
// channels they approved. Only their own consignments are ever loaded
// (my_consignments()), including the cards we received and how each line's
// inspection went. Sales and payouts join this page in later phases.

const STATUS_LABELS: Record<MyConsignment["status"], string> = {
  draft: "Being set up",
  awaiting_signature: "Waiting for your signature",
  signed: "Signed: send us your cards",
  inventory_received: "Cards received",
  active: "Active",
  terminated: "Ended",
  closed: "Closed",
};

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

function PdfLink({ agreement }: { agreement: MyAgreement }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="gg-myconsign__pdf">
      <button
        type="button"
        className="gg-btn gg-btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const tab = window.open("", "_blank");
          try {
            const url = await signedAgreementUrl(agreement.id);
            if (tab) tab.location.href = url;
            else window.location.href = url;
          } catch (e) {
            tab?.close();
            setError(e instanceof Error ? e.message : "Could not open the PDF.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Opening…" : "Download signed agreement (PDF)"}
      </button>
      {error && (
        <span className="gg-field-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

const CARD_STATUS: Record<MyConsignedCard["status"], string> = {
  submitted: "Expected",
  received: "Received, waiting for inspection",
  under_inspection: "Being inspected",
  accepted: "Accepted",
  rejected: "Not accepted",
  listed: "Listed for sale",
  reserved_for_sale: "In a pending sale",
  sold: "Sold",
  returned: "Returned to you",
};
const DECIDED = new Set<MyConsignedCard["status"]>(["accepted", "rejected", "listed", "reserved_for_sale", "sold", "returned"]);
const finishName = (f: string) => (f === "nonfoil" ? "Non-foil" : f[0].toUpperCase() + f.slice(1));

function YourCards({ cards }: { cards: MyConsignedCard[] }) {
  const totals = cards.reduce(
    (t, card) => ({
      received: t.received + (card.quantitySubmitted ?? 0),
      accepted: t.accepted + (DECIDED.has(card.status) ? card.quantityAccepted : 0),
      rejected: t.rejected + (DECIDED.has(card.status) ? card.quantityRejected : 0),
      waiting: t.waiting + (DECIDED.has(card.status) ? 0 : (card.quantitySubmitted ?? 0)),
    }),
    { received: 0, accepted: 0, rejected: 0, waiting: 0 },
  );
  return (
    <section className="gg-myconsign__cards" aria-label="Your cards">
      <h3>Your cards</h3>
      <p className="gg-card-meta">
        {totals.received} received · {totals.accepted} accepted · {totals.rejected} not accepted
        {totals.waiting ? ` · ${totals.waiting} waiting for inspection` : ""}
      </p>
      <ul className="gg-myconsign__cardlist">
        {cards.map((card) => {
          const decided = DECIDED.has(card.status);
          return (
            <li key={card.id} className="gg-myconsign__card">
              {card.imageUrl ? <img src={card.imageUrl} alt="" loading="lazy" width={48} height={67} /> : <span className="gg-myconsign__noimg" aria-hidden="true" />}
              <div>
                <strong>{card.cardName}</strong>
                <span className="gg-card-meta">
                  {card.setName ?? card.setCode.toUpperCase()} #{card.collectorNumber} · {finishName(card.finish)}
                </span>
                <span className="gg-card-meta">
                  {decided && card.status !== "rejected"
                    ? `${card.quantityAccepted} of ${card.quantitySubmitted ?? card.quantityAccepted} accepted${card.condition ? `, graded ${card.condition}` : ""}`
                    : `${card.quantitySubmitted ?? "?"} received${card.declaredCondition ? `, described as ${card.declaredCondition}` : ""}`}
                  {decided && card.listPriceCents != null ? ` · list ${formatCents(card.listPriceCents)}` : ""}
                  {decided && card.minPriceCents != null ? ` · your minimum ${formatCents(card.minPriceCents)}` : ""}
                </span>
                {decided && card.rejectionReason && <span className="gg-myconsign__reason">{card.status === "rejected" ? "Why: " : "Note: "}{card.rejectionReason}</span>}
              </div>
              <span className={`gg-myconsign__cardstatus gg-myconsign__cardstatus--${card.status}`}>{CARD_STATUS[card.status] ?? card.status}</span>
            </li>
          );
        })}
      </ul>
      {totals.rejected > 0 && (
        <p className="gg-card-meta">Cards we don't accept are returned to you as described in your agreement. Questions? Contact us.</p>
      )}
    </section>
  );
}

function ConsignmentCard({ c }: { c: MyConsignment }) {
  const signed = c.agreements.find((a) => a.status === "signed") ?? null;
  const pending = c.agreements.find((a) => a.status === "pending") ?? null;
  const terms = (signed ?? pending)?.terms;
  const approved = CONSIGNMENT_CHANNELS.filter((ch) => c.elections.channels[ch] === true);
  const config = useEstimatorConfig();
  const [showEstimator, setShowEstimator] = useState(false);

  return (
    <article className="gg-dash-card gg-myconsign">
      <header className="gg-myconsign__head">
        <h2>{consignmentLabel(c.consignmentNumber)}</h2>
        <span className={`gg-myconsign__status gg-myconsign__status--${c.status}`}>{STATUS_LABELS[c.status] ?? c.status}</span>
      </header>

      {c.status === "awaiting_signature" && pending && (
        <p className="gg-alert gg-alert-warn">
          Your agreement is waiting for you. Open the link in the email we sent (it works until {dateLabel(pending.expiresAt)}). Can't find it?
          Contact us and we'll resend it.
        </p>
      )}

      {signed && (
        <dl className="gg-myconsign__facts">
          <div>
            <dt>Signed</dt>
            <dd>
              {dateLabel(signed.signedAt!)} (version {signed.versionNumber})
            </dd>
          </div>
          <div>
            <dt>Sales channels</dt>
            <dd>
              {CONSIGNMENT_CHANNELS.map((ch: ConsignmentChannel) => `${CHANNEL_LABELS[ch]}: ${c.elections.channels[ch] ? "Yes" : "No"}`).join(" · ")}
            </dd>
          </div>
          <div>
            <dt>Additional insurance</dt>
            <dd>{c.elections.additionalInsurance ? "Approved (Option A)" : "Declined (Option B)"}</dd>
          </div>
          <div>
            <dt>Term</dt>
            <dd>
              {c.termStartedAt
                ? `${c.initialTermDays} days, ${dateLabel(c.termStartedAt)} to ${dateLabel(addDays(c.termStartedAt, c.initialTermDays))}, then month to month`
                : `${c.initialTermDays} days, starting when we post your accepted cards`}
            </dd>
          </div>
        </dl>
      )}

      {signed && terms && (
        <details className="gg-myconsign__terms">
          <summary>Your commission rates and fees</summary>
          <ul>
            {[...terms.commissionTiers]
              .sort((a, b) => (a.maxPriceCents ?? Infinity) - (b.maxPriceCents ?? Infinity))
              .map((t, i, all) => (
                <li key={i}>
                  {t.maxPriceCents == null
                    ? `Cards sold for ${i > 0 ? `${formatCents(all[i - 1].maxPriceCents! + 1)} or more` : "any price"}`
                    : `Cards sold for ${formatCents(t.maxPriceCents)} or less`}
                  : {formatBps(t.rateBps)} of the Net Sale Amount
                </li>
              ))}
            {approved.map((ch) =>
              terms.channels[ch] ? (
                <li key={ch}>
                  {CHANNEL_LABELS[ch]}: {describeChannelFees(terms.channels[ch]!)}
                </li>
              ) : null,
            )}
            <li>Buyer inspection period: {terms.inspectionDays} days after delivery, then payment.</li>
          </ul>
        </details>
      )}

      {signed?.hasPdf || signed ? (
        <div className="gg-myconsign__actions">
          {signed && <PdfLink agreement={signed} />}
          {signed?.pdfSha256 && <p className="gg-myconsign__hash">PDF fingerprint (SHA-256): {signed.pdfSha256}</p>}
        </div>
      ) : null}

      {c.cards && c.cards.length > 0 && <YourCards cards={c.cards} />}

      {signed && approved.length > 0 && (
        <div className="gg-myconsign__estimator">
          <button type="button" className="gg-btn gg-btn-ghost gg-btn-sm" aria-expanded={showEstimator} onClick={() => setShowEstimator((v) => !v)}>
            {showEstimator ? "Hide the payout estimator" : "Estimate a payout"}
          </button>
          {showEstimator &&
            (config.status === "ready" ? (
              <PayoutEstimator config={config.config} allowedChannels={approved} insuranceElection={c.elections.additionalInsurance} />
            ) : config.status === "loading" ? (
              <p role="status">Loading…</p>
            ) : (
              <p className="gg-field-error">{config.message}</p>
            ))}
        </div>
      )}
    </article>
  );
}

export function MyConsignments() {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; rows: MyConsignment[] }>({
    status: "loading",
  });
  useEffect(() => {
    let cancelled = false;
    loadMyConsignments().then(
      (rows) => !cancelled && setState({ status: "ready", rows }),
      (e: unknown) => !cancelled && setState({ status: "error", message: e instanceof Error ? e.message : "Could not load your consignments." }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") return <p role="status">Loading your consignments…</p>;
  if (state.status === "error")
    return (
      <p className="gg-alert gg-alert-error" role="alert">
        {state.message}
      </p>
    );
  if (state.rows.length === 0) {
    return (
      <div className="gg-dash-card">
        <h2>No consignments yet</h2>
        <p className="gg-card-meta">
          Consigning lets us sell your cards for you, for a commission, on the channels you choose. Interested? <Link to="/contact">Get in touch</Link>{" "}
          and we'll set one up and email you an agreement to review.
        </p>
      </div>
    );
  }
  return (
    <div className="gg-myconsign-list">
      {state.rows.map((c) => (
        <ConsignmentCard key={c.id} c={c} />
      ))}
    </div>
  );
}

export default MyConsignments;
