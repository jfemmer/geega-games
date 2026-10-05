import { useEffect, useState } from "react";
import { Link } from "../lib/router";
import {
  STORE_CREDIT_BONUS_PERCENT,
  ageConditionTiers,
  type SellDefaultCondition,
} from "../lib/sellTypes";
import { GOOGLE_REVIEW_URL, MAX_DRIVE_HOURS } from "../../seo/site";
import {
  SELL_AREAS,
  ST_LOUIS_PATH,
  areaLabel,
  sellAreaPath,
  sellFormPath,
  type SafeExchangeSpot,
} from "../../seo/sellAreas";
import { guidePath, guidesFor, type GuideTopic } from "../../seo/guides";
import { REFERRAL_PAGES } from "../../seo/referralPages";
import {
  SELLER_REVIEWS,
  SELLER_REVIEW_SUMMARY,
  TCGPLAYER_SELLER_URL,
  sellerReviewStats,
} from "../../seo/sellerReviews";

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
// grading, safe meetups and a fast, simple way to ask for an offer. A second
// pass (2026-09-27) added the first-screen promises (HeroPoints), the real
// track record by the buttons (ShopRatingLine) and plainer, more specific
// wording throughout.

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
            {STORE_CREDIT_BONUS_PERCENT}% more on a free Geega Games account (a $100 PayPal offer
            becomes ${100 + STORE_CREDIT_BONUS_PERCENT} in credit). We never ask you to use Friends
            &amp; Family.
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

/**
 * "What you can count on" for the partner-referral pages (Pokémon, One Piece,
 * video games). Only claims that hold for every referral: the owner-approved
 * "buys very competitively", a buyer we know (not a stranger — sellers' main
 * safety worry about Marketplace), consent-only sharing, free and no
 * obligation. Nothing about how the partner pays or how fast — those are the
 * partner's.
 */
