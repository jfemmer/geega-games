import { Link } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import SignupForm from "../../SignupForm";
import { SITE } from "../../siteConfig";

export const SUPPORT_EMAIL =
  (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) ??
  "support@geega-games.com";

export function HomePage() {
  return (
    <div className="gg-page">
      <section style={{ textAlign: "center", padding: "2rem 0 1rem" }}>
        <h1 style={{ color: "var(--gg-ink)", fontSize: "2rem", marginBottom: "0.5rem" }}>
          Magic: The Gathering singles, carefully curated
        </h1>
        <p className="gg-prose" style={{ color: "#555" }}>
          Real inventory, honest condition grading, and fast shipping from Geega
          Games. Browse current singles and build your deck.
        </p>
        <div style={{ marginTop: "1.25rem" }}>
          <Link to="/shop" className="gg-btn">
            Shop singles
          </Link>
        </div>
      </section>

      <section className="gg-sellcta">
        <h2>Looking to sell your collection?</h2>
        <p>
          From a few valuable singles to an entire Magic collection, Geega Games is always
          interested in seeing what you have.
        </p>
        <Link to="/sell-my-collection" className="gg-btn">
          Sell Your Cards
        </Link>
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

export function ConditionGuidePage() {
  useSEO({
    title: "MTG Card Condition Guide — NM, LP, MP, HP, DMG Explained | Geega Games",
    description:
      "How Geega Games grades every Magic: The Gathering single before listing it — Near Mint through Damaged, explained in plain language.",
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
      <p>
        Questions about a specific card&rsquo;s condition? Email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> before ordering
        and we&rsquo;ll be glad to help.
      </p>
    </div>
  );
}

export function ShippingPage() {
  useSEO({
    title: "Shipping Options & Rates | Geega Games",
    description:
      "Plain white envelope and tracked shipping options for Magic: The Gathering card orders — costs shown before you pay, with free tracked shipping on qualifying orders.",
    path: "/shipping",
  });

  return (
    <div className="gg-page gg-prose">
      <h1>Shipping</h1>
      <p>We offer two shipping options at checkout:</p>
      <h2>Plain White Envelope (PWE)</h2>
      <p>
        A low-cost option for smaller orders. Cards ship protected in a sleeve
        and top-loader inside a plain envelope. PWE is not tracked.
      </p>
      <h2>Tracked shipping</h2>
      <p>
        Fully tracked and better protected, recommended for higher-value orders.
        Tracked shipping is <strong>free</strong> on qualifying orders — the
        threshold is shown in your cart and at checkout.
      </p>
      <p>
        Exact shipping costs are always calculated and shown before you pay.
      </p>
      <p className="gg-alert gg-alert-warn">
        Delivery time estimates and carrier details are configured by the store
        owner. If you have a shipping question, contact{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    </div>
  );
}

export function ReturnsPage() {
  useSEO({
    title: "Returns & Refunds | Geega Games",
    description:
      "How to start a return or report an issue with your Magic: The Gathering card order from Geega Games.",
    path: "/returns",
  });

  return (
    <div className="gg-page gg-prose">
      <h1>Returns &amp; refunds</h1>
      <p>
        If an item arrives not as described or damaged in transit, contact us
        within a reasonable window of delivery and we&rsquo;ll make it right.
      </p>
      <p>
        To start a return or report a problem, email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with your order
        number and a description (photos help for damage claims).
      </p>
      <p className="gg-alert gg-alert-warn">
        The full return window, restocking policy, and who pays return shipping
        are business decisions the store owner should finalize before launch.
      </p>
    </div>
  );
}

// disambiguatingDescription is the schema.org field built specifically for
// telling similarly-named entities apart. It exists here because Google's AI
// Overview has, at least once, summarized this site as "operated by the
// content creator GEEGA" — an unrelated streamer whose name is nearly
// identical to ours. Keep this page and JSON-LD (and the matching block in
// index.html) if that misattribution recurs.
const ABOUT_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  name: `About ${SITE.name}`,
  url: `${SITE.url}/about`,
  mainEntity: {
    "@type": "Organization",
    name: SITE.name,
    legalName: "Geega Games LLC",
    url: SITE.url,
    disambiguatingDescription: `${SITE.name} is an independently owned and operated online Magic: The Gathering card shop. It is not affiliated with, operated by, or endorsed by any content creator, streamer, or influencer, including anyone using the name "Geega" or "GEEGA."`,
  },
};

export function AboutPage() {
  useSEO({
    title: "About Us | Geega Games",
    description:
      "Geega Games is an independently owned and operated online Magic: The Gathering card shop — not affiliated with any content creator or streamer.",
    path: "/about",
    jsonLd: ABOUT_JSON_LD,
  });

  return (
    <div className="gg-page gg-prose">
      <h1>About Geega Games</h1>
      <p>
        Geega Games is an independently owned and operated online storefront
        for Magic: The Gathering singles, run by Geega Games LLC, a Missouri
        limited liability company. We personally grade every card we list
        (see our <Link to="/condition-guide">condition guide</Link>), buy
        individual cards and full collections from sellers (see{" "}
        <Link to="/sell-my-collection">Sell Your Collection</Link>), and ship
        orders nationwide from the St.&nbsp;Louis, MO area.
      </p>

      <h2>Not affiliated with any content creator</h2>
      <p>
        Geega Games is <strong>not affiliated with, operated by, sponsored
        by, or endorsed by any content creator, YouTuber, streamer, or
        influencer</strong> — including anyone using the name &ldquo;Geega&rdquo;
        or &ldquo;GEEGA.&rdquo; Any resemblance between our business name and
        an individual&rsquo;s name or online handle is coincidental. Geega
        Games is an independent card business with no connection to,
        partnership with, or endorsement from any such person or channel.
      </p>

      <h2>What we do</h2>
      <p>
        Card names, images, and printing data shown on the Service are
        sourced in part via the Scryfall API. Magic: The Gathering and
        related marks are trademarks of Wizards of the Coast LLC, and Geega
        Games is not affiliated with or endorsed by Wizards of the Coast.
      </p>

      <h2>Questions?</h2>
      <p>
        Reach out any time at{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. For our
        legal terms and privacy practices, see our{" "}
        <Link to="/terms">Terms of Service</Link> and{" "}
        <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </div>
  );
}

export function ContactPage() {
  useSEO({
    title: "Contact Us | Geega Games",
    description:
      "Questions about an order, a card, or your Magic: The Gathering collection? Get in touch with Geega Games.",
    path: "/contact",
  });

  return (
    <div className="gg-page gg-prose">
      <h1>Contact</h1>
      <p>
        Questions about an order, a card, or anything else? Email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we&rsquo;ll
        get back to you.
      </p>
    </div>
  );
}

export function NotFoundPage() {
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
