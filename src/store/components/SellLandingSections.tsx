import { useEffect, useState } from "react";
import { Link } from "../lib/router";
import { STORE_CREDIT_BONUS_PERCENT } from "../lib/sellTypes";
import { MAX_DRIVE_HOURS } from "../../seo/site";
import {
  SELL_AREAS,
  ST_LOUIS_PATH,
  areaLabel,
  sellAreaPath,
  sellFormPath,
  type SafeExchangeSpot,
} from "../../seo/sellAreas";
import { guidePath, guidesFor, type GuideTopic } from "../../seo/guides";

// Sections shared by the sell landing pages (/sell-my-collection, the St.
// Louis page and each /sell-magic-cards/:area page). Place-specific content
// lives on the pages themselves; only genuinely identical facts (what we buy,
// how we pay, where we travel) are shared here.
//
// Owner's content rule: no payout-percentage or turnaround promises. The one
// approved number is the store-credit bonus (STORE_CREDIT_BONUS_PERCENT).
//
// Several sections here came out of seller research (2026-09-25): what makes
// people pick a buyer is protected payment, no pressure, fair condition
// grading, safe meetups and a fast, simple way to ask for an offer.

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

/**
 * "What you can count on" — the promises sellers care most about (research,
 * 2026-09-25: payment protection, no pressure, fair condition grading). Only
 * things that are already true; nothing about payout amounts or timing.
 */
export function TrustSection() {
  return (
    <section className="gg-collect-section gg-collect-trust">
      <h2>What you can count on</h2>
      <div className="gg-collect-grid gg-collect-grid--2">
        <div className="gg-collect-card">
          <h3>Protected payment</h3>
          <p>
            PayPal Goods &amp; Services, protected for both of us, or store credit worth{" "}
            {STORE_CREDIT_BONUS_PERCENT}% more on a free Geega Games account. We never ask you to use
            Friends &amp; Family.
          </p>
        </div>
        <div className="gg-collect-card">
          <h3>No obligation</h3>
          <p>You get one clear offer on the whole lot and decide from there. Saying no is fine.</p>
        </div>
        <div className="gg-collect-card">
          <h3>A real person, every card</h3>
          <p>
            Someone who knows Magic looks at every card — not an automated bulk calculator — and
            you can ask questions along the way.
          </p>
        </div>
        <div className="gg-collect-card">
          <h3>Clear condition standards</h3>
          <p>
            We grade by our published <Link to="/condition-guide">condition guide</Link>, and at
            meetups we go through the cards with you.
          </p>
        </div>
      </div>
    </section>
  );
}

/** Store-credit bonus, surfaced near the top of the Magic sell pages. */
export function CreditBonusBadge() {
  return (
    <p className="gg-credit-badge">
      Take store credit and get <strong>{STORE_CREDIT_BONUS_PERCENT}% more</strong>
    </p>
  );
}

/**
 * Where we meet and how to stay safe. `spots` are official police/campus
 * safe-exchange locations (verified — see SafeExchangeSpot); `areas` names
 * the places we meet around a city.
 */
export function MeetupSafetySection({
  place,
  areas,
  spots = [],
}: {
  place: string;
  areas?: string[];
  spots?: SafeExchangeSpot[];
}) {
  return (
    <section className="gg-collect-section">
      <h2>Where we meet — and staying safe</h2>
      <p className="gg-collect-lead">
        We always meet somewhere public in or near {place} that you&rsquo;re comfortable with.
        {areas && areas.length > 0 ? ` We meet sellers across ${joinAnd(areas)}.` : ""}
      </p>
      {spots.length > 0 && (
        <>
          <p className="gg-collect-lead">
            <strong>Police-designated safe exchange spots nearby:</strong>
          </p>
          <ul className="gg-safe-spots">
            {spots.map((spot) => (
              <li key={spot.sourceUrl}>
                <strong>{spot.town}:</strong> {spot.name}{" "}
                <a href={spot.sourceUrl} target="_blank" rel="noopener noreferrer">
                  (details)
                </a>
              </li>
            ))}
          </ul>
          <p className="gg-area-note">Check the official page for hours and rules before you go.</p>
        </>
      )}
      <ul className="gg-collect-trustlist">
        <li>
          Meet in daylight somewhere busy — a police safe exchange spot, a coffee shop, a library
          or a bank lobby.
        </li>
        <li>Bring someone along if you like, or let a friend know where you&rsquo;ll be.</li>
        <li>
          You&rsquo;re paid by PayPal Goods &amp; Services or store credit. We&rsquo;ll never ask you
          to use Friends &amp; Family, send a &ldquo;test&rdquo; payment or refund an overpayment —
          anyone who does is running a scam.
        </li>
        <li>
          Large collection that&rsquo;s hard to move? Tell us in the form and we&rsquo;ll work out
          the easiest option together.
        </li>
      </ul>
    </section>
  );
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Why a current offer matters for Magic: reprints move prices (research, 2026-09-25). */
export function PricesMoveSection() {
  return (
    <section className="gg-collect-section">
      <h2>Why a current offer matters</h2>
      <p className="gg-collect-lead">
        Magic prices move. When a popular card is reprinted — in a Commander precon, a Secret Lair or
        a new set — its price can drop quickly, often as soon as the reprint is announced. If
        you&rsquo;ve decided to sell cards you don&rsquo;t play anymore, a current offer takes that
        risk off the table.
      </p>
    </section>
  );
}

/**
 * Phone-only call to action that stays at the bottom of the screen while the
 * page scrolls (position: sticky inside the page, so it never covers the
 * footer). When `targetId` is on screen — the form itself — it hides.
 */
export function StickySellCta({
  label,
  to,
  targetId,
}: {
  label: string;
  /** An in-page anchor ("#quick-quote") or a site path ("/sell?handoff=local"). */
  to: string;
  targetId?: string;
}) {
  const [targetVisible, setTargetVisible] = useState(false);

  useEffect(() => {
    if (!targetId || typeof IntersectionObserver === "undefined") return;
    const el = document.getElementById(targetId);
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setTargetVisible(entry.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, [targetId]);

  return (
    <div className={`gg-sticky-cta${targetVisible ? " gg-sticky-cta--hidden" : ""}`}>
      {to.startsWith("#") ? (
        <a href={to} className="gg-btn">
          {label}
        </a>
      ) : (
        <Link to={to} className="gg-btn">
          {label}
        </Link>
      )}
    </div>
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

export function SellerGuidesSection({ topic = "mtg" }: { topic?: GuideTopic }) {
  const guides = guidesFor(topic);
  if (guides.length === 0) return null;
  return (
    <section className="gg-collect-section">
      <h2>Not sure what you have?</h2>
      <ul className="gg-guide-links">
        {guides.map((guide) => (
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
