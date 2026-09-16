import { useRef, useState } from "react";
import { Modal } from "../components/ui/Modal";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { inventoryRepository, scryfallRepository } from "../repositories";
import { useCurrentAdmin } from "../hooks/useCurrentAdmin";
import { useToast } from "../hooks/useToast";
import { priceForFinish } from "../components/cards/PrintingPreview";
import { FINISH_LABELS } from "../utils/labels";
import type { CardCondition, CardFinish } from "../types";

const VALID_CONDITIONS: CardCondition[] = ["NM", "LP", "MP", "HP", "DMG"];
const VALID_FINISHES: CardFinish[] = [
  "nonfoil",
  "foil",
  "etched",
  "glossy",
  "ripple",
];
const REQUIRED_COLUMNS = [
  "card",
  "set",
  "collector #",
  "condition",
  "finish",
  "quantity",
  "price",
] as const;

interface ParsedRow {
  lineNumber: number;
  cardName: string;
  setCode: string;
  collectorNumber: string;
  condition: string;
  finish: string;
  quantity: string;
  price: string;
}

interface RowResult {
  lineNumber: number;
  cardName: string;
  status: "added" | "restocked" | "error";
  detail: string;
}

/** Minimal RFC 4180-ish CSV parser: quoted fields, embedded commas, "" escapes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((v) => v.trim() !== "")) rows.push(row);
  }
  return rows;
}

function centsFromInput(dollars: string): number {
  const n = Number.parseFloat(dollars);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

/**
 * Real CSV import: parses the file client-side, resolves each row against the
 * live Scryfall printing index, dedupes against existing inventory the exact
 * same way the manual Add-card flow does (scryfall_id + condition + finish),
 * and either restocks the existing line (movement reason "import") or creates
 * a new one. One bad row never fails the batch — every row gets its own
 * added/restocked/error outcome, all shown after the run.
 */
