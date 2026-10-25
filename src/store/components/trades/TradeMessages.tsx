import { useState, type FormEvent } from "react";
import { TRADE_LIMITS, type TradeMessage, type TradeTimelineEntry } from "../../lib/tradeCenter";

// Messages between the customer and us on a trade, and the trade's history
// (only the steps a customer sees; staff notes never reach this page).

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function TradeMessages({
  messages,
  busy,
  onSend,
}: {
  messages: TradeMessage[];
  busy: boolean;
  onSend: (body: string) => Promise<boolean>;
}) {
  const [body, setBody] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    if (await onSend(text)) setBody("");
  }

  return (
    <section className="gg-tc-panel" aria-labelledby="gg-tc-messages-title">
      <h2 id="gg-tc-messages-title">Messages</h2>
      {messages.length === 0 ? (
        <p className="gg-tc-line__meta">Questions about this trade? Ask here and we&rsquo;ll reply by email too.</p>
      ) : (
        <ol className="gg-tc-messages">
          {messages.map((m) => (
            <li key={m.id} className={m.authorType === "customer" ? "gg-tc-message gg-tc-message--mine" : "gg-tc-message"}>
              <span className="gg-tc-message__who">
                {m.authorType === "customer" ? "You" : "Geega Games"} · {when(m.createdAt)}
              </span>
              <p>{m.body}</p>
            </li>
          ))}
        </ol>
      )}
      <form className="gg-tc-compose" onSubmit={(e) => void submit(e)}>
        <label className="gg-field">
          <span className="visually-hidden">Your message</span>
          <textarea
            rows={2}
            maxLength={TRADE_LIMITS.maxMessage}
            placeholder="Write a message…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <button type="submit" className="gg-btn gg-btn-ghost" disabled={busy || !body.trim()}>
          {busy ? "Sending…" : "Send"}
        </button>
      </form>
    </section>
  );
}

export function TradeTimeline({ entries }: { entries: TradeTimelineEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="gg-tc-panel" aria-labelledby="gg-tc-history-title">
      <h2 id="gg-tc-history-title">History</h2>
      <ol className="gg-tc-history">
        {[...entries].reverse().map((e, i) => (
          <li key={`${e.createdAt}-${i}`}>
            <span>{e.label}</span>
            <time dateTime={e.createdAt}>{when(e.createdAt)}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}
