import { useAuth } from "../lib/AuthContext";
import { Link } from "../lib/router";
import { Icon, type StoreIconName } from "./Icon";

// What a free account actually unlocks. Every line here must describe a
// feature that exists today (checkout, /account/*, the deck builder's
// restock watch, the wishlist) — this is a promise to the customer, so no
// perks we haven't built (discounts, points, early access).
const ACCOUNT_PERKS: { icon: StoreIconName; title: string; body: string }[] = [
  {
    icon: "deck",
    title: "Build decks, get restock alerts",
    body: "Paste a decklist to see what's in stock, add it all to your cart, and get alerted when missing cards arrive.",
  },
  {
    icon: "heart",
    title: "Save a wishlist",
    body: "Heart any card to keep it on your list, on every device you sign in from.",
  },
  {
    icon: "truck",
    title: "Faster checkout & order tracking",
    body: "Saved shipping addresses, your full order history, and live tracking on every order.",
  },
  {
    icon: "tag",
    title: "Sell your cards with less hassle",
    body: "Follow every sell submission and see your store credit balance in one place.",
  },
];

export function AccountPerksList({ compact = false }: { compact?: boolean }) {
  return (
    <ul className={`gg-perks${compact ? " gg-perks--compact" : ""}`}>
      {ACCOUNT_PERKS.map((perk) => (
        <li key={perk.title} className="gg-perk">
          <span className="gg-perk-icon">
            <Icon name={perk.icon} size={compact ? 18 : 22} />
          </span>
          <span>
            <strong>{perk.title}</strong>
            {!compact && <span className="gg-perk-body">{perk.body}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Home-page pitch for signed-out visitors. Renders nothing once signed in. */
export function JoinSection() {
  const { user, loading } = useAuth();
  if (loading || user) return null;
  return (
    <section className="gg-join" aria-labelledby="gg-join-title">
      <div className="gg-join-head">
        <h2 id="gg-join-title">Get more out of Geega Games — it&rsquo;s free</h2>
        <p>One account for buying, tracking, and selling cards. Takes about a minute.</p>
      </div>
      <AccountPerksList />
      <div className="gg-join-actions">
        <Link to="/signup" className="gg-btn">
          Create a free account
        </Link>
        <Link to="/login" className="gg-join-signin">
          Already have one? Sign in
        </Link>
      </div>
    </section>
  );
}
