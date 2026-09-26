import { Link } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import { SUPPORT_EMAIL } from "./StaticPages";
import { STORE_CREDIT_BONUS_PERCENT } from "../lib/sellTypes";
import {
  CreditBonusBadge,
  FaqSection,
  PricesMoveSection,
  SellCtaSection,
  SellerGuidesSection,
  SellerReviewsSection,
  StickySellCta,
  TravelAreasSection,
  NoSurprisesSection,
  TrustSection,
  WhatWeBuySection,
} from "../components/SellLandingSections";
import QuickPhotoQuote from "../components/QuickPhotoQuote";
import { ST_LOUIS_PATH, sellFormPath } from "../../seo/sellAreas";
import { REFERRAL_PAGES } from "../../seo/referralPages";
import {
  HUB_CITY,
  MAX_DRIVE_HOURS,
  ORGANIZATION_ID,
  SERVICE_STATES,
  breadcrumbJsonLd,
  faqJsonLd,
  serviceAreaServed,
} from "../../seo/site";

// The main "sell your Magic cards" landing page — the national hub for
// searches like "sell magic cards", "sell my magic cards", "sell mtg
// collection", "we buy magic cards". The full intake form is /sell (card-by-
// card lists); this page carries the content plus the one-screen quick photo
// quote (QuickPhotoQuote), which feeds the same /api/sell/submit pipeline. Local and regional searches
// have their own pages (/sell-magic-cards/st-louis and /sell-magic-cards/:area),
// all linked from here.
//
// Content rule from the business owner: no payout-percentage or fixed-
// turnaround claims anywhere on this page — those aren't finalized, and
// promising a number here would be a claim we can't back up at checkout time.
// One approved exception (2026-09-25): the store-credit BONUS relative to
// the PayPal offer (STORE_CREDIT_BONUS_PERCENT), which the offer page and
// /api/sell/respond-to-offer actually honor.

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "Where can I sell my Magic cards?",
    answer:
      "You have five main options. List them yourself on TCGplayer or eBay (the most money per card, but roughly 13% or more in fees plus all the listing and shipping work). Sell to an online buylist (quick, but you look up and ship every card yourself). Sell to a local game store (fast, but many only buy what they need). Or sell everything at once to a collection buyer like us — one offer for the whole lot, sorted or not, by mail or in person. Our Where to sell Magic cards guide compares them in detail.",
  },
  {
    question: "How do you pay?",
    answer: `Your choice when you accept our offer: PayPal Goods & Services, or Geega Games store credit worth ${STORE_CREDIT_BONUS_PERCENT}% more than the PayPal amount. Store credit is saved to a free account and works on any singles in our shop.`,
  },
  {
    question: "What if my cards are in better or worse condition than I thought?",
    answer:
      "Until we see them, each card starts at a condition based on its age: 2005 or earlier at Heavily Played, 2006–2015 at Moderately Played, newer cards at Lightly Played, and brand-new cards at Near Mint. We check every card when it arrives, and your offer goes up or down to match what's really there — we'll tell you which cards changed and why.",
  },
  {
    question: "What if I ship my cards and then decline the offer?",
    answer:
      "That's fine — there's no obligation. We send your cards back, and you cover the return shipping.",
  },
  {
    question: "Does my collection need to be sorted first?",
    answer:
      "No. Ship it or meet up with it exactly as it is — in binders, boxes, bags, or a mix of all three. Sorting it yourself doesn't get you a better offer, and for a large collection it usually just delays things.",
  },
  {
    question: "I have no idea what any of this is worth. Is that a problem?",
    answer:
      "Not at all. Most people selling a large collection haven't priced it and don't need to. We go through everything and make an offer based on what's actually there.",
  },
  {
    question: "Can we meet in person, or do I have to ship it?",
    answer: `Either works. In the ${HUB_CITY} area we're glad to meet up in person. For collections, we'll also drive to you anywhere within about a ${MAX_DRIVE_HOURS}-hour drive of ${HUB_CITY} — Kansas City, Chicago, Indianapolis, Louisville, Nashville, Memphis and everywhere in between. From anywhere else in the US, ship it to us. Tell us your preference in the form.`,
  },
  {
    question: "Will you really drive a few hours for my collection?",
    answer:
      "For a collection, yes — that's the point. For longer trips we'll ask for a few photos and a rough idea of what's there first, so we can plan the day and make sure the trip makes sense for both of us. A handful of singles is usually easier to ship.",
  },
  {
    question: "Where do we meet?",
    answer:
      "Somewhere public that you're comfortable with. Coffee shops, libraries and game stores work well, and many police departments have designated safe-exchange spots. For a very large collection that's hard to move, tell us in the form and we'll work out the easiest option.",
  },
  {
    question: "Is there a minimum?",
    answer:
      "No. A few good singles or a few thousand cards are both fine. For a handful of cards, our Sell page lets you add each card individually; for binders, boxes or anything unsorted, the quick photo quote on this page is the fastest way in.",
  },
  {
    question: "I just want to sell a few Magic cards, not a whole collection. Can I?",
    answer:
      "Yes. Use our Sell page to search for and add your cards one at a time in a couple of clicks, or send a few photos through the quick photo quote on this page — whichever is easier.",
  },
  {
    question: "What if it's a mix of valuable cards and bulk commons?",
    answer:
      "That's the normal case, not an edge case. Most real collections are a mix — a few cards worth looking at closely and a lot that aren't. Send it all; we sort out what's what.",
  },
  {
    question: "Do I have to live near you to sell my collection?",
    answer: `No — shipping in works from anywhere in the US. We're based in ${HUB_CITY}, and for sellers within about a ${MAX_DRIVE_HOURS}-hour drive — including ${SERVICE_STATES.join(", ")} — meeting in person is an option too.`,
  },
];

