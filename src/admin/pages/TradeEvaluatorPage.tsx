import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { formatCents } from "../utils/format";
import {
  DEFAULT_TRADE_CREDIT_PERCENT,
  MAX_TRADE_CREDIT_PERCENT,
  TRADE_CREDIT_PRESETS,
  evaluateTrade,
  lineErrors,
  parseCreditPercent,
  sideTotal,
  tradeCreditCents,
  type TradeEvaluation,
  type TradeLineInput,
  type TradeSideTotal,
} from "../utils/tradeEvaluator";

// Trade evaluator: a customer trades cards in for cards from the shop. Staff
// type each card's TCG low on both sides and pick the trade credit
// percentage; the page shows what the customer pays, or the trade credit
// they have left. It only does the math: nothing is saved to inventory or
// store credit (see utils/tradeEvaluator.ts for the rules).
//
// The trade in progress is kept on this device, so switching to Inventory to
// check a card, or the phone reloading the app, doesn't lose it.

type Side = "theirs" | "yours";
type Field = keyof TradeLineInput;

interface Line extends TradeLineInput {
  id: string;
}

interface Draft {
  creditPercent: string;
  theirs: Line[];
  yours: Line[];
}

const STORAGE_KEY = "gg-trade-evaluator";
const MAX_LINES = 200;

const SIDE_LABEL: Record<Side, string> = { theirs: "their cards", yours: "your cards" };

let lineCount = 0;
function newLine(): Line {
  lineCount += 1;
  return { id: `line-${lineCount}`, name: "", quantity: "1", price: "" };
}

function emptyDraft(creditPercent = String(DEFAULT_TRADE_CREDIT_PERCENT)): Draft {
  return { creditPercent, theirs: [newLine()], yours: [newLine()] };
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function restoreLines(value: unknown): Line[] {
  const lines = (Array.isArray(value) ? value : []).slice(0, MAX_LINES).flatMap((saved: unknown) => {
    if (!saved || typeof saved !== "object") return [];
    const fields = saved as Record<string, unknown>;
    return [{ ...newLine(), name: text(fields.name), quantity: text(fields.quantity, "1"), price: text(fields.price) }];
  });
  return lines.length > 0 ? lines : [newLine()];
}

/** The trade left on this device, if storage allows it. */
function loadDraft(): Draft {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Record<string, unknown>;
      return {
        creditPercent: text(saved.creditPercent, String(DEFAULT_TRADE_CREDIT_PERCENT)),
        theirs: restoreLines(saved.theirs),
        yours: restoreLines(saved.yours),
      };
    }
  } catch {
    // Storage blocked or unreadable: start a new trade.
  }
  return emptyDraft();
}

function saveDraft(draft: Draft) {
  const strip = (lines: Line[]) => lines.map(({ name, quantity, price }) => ({ name, quantity, price }));
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ creditPercent: draft.creditPercent, theirs: strip(draft.theirs), yours: strip(draft.yours) }),
    );
  } catch {
    // Not kept, but the trade still works for this visit.
  }
}

function isBlank(line: Line): boolean {
  return line.name.trim() === "" && line.price.trim() === "" && (line.quantity.trim() === "" || line.quantity.trim() === "1");
}

function cardCount(cards: number): string {
  return cards === 1 ? "1 card" : `${cards} cards`;
}

