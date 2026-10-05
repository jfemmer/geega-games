import { Link } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import SignupForm from "../../SignupForm";
import { JoinSection } from "../components/AccountPerks";
import DeckShowcase from "../components/DeckShowcase";
import {
  AreaLinks,
  PartnerCategoriesSection,
  SellerReviewsSection,
} from "../components/SellLandingSections";
import {
  DEFAULT_SEO,
  DISAMBIGUATING_DESCRIPTION,
  LEGAL_NAME,
  MAX_DRIVE_HOURS,
  ORGANIZATION_ID,
  WEBSITE_JSON_LD,
  absoluteUrl,
  breadcrumbJsonLd,
} from "../../seo/site";
import { REFERRAL_PAGES } from "../../seo/referralPages";
import { ST_LOUIS_PATH } from "../../seo/sellAreas";
import { SHIPPING, formatCents, formatCentsShort } from "../lib/money";
import { PHOTO_REQUEST_MIN_PRICE_LABEL } from "../lib/photoRequestTypes";

export const SUPPORT_EMAIL =
  (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) ??
  "support@geega-games.com";

export function HomePage() {
  useSEO({
    title: DEFAULT_SEO.title,
    description: DEFAULT_SEO.description,
    path: "/",
    jsonLd: WEBSITE_JSON_LD,
  });

  return (
    <div className="gg-page">
      <section style={{ textAlign: "center", padding: "2rem 0 1rem" }}>
        <h1 style={{ color: "var(--gg-ink)", fontSize: "2rem", marginBottom: "0.5rem" }}>
          Buy &amp; sell Magic: The Gathering cards
        </h1>
        <p className="gg-prose" style={{ color: "#555" }}>
          Hand-graded MTG singles from real inventory, shipped nationwide from St. Louis — and
          when you&rsquo;re ready to sell, we buy single cards and whole collections.
        </p>
        <div className="gg-home-actions">
          <Link to="/shop" className="gg-btn">
            Shop singles
          </Link>
          <Link to="/sell-my-collection" className="gg-btn gg-btn-ghost">
            Sell your cards
          </Link>
        </div>
      </section>

      <DeckShowcase />

      <SellerReviewsSection />

      <JoinSection />

      <section className="gg-sellcta">
        <h2>Looking to sell your collection?</h2>
        <p>
          From a few valuable singles to an entire Magic collection, Geega Games is always
          interested in seeing what you have. Ship it from anywhere in the US,{" "}
          <Link to={ST_LOUIS_PATH}>meet up with us in St. Louis</Link>, or — for a collection —
          we&rsquo;ll drive to you, up to about {MAX_DRIVE_HOURS} hours away.
        </p>
        <Link to="/sell-my-collection" className="gg-btn">
          Sell Your Cards
        </Link>
        <AreaLinks />
      </section>

      <PartnerCategoriesSection />

      <section className="gg-collect-section gg-home-guides">
        <h2>Not sure what your cards are worth?</h2>
        <p className="gg-collect-lead">
          Free, plain-English <Link to="/guides">seller guides</Link> for Magic, Pokémon, One Piece
          and video games — plus{" "}
          <Link to="/guides/where-to-sell-cards-in-st-louis">where to sell cards in St. Louis</Link>.
        </p>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <div className="gg-prose">
          <h2 style={{ color: "var(--gg-purple)" }}>Stay in the loop</h2>
          <p>
            Get notified about new arrivals, restocks, and exclusive deals. No
            spam, unsubscribe any time.
          </p>
        </div>
        <div style={{ maxWidth: 520, margin: "1rem auto 0" }}>
          <SignupForm />
        </div>
      </section>
    </div>
  );
}

// Store policies (owner-approved 2026-09-26): 14-day window to report a
// problem; Geega pays return shipping when a card's condition was listed
// wrong; orders ship within 2 business days (Mon–Sat — no Sunday post);
// email replies within 24 hours; photos of the actual card on request for
// cards $5 and up (2026-09-27; see PHOTO_REQUEST_MIN_PRICE_CENTS).
// Change these constants, not the page copy, if a policy changes.
export const RETURN_WINDOW_DAYS = 14;
export const SHIPS_WITHIN_BUSINESS_DAYS = 2;
export const REPLY_WITHIN_HOURS = 24;

