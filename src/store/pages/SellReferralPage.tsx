import { Link } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import ReferralLeadForm from "../components/ReferralLeadForm";
import { FaqSection } from "../components/SellLandingSections";
import type { ReferralCategory } from "../lib/referralTypes";
import { REFERRAL_PAGES, referralPageFor, type ReferralPage } from "../../seo/referralPages";
import { ST_LOUIS_PATH } from "../../seo/sellAreas";
import { ORGANIZATION_ID, faqJsonLd } from "../../seo/site";

// /sell-pokemon-cards, /sell-one-piece-cards, /sell-video-games.
// Geega Games is a Magic: The Gathering shop; for these categories it passes
// sellers to a trusted buying partner (with their consent). Every page says
// that plainly — in the intro, the steps, the FAQ and the consent checkbox.
// Content lives in src/seo/referralPages.ts.

function sharedFaq(page: ReferralPage): { question: string; answer: string }[] {
  return [
    {
      question: `Does Geega Games buy ${page.noun}?`,
      answer: `Not directly — our own specialty is Magic: The Gathering. For ${page.noun} we work with a trusted buyer we know personally, who buys very competitively. You tell us what you have, and with your OK we pass it along; they contact you and make the offer.`,
    },
    {
      question: "Can we meet in person?",
      answer:
        "Yes, around St. Louis. If you're farther away, shipping works from anywhere in the US — choose whichever suits you in the form.",
    },
    {
      question: "Do I need to sort or price everything first?",
      answer:
        "No. Describe what you have as best you can. A few photos of the best items, or of the whole pile, help a lot.",
    },
    {
      question: "Does it cost anything, and do I have to sell?",
      answer:
        "No and no. Asking for an offer is free, and you're free to say no to any offer you get.",
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
        <div className="gg-collect-hero-actions">
          <a href="#tell-us" className="gg-btn">
            Tell us what you have
          </a>
        </div>
      </section>

      <section className="gg-collect-section">
        <h2>How it works</h2>
        <p className="gg-collect-lead">
          Geega Games specializes in Magic: The Gathering. For {page.noun}, we work with a trusted
          buyer we know personally who buys very competitively — we handle the introduction, they
          make the offer.
        </p>
        <ol className="gg-collect-steps">
          <li>
            <strong>Tell us what you have.</strong> A short description is enough; photos help.
          </li>
          <li>
            <strong>We pass it to our buying partner</strong> — only with your OK.
          </li>
          <li>
            <strong>They contact you with an offer.</strong> By email, phone or text, whichever you
            prefer.
          </li>
          <li>
            <strong>Meet up or ship.</strong> In person around St. Louis, or by mail from anywhere in
            the US. No obligation to sell.
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
        <p className="gg-area-note">Our buying partner decides what they can make an offer on.</p>
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

      <section className="gg-collect-section" id="tell-us">
        <h2>Tell us what you have</h2>
        <div className="gg-referral-card">
          <ReferralLeadForm
            category={category}
            descriptionPlaceholder={page.descriptionPlaceholder}
            sourcePath={page.path}
          />
        </div>
      </section>

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
    </div>
  );
}
