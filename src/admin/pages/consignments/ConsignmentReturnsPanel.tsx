import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { TextArea, TextField } from "../../components/ui/Field";
import { useToast } from "../../hooks/useToast";
import type { BadgeTone } from "../../utils/labels";
import { dollarsToCents } from "../../../store/lib/consignmentReceiving";
import {
  RETURN_STATUS_LABELS,
  consignmentAdminApi,
  type LotQuantities,
  type LotRecord,
  type ReturnRecord,
  type ReturnStatus,
} from "./consignmentAdminApi";

// Returning cards to the consignor (agreement 7.4): a return is requested by
// the consignor in their account or by staff, approved (its cards come off
// sale; anything sold or in a checkout stays with its sale), the return
// shipping is quoted and paid (or waived), it ships tracked, and is
// delivered. A consignment closes once nothing is left with us.

const money = (c: number | null | undefined) => (c == null ? "—" : `$${(c / 100).toFixed(2)}`);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

const TONE: Record<ReturnStatus, BadgeTone> = {
  requested: "warning",
  removed_from_sale: "info",
  awaiting_shipping_payment: "warning",
  ready_to_ship: "purple",
  shipped: "info",
  delivered: "success",
  cancelled: "neutral",
};

function StartReturnDialog({
  consignmentId,
  lots,
  quantities,
  onClose,
  onDone,
}: {
  consignmentId: string;
  lots: LotRecord[];
  quantities: LotQuantities[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const q = new Map(quantities.map((x) => [x.lot_id, x]));
  // What can go back now: unsold accepted copies (unlisted or on the website)
  // and declined copies not yet returned.
  const rows = lots
    .map((l) => {
      const x = q.get(l.id);
      const accepted = x ? x.unlisted + x.on_sale : 0;
      const rejected = x ? Math.max(x.rejected - x.returning_rejected, 0) : 0;
      return { lot: l, accepted, rejected };
    })
    .filter((r) => r.accepted + r.rejected > 0);
  const [pick, setPick] = useState<Record<string, { accepted: string; rejected: string }>>(() =>
    Object.fromEntries(rows.map((r) => [r.lot.id, { accepted: String(r.accepted), rejected: String(r.rejected) }])),
  );
  const [ends, setEnds] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const lines: { lotId: string; pool: "accepted" | "rejected"; quantity: number }[] = [];
    for (const r of rows) {
      for (const pool of ["accepted", "rejected"] as const) {
        const v = pick[r.lot.id]?.[pool] ?? "0";
        const n = Number(v || 0);
        if (!Number.isInteger(n) || n < 0 || n > r[pool]) return setError(`${r.lot.card_name}: at most ${r[pool]} ${pool === "accepted" ? "unsold" : "declined"} copies.`);
        if (n > 0) lines.push({ lotId: r.lot.id, pool, quantity: n });
      }
    }
    if (lines.length === 0 && !ends) return setError("Choose at least one card.");
    setBusy(true);
    setError(null);
    try {
      await consignmentAdminApi.requestReturn({ consignmentId, lines, endsConsignment: ends, note: note.trim() });
      toast.success("Return started. Approve it to take the cards off sale.");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the return.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Return cards to the consignor"
      size="lg"
      footer={
        <div className="gg-btn-row">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Start return
          </Button>
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="gg-muted">Nothing can go back right now: every card is sold or committed to a sale.</p>
      ) : (
        <table className="gg-cs-table">
          <thead>
            <tr>
              <th scope="col">Card</th>
              <th scope="col">Unsold copies</th>
              <th scope="col">Declined copies</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.lot.id}>
                <td>{r.lot.card_name}</td>
                <td>
                  {r.accepted > 0 ? (
                    <input
                      className="gg-input gg-rc-num"
                      inputMode="numeric"
                      aria-label={`Unsold copies of ${r.lot.card_name} to return`}
                      value={pick[r.lot.id]?.accepted ?? ""}
                      onChange={(e) => setPick((p) => ({ ...p, [r.lot.id]: { ...p[r.lot.id], accepted: e.target.value } }))}
                    />
                  ) : (
                    "—"
                  )}
                  {r.accepted > 0 && <span className="gg-cs-note">of {r.accepted}</span>}
                </td>
                <td>
                  {r.rejected > 0 ? (
                    <input
                      className="gg-input gg-rc-num"
                      inputMode="numeric"
                      aria-label={`Declined copies of ${r.lot.card_name} to return`}
                      value={pick[r.lot.id]?.rejected ?? ""}
                      onChange={(e) => setPick((p) => ({ ...p, [r.lot.id]: { ...p[r.lot.id], rejected: e.target.value } }))}
                    />
                  ) : (
                    "—"
                  )}
                  {r.rejected > 0 && <span className="gg-cs-note">of {r.rejected}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <label className="gg-cs-check">
        <input type="checkbox" checked={ends} onChange={(e) => setEnds(e.target.checked)} />
        This ends the consignment (agreement 7.3). Sales already made are still settled.
      </label>
      <TextArea label="Note (internal)" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      {error && (
        <p className="gg-field__error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

function ShipDialog({ ret, onClose, onDone }: { ret: ReturnRecord; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [carrier, setCarrier] = useState("USPS");
  const [tracking, setTracking] = useState("");
  const [insured, setInsured] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Ship return #${ret.return_number}`}
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
              if (!carrier.trim() || !tracking.trim()) return setError("Returns ship tracked: enter the carrier and tracking number.");
              const ins = insured.trim() ? dollarsToCents(insured) : null;
              if (ins === undefined) return setError("Enter the insured value in dollars.");
              setBusy(true);
              setError(null);
              try {
                await consignmentAdminApi.advanceReturn({ returnId: ret.id, step: "ship", carrier: carrier.trim(), trackingNumber: tracking.trim(), insuredValueCents: ins });
                toast.success("Marked shipped. Email the consignor the tracking number.");
                onDone();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not mark it shipped.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Mark shipped
          </Button>
        </div>
      }
    >
      <TextField label="Carrier" maxLength={60} value={carrier} onChange={(e) => setCarrier(e.target.value)} />
      <TextField label="Tracking number" maxLength={60} value={tracking} onChange={(e) => setTracking(e.target.value)} />
      <TextField
        label="Insured for ($)"
        inputMode="decimal"
        value={insured}
        onChange={(e) => setInsured(e.target.value)}
        hint="Insured for the cards' value unless the consignor said in writing not to (7.4(4))."
      />
      {error && (
        <p className="gg-field__error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

export function ConsignmentReturnsPanel({
  consignmentId,
  status,
  returns,
  lots,
  quantities,
  onChanged,
}: {
  consignmentId: string;
  status: string;
  returns: ReturnRecord[];
  lots: LotRecord[];
  quantities: LotQuantities[];
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [starting, setStarting] = useState(false);
  const [shipping, setShipping] = useState<ReturnRecord | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const pending = returns.some((r) => r.status === "requested");

  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key);
    try {
      toast.success(await fn());
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="gg-lots">
      <div className="gg-btn-row gg-lots-summary">
        <span>{returns.length === 0 ? "No returns yet." : `${returns.length} return${returns.length === 1 ? "" : "s"}`}</span>
        <div className="gg-btn-row">
          {status !== "closed" && !pending && (
            <Button size="sm" onClick={() => setStarting(true)}>
              Return cards
            </Button>
          )}
          {status !== "closed" && (
            <Button
              size="sm"
              variant="ghost"
              loading={busy === "close"}
              disabled={busy !== null}
              onClick={() => {
                if (!window.confirm("Close this consignment? Only possible once every card is sold or returned and everything is paid.")) return;
                void run("close", async () => {
                  await consignmentAdminApi.closeConsignment(consignmentId);
                  return "Consignment closed.";
                });
              }}
            >
              Close consignment
            </Button>
          )}
        </div>
      </div>
      {returns.map((r) => (
        <section key={r.id} className="gg-lots-batch" aria-label={`Return ${r.return_number}`}>
          <h4>
            Return #{r.return_number} <Badge tone={TONE[r.status]}>{RETURN_STATUS_LABELS[r.status]}</Badge>
            <span className="gg-cs-note">
              Requested by {r.requested_by === "consignor" ? "the consignor" : "staff"} {day(r.requested_at)}
              {r.ends_consignment ? " · ends the consignment" : ""}
              {r.shipping_cost_cents != null ? ` · shipping ${r.we_pay_shipping ? "paid by us" : money(r.shipping_cost_cents)}` : ""}
              {r.tracking_number ? ` · ${r.carrier ?? ""} ${r.tracking_number}` : ""}
              {r.delivered_at ? ` · delivered ${day(r.delivered_at)}` : ""}
            </span>
          </h4>
          <ul className="gg-adj-list">
            {r.lines.map((l) => (
              <li key={l.id}>
                {l.quantity} × {lotById.get(l.lot_id)?.card_name ?? "Card"}
                {l.pool === "rejected" ? " (declined copies)" : ""}
              </li>
            ))}
          </ul>
          {r.note && <p className="gg-cs-note gg-cn-pre">{r.note}</p>}
          <div className="gg-btn-row">
            {r.status === "requested" && (
              <Button size="sm" variant="primary" loading={busy === `a-${r.id}`} disabled={busy !== null} onClick={() => void run(`a-${r.id}`, async () => {
                await consignmentAdminApi.approveReturn(r.id);
                return "Approved. Its cards are off sale.";
              })}>
                Approve and take off sale
              </Button>
            )}
            {(r.status === "removed_from_sale" || r.status === "awaiting_shipping_payment") && (
              <Button
                size="sm"
                loading={busy === `q-${r.id}`}
                disabled={busy !== null}
                onClick={() => {
                  const input = window.prompt("Return shipping cost the consignor pays, in dollars (0 or blank if we pay it):", r.shipping_cost_cents != null ? (r.shipping_cost_cents / 100).toFixed(2) : "");
                  if (input === null) return;
                  const c = input.trim() ? dollarsToCents(input) : 0;
                  if (c == null || c === undefined) return toast.error("Enter a dollar amount.");
                  const wePay = c === 0;
                  void run(`q-${r.id}`, async () => {
                    await consignmentAdminApi.advanceReturn({ returnId: r.id, step: "quote", shippingCostCents: c, wePay });
                    return wePay ? "Ready to ship." : "Send the consignor the shipping cost; mark it paid when it arrives.";
                  });
                }}
              >
                {r.status === "removed_from_sale" ? "Set return shipping" : "Change shipping cost"}
              </Button>
            )}
            {r.status === "awaiting_shipping_payment" && (
              <Button size="sm" loading={busy === `p-${r.id}`} disabled={busy !== null} onClick={() => void run(`p-${r.id}`, async () => {
                await consignmentAdminApi.advanceReturn({ returnId: r.id, step: "paid" });
                return "Shipping paid. Ready to ship.";
              })}>
                Shipping paid
              </Button>
            )}
            {r.status === "ready_to_ship" && (
              <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => setShipping(r)}>
                Ship return
              </Button>
            )}
            {r.status === "shipped" && (
              <Button size="sm" loading={busy === `d-${r.id}`} disabled={busy !== null} onClick={() => void run(`d-${r.id}`, async () => {
                await consignmentAdminApi.advanceReturn({ returnId: r.id, step: "delivered" });
                return "Marked delivered.";
              })}>
                Mark delivered
              </Button>
            )}
            {!["shipped", "delivered", "cancelled"].includes(r.status) && (
              <Button
                size="sm"
                variant="ghost"
                loading={busy === `x-${r.id}`}
                disabled={busy !== null}
                onClick={() => {
                  const reason = window.prompt("Why is this return cancelled? Cards taken off sale stay unlisted until you list them again.");
                  if (!reason?.trim()) return;
                  void run(`x-${r.id}`, async () => {
                    await consignmentAdminApi.cancelReturn(r.id, reason.trim());
                    return "Return cancelled.";
                  });
                }}
              >
                Cancel return
              </Button>
            )}
          </div>
        </section>
      ))}
      {starting && (
        <StartReturnDialog
          consignmentId={consignmentId}
          lots={lots}
          quantities={quantities}
          onClose={() => setStarting(false)}
          onDone={() => {
            setStarting(false);
            void onChanged();
          }}
        />
      )}
      {shipping && (
        <ShipDialog
          ret={shipping}
          onClose={() => setShipping(null)}
          onDone={() => {
            setShipping(null);
            void onChanged();
          }}
        />
      )}
    </div>
  );
}
