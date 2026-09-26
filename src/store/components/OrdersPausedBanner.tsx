import { formatReopenDate, useStoreStatus } from "../lib/storeStatus";

// Site-wide notice while vacation mode is on (Admin → Vacation Mode).
// Collapsed to one short line so it doesn't push the page down on every
// visit; "Details" expands the owner's full message. Uses <details> so it
// works with a keyboard and screen readers without extra state. The cart and
// checkout still show the full message (gg-paused-note) where it matters.

function shortReopenDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function OrdersPausedBanner() {
  const { ordersPaused, message, pausedUntil } = useStoreStatus();
  if (!ordersPaused) return null;

  return (
    <div className="gg-paused-banner" role="status" aria-live="polite">
      <details className="gg-paused-banner__details">
        <summary className="gg-paused-banner__summary">
          <span className="gg-paused-banner__badge">Orders paused</span>
          <span className="gg-paused-banner__short">
            {pausedUntil ? `Reopens ${shortReopenDate(pausedUntil)}` : "Browsing is still open"}
          </span>
          <span className="gg-paused-banner__toggle" aria-hidden="true">
            <span className="gg-paused-banner__more">Details</span>
            <span className="gg-paused-banner__less">Hide</span>
          </span>
        </summary>
        <p className="gg-paused-banner__message">
          {message}
          {pausedUntil && (
            <strong className="gg-paused-banner__until">
              {" "}Checkout reopens {formatReopenDate(pausedUntil)}.
            </strong>
          )}
        </p>
      </details>
    </div>
  );
}
