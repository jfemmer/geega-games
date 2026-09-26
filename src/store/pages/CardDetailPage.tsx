import { useEffect, useState } from "react";
import { Link } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import { useCart } from "../lib/CartContext";
import { supabase, isSupabaseConfigured } from "../../supabase";
import { storefrontImageUrl, scryfallSrcSet } from "../../cards";
import { SUPPORT_EMAIL } from "./StaticPages";
import { formatCents } from "../lib/money";
import { SITE } from "../../siteConfig";
import { CONDITION_LABELS } from "../components/ProductCard";
import WishlistButton from "../components/WishlistButton";
import { useAuth } from "../lib/AuthContext";
import { useWishlist } from "../lib/WishlistContext";
import { authLinkWithReturn } from "../lib/authRedirect";

// One indexable page per unique card (grouped by oracle_id across every
// in-stock printing/condition — see public.get_card_detail), distinct from
// /shop's single browse-everything grid. This is what lets a specific-card
// search ("buy <card name>") land somewhere more useful than the homepage.

type CardListing = {
  id: string;
  scryfallId: string | null;
  setCode: string | null;
  setName: string | null;
  collectorNumber: string | null;
  rarity: string | null;
  condition: string;
  finish: string;
  variantType: string | null;
  imageUrl: string | null;
  quantity: number;
  priceCents: number | null;
  isDeal: boolean;
  originalPriceCents: number | null;
  dealDiscountPercent: number | null;
  dealSource: "manual" | "aged_inventory" | "flawed" | null;
  dealNote: string | null;
};

type CardDetail = {
  oracleId: string;
  cardName: string;
  listings: CardListing[];
  inStockCount: number;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  typeLine?: string | null;
  oracleText?: string | null;
  manaCost?: string | null;
  power?: string | null;
  toughness?: string | null;
  loyalty?: string | null;
  flavorText?: string | null;
};

function priceSummary(detail: CardDetail): string {
  if (detail.listings.length === 0) return "Currently out of stock";
  return detail.minPriceCents === detail.maxPriceCents
    ? formatCents(detail.minPriceCents)
    : `${formatCents(detail.minPriceCents)} – ${formatCents(detail.maxPriceCents)}`;
}

function buildDescription(detail: CardDetail): string {
  const bits: string[] = [];
  if (detail.typeLine) bits.push(detail.typeLine);
  bits.push(
    detail.listings.length > 0
      ? `From ${formatCents(detail.minPriceCents)}`
      : "Currently out of stock",
  );
  if (detail.listings.length > 0) {
    bits.push(`${detail.inStockCount} listing${detail.inStockCount === 1 ? "" : "s"} in stock`);
  }
  return `Buy ${detail.cardName} — ${bits.join(" · ")}. Honest condition grading, secure checkout, and fast shipping from Geega Games.`;
}

