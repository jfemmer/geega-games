import { useId, useMemo, useState } from "react";
import { formatCents } from "../../lib/money";
import {
  CHANNEL_LABELS,
  COMBINED_SHIPMENT_NOTE,
  CONSIGNMENT_CHANNELS,
  ESTIMATE_DISCLAIMER,
  ESTIMATE_FOOTNOTE,
  compareChannels,
  compareInsurance,
  estimatePayout,
  formatBps,
  parseDollarsToCents,
  type ConsignmentChannel,
  type Estimate,
} from "../../lib/consignmentMath";
import type { EstimatorConfig } from "../../lib/consignmentApi";
import "./payoutEstimator.css";

// The Consignment Payout Estimator: what a consignor could expect from one
// card's sale, by channel, with and without additional insurance. Used in
// the admin dashboard, the agreement-signing flow and the consignor's
// dashboard. It's information only: it never changes an election, and final
// payouts are worked out from each sale's actual expenses.

export interface PayoutEstimatorProps {
  config: EstimatorConfig;
  /**
   * The channels the consignor approved (signed consignors). Omit to compare
   * every channel (before signing, and in admin).
   */
  allowedChannels?: readonly ConsignmentChannel[];
  /** The consignor's signed insurance election, when there is one: shown, never changed. */
  insuranceElection?: boolean | null;
  initialPriceCents?: number;
}

const priceText = (cents: number) => (cents / 100).toFixed(2);

function Money({ cents, negative = false }: { cents: number; negative?: boolean }) {
  return <>{negative && cents > 0 ? `−${formatCents(cents)}` : formatCents(cents)}</>;
}