export function ImportInventoryModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const toast = useToast();
  const currentAdmin = useCurrentAdmin();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<RowResult[] | null>(null);

  function reset() {
    setFileName(null);
    setRows([]);
    setParseError(null);
    setResults(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleFile(file: File) {
    reset();
    setFileName(file.name);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setParseError("Could not read that file.");
      return;
    }
    const table = parseCsv(text);
    if (table.length < 2) {
      setParseError("No data rows found in that file.");
      return;
    }
    const header = table[0].map((h) => h.trim().toLowerCase());
    const idx = {
      card: header.indexOf("card"),
      set: header.indexOf("set"),
      collector: header.indexOf("collector #"),
      condition: header.indexOf("condition"),
      finish: header.indexOf("finish"),
      quantity: header.indexOf("quantity"),
      price: header.indexOf("price"),
    };
    const missing = REQUIRED_COLUMNS.filter(
      (name) => !header.includes(name),
    );
    if (missing.length) {
      setParseError(
        `Missing required column(s): ${missing.join(", ")}. Expected: Card, Set, Collector #, Condition, Finish, Quantity, Price.`,
      );
      return;
    }
    const parsed: ParsedRow[] = table.slice(1).map((cols, i) => ({
      lineNumber: i + 2,
      cardName: (cols[idx.card] ?? "").trim(),
      setCode: (cols[idx.set] ?? "").trim(),
      collectorNumber: (cols[idx.collector] ?? "").trim(),
      condition: (cols[idx.condition] ?? "").trim().toUpperCase(),
      finish: (cols[idx.finish] ?? "").trim().toLowerCase(),
      quantity: (cols[idx.quantity] ?? "").trim(),
      price: (cols[idx.price] ?? "").trim(),
    }));
    setRows(parsed);
  }

  async function runImport() {
    setImporting(true);
    const out: RowResult[] = [];
    for (const row of rows) {
      const label = row.cardName || `${row.setCode} #${row.collectorNumber}`;
      try {
        if (!row.setCode || !row.collectorNumber) {
          out.push({
            lineNumber: row.lineNumber,
            cardName: label,
            status: "error",
            detail: "Missing set code or collector number.",
          });
          continue;
        }
        const condition = row.condition as CardCondition;
        if (!VALID_CONDITIONS.includes(condition)) {
          out.push({
            lineNumber: row.lineNumber,
            cardName: label,
            status: "error",
            detail: `Invalid condition "${row.condition}" — expected one of ${VALID_CONDITIONS.join(", ")}.`,
          });
          continue;
        }
        const finish = row.finish as CardFinish;
        if (!VALID_FINISHES.includes(finish)) {
          out.push({
            lineNumber: row.lineNumber,
            cardName: label,
            status: "error",
            detail: `Invalid finish "${row.finish}" — expected one of ${VALID_FINISHES.join(", ")}.`,
          });
          continue;
        }
        const qty = Number.parseInt(row.quantity, 10);
        if (!Number.isFinite(qty) || qty < 1) {
          out.push({
            lineNumber: row.lineNumber,
            cardName: label,
            status: "error",
            detail: `Invalid quantity "${row.quantity}".`,
          });
          continue;
        }
        const priceCents = centsFromInput(row.price);
        if (!Number.isFinite(priceCents) || priceCents <= 0) {
          out.push({
            lineNumber: row.lineNumber,
            cardName: label,
            status: "error",
            detail: `Invalid price "${row.price}".`,
          });
          continue;
        }
        const printing = await scryfallRepository.getBySetAndCollector(
          row.setCode,
          row.collectorNumber,
        );
        if (!printing) {
          out.push({
            lineNumber: row.lineNumber,
            cardName: label,
            status: "error",
            detail: `No printing found for set "${row.setCode}" collector #${row.collectorNumber}.`,
          });
          continue;
        }
        if (!printing.availableFinishes.includes(finish)) {
          out.push({
            lineNumber: row.lineNumber,
            cardName: printing.cardName,
            status: "error",
            detail: `"${FINISH_LABELS[finish]}" isn't available for this printing.`,
          });
          continue;
        }
        const dupe =
          (await inventoryRepository.findMatchByScryfall(
            printing.scryfallId,
            condition,
            finish,
          )) ??
          (await inventoryRepository.findMatch(
            printing.setCode,
            printing.collectorNumber,
            condition,
            finish,
          ));
        if (dupe) {
          await inventoryRepository.adjustQuantity(
            dupe.id,
            qty,
            "import",
            currentAdmin.name,
          );
          out.push({
            lineNumber: row.lineNumber,
            cardName: printing.cardName,
            status: "restocked",
            detail: `+${qty} added to existing ${condition} ${FINISH_LABELS[finish]} stock.`,
          });
        } else {
          await inventoryRepository.create(
            {
              scryfallId: printing.scryfallId,
              cardName: printing.cardName,
              setName: printing.setName,
              setCode: printing.setCode,
              collectorNumber: printing.collectorNumber,
              rarity: printing.rarity,
              cardType: printing.cardType,
              imageUrl: printing.imageUrl,
              condition,
              finish,
              quantity: qty,
              priceCents,
              costCents: null,
              storageLocation: null,
              sku: null,
              notes: null,
              status: "active",
              scryfallPriceCents: priceForFinish(printing, finish),
            },
            currentAdmin.name,
          );
          out.push({
            lineNumber: row.lineNumber,
            cardName: printing.cardName,
            status: "added",
            detail: `New line created, qty ${qty}.`,
          });
        }
      } catch (err) {
        out.push({
          lineNumber: row.lineNumber,
          cardName: label,
          status: "error",
          detail: err instanceof Error ? err.message : "Unexpected error.",
        });
      }
    }
    setResults(out);
    setImporting(false);
    const errorCount = out.filter((r) => r.status === "error").length;
    if (errorCount === 0) {
      toast.success(`Imported ${out.length} row(s).`);
    } else {
      toast.error(
        `Imported ${out.length - errorCount} of ${out.length} row(s) — ${errorCount} failed. See details below.`,
      );
    }
    onImported();
  }

  const addedCount = results?.filter((r) => r.status === "added").length ?? 0;
  const restockedCount =
    results?.filter((r) => r.status === "restocked").length ?? 0;
  const errorCount = results?.filter((r) => r.status === "error").length ?? 0;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Import inventory (CSV)"
      size="md"
      footer={
        <div className="gg-drawer-actions__buttons">
          <Button variant="ghost" onClick={handleClose}>
            {results ? "Close" : "Cancel"}
          </Button>
          {!results && (
            <Button
              variant="primary"
              onClick={runImport}
              loading={importing}
              disabled={rows.length === 0}
            >
              Import {rows.length > 0 ? `${rows.length} row(s)` : ""}
            </Button>
          )}
        </div>
      }
    >
      <div className="gg-import">
        {!results && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
            <div
              className="gg-import__drop"
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) handleFile(file);
              }}
            >
              <Icon name="upload" size={28} />
              <p>
                {fileName
                  ? `Selected: ${fileName}`
                  : "Drag a CSV here, or click to choose a file."}
              </p>
              <p className="gg-muted">
                Expected columns: Card, Set, Collector #, Condition, Finish,
                Quantity, Price.
              </p>
            </div>
            {parseError && <p className="gg-authcard__error">{parseError}</p>}
            {rows.length > 0 && !parseError && (
              <p className="gg-muted">
                {rows.length} row(s) ready to import. Each row is matched to
                an exact Scryfall printing by set + collector number; a row
                that already exists in inventory (same printing, condition,
                and finish) adds to its stock instead of creating a
                duplicate.
              </p>
            )}
          </>
        )}
        {results && (
          <div className="gg-import__results">
            <p>
              <strong>{addedCount}</strong> added ·{" "}
              <strong>{restockedCount}</strong> restocked ·{" "}
              <strong>{errorCount}</strong> failed
            </p>
            <ul className="gg-import__resultlist">
              {results.map((r) => (
                <li
                  key={r.lineNumber}
                  className={`gg-import__resultrow gg-import__resultrow--${r.status}`}
                >
                  <span className="gg-import__resultline">
                    Row {r.lineNumber}
                  </span>
                  <span className="gg-import__resultname">{r.cardName}</span>
                  <span className="gg-import__resultdetail">{r.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
