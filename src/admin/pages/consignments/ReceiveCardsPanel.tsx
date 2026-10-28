import { useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { SelectField, TextArea, TextField } from "../../components/ui/Field";
import { ScryfallSearch } from "../../components/cards/ScryfallSearch";
import { useToast } from "../../hooks/useToast";
import type { CardPrinting } from "../../types";
import {
  CARD_CONDITIONS,
  CARD_FINISHES,
  RECEIVE_CSV_TEMPLATE,
  dollarsToCents,
  parseReceiveCsv,
  type ReceiveLineInput,
  type ResolvedLine,
} from "../../../store/lib/consignmentReceiving";
import { consignmentAdminApi, type ReceivePreview, type ReceiveShipment } from "./consignmentAdminApi";

// Receive Cards: build a list of what arrived (card search, CSV upload or
// paste), check it against the card database (every line must match one
// exact printing in a finish it comes in), then record it as one batch.
// Received cards are not for sale: each line is inspected next, and nothing
// is listed until a later step. Consigned cards never enter trade stock.

interface Row {
  key: string;
  scryfallId: string | null;
  name: string;
  setCode: string;
  collectorNumber: string;
  language: string;
  finish: string;
  condition: string;
  quantity: string;
  list: string;
  min: string;
  notes: string;
  sourceRow: number | null;
  /** Finishes the printing comes in, once known. */
  finishes: string[] | null;
  imageUrl: string | null;
}

let seq = 0;
const nextKey = () => `r${++seq}`;
const centsText = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2));
const finishLabel = (f: string) => (f === "nonfoil" ? "Non-foil" : f[0].toUpperCase() + f.slice(1));

function toInput(r: Row): ReceiveLineInput {
  const qty = Number(r.quantity);
  const list = dollarsToCents(r.list);
  const min = dollarsToCents(r.min);
  return {
    scryfallId: r.scryfallId,
    name: r.name.trim() || null,
    setCode: r.setCode.trim() || null,
    collectorNumber: r.collectorNumber.trim() || null,
    language: r.language.trim() || null,
    finish: r.finish,
    condition: r.condition || null,
    quantity: Number.isFinite(qty) ? qty : NaN,
    // A price that isn't money is sent as-is so the check names the line.
    listPriceCents: list === undefined ? (-1 as number) : list,
    minPriceCents: min === undefined ? (-1 as number) : min,
    notes: r.notes.trim() || null,
    sourceRow: r.sourceRow,
  };
}

function fromPrinting(p: CardPrinting): Row {
  return {
    key: nextKey(),
    scryfallId: p.scryfallId,
    name: p.cardName,
    setCode: p.setCode,
    collectorNumber: p.collectorNumber,
    language: p.language || "en",
    finish: p.availableFinishes[0] ?? "nonfoil",
    condition: "",
    quantity: "1",
    list: centsText(p.scryfallPriceCents),
    min: "",
    notes: "",
    sourceRow: null,
    finishes: p.availableFinishes,
    imageUrl: p.imageUrl || null,
  };
}

