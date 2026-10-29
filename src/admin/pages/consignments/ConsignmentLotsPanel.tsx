import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { SelectField, TextArea, TextField } from "../../components/ui/Field";
import { useToast } from "../../hooks/useToast";
import type { BadgeTone } from "../../utils/labels";
import { CARD_CONDITIONS, CARD_FINISHES, dollarsToCents, type CardCondition, type CardFinish } from "../../../store/lib/consignmentReceiving";
import {
  LOT_STATUS_LABELS,
  consignmentAdminApi,
  type LotEvent,
  type LotQuantities,
  type LotRecord,
  type LotStatus,
  type ReceivingBatch,
} from "./consignmentAdminApi";
import { LotSellingDialog, type SellingAction } from "./LotSellingDialogs";

// The consignment's cards, by the batch they arrived in, and inspection:
// start, accept (count, grade, finish, list price, the consignor's minimum),
// reject with a reason the consignor sees, or reopen a decision. Every step
// is recorded in the line's history. Accepted lines are then sold: listed on
// the website (when the consignor approved it) or sold on TCGplayer/eBay.

const STATUS_TONE: Record<LotStatus, BadgeTone> = {
  submitted: "neutral",
  received: "info",
  under_inspection: "warning",
  accepted: "success",
  rejected: "danger",
  listed: "gold",
  reserved_for_sale: "purple",
  sold: "success",
  returned: "neutral",
};

const EVENT_LABELS: Record<LotEvent["event"], string> = {
  received: "Received",
  inspection_started: "Inspection started",
  accepted: "Accepted",
  rejected: "Rejected",
  reopened: "Reopened",
};

const money = (c: number | null | undefined) => (c == null ? "—" : `$${(c / 100).toFixed(2)}`);
const centsText = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2));
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—");
const finishLabel = (f: string) => (f === "nonfoil" ? "Non-foil" : f[0].toUpperCase() + f.slice(1));

