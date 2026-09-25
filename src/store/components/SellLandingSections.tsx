import { Link } from "../lib/router";
import { STORE_CREDIT_BONUS_PERCENT } from "../lib/sellTypes";
import { MAX_DRIVE_HOURS } from "../../seo/site";
import { SELL_AREAS, ST_LOUIS_PATH, areaLabel, sellAreaPath, sellFormPath } from "../../seo/sellAreas";
import { GUIDES, guidePath } from "../../seo/guides";

// Sections shared by the sell landing pages (/sell-my-collection, the St.
// Louis page and each /sell-magic-cards/:area page). Place-specific content
// lives on the pages themselves; only genuinely identical facts (what we buy,
// how we pay, where we travel) are shared here.
//
// Owner's content rule: no payout-percentage or turnaround promises. The one
// approved number is the store-credit bonus (STORE_CREDIT_BONUS_PERCENT).

const WHAT_WE_BUY: { title: string; text: string }[] = [
  {
    title: "Whole collections",
    text: "Binders, boxes and storage totes — sorted or completely unsorted, big or small.",
  },
  {
    title: "Singles & staples",
    text: "Commander staples, format playables and the chase rares from recent sets.",
  },
  {
    title: "Older & vintage cards",
    text: "Cards from the '90s and early 2000s, including Reserved List cards and old-frame printings.",
  },
  {
    title: "Decks",
    text: "Commander decks, precons and constructed decks, built or half-finished.",
  },
  {
    title: "Foils & special printings",
    text: "Foils, borderless, showcase, extended-art and other special versions.",
  },
  {
    title: "Bulk & sealed product",
    text: "Commons, uncommons and bulk rares by the box, plus sealed packs, boxes and precons.",
  },
];

export function WhatWeBuySection({ heading = "What we buy" }: { heading?: string }) {
  return (
    <section className="gg-collect-section">
      <h2>{heading}</h2>
      <div className="gg-collect-grid">
        {WHAT_WE_BUY.map((item) => (
          <div className="gg-collect-card" key={item.title}>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function HowYouGetPaidSection() {
  return (
    <section className="gg-collect-section gg-collect-trust">
      <h2>How you get paid</h2>
      <ul className="gg-collect-trustlist">
        <li>
          <strong>PayPal Goods &amp; Services</strong> — protected for both of us. We never ask
          sellers to use Friends &amp; Family.
        </li>
        <li>
          <strong>Store credit worth {STORE_CREDIT_BONUS_PERCENT}% more</strong> than the PayPal
          amount, saved to a free Geega Games account and good on any singles in our shop.
        </li>
        <li>No obligation: you get a clear offer on the whole collection and decide from there.</li>
      </ul>
    </section>
  );
}

export function MeetupHowItWorks({ place }: { place: string }) {
  return (
    <ol className="gg-collect-steps">
      <li>
        <strong>Tell us about the collection.</strong> Roughly how much you have and what kind of
        cards it is. A few photos of binder pages or boxes help a lot, especially for a longer
        trip — &ldquo;not sure&rdquo; is a fine answer to anything.
      </li>
      <li>
        <strong>We plan the meetup together.</strong> We&rsquo;ll pick a day and a public spot in
        or near {place} that works for you.
      </li>
      <li>
        <strong>We go through the cards with you.</strong> Every card gets looked at, not just the
        ones that look valuable at a glance, and you can ask questions as we go.
      </li>
      <li>
        <strong>You get an offer — no obligation.</strong> One straightforward offer on the whole
        collection. If you say yes, you choose PayPal or store credit.
      </li>
    </ol>
  );
}

/** Links to every place we buy in person. `exclude` hides the current page's own area. */
export function AreaLinks({ exclude }: { exclude?: string }) {
  return (
    <ul className="gg-area-links">
      {exclude !== "st-louis" && (
        <li>
          <Link to={ST_LOUIS_PATH}>St. Louis, MO</Link>
        </li>
      )}
      {SELL_AREAS.filter((a) => a.slug !== exclude).map((area) => (
        <li key={area.slug}>
          <Link to={sellAreaPath(area.slug)}>{areaLabel(area)}</Link>
        </li>
      ))}
    </ul>
  );
}

export function TravelAreasSection({ heading, exclude }: { heading?: string; exclude?: string }) {
  return (
    <section className="gg-collect-section">
      <h2>{heading ?? `We drive up to about ${MAX_DRIVE_HOURS} hours from St. Louis`}</h2>
      <p className="gg-collect-lead">
        For collections, we&rsquo;ll come to you anywhere within about a {MAX_DRIVE_HOURS}-hour drive
        of St. Louis — across Missouri and Illinois and into Kansas, Iowa, Indiana, Kentucky,
        Tennessee, Arkansas and Oklahoma. Pick your area for details on the trip:
      </p>
      <AreaLinks exclude={exclude} />
      <p className="gg-collect-lead">
        Not on the list? If you&rsquo;re within that range, we&rsquo;ll still come — and from
        anywhere else in the US, you can <Link to={sellFormPath("ship")}>ship your cards to us</Link>.
      </p>
    </section>
  );
}

export function SellerGuidesSection() {
  return (
    <section className="gg-collect-section">
      <h2>Not sure what you have?</h2>
      <ul className="gg-guide-links">
        {GUIDES.map((guide) => (
          <li key={guide.slug}>
            <Link to={guidePath(guide.slug)}>{guide.heading}</Link>
            <span>{guide.summary}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FaqSection({ items }: { items: { question: string; answer: string }[] }) {
  return (
    <section className="gg-collect-section">
      <h2>Frequently asked questions</h2>
      <div className="gg-faq">
        {items.map((item) => (
          <details className="gg-faq-item" key={item.question}>
            <summary>{item.question}</summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function SellCtaSection({
  heading,
  text,
  handoff,
  buttonLabel = "Get an offer",
}: {
  heading: string;
  text: string;
  handoff?: "local" | "ship";
  buttonLabel?: string;
}) {
  return (
    <section className="gg-collect-cta">
      <h2>{heading}</h2>
      <p>{text}</p>
      <Link to={sellFormPath(handoff)} className="gg-btn">
        {buttonLabel}
      </Link>
    </section>
  );
}
