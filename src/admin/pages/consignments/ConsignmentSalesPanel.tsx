import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { SelectField, TextArea, TextField } from "../../components/ui/Field";
import { Spinner } from "../../components/ui/States";
import { useToast } from "../../hooks/useToast";
import type { BadgeTone } from "../../utils/labels";
import { CHANNEL_LABELS, applyBps, formatBps } from "../../../store/lib/consignmentMath";
import { dollarsToCents } from "../../../store/lib/consignmentReceiving";
import { adminDownload } from "../../repositories/apiClient";
import {
  ADJUSTMENT_LABELS,
  consignmentAdminApi,
  type AdjustmentKind,
  type AdjustmentRecord,
  type HoldRecord,
  type LotRecord,
  type PayoutRecord,
  type SaleRecord,
  type SettlementExpenses,
  type SettlementProposal,
} from "./consignmentAdminApi";

// A consignment's sales and payouts. Website sales appear when their order is
// paid and follow it as it ships and is delivered; TCGplayer and eBay sales
// are recorded from the Cards section. Once the buyer's inspection period
// after delivery is over, staff settle a sale (confirm its actual expenses;
// the database works out the commission and payout), then record payouts
// covering settled sales.

const money = (c: number | null | undefined) => (c == null ? "—" : `$${(c / 100).toFixed(2)}`);
const centsText = (c: number) => (c / 100).toFixed(2);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—");

const PAYOUT_METHODS: Record<string, string> = {
  paypal: "PayPal",
  venmo: "Venmo",
  zelle: "Zelle",
  check: "Check",
  ach: "Bank transfer (ACH)",
  store_credit: "Store credit",
};

function saleState(s: SaleRecord, now: number, held: boolean): { label: string; tone: BadgeTone } {
  if (s.status === "cancelled") return { label: s.lost ? "Lost in shipping" : "Cancelled", tone: "neutral" };
  if (held) return { label: "On hold", tone: "danger" };
  if (s.status === "paid") return { label: "Paid out", tone: "success" };
  if (s.status === "settled") return { label: "Settled, ready to pay", tone: "gold" };
  if (!s.delivered_at) return { label: s.shipped_at ? "Shipped" : "Sold, not shipped", tone: "info" };
  if (s.payable_at && new Date(s.payable_at).getTime() > now) return { label: `Inspection until ${day(s.payable_at)}`, tone: "warning" };
  return { label: "Ready to settle", tone: "purple" };
}

const EXPENSE_FIELDS: { key: keyof SettlementExpenses; label: string }[] = [
  { key: "marketplaceFeeCents", label: "Marketplace fee" },
  { key: "processingFeeCents", label: "Payment processing" },
  { key: "postageCents", label: "Postage (after buyer's shipping)" },
  { key: "insuranceCents", label: "Additional insurance" },
  { key: "otherExpenseCents", label: "Other approved expense" },
];