// No walk-in storefront (meetups and mail-in only), so this is Service +
// areaServed rather than LocalBusiness — LocalBusiness implies a visitable
// address, which would be inaccurate here.
const JSON_LD = [
  breadcrumbJsonLd([{ name: "Sell your collection", path: "/sell-my-collection" }]),
  {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Magic: The Gathering card and collection buying",
    name: "Sell your Magic: The Gathering cards",
    provider: { "@id": ORGANIZATION_ID },
    areaServed: [...serviceAreaServed(), { "@type": "Country", name: "United States" }],
    description: `Geega Games buys Magic: The Gathering collections and singles: by mail from anywhere in the US, in person around ${HUB_CITY}, and by travelling to sellers within about a ${MAX_DRIVE_HOURS}-hour drive of ${HUB_CITY}, MO.`,
  },
  faqJsonLd(FAQ_ITEMS),
];

export default function SellCollectionPage() {
  useSEO({
    title: "Sell Magic Cards & MTG Collections | Geega Games",
    description: `Sell your Magic: The Gathering cards — one card or a whole collection. Ship from anywhere in the US, meet up in ${HUB_CITY}, or we'll drive to you (about ${MAX_DRIVE_HOURS} hours). Unsorted is fine.`,
    path: "/sell-my-collection",
    jsonLd: JSON_LD,
  });

  return (
    <div className="gg-page">
      <section className="gg-collect-hero">
        <h1>Sell your Magic cards — one card or a whole collection</h1>
        <p className="gg-collect-hero-sub">
          A few valuable singles, binders you haven&rsquo;t opened in years, or boxes of Magic: The
          Gathering trading cards from a basement or an estate. Ship them to us from anywhere in the
          US, meet up with us in {HUB_CITY}, or we&rsquo;ll drive to you — no sorting, no pricing
          spreadsheet, no cleanup required on your end.
        </p>
        <CreditBonusBadge />
        <div className="gg-collect-hero-actions">
          <a href="#quick-quote" className="gg-btn">
            Get a quick photo quote
          </a>
          <Link to="/sell" className="gg-btn gg-btn-ghost">
            List cards one by one
          </Link>
        </div>
      </section>

      <section className="gg-collect-section">
        <h2>Three ways to sell</h2>
        <div className="gg-collect-grid">
          <div className="gg-collect-card">
            <h3>Ship it from anywhere</h3>
            <p>
              Anywhere in the US: tell us what you have, pack it up, and get an offer on the whole
              thing. <Link to={sellFormPath("ship")}>Ship your cards</Link>
            </p>
          </div>
          <div className="gg-collect-card">
            <h3>Meet up in {HUB_CITY}</h3>
            <p>
              We&rsquo;re local. Meet anywhere in the metro, Missouri or Illinois side — even for a
              few good cards. <Link to={ST_LOUIS_PATH}>Selling in St. Louis</Link>
            </p>
          </div>
          <div className="gg-collect-card">
            <h3>We come to you</h3>
            <p>
              For collections, we drive up to about {MAX_DRIVE_HOURS} hours from {HUB_CITY} — from
              Kansas City to Chicago, Nashville and beyond. <a href="#areas">See where we travel</a>
            </p>
          </div>
        </div>
      </section>

      <section className="gg-collect-section" id="quick-quote">
        <h2>Get a quick photo quote</h2>
        <p className="gg-collect-lead">
          Snap a few photos — binder pages, box tops, anything that looks valuable — add your contact
          details, and we&rsquo;ll come back with an offer. No card-by-card list needed.
        </p>
        <div className="gg-referral-card">
          <QuickPhotoQuote />
        </div>
      </section>

      <section className="gg-collect-section gg-partner-callout">
        <h2>Selling Pokémon, One Piece or video games too?</h2>
        <p className="gg-collect-lead">
          Plenty of Magic collections come with other things. We buy the Magic cards ourselves, and
          for the rest we connect you with a trusted buyer we work with — one who{" "}
          <strong>pays very competitively</strong>. Same easy process: tell us what you have, meet up
          around {HUB_CITY} or ship.
        </p>
        <ul className="gg-area-links">
          {REFERRAL_PAGES.map((p) => (
            <li key={p.path}>
              <Link to={p.path}>Sell {p.noun}</Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="gg-collect-section">
        <h2>Built for collections that haven&rsquo;t been touched in years</h2>
        <div className="gg-collect-grid">
          <div className="gg-collect-card">
            <h3>Inherited or estate collections</h3>
            <p>
              Sorting through someone else&rsquo;s cards is hard enough without also having
              to learn what any of it is worth. Hand it over as-is and we&rsquo;ll take it from
              there.
            </p>
          </div>
          <div className="gg-collect-card">
            <h3>Old bulk and mixed boxes</h3>
            <p>
              Commons, foils, old rares, sealed packs, half-built decks — a real collection is
              rarely one clean category. That mix is exactly what we look through every day.
            </p>
          </div>
          <div className="gg-collect-card">
            <h3>&ldquo;Not sure what I even have&rdquo;</h3>
            <p>
              You don&rsquo;t need to know the set names, the rarities, or which cards are
              worth looking at closely. That&rsquo;s our job, not yours.
            </p>
          </div>
        </div>
      </section>

      <section className="gg-collect-section">
        <h2>How it works</h2>
        <ol className="gg-collect-steps">
          <li>
            <strong>Tell us about the collection.</strong> A couple of quick questions —
            roughly how much you have and what kind of cards are in it. &ldquo;Not sure&rdquo;
            is a fine answer to any of them.
          </li>
          <li>
            <strong>Choose ship or meet up.</strong> Prefer to box it up and ship it to us? Prefer to
            meet in person — in {HUB_CITY}, or with us driving to you? Either is fine; let us know
            which works better for you.
          </li>
          <li>
            <strong>We go through everything.</strong> Every card gets looked at, not just the
            ones that look valuable at a glance.
          </li>
          <li>
            <strong>You get an offer.</strong> Straightforward, on the whole collection, with
            no obligation until you say yes.
          </li>
        </ol>
      </section>

      <WhatWeBuySection />

      <TrustSection />

      <NoSurprisesSection />

      <SellerReviewsSection />

      <PricesMoveSection />

      <div id="areas">
        <TravelAreasSection />
      </div>

      <SellerGuidesSection />

      <FaqSection items={FAQ_ITEMS} />
      <p className="gg-collect-contact">
        Still have a question first? Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>{" "}
        and describe what you have — no need to sort or count anything before you write in.
      </p>

      <SellCtaSection
        heading="Ready to sell your Magic cards?"
        text="A few singles or a whole collection — unsorted, mixed or inherited is fine. List your cards one by one, or use the quick photo quote above."
        buttonLabel="List cards one by one"
      />

      <StickySellCta label="Get a quick photo quote" to="#quick-quote" targetId="quick-quote" />
    </div>
  );
}
