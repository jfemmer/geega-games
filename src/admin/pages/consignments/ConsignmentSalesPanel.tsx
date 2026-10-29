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
import {
  consignmentAdminApi,
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

function saleState(s: SaleRecord, now: number): { label: string; tone: BadgeTone } {
  if (s.status === "cancelled") return { label: "Cancelled", tone: "neutral" };
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

function PayoutDialog({ consignmentId, settled, cardName, onClose, onDone }: { consignmentId: string; settled: SaleRecord[]; cardName: (s: SaleRecord) => string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(settled.map((s) => s.id)));
  const [method, setMethod] = useState("paypal");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total = settled.filter((s) => picked.has(s.id)).reduce((n, s) => n + (s.payout_cents ?? 0), 0);

  async function save() {
    if (picked.size === 0) return setError("Choose the sales this payout covers.");
    setBusy(true);
    setError(null);
    try {
      await consignmentAdminApi.recordPayout({
        consignmentId,
        saleIds: [...picked],
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

export function ConsignmentSalesPanel({
  consignmentId,
  sales,
  payouts,
  lots,
  onChanged,
}: {
  consignmentId: string;
  sales: SaleRecord[];
  payouts: PayoutRecord[];
  lots: LotRecord[];
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [settling, setSettling] = useState<SaleRecord | null>(null);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const cardName = (s: SaleRecord) => lotById.get(s.lot_id)?.card_name ?? "Card";
  const settled = sales.filter((s) => s.status === "settled");
  const owed = settled.reduce((n, s) => n + (s.payout_cents ?? 0), 0);
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

  if (sales.length === 0 && payouts.length === 0) {
    return <p className="gg-muted">No sales yet. Website sales appear here when an order is paid; record TCGplayer and eBay sales from Cards.</p>;
  }

  return (
    <div className="gg-lots">
      <div className="gg-btn-row gg-lots-summary">
        <span>
          {sales.filter((s) => s.status !== "cancelled").length} sales · {money(owed)} settled and owed · {money(paid)} paid out
        </span>
        {settled.length > 0 && (
          <Button size="sm" variant="primary" icon="dollar" onClick={() => setPaying(true)}>
            Record a payout
          </Button>
        )}
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
              const state = saleState(s, now);
              const ready = s.status === "open" && s.delivered_at && s.payable_at && new Date(s.payable_at).getTime() <= now;
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
                  </td>
                  <td data-label="Price">
                    {s.quantity} × {money(s.unit_price_cents)}
                  </td>
                  <td data-label="Status">
                    <Badge tone={state.tone}>{state.label}</Badge>
                    {s.cancel_reason && <span className="gg-cs-note">{s.cancel_reason}{s.restocked ? " · put back on sale" : ""}</span>}
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
                    </span>
                  </td>
                  <td>
                    {PAYOUT_METHODS[p.method] ?? p.method}
                    {p.reference && <span className="gg-cs-note">{p.reference}</span>}
                    {p.voided_at && <span className="gg-cs-note">Void: {p.void_reason}</span>}
                  </td>
                  <td>
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
