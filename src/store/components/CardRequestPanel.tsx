import { useEffect, useState } from "react";
import { Link } from "../lib/router";
import { useAuth } from "../lib/AuthContext";
import { useWishlist } from "../lib/WishlistContext";
import { searchSellPrintings } from "../lib/sellApi";
import { cardDetailPath } from "../lib/cardSlug";
import { distinctCards, inStockOracleIds, type RequestableCard } from "../lib/cardRequest";
import { SUPPORT_EMAIL } from "../pages/StaticPages";

// "Can't find it?" under a shop search that found nothing. The card is looked
// up with the same public card search as Sell Your Cards, which also finds
// names typed loosely ("jace mind sculptor"):
//   * a card we do have in stock is linked, so a near-miss search still
//     reaches it;
//   * for one we don't, the visitor picks it and asks to hear when it's in:
//     signed in, it goes on their wishlist (wishlist alerts email them when
//     it's restocked); a guest gets an email-only back-in-stock alert
//     (/api/stock-alerts/subscribe, the same one as an out-of-stock card's
//     page).
// Either way the request shows up as unmet demand in the admin's Market
// Insights (admin_sourcing_signals), so a dead end becomes something to buy.
//
// The shop renders this with key={the search}, so each search starts fresh.

const LOOKUP_DELAY_MS = 400;
const MAX_CHOICES = 6;

type Lookup =
  | { state: "looking" }
  | { state: "found"; inStock: RequestableCard[]; requestable: RequestableCard[] }
  | { state: "none" }
  | { state: "failed" };

