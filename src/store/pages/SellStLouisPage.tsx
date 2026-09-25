import { Link } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import {
  CreditBonusBadge,
  FaqSection,
  MeetupHowItWorks,
  MeetupSafetySection,
  SellCtaSection,
  SellerGuidesSection,
  StickySellCta,
  TravelAreasSection,
  TrustSection,
  WhatWeBuySection,
} from "../components/SellLandingSections";
import QuickPhotoQuote from "../components/QuickPhotoQuote";
import { STORE_CREDIT_BONUS_PERCENT } from "../lib/sellTypes";
import {
  ST_LOUIS_DAY_TRIPS,
  ST_LOUIS_MEETUP_AREAS,
  ST_LOUIS_METRO,
  ST_LOUIS_PATH,
  ST_LOUIS_SAFE_SPOTS,
  joinList,
  sellFormPath,
} from "../../seo/sellAreas";
import { ORGANIZATION_ID, breadcrumbJsonLd, faqJsonLd } from "../../seo/site";

// /sell-magic-cards/st-louis — the local page: people in the St. Louis metro
// searching "sell magic cards st louis" / "saint louis" / "stl", "mtg buyer
// st louis", etc. Local sellers get the one thing no mail-in buylist can
// offer: meet in person, even for a handful of cards. "Saint Louis" and "STL"
// appear once or twice in the copy and as schema alternate names — never
// stuffed into the title or heading.

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "Can I sell just a few cards, or does it have to be a whole collection?",
    answer:
      "Around St. Louis, a few good singles is plenty — we'll meet up for small sales as well as whole collections. You can also list individual cards on our Sell page and get an offer without meeting at all.",
  },
  {
    question: "Where do we meet?",
    answer:
      "Somewhere public and convenient for you — anywhere in St. Louis City and County, St. Charles and Jefferson counties, Washington, MO, Union or the Metro East. Chesterfield and Lake Saint Louis police both have designated safe exchange spots, and the Union Police Department's lobby is open for exchanges. Coffee shops, libraries and bank lobbies work well too. For a large collection that's hard to move, tell us in the form and we'll work out the easiest option.",
  },
  {
    question: "Do you meet in Washington, MO?",
    answer:
      "Yes. Washington and the rest of Franklin County are part of our meetup area. The closest police-designated exchange spot is the Union Police Department's lobby, a short drive away — or we can meet anywhere public in Washington that suits you.",
  },
  {
    question: "Do you buy on the Illinois side of the river?",
    answer:
      "Yes. Belleville, O'Fallon, Edwardsville, Collinsville, Alton and the rest of the Metro East are local for us, just like St. Charles County and Jefferson County on the Missouri side.",
  },
  {
    question: "How do you pay?",
    answer: `Your choice when you accept our offer: PayPal Goods & Services, or Geega Games store credit worth ${STORE_CREDIT_BONUS_PERCENT}% more than the PayPal amount.`,
  },
  {
    question: "Do my cards need to be sorted or priced first?",
    answer:
      "No. Bring them exactly as they are — binders, boxes, bags or a mix. We go through everything, so sorting or pricing it yourself doesn't change the offer.",
  },
  {
    question: "I'm outside St. Louis. Can I still meet up?",
    answer:
      "For collections, yes — we drive up to about 6 hours from St. Louis, from Kansas City and Des Moines to Chicago, Indianapolis, Louisville, Nashville, Memphis, Little Rock and Tulsa. Anywhere else in the US, you can ship your cards to us.",
  },
];

const JSON_LD = [
  breadcrumbJsonLd([
    { name: "Sell your collection", path: "/sell-my-collection" },
    { name: "St. Louis, MO", path: ST_LOUIS_PATH },
  ]),
  {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Magic: The Gathering card and collection buying",
    name: "Sell Magic: The Gathering cards in St. Louis",
    provider: { "@id": ORGANIZATION_ID },
    areaServed: [
      {
        "@type": "City",
        name: "St. Louis",
        alternateName: ["Saint Louis", "STL"],
        containedInPlace: { "@type": "State", name: "Missouri" },
      },
      { "@type": "City", name: "Washington", containedInPlace: { "@type": "State", name: "Missouri" } },
      { "@type": "AdministrativeArea", name: "St. Louis County, Missouri" },
      { "@type": "AdministrativeArea", name: "St. Charles County, Missouri" },
      { "@type": "AdministrativeArea", name: "Jefferson County, Missouri" },
      { "@type": "AdministrativeArea", name: "Franklin County, Missouri" },
      { "@type": "AdministrativeArea", name: "St. Clair County, Illinois" },
      { "@type": "AdministrativeArea", name: "Madison County, Illinois" },
    ],
    description:
      "Geega Games is based in St. Louis and meets sellers in person anywhere in the metro, on the Missouri and Illinois sides, to buy Magic: The Gathering cards and collections.",
  },
  faqJsonLd(FAQ_ITEMS),
];