export function ConditionGuidePage() {
  useSEO({
    title: "MTG Card Condition Guide — NM, LP, MP, HP, DMG Explained | Geega Games",
    description:
      "How Geega Games grades every Magic: The Gathering single before listing it — Near Mint through Damaged, what we check on every card, and our condition promise.",
    path: "/condition-guide",
  });

  return (
    <div className="gg-page gg-prose">
      <h1>Card condition guide</h1>
      <p>
        Every single is graded by hand before it is listed. Grades follow common
        trading-card conventions:
      </p>
      <h2>NM — Near Mint</h2>
      <p>
        Looks freshly opened or nearly so. May have minor imperfections only
        visible on close inspection. No noticeable wear from normal angles.
      </p>
      <h2>LP — Lightly Played</h2>
      <p>
        Minor edge wear or light scuffing. Fully tournament-playable in a sleeve.
      </p>
      <h2>MP — Moderately Played</h2>
      <p>
        Moderate wear: noticeable edge whitening, light scratches, or minor
        surface wear. Still structurally sound.
      </p>
      <h2>HP — Heavily Played</h2>
      <p>
        Significant wear such as heavy whitening, creasing, or scratches, but the
        card remains intact and identifiable.
      </p>
      <h2>DMG — Damaged</h2>
      <p>
        Major flaws such as tears, water damage, heavy creasing, or writing.
        Priced accordingly.
      </p>

      <h2>What we check on every card</h2>
      <ul>
        <li>
          <strong>Corners</strong> — rounding, dings and bends.
        </li>
        <li>
          <strong>Edges</strong> — whitening and chipping, front and back.
        </li>
        <li>
          <strong>Surface</strong> — scratches, scuffs, print lines and clouding on foils, checked
          under light.
        </li>
        <li>
          <strong>Structure</strong> — creases, dents, warping and curling.
        </li>
        <li>
          <strong>Markings</strong> — writing, stamps, stains or water damage.
        </li>
      </ul>

      <h2>Our condition promise</h2>
      <p>
        If a card arrives in worse condition than we listed it, tell us within{" "}
        {RETURN_WINDOW_DAYS} days of delivery. We&rsquo;ll send you a prepaid return label and
        refund you — you never pay to fix our mistake. See{" "}
        <Link to="/returns">Returns &amp; refunds</Link>.
      </p>

      <h2>Want to see the actual card?</h2>
      <p>
        Product pages show a stock image of each card. If you&rsquo;d like a photo of the exact copy
        you&rsquo;d be buying, tap <strong>Request a photo</strong> under any listing priced{" "}
        {PHOTO_REQUEST_MIN_PRICE_LABEL} or more on the card&rsquo;s page, and we&rsquo;ll email you one
        within {REPLY_WITHIN_HOURS} hours.
      </p>
    </div>
  );
}

export function ShippingPage() {
  const freeFrom = formatCentsShort(SHIPPING.freeShippingThresholdCents);
  useSEO({
    title: "Shipping Options & Rates | Geega Games",
    description: `Every Geega Games order ships within ${SHIPS_WITHIN_BUSINESS_DAYS} business days, sleeved, top-loaded and packed tight. Plain white envelope or tracked shipping, and orders of ${freeFrom} or more ship free with tracking.`,
    path: "/shipping",
  });

  return (
    <div className="gg-page gg-prose">
      <h1>Shipping</h1>
      <p>
        We want every order to be the best shipping experience you&rsquo;ve had buying cards online:
        fast, tight and protected. Your cards should arrive in exactly the condition they left us.
      </p>

      <h2>Ships within {SHIPS_WITHIN_BUSINESS_DAYS} business days</h2>
      <p>
        Every order ships no more than {SHIPS_WITHIN_BUSINESS_DAYS} business days after you place
        it. We ship Monday through Saturday — the post office is closed on Sundays. We&rsquo;ll email
        you when your order is packed and again when it ships (with your tracking number, for tracked
        orders), and you can check on it any time on{" "}
        <Link to="/track-order">Track your order</Link>.
      </p>

      <h2>How we pack your cards</h2>
      <ul>
        <li>Every card goes into a sleeve and a rigid top-loader.</li>
        <li>
          Cards are packed snugly so nothing slides around in transit — no loose cards, ever.
        </li>
        <li>Tracked orders ship in a protective mailer built for higher-value cards.</li>
      </ul>

      <h2>Your options at checkout</h2>
      <h3>Free shipping on orders of {freeFrom} or more</h3>
      <p>
        Spend {freeFrom} or more on cards and your order <strong>ships free with tracking</strong>.
        It&rsquo;s applied automatically at checkout: no code to enter and nothing to choose.
      </p>
      <h3>Plain White Envelope (PWE) — {formatCents(SHIPPING.pweCents)}</h3>
      <p>
        A low-cost option for orders under {freeFrom}: sleeved and top-loaded inside a plain
        envelope. PWE is <strong>not tracked</strong>, so a lost envelope can&rsquo;t be traced — for
        anything you&rsquo;d hate to lose, choose tracked shipping. Since there&rsquo;s no tracking,
        we email you after it&rsquo;s had time to arrive, so you can tell us if it hasn&rsquo;t.
      </p>
      <h3>Tracked shipping — {formatCents(SHIPPING.trackedCents)}</h3>
      <p>
        Fully tracked and better protected, recommended for higher-value orders.{" "}
        <strong>Free on orders of {freeFrom} or more.</strong>
      </p>
      <p>Your exact shipping cost is always shown in your cart before you pay — no surprises.</p>

      <h2>Something wrong with your delivery?</h2>
      <p>
        If an order arrives damaged, email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>{" "}
        within {RETURN_WINDOW_DAYS} days with your order number and a photo, and we&rsquo;ll make it
        right. We reply within {REPLY_WITHIN_HOURS} hours.
      </p>
    </div>
  );
}