export function CardRequestPanel({ query }: { query: string }) {
  const term = query.trim();
  const { user } = useAuth();
  const wishlist = useWishlist();
  const [lookup, setLookup] = useState<Lookup>({ state: "looking" });
  const [picked, setPicked] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const res = await searchSellPrintings(term);
        const cards = distinctCards(res.printings).slice(0, MAX_CHOICES);
        if (cards.length === 0) {
          if (active) setLookup({ state: "none" });
          return;
        }
        // Couldn't check stock: offer them all (an alert for a card that's
        // in stock just arrives straight away).
        const stocked = (await inStockOracleIds(cards.map((c) => c.oracleId))) ?? new Set<string>();
        if (!active) return;
        const requestable = cards.filter((c) => !stocked.has(c.oracleId));
        setLookup({ state: "found", inStock: cards.filter((c) => stocked.has(c.oracleId)), requestable });
        const exact = requestable.find((c) => c.cardName.toLowerCase() === term.toLowerCase());
        setPicked(exact?.oracleId ?? (requestable.length === 1 ? requestable[0].oracleId : null));
      } catch {
        if (active) setLookup({ state: "failed" });
      }
    }, LOOKUP_DELAY_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [term]);

  const inStock = lookup.state === "found" ? lookup.inStock : [];
  const requestable = lookup.state === "found" ? lookup.requestable : [];
  const card = requestable.find((c) => c.oracleId === picked) ?? null;
  const alreadySaved = card ? wishlist.isWishlisted(card.oracleId) : false;

  async function request(e: React.FormEvent) {
    e.preventDefault();
    if (!card) {
      setStatus("error");
      setMessage("Pick the card you're looking for.");
      return;
    }
    setStatus("saving");
    setMessage(null);
    try {
      if (user) {
        if (!alreadySaved) {
          const result = await wishlist.toggle(card.oracleId, card.cardName);
          if (result !== "ok") throw new Error("We couldn't save it to your wishlist. Please try again.");
        }
        setStatus("done");
        setMessage(`${card.cardName} is on your wishlist. We'll email you when it's back in stock.`);
        return;
      }
      const res = await fetch("/api/stock-alerts/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oracleId: card.oracleId, cardName: card.cardName, email, website: honeypot }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.message || "We couldn't save your request. Please try again.");
      setStatus("done");
      setMessage(`We'll email ${email.trim()} when ${card.cardName} is in stock.`);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }

  const emailUs = (
    <>
      email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and tell us what you&rsquo;re looking for
    </>
  );

  return (
    <section className="gg-request" aria-labelledby="gg-request-title">
      <h2 id="gg-request-title" className="gg-request__title">
        Can&rsquo;t find &ldquo;{term}&rdquo;?
      </h2>

      {lookup.state === "looking" && (
        <p className="gg-card-meta" role="status">
          Looking that card up…
        </p>
      )}
      {lookup.state === "none" && (
        <p className="gg-request__none">
          We couldn&rsquo;t find a Magic card called &ldquo;{term}&rdquo;. Check the spelling or try part of the name, or{" "}
          {emailUs}.
        </p>
      )}
      {lookup.state === "failed" && (
        <p className="gg-request__none">We couldn&rsquo;t look that card up just now. Try again in a moment, or {emailUs}.</p>
      )}

      {inStock.length > 0 && (
        <div className="gg-request__instock">
          <p className="gg-request__lead">{inStock.length === 1 ? "We have this one in stock:" : "We have these in stock:"}</p>
          <ul className="gg-request__list">
            {inStock.map((c) => (
              <li key={c.oracleId}>
                <Link to={cardDetailPath(c.cardName)} className="gg-request__card gg-request__card--link">
                  {c.imageUrl ? <img src={c.imageUrl} alt="" loading="lazy" className="gg-request__img" /> : null}
                  <span className="gg-request__name">{c.cardName}</span>
                  <span className="gg-request__go">See it</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {requestable.length > 0 &&
        (status === "done" ? (
          <p className="gg-alert gg-alert-ok gg-request__done" role="status">
            {message}
            {user ? (
              <>
                {" "}
                <Link to="/account/notifications">Alert settings</Link>
              </>
            ) : null}
          </p>
        ) : (
          <>
            <p className="gg-request__lead">
              {inStock.length > 0
                ? "After a different card? Pick it and we’ll email you when we get one."
                : "We don’t have it in stock right now. Tell us which card you’re after and we’ll email you when we get one."}
            </p>
            <form className="gg-request__form" onSubmit={request} noValidate>
              <fieldset className="gg-request__cards">
                <legend>Which card?</legend>
                {requestable.map((c) => (
                  <label key={c.oracleId} className={picked === c.oracleId ? "gg-request__card gg-request__card--picked" : "gg-request__card"}>
                    <input
                      type="radio"
                      name="gg-request-card"
                      value={c.oracleId}
                      checked={picked === c.oracleId}
                      onChange={() => setPicked(c.oracleId)}
                    />
                    {c.imageUrl ? <img src={c.imageUrl} alt="" loading="lazy" className="gg-request__img" /> : null}
                    <span className="gg-request__name">{c.cardName}</span>
                  </label>
                ))}
              </fieldset>
              {user ? (
                <button type="submit" className="gg-btn" disabled={status === "saving" || !wishlist.loaded}>
                  {status === "saving" ? "Saving…" : alreadySaved ? "It's on my wishlist" : "Save to my wishlist and email me"}
                </button>
              ) : (
                <div className="gg-request__email">
                  <label htmlFor="gg-request-email">Your email</label>
                  <div className="gg-notify-form__row">
                    <input
                      id="gg-request-email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={status === "saving"}
                    />
                    <button type="submit" className="gg-btn" disabled={status === "saving"}>
                      {status === "saving" ? "Saving…" : "Email me when it's in"}
                    </button>
                  </div>
                </div>
              )}
              {/* Honeypot: hidden from people and screen readers. */}
              <div className="gg-referral-hp" aria-hidden="true">
                <label htmlFor="gg-request-website">Website</label>
                <input id="gg-request-website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
              </div>
              {status === "error" && message && (
                <p className="gg-alert gg-alert-error" role="alert">
                  {message}
                </p>
              )}
              <p className="gg-card-meta">
                {user
                  ? "Wishlist alerts also tell you when it drops in price or goes on sale."
                  : "One email when it’s in stock. Nothing else."}
              </p>
            </form>
          </>
        ))}
    </section>
  );
}
