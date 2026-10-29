import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { SelectField, TextArea, TextField } from "../../components/ui/Field";
import { useToast } from "../../hooks/useToast";
import { dollarsToCents } from "../../../store/lib/consignmentReceiving";
import { consignmentAdminApi, type ClaimRecord, type ConsignmentDetail, type LotRecord, type SaleRecord, type ShipmentRecord } from "./consignmentAdminApi";

// Packages holding this consignor's cards (website orders): what each was
// worth, whether additional insurance was needed under the consignor's
// election and what was bought (agreement 5.3, 5.6), and shipping claims for
// lost or damaged packages (5.4, 5.5).

const money = (c: number | null | undefined) => (c == null ? "—" : `$${(c / 100).toFixed(2)}`);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const centsText = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2));

const CLAIM_STATUS: Record<ClaimRecord["status"], string> = {
  open: "Open",
  filed: "Filed with carrier",
  approved: "Approved",
  denied: "Denied",
  paid: "Paid by carrier",
  closed: "Closed",
};

function InsuranceDialog({ shipment, onClose, onDone }: { shipment: ShipmentRecord; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState(centsText(shipment.insured_value_cents ?? shipment.declared_value_cents));
  const [premium, setPremium] = useState(centsText(shipment.insurance_premium_cents ?? shipment.estimated_premium_cents));
  const [source, setSource] = useState(shipment.insurance_source ?? "USPS");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title="Record insurance bought"
      size="sm"
      footer={
        <div className="gg-btn-row">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              const v = dollarsToCents(value);
              const p = dollarsToCents(premium);
              if (v == null || p == null || v === undefined || p === undefined) return setError("Enter the value insured and the premium paid in dollars.");
              setBusy(true);
              setError(null);
              try {
                await consignmentAdminApi.recordInsurance({ orderId: shipment.order_id, insuredValueCents: v, premiumCents: p, source: source.trim() });
                toast.success("Insurance recorded. Its cost is split across the package's cards when they settle.");
                onDone();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not record it.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </div>
      }
    >
      <p className="gg-muted">
        Package value {money(shipment.declared_value_cents)}; {money(shipment.included_coverage_cents)} is included with the service. Enter the actual premium
        charged. Only consignors who approved additional insurance pay their cards' share.
      </p>
      <TextField label="Value insured ($)" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
      <TextField label="Premium paid ($)" inputMode="decimal" value={premium} onChange={(e) => setPremium(e.target.value)} hint={shipment.estimated_premium_cents != null ? `Published rate: ${money(shipment.estimated_premium_cents)}` : undefined} />
      <TextField label="Bought from" maxLength={100} value={source} onChange={(e) => setSource(e.target.value)} />
      {error && (
        <p className="gg-field__error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

type PackageSale = ConsignmentDetail["orderSales"][number];

function ClaimDialog({ claim, sales, onClose, onDone }: { claim: ClaimRecord; sales: PackageSale[]; onClose: () => void; onDone: () => void }) {
  const cardName = (s: PackageSale) => s.cardName;
  const toast = useToast();
  const [mode, setMode] = useState<"update" | "close">("update");
  const [status, setStatus] = useState<Exclude<ClaimRecord["status"], "closed">>(claim.status === "closed" ? "paid" : claim.status);
  const [claimNumber, setClaimNumber] = useState(claim.claim_number ?? "");
  const [filedOn, setFiledOn] = useState(claim.filed_at?.slice(0, 10) ?? "");
  const [refund, setRefund] = useState(claim.customer_refund_status);
  const [paid, setPaid] = useState(centsText(claim.reimbursement_cents));
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState<"carrier_loss" | "our_responsibility">("carrier_loss");
  const [alloc, setAlloc] = useState<Record<string, { pay: string; returned: boolean }>>(() =>
    Object.fromEntries(sales.map((s) => [s.id, { pay: "", returned: false }])),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "update") {
        const reimbursement = paid.trim() ? dollarsToCents(paid) : null;
        if (reimbursement === undefined) throw new Error("Enter what the carrier paid in dollars.");
        await consignmentAdminApi.updateClaim({
          claimId: claim.id,
          status,
          claimNumber: claimNumber.trim(),
          filedAt: filedOn ? new Date(`${filedOn}T12:00:00`).toISOString() : null,
          customerRefundStatus: refund,
          reimbursementCents: reimbursement,
          reimbursedAt: reimbursement ? new Date().toISOString() : null,
          notes: notes.trim(),
        });
        toast.success("Claim updated.");
      } else {
        if (!notes.trim()) throw new Error("Note how the claim ended.");
        const allocations = sales.map((s) => {
          const c = alloc[s.id]?.pay.trim() ? dollarsToCents(alloc[s.id].pay) : 0;
          if (c === undefined) throw new Error(`Enter ${cardName(s)}'s claim payment in dollars.`);
          return { saleId: s.id, claimPaymentCents: c ?? 0, returnedDamaged: alloc[s.id]?.returned ?? false };
        });
        await consignmentAdminApi.closeClaim({ claimId: claim.id, outcome, allocations: outcome === "carrier_loss" ? allocations : undefined, note: notes.trim() });
        toast.success("Claim closed.");
      }
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
      title={`Shipping claim: package ${claim.kind}`}
      size="lg"
      footer={
        <div className="gg-btn-row">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={mode === "close" ? "danger" : "primary"} loading={busy} onClick={() => void save()}>
            {mode === "close" ? "Close claim" : "Save"}
          </Button>
        </div>
      }
    >
      <p className="gg-muted">
        {claim.carrier ?? "Carrier"} {claim.tracking_number ?? ""} · package {money(claim.shipment_value_cents)} · insured{" "}
        {claim.insured_value_cents != null ? `${money(claim.insured_value_cents)} (premium ${money(claim.insurance_premium_cents)})` : "not recorded"} · consignor
        insurance election {claim.insurance_elected_summary ?? "—"}
      </p>
      <div className="gg-btn-row" role="radiogroup" aria-label="What to do">
        <Button size="sm" role="radio" aria-checked={mode === "update"} variant={mode === "update" ? "primary" : "secondary"} onClick={() => setMode("update")}>
          Update
        </Button>
        <Button size="sm" role="radio" aria-checked={mode === "close"} variant={mode === "close" ? "primary" : "secondary"} onClick={() => setMode("close")}>
          Close with outcome
        </Button>
      </div>
      {mode === "update" ? (
        <>
          <div className="gg-cs-row">
            <SelectField label="Claim status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              {(["open", "filed", "approved", "denied", "paid"] as const).map((s) => (
                <option key={s} value={s}>
                  {CLAIM_STATUS[s]}
                </option>
              ))}
            </SelectField>
            <TextField label="Claim number" maxLength={100} value={claimNumber} onChange={(e) => setClaimNumber(e.target.value)} />
            <TextField label="Filed on" type="date" value={filedOn} onChange={(e) => setFiledOn(e.target.value)} />
          </div>
          <div className="gg-cs-row">
            <SelectField label="Buyer refund" value={refund} onChange={(e) => setRefund(e.target.value as ClaimRecord["customer_refund_status"])}>
              <option value="none">Not refunded</option>
              <option value="pending">Refund pending</option>
              <option value="refunded">Refunded</option>
            </SelectField>
            <TextField label="Carrier paid ($)" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} />
          </div>
        </>
      ) : (
        <>
          <SelectField label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
            <option value="carrier_loss">Carrier loss (agreement 5.4): sales reversed, claim money settled as the sale</option>
            <option value="our_responsibility">Our responsibility (5.5): the consignor is paid as if it sold</option>
          </SelectField>
          {outcome === "our_responsibility" ? (
            <p className="gg-muted">
              For our own negligence: wrong address, poor packaging, insurance the consignor approved but we didn't buy, or a claim not filed in time. The
              sales stay and can be settled now.
            </p>
          ) : (
            <table className="gg-cs-table">
              <thead>
                <tr>
                  <th scope="col">Card</th>
                  <th scope="col">Sold for</th>
                  <th scope="col">Claim payment for it ($)</th>
                  <th scope="col">Came back damaged</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id}>
                    <td>{cardName(s)}</td>
                    <td>{money(s.gross_cents)}</td>
                    <td>
                      <input
                        className="gg-input gg-rc-num"
                        inputMode="decimal"
                        aria-label={`Claim payment for ${cardName(s)}`}
                        value={alloc[s.id]?.pay ?? ""}
                        onChange={(e) => setAlloc((a) => ({ ...a, [s.id]: { ...a[s.id], pay: e.target.value } }))}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${cardName(s)} came back damaged`}
                        checked={alloc[s.id]?.returned ?? false}
                        onChange={(e) => setAlloc((a) => ({ ...a, [s.id]: { ...a[s.id], returned: e.target.checked } }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      <TextArea label={mode === "close" ? "How it ended (kept with the claim)" : "Note"} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      {error && (
        <p className="gg-field__error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

export function ConsignmentShipmentsPanel({
  detail,
  lots,
  onChanged,
}: {
  detail: Pick<ConsignmentDetail, "orders" | "shipments" | "claims" | "sales" | "orderSales">;
  lots: LotRecord[];
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [insuring, setInsuring] = useState<ShipmentRecord | null>(null);
  const [claiming, setClaiming] = useState<ClaimRecord | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const cardName = (s: SaleRecord) => lotById.get(s.lot_id)?.card_name ?? "Card";
  const shipmentByOrder = new Map(detail.shipments.map((s) => [s.order_id, s]));
  const orders = [...detail.orders].sort((a, b) => (b.shipped_at ?? "").localeCompare(a.shipped_at ?? ""));
  if (orders.length === 0) return null;

  return (
    <div className="gg-lots">
      <div className="gg-rc-table-wrap">
        <table className="gg-cs-table gg-rc-table">
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Shipment</th>
              <th scope="col">Insurance</th>
              <th scope="col">Claim</th>
              <th scope="col">
                <span className="gg-visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const sh = shipmentByOrder.get(o.id);
              const claim = detail.claims.find((c) => c.order_id === o.id && c.status !== "closed") ?? detail.claims.find((c) => c.order_id === o.id);
              const sales = detail.sales.filter((s) => s.order_id === o.id && s.status !== "cancelled");
              return (
                <tr key={o.id}>
                  <td data-label="Order">
                    <strong>#{o.id.slice(0, 8)}</strong>
                    <span className="gg-cs-note">{detail.sales.filter((s) => s.order_id === o.id).map(cardName).join(", ")}</span>
                  </td>
                  <td data-label="Shipment">
                    {o.shipped_at ? `Shipped ${day(o.shipped_at)}` : "Not shipped"}
                    <span className="gg-cs-note">
                      {[o.tracking_carrier, o.shipping_service, o.tracking_number].filter(Boolean).join(" · ") || "—"}
                      {o.delivered_at ? ` · delivered ${day(o.delivered_at)}` : ""}
                    </span>
                  </td>
                  <td data-label="Insurance">
                    {sh ? (
                      <>
                        {sh.insurance_premium_cents != null ? (
                          <Badge tone="success">Bought {money(sh.insurance_premium_cents)}</Badge>
                        ) : sh.insurance_needed ? (
                          <Badge tone="danger">Needed</Badge>
                        ) : (
                          <Badge tone="neutral">Included only</Badge>
                        )}
                        <span className="gg-cs-note">
                          value {money(sh.declared_value_cents)}
                          {sh.insurance_needed && sh.estimated_premium_cents != null && sh.insurance_premium_cents == null ? ` · about ${money(sh.estimated_premium_cents)}` : ""}
                          {sh.over_limit ? " · over the USPS limit: review" : ""}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td data-label="Claim">
                    {claim ? (
                      <>
                        {CLAIM_STATUS[claim.status]} ({claim.kind})
                        <span className="gg-cs-note">
                          {claim.claim_number ? `#${claim.claim_number}` : "no claim number yet"}
                          {claim.outcome ? ` · ${claim.outcome === "carrier_loss" ? "carrier loss" : "our responsibility"}` : ""}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <div className="gg-btn-row">
                      {sh && (sh.insurance_needed || sh.insurance_premium_cents != null) && (
                        <Button size="sm" variant={sh.insurance_premium_cents == null ? "primary" : "ghost"} disabled={busy !== null} onClick={() => setInsuring(sh)}>
                          {sh.insurance_premium_cents == null ? "Record insurance" : "Edit insurance"}
                        </Button>
                      )}
                      {claim && claim.status !== "closed" ? (
                        <Button size="sm" disabled={busy !== null} onClick={() => setClaiming(claim)}>
                          Manage claim
                        </Button>
                      ) : (
                        o.shipped_at &&
                        sales.length > 0 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={busy === `c-${o.id}`}
                            disabled={busy !== null}
                            onClick={() => {
                              const kind = window.prompt("Lost or damaged? (type lost or damaged)", "lost")?.trim().toLowerCase();
                              if (kind !== "lost" && kind !== "damaged") return;
                              setBusy(`c-${o.id}`);
                              consignmentAdminApi
                                .openClaim(o.id, kind, "")
                                .then(async () => {
                                  toast.success("Claim opened. The consignor's sales in this package are on hold until it's resolved.");
                                  await onChanged();
                                })
                                .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Could not open the claim."))
                                .finally(() => setBusy(null));
                            }}
                          >
                            Report lost or damaged
                          </Button>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {insuring && (
        <InsuranceDialog
          shipment={insuring}
          onClose={() => setInsuring(null)}
          onDone={() => {
            setInsuring(null);
            void onChanged();
          }}
        />
      )}
      {claiming && (
        <ClaimDialog
          claim={claiming}
          sales={detail.orderSales.filter((s) => s.order_id === claiming.order_id && s.status !== "cancelled")}
          onClose={() => setClaiming(null)}
          onDone={() => {
            setClaiming(null);
            void onChanged();
          }}
        />
      )}
    </div>
  );
}
