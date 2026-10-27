import { useRef, useState } from "react";
import { parseCardListText } from "../../lib/sellCardListParser";
import { searchSellPrintings } from "../../lib/sellApi";
import type { SellPrinting } from "../../lib/sellTypes";
import { formatCents } from "../../lib/money";
import {
  CONDITION_NAMES,
  FINISH_NAMES,
  TRADE_LIMITS,
  conditionPercent,
  estimatedUnitCents,
  isTradeFinish,
  type CustomerTrade,
  type TradeFinish,
  type TradeOfferInput,
  type TradeTerms,
} from "../../lib/tradeCenter";
import { conditionForAge } from "../../lib/tradeConditions";
import { finishesOf, printingPrice } from "./offerHelpers";

// Paste a card list or upload a CSV for a trade. The text is read in the
// browser (the same forgiving reader as Sell Your Cards: a TCGplayer
// collection export, our own CSV, or one card per line), each line is
// matched to its exact printing with the public card search, and the
// customer checks everything on a review screen (which printing, finish,
// how many) before anything is added. A condition in the list is ignored:
// each card's condition comes from its printing's age (tradeConditions).
// Only what they confirm is sent, as printings and quantities; the server
// prices it.

/** Files larger than this aren't read. */
export const MAX_IMPORT_BYTES = 256 * 1024;
const RESOLVE_DELAY_MS = 150;
const MAX_CANDIDATES = 12;

type MatchStatus = "matched" | "choose" | "missing";

