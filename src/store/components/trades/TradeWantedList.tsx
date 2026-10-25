import { Link } from "../../lib/router";
import { formatCents } from "../../lib/money";
import { CONDITION_LABELS } from "../../lib/conditionLabels";
import { FINISH_NAMES, TRADE_LIMITS } from "../../lib/tradeCenter";

// Our cards on a trade (or in the trade cart): each line with its trade
// price, a note when it matters (only 1 left, sold, no longer on the trade),
// and, while the customer can still change them, a quantity and a way to
// take it off.

export interface TradeWantedRow {
  key: string;
  cardName: string;
  setCode: string | null;
  setName: string | null;
  collectorNumber: string | null;
  condition: string;
  finish: string;
  imageUrl: string | null;
  quantity: number;
  unitPriceCents: number;
  /** For the quantity picker. */
  maxQuantity?: number;
  /** No longer on this trade (released or taken off): shown faded. */
  released?: boolean;
  /** A word about this line: "Only 1 left", "Sold since you added it". */
  note?: string | null;
  noteTone?: "warn" | "muted";
  cardPath?: string | null;
}

export function TradeWantedList({
  rows,
  onQuantity,
  onRemove,
  busy = false,
  emptyText = "No cards yet.",
}: {
  rows: TradeWantedRow[];
  onQuantity?: (key: string, quantity: number) => void;
  onRemove?: (key: string) => void;
  busy?: boolean;
  emptyText?: string;
}) {
  if (rows.length === 0) return <p className="gg-tc-empty">{emptyText}</p>;
  return (
    <ul className="gg-tc-lines">
      {rows.map((row) => {
        const where = [row.setName ?? row.setCode?.toUpperCase(), row.collectorNumber ? `#${row.collectorNumber}` : null]
          .filter(Boolean)
          .join(" · ");
        const max = Math.min(row.maxQuantity ?? TRADE_LIMITS.maxQuantity, TRADE_LIMITS.maxQuantity);
        return (
          <li key={row.key} className={row.released ? "gg-tc-line gg-tc-line--released" : "gg-tc-line"}>
            {row.imageUrl ? (
              <img className="gg-tc-line__img" src={row.imageUrl} alt="" loading="lazy" />
            ) : (
              <span className="gg-tc-line__img gg-tc-line__img--blank" aria-hidden="true" />
            )}
            <span className="gg-tc-line__main">
              <span className="gg-tc-line__name">
                {row.cardPath ? <Link to={row.cardPath}>{row.cardName}</Link> : row.cardName}
              </span>
              <span className="gg-tc-line__meta">
                {where}
                {where ? " · " : ""}
                {CONDITION_LABELS[row.condition] ?? row.condition}
                {row.finish !== "nonfoil" ? ` · ${FINISH_NAMES[row.finish] ?? row.finish}` : ""}
              </span>
              {(row.note || row.released) && (
                <span className={row.noteTone === "warn" ? "gg-tc-line__note gg-tc-line__note--warn" : "gg-tc-line__note"}>
                  {row.note ?? "No longer on this trade"}
                </span>
              )}
            </span>
            <span className="gg-tc-line__qty">
              {onQuantity && !row.released ? (
                <select
                  aria-label={`How many ${row.cardName}`}
                  value={row.quantity}
                  disabled={busy}
                  onChange={(e) => onQuantity(row.key, Number(e.target.value))}
                >
                  {Array.from({ length: Math.max(max, row.quantity) }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              ) : (
                <span>× {row.quantity}</span>
              )}
            </span>
            <span className="gg-tc-line__price">
              <strong>{formatCents(row.unitPriceCents * row.quantity)}</strong>
              {row.quantity > 1 && <span className="gg-tc-line__each">{formatCents(row.unitPriceCents)} each</span>}
            </span>
            {onRemove && !row.released && (
              <button
                type="button"
                className="gg-tc-line__remove"
                disabled={busy}
                onClick={() => onRemove(row.key)}
                aria-label={`Remove ${row.cardName}`}
              >
                Remove
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