function InspectDialog({ lot, events, onClose, onDone }: { lot: LotRecord; events: LotEvent[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [decision, setDecision] = useState<"accept" | "reject">("accept");
  const [qty, setQty] = useState(String(lot.quantity_submitted ?? 1));
  const [condition, setCondition] = useState<CardCondition | "">(lot.declared_condition ?? "");
  const [finish, setFinish] = useState<CardFinish>(lot.finish);
  const [list, setList] = useState(centsText(lot.list_price_cents ?? lot.market_price_cents));
  const [min, setMin] = useState(centsText(lot.min_price_cents));
  const [reason, setReason] = useState("");
  const [belowMin, setBelowMin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitted = lot.quantity_submitted ?? 0;
  const qtyN = Number(qty);
  const partial = decision === "accept" && Number.isInteger(qtyN) && qtyN < submitted;

  async function submit() {
    setError(null);
    let step: Parameters<typeof consignmentAdminApi.inspectLot>[1];
    if (decision === "reject") {
      if (!reason.trim()) return setError("Say why the card is rejected. The consignor sees this.");
      step = { step: "reject", reason: reason.trim() };
    } else {
      const listC = dollarsToCents(list);
      const minC = dollarsToCents(min);
      if (!Number.isInteger(qtyN) || qtyN < 1) return setError("Accept at least 1 copy, or reject the line.");
      if (submitted && qtyN > submitted) return setError(`Only ${submitted} cop${submitted === 1 ? "y was" : "ies were"} received.`);
      if (!condition) return setError("Grade the condition.");
      if (!listC) return setError("Enter a list price.");
      if (minC === undefined) return setError("The minimum price isn't a dollar amount.");
      if (minC != null && minC > listC) return setError("The minimum price is above the list price.");
      if (partial && !reason.trim()) return setError("Say why the other copies aren't accepted. The consignor sees this.");
      step = { step: "accept", quantityAccepted: qtyN, condition, finish, listPriceCents: listC, minPriceCents: minC, reason: reason.trim() || undefined, allowBelowMinimum: belowMin };
    }
    setBusy(true);
    try {
      await consignmentAdminApi.inspectLot(lot.id, step);
      toast.success(decision === "accept" ? `Accepted ${qtyN} × ${lot.card_name}.` : `Rejected ${lot.card_name}.`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Inspect ${lot.card_name}`}
      size="lg"
      footer={
        <div className="gg-btn-row">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={decision === "accept" ? "primary" : "danger"} loading={busy} onClick={() => void submit()}>
            {decision === "accept" ? "Accept" : "Reject"}
          </Button>
        </div>
      }
    >
      <div className="gg-lot-head">
        {lot.image_url && <img src={lot.image_url} alt={`${lot.card_name} card`} width={146} height={204} />}
        <dl className="gg-cn-facts">
          <div>
            <dt>Printing</dt>
            <dd>
              {lot.set_name ?? lot.set_code.toUpperCase()} · #{lot.collector_number} · {lot.language.toUpperCase()}
            </dd>
          </div>
          <div>
            <dt>Received</dt>
            <dd>
              {submitted} × {finishLabel(lot.finish)}, described as {lot.declared_condition ?? "not stated"}
            </dd>
          </div>
          <div>
            <dt>Market</dt>
            <dd>{money(lot.market_price_cents)}</dd>
          </div>
          {lot.internal_notes && (
            <div>
              <dt>Notes</dt>
              <dd className="gg-cn-pre">{lot.internal_notes}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="gg-btn-row" role="radiogroup" aria-label="Decision">
        <Button size="sm" role="radio" aria-checked={decision === "accept"} variant={decision === "accept" ? "primary" : "secondary"} icon="check" onClick={() => setDecision("accept")}>
          Accept
        </Button>
        <Button size="sm" role="radio" aria-checked={decision === "reject"} variant={decision === "reject" ? "danger" : "secondary"} icon="close" onClick={() => setDecision("reject")}>
          Reject all
        </Button>
      </div>

      {decision === "accept" ? (
        <>
          <div className="gg-cs-row">
            <TextField label="Copies accepted" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} hint={`of ${submitted} received`} />
            <SelectField label="Graded condition" value={condition} onChange={(e) => setCondition(e.target.value as CardCondition)}>
              <option value="">Choose…</option>
              {CARD_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>
            <SelectField label="Finish" value={finish} onChange={(e) => setFinish(e.target.value as CardFinish)}>
              {CARD_FINISHES.map((f) => (
                <option key={f} value={f}>
                  {finishLabel(f)}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="gg-cs-row">
            <TextField label="List price ($)" inputMode="decimal" value={list} onChange={(e) => setList(e.target.value)} hint={`Market ${money(lot.market_price_cents)}`} />
            <TextField label="Consignor's minimum ($)" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} hint="Optional. Never sold below this." />
          </div>
          <TextArea
            label={partial ? "Why the other copies aren't accepted (the consignor sees this)" : "Note for the consignor (optional)"}
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <label className="gg-cs-check">
            <input type="checkbox" checked={belowMin} onChange={(e) => setBelowMin(e.target.checked)} />
            Accept even if the list price is below the store's minimum card value
          </label>
        </>
      ) : (
        <TextArea label="Why it's rejected (the consignor sees this)" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} hint="For example: counterfeit, wrong card, condition below what we accept." />
      )}
      {error && (
        <p className="gg-field__error" role="alert">
          {error}
        </p>
      )}

      {events.length > 0 && (
        <details className="gg-lot-history">
          <summary>History ({events.length})</summary>
          <ol>
            {events.map((ev) => (
              <li key={ev.id}>
                {when(ev.created_at)}: {EVENT_LABELS[ev.event]}
                {ev.actor ? ` by ${ev.actor}` : ""}
                {typeof ev.details.reason === "string" && ev.details.reason ? ` (${ev.details.reason})` : ""}
              </li>
            ))}
          </ol>
        </details>
      )}
    </Modal>
  );
}

export interface SellingContext {
  quantities: LotQuantities[];
  /** Copies on the website per lot, from its inventory row. */
  onSiteByLot: Record<string, number>;
  approved: { website: boolean; tcgplayer: boolean; ebay: boolean };
  /** The consignment is signed and not ended. */
  canSell: boolean;
}

export function ConsignmentLotsPanel({
  batches,
  lots,
  events,
  onChanged,
  selling,
}: {
  batches: ReceivingBatch[];
  lots: LotRecord[];
  events: LotEvent[];
  onChanged: () => Promise<void> | void;
  selling?: SellingContext;
}) {
  const toast = useToast();
  const [inspecting, setInspecting] = useState<LotRecord | null>(null);
  const [selling_, setSelling] = useState<{ lot: LotRecord; action: SellingAction } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const qtyByLot = new Map((selling?.quantities ?? []).map((q) => [q.lot_id, q]));
  const marketplace = !!selling && (selling.approved.tcgplayer || selling.approved.ebay);

  const received = lots.filter((l) => l.status === "received");
  const totals = lots.reduce(
    (t, l) => ({ submitted: t.submitted + (l.quantity_submitted ?? 0), accepted: t.accepted + l.quantity_accepted, rejected: t.rejected + l.quantity_rejected }),
    { submitted: 0, accepted: 0, rejected: 0 },
  );

  async function step(lot: LotRecord, s: "start" | "reopen") {
    setBusy(lot.id);
    try {
      await consignmentAdminApi.inspectLot(lot.id, { step: s });
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  async function startAll() {
    setBusy("all");
    let failed = 0;
    for (const lot of received) {
      try {
        await consignmentAdminApi.inspectLot(lot.id, { step: "start" });
      } catch {
        failed++;
      }
    }
    await onChanged();
    setBusy(null);
    if (failed) toast.error(`${failed} line(s) couldn't start inspection. Try them one at a time.`);
    else toast.success(`Started inspecting ${received.length} line${received.length === 1 ? "" : "s"}.`);
  }

  const byBatch = [...batches].sort((a, b) => b.batch_number - a.batch_number);
  const unbatched = lots.filter((l) => !l.batch_id);

  const lotRow = (l: LotRecord) => (
    <tr key={l.id}>
      <td data-label="Card">
        <div className="gg-rc-card">
          {l.image_url ? <img src={l.image_url} alt="" loading="lazy" width={36} height={50} /> : <span className="gg-rc-noimg" aria-hidden="true" />}
          <div>
            <strong>{l.card_name}</strong>
            <span className="gg-cs-note">
              {l.set_code.toUpperCase()} · #{l.collector_number} · {finishLabel(l.finish)}
              {l.language !== "en" ? ` · ${l.language.toUpperCase()}` : ""}
            </span>
          </div>
        </div>
      </td>
      <td data-label="Condition">
        {l.condition ? (
          <>
            {l.condition}
            {l.declared_condition && l.declared_condition !== l.condition && <span className="gg-cs-note">described {l.declared_condition}</span>}
          </>
        ) : (
          <span className="gg-cs-note">described {l.declared_condition ?? "—"}</span>
        )}
      </td>
      <td data-label="Copies">
        {l.status === "accepted" || l.status === "rejected" ? (
          <>
            {l.quantity_accepted} of {l.quantity_submitted ?? "?"}
            {l.quantity_rejected > 0 && <span className="gg-cs-note">{l.quantity_rejected} rejected</span>}
          </>
        ) : (
          (l.quantity_submitted ?? "?")
        )}
      </td>
      <td data-label="Prices">
        {money(l.list_price_cents)}
        <span className="gg-cs-note">
          min {money(l.min_price_cents)} · market {money(l.market_price_cents)}
        </span>
      </td>
      <td data-label="Status">
        <Badge tone={STATUS_TONE[l.status]}>{LOT_STATUS_LABELS[l.status]}</Badge>
        {l.rejection_reason && <span className="gg-cs-note">{l.rejection_reason}</span>}
        {qtyByLot.get(l.id) && (
          <span className="gg-cs-note">
            {qtyByLot.get(l.id)!.on_sale} on sale · {qtyByLot.get(l.id)!.sold} sold · {qtyByLot.get(l.id)!.unlisted} not listed
            {qtyByLot.get(l.id)!.pending ? ` · ${qtyByLot.get(l.id)!.pending} in checkout` : ""}
          </span>
        )}
      </td>
      <td>
        <div className="gg-btn-row">
          {l.status === "received" && (
            <Button size="sm" loading={busy === l.id} disabled={busy !== null} onClick={() => void step(l, "start")}>
              Start inspection
            </Button>
          )}
          {(l.status === "received" || l.status === "under_inspection") && (
            <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => setInspecting(l)}>
              Inspect
            </Button>
          )}
          {selling?.canSell && (l.status === "accepted" || l.status === "listed") && qtyByLot.get(l.id) && (
            <>
              {selling.approved.website && qtyByLot.get(l.id)!.unlisted > 0 && (
                <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => setSelling({ lot: l, action: "list" })}>
                  List on website
                </Button>
              )}
              {l.status === "listed" && (
                <Button size="sm" disabled={busy !== null} onClick={() => setSelling({ lot: l, action: "price" })}>
                  Change price
                </Button>
              )}
              {(selling.onSiteByLot[l.id] ?? 0) > 0 && (
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setSelling({ lot: l, action: "unlist" })}>
                  Take off sale
                </Button>
              )}
              {marketplace && qtyByLot.get(l.id)!.unlisted + (selling.onSiteByLot[l.id] ?? 0) > 0 && (
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setSelling({ lot: l, action: "sale" })}>
                  Record a sale
                </Button>
              )}
            </>
          )}
          {(l.status === "accepted" || l.status === "rejected") && (
            <Button
              size="sm"
              variant="ghost"
              loading={busy === l.id}
              disabled={busy !== null}
              onClick={() => {
                if (window.confirm(`Reopen ${l.card_name}? It goes back to inspection and the decision is kept in its history.`)) void step(l, "reopen");
              }}
            >
              Reopen
            </Button>
          )}
        </div>
      </td>
    </tr>
  );

  const table = (rows: LotRecord[]) => (
    <div className="gg-rc-table-wrap">
      <table className="gg-cs-table gg-rc-table">
        <thead>
          <tr>
            <th scope="col">Card</th>
            <th scope="col">Condition</th>
            <th scope="col">Copies</th>
            <th scope="col">Price</th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="gg-visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>{rows.map(lotRow)}</tbody>
      </table>
    </div>
  );

  return (
    <div className="gg-lots">
      <div className="gg-btn-row gg-lots-summary">
        <span>
          {lots.length} line{lots.length === 1 ? "" : "s"} · {totals.submitted} received · {totals.accepted} accepted · {totals.rejected} rejected
        </span>
        {received.length > 1 && (
          <Button size="sm" loading={busy === "all"} disabled={busy !== null} onClick={() => void startAll()}>
            Start inspecting all {received.length}
          </Button>
        )}
      </div>
      {byBatch.map((b) => {
        const rows = lots.filter((l) => l.batch_id === b.id);
        if (rows.length === 0) return null;
        return (
          <section key={b.id} className="gg-lots-batch" aria-label={`Batch ${b.batch_number}`}>
            <h4>
              Batch {b.batch_number} · {when(b.received_at)} · {b.method === "in_person" ? "dropped off" : `mailed${b.carrier ? ` via ${b.carrier}` : ""}`}
              {b.tracking_number ? ` · ${b.tracking_number}` : ""}
              {b.created_by ? <span className="gg-cs-note">received by {b.created_by}</span> : null}
            </h4>
            {b.notes && <p className="gg-cs-note gg-cn-pre">{b.notes}</p>}
            {table(rows)}
          </section>
        );
      })}
      {unbatched.length > 0 && table(unbatched)}
      {selling_ && selling && qtyByLot.get(selling_.lot.id) && (
        <LotSellingDialog
          action={selling_.action}
          lot={selling_.lot}
          quantities={qtyByLot.get(selling_.lot.id)!}
          onSale={selling.onSiteByLot[selling_.lot.id] ?? 0}
          approved={selling.approved}
          onClose={() => setSelling(null)}
          onDone={() => {
            setSelling(null);
            void onChanged();
          }}
        />
      )}
      {inspecting && (
        <InspectDialog
          lot={inspecting}
          events={events.filter((e) => e.lot_id === inspecting.id)}
          onClose={() => setInspecting(null)}
          onDone={() => {
            setInspecting(null);
            void onChanged();
          }}
        />
      )}
    </div>
  );
}