export interface ImportRow {
  key: string;
  raw: string;
  name: string;
  quantity: number;
  /** The finish the line asked for. */
  wantFinish: string | null;
  candidates: SellPrinting[];
  printingId: string | null;
  finish: TradeFinish;
  status: MatchStatus;
  include: boolean;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Matches one parsed line to its printing(s): the set and collector number narrow it when given. */
async function resolveLine(
  name: string,
  setCode: string | null,
  collectorNumber: string | null,
): Promise<SellPrinting[]> {
  const quoted = `!"${name.replace(/"/g, "")}"`;
  let result = await searchSellPrintings(setCode ? `${quoted} set:${setCode.toLowerCase()}` : quoted);
  if (result.printings.length === 0 && setCode) {
    await sleep(RESOLVE_DELAY_MS);
    result = await searchSellPrintings(quoted);
  }
  let printings = result.printings;
  if (collectorNumber) {
    const exact = printings.filter((p) => p.collectorNumber.toLowerCase() === collectorNumber.toLowerCase());
    if (exact.length > 0) printings = exact;
  }
  return printings.slice(0, MAX_CANDIDATES);
}

function pickFinish(printing: SellPrinting | undefined, wanted: string | null): TradeFinish {
  if (!printing) return "nonfoil";
  const finishes = finishesOf(printing);
  return wanted && isTradeFinish(wanted) && finishes.includes(wanted) ? wanted : finishes[0];
}

export function OfferImport({
  trade,
  terms,
  saving,
  room,
  onAdd,
  onCancel,
}: {
  trade: CustomerTrade;
  terms: TradeTerms | null;
  saving: boolean;
  /** How many more lines the trade can take. */
  room: number;
  onAdd: (inputs: TradeOfferInput[]) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const limit = Math.min(TRADE_LIMITS.maxImportLines, room);

  async function read(raw: string) {
    setError(null);
    setNote(null);
    const parsed = parseCardListText(raw).filter((line) => line.cardName.trim().length > 0);
    if (parsed.length === 0) {
      setError("We couldn't find any cards in that. Put one card per line, like “2 Lightning Bolt [2XM] foil”.");
      return;
    }
    if (limit <= 0) {
      setError(`This trade already lists the most cards it can (${terms?.maxOfferedLines ?? 100}).`);
      return;
    }
    const lines = parsed.slice(0, limit);
    if (parsed.length > lines.length) {
      setNote(`We read the first ${lines.length} cards. Add the rest in another trade, or after taking some off.`);
    }
    setProgress({ done: 0, total: lines.length });
    const out: ImportRow[] = [];
    for (const [i, line] of lines.entries()) {
      let candidates: SellPrinting[] = [];
      try {
        candidates = await resolveLine(line.cardName, line.setCode, line.collectorNumber);
      } catch {
        candidates = [];
      }
      const status: MatchStatus = candidates.length === 1 ? "matched" : candidates.length > 1 ? "choose" : "missing";
      out.push({
        key: `${i}-${line.rawInput}`,
        raw: line.rawInput,
        name: line.cardName,
        quantity: Math.min(Math.max(line.quantity, 1), TRADE_LIMITS.maxQuantity),
        wantFinish: line.finish,
        candidates,
        printingId: status === "matched" ? candidates[0].scryfallId : null,
        finish: pickFinish(candidates[0], line.finish),
        status,
        include: status !== "missing",
      });
      setProgress({ done: i + 1, total: lines.length });
      if (i < lines.length - 1) await sleep(RESOLVE_DELAY_MS);
    }
    setProgress(null);
    setRows(out);
  }

  async function readFile(file: File) {
    if (!/\.(csv|txt)$/i.test(file.name) || file.size > MAX_IMPORT_BYTES) {
      setError(`Upload a .csv or .txt file under ${Math.round(MAX_IMPORT_BYTES / 1024)} KB.`);
      return;
    }
    try {
      await read(await file.text());
    } catch {
      setError("We couldn't read that file. Try pasting the list instead.");
    }
  }

  function update(key: string, patch: Partial<ImportRow>) {
    setRows((current) => (current ?? []).map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  const chosen = (rows ?? []).filter((r) => r.include);
  const unresolved = chosen.filter((r) => !r.printingId);

  async function add() {
    if (unresolved.length > 0) {
      setError("Choose the printing for each card you've ticked, or untick it.");
      return;
    }
    const inputs: TradeOfferInput[] = chosen.map((r) => ({
      scryfallId: r.printingId as string,
      finish: r.finish,
      quantity: r.quantity,
    }));
    setError(null);
    await onAdd(inputs);
  }

  if (rows) {
    return (
      <div className="gg-tc-import">
        <h3 className="gg-tc-import__title">Check your list</h3>
        <p className="gg-tc-line__meta">
          We matched each line to a printing. Check the printing, finish and quantity, untick anything you don&rsquo;t want
          to add, then add them to your cards. Each card&rsquo;s condition comes from its age.
        </p>
        {note && <p className="gg-alert gg-alert-warn">{note}</p>}
        <ul className="gg-tc-import__rows">
          {rows.map((row) => {
            const printing = row.candidates.find((p) => p.scryfallId === row.printingId);
            const reference = printing ? printingPrice(printing, row.finish) : null;
            const condition = printing ? conditionForAge(printing.releasedAt) : null;
            const estimate = condition ? estimatedUnitCents(reference, conditionPercent(trade.conditionPercents, condition)) : null;
            return (
              <li key={row.key} className={row.status === "missing" ? "gg-tc-import__row gg-tc-import__row--missing" : "gg-tc-import__row"}>
                <label className="gg-tc-import__include">
                  <input
                    type="checkbox"
                    checked={row.include}
                    disabled={row.status === "missing"}
                    onChange={(e) => update(row.key, { include: e.target.checked })}
                  />
                  <span className="visually-hidden">Add {row.name}</span>
                </label>
                <span className="gg-tc-import__card">
                  <span className="gg-tc-line__name">{printing?.cardName ?? row.name}</span>
                  <span className="gg-tc-line__meta">{row.raw}</span>
                  {row.status === "missing" ? (
                    <span className="gg-tc-flag gg-tc-flag--bad">We couldn&rsquo;t find this card. Search for it instead.</span>
                  ) : (
                    <span className="gg-tc-import__printing">
                      <select
                        aria-label={`Printing of ${row.name}`}
                        value={row.printingId ?? ""}
                        onChange={(e) => {
                          const next = row.candidates.find((p) => p.scryfallId === e.target.value);
                          update(row.key, { printingId: next?.scryfallId ?? null, finish: pickFinish(next, row.wantFinish) });
                        }}
                      >
                        {row.status === "choose" && <option value="">Choose the printing…</option>}
                        {row.candidates.map((p) => (
                          <option key={p.scryfallId} value={p.scryfallId}>
                            {p.setName} ({p.setCode}) #{p.collectorNumber}
                          </option>
                        ))}
                      </select>
                    </span>
                  )}
                </span>
                {row.status !== "missing" && (
                  <span className="gg-tc-import__opts">
                    <select
                      aria-label={`Finish of ${row.name}`}
                      value={row.finish}
                      onChange={(e) => update(row.key, { finish: e.target.value as TradeFinish })}
                      disabled={!printing}
                    >
                      {(printing ? finishesOf(printing) : (["nonfoil"] as TradeFinish[])).map((f) => (
                        <option key={f} value={f}>
                          {FINISH_NAMES[f]}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`How many ${row.name}`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={TRADE_LIMITS.maxQuantity}
                      value={row.quantity}
                      onChange={(e) =>
                        update(row.key, { quantity: Math.max(1, Math.min(TRADE_LIMITS.maxQuantity, Math.floor(Number(e.target.value) || 1))) })
                      }
                    />
                    <span className="gg-tc-import__est">
                      {condition && <span className="gg-tc-import__cond">{CONDITION_NAMES[condition]}</span>}
                      {estimate !== null ? `~${formatCents(estimate)} ea` : printing ? "At review" : ""}
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {error && (
          <div className="gg-alert gg-alert-error" role="alert">
            {error}
          </div>
        )}
        <div className="gg-tc-pick__actions">
          <button type="button" className="gg-btn" disabled={saving || chosen.length === 0} onClick={() => void add()}>
            {saving ? "Adding…" : `Add ${chosen.length} card${chosen.length === 1 ? "" : "s"}`}
          </button>
          <button type="button" className="gg-btn gg-btn-ghost" disabled={saving} onClick={() => setRows(null)}>
            Start over
          </button>
          <button type="button" className="gg-linkbtn" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gg-tc-import">
      <label className="gg-field">
        <span>Paste your list</span>
        <textarea
          rows={6}
          value={text}
          placeholder={"2 Sheoldred, the Apocalypse [DMU]\n1 Ragavan, Nimble Pilferer (MH2) 138 foil\n4 Lightning Bolt"}
          onChange={(e) => setText(e.target.value)}
          disabled={progress !== null}
        />
      </label>
      <details className="gg-tc-import__help">
        <summary>What can I paste or upload?</summary>
        <p>
          One card per line: how many, the name, then anything else you know, like the set code in brackets, the
          collector number and &ldquo;foil&rdquo; or &ldquo;etched&rdquo;. You don&rsquo;t need a condition: we set each
          card&rsquo;s condition from its age.
        </p>
        <p>
          Or a CSV file (up to {Math.round(MAX_IMPORT_BYTES / 1024)} KB and {TRADE_LIMITS.maxImportLines} cards) with a
          header row. We read these columns: <strong>Quantity</strong>, <strong>Name</strong> (or Card),{" "}
          <strong>Set Code</strong> (or Set), <strong>Card Number</strong> (or Collector Number) and{" "}
          <strong>Printing</strong> (or Finish). A collection export from the TCGplayer app works as it is.
        </p>
      </details>
      {error && (
        <div className="gg-alert gg-alert-error" role="alert">
          {error}
        </div>
      )}
      {progress && (
        <p className="gg-tc-line__meta" role="status" aria-live="polite">
          Matching your cards… {progress.done} of {progress.total}
        </p>
      )}
      <div className="gg-tc-pick__actions">
        <button type="button" className="gg-btn" disabled={!text.trim() || progress !== null} onClick={() => void read(text)}>
          Read my list
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void readFile(file);
            e.target.value = "";
          }}
        />
        <button type="button" className="gg-btn gg-btn-ghost" disabled={progress !== null} onClick={() => fileRef.current?.click()}>
          Upload a CSV
        </button>
        <button type="button" className="gg-linkbtn" disabled={progress !== null} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="gg-tc-line__meta">We set each card&rsquo;s condition from its age, so you don&rsquo;t need to list one.</p>
    </div>
  );
}
