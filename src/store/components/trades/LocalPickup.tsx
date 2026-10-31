import { useState, type ReactNode } from "react";
import { Link } from "../../lib/router";
import { formatCents } from "../../lib/money";
import { CONDITION_LABELS } from "../../lib/conditionLabels";
import { useNow } from "../../lib/useNow";
import {
  CONDITION_NAMES,
  FINISH_NAMES,
  LOCAL_PAYMENT_LABELS,
  cardLine,
  formatDeadline,
  meetSpotMapUrl,
  meetSpotOf,
  timeLeft,
  tradeLabel,
  valueForCreditCents,
  type CustomerTrade,
  type MeetSpot,
  type TradeHandoffMethod,
  type TradeTerms,
} from "../../lib/tradeCenter";
import { TradeAskForTime } from "./TradeAskForTime";

// Local pickup on the storefront: choosing it (the trade cart and a draft),
// what a local trade adds up to before we meet (no shipping, and their
// cards are valued in person), confirming it (never a deposit: our cards are
// held until the meetup deadline), the meetup itself, and how it settled.
// Everything a shipped trade does by mail happens when we meet instead, so
// these stand in for the shipping, inspection and payment panels.

/** Local pickup's meeting spot: its name, address and directions. */
export function MeetSpotCard({ spot, title = "Meeting spot" }: { spot: MeetSpot; title?: string }) {
  return (
    <div className="gg-tc-spot">
      <h3 className="gg-tc-spot__title">{title}</h3>
      {spot.name && <p className="gg-tc-spot__name">{spot.name}</p>}
      {spot.address && <p className="gg-tc-spot__address">{spot.address}</p>}
      <a className="gg-tc-spot__map" href={meetSpotMapUrl(spot)} target="_blank" rel="noopener noreferrer">
        Get directions<span className="visually-hidden"> (opens Google Maps)</span>
      </a>
    </div>
  );
}

/** Ship or meet: the choice on the trade cart and on a draft trade. */
export function HandoffChoice({
  value,
  onChange,
  terms,
  disabled = false,
  name = "gg-tc-handoff",
}: {
  value: TradeHandoffMethod;
  onChange: (next: TradeHandoffMethod) => void;
  terms: Pick<TradeTerms, "localPickupArea" | "localMeetSpotName" | "localMeetSpotAddress">;
  disabled?: boolean;
  name?: string;
}) {
  const spot = meetSpotOf(terms);
  const where = spot ? `Meet us at ${spot.name ?? spot.address}.` : `Meet us in ${terms.localPickupArea}.`;
  return (
    <fieldset className="gg-tc-handoff" disabled={disabled}>
      <legend>How do you want to trade?</legend>
      <label className={value === "ship" ? "gg-tc-handoff__opt gg-tc-handoff__opt--on" : "gg-tc-handoff__opt"}>
        <input type="radio" name={name} value="ship" checked={value === "ship"} onChange={() => onChange("ship")} />
        <span>
          <strong>Ship my cards</strong>
          <span className="gg-tc-handoff__sub">List your cards, mail them with tracking, and we ship ours to you.</span>
        </span>
      </label>
      <label className={value === "local" ? "gg-tc-handoff__opt gg-tc-handoff__opt--on" : "gg-tc-handoff__opt"}>
        <input type="radio" name={name} value="local" checked={value === "local"} onChange={() => onChange("local")} />
        <span>
          <strong>Local pickup</strong>
          <span className="gg-tc-handoff__sub">
            {where} No need to list your cards: bring them and we&rsquo;ll settle the trade in person.
          </span>
        </span>
      </label>
    </fieldset>
  );
}

/** About what of their cards, at TCG low, covers ours at the trade's rate. */
function coverCents(wantedCents: number, ratePercent: number, feeCents: number): number {
  return valueForCreditCents(wantedCents, ratePercent, feeCents);
}

