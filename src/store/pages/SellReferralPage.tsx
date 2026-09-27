import { Link } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import ReferralLeadForm from "../components/ReferralLeadForm";
import {
  FaqSection,
  HeroPoints,
  PartnerTrustSection,
  SellerGuidesSection,
  SellerReviewsSection,
  ShopRatingLine,
  StickySellCta,
} from "../components/SellLandingSections";
import type { ReferralCategory } from "../lib/referralTypes";
import { REFERRAL_PAGES, referralPageFor, type ReferralPage } from "../../seo/referralPages";
import { ST_LOUIS_PATH } from "../../seo/sellAreas";
import { ORGANIZATION_ID, faqJsonLd } from "../../seo/site";

// /sell-pokemon-cards, /sell-one-piece-cards, /sell-video-games.
// Geega Games is a Magic: The Gathering shop; for these categories it passes
// sellers to a trusted buying partner (with their consent). Every page says
// that plainly — in the intro, the steps, the FAQ and the consent checkbox.
// Content lives in src/seo/referralPages.ts (see its content rules).
//
// Order (seller research, 2026-09-27): the promises and the partner setup
// first, then what they take and why to trust it, then the form; the
// comparisons and tips for people still deciding come after it.

const CTA_LABEL = "Get my free offer";

const HERO_POINTS = [
  "Free to ask — no obligation to sell",
  "No sorting or price-checking needed",
  "Meet up around St. Louis, or ship from anywhere in the US",
  "Shared only with our buying partner, and only with your OK",
];

function sharedFaq(page: ReferralPage): { question: string; answer: string }[] {
  return [
    {
      question: `Does Geega Games buy ${page.noun}?`,
      answer: `Not directly — our own specialty is Magic: The Gathering. For ${page.noun} we work with a trusted buyer we know personally, who buys very competitively. You tell us what you have, and with your OK we pass it along; they contact you and make the offer.`,
    },
    {
      question: "Is it free? Do I have to sell?",
      answer:
        "It's free, and no. Asking for an offer costs nothing, and if you don't like the offer, just say no — no hard feelings.",
    },
    {
      question: "Do I need to sort or price everything first?",
      answer:
        "No. Describe what you have as best you can — most sellers don't know what their things are worth, and that's fine. A few photos of the best items, or of the whole pile, help a lot.",
    },
    {
      question: "Can we meet in person?",
      answer:
        "Yes, around St. Louis — somewhere public, like a police safe-exchange spot, a coffee shop or a bank lobby. If you're farther away, shipping works from anywhere in the US. Choose whichever suits you in the form.",
    },
    ...page.faq,
    {
      question: "Do you buy Magic: The Gathering cards?",
      answer:
        "Yes — those we buy ourselves, sorted or unsorted, by mail or in person. See our Sell your Magic cards page.",
    },
  ];
}

function pageJsonLd(page: ReferralPage, faq: { question: string; answer: string }[]): object[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: `Sell ${page.noun}`,
      serviceType: `${page.noun} selling`,
      provider: { "@id": ORGANIZATION_ID },
      areaServed: [
        { "@type": "City", name: "St. Louis", containedInPlace: { "@type": "State", name: "Missouri" } },
        { "@type": "Country", name: "United States" },
      ],
      description: `Geega Games connects people selling ${page.noun} with a trusted buying partner who makes an offer — in person around St. Louis, or by mail from anywhere in the US.`,
    },
    faqJsonLd(faq),
  ];
}