export function ReturnsPage() {
  useSEO({
    title: "Returns & Refunds | Geega Games",
    description: `Report a problem with your Geega Games order within ${RETURN_WINDOW_DAYS} days of delivery. If we listed a card's condition wrong, we pay return shipping.`,
    path: "/returns",
  });

  return (
    <div className="gg-page gg-prose">
      <h1>Returns &amp; refunds</h1>
      <p>
        We grade every card by hand and pack every order carefully — but if something isn&rsquo;t
        right, we want to fix it.
      </p>

      <h2>{RETURN_WINDOW_DAYS} days to let us know</h2>
      <p>
        You have {RETURN_WINDOW_DAYS} days from delivery to report a problem with your order.
      </p>

      <h2>Card not in the condition we listed?</h2>
      <p>
        We pay return shipping. We&rsquo;ll email you a prepaid return label, and once the card is
        back with us we refund it to your original payment method. You never pay to fix our mistake.
      </p>

      <h2>Wrong card, missing card or damaged in transit</h2>
      <p>
        Email us with your order number and a photo and we&rsquo;ll make it right — by sending the
        correct card if we have it in stock, or with a refund.
      </p>

      <h2>How to start a return</h2>
      <ol>
        <li>
          Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> within {RETURN_WINDOW_DAYS}{" "}
          days of delivery.
        </li>
        <li>Include your order number, which card(s), and what&rsquo;s wrong — photos help a lot.</li>
        <li>We reply within {REPLY_WITHIN_HOURS} hours with next steps.</li>
      </ol>
      <p>
        Please don&rsquo;t send anything back before you hear from us — we&rsquo;ll send the label
        and the return address.
      </p>
    </div>
  );
}

// /about — who runs Geega Games, what it does, and (because Google's AI
// Overview has confused the two) that it has nothing to do with the
// streamer "GEEGA". The same facts are in the site-wide JSON-LD
// (legalName, disambiguatingDescription) in src/seo/site.ts. Only verified
// facts: the legal entity is from the Terms of Service; how the business
// buys and sells is from the sell pages and the owner (2026-09-26: meetups,
// mail, and a booth or table at events).
const ABOUT_JSON_LD = [
  breadcrumbJsonLd([{ name: "About", path: "/about" }]),
  {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: "About Geega Games",
    url: absoluteUrl("/about"),
    mainEntity: { "@id": ORGANIZATION_ID },
    description: DISAMBIGUATING_DESCRIPTION,
  },
];

