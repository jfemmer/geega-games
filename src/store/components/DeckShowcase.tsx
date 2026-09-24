import { useAuth } from "../lib/AuthContext";
import { authLinkWithReturn } from "../lib/authRedirect";
import { openDeckShopper } from "../lib/deckShopper";
import { Link } from "../lib/router";
import { Icon } from "./Icon";

// Home-page feature section for "Shop my deck" (the header's ShopByDeck
// button + the deck builder at /account/decks). Describes only what those
// actually do: parse a pasted/uploaded list, match it against live
// inventory via deck_inventory_matches, bulk-add in-stock cards, skip
// cards marked owned, and raise restock alerts for the rest.

const STEPS: { title: string; body: string }[] = [
  {
    title: "Paste your decklist",
    body: "Drop in a list or upload a text/CSV file — Commander, Standard, Modern and more.",
  },
  {
    title: "See what's in stock",
    body: "We check every card against our live inventory and total it up, skipping cards you already own.",
  },
  {
    title: "Add it all in one click",
    body: "Every available card goes straight into your cart. No hunting card by card.",
  },
  {
    title: "Get the rest when it lands",
    body: "Missing cards are watched for you — you're alerted as soon as they restock.",
  },
];

export default function DeckShowcase() {
  const { user, loading } = useAuth();

  return (
    <section className="gg-deckshow" aria-labelledby="gg-deckshow-title">
      <div className="gg-deckshow-copy">
        <p className="gg-deckshow-eyebrow">
          <Icon name="deck" size={16} /> Shop my deck
        </p>
        <h2 id="gg-deckshow-title">Buy your whole deck in one click</h2>
        <p className="gg-deckshow-lede">
          Stop searching card by card. Paste your decklist once and we&rsquo;ll pull
          every card we have in stock into your cart, then keep watch for the rest.
        </p>

        <ol className="gg-deckshow-steps">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <span className="gg-deckshow-num" aria-hidden="true">
                {i + 1}
              </span>
              <span>
                <strong>{step.title}</strong>
                <span className="gg-deckshow-stepbody">{step.body}</span>
              </span>
            </li>
          ))}
        </ol>

        {/* Hold the buttons back until auth resolves so a signed-in visitor
            never briefly sees "Create a free account". */}
        {!loading && (
          <div className="gg-deckshow-actions">
            {user ? (
              <>
                <button type="button" className="gg-btn" onClick={openDeckShopper}>
                  Shop a saved deck
                </button>
                <Link to="/account/decks" className="gg-btn gg-btn-ghost">
                  Build a new deck
                </Link>
              </>
            ) : (
              <>
                <Link to={authLinkWithReturn("/signup", "/account/decks")} className="gg-btn">
                  Create a free account to start
                </Link>
                <Link to={authLinkWithReturn("/login", "/account/decks")} className="gg-deckshow-signin">
                  Already have an account? Sign in
                </Link>
              </>
            )}
          </div>
        )}
        <p className="gg-deckshow-hint">
          Always one tap away: look for the <strong>deck button</strong> beside the search bar
          on every page.
        </p>
      </div>

      {/* Illustration of the header popover. Decorative: sample numbers, not
          live data, so it's hidden from assistive tech and labeled "Example". */}
      <div className="gg-deckshow-demo" aria-hidden="true">
        <span className="gg-deckshow-demo-tag">Example</span>
        <div className="gg-deckshow-demo-card">
          <strong>Atraxa Superfriends</strong>
          <span className="gg-deckshow-demo-meta">Commander · 99 cards</span>
          <div className="gg-deckshow-demo-bar">
            <span style={{ width: "64%" }} />
          </div>
          <span className="gg-deckshow-demo-meta">63 of 99 cards available at Geega · $184.20</span>
          <span className="gg-deckshow-demo-btn">Add 63 to cart</span>
          <span className="gg-deckshow-demo-watch">
            <Icon name="bell" size={14} /> Watching 36 cards for restock
          </span>
        </div>
      </div>
    </section>
  );
}
