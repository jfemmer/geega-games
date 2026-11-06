import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { moneyShort } from "../../lib/tradeShipping";
import { heldDuringReview, meetSpotOf, termsForHandoff, type TradeHandoffMethod, type TradeTerms } from "../../lib/tradeCenter";
import { confirmWindow, plural, shipWindow } from "../../lib/tradeFaq";
import { MeetSpotCard } from "./LocalPickup";

// "How trading works" on the Trade Cards page: the steps of a trade, by mail
// and (when it's offered) in person, each with the numbers its own settings
// give it. With local pickup on, a tab for each way, starting on the one the
// customer has chosen in the Use My Magic Cards panel. Shipped trades also show what
// each condition is worth (the customer chooses it; we check on arrival); a
// local trade's cards are graded together at the meetup.

interface Step {
  title: string;
  body: ReactNode;
}

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="gg-tc-how__steps">
      {steps.map((s) => (
        <li key={s.title}>
          <strong>{s.title}</strong> {s.body}
        </li>
      ))}
    </ol>
  );
}

/** A trade by mail, in the three steps customers see: choose, tell us, complete. */
function shippedSteps(t: TradeTerms | null): Step[] {
  const rate = t ? `${t.creditRatePercent}%` : "a set percentage";
  const loyal =
    t && t.shipDaysTier1 > t.shipDaysNew ? ` (${shipWindow(t.shipDaysTier1)} once you've completed ${plural(t.loyaltyTier1Trades, "trade")})` : "";
  return [
    {
      title: "Choose your cards.",
      body: (
        <>
          Shop as usual and add singles to your cart. At checkout, choose <em>Use My Magic Cards</em>.
          {t && t.minTradeValueCents > 0 ? ` Trades start at ${moneyShort(t.minTradeValueCents)} of our cards.` : ""}
        </>
      ),
    },
    {
      title: "Tell us what you're trading.",
      body: (
        <>
          Search for each card, paste a list or upload a CSV, and choose each card&rsquo;s condition. We accept staples worth{" "}
          {t ? `${moneyShort(t.minCardValueCents)} or more` : "a set amount or more"} each, and you&rsquo;ll see an estimate as you go:{" "}
          {rate} of their value in trade credit.
          {t && heldDuringReview(t) ? ` When you send it, we hold your chosen cards for up to ${plural(t.reviewHoldHours, "hour")} while we review.` : ""}
        </>
      ),
    },
    {
      title: "Complete your trade.",
      body: (
        <>
          Once we approve it, confirm within {t ? confirmWindow(t.confirmationHours) : "the time shown"}
          {t?.depositsEnabled ? ` (trades of ${moneyShort(t.depositThresholdCents)} or more take a refundable deposit)` : ""}, then ship your
          cards with tracking{t ? ` within ${shipWindow(t.shipDaysNew)}${loyal}` : ""}. Sundays don&rsquo;t count. We check every card
          when it arrives and send your final offer at TCG low, with any change explained. Accept it and we ship your new cards; decline
          and we return yours with no penalty.
        </>
      ),
    },
  ];
}

