import { formatReopenDate, useStoreStatus } from "../lib/storeStatus";

// Site-wide notice while vacation mode is on (Admin → Vacation Mode).
export default function OrdersPausedBanner() {
  const { ordersPaused, message, pausedUntil } = useStoreStatus();
  if (!ordersPaused) return null;

  return (
    <div className="gg-paused-banner" role="status" aria-live="polite">
      <div className="gg-paused-banner__inner">
        <span className="gg-paused-banner__badge">Orders paused</span>
        <p className="gg-paused-banner__message">
          {message}
          {pausedUntil && (
            <strong className="gg-paused-banner__until">
              {" "}Checkout reopens {formatReopenDate(pausedUntil)}.
            </strong>
          )}
        </p>
      </div>
    </div>
  );
}