export default function CardDetailPage({ slug }: { slug: string }) {
  const { addItem } = useCart();
  const [detail, setDetail] = useState<CardDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [notifyState, setNotifyState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [notifyError, setNotifyError] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setNotFound(false);
    setDetail(null);

    if (!isSupabaseConfigured) {
      setLoading(false);
      setNotFound(true);
      return;
    }

    (async () => {
      try {
        const { data, error } = await supabase.rpc("get_card_detail", { p_slug: slug });
        if (!active) return;
        if (error || !data) {
          setNotFound(true);
          return;
        }
        setDetail(data as unknown as CardDetail);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [slug]);

  async function submitNotifyMe(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setNotifyState("submitting");
    setNotifyError(null);
    try {
      const res = await fetch("/api/stock-alerts/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oracleId: detail.oracleId,
          cardName: detail.cardName,
          email: notifyEmail,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        throw new Error(body?.message || "Could not save your request. Please try again.");
      }
      setNotifyState("done");
    } catch (err) {
      setNotifyState("error");
      setNotifyError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }

  const path = `/shop/card/${slug}`;
  const canonicalUrl = `${SITE.url.replace(/\/+$/, "")}${path}`;

  const jsonLd =
    detail && !loading
      ? [
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Shop", item: `${SITE.url}/shop` },
              { "@type": "ListItem", position: 2, name: detail.cardName, item: canonicalUrl },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "Product",
            name: detail.cardName,
            description: detail.typeLine || "Magic: The Gathering trading card",
            ...(detail.listings[0]?.imageUrl
              ? { image: [storefrontImageUrl(detail.listings[0].imageUrl)] }
              : {}),
            category: "Trading Card",
            brand: { "@type": "Brand", name: "Magic: The Gathering" },
            offers:
              detail.listings.length > 0
                ? {
                    "@type": "AggregateOffer",
                    priceCurrency: "USD",
                    lowPrice: ((detail.minPriceCents ?? 0) / 100).toFixed(2),
                    highPrice: ((detail.maxPriceCents ?? 0) / 100).toFixed(2),
                    offerCount: detail.listings.length,
                    availability: "https://schema.org/InStock",
                    url: canonicalUrl,
                  }
                : {
                    "@type": "Offer",
                    priceCurrency: "USD",
                    price: "0.00",
                    availability: "https://schema.org/OutOfStock",
                    url: canonicalUrl,
                  },
          },
        ]
      : undefined;

  useSEO({
    title: detail
      ? `${detail.cardName} — Buy Magic: The Gathering Singles | Geega Games`
      : "Card Not Found | Geega Games",
    description: detail
      ? buildDescription(detail)
      : "This card isn't currently listed at Geega Games. Browse our full Magic: The Gathering singles catalog instead.",
    path,
    jsonLd,
    noIndex: !loading && (notFound || !detail || detail.listings.length === 0),
  });

  if (loading) {
    return (
      <div className="gg-page">
        <div className="gg-skeleton" style={{ height: 420 }} />
      </div>
    );
  }

  if (notFound || !detail) {
    return (
      <div className="gg-page gg-empty">
        <h1>Card not found</h1>
        <p>We couldn&rsquo;t find that card in our current inventory.</p>
        <Link to="/shop" className="gg-btn">
          Browse the shop
        </Link>
      </div>
    );
  }

  const hero = detail.listings[0] ?? null;

  return (
    <div className="gg-page gg-card-detail">
      <nav className="gg-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/shop">Shop</Link> <span aria-hidden="true">/</span>{" "}
        <span>{detail.cardName}</span>
      </nav>

      <div className="gg-card-detail__layout">
        <div className="gg-card-detail__image">
          {hero?.imageUrl ? (
            <img
              src={storefrontImageUrl(hero.imageUrl) ?? hero.imageUrl}
              srcSet={scryfallSrcSet(hero.imageUrl) ?? undefined}
              sizes="(max-width: 640px) 80vw, 360px"
              alt={detail.cardName}
              width={488}
              height={680}
            />
          ) : (
            <div
              role="img"
              aria-label={`${detail.cardName} (no image available)`}
              className="gg-card-detail__noimage"
            >
              No image
            </div>
          )}
          <p className="gg-card-detail__photo-note">
            Stock image — your card matches the condition listed (
            <Link to="/condition-guide">how we grade</Link>). Want a photo of the actual card?{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Photo request: ${detail.cardName}`)}`}
            >
              Ask us
            </a>
            .
          </p>
        </div>

        <div className="gg-card-detail__info">
          <div className="gg-card-detail__titlerow">
            <h1>{detail.cardName}</h1>
            <WishlistButton oracleId={detail.oracleId} cardName={detail.cardName} />
          </div>
          {detail.typeLine && <p className="gg-card-detail__type">{detail.typeLine}</p>}
          {(detail.manaCost || detail.power || detail.toughness || detail.loyalty) && (
            <p className="gg-card-detail__stats">
              {detail.manaCost}
              {detail.manaCost && (detail.power || detail.toughness || detail.loyalty) ? " · " : ""}
              {detail.power != null && detail.toughness != null
                ? `${detail.power}/${detail.toughness}`
                : detail.loyalty
                  ? `Loyalty: ${detail.loyalty}`
                  : ""}
            </p>
          )}
          {detail.oracleText && (
            <p className="gg-card-detail__oracle">{detail.oracleText}</p>
          )}
          {detail.flavorText && (
            <p className="gg-card-detail__flavor">{detail.flavorText}</p>
          )}

          <div className="gg-card-detail__pricesummary">
            <strong>{priceSummary(detail)}</strong>
            {detail.listings.length > 0 && (
              <span>
                {" "}
                · {detail.inStockCount} listing{detail.inStockCount === 1 ? "" : "s"} in stock
              </span>
            )}
          </div>
        </div>
      </div>

      {detail.listings.length > 0 ? (
        <div className="gg-card-detail__listings">
          <h2>Available listings</h2>
          <ul className="gg-card-detail__listinglist">
            {detail.listings.map((l) => (
              <li key={l.id} className="gg-card-detail__listing">
                <span className="gg-card-detail__listingmeta">
                  <span className="gg-card-detail__listingset">
                    {l.setName ?? l.setCode?.toUpperCase()}
                    {l.collectorNumber ? ` · #${l.collectorNumber}` : ""}
                  </span>
                  <span className="gg-card-badges">
                    <span className="gg-badge">
                      {CONDITION_LABELS[l.condition] ?? l.condition}
                    </span>
                    {l.finish !== "nonfoil" && (
                      <span className="gg-badge gg-badge-foil">{l.finish}</span>
                    )}
                    {l.variantType && (
                      <span className="gg-badge gg-badge-variant">{l.variantType}</span>
                    )}
                  </span>
                  {l.isDeal && l.dealNote && (
                    <p className="gg-deal-note">
                      {l.dealSource === "flawed" ? <strong>Condition note: </strong> : null}
                      {l.dealNote}
                    </p>
                  )}
                </span>
                <span className="gg-card-detail__listingbuy">
                  <span className="gg-priceblock">
                    <span className={l.isDeal ? "gg-price gg-price--deal" : "gg-price"}>
                      {formatCents(l.priceCents)}
                    </span>
                    {l.isDeal &&
                      l.originalPriceCents != null &&
                      l.originalPriceCents > (l.priceCents ?? 0) && (
                        <span className="gg-price-original">
                          {formatCents(l.originalPriceCents)}
                        </span>
                      )}
                  </span>
                  {l.quantity <= 3 && (
                    <span className="gg-card-stock">Only {l.quantity} left</span>
                  )}
                  <button
                    className="gg-btn gg-btn-sm"
                    disabled={addingId === l.id}
                    onClick={async () => {
                      setAddingId(l.id);
                      try {
                        await addItem(l.id, 1);
                        setAddedId(l.id);
                        window.setTimeout(
                          () => setAddedId((cur) => (cur === l.id ? null : cur)),
                          1500,
                        );
                      } finally {
                        setAddingId(null);
                      }
                    }}
                  >
                    {addedId === l.id ? "Added ✓" : addingId === l.id ? "Adding…" : "Add to cart"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="gg-card-detail__listings">
          <p>
            This card is out of stock right now. <Link to="/shop">Browse what&rsquo;s available</Link>{" "}
            or check back soon.
          </p>
          {user ? (
            <SavedForAlerts oracleId={detail.oracleId} cardName={detail.cardName} />
          ) : notifyState === "done" ? (
            <p className="gg-alert gg-alert-ok">
              We&rsquo;ll email you as soon as {detail.cardName} is back in stock.
            </p>
          ) : (
            <form className="gg-notify-form" onSubmit={submitNotifyMe}>
              <label htmlFor="notify-email">Notify me when it&rsquo;s back in stock</label>
              <div className="gg-notify-form__row">
                <input
                  id="notify-email"
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={notifyEmail}
                  onChange={(e) => setNotifyEmail(e.target.value)}
                  disabled={notifyState === "submitting"}
                />
                <button className="gg-btn gg-btn-sm" type="submit" disabled={notifyState === "submitting"}>
                  {notifyState === "submitting" ? "Saving…" : "Notify me"}
                </button>
              </div>
              {notifyState === "error" && notifyError && (
                <p className="gg-alert gg-alert-error">{notifyError}</p>
              )}
            </form>
          )}
          {!user && (
            <p className="gg-card-meta gg-notify-upsell">
              Want price-drop and sale alerts too?{" "}
              <Link to={authLinkWithReturn("/signup")}>Create a free account</Link> and save it
              to your wishlist.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Out-of-stock alert for a signed-in customer: one tap saves the card to their
 * wishlist, and wishlist alerts (restock / price drop / sale) do the rest —
 * no separate email form.
 */
function SavedForAlerts({ oracleId, cardName }: { oracleId: string; cardName: string }) {
  const { isWishlisted, pending, toggle } = useWishlist();
  const [error, setError] = useState(false);
  const saved = isWishlisted(oracleId);
  const busy = pending.has(oracleId);

  if (saved) {
    return (
      <p className="gg-alert gg-alert-ok">
        {cardName} is on your wishlist — we&rsquo;ll email you when it&rsquo;s back in stock,
        drops in price, or goes on sale. <Link to="/account/wishlist">View wishlist</Link>
      </p>
    );
  }
  return (
    <div className="gg-notify-form">
      <p style={{ margin: "0 0 0.5rem" }}>
        Save it to your wishlist and we&rsquo;ll email you the moment it&rsquo;s back.
      </p>
      <button
        type="button"
        className="gg-btn gg-btn-sm"
        disabled={busy}
        onClick={async () => {
          setError(false);
          const result = await toggle(oracleId, cardName);
          if (result === "error") setError(true);
        }}
      >
        {busy ? "Saving…" : "Save & notify me"}
      </button>
      {error && (
        <p className="gg-alert gg-alert-error">Couldn&rsquo;t save it just now. Please try again.</p>
      )}
    </div>
  );
}
