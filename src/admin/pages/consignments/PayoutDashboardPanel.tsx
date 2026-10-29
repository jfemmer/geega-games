import { useCallback, useEffect, useMemo, useState } from "react";
import { SectionCard } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { ErrorState, Spinner } from "../../components/ui/States";
import { useToast } from "../../hooks/useToast";
import { adminDownload } from "../../repositories/apiClient";
import type { BadgeTone } from "../../utils/labels";
import { CHANNEL_LABELS } from "../../../store/lib/consignmentMath";
import { consignmentAdminApi, type PayoutDashboardSale } from "./consignmentAdminApi";

// The payout dashboard (spec part 12): every unpaid consigned sale across all
// consignors with its money columns, delivery, the end of the buyer's
// inspection period and the payout due date, filtered by what needs doing.
// Settle and pay from the consignment itself.

const money = (c: number | null | undefined) => (c == null ? "—" : `$${(c / 100).toFixed(2)}`);
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

type Filter = "due" | "settle" | "inspection" | "shipping" | "held" | "all";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "due", label: "Due to pay" },
  { key: "settle", label: "Ready to settle" },
  { key: "inspection", label: "In inspection" },
  { key: "shipping", label: "Not delivered" },
  { key: "held", label: "On hold" },
  { key: "all", label: "All unpaid" },
];

function stage(s: PayoutDashboardSale, now: number): { key: Exclude<Filter, "all">; label: string; tone: BadgeTone } {
  if (s.holdReason) return { key: "held", label: "On hold", tone: "danger" };
  if (s.status === "settled") return { key: "due", label: "Settled: pay", tone: "gold" };
  if (!s.delivered_at) return { key: "shipping", label: s.shipped_at ? "Shipped" : "Not shipped", tone: "info" };
  if (s.payable_at && Date.parse(s.payable_at) > now) return { key: "inspection", label: "Inspection", tone: "warning" };
  if (s.channel !== "website" && !s.funds_released_at) return { key: "settle", label: "Waiting on funds", tone: "warning" };
  return { key: "settle", label: "Ready to settle", tone: "purple" };
}

export function PayoutDashboardPanel({ onOpen }: { onOpen: (consignmentId: string) => void }) {
  const toast = useToast();
  const [data, setData] = useState<Awaited<ReturnType<typeof consignmentAdminApi.payoutDashboard>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("due");
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await consignmentAdminApi.payoutDashboard());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load payouts.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => (data?.sales ?? []).map((s) => ({ s, st: stage(s, now) })), [data, now]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { due: 0, settle: 0, inspection: 0, shipping: 0, held: 0, all: rows.length };
    for (const r of rows) c[r.st.key] += 1;
    return c;
  }, [rows]);
  const shown = rows.filter((r) => filter === "all" || r.st.key === filter);
  const dueTotal = rows.filter((r) => r.st.key === "due").reduce((n, r) => n + (r.s.payout_cents ?? 0), 0);

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) return <Spinner label="Loading payouts" />;

  return (
    <>
      <SectionCard title="Payouts" action={<span className="gg-muted">{money(dueTotal)} settled and due</span>}>
        <div className="gg-btn-row" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <Button key={f.key} size="sm" variant={filter === f.key ? "primary" : "secondary"} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label} ({counts[f.key]})
            </Button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="gg-muted">Nothing here.</p>
        ) : (
          <div className="gg-rc-table-wrap">
            <table className="gg-cs-table gg-rc-table gg-payout-table">
              <thead>
                <tr>
                  <th scope="col">Consignor</th>
                  <th scope="col">Card</th>
                  <th scope="col">Sold</th>
                  <th scope="col">Gross</th>
                  <th scope="col">Platform</th>
                  <th scope="col">Processing</th>
                  <th scope="col">Shipping</th>
                  <th scope="col">Insurance</th>
                  <th scope="col">Commission</th>
                  <th scope="col">Payout</th>
                  <th scope="col">Delivered</th>
                  <th scope="col">Inspection ends</th>
                  <th scope="col">Due</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ s, st }) => (
                  <tr key={s.id}>
                    <td data-label="Consignor">
                      <button type="button" className="gg-linklike" onClick={() => onOpen(s.consignment_id)}>
                        {s.consignorName}
                      </button>
                      <span className="gg-cs-note">{s.consignmentLabel}</span>
                    </td>
                    <td data-label="Card">
                      {s.cardName}
                      <span className="gg-cs-note">
                        {CHANNEL_LABELS[s.channel]}
                        {s.quantity > 1 ? ` · ${s.quantity} × ${money(s.unit_price_cents)}` : ""}
                      </span>
                    </td>
                    <td data-label="Sold">{day(s.sold_at)}</td>
                    <td data-label="Gross">{money(s.gross_cents)}</td>
                    <td data-label="Platform">{money(s.marketplace_fee_cents)}</td>
                    <td data-label="Processing">{money(s.processing_fee_cents)}</td>
                    <td data-label="Shipping">{money(s.postage_cents)}</td>
                    <td data-label="Insurance">{money(s.insurance_cents)}</td>
                    <td data-label="Commission">{money(s.commission_cents)}</td>
                    <td data-label="Payout">
                      <strong>{money(s.payout_cents)}</strong>
                      {s.status !== "settled" && <span className="gg-cs-note">estimate after settling</span>}
                    </td>
                    <td data-label="Delivered">{day(s.delivered_at)}</td>
                    <td data-label="Inspection ends">{s.payable_at ? day(new Date(Date.parse(s.payable_at) - 60_000).toISOString()) : "—"}</td>
                    <td data-label="Due">{s.payout_due_on ? day(`${s.payout_due_on}T12:00:00`) : "—"}</td>
                    <td data-label="Status">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {s.holdReason && <span className="gg-cs-note">{s.holdReason}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Recent payouts">
        {data.payouts.length === 0 ? (
          <p className="gg-muted">No payouts recorded yet.</p>
        ) : (
          <table className="gg-cs-table">
            <thead>
              <tr>
                <th scope="col">Paid</th>
                <th scope="col">Consignor</th>
                <th scope="col">Amount</th>
                <th scope="col">
                  <span className="gg-visually-hidden">Statement</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.payouts.map((p) => (
                <tr key={p.id}>
                  <td>{day(p.paid_at)}</td>
                  <td>
                    {p.consignorName}
                    <span className="gg-cs-note">{p.consignmentLabel}</span>
                  </td>
                  <td>
                    {p.voided_at ? <s>{money(p.amount_cents)}</s> : money(p.amount_cents)}
                    <span className="gg-cs-note">{p.method}{p.reference ? ` · ${p.reference}` : ""}</span>
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="download"
                      onClick={() =>
                        void adminDownload(consignmentAdminApi.statementUrl(p.id), `${p.consignmentLabel}-statement-${p.paid_at.slice(0, 10)}.pdf`).catch((e: unknown) =>
                          toast.error(e instanceof Error ? e.message : "Could not download it."),
                        )
                      }
                    >
                      Statement
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </>
  );
}
