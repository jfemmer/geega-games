import { Link } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import PartnerApplicationForm from "../components/PartnerApplicationForm";
import {
  FaqSection,
  HeroPoints,
  SellerGuidesSection,
  SellerReviewsSection,
  ShopRatingLine,
} from "../components/SellLandingSections";
import {
  FOR_STORES_PATH,
  PARTNER_STORE_STANDARDS,
  REFERRAL_PARTNERS_PATH,
  SELL_HUB_PATH,
} from "../lib/partnerTypes";
import { REFERRAL_PAGES } from "../../seo/referralPages";
import { ORGANIZATION_ID, faqJsonLd } from "../../seo/site";

// The partner program's public pages:
//
//   /for-stores            card and video game stores apply to receive
//                          sellers' leads, paying a finder's fee only when
//                          they buy;
//   /referral-partners     estate sale companies, attorneys, realtors and
//                          move managers apply to send sellers our way and
//                          earn a referral fee;
//   /sell-cards-and-games  sellers pick what they're selling — where
//                          referral links and flyers point.
//
// Content rules (same spirit as src/seo/referralPages.ts): no promises about
// how many leads a store will get, no fee percentages (agreed one-to-one with
// each partner), and nothing implying Geega Games buys anything but Magic.

// ---------------------------------------------------------------------------
// /for-stores
// ---------------------------------------------------------------------------

const STORE_FAQ = [
  {
    question: "Is there a cost to join?",
    answer:
      "No. There's no sign-up cost and no monthly fee, and you never pay for a lead that doesn't buy. You pay a finder's fee — a percentage of what you pay the seller — only when you buy.",
  },
  {
    question: "How many leads will I get?",
    answer:
      "It depends on where you are and what you buy, and we won't promise a number. We market to sellers every week, on our site and in person, and you only pay when you buy — so there's no risk in joining.",
  },
  {
    question: "Are leads shared with other stores?",
    answer:
      "No. Each lead goes to one store. If you can't reach the seller or pass on the collection, tell us and we may offer it to another store — with nothing owed by you.",
  },
  {
    question: "How do I pay the finder's fee?",
    answer:
      "Tell us when you buy and for how much. We send a statement for any fees owed, and you pay by invoice. We also check in with sellers afterwards, so both sides of every deal are on the record.",
  },
  {
    question: "Do you send leads outside St. Louis?",
    answer:
      "Yes. Sellers come to us from all over, and many are happy to ship. We match each lead with a store that buys what they have — close to them for a meetup, or one that buys by mail.",
  },
  {
    question: "Doesn't Geega Games buy collections itself?",
    answer:
      "We buy Magic: The Gathering ourselves. Pokémon, One Piece and video games go to partner stores, and Magic collections we pass on go to partners only if the seller agrees.",
  },
];

