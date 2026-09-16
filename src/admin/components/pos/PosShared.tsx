import { useState, type FormEvent } from "react";
import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import { formatCents } from "../../utils/format";
import type { PosSaleResult } from "../../types";
import type { usePosTerminal } from "../../hooks/usePosTerminal";
import type { Reader } from "@stripe/terminal-js";

// Shared between PosPage (the register) and PickupRequestsPage ("collect
// payment" once a pickup request has been pulled and converted into a real
// order via pos_complete_pickup_sale) — one payment/receipt implementation
// for cash + Stripe Terminal, not two copies that could drift apart.

export function PosTotals({
  subtotalCents,
  taxCents,
  totalCents,
}: {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}) {
  return (
    <div className="gg-pos__totals">
      <div className="gg-pos__totals-row">
        <span>Subtotal</span>
        <span>{formatCents(subtotalCents)}</span>
      </div>
      {taxCents > 0 && (
        <div className="gg-pos__totals-row">
          <span>Tax</span>
          <span>{formatCents(taxCents)}</span>
        </div>
      )}
      <div className="gg-pos__totals-row gg-pos__totals-row--strong">
        <span>Total</span>
        <span>{formatCents(totalCents)}</span>
      </div>
    </div>
  );
}

export function PosPaymentStep({
  sale,
  paymentMethod,
  setPaymentMethod,
  cashTendered,
  setCashTendered,
  onPayCash,
  onPayCard,
  terminal,
  onVoid,
  voidLabel = "Void sale",
}: {
  sale: PosSaleResult;
  paymentMethod: "cash" | "card" | null;
  setPaymentMethod: (m: "cash" | "card" | null) => void;
  cashTendered: string;
  setCashTendered: (v: string) => void;
  onPayCash: () => void;
  onPayCard: () => void;
  terminal: ReturnType<typeof usePosTerminal>;
  onVoid: () => void;
  voidLabel?: string;
}) {
  const tenderedCents = Math.round(parseFloat(cashTendered || "0") * 100);
  const changeCents = Number.isFinite(tenderedCents) ? tenderedCents - sale.amountDueCents : 0;

  return (
    <div className="gg-pos__payment">
      <PosTotals subtotalCents={sale.subtotalCents} taxCents={sale.taxCents} totalCents={sale.totalCents} />

      {!paymentMethod && (
        <div className="gg-pos__payment-methods">
          <Button variant="primary" size="md" onClick={() => setPaymentMethod("cash")}>
            Cash
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              setPaymentMethod("card");
              terminal.discoverReaders();
            }}
          >
            Card (Terminal)
          </Button>
        </div>
      )}

      {paymentMethod === "cash" && (
        <form
          className="gg-pos__cash"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            onPayCash();
          }}
        >
          <TextField
            label="Cash tendered"
            type="number"
            step="0.01"
            min="0"
            value={cashTendered}
            onChange={(e) => setCashTendered(e.target.value)}
            autoFocus
          />
          {cashTendered && (
            <p className={changeCents >= 0 ? "gg-muted" : "gg-inline-note gg-inline-note--warning"}>
              {changeCents >= 0
                ? `Change due: ${formatCents(changeCents)}`
                : `Short ${formatCents(-changeCents)}`}
            </p>
          )}
          <div className="gg-pos__payment-actions">
            <Button type="button" variant="ghost" onClick={() => setPaymentMethod(null)}>
              Back
            </Button>
            <Button type="submit" variant="primary" disabled={changeCents < 0}>
              Complete cash sale
            </Button>
          </div>
        </form>
      )}

      {paymentMethod === "card" && (
        <div className="gg-pos__card">
          {terminal.connection !== "connected" ? (
            <>
              <p className="gg-muted">
                {terminal.busy ? "Looking for a reader…" : "Connect the register's card reader."}
              </p>
              {terminal.error && (
                <div className="gg-inline-note gg-inline-note--warning" role="alert">
                  {terminal.error}
                </div>
              )}
              {terminal.readers.map((r: Reader) => (
                <Button
                  key={r.id}
                  variant="secondary"
                  size="sm"
                  loading={terminal.busy}
                  onClick={() => terminal.connectReader(r)}
                >
                  Connect {r.label || r.id}
                </Button>
              ))}
              <Button variant="ghost" size="sm" loading={terminal.busy} onClick={() => terminal.discoverReaders()}>
                Search again
              </Button>
            </>
          ) : (
            <p className="gg-muted">Reader connected. Ready to charge {formatCents(sale.amountDueCents)}.</p>
          )}
          <div className="gg-pos__payment-actions">
            <Button variant="ghost" onClick={() => setPaymentMethod(null)}>
              Back
            </Button>
            <Button variant="primary" disabled={terminal.connection !== "connected"} onClick={onPayCard}>
              Charge card
            </Button>
          </div>
        </div>
      )}

      <Button variant="ghost" size="sm" className="gg-pos__void" onClick={onVoid}>
        {voidLabel}
      </Button>
    </div>
  );
}

export type PosReceiptLine = {
  id: string;
  name: string;
  quantity: number;
  lineTotalCents: number;
};

export function PosReceipt({
  sale,
  lines,
  customerLabel,
  paidVia,
  changeCents,
  onNewSale,
  newSaleLabel = "New sale",
}: {
  sale: PosSaleResult;
  lines: PosReceiptLine[];
  customerLabel: string;
  paidVia: "cash" | "card" | null;
  changeCents: number | null;
  onNewSale: () => void;
  newSaleLabel?: string;
}) {
  return (
    <div className="gg-pos__receipt">
      <h3>Sale complete</h3>
      <p className="gg-muted">Order #{sale.orderId.slice(0, 8).toUpperCase()}</p>
      <p className="gg-muted">{customerLabel}</p>
      <div className="gg-pos__lines">
        {lines.map((line) => (
          <div className="gg-pos__line" key={line.id}>
            <span className="gg-pos__line-name">
              {line.name} × {line.quantity}
            </span>
            <span>{formatCents(line.lineTotalCents)}</span>
          </div>
        ))}
      </div>
      <PosTotals subtotalCents={sale.subtotalCents} taxCents={sale.taxCents} totalCents={sale.totalCents} />
      <p>
        Paid by {paidVia === "cash" ? "cash" : "card"}
        {changeCents != null ? ` — change given: ${formatCents(changeCents)}` : ""}
      </p>
      <div className="gg-pos__receipt-actions">
        <Button variant="secondary" onClick={() => window.print()}>
          Print receipt
        </Button>
        <Button variant="primary" onClick={onNewSale}>
          {newSaleLabel}
        </Button>
      </div>
    </div>
  );
}

/** A minimal state bundle a page needs to drive PosPaymentStep + PosReceipt. */
export function usePosCheckoutState() {
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | null>(null);
  const [cashTendered, setCashTendered] = useState("");
  const [changeCents, setChangeCents] = useState<number | null>(null);
  const [paidVia, setPaidVia] = useState<"cash" | "card" | null>(null);

  function reset() {
    setPaymentMethod(null);
    setCashTendered("");
    setChangeCents(null);
    setPaidVia(null);
  }

  return {
    paymentMethod,
    setPaymentMethod,
    cashTendered,
    setCashTendered,
    changeCents,
    setChangeCents,
    paidVia,
    setPaidVia,
    reset,
  };
}
