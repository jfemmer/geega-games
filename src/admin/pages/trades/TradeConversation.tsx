import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { TextArea } from "../../components/ui/Field";
import { formatDateTime } from "../../utils/format";
import { tradeCenterRepository } from "../../repositories/tradeCenter.supabase";
import { TRADE_LIMITS, TRADE_STATUS_ADMIN_LABELS, isTradeStatus } from "../../../store/lib/tradeCenter";
import { actorLabel, eventDetail, eventLabel } from "./tradeLabels";
import type { TradePanelProps } from "./types";

// Messages with the customer (emailed to them) and staff-only notes, in one
// thread, and the trade's full history, newest first.

export function TradeMessagesPanel({ trade, busy, run }: Pick<TradePanelProps, "trade" | "busy" | "run">) {
  const [body, setBody] = useState("");
  const text = body.trim();

  async function send(visibleToCustomer: boolean) {
    if (!text) return;
    const ok = await run(
      visibleToCustomer ? "message" : "note",
      () => tradeCenterRepository.message(trade.id, text, visibleToCustomer),
      visibleToCustomer ? "Message sent." : "Note saved.",
    );
    if (ok) setBody("");
  }

  return (
    <section className="gg-trd__section" aria-labelledby="gg-trd-messages-title">
      <h3 id="gg-trd-messages-title">Messages</h3>
      {trade.messages.length === 0 ? (
        <p className="gg-card-meta">No messages yet.</p>
      ) : (
        <ol className="gg-trd-thread">
          {trade.messages.map((m) => {
            const who = m.authorType === "customer" ? trade.customerName || "Customer" : m.authorType === "system" ? "Geega Games" : m.authorLabel || "Staff";
            return (
              <li
                key={m.id}
                className={`gg-trd-msg gg-trd-msg--${m.authorType}${m.visibleToCustomer ? "" : " gg-trd-msg--note"}`}
              >
                <p className="gg-trd-msg__meta">
                  <strong>{who}</strong> · {formatDateTime(m.createdAt)}
                  {!m.visibleToCustomer && <span className="gg-trd-msg__tag">Staff only</span>}
                </p>
                <p className="gg-trd-msg__body">{m.body}</p>
              </li>
            );
          })}
        </ol>
      )}
      <TextArea
        label="Write a message or a note"
        rows={3}
        maxLength={TRADE_LIMITS.maxMessage}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        hint="Messages are emailed to the customer and show on their trade page. Notes stay with staff."
      />
      <div className="gg-drawer-actions__buttons">
        <Button size="sm" variant="secondary" onClick={() => void send(false)} loading={busy === "note"} disabled={busy !== null || !text}>
          Save as a staff note
        </Button>
        <Button size="sm" variant="primary" icon="mail" onClick={() => void send(true)} loading={busy === "message"} disabled={busy !== null || !text}>
          Send to the customer
        </Button>
      </div>
    </section>
  );
}

export function TradeHistory({ trade }: Pick<TradePanelProps, "trade">) {
  const events = [...trade.events].reverse();
  return (
    <section className="gg-trd__section" aria-labelledby="gg-trd-history-title">
      <h3 id="gg-trd-history-title">History</h3>
      {events.length === 0 ? (
        <p className="gg-card-meta">Nothing yet.</p>
      ) : (
        <ol className="gg-trd-history">
          {events.map((e) => {
            const detail = eventDetail(e);
            const moved = e.fromStatus !== e.toStatus && e.toStatus && isTradeStatus(e.toStatus);
            return (
              <li key={e.id}>
                <span className="gg-trd-history__when">{formatDateTime(e.createdAt)}</span>
                <span className="gg-trd-history__what">
                  <strong>{eventLabel(e.event, e.toStatus)}</strong>
                  <span className="gg-card-meta">
                    {" "}
                    · {actorLabel(e)}
                    {moved && isTradeStatus(e.toStatus) && (
                      <>
                        {" · "}
                        <span className="gg-trd-history__to">
                          <span aria-hidden="true">→ </span>
                          <span className="gg-visually-hidden">now </span>
                          {TRADE_STATUS_ADMIN_LABELS[e.toStatus]}
                        </span>
                      </>
                    )}
                  </span>
                  {detail && <span className="gg-trd-history__detail">{detail}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