/** What each condition is worth against a near-mint card (shipped trades). */
function ConditionTable({ terms }: { terms: TradeTerms | null }) {
  if (!terms) return null;
  const rows: [string, number][] = [
    ["Near Mint", terms.conditionPercents.NM],
    ["Lightly Played", terms.conditionPercents.LP],
    ["Moderately Played", terms.conditionPercents.MP],
    ["Heavily Played", terms.conditionPercents.HP],
    ["Damaged", terms.conditionPercents.DMG],
  ];
  return (
    <div className="gg-tc-how__ages">
      <h3>What condition is worth</h3>
      <table className="gg-tc-table gg-tc-agetable">
        <caption>
          You choose each card&rsquo;s condition; we check every card when it arrives.{" "}
          <a href="/condition-guide">How we grade</a>
        </caption>
        <thead>
          <tr>
            <th scope="col">Condition</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, pct]) => (
            <tr key={name}>
              <th scope="row">{name}</th>
              <td>{pct}% of a near-mint copy</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A trade in person: no list to send and nothing to ship; it's settled when we meet. */
function localSteps(base: TradeTerms): Step[] {
  const t = termsForHandoff(base, "local");
  const spot = meetSpotOf(t);
  const where = spot ? `at ${spot.name ?? spot.address}` : `in ${t.localPickupArea}`;
  return [
    {
      title: "Choose our cards.",
      body: (
        <>
          Add singles from our shop to your cart, then choose <em>Use My Magic Cards</em> at checkout.
          {t.minTradeValueCents > 0 ? ` Local trades start at ${moneyShort(t.minTradeValueCents)} of our cards.` : ""} There&rsquo;s
          no shipping.
        </>
      ),
    },
    {
      title: "Select local pickup.",
      body: (
        <>
          Choose <em>Local pickup</em> when you start your trade, then send it. You don&rsquo;t need to list your cards in advance,
          though you&rsquo;re welcome to add a note about what you plan to bring.
        </>
      ),
    },
    {
      title: "We review your trade.",
      body: (
        <>
          We check that our cards are available and email you as soon as your trade is approved. Approving takes our cards off sale and
          holds them for you until we meet: there&rsquo;s nothing to confirm, and no deposit.
        </>
      ),
    },
    {
      title: "We set up the meetup.",
      body: (
        <>
          We message you on your trade page to schedule a time to meet {where}. Changed your mind about one of our cards? Tell us and we&rsquo;ll
          take it off. Can&rsquo;t make it? Cancel at no cost so we can put our cards back on sale.
        </>
      ),
    },
    {
      title: "Meet and settle.",
      body: (
        <>
          Bring your cards: staples valued at {moneyShort(t.minCardValueCents)} or more each at TCG low. We review each card together,
          price it at its TCG low for its condition, and you receive {t.creditRatePercent}% as trade credit. Pay any remaining balance
          in cash or by card, or keep leftover credit for a future order
          {t.cashPayoutEnabled ? " (or take it in cash, at a lower rate)" : ""}. You leave with our cards the same day.
        </>
      ),
    },
  ];
}

const TABS: { method: TradeHandoffMethod; label: string }[] = [
  { method: "ship", label: "Ship your cards" },
  { method: "local", label: "Local pickup" },
];

/**
 * How a trade works, by mail and in person. `initial` is the way the
 * customer has chosen (remount with a new key to follow a later choice).
 */
export function HowTradingWorks({ terms, initial = "ship" }: { terms: TradeTerms | null; initial?: TradeHandoffMethod }) {
  const local = Boolean(terms?.localPickupEnabled);
  const [tab, setTab] = useState<TradeHandoffMethod>(initial);
  const tabRefs = useRef<Record<TradeHandoffMethod, HTMLButtonElement | null>>({ ship: null, local: null });
  const shown: TradeHandoffMethod = local ? tab : "ship";
  const spot = meetSpotOf(terms);

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next: TradeHandoffMethod =
      e.key === "Home" ? "ship" : e.key === "End" ? "local" : shown === "ship" ? "local" : "ship";
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  const shipped = (
    <>
      <Steps steps={shippedSteps(terms)} />
      <ConditionTable terms={terms} />
    </>
  );

  return (
    <section className="gg-tc-how" aria-labelledby="gg-tc-how-title">
      <h2 id="gg-tc-how-title">How trading works</h2>
      {!local || !terms ? (
        shipped
      ) : (
        <>
          <p className="gg-tc-how__intro">
            Trade by mail, or in person in {terms.localPickupArea}. Here&rsquo;s how each works.
          </p>
          <div className="gg-tc-how__tabs" role="tablist" aria-label="Ways to trade" onKeyDown={onKey}>
            {TABS.map(({ method, label }) => (
              <button
                key={method}
                ref={(el) => {
                  tabRefs.current[method] = el;
                }}
                type="button"
                role="tab"
                id={`gg-tc-how-tab-${method}`}
                aria-selected={shown === method}
                aria-controls={`gg-tc-how-panel-${method}`}
                tabIndex={shown === method ? 0 : -1}
                className={shown === method ? "gg-tc-how__tab gg-tc-how__tab--on" : "gg-tc-how__tab"}
                onClick={() => setTab(method)}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`gg-tc-how-panel-${shown}`}
            aria-labelledby={`gg-tc-how-tab-${shown}`}
            className="gg-tc-how__panel"
            tabIndex={0}
          >
            {shown === "ship" ? (
              shipped
            ) : (
              <>
                <Steps steps={localSteps(terms)} />
                {spot && <MeetSpotCard spot={spot} title="Where we meet" />}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
