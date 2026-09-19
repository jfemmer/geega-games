import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { Link } from "../lib/router";

type ActiveSale = {
  id: string;
  name: string;
  discount_percent: number;
  starts_at: string;
  ends_at: string;
};

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export default function StorewideSaleBanner() {
  const [sale, setSale] = useState<ActiveSale | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let active = true;

    const load = async () => {
      const { data, error } = await supabase.rpc("current_storewide_sale");
      if (!active || error) return;
      const row = Array.isArray(data) ? data[0] : null;
      setSale((row as ActiveSale | undefined) ?? null);
    };

    void load();
    const refreshTimer = window.setInterval(load, 30_000);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, []);

  useEffect(() => {
    if (!sale) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [sale]);

  const remaining = useMemo(() => {
    if (!sale) return 0;
    return new Date(sale.ends_at).getTime() - now;
  }, [sale, now]);

  useEffect(() => {
    if (sale && remaining <= 0) setSale(null);
  }, [sale, remaining]);

  if (!sale || remaining <= 0) return null;

  return (
    <div className="gg-store-sale" role="status" aria-live="polite">
      <div className="gg-store-sale__inner">
        <div className="gg-store-sale__lead">
          <span className="gg-store-sale__eyebrow">Limited-time event</span>
          <span className="gg-store-sale__message">
            <strong>{sale.name}</strong>
            <span>Save {sale.discount_percent}% storewide</span>
          </span>
        </div>

        <div className="gg-store-sale__meta">
          <span className="gg-store-sale__badge">{sale.discount_percent}% OFF</span>
          <span className="gg-store-sale__timer">
            <span>Ends in</span>
            <strong>{formatRemaining(remaining)}</strong>
          </span>
          <Link to="/shop" className="gg-store-sale__link">
            Shop sale
          </Link>
        </div>
      </div>
    </div>
  );
}