/** The trade cart's summary for local pickup: our cards, no shipping, and what to bring. */
export function LocalCartSummary({ terms, count, totalCents }: { terms: TradeTerms; count: number; totalCents: number }) {
  const needed = coverCents(totalCents, terms.creditRatePercent, terms.processingFeeCents);
  const spot = meetSpotOf(terms);
  return (
    <>
      <dl className="gg-tc-sum">
        <div>
          <dt>Our cards ({count})</dt>
          <dd>{formatCents(totalCents)}</dd>
        </div>
        <div>
          <dt>
            Shipping
            <span className="gg-tc-sum__hint">You pick our cards up when we meet</span>
          </dt>
          <dd>None</dd>
        </div>
      </dl>
      <div className="gg-tc-sum__need">
        <p className="gg-tc-sum__needfig" aria-live="polite" aria-atomic="true">
          <span className="gg-tc-sum__needlabel">To cover our cards, bring about </span>
          <strong className="gg-tc-sum__needvalue">{formatCents(needed)}</strong>
          <span className="gg-tc-sum__needsub"> of your cards at TCG low</span>
        </p>
        <p className="gg-tc-sum__needhint">
          At {terms.creditRatePercent}% trade credit
          {terms.processingFeeCents > 0 ? `, after the ${formatCents(terms.processingFeeCents)} processing fee` : ""}. We value your
          cards together when we meet. Bring less and pay the rest then, in cash or by card, or more and keep the extra as store credit
          {terms.cashPayoutEnabled ? " (or take cash for it, at a lower rate)" : ""}.
        </p>
      </div>
      {spot && <MeetSpotCard spot={spot} title="Where we meet" />}
    </>
  );
}

/** A local trade's running total before we meet: our cards, what to bring, and how the rest is settled. */
export function LocalBalance({ trade, children }: { trade: CustomerTrade; children?: ReactNode }) {
  const needed = coverCents(trade.wantedTotalCents, trade.creditRatePercent, trade.processingFeeCents);
  return (
    <section className="gg-tc-balance" aria-label="Your trade">
      <h2 className="gg-tc-balance__title">Your trade</h2>
      <p className="gg-tc-localtag">Local pickup</p>
      <dl className="gg-tc-balance__rows">
        <div>
          <dt>Our cards</dt>
          <dd>{formatCents(trade.wantedTotalCents)}</dd>
        </div>
        <div className="gg-tc-balance__need">
          <dt>
            Your cards to bring
            <span className="gg-tc-balance__hint">About this much at TCG low covers ours at {trade.creditRatePercent}% trade credit</span>
          </dt>
          <dd>{formatCents(needed)}</dd>
        </div>
        <div>
          <dt>
            Your cards
            <span className="gg-tc-balance__hint">Valued together when we meet</span>
          </dt>
          <dd>At the meetup</dd>
        </div>
        {trade.processingFeeCents > 0 && (
          <div>
            <dt>Processing fee (taken from the credit)</dt>
            <dd>{formatCents(trade.processingFeeCents)}</dd>
          </div>
        )}
        <div>
          <dt>Shipping</dt>
          <dd>None</dd>
        </div>
      </dl>
      <p className="gg-tc-balance__foot">
        Anything your credit doesn&rsquo;t cover is paid when we meet, in cash or by card. Credit left over stays in your account as store
        credit. There&rsquo;s no deposit.
      </p>
      {children}
    </section>
  );
}

/** Their cards on a local trade before we meet: nothing to list. */
export function LocalYourCards({ trade }: { trade: CustomerTrade }) {
  return (
    <section className="gg-tc-panel" aria-labelledby="gg-tc-theirs-title">
      <h2 id="gg-tc-theirs-title">Your cards</h2>
      <p>
        Bring them when we meet. There&rsquo;s no need to list them here: we&rsquo;ll look them over together, value each one at its TCG
        low for the condition we see, and {trade.creditRatePercent}% of that is your trade credit toward our cards.
      </p>
      <p className="gg-tc-line__meta">
        We&rsquo;re looking for staples: cards worth {formatCents(trade.minCardValueCents)} or more each at TCG low. Please leave bulk
        at home. Want us to know what&rsquo;s coming? Add a note
        when you send your trade, or message us below.
      </p>
    </section>
  );
}

/** Where and when to meet, as we wrote it, or what happens until we do. */
function MeetupDetails({ trade, fallback }: { trade: CustomerTrade; fallback: string | null }) {
  if (trade.meetupDetails) {
    return (
      <div className="gg-tc-meetup__where">
        <h3>Where and when</h3>
        <p>{trade.meetupDetails}</p>
      </div>
    );
  }
  return fallback ? <p>{fallback}</p> : null;
}