function SettleDialog({ sale, cardName, onClose, onDone }: { sale: SaleRecord; cardName: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [proposal, setProposal] = useState<SettlementProposal | null>(null);
  const [values, setValues] = useState<Record<keyof SettlementExpenses, string> | null>(null);
  const [otherNote, setOtherNote] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    consignmentAdminApi.settlement(sale.id).then(
      (p) => {
        if (cancelled) return;
        setProposal(p);
        setValues(Object.fromEntries(EXPENSE_FIELDS.map((f) => [f.key, centsText(p.expenses[f.key])])) as Record<keyof SettlementExpenses, string>);
      },
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Could not work out the expenses."),
    );
    return () => {
      cancelled = true;
    };
  }, [sale.id]);

  const parsed = useMemo(() => {
    if (!values) return null;
    const out = {} as SettlementExpenses;
    for (const f of EXPENSE_FIELDS) {
      const c = dollarsToCents(values[f.key]);
      if (c === undefined) return null;
      out[f.key] = c ?? 0;
    }
    return out;
  }, [values]);

  // The same math as consignment_settle_sale, so staff see the payout before saving.
  const preview = useMemo(() => {
    if (!parsed || !proposal) return null;
    const expenses = Object.values(parsed).reduce((a, b) => a + b, 0);
    const net = Math.max(0, sale.gross_cents - expenses);
    const rate = proposal.preview.commissionRateBps;
    const commission = net > 0 ? applyBps(net, rate) : 0;
    return { expenses, net, rate, commission, payout: net - commission };
  }, [parsed, proposal, sale.gross_cents]);

  const changed = proposal && parsed ? EXPENSE_FIELDS.some((f) => parsed[f.key] !== proposal.expenses[f.key]) : false;

  async function save() {
    if (!parsed) return setError("Every expense must be a dollar amount.");
    if (parsed.otherExpenseCents > 0 && !otherNote.trim()) return setError("Say what the other expense is. It must be one the consignor approved in writing.");
    if (changed && !adjustNote.trim()) return setError("Say why you changed the proposed expenses. It's kept with the settlement.");
    setBusy(true);
    setError(null);
    try {
      const r = await consignmentAdminApi.settleSale(sale.id, parsed, otherNote.trim(), adjustNote.trim());
      toast.success(`Settled: ${money(r.payoutCents)} to the consignor.`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not settle the sale.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Settle ${cardName}`}
      size="lg"
      footer={
        <div className="gg-btn-row">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!proposal} onClick={() => void save()}>
            Settle sale
          </Button>
        </div>
      }
    >
      {!proposal && !error && <Spinner label="Working out the expenses" />}
      {proposal && values && (
        <>
          <p className="gg-muted">
            {sale.quantity} × {money(sale.unit_price_cents)} on {CHANNEL_LABELS[sale.channel]} = {money(sale.gross_cents)}. Confirm the actual expenses
            (agreement section 4). The commission rate comes from the consignor's signed agreement, by the price of one card.
          </p>
          {proposal.warnings.length > 0 && (
            <div className="gg-cn-problems" role="status">
              <ul>
                {proposal.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="gg-settle-grid">
            {EXPENSE_FIELDS.map((f) => (
              <TextField
                key={f.key}
                label={`${f.label} ($)`}
                inputMode="decimal"
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v!, [f.key]: e.target.value }))}
              />
            ))}
          </div>
          {parsed && parsed.otherExpenseCents > 0 && (
            <TextField label="What the other expense is" maxLength={500} value={otherNote} onChange={(e) => setOtherNote(e.target.value)} />
          )}
          {changed && <TextArea label="Why you changed the proposed expenses" rows={2} maxLength={500} value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} />}
          {proposal.basis.length > 0 && (
            <details className="gg-lot-history">
              <summary>How these were worked out</summary>
              <ul>
                {proposal.basis.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </details>
          )}
          {preview && (
            <table className="gg-cs-table gg-cs-table--narrow gg-settle-sum">
              <tbody>
                <tr>
                  <th scope="row">Final selling price</th>
                  <td>{money(sale.gross_cents)}</td>
                </tr>
                <tr>
                  <th scope="row">Transaction expenses</th>
                  <td>−{money(preview.expenses)}</td>
                </tr>
                <tr>
                  <th scope="row">Net sale amount</th>
                  <td>{money(preview.net)}</td>
                </tr>
                <tr>
                  <th scope="row">Commission ({formatBps(preview.rate)})</th>
                  <td>−{money(preview.commission)}</td>
                </tr>
                <tr>
                  <th scope="row">Consignor's payout</th>
                  <td>
                    <strong>{money(preview.payout)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </>
      )}
      {error && (
        <p className="gg-field__error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

function PayoutDialog({
  consignmentId,
  settled,
  adjustments,
  cardName,
  onClose,
  onDone,
}: {
  consignmentId: string;
  settled: SaleRecord[];
  adjustments: AdjustmentRecord[];
  cardName: (s: SaleRecord) => string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(settled.map((s) => s.id)));
  const [pickedAdj, setPickedAdj] = useState<Set<string>>(() => new Set(adjustments.map((a) => a.id)));
  const [method, setMethod] = useState("paypal");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total =
    settled.filter((s) => picked.has(s.id)).reduce((n, s) => n + (s.payout_cents ?? 0), 0) +
    adjustments.filter((a) => pickedAdj.has(a.id)).reduce((n, a) => n + a.amount_cents, 0);

  async function save() {
    if (picked.size + pickedAdj.size === 0) return setError("Choose what this payout covers.");
    if (total < 0) return setError("These come to less than $0. Leave the recovery for a later payout, or invoice the consignor.");
    setBusy(true);
    setError(null);
    try {
      await consignmentAdminApi.recordPayout({
        consignmentId,
        saleIds: [...picked],
        adjustmentIds: [...pickedAdj],
        method,
        reference: reference.trim(),
        paidAt: new Date(`${paidOn}T12:00:00`).toISOString(),
        note: note.trim(),
      });
      toast.success(`Recorded a ${money(total)} payout.`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the payout.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Record a payout"
      size="lg"
      footer={
        <div className="gg-btn-row">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Record {money(total)} payout
          </Button>
        </div>
      }
    >
      <p className="gg-muted">Record money you've already sent the consignor. It doesn't send anything.</p>
      <fieldset className="gg-rc-shipment">
        <legend>Sales covered</legend>
        {settled.map((s) => (
          <label key={s.id} className="gg-cs-check">
            <input
              type="checkbox"
              checked={picked.has(s.id)}
              onChange={(e) =>
                setPicked((p) => {
                  const next = new Set(p);
                  if (e.target.checked) next.add(s.id);
                  else next.delete(s.id);
                  return next;
                })
              }
            />
            {cardName(s)} · {s.quantity} × {money(s.unit_price_cents)} · payout {money(s.payout_cents)}
          </label>
        ))}
        {adjustments.map((a) => (
          <label key={a.id} className="gg-cs-check">
            <input
              type="checkbox"
              checked={pickedAdj.has(a.id)}
              onChange={(e) =>
                setPickedAdj((p) => {
                  const next = new Set(p);
                  if (e.target.checked) next.add(a.id);
                  else next.delete(a.id);
                  return next;
                })
              }
            />
            {ADJUSTMENT_LABELS[a.kind]}: {a.reason} · {money(a.amount_cents)}
          </label>
        ))}
      </fieldset>
      <div className="gg-cs-row">
        <SelectField label="Paid by" value={method} onChange={(e) => setMethod(e.target.value)}>
          {Object.entries(PAYOUT_METHODS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectField>
        <TextField label="Reference" maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} hint="Transaction ID or check number" />
        <TextField label="Date paid" type="date" value={paidOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setPaidOn(e.target.value)} />
      </div>
      <TextArea label="Note (internal)" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      {error && (
        <p className="gg-field__error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

const ADJUSTMENT_CHOICES: { kind: AdjustmentKind; label: string; sign: 1 | -1; hint: string }[] = [
  { kind: "chargeback", label: "Chargeback or refund after payout (recover)", sign: -1, hint: "Only for a refund the agreement lets us recover (6.5(3), 6.6), with the documentation sent to the consignor first." },
  { kind: "refund_costs", label: "Refund or return costs (recover)", sign: -1, hint: "Non-refundable fees and return costs when the card didn't match the consignor's description (6.5(3))." },
  { kind: "return_shipping", label: "Return shipping (recover)", sign: -1, hint: "Return shipping the consignor owes (7.4(3))." },
  { kind: "reversal", label: "Sale reversed after payout (recover)", sign: -1, hint: "A paid-out sale that was reversed." },
  { kind: "goodwill", label: "Goodwill credit (pay)", sign: 1, hint: "Money we owe or choose to give the consignor." },
  { kind: "correction", label: "Correction (pay or recover)", sign: 1, hint: "Fixing a statement error (6.7). Enter a negative amount to recover." },
];

function AdjustmentDialog({ consignmentId, sales, cardName, onClose, onDone }: { consignmentId: string; sales: SaleRecord[]; cardName: (s: SaleRecord) => string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<AdjustmentKind>("chargeback");
  const [amount, setAmount] = useState("");
  const [saleId, setSaleId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choice = ADJUSTMENT_CHOICES.find((c) => c.kind === kind)!;

  async function save() {
    const negative = amount.trim().startsWith("-");
    const c = dollarsToCents(amount.replace("-", ""));
    if (!c) return setError("Enter the amount in dollars.");
    const cents = kind === "correction" ? (negative ? -c : c) : choice.sign * c;
    if (reason.trim().length < 3) return setError("Document the reason. The consignor sees it on their statement.");
    setBusy(true);
    setError(null);
    try {
      await consignmentAdminApi.addAdjustment({ consignmentId, saleId: saleId || null, kind, amountCents: cents, reason: reason.trim() });
      toast.success(`Added a ${money(cents)} adjustment. It's settled in the next payout.`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the adjustment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add an adjustment"
      size="md"
      footer={
        <div className="gg-btn-row">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Add adjustment
          </Button>
        </div>
      }
    >
      <SelectField label="Kind" value={kind} onChange={(e) => setKind(e.target.value as AdjustmentKind)} hint={choice.hint}>
        {ADJUSTMENT_CHOICES.map((c) => (
          <option key={c.kind} value={c.kind}>
            {c.label}
          </option>
        ))}
      </SelectField>
      <div className="gg-cs-row">
        <TextField label="Amount ($)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} hint={kind === "correction" ? "Negative to recover" : choice.sign < 0 ? "Recovered from the consignor" : "Paid to the consignor"} />
        <SelectField label="Sale (optional)" value={saleId} onChange={(e) => setSaleId(e.target.value)}>
          <option value="">Not tied to one sale</option>
          {sales.map((s) => (
            <option key={s.id} value={s.id}>
              {cardName(s)} · {day(s.sold_at)}
            </option>
          ))}
        </SelectField>
      </div>
      <TextArea label="Reason (the consignor sees this)" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && (
        <p className="gg-field__error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

export function ConsignmentSalesPanel({
  consignmentId,
  sales,
  payouts,
  lots,
  holds = [],
  adjustments = [],
  label = "consignment",
  onChanged,
}: {
  consignmentId: string;
  sales: SaleRecord[];
  payouts: PayoutRecord[];
  lots: LotRecord[];
  holds?: HoldRecord[];
  adjustments?: AdjustmentRecord[];
  /** "GG-C-1001", for statement file names. */
  label?: string;
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [settling, setSettling] = useState<SaleRecord | null>(null);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const cardName = (s: SaleRecord) => lotById.get(s.lot_id)?.card_name ?? "Card";
  const openHolds = new Map<string, HoldRecord>();
  for (const h of holds) if (!h.resolved_at) openHolds.set(h.sale_id, h);
  const settled = sales.filter((s) => s.status === "settled" && !openHolds.has(s.id));
  const openAdjustments = adjustments.filter((a) => !a.payout_id && !a.voided_at);
  const owed = settled.reduce((n, s) => n + (s.payout_cents ?? 0), 0) + openAdjustments.reduce((n, a) => n + a.amount_cents, 0);
  const [adjusting, setAdjusting] = useState(false);
  const paid = payouts.filter((p) => !p.voided_at).reduce((n, p) => n + p.amount_cents, 0);
  const flagged = sales.filter((s) => s.flag);

  async function run(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    try {
      const msg = await fn();
      if (msg) toast.success(msg);
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  if (sales.length === 0 && payouts.length === 0 && adjustments.length === 0) {
    return <p className="gg-muted">No sales yet. Website sales appear here when an order is paid; record TCGplayer and eBay sales from Cards.</p>;
  }

  return (
    <div className="gg-lots">
      <div className="gg-btn-row gg-lots-summary">
        <span>
          {sales.filter((s) => s.status !== "cancelled").length} sales · {money(owed)} ready to pay · {money(paid)} paid out
          {openHolds.size > 0 ? ` · ${openHolds.size} on hold` : ""}
        </span>
        <div className="gg-btn-row">
          <Button size="sm" variant="ghost" onClick={() => setAdjusting(true)}>
            Add adjustment
          </Button>
          {(settled.length > 0 || openAdjustments.length > 0) && (
            <Button size="sm" variant="primary" icon="dollar" onClick={() => setPaying(true)}>
              Record a payout
            </Button>
          )}
        </div>
      </div>
      {flagged.length > 0 && (
        <div className="gg-cn-problems" role="alert">
          <strong>Needs attention</strong>
          <ul>
            {flagged.map((s) => (
              <li key={s.id}>
                {cardName(s)} ({day(s.sold_at)}): {s.flag}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="gg-rc-table-wrap">
        <table className="gg-cs-table gg-rc-table">
          <thead>
            <tr>
              <th scope="col">Card</th>
              <th scope="col">Sold</th>
              <th scope="col">Price</th>
              <th scope="col">Status</th>
              <th scope="col">Payout</th>
              <th scope="col">
                <span className="gg-visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => {
              const hold = openHolds.get(s.id);
              const state = saleState(s, now, !!hold);
              const fundsOk = s.channel === "website" || !!s.funds_released_at;
              const ready = !hold && fundsOk && s.status === "open" && s.delivered_at && s.payable_at && new Date(s.payable_at).getTime() <= now;
              return (
                <tr key={s.id}>
                  <td data-label="Card">
                    <strong>{cardName(s)}</strong>
                    <span className="gg-cs-note">
                      {CHANNEL_LABELS[s.channel]}
                      {s.external_order_ref ? ` · ${s.external_order_ref}` : ""}
                    </span>
                  </td>
                  <td data-label="Sold">
                    {day(s.sold_at)}
                    {s.delivered_at && <span className="gg-cs-note">delivered {day(s.delivered_at)}</span>}
                    {s.payout_due_on && (s.status === "open" || s.status === "settled") && (
                      <span className="gg-cs-note">payout due {day(`${s.payout_due_on}T12:00:00`)}</span>
                    )}
                    {s.channel !== "website" && s.status === "open" && (
                      <span className="gg-cs-note">{s.funds_released_at ? `funds released ${day(s.funds_released_at)}` : "funds not released yet"}</span>
                    )}
                  </td>
                  <td data-label="Price">
                    {s.quantity} × {money(s.unit_price_cents)}
                  </td>
                  <td data-label="Status">
                    <Badge tone={state.tone}>{state.label}</Badge>
                    {s.cancel_reason && <span className="gg-cs-note">{s.cancel_reason}{s.restocked ? " · put back on sale" : ""}</span>}
                    {hold && <span className="gg-cs-note">Hold: {hold.reason}</span>}
                  </td>
                  <td data-label="Payout">
                    {s.payout_cents != null ? (
                      <>
                        {money(s.payout_cents)}
                        <span className="gg-cs-note">
                          net {money(s.net_sale_cents)} − {money(s.commission_cents)} commission
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <div className="gg-btn-row">
                      {s.status === "open" && (s.channel !== "website" || !s.delivered_at) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={busy === `d-${s.id}`}
                          disabled={busy !== null}
                          onClick={() => {
                            const input = window.prompt("Delivered on (YYYY-MM-DD)?", new Date().toISOString().slice(0, 10));
                            if (!input) return;
                            const at = new Date(`${input.trim()}T12:00:00`);
                            if (Number.isNaN(at.getTime())) return toast.error("Enter the date as YYYY-MM-DD.");
                            const deliveredAt = Math.min(at.getTime(), Date.now());
                            void run(`d-${s.id}`, async () => {
                              const r = await consignmentAdminApi.markSaleDelivered(s.id, new Date(deliveredAt).toISOString());
                              return `Delivery recorded. It can be settled after ${when(r.payableAt)}.`;
                            });
                          }}
                        >
                          {s.delivered_at ? "Change delivery" : "Mark delivered"}
                        </Button>
                      )}
                      {ready && (
                        <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => setSettling(s)}>
                          Settle
                        </Button>
                      )}
                      {s.channel !== "website" && s.status === "open" && !s.funds_released_at && (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={busy === `f-${s.id}`}
                          disabled={busy !== null}
                          onClick={() => {
                            const input = window.prompt(`When did ${s.channel === "ebay" ? "eBay" : "TCGplayer"} release the funds? (YYYY-MM-DD)`, new Date().toISOString().slice(0, 10));
                            if (!input) return;
                            const at = new Date(`${input.trim()}T12:00:00`);
                            if (Number.isNaN(at.getTime())) return toast.error("Enter the date as YYYY-MM-DD.");
                            void run(`f-${s.id}`, async () => {
                              await consignmentAdminApi.markFundsReleased(s.id, new Date(Math.min(at.getTime(), Date.now())).toISOString());
                              return "Recorded.";
                            });
                          }}
                        >
                          Funds released
                        </Button>
                      )}
                      {(s.status === "open" || s.status === "settled") && !hold && (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={busy === `h-${s.id}`}
                          disabled={busy !== null}
                          onClick={() => {
                            const reason = window.prompt("What did the buyer report? The consignor is told this reason (agreement 6.4).");
                            if (!reason?.trim()) return;
                            void run(`h-${s.id}`, async () => {
                              await consignmentAdminApi.openHold(s.id, "buyer_report", reason.trim());
                              return "Held. Tell the consignor within 2 business days.";
                            });
                          }}
                        >
                          Hold
                        </Button>
                      )}
                      {hold && hold.source !== "claim" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={busy === `r-${hold.id}`}
                          disabled={busy !== null}
                          onClick={() => {
                            const resolution = window.prompt("How was it resolved?");
                            if (!resolution?.trim()) return;
                            void run(`r-${hold.id}`, async () => {
                              await consignmentAdminApi.releaseHold(hold.id, resolution.trim());
                              return "Hold released.";
                            });
                          }}
                        >
                          Release hold
                        </Button>
                      )}
                      {s.status === "settled" && (
                        <Button size="sm" variant="ghost" loading={busy === `u-${s.id}`} disabled={busy !== null} onClick={() => void run(`u-${s.id}`, async () => {
                          await consignmentAdminApi.unsettleSale(s.id);
                          return "Settlement reopened.";
                        })}>
                          Reopen
                        </Button>
                      )}
                      {s.channel !== "website" && (s.status === "open" || s.status === "settled") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={busy === `c-${s.id}`}
                          disabled={busy !== null}
                          onClick={() => {
                            const reason = window.prompt("Why is this sale cancelled? (Kept in the record.)");
                            if (!reason?.trim()) return;
                            void run(`c-${s.id}`, async () => {
                              await consignmentAdminApi.cancelSale(s.id, reason.trim());
                              return "Sale cancelled. The copies are back with the consignor's unlisted cards.";
                            });
                          }}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {payouts.length > 0 && (
        <section aria-label="Payouts" className="gg-lots-batch">
          <h4>Payouts</h4>
          <table className="gg-cs-table">
            <thead>
              <tr>
                <th scope="col">Paid</th>
                <th scope="col">Amount</th>
                <th scope="col">How</th>
                <th scope="col">
                  <span className="gg-visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td>
                    {day(p.paid_at)}
                    {p.created_by && <span className="gg-cs-note">recorded by {p.created_by}</span>}
                  </td>
                  <td>
                    {p.voided_at ? <s>{money(p.amount_cents)}</s> : money(p.amount_cents)}
                    <span className="gg-cs-note">
                      {p.sale_count} sale{p.sale_count === 1 ? "" : "s"}
                      {p.adjustment_count ? `, ${p.adjustment_count} adjustment${p.adjustment_count === 1 ? "" : "s"}` : ""}
                    </span>
                  </td>
                  <td>
                    {PAYOUT_METHODS[p.method] ?? p.method}
                    {p.reference && <span className="gg-cs-note">{p.reference}</span>}
                    {p.voided_at && <span className="gg-cs-note">Void: {p.void_reason}</span>}
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="download"
                      loading={busy === `s-${p.id}`}
                      disabled={busy !== null}
                      onClick={() =>
                        void run(`s-${p.id}`, async () => {
                          await adminDownload(consignmentAdminApi.statementUrl(p.id), `${label}-statement-${p.paid_at.slice(0, 10)}.pdf`);
                        })
                      }
                    >
                      Statement
                    </Button>
                    {!p.voided_at && (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busy === `v-${p.id}`}
                        disabled={busy !== null}
                        onClick={() => {
                          const reason = window.prompt("Why is this payout void? Its sales go back to settled. (Kept in the record.)");
                          if (!reason?.trim()) return;
                          void run(`v-${p.id}`, async () => {
                            await consignmentAdminApi.voidPayout(p.id, reason.trim());
                            return "Payout voided.";
                          });
                        }}
                      >
                        Void
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {adjustments.length > 0 && (
        <section aria-label="Adjustments" className="gg-lots-batch">
          <h4>Adjustments</h4>
          <ul className="gg-adj-list">
            {adjustments.map((a) => (
              <li key={a.id} className={a.voided_at ? "gg-adj--void" : undefined}>
                <span>
                  <strong>{money(a.amount_cents)}</strong> {ADJUSTMENT_LABELS[a.kind]}: {a.reason}
                  <span className="gg-cs-note">
                    {day(a.created_at)}
                    {a.created_by ? ` by ${a.created_by}` : ""}
                    {a.payout_id ? " · in a payout" : a.voided_at ? ` · void: ${a.void_reason}` : " · open"}
                  </span>
                </span>
                {!a.payout_id && !a.voided_at && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === `va-${a.id}`}
                    disabled={busy !== null}
                    onClick={() => {
                      const reason = window.prompt("Why is this adjustment void?");
                      if (!reason?.trim()) return;
                      void run(`va-${a.id}`, async () => {
                        await consignmentAdminApi.voidAdjustment(a.id, reason.trim());
                        return "Adjustment voided.";
                      });
                    }}
                  >
                    Void
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {adjusting && (
        <AdjustmentDialog
          consignmentId={consignmentId}
          sales={sales}
          cardName={cardName}
          onClose={() => setAdjusting(false)}
          onDone={() => {
            setAdjusting(false);
            void onChanged();
          }}
        />
      )}
      {settling && (
        <SettleDialog
          sale={settling}
          cardName={cardName(settling)}
          onClose={() => setSettling(null)}
          onDone={() => {
            setSettling(null);
            void onChanged();
          }}
        />
      )}
      {paying && (
        <PayoutDialog
          consignmentId={consignmentId}
          settled={settled}
          adjustments={openAdjustments}
          cardName={cardName}
          onClose={() => setPaying(false)}
          onDone={() => {
            setPaying(false);
            void onChanged();
          }}
        />
      )}
    </div>
  );
}