export function TradeEvaluatorPage() {
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [confirmClear, setConfirmClear] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // An input to focus once the next render has put it on the page.
  const pendingFocus = useRef<string | null>(null);
  const creditId = useId();

  useEffect(() => saveDraft(draft), [draft]);

  useEffect(() => {
    if (!pendingFocus.current) return;
    const target = rootRef.current?.querySelector<HTMLInputElement>(`[data-trade-field="${pendingFocus.current}"]`);
    pendingFocus.current = null;
    target?.focus();
  });

  const percent = parseCreditPercent(draft.creditPercent);
  const totals = useMemo(() => ({ theirs: sideTotal(draft.theirs), yours: sideTotal(draft.yours) }), [draft.theirs, draft.yours]);
  const evaluation = percent === null ? null : evaluateTrade(draft.theirs, draft.yours, percent);
  const hasEntries = !draft.theirs.every(isBlank) || !draft.yours.every(isBlank);

  function focusLater(side: Side, id: string, field: Field) {
    pendingFocus.current = `${side}:${id}:${field}`;
  }

  function updateLine(side: Side, id: string, field: Field, value: string) {
    setDraft((prev) => ({ ...prev, [side]: prev[side].map((l) => (l.id === id ? { ...l, [field]: value } : l)) }));
  }

  function addLine(side: Side, focusField: Field = "name") {
    if (draft[side].length >= MAX_LINES) return;
    const line = newLine();
    focusLater(side, line.id, focusField);
    setDraft((prev) => ({ ...prev, [side]: [...prev[side], line] }));
  }

  function removeLine(side: Side, id: string) {
    const lines = draft[side];
    const index = lines.findIndex((l) => l.id === id);
    if (lines.length === 1) {
      // The last line empties instead, so there's always somewhere to type.
      const fresh = newLine();
      focusLater(side, fresh.id, "name");
      setDraft((prev) => ({ ...prev, [side]: [fresh] }));
      return;
    }
    const neighbor = lines[index + 1] ?? lines[index - 1];
    if (neighbor) focusLater(side, neighbor.id, "name");
    setDraft((prev) => ({ ...prev, [side]: prev[side].filter((l) => l.id !== id) }));
  }

  // Enter moves down a column, spreadsheet style; on the last line it adds one.
  function onFieldKeyDown(event: KeyboardEvent<HTMLInputElement>, side: Side, index: number, field: Field) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const next = draft[side][index + 1];
    if (next) {
      rootRef.current?.querySelector<HTMLInputElement>(`[data-trade-field="${side}:${next.id}:${field}"]`)?.focus();
    } else {
      addLine(side, field);
    }
  }

  function clearTrade() {
    setDraft((prev) => emptyDraft(prev.creditPercent));
    setConfirmClear(false);
  }

  const listProps = { onChange: updateLine, onAdd: addLine, onRemove: removeLine, onKeyDown: onFieldKeyDown };

  return (
    <div className="gg-page" ref={rootRef}>
      <PageHeader
        title="Trade Evaluator"
        description="A customer's trade at TCG low: what they pay, or the credit they have left. Nothing changes in inventory."
        actions={
          <Button variant="ghost" icon="trash" disabled={!hasEntries} onClick={() => setConfirmClear(true)}>
            Clear trade
          </Button>
        }
      />

      <div className="gg-trade-wrap">
        <div className="gg-trade">
          <TradeList
            side="theirs"
            title="They're trading in"
            lines={draft.theirs}
            total={totals.theirs}
            footer={
              percent !== null && (
                <div className="gg-trade__sum gg-trade__sum--credit">
                  <span>Trade credit at {percent}%</span>
                  <span>{formatCents(tradeCreditCents(totals.theirs.tcgLowCents, percent))}</span>
                </div>
              )
            }
            {...listProps}
          />
          <TradeList side="yours" title="They want from you" lines={draft.yours} total={totals.yours} {...listProps} />

          <section className="gg-card gg-trade__summary" aria-labelledby={`${creditId}-title`}>
            <h2 className="gg-trade__heading" id={`${creditId}-title`}>
              The trade
            </h2>

            <div className="gg-trade__credit">
              <div className="gg-trade__credit-head">
                <label className="gg-field__label" htmlFor={creditId}>
                  Trade credit
                </label>
                <div className="gg-trade__percent">
                  <input
                    id={creditId}
                    className="gg-input"
                    inputMode="numeric"
                    autoComplete="off"
                    value={draft.creditPercent}
                    aria-invalid={percent === null || undefined}
                    aria-describedby={`${creditId}-hint`}
                    onChange={(e) => setDraft((prev) => ({ ...prev, creditPercent: e.target.value }))}
                  />
                  <span aria-hidden="true">%</span>
                </div>
              </div>
              <div className="gg-trade__presets" role="group" aria-label="Common trade credit percentages">
                {TRADE_CREDIT_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className="gg-trade__preset"
                    aria-pressed={percent === preset}
                    onClick={() => setDraft((prev) => ({ ...prev, creditPercent: String(preset) }))}
                  >
                    {preset}%
                  </button>
                ))}
              </div>
              {percent === null ? (
                <p className="gg-field__error" id={`${creditId}-hint`} role="alert">
                  Enter a whole number from 1 to {MAX_TRADE_CREDIT_PERCENT}.
                </p>
              ) : (
                <p className="gg-field__hint" id={`${creditId}-hint`}>
                  Their cards count at {percent}% of TCG low. Kept for your next trade.
                </p>
              )}
            </div>

            {evaluation && (
              <>
                <dl className="gg-trade__totals">
                  <div>
                    <dt>Their cards at TCG low</dt>
                    <dd>{formatCents(evaluation.theirs.tcgLowCents)}</dd>
                  </div>
                  <div>
                    <dt>Trade credit at {percent}%</dt>
                    <dd>{formatCents(evaluation.creditCents)}</dd>
                  </div>
                  <div>
                    <dt>Your cards at TCG low</dt>
                    <dd>{formatCents(evaluation.yours.tcgLowCents)}</dd>
                  </div>
                </dl>
                <TradeResult evaluation={evaluation} />
              </>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Clear this trade?"
        message={`Both lists are emptied.${percent !== null ? ` The trade credit stays at ${percent}%.` : ""}`}
        confirmLabel="Clear trade"
        tone="danger"
        onCancel={() => setConfirmClear(false)}
        onConfirm={clearTrade}
      />
    </div>
  );
}

