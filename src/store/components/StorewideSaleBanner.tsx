import { useEffect, useState } from "react";
import { Link } from "../lib/router";
import { useStorewideSale } from "../lib/storewideSale";

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

// The sale itself comes from the shared snapshot (../lib/storewideSale.ts),
// which also re-prices open carts when the sale starts or ends; this only
// counts down.
export default function StorewideSaleBanner() {
  const { sale } = useStorewideSale();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!sale) return;
    // Catch up at once (the page may have been open a while before the sale
    // appeared), then tick every second.
    const catchUp = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(catchUp);
      window.clearInterval(timer);
    };
  }, [sale]);

  const remaining = sale ? new Date(sale.endsAt).getTime() - now : 0;
  if (!sale || remaining <= 0) return null;

  return (
    <div className="gg-store-sale" role="status" aria-live="polite">
      <div className="gg-store-sale__inner">
        <div className="gg-store-sale__lead">
          <span className="gg-store-sale__eyebrow">Limited-time event</span>
          <span className="gg-store-sale__message">
            <strong>{sale.name}</strong>
            <span>Save {sale.discountPercent}% storewide</span>
          </span>
        </div>

        <div className="gg-store-sale__meta">
          <span className="gg-store-sale__badge">{sale.discountPercent}% OFF</span>
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