export default function SellReferralPage({ category }: { category: ReferralCategory }) {
  const page = referralPageFor(category);
  const faq = sharedFaq(page);
  useSEO({
    title: page.title,
    description: page.description,
    path: page.path,
    jsonLd: pageJsonLd(page, faq),
  });

  const others = REFERRAL_PAGES.filter((p) => p.category !== category);

  return (
    <div className="gg-page">
      <section className="gg-collect-hero">
        <h1>{page.heading}</h1>
        <p className="gg-collect-hero-sub">{page.intro}</p>
        <HeroPoints points={HERO_POINTS} />
        <p className="gg-credit-badge">
          Our buying partner <strong>buys very competitively</strong>
        </p>
        <div className="gg-collect-hero-actions">
          <a href="#tell-us" className="gg-btn">
            {CTA_LABEL}
          </a>
        </div>
        <ShopRatingLine />
      </section>

      <section className="gg-collect-section">
        <h2>How it works</h2>
        <p className="gg-collect-lead">
          Geega Games is a St. Louis Magic: The Gathering shop. For {page.noun}, we introduce you to
          a buyer we know personally, who buys very competitively — we handle the introduction, they
          make the offer.
        </p>
        <ol className="gg-collect-steps">
          <li>
            <strong>Tell us what you have.</strong> A rough description is plenty, and photos help. No
            sorting or pricing needed.
          </li>
          <li>
            <strong>We pass it to our buying partner</strong> — only with your OK.
          </li>
          <li>
            <strong>They contact you about an offer</strong> by email, phone or text, whichever you
            prefer.
          </li>
          <li>
            <strong>You decide.</strong> Like the offer? Meet up around St. Louis or ship it. If not,
            just say no — no hard feelings.
          </li>
        </ol>
      </section>

      <section className="gg-collect-section">
        <h2>What we can help you sell</h2>
        <div className="gg-collect-grid">
          {page.items.map((item) => (
            <div className="gg-collect-card" key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </div>
          ))}
        </div>
        <p className="gg-area-note">
          Include everything — our buying partner will tell you what they can make an offer on.
        </p>
      </section>

      <PartnerTrustSection />

      <section className="gg-collect-section" id="tell-us">
        <h2>Get a free, no-obligation offer</h2>
        <p className="gg-collect-lead gg-collect-lead--center">
          Tell us what you have. Nothing is passed along until you tick the consent box at the end.
        </p>
        <div className="gg-referral-card">
          <ReferralLeadForm
            category={category}
            descriptionPlaceholder={page.descriptionPlaceholder}
            sourcePath={page.path}
          />
        </div>
      </section>

      <SellerReviewsSection />

      <section className="gg-collect-section">
        <h2>Why not just sell it yourself?</h2>
        <p className="gg-collect-lead">{page.sellYourself.intro}</p>
        <ul className="gg-collect-trustlist">
          {page.sellYourself.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <p className="gg-collect-lead">
          Or tell us what you have once, and a buyer we know personally takes it from there. You can
          still compare their offer with anything else — you&rsquo;re never obligated.
        </p>
      </section>

      <section className="gg-collect-section gg-collect-trust">
        <h2>How to tell if an offer is fair</h2>
        <ul className="gg-collect-trustlist">
          <li>
            <strong>Check what things actually sell for.</strong> {page.priceCheck}
          </li>
          <li>
            <strong>Expect offers below those prices.</strong> Anyone who buys to resell has to leave
            room for fees, risk and the time it takes to sell.
          </li>
          <li>
            <strong>Compare offers with offers.</strong> A fair offer holds up next to other buyers&rsquo;
            offers, not next to sold prices.
          </li>
          <li>
            <strong>Selling everything together trades some money per item for a lot less work.</strong>{" "}
            No listings, no packing orders, no waiting for each item to sell.
          </li>
          <li>
            <strong>You can always say no.</strong> Asking for an offer is free, and there&rsquo;s no
            pressure to take it.
          </li>
        </ul>
      </section>

      <section className="gg-collect-section">
        <h2>{page.insight.heading}</h2>
        {page.insight.paragraphs.map((text) => (
          <p className="gg-collect-lead" key={text.slice(0, 40)}>
            {text}
          </p>
        ))}
      </section>

      <section className="gg-collect-section gg-collect-trust">
        <h2>{page.tipsHeading}</h2>
        <ul className="gg-collect-trustlist">
          {page.tips.map((tip) => (
            <li key={tip.title}>
              <strong>{tip.title}.</strong> {tip.text}
            </li>
          ))}
        </ul>
      </section>

      <SellerGuidesSection topic={page.category} alsoTopics={["st_louis"]} />

      <FaqSection items={faq} />

      <section className="gg-collect-section">
        <h2>Selling something else?</h2>
        <ul className="gg-area-links">
          {others.map((p) => (
            <li key={p.path}>
              <Link to={p.path}>Sell {p.noun}</Link>
            </li>
          ))}
          <li>
            <Link to="/sell-my-collection">Sell Magic: The Gathering cards</Link>
          </li>
          <li>
            <Link to={ST_LOUIS_PATH}>Sell Magic cards in St. Louis</Link>
          </li>
        </ul>
      </section>

      <StickySellCta label={CTA_LABEL} to="#tell-us" targetId="tell-us" />
    </div>
  );
}