export function PartnerTrustSection() {
  return (
    <section className="gg-collect-section gg-collect-trust">
      <h2>What you can count on</h2>
      <div className="gg-collect-grid gg-collect-grid--2">
        <div className="gg-collect-card">
          <h3>A buyer we know, not a stranger</h3>
          <p>
            We send sellers to one buyer we know personally — not an anonymous Marketplace profile —
            because they buy very competitively.
          </p>
        </div>
        <div className="gg-collect-card">
          <h3>Free, with no obligation</h3>
          <p>
            Asking costs nothing. If you don&rsquo;t like the offer, just say no — no hard feelings.
          </p>
        </div>
        <div className="gg-collect-card">
          <h3>Your details, only with your OK</h3>
          <p>
            Nothing is passed along until you tick the consent box. Then it goes only to our buying
            partner, and we never sell your details.
          </p>
        </div>
        <div className="gg-collect-card">
          <h3>Meet up or ship</h3>
          <p>
            Meet up around St. Louis — somewhere public, like a police safe-exchange spot — or ship
            from anywhere in the US.
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * The first-screen promises under a sell page's intro (research, 2026-09-27:
 * put the value where people look first, as a short scannable list).
 */
export function HeroPoints({ points }: { points: string[] }) {
  return (
    <ul className="gg-hero-points">
      {points.map((point) => (
        <li key={point}>{point}</li>
      ))}
    </ul>
  );
}

/** Reviews shown before "Show more" — enough to read at a glance on a phone. */
const REVIEWS_PREVIEW_COUNT = 6;

/** "795 reviews", "1 review" — or "1,204 TCGplayer reviews" with a source. */
function reviewCountLabel(count: number, source?: string): string {
  const noun = `${source ? `${source} ` : ""}review${count === 1 ? "" : "s"}`;
  return `${count.toLocaleString("en-US")} ${noun}`;
}

/**
 * One line of real track record under a sell page's buttons, linking to the
 * reviews section (#reviews). The count is our whole TCGplayer record
 * (sellerReviewStats), not just the reviews quoted on the site. Hidden when
 * there is nothing to show.
 */
export function ShopRatingLine() {
  const { total, average, averageLabel } = sellerReviewStats();
  if (total === 0) return null;
  return (
    <p className="gg-rating-line">
      <Stars rating={Math.round(average)} />{" "}
      <a href="#reviews">
        Rated {averageLabel} out of 5 by our TCGplayer customers ({reviewCountLabel(total)})
      </a>
    </p>
  );
}

/**
 * Real buyer feedback from our TCGplayer seller page (src/seo/sellerReviews.ts).
 * With no reviews loaded it still links to the live page, so visitors can
 * check our record there — never placeholder or invented testimonials.
 */
export function SellerReviewsSection() {
  const [showAll, setShowAll] = useState(false);
  const { positivePercent, sales } = SELLER_REVIEW_SUMMARY;
  const withText = SELLER_REVIEWS.filter((r): r is typeof r & { text: string } => Boolean(r.text));
  const shown = showAll ? withText : withText.slice(0, REVIEWS_PREVIEW_COUNT);
  const hiddenCount = withText.length - REVIEWS_PREVIEW_COUNT;
  const { total, average, averageLabel, onFile } = sellerReviewStats();
  const stats = [
    positivePercent ? `${positivePercent} positive feedback` : null,
    sales ? `${sales} sales` : null,
  ].filter(Boolean);
  // The headline counts our whole TCGplayer record; when that's more than the
  // reviews on file, say plainly that the quotes below are only some of them.
  const whereToCheck =
    total === 0
      ? "You can check our full record there yourself."
      : total > onFile
        ? "Some of those reviews are copied below, word for word, and you can check the full record yourself."
        : "These are copied word for word, and you can check the full record yourself.";

  return (
    <section className="gg-collect-section" id="reviews" aria-labelledby="gg-reviews-heading">
      <h2 id="gg-reviews-heading">{total > 0 ? "What our customers say" : "Check our track record"}</h2>
      {total > 0 && (
        <p className="gg-reviews-summary">
          <Stars rating={Math.round(average)} />
          <span>
            <strong>{averageLabel} out of 5</strong> from {reviewCountLabel(total, "TCGplayer")}
          </span>
        </p>
      )}
      <p className="gg-collect-lead">
        Geega Games also sells on TCGplayer
        {stats.length > 0 ? <> — {stats.join(" across ")}</> : null}, where buyers leave feedback on
        their orders. {whereToCheck}
      </p>
      {shown.length > 0 && (
        <ul className="gg-reviews">
          {shown.map((review) => (
            <li className="gg-review" key={`${review.buyer}-${review.date}`}>
              <Stars rating={review.rating} />
              <blockquote>
                <p>&ldquo;{review.text}&rdquo;</p>
              </blockquote>
              <p className="gg-review-meta">
                {review.buyer} · TCGplayer ·{" "}
                <time dateTime={review.date}>{formatReviewDate(review.date)}</time>
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="gg-area-note gg-reviews-actions">
        {hiddenCount > 0 && (
          <button type="button" className="gg-reviews-more" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer reviews" : `Show ${hiddenCount} more review${hiddenCount === 1 ? "" : "s"}`}
          </button>
        )}
        <a href={TCGPLAYER_SELLER_URL} target="_blank" rel="noopener noreferrer">
          See all our buyer feedback on TCGplayer
        </a>
        <a href={GOOGLE_REVIEW_URL} target="_blank" rel="noopener noreferrer" className="gg-reviews-google">
          Bought or sold with us? Leave a Google review
        </a>
      </p>
    </section>
  );
}

function Stars({ rating }: { rating: number }) {
  const clamped = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span className="gg-stars" role="img" aria-label={`${clamped} out of 5 stars`}>
      {"★★★★★".slice(0, clamped)}
      <span className="gg-stars__off">{"★★★★★".slice(clamped)}</span>
    </span>
  );
}

function formatReviewDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const CONDITION_NAMES: Record<SellDefaultCondition, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};

/**
 * "No surprises" — the offer rules sellers most often complain buyers hide
 * (research, 2026-09-26: offers cut after cards arrive, unclear returns).
 * Owner-approved: age-based starting conditions (the same tiers the sell
 * form uses, from ageConditionTiers), offers can go up or down after we
 * check the cards, and a seller who declines after shipping pays return
 * shipping.
 */
export function NoSurprisesSection() {
  const tiers = ageConditionTiers();
  return (
    <section className="gg-collect-section">
      <h2>No surprises: how we set your offer</h2>
      <p className="gg-collect-lead">
        Until we see your cards in person, each one starts at a condition based on its age, because
        older cards almost always show more wear — even ones that were well looked after:
      </p>
      <ul className="gg-age-tiers">
        {tiers
          .slice()
          .reverse()
          .map((tier) => (
            <li key={tier.condition}>
              <strong>{tier.years}</strong>
              <span>starts at {CONDITION_NAMES[tier.condition]}</span>
            </li>
          ))}
      </ul>
      <ul className="gg-collect-trustlist">
        <li>
          <strong>Your offer can go up or down.</strong> We check every card when it arrives. If a
          card is in better shape than its starting condition, your offer goes up; if it&rsquo;s in
          worse shape, it goes down.
        </li>
        <li>
          <strong>We tell you exactly what changed.</strong> If your offer moves, we&rsquo;ll tell you
          which cards and why — and you still decide whether to accept.
        </li>
        <li>
          <strong>Think a card is in better shape?</strong> Add a front and back photo when you list
          it, and we&rsquo;ll take that into account.
        </li>
        <li>
          <strong>You can still say no.</strong> If you decline after shipping your cards to us, we
          send them back — you just cover the return shipping.
        </li>
      </ul>
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

/**
 * Cross-links from the Magic sell pages to the partner-referral pages
 * (Pokémon, One Piece, video games). The partner meets up around St. Louis
 * and buys by mail from anywhere in the US, so pages outside St. Louis say
 * "ship" rather than implying the partner travels there.
 */
export function PartnerCategoriesSection({ local = true }: { local?: boolean }) {
  return (
    <section className="gg-collect-section gg-partner-callout">
      <h2>Selling Pokémon, One Piece or video games too?</h2>
      <p className="gg-collect-lead">
        Plenty of Magic collections come with other things. We buy the Magic cards ourselves, and
        for the rest we connect you with a trusted buyer we work with — one who{" "}
        <strong>buys very competitively</strong>.{" "}
        {local
          ? "Same easy process: tell us what you have, then meet up around St. Louis or ship."
          : "Same easy process: tell us what you have and ship it from anywhere in the US."}
      </p>
      <ul className="gg-area-links">
        {REFERRAL_PAGES.map((p) => (
          <li key={p.path}>
            <Link to={p.path}>Sell {p.noun}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SellerGuidesSection({
  topic = "mtg",
  alsoTopics = [],
}: {
  topic?: GuideTopic;
  /** Extra topics to list after the main one, e.g. ["st_louis"] on local pages. */
  alsoTopics?: GuideTopic[];
}) {
  const guides = [topic, ...alsoTopics].flatMap((t) => guidesFor(t));
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
  primary,
}: {
  heading: string;
  text: string;
  handoff?: "local" | "ship";
  buttonLabel?: string;
  /**
   * An in-page main action (e.g. the quick photo quote). When set, it's the
   * main button and the link to the sell form becomes the second one.
   */
  primary?: { label: string; href: string };
}) {
  const formLink = (
    <Link to={sellFormPath(handoff)} className={primary ? "gg-btn gg-btn-ghost" : "gg-btn"}>
      {buttonLabel}
    </Link>
  );
  return (
    <section className="gg-collect-cta">
      <h2>{heading}</h2>
      <p>{text}</p>
      {primary ? (
        <div className="gg-collect-hero-actions">
          <a href={primary.href} className="gg-btn">
            {primary.label}
          </a>
          {formLink}
        </div>
      ) : (
        formLink
      )}
    </section>
  );
}