export function AboutPage() {
  useSEO({
    title: "About Geega Games — St. Louis Magic: The Gathering Shop & Card Buyer",
    description:
      "Geega Games is an independently owned St. Louis card business: hand-graded Magic singles online and at local events, and a buyer of Magic collections by mail or in person. Not affiliated with the streamer GEEGA.",
    path: "/about",
    jsonLd: ABOUT_JSON_LD,
  });

  return (
    <div className="gg-page">
      <div className="gg-prose">
        <h1>About Geega Games</h1>
        <p>
          Geega Games is a small, independently owned trading card business based in St. Louis,
          Missouri, run by {LEGAL_NAME}, a Missouri limited liability company. We sell Magic: The
          Gathering singles and buy Magic cards and whole collections.
        </p>

        <h2>What we do</h2>
        <ul>
          <li>
            <strong>Sell Magic singles.</strong> Every card is graded by hand before it&rsquo;s listed
            (see our <Link to="/condition-guide">condition guide</Link>), shipped from St. Louis — and
            you&rsquo;ll also find us with a booth or table at local events.{" "}
            <Link to="/shop">Shop singles</Link>
          </li>
          <li>
            <strong>Buy Magic cards and collections.</strong> We meet up anywhere around St. Louis,
            drive up to about {MAX_DRIVE_HOURS} hours for collections, and buy by mail from anywhere
            in the US. <Link to="/sell-my-collection">Sell your cards</Link> ·{" "}
            <Link to="/sell-magic-cards/st-louis">Selling in St. Louis</Link>
          </li>
          <li>
            <strong>Help with everything else.</strong> For Pokémon, One Piece and video games, we
            connect sellers with a trusted buyer we work with, who buys very competitively:{" "}
            {REFERRAL_PAGES.map((p, i) => (
              <span key={p.path}>
                {i > 0 ? " · " : ""}
                <Link to={p.path}>Sell {p.noun}</Link>
              </span>
            ))}
          </li>
        </ul>

        <h2>How we work</h2>
        <ul>
          <li>
            Honest grading, and a <Link to="/returns">condition promise</Link>: if a card isn&rsquo;t
            what we listed, we pay the return shipping.
          </li>
          <li>
            Cards are sleeved, top-loaded and packed tight — see <Link to="/shipping">shipping</Link>.
          </li>
          <li>
            Sellers get one clear, no-obligation offer, paid by PayPal Goods &amp; Services or store
            credit — never Friends &amp; Family.
          </li>
          <li>
            A real person answers every email within {REPLY_WITHIN_HOURS} hours:{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </li>
        </ul>
      </div>

      <SellerReviewsSection />

      <div className="gg-prose">
        <h2>Not affiliated with any streamer or content creator</h2>
        <p>
          Geega Games is <strong>not affiliated with, operated by, sponsored by or endorsed by any
          streamer, YouTuber, content creator or influencer</strong> — including anyone using the name
          &ldquo;Geega&rdquo; or &ldquo;GEEGA.&rdquo; The similar name is a coincidence.
        </p>

        <h2>Trademarks</h2>
        <p>
          Magic: The Gathering is a trademark of Wizards of the Coast LLC. Geega Games is not
          affiliated with or endorsed by Wizards of the Coast. Card names and images are shown for
          identification; card data comes in part from Scryfall.
        </p>
      </div>
    </div>
  );
}

export function ContactPage() {
  useSEO({
    title: "Contact Us | Geega Games",
    description: `Questions about an order, a card, or your Magic: The Gathering collection? Email Geega Games — we reply within ${REPLY_WITHIN_HOURS} hours.`,
    path: "/contact",
  });

  return (
    <div className="gg-page gg-prose">
      <h1>Contact</h1>
      <p>
        Questions about an order, a card, or selling your collection? Email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. A real person reads every message,
        and we reply <strong>within {REPLY_WITHIN_HOURS} hours or less</strong>.
      </p>
      <p>
        Want a photo of the actual card before you buy? Tap <strong>Request a photo</strong> under
        any listing priced {PHOTO_REQUEST_MIN_PRICE_LABEL} or more on the card&rsquo;s page, and
        we&rsquo;ll email you one.
      </p>

      <aside className="gg-alert gg-scam-box" aria-labelledby="gg-scam-heading">
        <h2 id="gg-scam-heading">Is this really Geega Games?</h2>
        <ul>
          <li>
            Our only website is <strong>geega-games.com</strong>, and our emails come only from{" "}
            <strong>@geega-games.com</strong> addresses.
          </li>
          <li>
            We will <strong>never</strong> ask you to pay or be paid by PayPal Friends &amp; Family,
            gift cards, wire transfer or crypto.
          </li>
          <li>
            We&rsquo;ll never ask for your password or send you a &ldquo;test&rdquo; payment or
            overpayment to refund.
          </li>
        </ul>
        <p>
          Got a message that doesn&rsquo;t fit? Forward it to{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> before you reply.
        </p>
      </aside>
    </div>
  );
}

export function NotFoundPage() {
  // Never indexed, and with no address of its own to claim (path: null), so a
  // mistyped or retired URL can't pass itself off as the homepage. The server
  // answers these with a real 404 status too (see vercel.json).
  useSEO({
    title: "Page Not Found | Geega Games",
    description:
      "That page doesn't exist. Browse Magic: The Gathering singles or sell your cards at Geega Games.",
    path: null,
    noIndex: true,
  });

  return (
    <div className="gg-page gg-empty">
      <h1>Page not found</h1>
      <p>The page you&rsquo;re looking for doesn&rsquo;t exist.</p>
      <Link to="/shop" className="gg-btn">
        Go to shop
      </Link>
    </div>
  );
}