function Breakdown({ e, config }: { e: Estimate; config: EstimatorConfig }) {
  const schedule = config.channels[e.channel];
  const processingIncluded = schedule != null && schedule.processingBps === 0 && schedule.processingFixedCents === 0 && e.channel !== "website";
  return (
    <table className="gg-pe-table">
      <caption className="gg-pe-sr">Estimated breakdown for {CHANNEL_LABELS[e.channel]}</caption>
      <tbody>
        <tr>
          <th scope="row">Estimated card selling price</th>
          <td>
            <Money cents={e.finalPriceCents} />
          </td>
        </tr>
        {e.channel !== "website" && (
          <tr>
            <th scope="row">Estimated {CHANNEL_LABELS[e.channel]} fees</th>
            <td>
              <Money cents={e.marketplaceFeeCents} negative />
            </td>
          </tr>
        )}
        <tr>
          <th scope="row">Estimated payment processing</th>
          <td>{processingIncluded ? <span className="gg-pe-muted">Included in {CHANNEL_LABELS[e.channel]}'s fee</span> : <Money cents={e.processingFeeCents} negative />}</td>
        </tr>
        <tr>
          <th scope="row">
            Estimated USPS postage
            {e.buyerShippingCents > 0 && (
              <span className="gg-pe-sub">
                {formatCents(e.postageCents)} less {formatCents(e.buyerShippingCents)} the buyer pays for shipping
              </span>
            )}
          </th>
          <td>
            <Money cents={e.netPostageCents} negative />
          </td>
        </tr>
        <tr>
          <th scope="row">Estimated additional USPS insurance</th>
          <td>
            <Money cents={e.insuranceCents} negative />
          </td>
        </tr>
        <tr className="gg-pe-subtotal">
          <th scope="row">Estimated Net Sale Amount</th>
          <td>
            <Money cents={e.netSaleCents} />
          </td>
        </tr>
        <tr>
          <th scope="row">Geega Games commission ({formatBps(e.commissionRateBps)})</th>
          <td>
            <Money cents={e.commissionCents} negative />
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function PayoutEstimator({ config, allowedChannels, insuranceElection, initialPriceCents = 20000 }: PayoutEstimatorProps) {
  const ids = useId();
  const channels = useMemo(
    () => CONSIGNMENT_CHANNELS.filter((c) => config.channels[c] && (!allowedChannels || allowedChannels.includes(c))),
    [config, allowedChannels],
  );
  const [priceInput, setPriceInput] = useState(priceText(initialPriceCents));
  const [channel, setChannel] = useState<ConsignmentChannel | null>(channels[0] ?? null);
  const [insured, setInsured] = useState<boolean>(insuranceElection ?? config.estimatorInsuranceDefault);
  const [postageInput, setPostageInput] = useState(priceText(config.defaultPostageCents));

  const priceCents = parseDollarsToCents(priceInput);
  const postageCents = parseDollarsToCents(postageInput);
  const postageIsDefault = postageCents === config.defaultPostageCents;
  const activeChannel = channel && channels.includes(channel) ? channel : (channels[0] ?? null);
  const valid = priceCents != null && priceCents > 0 && postageCents != null;

  const estimate = valid && activeChannel
    ? estimatePayout(
        { priceCents, channel: activeChannel, additionalInsurance: insured, postageCents: postageIsDefault ? undefined : postageCents },
        config,
      )
    : null;
  const comparison = valid && activeChannel
    ? compareInsurance({ priceCents, channel: activeChannel, postageCents: postageIsDefault ? undefined : postageCents }, config)
    : null;
  const byChannel = valid && channels.length > 1
    ? compareChannels({ priceCents, additionalInsurance: insured, postageCents: postageIsDefault ? undefined : postageCents }, config, channels)
    : [];

  if (channels.length === 0) {
    return (
      <div className="gg-pe">
        <p className="gg-pe-disclaimer" role="note">{ESTIMATE_DISCLAIMER}</p>
        <p className="gg-pe-empty">No sales channels have rates set up yet, so there's nothing to estimate.</p>
      </div>
    );
  }

  const ratesDate = config.effectiveFrom.commission ? new Date(config.asOf).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null;

  return (
    <div className="gg-pe">
      {/* Always visible above the calculator, never behind a tooltip. */}
      <p className="gg-pe-disclaimer" role="note">
        {ESTIMATE_DISCLAIMER}
      </p>

      <div className="gg-pe-inputs">
        <div className="gg-pe-field">
          <label className="gg-pe-label" htmlFor={`${ids}-price`}>
            Estimated card sale price
          </label>
          <span className="gg-pe-money">
            <span aria-hidden="true">$</span>
            <input
              id={`${ids}-price`}
              inputMode="decimal"
              autoComplete="off"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              aria-invalid={priceCents == null || priceCents <= 0}
              aria-describedby={`${ids}-price-hint`}
            />
          </span>
          <span id={`${ids}-price-hint`} className="gg-pe-hint">
            {priceCents == null || priceCents <= 0 ? "Enter a price, like 24.99." : "One card's expected selling price."}
          </span>
        </div>

        <fieldset className="gg-pe-field">
          <legend className="gg-pe-label">Sales channel</legend>
          <div className="gg-pe-segments">
            {channels.map((c) => (
              <label key={c} className={`gg-pe-segment${activeChannel === c ? " is-on" : ""}`}>
                <input type="radio" name={`${ids}-channel`} value={c} checked={activeChannel === c} onChange={() => setChannel(c)} />
                {CHANNEL_LABELS[c]}
              </label>
            ))}
          </div>
          {allowedChannels && <span className="gg-pe-hint">Only the channels you approved are shown.</span>}
        </fieldset>

        <fieldset className="gg-pe-field">
          <legend className="gg-pe-label">Additional shipping insurance</legend>
          <div className="gg-pe-segments">
            <label className={`gg-pe-segment${insured ? " is-on" : ""}`}>
              <input type="radio" name={`${ids}-ins`} checked={insured} onChange={() => setInsured(true)} />
              Yes
            </label>
            <label className={`gg-pe-segment${!insured ? " is-on" : ""}`}>
              <input type="radio" name={`${ids}-ins`} checked={!insured} onChange={() => setInsured(false)} />
              No
            </label>
          </div>
          {insuranceElection != null && (
            <span className="gg-pe-hint">
              Your signed election: {insuranceElection ? "additional insurance approved" : "additional insurance declined"}. Changing this here
              is only for comparison and doesn't change your election.
            </span>
          )}
        </fieldset>

        <div className="gg-pe-field">
          <label className="gg-pe-label" htmlFor={`${ids}-postage`}>
            Estimated outbound postage
          </label>
          <span className="gg-pe-money">
            <span aria-hidden="true">$</span>
            <input
              id={`${ids}-postage`}
              inputMode="decimal"
              autoComplete="off"
              value={postageInput}
              onChange={(e) => setPostageInput(e.target.value)}
              aria-invalid={postageCents == null}
              aria-describedby={`${ids}-postage-hint`}
            />
          </span>
          <span id={`${ids}-postage-hint`} className="gg-pe-hint">
            {postageIsDefault ? (
              <>Typical USPS Ground Advantage postage for one card. An estimate, not a USPS quote.</>
            ) : (
              <>
                Your own postage figure.{" "}
                <button type="button" className="gg-pe-link" onClick={() => setPostageInput(priceText(config.defaultPostageCents))}>
                  Use the typical {formatCents(config.defaultPostageCents)}
                </button>
              </>
            )}
          </span>
        </div>
      </div>

      <div className="gg-pe-result" aria-live="polite">
        {estimate ? (
          <>
            <Breakdown e={estimate} config={config} />
            <div className="gg-pe-total">
              <span className="gg-pe-total__label">Estimated Consignor Payout</span>
              <span className="gg-pe-total__value">{formatCents(estimate.payoutCents)}</span>
              <span className="gg-pe-total__note">{ESTIMATE_FOOTNOTE}</span>
            </div>
            {estimate.insurance.needsManualReview && (
              <p className="gg-pe-warn" role="alert">
                A package worth this much is above what USPS will insure ({formatCents(config.insurance.maxInsurableCents)}). We review packages
                like this before shipping and may use a different service.
              </p>
            )}
          </>
        ) : (
          <p className="gg-pe-empty">Enter a sale price and postage to see an estimate.</p>
        )}
      </div>

      {comparison && (
        <section className="gg-pe-card" aria-labelledby={`${ids}-ins-title`}>
          <h3 id={`${ids}-ins-title`} className="gg-pe-card__title">With or without additional insurance</h3>
          <table className="gg-pe-compare">
            <thead>
              <tr>
                <th scope="col"><span className="gg-pe-sr">Estimate</span></th>
                <th scope="col">With insurance</th>
                <th scope="col">Without</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Estimated insurance cost</th>
                <td>{formatCents(comparison.withInsurance.insuranceCents)}</td>
                <td>{formatCents(0)}</td>
              </tr>
              <tr>
                <th scope="row">Estimated payout</th>
                <td>{formatCents(comparison.withInsurance.payoutCents)}</td>
                <td>{formatCents(comparison.withoutInsurance.payoutCents)}</td>
              </tr>
            </tbody>
          </table>
          {comparison.withInsurance.insurance.includedOnly ? (
            <p className="gg-pe-text">
              A card at this price is covered by the {formatCents(config.insurance.includedCoverageCents)} of insurance that comes with{" "}
              {config.insuranceService}, so no additional insurance would be bought and your estimate is the same either way.
            </p>
          ) : (
            <p className="gg-pe-text">
              Insurance would cost about {formatCents(comparison.withInsurance.insuranceCents)} for a package holding just this card. It's a
              shipping expense, deducted before our commission, so it lowers your estimated payout by about{" "}
              <strong>{formatCents(comparison.payoutDifferenceCents)}</strong>.
            </p>
          )}
          <p className="gg-pe-text">
            <strong>With it</strong>, if USPS loses or damages the package, a claim can cover the card's value up to the insured amount (claims
            aren't guaranteed to be approved). <strong>Without it</strong>, only the included {formatCents(config.insurance.includedCoverageCents)}{" "}
            applies, and you bear any loss above that: a lost card could mean no payout for it.
          </p>
        </section>
      )}

      {byChannel.length > 1 && (
        <section className="gg-pe-card" aria-labelledby={`${ids}-ch-title`}>
          <h3 id={`${ids}-ch-title`} className="gg-pe-card__title">Compare sales channels</h3>
          <div className="gg-pe-scroll">
            <table className="gg-pe-compare">
              <thead>
                <tr>
                  <th scope="col"><span className="gg-pe-sr">Estimate</span></th>
                  {byChannel.map((e) => (
                    <th key={e.channel} scope="col">{CHANNEL_LABELS[e.channel]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Marketplace fees</th>
                  {byChannel.map((e) => <td key={e.channel}>{formatCents(e.marketplaceFeeCents)}</td>)}
                </tr>
                <tr>
                  <th scope="row">Processing</th>
                  {byChannel.map((e) => <td key={e.channel}>{formatCents(e.processingFeeCents)}</td>)}
                </tr>
                <tr>
                  <th scope="row">Postage and insurance</th>
                  {byChannel.map((e) => <td key={e.channel}>{formatCents(e.netPostageCents + e.insuranceCents)}</td>)}
                </tr>
                <tr>
                  <th scope="row">Commission</th>
                  {byChannel.map((e) => <td key={e.channel}>{formatCents(e.commissionCents)}</td>)}
                </tr>
                <tr className="gg-pe-subtotal">
                  <th scope="row">Estimated payout</th>
                  {byChannel.map((e) => <td key={e.channel}>{formatCents(e.payoutCents)}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="gg-pe-text">
            Each channel charges on a different total. eBay's fee includes the buyer's shipping and sales tax, even though neither is part of
            your card's price, and covers payment processing. Account-specific fees and programs can differ.
          </p>
        </section>
      )}

      <p className="gg-pe-fine">{COMBINED_SHIPMENT_NOTE}</p>
      {ratesDate && <p className="gg-pe-fine">Rates as of {ratesDate}.</p>}
    </div>
  );
}

export default PayoutEstimator;