export default function SellStLouisPage() {
  useSEO({
    title: "Sell Magic Cards in St. Louis — Local MTG Buyer | Geega Games",
    description:
      "Sell your Magic: The Gathering cards or collection in St. Louis. We're local: meet up anywhere in the metro, Missouri or Illinois side. Singles, binders, bulk and unsorted collections.",
    path: ST_LOUIS_PATH,
    jsonLd: JSON_LD,
  });

  return (
    <div className="gg-page">
      <nav className="gg-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/sell-my-collection">Sell your collection</Link> <span aria-hidden="true">/</span>{" "}
        <span>St. Louis, MO</span>
      </nav>

      <section className="gg-collect-hero">
        <h1>Sell Magic: The Gathering cards in St. Louis</h1>
        <p className="gg-collect-hero-sub">
          Geega Games is based right here in Saint Louis. Meet up with us anywhere in the metro — on
          the Missouri or Illinois side, and out to Washington, MO — to sell a few valuable singles
          or an entire collection. Rather not meet? Ship your cards or list them online instead.
        </p>
        <CreditBonusBadge />
        <div className="gg-collect-hero-actions">
          <a href="#quick-quote" className="gg-btn">
            Get a quick photo quote
          </a>
          <Link to={sellFormPath("local")} className="gg-btn gg-btn-ghost">
            Set up a meetup
          </Link>
        </div>
      </section>

      <section className="gg-collect-section">
        <h2>Local to the whole STL area</h2>
        <div className="gg-collect-grid gg-collect-grid--2">
          <div className="gg-collect-card">
            <h3>Missouri side</h3>
            <p>{ST_LOUIS_METRO.missouri.join(" · ")} — and everywhere in between.</p>
          </div>
          <div className="gg-collect-card">
            <h3>Metro East, Illinois</h3>
            <p>{ST_LOUIS_METRO.illinois.join(" · ")} — and the rest of the Metro East.</p>
          </div>
        </div>
        <p className="gg-collect-lead">
          Day trips are easy, too: {joinList(ST_LOUIS_DAY_TRIPS.missouri)} in Missouri, and{" "}
          {joinList(ST_LOUIS_DAY_TRIPS.illinois)} in Illinois, are all roughly two hours or less
          from St. Louis.
        </p>
      </section>

      <section className="gg-collect-section">
        <h2>Why sell locally</h2>
        <ul className="gg-collect-trustlist">
          <li>
            <strong>No shipping risk.</strong> Your cards never go in a box or through the mail.
          </li>
          <li>
            <strong>Small sales welcome.</strong> Around St. Louis we&rsquo;ll meet for a handful of
            good cards, not only big collections.
          </li>
          <li>
            <strong>See it happen.</strong> We look through the cards with you, so you can ask about
            anything as we go.
          </li>
          <li>
            <strong>No homework.</strong> Unsorted, unpriced and ungraded is how most collections
            arrive.
          </li>
        </ul>
      </section>

      <section className="gg-collect-section" id="quick-quote">
        <h2>Get a quick photo quote</h2>
        <p className="gg-collect-lead">
          Send a few photos and your contact details and we&rsquo;ll come back with an offer — then we
          can meet up to finish the sale, or you can ship if that&rsquo;s easier.
        </p>
        <div className="gg-referral-card">
          <QuickPhotoQuote defaultHandoff="local" />
        </div>
      </section>

      <section className="gg-collect-section">
        <h2>How a St. Louis meetup works</h2>
        <MeetupHowItWorks place="St. Louis" />
      </section>

      <MeetupSafetySection place="St. Louis" areas={ST_LOUIS_MEETUP_AREAS} spots={ST_LOUIS_SAFE_SPOTS} />

      <WhatWeBuySection />

      <TrustSection />

      <TravelAreasSection heading="Outside St. Louis? We travel about 6 hours for collections" exclude="st-louis" />

      <SellerGuidesSection />

      <FaqSection items={FAQ_ITEMS} />

      <SellCtaSection
        heading="Selling Magic cards in St. Louis?"
        text="Tell us a little about what you have and that you'd like to meet up. A few cards or a few thousand — either is fine."
        handoff="local"
        buttonLabel="Set up a meetup"
      />

      <StickySellCta label="Get a quick photo quote" to="#quick-quote" targetId="quick-quote" />
    </div>
  );
}
