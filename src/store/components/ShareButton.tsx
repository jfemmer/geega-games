import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

// "Share" on a card's page: the phone's share sheet where there is one
// (Facebook, Messages, …), otherwise the link is copied. The link is the
// card's own page, so whoever opens it lands on exactly that card.

export default function ShareButton({ title, url }: { title: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        // Closing the share sheet isn't an error; anything else falls back to copying.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  return (
    <span className="gg-share-wrap">
      <button type="button" className="gg-share-btn" onClick={() => void share()} aria-label={`Share ${title}`} title="Share">
        <Icon name="share" size={18} />
      </button>
      <span className={copied ? "gg-share-copied gg-share-copied--on" : "gg-share-copied"} role="status" aria-live="polite">
        {copied ? "Link copied" : ""}
      </span>
    </span>
  );
}
