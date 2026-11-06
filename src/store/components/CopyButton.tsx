import { useEffect, useRef, useState } from "react";

// A small "Copy" button for a value customers paste elsewhere (a tracking
// number, a mailing address, a trade ID). If the clipboard isn't available
// (an old browser, a blocked permission), nothing breaks: the value is still
// on the page as selectable text. `label` names what's copied for screen
// readers ("Copy the address"); the visible text stays short.

export function CopyButton({ value, label, text = "Copy" }: { value: string; label?: string; text?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      className="gg-btn gg-btn-ghost gg-btn-sm"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable: the value is still selectable text */
        }
      }}
    >
      <span aria-live="polite">{copied ? "Copied ✓" : text}</span>
    </button>
  );
}
