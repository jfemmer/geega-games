import { Link } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import SignupForm from "../../SignupForm";
import { JoinSection } from "../components/AccountPerks";
import DeckShowcase from "../components/DeckShowcase";
import { AreaLinks } from "../components/SellLandingSections";
import { DEFAULT_SEO, MAX_DRIVE_HOURS, WEBSITE_JSON_LD } from "../../seo/site";
import { ST_LOUIS_PATH } from "../../seo/sellAreas";
import { SHIPPING, formatCents } from "../lib/money";

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
// email replies within 24 hours; photos of the actual card on request.
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
        you&rsquo;d be buying, email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with
        the card name and we&rsquo;ll send one — we reply within {REPLY_WITHIN_HOURS} hours.
      </p>
    </div>
  );
}

export function ShippingPage() {
  useSEO({
    title: "Shipping Options & Rates | Geega Games",
    description: `Every Geega Games order ships within ${SHIPS_WITHIN_BUSINESS_DAYS} business days, sleeved, top-loaded and packed tight. Plain white envelope or tracked shipping, with free tracked shipping over ${formatCents(SHIPPING.freeTrackedThresholdCents)}.`,
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
        it. We ship Monday through Saturday — the post office is closed on Sundays. You&rsquo;ll get
        an email when your order ships, and you can check on it any time on{" "}
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
      <h3>Plain White Envelope (PWE) — {formatCents(SHIPPING.pweCents)}</h3>
      <p>
        A low-cost option for smaller orders: sleeved and top-loaded inside a plain envelope. PWE is{" "}
        <strong>not tracked</strong>, so a lost envelope can&rsquo;t be traced — for anything
        you&rsquo;d hate to lose, choose tracked shipping.
      </p>
      <h3>Tracked shipping — {formatCents(SHIPPING.trackedCents)}</h3>
      <p>
        Fully tracked and better protected, recommended for higher-value orders.{" "}
        <strong>Free on orders of {formatCents(SHIPPING.freeTrackedThresholdCents)} or more.</strong>
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
        Want a photo of the actual card before you buy? Just ask — include the card name and
        we&rsquo;ll send one.
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
