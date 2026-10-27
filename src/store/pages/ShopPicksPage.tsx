import { useEffect, useMemo, useState } from "react";
import { Link, useRouter } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import { supabase, isSupabaseConfigured } from "../../supabase";
import ProductCard from "../components/ProductCard";
import { TradeCartProgress } from "../components/trades/TradeCartProgress";
import { cardDetailPath } from "../lib/cardSlug";
import { listingTiles, type CardDetail } from "../lib/cardDetail";
import { PICKS_PATH, readPickSlugs } from "../lib/postLinks";

// /shop/picks?c=slug,slug,… — the cards from one of our social posts, so a
// post about a few cards lands on exactly those cards (with Add to cart and
// Add to trade) instead of the whole shop. Every in-stock copy of each card
// is shown, in the post's order; cards that sold since the post are listed
// below with a link to their page (where visitors can ask to hear when it's
// back). The admin's "Copy Facebook post link" (Inventory) makes these links.

/** One card from the link: its details, or null when we no longer list it. */
type Loaded = { slug: string; detail: CardDetail | null };

export default function ShopPicksPage() {
  const { query } = useRouter();
  const param = query.get("c");
  const slugs = useMemo(() => readPickSlugs(param), [param]);
  const key = slugs.join(",");
  const canLoad = slugs.length > 0 && isSupabaseConfigured;
  // The cards for the link last loaded (keyed, so a different link shows
  // the loading state until its own cards are in).
  const [result, setResult] = useState<{ key: string; rows: Loaded[] } | null>(null);

  useSEO({
    title: "Cards from our post | Geega Games",
    description: "The Magic: The Gathering singles from our post, ready to add to your cart or your trade.",
    path: PICKS_PATH,
    noIndex: true,
  });

  useEffect(() => {
    if (!canLoad) return;
    let active = true;
    Promise.all(
      slugs.map(async (slug): Promise<Loaded> => {
        try {
          const { data, error } = await supabase.rpc("get_card_detail", { p_slug: slug });
          return { slug, detail: error || !data ? null : (data as unknown as CardDetail) };
        } catch {
          return { slug, detail: null };
        }
      }),
    ).then((rows) => {
      if (active) setResult({ key, rows });
    });
    return () => {
      active = false;
    };
  }, [canLoad, key, slugs]);

  const rows = !canLoad ? [] : result?.key === key ? result.rows : null;
  const inStock = (rows ?? []).flatMap((r) => (r.detail ? listingTiles(r.detail) : []));
  const soldOut = (rows ?? []).flatMap((r) => (r.detail && listingTiles(r.detail).length === 0 ? [r.detail] : []));

  return (
    <div className="gg-page gg-picks">
      <header className="gg-picks__head">
        <h1>Cards from our post</h1>
        <p className="gg-picks__lead">
          Ready to add to your cart, or to a trade. Prices and stock are live, so what you see here is what&rsquo;s available now.
        </p>
      </header>

      <TradeCartProgress />

      {slugs.length === 0 ? (
        <div className="gg-empty">
          <p>This link doesn&rsquo;t list any cards.</p>
          <Link to="/shop" className="gg-btn">
            Browse the shop
          </Link>
        </div>
      ) : rows === null ? (
        <div className="gg-grid" aria-hidden="true">
          {slugs.slice(0, 8).map((s) => (
            <div className="gg-card" key={s}>
              <div className="gg-card-imgwrap">
                <div className="gg-card-img gg-skeleton" />
              </div>
              <div className="gg-card-body">
                <div className="gg-skeleton" style={{ height: 16 }} />
                <div className="gg-skeleton" style={{ height: 12, width: "60%" }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {inStock.length > 0 ? (
            <div className="gg-grid">
              {inStock.map((card) => (
                <ProductCard key={card.id} card={card} />
              ))}
            </div>
          ) : (
            <div className="gg-empty">
              <p>These cards have all sold since we posted them.</p>
              {soldOut.length > 0 && (
                <ul className="gg-picks__soldout-list">
                  {soldOut.map((d) => (
                    <li key={d.oracleId}>
                      <Link to={cardDetailPath(d.cardName)}>{d.cardName}</Link>: get an email when it&rsquo;s back
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/shop" className="gg-btn">
                See what&rsquo;s in stock
              </Link>
            </div>
          )}
          {soldOut.length > 0 && inStock.length > 0 && (
            <section className="gg-picks__soldout" aria-labelledby="gg-picks-soldout">
              <h2 id="gg-picks-soldout">Sold since we posted</h2>
              <ul>
                {soldOut.map((d) => (
                  <li key={d.oracleId}>
                    <Link to={cardDetailPath(d.cardName)}>{d.cardName}</Link>
                  </li>
                ))}
              </ul>
              <p className="gg-card-meta">Open a card to get an email when it&rsquo;s back in stock.</p>
            </section>
          )}
          {inStock.length > 0 && (
            <p className="gg-picks__more">
              <Link to="/shop">See everything in the shop</Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}
