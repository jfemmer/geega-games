import { Link } from "../lib/router";
import SignupForm from "../../SignupForm";

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

export function ContactPage() {
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

export function PrivacyPage() {
  return (
    <div className="gg-page gg-prose">
      <h1>Privacy policy</h1>
      <p className="gg-alert gg-alert-warn">
        This is a placeholder. A real privacy policy must be provided by the
        store owner before launch. It should cover what data is collected
        (account, orders, addresses), how it is used, payment processing, and
        contact for data requests.
      </p>
      <p>
        Questions in the meantime: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    </div>
  );
}

export function TermsPage() {
  return (
    <div className="gg-page gg-prose">
      <h1>Terms of service</h1>
      <p className="gg-alert gg-alert-warn">
        This is a placeholder. Real terms of service must be provided by the
        store owner before launch.
      </p>
      <p>
        Questions: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
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