/** Confirming an approved local trade: never a deposit; our cards are held until the meetup deadline. */
export function LocalConfirmPanel({
  trade,
  terms,
  busy,
  askBusy,
  onConfirm,
  onAskForTime,
}: {
  trade: CustomerTrade;
  terms: TradeTerms | null;
  busy: boolean;
  askBusy: boolean;
  onConfirm: (termsVersion: number) => Promise<unknown>;
  onAskForTime: (note: string) => Promise<boolean>;
}) {
  const now = useNow();
  const [agreed, setAgreed] = useState(false);
  const c = trade.confirmation;
  if (!c) return null;
  const confirmBy = Date.parse(c.confirmBy);
  const late = now > confirmBy;
  const wanted = trade.wanted.filter((w) => w.status === "requested" || w.status === "reserved");
  const count = wanted.reduce((n, w) => n + w.quantity, 0);
  const short = wanted.filter((w) => w.available !== null && w.available < w.quantity);
  const paragraphs = c.termsText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const spot = meetSpotOf(terms);

  return (
    <section className="gg-tc-panel gg-tc-confirm" aria-labelledby="gg-tc-confirm-title">
      <h2 id="gg-tc-confirm-title">Confirm your trade</h2>
      <p className="gg-tc-deadline">
        {late ? (
          <>The time to confirm ran out at {formatDeadline(c.confirmBy)}.</>
        ) : (
          <>
            Confirm by <strong>{formatDeadline(c.confirmBy)}</strong> ({timeLeft(confirmBy, now)} left). Until you do, our cards stay on
            sale.
          </>
        )}
      </p>

      <dl className="gg-tc-facts">
        <div>
          <dt>Cards you&rsquo;re getting</dt>
          <dd>
            {count} card{count === 1 ? "" : "s"} (listed below)
          </dd>
        </div>
        <div>
          <dt>Our cards</dt>
          <dd>{formatCents(trade.wantedTotalCents)}</dd>
        </div>
        <div>
          <dt>How you&rsquo;ll trade</dt>
          <dd>
            Local pickup
            <span className="gg-tc-facts__sub">No shipping and no deposit</span>
          </dd>
        </div>
        <div>
          <dt>We hold our cards until</dt>
          <dd>
            {formatDeadline(c.shipByIfConfirmedNow)}
            <span className="gg-tc-facts__sub">
              if you confirm now: {c.shipDays} day{c.shipDays === 1 ? "" : "s"}, Sundays don&rsquo;t count
            </span>
          </dd>
        </div>
      </dl>

      <ul className="gg-tc-confirm__cards">
        {wanted.map((w) => {
          const soldOut = w.available !== null && w.available < w.quantity;
          return (
            <li key={w.id} className={soldOut ? "gg-tc-confirm__card gg-tc-confirm__card--short" : "gg-tc-confirm__card"}>
              <span>
                {w.quantity} × <strong>{w.cardName}</strong>{" "}
                <span className="gg-tc-line__meta">
                  {[w.setCode?.toUpperCase(), CONDITION_LABELS[w.condition] ?? w.condition, w.finish !== "nonfoil" ? (FINISH_NAMES[w.finish] ?? w.finish) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {soldOut && (
                  <span className="gg-tc-confirm__warn">
                    {w.available === 0 ? "Sold since we approved your trade" : `Only ${w.available} left`}
                  </span>
                )}
              </span>
              <span className="gg-tc-confirm__price">{formatCents(w.unitPriceCents * w.quantity)}</span>
            </li>
          );
        })}
      </ul>
      {trade.approvalConditions && (
        <p className="gg-tc-note">
          <strong>Approved on this condition:</strong> {trade.approvalConditions}
        </p>
      )}
      {spot && <MeetSpotCard spot={spot} title="Where we meet" />}
      <MeetupDetails trade={trade} fallback={null} />
      {short.length > 0 && (
        <p className="gg-alert gg-alert-warn">
          Some of our cards sold since we approved your trade. If you confirm, nothing is reserved: your trade comes back to you to update,
          and we&rsquo;ll review it again right away.
        </p>
      )}

      <div className="gg-tc-terms">
        <h3>What confirming means</h3>
        {paragraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>

      <form
        className="gg-tc-confirm__go"
        onSubmit={(e) => {
          e.preventDefault();
          if (agreed && !late) void onConfirm(c.termsVersion);
        }}
      >
        <label className="gg-tc-ack">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} required />
          <span>
            I&rsquo;ll meet you to trade by {formatDeadline(c.shipByIfConfirmedNow)}, or cancel so our cards go back on sale.
          </span>
        </label>
        <button type="submit" className="gg-btn gg-tc-confirm__btn" disabled={busy || !agreed || late}>
          {busy ? "Confirming…" : "Confirm Trade"}
        </button>
      </form>
      {!late && <TradeAskForTime what="confirm" busy={askBusy} onAsk={onAskForTime} />}
    </section>
  );
}

/** Reserved: arranging and getting ready for the meetup. */
export function LocalMeetupPanel({ trade, terms }: { trade: CustomerTrade; terms: TradeTerms | null }) {
  const spot = meetSpotOf(terms);
  // Our cards are held until the trade is finished or canceled: there's no
  // deadline (a date an older trade still carries is ignored), and so no
  // asking for more time.
  return (
    <section className="gg-tc-panel gg-tc-meetup" aria-labelledby="gg-tc-meetup-title">
      <h2 id="gg-tc-meetup-title">Let&rsquo;s meet up</h2>
      <p className="gg-tc-deadline">
        Our cards are held for you until we meet. Changed your mind about one of them, or can&rsquo;t make it? Message us below, or cancel your
        trade at no cost.
      </p>
      {spot && <MeetSpotCard spot={spot} />}
      <MeetupDetails
        trade={trade}
        fallback={
          spot
            ? "We'll message you below to set a time to meet here. Reply with times that work for you."
            : (terms?.localPickupDetails ??
              "We'll message you below to set a time and a public place to meet. Reply with times that work for you.")
        }
      />
      <h3>Bring</h3>
      <ul className="gg-tc-meetup__bring">
        <li>The cards you&rsquo;re trading in. Sleeves or a binder keep them safe on the way.</li>
        <li>A way to pay anything your credit doesn&rsquo;t cover: cash or card.</li>
        <li>Your trade ID, {tradeLabel(trade.tradeNumber)}, so we can find your trade quickly.</li>
      </ul>
      <p className="gg-tc-line__meta">
        We&rsquo;ll value each of your cards at its TCG low for the condition we see, and {trade.creditRatePercent}% of that is your trade
        credit. You&rsquo;ll see every card and price before anything changes hands, and you can change your mind there.
      </p>
    </section>
  );
}

/** A finished local trade: what we took, the credit, what they paid in person, and what's left. */
export function LocalSettled({ trade }: { trade: CustomerTrade }) {
  const credit = trade.creditIssuedCents ?? trade.finalCreditCents ?? 0;
  const creditOnCards = Math.min(trade.finalCreditCents ?? credit, trade.wantedTotalCents);
  const paid = trade.localPaidCents ?? trade.amountDueCents ?? 0;
  const cash = trade.excessHandling === "cash" ? (trade.cashPayoutCents ?? 0) : 0;
  const excess = trade.excessCents ?? 0;
  const method = trade.localPaymentMethod && trade.localPaymentMethod !== "none" ? LOCAL_PAYMENT_LABELS[trade.localPaymentMethod] : null;
  const taken = trade.offered.filter((c) => (c.finalQuantity ?? 0) > 0);
  return (
    <section className="gg-tc-panel gg-tc-settled" aria-labelledby="gg-tc-settled-title">
      <h2 id="gg-tc-settled-title">How your trade settled</h2>
      {trade.metAt && <p className="gg-tc-line__meta">We met and traded on {formatDeadline(trade.metAt)}. You took our cards with you.</p>}
      <dl className="gg-tc-balance__rows">
        <div>
          <dt>Our cards</dt>
          <dd>{formatCents(trade.wantedTotalCents)}</dd>
        </div>
        <div>
          <dt>Your cards we took</dt>
          <dd>{formatCents(trade.finalValueCents ?? 0)}</dd>
        </div>
        <div className="gg-tc-balance__credit">
          <dt>Trade credit at {trade.creditRatePercent}%</dt>
          <dd>{formatCents(credit)}</dd>
        </div>
        <div>
          <dt>Credit used on our cards</dt>
          <dd>{formatCents(creditOnCards)}</dd>
        </div>
        {paid > 0 && (
          <div>
            <dt>Paid when we met{method ? ` (${method.toLowerCase()})` : ""}</dt>
            <dd>{formatCents(paid)}</dd>
          </div>
        )}
        {cash > 0 ? (
          <div>
            <dt>Cash for the credit left over</dt>
            <dd>{formatCents(cash)}</dd>
          </div>
        ) : excess > 0 ? (
          <div>
            <dt>Store credit left for you</dt>
            <dd>{formatCents(excess)}</dd>
          </div>
        ) : null}
      </dl>
      {taken.length > 0 && (
        <div className="gg-tc-settled__back">
          <h3>Your cards we took</h3>
          <ul>
            {taken.map((c) => (
              <li key={c.id}>
                {c.finalQuantity} × {cardLine(c)}
                {c.verifiedCondition ? ` · ${CONDITION_NAMES[c.verifiedCondition]}` : ""} · {formatCents((c.finalQuantity ?? 0) * (c.finalUnitCents ?? 0))}
              </li>
            ))}
          </ul>
        </div>
      )}
      {excess > 0 && cash === 0 && (
        <p className="gg-tc-line__meta">
          Your store credit is ready for your next order. <Link to="/account/credit">See your balance</Link>.
        </p>
      )}
    </section>
  );
}
