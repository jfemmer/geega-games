import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { conditionAgeRules } from "../../lib/tradeConditions";
import { moneyShort } from "../../lib/tradeShipping";
import { meetSpotOf, termsForHandoff, type TradeHandoffMethod, type TradeTerms } from "../../lib/tradeCenter";
import { MeetSpotCard } from "./LocalPickup";

// "How trading works" on the Trade Cards page: the steps of a trade, by mail
// and (when it's offered) in person, each with the numbers its own settings
// give it. With local pickup on, a tab for each way, starting on the one the
// customer has chosen in their trade summary. Shipped trades also show how
// we set a card's condition from its age; a local trade's cards are graded
// together at the meetup.

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "2 days" or "36 hours": the confirmation window as customers read it. */
function confirmWindow(t: TradeTerms): string {
  return t.confirmationHours % 24 === 0 ? plural(t.confirmationHours / 24, "day") : plural(t.confirmationHours, "hour");
}

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

/** A trade by mail, from picking our cards to the final offer. */
function shippedSteps(t: TradeTerms | null): Step[] {
  const rate = t ? `${t.creditRatePercent}%` : "a set percentage";
  const freeShipping = t ? `Shipping is free on ${moneyShort(t.freeShipThresholdCents)} or more of our cards.` : "";
  return [
    {
      title: "Choose our cards.",
      body: (
        <>
          Add singles from our shop to your trade cart.
          {t && t.minTradeValueCents > 0 ? ` Trades start at ${moneyShort(t.minTradeValueCents)} of our cards. ${freeShipping}` : freeShipping ? ` ${freeShipping}` : ""}
        </>
      ),
    },
    {
      title: "Submit your trade list.",
      body: (
        <>
          Start your trade, then add the cards you&rsquo;re trading in by searching for each one or pasting a list. We accept staples
          valued at {t ? `${moneyShort(t.minCardValueCents)} or more` : "a set amount or more"} each at TCG low. Each card&rsquo;s
          condition is assigned from its printing&rsquo;s age, and you&rsquo;ll see an estimated value as you go.
        </>
      ),
    },
    {
      title: "We review your trade.",
      body: (
        <>
          We price each card at its TCG low (the lowest listed price on TCGplayer) for its condition, and email you as soon as your trade
          is approved.
        </>
      ),
    },
    {
      title: "Confirm and ship.",
      body: (
        <>
          {t ? `Confirm within ${confirmWindow(t)} to reserve our cards` : "Confirm your trade to reserve our cards"}
          {t?.depositsEnabled ? `; trades of ${moneyShort(t.depositThresholdCents)} or more require a refundable deposit` : ""}. Then
          ship your cards with tracking{t ? ` within ${plural(t.shipDaysNew, "day")}` : ""}. Sundays don&rsquo;t count toward either
          deadline.
        </>
      ),
    },
    {
      title: "We inspect your cards.",
      body: (
        <>
          When your cards arrive, we verify each one&rsquo;s condition. A card&rsquo;s value may go up or down, and every change is itemized
          with the reason.
        </>
      ),
    },
    {
      title: "Accept your final offer.",
      body: (
        <>
          You receive {rate} of your cards&rsquo; final TCG low as trade credit. Pay any remaining balance by card or keep leftover credit
          for a future order, and we ship our cards to you. If you decline, we return your cards with no penalty.
        </>
      ),
    },
  ];
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
          Add singles from our shop to your trade cart.
          {t.minTradeValueCents > 0 ? ` Local trades start at ${moneyShort(t.minTradeValueCents)} of our cards.` : ""} There&rsquo;s
          no shipping.
        </>
      ),
    },
    {
      title: "Select local pickup.",
      body: (
        <>
          Choose <em>Local pickup</em> in your trade summary and submit your trade. You don&rsquo;t need to list your cards in advance,
          though you&rsquo;re welcome to add a note about what you plan to bring.
        </>
      ),
    },
    {
      title: "We review your trade.",
      body: <>We check that our cards are available and email you as soon as your trade is approved.</>,
    },
    {
      title: "Confirm your trade.",
      body: (
        <>
          Confirm within {confirmWindow(t)}, and we&rsquo;ll hold our cards for you for {plural(t.localMeetDays, "day")} while we
          schedule a time to meet {where}. Sundays don&rsquo;t count, and no deposit is required.
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

/** How a card's age sets the condition it's listed at (shipped trades). */
function ConditionTable() {
  const rules = conditionAgeRules();
  return (
    <div className="gg-tc-how__ages">
      <h3>How we assign condition</h3>
      <table className="gg-tc-table gg-tc-agetable">
        <caption>Based on when the card&rsquo;s printing was released. We verify every card when it arrives.</caption>
        <thead>
          <tr>
            <th scope="col">Card&rsquo;s age</th>
            <th scope="col">Listed as</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.code}>
              <th scope="row">{r.ages}</th>
              <td>{r.condition}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
      <ConditionTable />
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