function TradeList({
  side,
  title,
  lines,
  total,
  footer,
  onChange,
  onAdd,
  onRemove,
  onKeyDown,
}: {
  side: Side;
  title: string;
  lines: Line[];
  total: TradeSideTotal;
  footer?: ReactNode;
  onChange: (side: Side, id: string, field: Field, value: string) => void;
  onAdd: (side: Side) => void;
  onRemove: (side: Side, id: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>, side: Side, index: number, field: Field) => void;
}) {
  const headingId = useId();
  const of = SIDE_LABEL[side];
  return (
    <section className={`gg-card gg-trade__list gg-trade__list--${side}`} aria-labelledby={headingId}>
      <header className="gg-trade__list-head">
        <h2 className="gg-trade__heading" id={headingId}>
          {title}
        </h2>
        <span className="gg-trade__count">{cardCount(total.cards)}</span>
      </header>

      <div className="gg-trade__cols" aria-hidden="true">
        <span>Card</span>
        <span>Qty</span>
        <span>TCG low</span>
        <span />
      </div>
      <ol className="gg-trade__rows">
        {lines.map((line, index) => {
          const n = index + 1;
          const errors = lineErrors(line);
          const field = (name: Field) => ({
            "data-trade-field": `${side}:${line.id}:${name}`,
            onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => onKeyDown(e, side, index, name),
            onChange: (e: ChangeEvent<HTMLInputElement>) => onChange(side, line.id, name, e.target.value),
            autoComplete: "off",
          });
          return (
            <li key={line.id} className="gg-trade__row">
              <input
                className="gg-input"
                type="text"
                placeholder="Name (optional)"
                aria-label={`Card, line ${n} of ${of}`}
                value={line.name}
                {...field("name")}
              />
              <input
                className="gg-input gg-trade__qty"
                type="text"
                inputMode="numeric"
                aria-label={`Quantity, line ${n} of ${of}`}
                aria-invalid={errors.quantity || undefined}
                value={line.quantity}
                {...field("quantity")}
              />
              <div className="gg-trade__money">
                <span aria-hidden="true">$</span>
                <input
                  className="gg-input"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  aria-label={`TCG low price, line ${n} of ${of}`}
                  aria-invalid={errors.price || undefined}
                  value={line.price}
                  {...field("price")}
                />
              </div>
              <button
                type="button"
                className="gg-icon-btn gg-trade__remove"
                aria-label={`Remove line ${n} of ${of}`}
                onClick={() => onRemove(side, line.id)}
              >
                <Icon name="close" size={16} />
              </button>
            </li>
          );
        })}
      </ol>

      <Button variant="secondary" size="sm" icon="plus" className="gg-trade__add" onClick={() => onAdd(side)} disabled={lines.length >= MAX_LINES}>
        Add card
      </Button>

      <div className="gg-trade__foot">
        {total.invalidLines > 0 && (
          <p className="gg-trade__invalid" role="alert">
            {total.invalidLines === 1 ? "1 line isn't counted" : `${total.invalidLines} lines aren't counted`}: fix the
            price or quantity outlined in red.
          </p>
        )}
        <div className="gg-trade__sum">
          <span>TCG low total</span>
          <span>{formatCents(total.tcgLowCents)}</span>
        </div>
        {footer}
      </div>
    </section>
  );
}

function TradeResult({ evaluation }: { evaluation: TradeEvaluation }) {
  const { outcome, balanceCents, makeEvenCents } = evaluation;
  return (
    <div className={`gg-trade__result gg-trade__result--${outcome}`} role="status">
      {outcome === "empty" && <p className="gg-trade__result-note">Type TCG low prices to see the trade.</p>}
      {outcome === "they_pay" && (
        <>
          <p className="gg-trade__result-label">They pay you</p>
          <p className="gg-trade__result-amount">{formatCents(-balanceCents)}</p>
          <p className="gg-trade__result-note">Or they trade in {formatCents(makeEvenCents)} more at TCG low to cover it.</p>
        </>
      )}
      {outcome === "credit_left" && (
        <>
          <p className="gg-trade__result-label">You owe them in trade credit</p>
          <p className="gg-trade__result-amount">{formatCents(balanceCents)}</p>
          <p className="gg-trade__result-note">Or they take {formatCents(makeEvenCents)} more of your cards at TCG low.</p>
        </>
      )}
      {outcome === "even" && (
        <>
          <p className="gg-trade__result-label">Even trade</p>
          <p className="gg-trade__result-amount">{formatCents(0)}</p>
          <p className="gg-trade__result-note">Their trade credit covers your cards exactly.</p>
        </>
      )}
    </div>
  );
}
