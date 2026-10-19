import { formatCents } from "../../lib/money";
import { SORTING_LIMITS, SORTING_RATES_NOTE, formatRatePerThousand } from "../../lib/sortingService";
import type { SortingOption } from "../../lib/sortingApi";
import { estimateFor, type SortingPlan } from "../../lib/sortingForm";

// The collection sorting price calculator. It works out the sorting estimate
// from the advertised per-1,000-card rate, and — when the customer will ship
// their cards — shows what that estimate leaves out: shipping to us (theirs,
// paid separately) and return shipping and packaging (quoted later, as items
// of the final quote). It never shows a shipping amount, because there isn't
// one until the collection is sorted and packed, and it never promises free
// shipping: the total stays "pending a final shipping quote".
//
// The choices live with the page (useState there), so the request form
// below picks them up without asking again.

export default function SortingCalculator({
  options,
  plan,
  onChange,
  onRequest,
}: {
  options: SortingOption[];
  plan: SortingPlan;
  onChange: (next: SortingPlan) => void;
  /** "Request sorting": go to the request form. */
  onRequest?: () => void;
}) {
  const { option, cards, sortingCents } = estimateFor(plan, options);
  const cardsTyped = plan.cardsInput.trim() !== "";
  const cardsInvalid = cardsTyped && cards === null;
  const shipped = plan.delivery === "ship";
  const estimate = sortingCents !== null ? formatCents(sortingCents) : "—";

  return (
    <div className="gg-sort-calc">
      <div className="gg-sort-calc__inputs">
        <fieldset className="gg-sort-choice">
          <legend>1. How would you like it sorted?</legend>
          <div className="gg-sort-choice__grid">
            {options.map((o) => (
              <label
                key={o.id}
                className={`gg-sort-option${plan.optionId === o.id ? " gg-sort-option--selected" : ""}`}
              >
                <input
                  type="radio"
                  name="sort-option"
                  value={o.id}
                  checked={plan.optionId === o.id}
                  onChange={() => onChange({ ...plan, optionId: o.id })}
                />
                <span className="gg-sort-option__body">
                  <span className="gg-sort-option__name">{o.name}</span>
                  <span className="gg-sort-option__rate">{formatRatePerThousand(o.ratePerThousandCents)}</span>
                  {o.description && <span className="gg-sort-option__desc">{o.description}</span>}
                </span>
              </label>
            ))}
          </div>
          <p className="gg-card-meta gg-sort-calc__hint">{SORTING_RATES_NOTE}</p>
        </fieldset>

        <div className="gg-field gg-sort-calc__cards">
          <label htmlFor="sort-cards">2. About how many cards?</label>
          <input
            id="sort-cards"
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 5,000"
            value={plan.cardsInput}
            onChange={(e) => onChange({ ...plan, cardsInput: e.target.value })}
            aria-invalid={cardsInvalid || undefined}
            aria-describedby="sort-cards-hint"
          />
          <p id="sort-cards-hint" className={cardsInvalid ? "gg-field-error" : "gg-card-meta"}>
            {cardsInvalid
              ? `Enter a whole number of cards, up to ${SORTING_LIMITS.maxEstimatedCards.toLocaleString("en-US")}.`
              : "A best guess is fine — your final price is based on the cards we count."}
          </p>
        </div>

        <fieldset className="gg-sort-choice">
          <legend>3. How will you get your cards to us?</legend>
          <div className="gg-sort-choice__grid gg-sort-choice__grid--two">
            <label className={`gg-sort-option${plan.delivery === "drop_off" ? " gg-sort-option--selected" : ""}`}>
              <input
                type="radio"
                name="sort-delivery"
                value="drop_off"
                checked={plan.delivery === "drop_off"}
                onChange={() => onChange({ ...plan, delivery: "drop_off" })}
              />
              <span className="gg-sort-option__body">
                <span className="gg-sort-option__name">Drop off locally</span>
                <span className="gg-sort-option__desc">
                  In the St. Louis area. Pick it up when it&rsquo;s ready — no shipping needed.
                </span>
              </span>
            </label>
            <label className={`gg-sort-option${shipped ? " gg-sort-option--selected" : ""}`}>
              <input
                type="radio"
                name="sort-delivery"
                value="ship"
                checked={shipped}
                onChange={() => onChange({ ...plan, delivery: "ship" })}
              />
              <span className="gg-sort-option__body">
                <span className="gg-sort-option__name">Ship it to us</span>
                <span className="gg-sort-option__desc">
                  From anywhere in the US. You pay shipping to us; return shipping is added to your
                  final quote.
                </span>
              </span>
            </label>
          </div>
        </fieldset>
      </div>

      <section className="gg-sort-estimate" aria-labelledby="sort-estimate-title" aria-live="polite">
        <h3 id="sort-estimate-title">Your estimate</h3>
        <dl className="gg-sort-lines">
          <div className="gg-sort-line">
            <dt>
              Sorting service
              <span className="gg-sort-line__sub">
                {option && cards
                  ? `${cards.toLocaleString("en-US")} cards × ${formatRatePerThousand(option.ratePerThousandCents)}`
                  : "Choose a sorting option and enter your card count."}
              </span>
            </dt>
            <dd>{estimate}</dd>
          </div>
          {shipped && (
            <>
              <div className="gg-sort-line">
                <dt>
                  Shipping your cards to us
                  <span className="gg-sort-line__sub">Packing supplies, postage and any insurance.</span>
                </dt>
                <dd className="gg-sort-line__pending">Paid by you, separately</dd>
              </div>
              <div className="gg-sort-line">
                <dt>
                  Return shipping
                  <span className="gg-sort-line__sub">
                    Based on your collection&rsquo;s size, weight, packaging and destination.
                  </span>
                </dt>
                <dd className="gg-sort-line__pending">Added to your final quote</dd>
              </div>
              <div className="gg-sort-line">
                <dt>Return packaging &amp; supplies</dt>
                <dd className="gg-sort-line__pending">Added to your final quote</dd>
              </div>
            </>
          )}
          {plan.delivery === "drop_off" && (
            <div className="gg-sort-line">
              <dt>Return shipping</dt>
              <dd className="gg-sort-line__pending">Not needed — local pickup</dd>
            </div>
          )}
          <div className="gg-sort-line gg-sort-line--total">
            <dt>
              {shipped ? "Estimated service total" : plan.delivery === "drop_off" ? "Estimated total" : "Estimated sorting total"}
              {shipped && <span className="gg-sort-pending">Pending final shipping quote</span>}
            </dt>
            <dd>
              {estimate}
              {shipped && sortingCents !== null && (
                <span className="gg-sort-line__plus"> + return shipping &amp; packaging</span>
              )}
            </dd>
          </div>
        </dl>
        <p className="gg-sort-estimate__foot">
          {shipped
            ? "An estimate, not a final price: we work out return shipping and packaging once your collection is sorted and packed, and the sorting cost from the cards we count. You'll see the complete price — sorting, return shipping and packaging — and approve it before you pay."
            : plan.delivery === "drop_off"
              ? "An estimate, not a final price: your final quote is based on the cards we count, and you'll approve it before you pay."
              : "Choose drop-off or shipping to see what else goes into your quote."}
        </p>
        {onRequest && (
          <button type="button" className="gg-btn gg-sort-estimate__cta" onClick={onRequest}>
            Request sorting
          </button>
        )}
      </section>
    </div>
  );
}
