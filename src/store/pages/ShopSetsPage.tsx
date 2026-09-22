import { useEffect, useState } from "react";
import { Link } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import { supabase, isSupabaseConfigured } from "../../supabase";
import { formatCents } from "../lib/money";

// "Shop by Set" index — durable, self-maintaining SEO surface: one row per
// set Geega actually stocks (see shop_sets_with_counts()), so this grows on
// its own as inventory does rather than needing a hand-written page per set.

type SetRow = {
  set_code: string;
  set_name: string;
  card_count: number;
  min_price_cents: number | null;
};

export default function ShopSetsPage() {
  useSEO({
    title: "Shop Magic: The Gathering Singles by Set | Geega Games",
    description:
      "Browse Geega Games' Magic: The Gathering singles organized by set and expansion — from classic editions to the latest releases.",
    path: "/shop/sets",
  });

  const [sets, setSets] = useState<SetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setError("The catalog isn’t configured yet. Please try again later.");
      return;
    }
    let active = true;
    supabase
      .rpc("shop_sets_with_counts")
      .then(({ data, error: rpcError }) => {
        if (!active) return;
        if (rpcError) setError(rpcError.message);
        else setSets((data ?? []) as SetRow[]);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="gg-page">
      <h1 style={{ color: "var(--gg-ink)" }}>Shop by Set</h1>
      <p className="gg-prose" style={{ color: "#555" }}>
        Browse our current Magic: The Gathering singles organized by set and expansion.
      </p>

      {error && (
        <div className="gg-alert gg-alert-error" role="alert">
          {error}
        </div>
      )}

      {!sets && !error ? (
        <p>Loading sets…</p>
      ) : sets && sets.length === 0 ? (
        <div className="gg-empty">
          <p>No sets in stock right now.</p>
          <Link to="/shop" className="gg-btn gg-btn-ghost">
            Browse all singles
          </Link>
        </div>
      ) : (
        <div className="gg-setgrid">
          {sets?.map((s) => (
            <Link key={s.set_code} to={`/shop/set/${s.set_code.toLowerCase()}`} className="gg-settile">
              <strong>{s.set_name}</strong>
              <span className="gg-card-meta">
                {s.card_count} card{s.card_count === 1 ? "" : "s"}
                {s.min_price_cents != null ? ` · from ${formatCents(s.min_price_cents)}` : ""}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