function fromCsv(l: ReceiveLineInput): Row {
  return {
    key: nextKey(),
    scryfallId: l.scryfallId ?? null,
    name: l.name ?? "",
    setCode: l.setCode ?? "",
    collectorNumber: l.collectorNumber ?? "",
    language: l.language ?? "",
    finish: l.finish ?? "nonfoil",
    condition: l.condition ?? "",
    quantity: String(l.quantity),
    list: centsText(l.listPriceCents),
    min: centsText(l.minPriceCents),
    notes: l.notes ?? "",
    sourceRow: l.sourceRow ?? null,
    finishes: null,
    imageUrl: null,
  };
}

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([RECEIVE_CSV_TEMPLATE], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "consignment-cards-template.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReceiveCardsPanel({ consignmentId, onReceived, onCancel }: { consignmentId: string; onReceived: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<"search" | "csv">("search");
  const [csvText, setCsvText] = useState("");
  const [csvProblems, setCsvProblems] = useState<{ row: number; message: string }[]>([]);
  const [preview, setPreview] = useState<ReceivePreview | null>(null);
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<"check" | "receive" | null>(null);
  const [shipment, setShipment] = useState<ReceiveShipment>({ method: "mail", carrier: "", trackingNumber: "", notes: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  const inputs = useMemo(() => rows.map(toInput), [rows]);
  const signature = useMemo(() => JSON.stringify(inputs), [inputs]);
  const current = preview && checkedFor === signature ? preview : null;
  const resolvedByIndex = new Map<number, ResolvedLine>((current?.lines ?? []).map((l) => [l.index, l]));
  const copies = rows.reduce((n, r) => n + (Number.isInteger(Number(r.quantity)) ? Number(r.quantity) : 0), 0);

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function addCsv(text: string) {
    const parsed = parseReceiveCsv(text);
    setCsvProblems(parsed.problems);
    if (parsed.lines.length === 0) {
      if (!parsed.problems.length) toast.error("No card rows found.");
      return;
    }
    if (rows.length + parsed.lines.length > 1000) {
      toast.error("Receive up to 1,000 lines at a time. Split the file into smaller batches.");
      return;
    }
    setRows((rs) => [...rs, ...parsed.lines.map(fromCsv)]);
    setCsvText("");
    toast.success(`Added ${parsed.lines.length} line${parsed.lines.length === 1 ? "" : "s"}${parsed.problems.length ? `; ${parsed.problems.length} row(s) couldn't be read` : ""}. Check the cards next.`);
  }

  async function check() {
    setBusy("check");
    try {
      const result = await consignmentAdminApi.previewReceive(inputs);
      setPreview(result);
      setCheckedFor(signature);
      // Fill in what the database knows (image, finishes) without changing what staff entered.
      setRows((rs) =>
        rs.map((r, i) => {
          const p = result.lines.find((l) => l.index === i)?.printing;
          return p ? { ...r, finishes: p.finishes, imageUrl: p.imageUrl ?? r.imageUrl } : r;
        }),
      );
      // Rows were patched (finishes/image only), which doesn't change the inputs' signature.
      if (result.ok) toast.success(`All ${result.lines.length} line${result.lines.length === 1 ? "" : "s"} match a printing.`);
      else toast.error(`${result.lines.filter((l) => !l.ok).length} line(s) need fixing.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not check the cards.");
    } finally {
      setBusy(null);
    }
  }

  async function receive() {
    setBusy("receive");
    try {
      const r = await consignmentAdminApi.receiveCards(consignmentId, inputs, shipment);
      toast.success(`Received ${r.lines} line${r.lines === 1 ? "" : "s"} (${copies} cop${copies === 1 ? "y" : "ies"}). Inspect them next.`);
      setRows([]);
      setPreview(null);
      onReceived();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the cards.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="gg-rc">
      <p className="gg-muted">
        List exactly what arrived. Each line is matched to one exact printing. Received cards stay off sale until each line is inspected and
        accepted. Consigned cards are never available for trade.
      </p>

      <div className="gg-btn-row" role="group" aria-label="How to add cards">
        <Button size="sm" variant={mode === "search" ? "primary" : "secondary"} icon="search" aria-pressed={mode === "search"} onClick={() => setMode("search")}>
          Card search
        </Button>
        <Button size="sm" variant={mode === "csv" ? "primary" : "secondary"} icon="upload" aria-pressed={mode === "csv"} onClick={() => setMode("csv")}>
          CSV upload or paste
        </Button>
        <Button size="sm" variant="ghost" icon="download" onClick={downloadTemplate}>
          CSV template
        </Button>
      </div>

      {mode === "search" ? (
        <div className="gg-rc-search">
          <ScryfallSearch
            onSelect={(p) => {
              if (rows.length >= 1000) return toast.error("Receive up to 1,000 lines at a time.");
              setRows((rs) => [...rs, fromPrinting(p)]);
              toast.success(`Added ${p.cardName} (${p.setCode.toUpperCase()} ${p.collectorNumber}).`);
            }}
          />
        </div>
      ) : (
        <div className="gg-rc-csv">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
            className="gg-visually-hidden"
            aria-label="Choose a CSV file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              if (f.size > 2_000_000) return toast.error("That file is over 2 MB. Split it into smaller batches.");
              addCsv(await f.text());
            }}
          />
          <Button icon="upload" onClick={() => fileRef.current?.click()}>
            Choose a CSV file
          </Button>
          <TextArea
            label="Or paste rows (with the header row)"
            rows={5}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={RECEIVE_CSV_TEMPLATE.split("\n").slice(0, 2).join("\n")}
            hint="Columns: Name, Set, Collector Number, Finish, Condition, Quantity, List Price, Min Price, Notes. Set and collector number pick the exact printing."
          />
          <Button size="sm" disabled={!csvText.trim()} onClick={() => addCsv(csvText)}>
            Add pasted rows
          </Button>
          {csvProblems.length > 0 && (
            <div className="gg-cn-problems" role="alert">
              <strong>Rows that couldn't be read (not added):</strong>
              <ul>
                {csvProblems.slice(0, 20).map((p) => (
                  <li key={p.row}>
                    Row {p.row}: {p.message}
                  </li>
                ))}
                {csvProblems.length > 20 && <li>…and {csvProblems.length - 20} more.</li>}
              </ul>
            </div>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div className="gg-rc-table-wrap">
          <table className="gg-cs-table gg-rc-table">
            <caption className="gg-cs-caption">
              {rows.length} line{rows.length === 1 ? "" : "s"}, {copies} cop{copies === 1 ? "y" : "ies"}
            </caption>
            <thead>
              <tr>
                <th scope="col">Card</th>
                <th scope="col">Finish</th>
                <th scope="col">Condition (as described)</th>
                <th scope="col">Qty</th>
                <th scope="col">List $</th>
                <th scope="col">Min $</th>
                <th scope="col">Notes</th>
                <th scope="col">
                  <span className="gg-visually-hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const res = resolvedByIndex.get(i);
                const label = `${r.name || "Card"}${r.setCode ? ` ${r.setCode.toUpperCase()}` : ""}${r.collectorNumber ? ` #${r.collectorNumber}` : ""}`;
                const finishes = r.finishes && r.finishes.length ? r.finishes : CARD_FINISHES;
                return (
                  <tr key={r.key} className={res && !res.ok ? "gg-rc-bad" : undefined}>
                    <td data-label="Card">
                      <div className="gg-rc-card">
                        {r.imageUrl ? <img src={r.imageUrl} alt="" loading="lazy" width={36} height={50} /> : <span className="gg-rc-noimg" aria-hidden="true" />}
                        <div>
                          <strong>{res?.printing?.cardName ?? (r.name || "—")}</strong>
                          <span className="gg-cs-note">
                            {(res?.printing?.setCode ?? r.setCode).toUpperCase() || "no set"} · #{res?.printing?.collectorNumber ?? (r.collectorNumber || "?")}
                            {r.sourceRow ? ` · CSV row ${r.sourceRow}` : ""}
                            {res?.marketPriceCents != null ? ` · market $${centsText(res.marketPriceCents)}` : ""}
                          </span>
                          {res && res.ok && <Badge tone="success">Matched</Badge>}
                          {res && !res.ok && (
                            <ul className="gg-rc-problems" role="alert">
                              {res.problems.map((p) => (
                                <li key={p}>{p}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </td>
                    <td data-label="Finish">
                      <select className="gg-input gg-select" aria-label={`Finish for ${label}`} value={r.finish} onChange={(e) => update(r.key, { finish: e.target.value })}>
                        {!finishes.includes(r.finish as never) && <option value={r.finish}>{finishLabel(r.finish)} (not offered)</option>}
                        {finishes.map((f) => (
                          <option key={f} value={f}>
                            {finishLabel(f)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Condition">
                      <select className="gg-input gg-select" aria-label={`Described condition for ${label}`} value={r.condition} onChange={(e) => update(r.key, { condition: e.target.value })}>
                        <option value="">Not stated</option>
                        {CARD_CONDITIONS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Qty">
                      <input className="gg-input gg-rc-num" inputMode="numeric" aria-label={`Quantity for ${label}`} value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} />
                    </td>
                    <td data-label="List $">
                      <input className="gg-input gg-rc-num" inputMode="decimal" aria-label={`List price for ${label}`} value={r.list} onChange={(e) => update(r.key, { list: e.target.value })} />
                    </td>
                    <td data-label="Min $">
                      <input className="gg-input gg-rc-num" inputMode="decimal" aria-label={`Minimum price for ${label}`} value={r.min} onChange={(e) => update(r.key, { min: e.target.value })} />
                    </td>
                    <td data-label="Notes">
                      <input className="gg-input" aria-label={`Notes for ${label}`} maxLength={500} value={r.notes} onChange={(e) => update(r.key, { notes: e.target.value })} />
                    </td>
                    <td>
                      <Button size="sm" variant="ghost" icon="trash" aria-label={`Remove ${label}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <fieldset className="gg-rc-shipment">
          <legend>How they arrived</legend>
          <div className="gg-cs-row">
            <SelectField label="Method" value={shipment.method} onChange={(e) => setShipment((s) => ({ ...s, method: e.target.value === "in_person" ? "in_person" : "mail" }))}>
              <option value="mail">Mailed in</option>
              <option value="in_person">Dropped off in person</option>
            </SelectField>
            {shipment.method === "mail" && (
              <>
                <TextField label="Carrier" maxLength={60} value={shipment.carrier} onChange={(e) => setShipment((s) => ({ ...s, carrier: e.target.value }))} placeholder="USPS" />
                <TextField label="Tracking number" maxLength={60} value={shipment.trackingNumber} onChange={(e) => setShipment((s) => ({ ...s, trackingNumber: e.target.value }))} />
              </>
            )}
          </div>
          <TextArea label="Notes on the package (internal)" rows={2} maxLength={2000} value={shipment.notes} onChange={(e) => setShipment((s) => ({ ...s, notes: e.target.value }))} />
        </fieldset>
      )}

      <div className="gg-btn-row">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {rows.length > 0 && (
          <>
            <Button icon="check" loading={busy === "check"} disabled={busy !== null} onClick={() => void check()}>
              Check cards
            </Button>
            <Button
              variant="primary"
              icon="package"
              loading={busy === "receive"}
              disabled={busy !== null || !current?.ok}
              title={!current ? "Check the cards first" : !current.ok ? "Fix the lines marked first" : undefined}
              onClick={() => void receive()}
            >
              Receive {copies} cop{copies === 1 ? "y" : "ies"}
            </Button>
          </>
        )}
      </div>
      {rows.length > 0 && !current && <p className="gg-cs-note">Check the cards after any change, then receive them.</p>}
    </div>
  );
}
