import { useRef, type CSSProperties } from "react";
import { QrCode } from "./QrCode";
import { formatSignPrice } from "../../utils/yardSaleSign";
import type { FlyerJob } from "./FlyerPrintView";

// The printed sign for the yard sale table (FlyerPrintView, layout
// "yard-sale"; utils/yardSaleSign.ts builds the job). Read from a few feet
// away by people browsing bins of cards, so it does three things in order:
// says the good cards are online (the headline), shows a few of them with
// their yard sale prices (the shelf, the one bold element), and gets a scan
// (QR code with the three steps). Inter only, as everywhere on the site;
// violet only on prices, the QR frame and the step numbers. Sizes are real
// inches and points, so it prints 1:1 on US Letter.

export function YardSaleSign({ job, onImagesSettled }: { job: FlyerJob; onImagesSettled?: () => void }) {
  const { copy } = job;
  const showcase = job.yardSale?.showcase ?? [];
  // No cards to feature (none with a picture, or they couldn't be loaded):
  // the QR code gets the room instead.
  const plain = showcase.length === 0;
  const discountPercent = job.yardSale?.discountPercent ?? 0;
  const printedAt = job.yardSale?.printedAt;
  const printedOn = printedAt
    ? new Date(printedAt).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    : null;

  // Print waits for the card pictures (FlyerPrintView), so tell it once each
  // one has loaded or failed.
  const settled = useRef(0);
  function settle() {
    settled.current += 1;
    if (settled.current === showcase.length) onImagesSettled?.();
  }

  return (
    <article className={`gg-flyer gg-ysign${plain ? " gg-ysign--plain" : ""}`} data-testid="yard-sale-sign">
      <header className="gg-ysign__band">
        <img className="gg-ysign__logo" src="/logo-black-background.png" alt="Geega Games" />
        <p className="gg-ysign__what">Magic: The Gathering singles</p>
      </header>

      <div className="gg-ysign__body">
        <div className="gg-ysign__intro">
          <h1 className="gg-ysign__headline">{copy.headline}</h1>
          <p className="gg-ysign__lede">
            Our best cards aren&rsquo;t on these tables. They&rsquo;re on our website, and we&rsquo;ll grab them
            for you.
          </p>
          {job.extraLine && <p className="gg-ysign__extra">{job.extraLine}</p>}
        </div>

        {!plain && (
          <section className="gg-ysign__shelf" aria-label="Featured cards">
            <p className="gg-ysign__shelfnote">A few of our best, at yard sale prices</p>
            <ul className="gg-ysign__cards" style={{ "--gg-ysign-cols": showcase.length } as CSSProperties}>
              {showcase.map((card) => (
                <li key={card.id} className="gg-ysign__card">
                  <img
                    className="gg-ysign__art"
                    src={card.imageUrl}
                    alt={card.name}
                    loading="eager"
                    width={488}
                    height={680}
                    onLoad={settle}
                    onError={settle}
                  />
                  <span className="gg-ysign__name">
                    {card.name}
                    {card.foil && <span className="gg-ysign__foil">Foil</span>}
                  </span>
                  <span className="gg-ysign__price">
                    <strong>{formatSignPrice(card.salePriceCents)}</strong>
                    {card.salePriceCents < card.priceCents && (
                      <s aria-label={`was ${formatSignPrice(card.priceCents)}`}>{formatSignPrice(card.priceCents)}</s>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="gg-ysign__scan" aria-label="How to shop">
          <div className="gg-ysign__qr">
            <QrCode value={job.url} size={240} label={`QR code for ${job.address}`} />
          </div>
          <div className="gg-ysign__how">
            <p className="gg-ysign__cta">{copy.cta}</p>
            <ol className="gg-ysign__steps">
              {copy.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ol>
            <p className="gg-ysign__url">{job.address}</p>
          </div>
        </section>
      </div>

      <footer className="gg-ysign__foot">
        <p>
          {discountPercent > 0
            ? `Yard sale prices are ${discountPercent}% off our website prices, rounded to whole dollars.`
            : "Yard sale prices are our website prices, rounded down to whole dollars."}
        </p>
        {!plain && printedOn && <p>Featured prices as of {printedOn}, while they last.</p>}
      </footer>
    </article>
  );
}