export function ForStoresPage() {
  useSEO({
    title: "Collection Leads for Card & Video Game Stores | Geega Games",
    description:
      "Get leads from people selling Pokémon, One Piece and video game collections, and Magic collections we pass on. No sign-up cost — a finder's fee only when you buy.",
    path: FOR_STORES_PATH,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Service",
        name: "Collection leads for card and video game stores",
        serviceType: "Lead referral",
        provider: { "@id": ORGANIZATION_ID },
        areaServed: { "@type": "Country", name: "United States" },
        description:
          "Geega Games refers people selling trading card and video game collections to vetted partner stores, which pay a finder's fee only when they buy.",
      },
      faqJsonLd(STORE_FAQ),
    ],
  });

  return (
    <div className="gg-page">
      <section className="gg-collect-hero">
        <h1>Collection leads for card and video game stores</h1>
        <p className="gg-collect-hero-sub">
          People come to Geega Games to sell their cards and games. When we don&rsquo;t buy what they
          have — or they&rsquo;re closer to you — we send them to one vetted partner store. No sign-up
          cost and no monthly fee: you pay a finder&rsquo;s fee only when you buy.
        </p>
        <HeroPoints
          points={[
            "Sellers who asked for an offer and are expecting your call",
            "One store per lead — never shared",
            "Photos, a description and the best way to reach them, up front",
            "A finder's fee only when you buy",
          ]}
        />
        <div className="gg-collect-hero-actions">
          <a href="#apply" className="gg-btn">
            Apply to be a partner store
          </a>
        </div>
      </section>

      <section className="gg-collect-section">
        <h2>How it works</h2>
        <ol className="gg-collect-steps">
          <li>
            <strong>A seller asks us for an offer</strong> on Pokémon or One Piece cards, video games
            — or a Magic collection we&rsquo;re passing on — and asks to be connected with a store.
          </li>
          <li>
            <strong>We match them with one partner store</strong> that buys what they have: near them
            for a meetup, or one that buys by mail.
          </li>
          <li>
            <strong>You get an email with everything:</strong> what they have, photos, where they are
            and how they want to be contacted. They know to expect you.
          </li>
          <li>
            <strong>If you buy, tell us the amount.</strong> We send a statement for the finder&rsquo;s
            fee. If you don&rsquo;t buy, you owe nothing.
          </li>
        </ol>
      </section>

      <section className="gg-collect-section">
        <h2>What every lead includes</h2>
        <div className="gg-collect-grid">
          <div className="gg-collect-card">
            <h3>What they&rsquo;re selling</h3>
            <p>Categories, a rough size, and their own description of the collection.</p>
          </div>
          <div className="gg-collect-card">
            <h3>Photos</h3>
            <p>Up to 30 photos of the best items or the whole pile, when the seller adds them.</p>
          </div>
          <div className="gg-collect-card">
            <h3>Where and how</h3>
            <p>Their location, whether they&rsquo;d rather meet up or ship, and how to contact them.</p>
          </div>
          <div className="gg-collect-card">
            <h3>Their go-ahead</h3>
            <p>Every seller asked us to pass their details to a store. Nobody is cold-called.</p>
          </div>
        </div>
      </section>

      <section className="gg-collect-section gg-collect-trust">
        <h2>What we ask of partner stores</h2>
        <p className="gg-collect-lead">
          Sellers trust us with their details, so every partner store agrees to:
        </p>
        <ul className="gg-collect-trustlist">
          {PARTNER_STORE_STANDARDS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      <section className="gg-collect-section">
        <h2>The finder&rsquo;s fee</h2>
        <p className="gg-collect-lead">
          A percentage of what you pay the seller, and only when you buy. Nothing to join, nothing per
          month, nothing for leads that don&rsquo;t buy. We agree your rate with you in writing before
          we send any leads.
        </p>
        <p className="gg-collect-lead">
          We&rsquo;re looking for stores in the St. Louis area and beyond that buy collections —
          especially Pokémon, One Piece and video games — and stores
          that buy by mail from anywhere in the US.
        </p>
      </section>

      <section className="gg-collect-section" id="apply">
        <h2>Apply to be a partner store</h2>
        <p className="gg-collect-lead gg-collect-lead--center">
          Tell us about your store. We read every application ourselves.
        </p>
        <div className="gg-referral-card">
          <PartnerApplicationForm kind="store" />
        </div>
      </section>

      <FaqSection items={STORE_FAQ} />

      <section className="gg-collect-section">
        <h2>Know people with collections to sell?</h2>
        <p className="gg-collect-lead">
          Estate sale companies, attorneys, realtors and move managers can earn a referral fee for
          sending sellers our way. <Link to={REFERRAL_PARTNERS_PATH}>Become a referral partner</Link>.
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// /referral-partners
// ---------------------------------------------------------------------------

const REFERRER_FAQ = [
  {
    question: "How much is the referral fee?",
    answer:
      "A percentage of what your client is paid, agreed with you when you join. You'll get it in writing, along with your personal link.",
  },
  {
    question: "When do I get paid?",
    answer:
      "After your client's sale is complete. We email you when a referral sells and how much you've earned, then pay it.",
  },
  {
    question: "Does my client pay anything?",
    answer:
      "No. Asking for an offer is free for your client, and they're never obligated to sell.",
  },
  {
    question: "What does my client need to do?",
    answer:
      "Open your link (or scan your QR code), choose what they're selling and describe it — a rough description and a few photos is plenty. No sorting or pricing needed.",
  },
  {
    question: "Who makes the offer?",
    answer:
      "Magic: The Gathering we buy ourselves. For Pokémon, One Piece and video games, we pass your client's request to one vetted partner store, which makes the offer.",
  },
  {
    question: "Can I send you my client's details instead?",
    answer:
      "Please give them your link and let them fill it in — that way they choose what to share and how they want to be contacted. If they'd rather you help, sit down with them and fill it in together.",
  },
];

export function ReferralPartnersPage() {
  useSEO({
    title: "Referral Partners: Estate Sales, Attorneys & Realtors | Geega Games",
    description:
      "Help your clients sell trading card and video game collections: free, no-obligation offers for them, and a referral fee for you when a collection sells.",
    path: REFERRAL_PARTNERS_PATH,
    jsonLd: [faqJsonLd(REFERRER_FAQ)],
  });

  return (
    <div className="gg-page">
      <section className="gg-collect-hero">
        <h1>Clients with cards or video games to sell? Send them our way</h1>
        <p className="gg-collect-hero-sub">
          Estate sale companies, estate attorneys, realtors and move managers come across collections
          all the time. We make it easy for your clients to get a free, no-obligation offer — and pay
          you a referral fee when a collection sells.
        </p>
        <HeroPoints
          points={[
            "Free for your clients, with no obligation",
            "Your own link and QR code, so every referral is credited to you",
            "Magic we buy ourselves; everything else goes to a vetted partner store",
            "A referral fee when a collection you send sells",
          ]}
        />
        <div className="gg-collect-hero-actions">
          <a href="#apply" className="gg-btn">
            Become a referral partner
          </a>
        </div>
      </section>

      <section className="gg-collect-section">
        <h2>How it works</h2>
        <ol className="gg-collect-steps">
          <li>
            <strong>Apply below.</strong> Once we&rsquo;ve said hello, we email you your personal link.
          </li>
          <li>
            <strong>Give your client the link</strong> — or a flyer with your QR code. They tell us what
            they have; no sorting needed.
          </li>
          <li>
            <strong>They get an offer.</strong> We make it for Magic cards; a vetted partner store
            makes it for everything else. They&rsquo;re free to say no.
          </li>
          <li>
            <strong>If they sell, you earn a referral fee</strong>, a percentage of the sale.
          </li>
        </ol>
      </section>

      <section className="gg-collect-section">
        <h2>Who it&rsquo;s for</h2>
        <div className="gg-collect-grid">
          <div className="gg-collect-card">
            <h3>Estate sale companies</h3>
            <p>Card and game collections are hard to price for a sale — send them to a specialist.</p>
          </div>
          <div className="gg-collect-card">
            <h3>Estate &amp; probate attorneys</h3>
            <p>Give executors a simple, free way to get a collection valued and sold.</p>
          </div>
          <div className="gg-collect-card">
            <h3>Realtors &amp; move managers</h3>
            <p>Help clients clear out before a move without listing every card themselves.</p>
          </div>
          <div className="gg-collect-card">
            <h3>Anyone else</h3>
            <p>Auction houses, storage facilities, pawn shops that don&rsquo;t buy cards — apply anyway.</p>
          </div>
        </div>
      </section>

      <section className="gg-collect-section" id="apply">
        <h2>Become a referral partner</h2>
        <p className="gg-collect-lead gg-collect-lead--center">
          Tell us about yourself. We&rsquo;ll be in touch with your link and the details of your fee.
        </p>
        <div className="gg-referral-card">
          <PartnerApplicationForm kind="referrer" />
        </div>
      </section>

      <FaqSection items={REFERRER_FAQ} />

      <section className="gg-collect-section">
        <h2>Run a card or video game store?</h2>
        <p className="gg-collect-lead">
          Partner stores get leads from sellers and pay a finder&rsquo;s fee only when they buy.{" "}
          <Link to={FOR_STORES_PATH}>See how it works for stores</Link>.
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// /sell-cards-and-games
// ---------------------------------------------------------------------------

const HUB_BLURBS: Record<string, string> = {
  pokemon: "Binders, graded slabs, sealed product, Japanese cards",
  one_piece: "Alt arts, manga rares, Leaders, sealed boxes",
  video_games: "Retro and modern games, consoles, complete-in-box",
};

export function SellHubPage() {
  useSEO({
    title: "Sell Your Cards & Video Games in St. Louis — Free Offers | Geega Games",
    description:
      "Magic, Pokémon, One Piece or video games — pick what you're selling and get a free, no-obligation offer. Meet up or ship.",
    path: SELL_HUB_PATH,
  });

  return (
    <div className="gg-page">
      <section className="gg-collect-hero">
        <h1>What are you selling?</h1>
        <p className="gg-collect-hero-sub">
          Pick one to get a free, no-obligation offer. Magic: The Gathering we buy ourselves; for
          everything else, we connect you with a vetted partner store that buys it.
        </p>
        <ShopRatingLine />
      </section>

      <section className="gg-collect-section">
        <ul className="gg-hub-tiles">
          <li>
            <Link to="/sell-my-collection" className="gg-hub-tile">
              <strong>Magic: The Gathering cards</strong>
              <span>We buy these ourselves — collections of every size, sorted or not</span>
            </Link>
          </li>
          {REFERRAL_PAGES.map((page) => (
            <li key={page.path}>
              <Link to={page.path} className="gg-hub-tile">
                <strong>{page.noun.charAt(0).toUpperCase() + page.noun.slice(1)}</strong>
                <span>{HUB_BLURBS[page.category] ?? "Get a free offer from a partner store"}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="gg-area-note">
          Not sure? Pick the closest one and describe everything — mixed collections are welcome.
        </p>
      </section>

      <section className="gg-collect-section">
        <h2>How it works</h2>
        <ol className="gg-collect-steps">
          <li>
            <strong>Tell us what you have.</strong> A rough description and a few photos is plenty — no
            sorting or pricing needed.
          </li>
          <li>
            <strong>Get an offer.</strong> From us for Magic cards, or from one vetted partner store for
            everything else.
          </li>
          <li>
            <strong>You decide.</strong> Meet up or ship if you like the offer — or just say no.
          </li>
        </ol>
      </section>

      <SellerReviewsSection />
      <SellerGuidesSection topic="st_louis" />
    </div>
  );
}
