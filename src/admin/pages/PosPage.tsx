import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/ui/Button";
import { SearchInput, TextField } from "../components/ui/Field";
import { Badge } from "../components/ui/Badge";
import { Spinner } from "../components/ui/States";
import { Modal } from "../components/ui/Modal";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { InventoryCardImage } from "../components/cards/InventoryCardImage";
import { inventoryRepository, orderRepository, posRepository, userRepository } from "../repositories";
import { useToast } from "../hooks/useToast";
import { usePosTerminal } from "../hooks/usePosTerminal";
import { formatCents } from "../utils/format";
import { CONDITION_LABELS, FINISH_LABELS } from "../utils/labels";
import type { Customer, InventoryItem, PosSaleResult } from "../types";
import type { Reader } from "@stripe/terminal-js";

// The in-store register. Shares the SAME inventory_items pool the storefront
// sells from (search hits admin_search_inventory, sale creation goes through
// pos_create_sale which revalidates + decrements exactly like online
// checkout), so a card can never sell online and in-store at once.
//
// Flow: build a ticket (search + add lines) -> optionally attach a walk-in
// customer -> create the sale (locks stock, computes tax/total) -> collect
// payment (cash, calculated in-app; or card, via a Stripe Terminal reader) ->
// receipt. Voiding before payment restores stock; after payment, use the
// regular Orders page (refunds aren't a register action).

type TicketLine = {
  item: InventoryItem;
  quantity: number;
};

type Phase = "building" | "payment" | "confirming" | "done";

export function PosPage() {
  const toast = useToast();
  const [ticket, setTicket] = useState<TicketLine[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<InventoryItem[]>([]);
  const [searching, setSearching] = useState(false);
  const reqId = useRef(0);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);

  const [taxBps, setTaxBps] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [phase, setPhase] = useState<Phase>("building");
  const [creating, setCreating] = useState(false);
  const [sale, setSale] = useState<PosSaleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voidConfirmOpen, setVoidConfirmOpen] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | null>(null);
  const [cashTendered, setCashTendered] = useState("");
  const [changeCents, setChangeCents] = useState<number | null>(null);
  const [paidVia, setPaidVia] = useState<"cash" | "card" | null>(null);

  const terminal = usePosTerminal();

  useEffect(() => {
    posRepository.getSettings().then((s) => setTaxBps(s.salesTaxBps)).catch(() => {});
  }, []);

  // Debounced live inventory search (in-stock only — the ticket only ever
  // offers what's actually sellable right now).
  useEffect(() => {
    const q = searchTerm.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = ++reqId.current;
    const handle = setTimeout(async () => {
      try {
        const page = await inventoryRepository.list({ search: q, stock: "in", pageSize: 10 });
        if (id === reqId.current) setSearchResults(page.rows.filter((r) => r.priceCents != null));
      } catch {
        if (id === reqId.current) setSearchResults([]);
      } finally {
        if (id === reqId.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [searchTerm]);

  const preview = useMemo(() => {
    const subtotalCents = ticket.reduce((sum, l) => sum + l.item.priceCents * l.quantity, 0);
    const taxCents = Math.round((subtotalCents * taxBps) / 10000);
    return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
  }, [ticket, taxBps]);

  function addToTicket(item: InventoryItem) {
    setTicket((prev) => {
      const existing = prev.find((l) => l.item.id === item.id);
      if (existing) {
        if (existing.quantity >= item.quantity) {
          toast.info(`Only ${item.quantity} in stock.`);
          return prev;
        }
        return prev.map((l) =>
          l.item.id === item.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [...prev, { item, quantity: 1 }];
    });
  }

  function setLineQuantity(itemId: string, quantity: number) {
    setTicket((prev) =>
      prev
        .map((l) =>
          l.item.id === itemId
            ? { ...l, quantity: Math.max(0, Math.min(quantity, l.item.quantity)) }
            : l,
        )
        .filter((l) => l.quantity > 0),
    );
  }

  function removeLine(itemId: string) {
    setTicket((prev) => prev.filter((l) => l.item.id !== itemId));
  }

  function resetSale() {
    setTicket([]);
    setCustomer(null);
    setPhase("building");
    setCreating(false);
    setSale(null);
    setError(null);
    setPaymentMethod(null);
    setCashTendered("");
    setChangeCents(null);
    setPaidVia(null);
  }

  async function startSale() {
    if (ticket.length === 0) return;
    setError(null);
    setCreating(true);
    try {
      const result = await posRepository.createSale(
        ticket.map((l) => ({ inventoryItemId: l.item.id, quantity: l.quantity })),
        customer?.id ?? null,
      );
      setSale(result);
      setPhase("payment");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the sale.");
    } finally {
      setCreating(false);
    }
  }

  async function payCash() {
    if (!sale) return;
    const tendered = Math.round(parseFloat(cashTendered || "0") * 100);
    if (!Number.isFinite(tendered) || tendered < sale.amountDueCents) {
      setError("Cash tendered must cover the amount due.");
      return;
    }
    setError(null);
    try {
      const res = await posRepository.markCashPaid(sale.orderId, tendered);
      setChangeCents(res.changeCents);
      setPaidVia("cash");
      setPhase("done");
      toast.success("Sale complete.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the cash payment.");
    }
  }

  async function payCard() {
    if (!sale) return;
    setError(null);
    try {
      const { clientSecret } = await posRepository.terminalCreateIntent(sale.orderId);
      await terminal.collectAndProcess(clientSecret);
      setPaidVia("card");
      setPhase("confirming");
      // The Stripe webhook is the only place the order actually becomes
      // "paid" — poll briefly rather than trusting the reader result alone.
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const order = await orderRepository.get(sale.orderId);
        if (order?.paymentStatus === "paid") break;
      }
      setPhase("done");
      toast.success("Sale complete.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Card payment failed.");
      setPhase("payment");
    }
  }

  async function voidSale() {
    if (!sale) return;
    try {
      await posRepository.voidSale(sale.orderId, "Voided at register");
      toast.info("Sale voided.");
      resetSale();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not void the sale.");
    } finally {
      setVoidConfirmOpen(false);
    }
  }

  return (
    <div className="gg-pos">
      <div className="gg-pos__main">
        <div className="gg-pos__search">
          <SearchInput
            label="Search inventory to add to the sale"
            placeholder="Card name, set, or SKU…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            disabled={phase !== "building"}
            autoFocus
          />
        </div>

        {searching && (
          <div className="gg-pos__search-loading">
            <Spinner label="Searching" />
          </div>
        )}

        {!searching && searchTerm.trim().length >= 2 && (
          <div className="gg-pos__results">
            {searchResults.length === 0 ? (
              <p className="gg-muted">No in-stock cards match “{searchTerm}”.</p>
            ) : (
              searchResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="gg-pos__result"
                  disabled={phase !== "building"}
                  onClick={() => addToTicket(item)}
                >
                  <InventoryCardImage item={item} size="xs" />
                  <span className="gg-pos__result-body">
                    <span className="gg-pos__result-name">{item.cardName}</span>
                    <span className="gg-muted">
                      {item.setName ?? item.setCode} · {CONDITION_LABELS[item.condition]} ·{" "}
                      {FINISH_LABELS[item.finish]} · {item.quantity} in stock
                    </span>
                  </span>
                  <span className="gg-pos__result-price">{formatCents(item.priceCents)}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <aside className="gg-pos__ticket">
        <div className="gg-pos__ticket-head">
          <h2>Sale</h2>
          <Button variant="ghost" size="sm" icon="settings" onClick={() => setSettingsOpen(true)}>
            Tax rate
          </Button>
        </div>

        <button
          type="button"
          className="gg-pos__customer"
          disabled={phase !== "building"}
          onClick={() => setCustomerModalOpen(true)}
        >
          <span>{customer ? `${customer.firstName} ${customer.lastName}`.trim() || customer.email : "Walk-in customer"}</span>
          <Badge tone="neutral">{customer ? "Change" : "Add customer"}</Badge>
        </button>

        {error && (
          <div className="gg-inline-note gg-inline-note--warning" role="alert">
            {error}
          </div>
        )}

        {phase === "building" && (
          <>
            <div className="gg-pos__lines">
              {ticket.length === 0 ? (
                <p className="gg-muted">Search above to add cards to this sale.</p>
              ) : (
                ticket.map((line) => (
                  <div className="gg-pos__line" key={line.item.id}>
                    <div className="gg-pos__line-body">
                      <span className="gg-pos__line-name">{line.item.cardName}</span>
                      <span className="gg-muted">
                        {CONDITION_LABELS[line.item.condition]} · {FINISH_LABELS[line.item.finish]}
                      </span>
                    </div>
                    <div className="gg-pos__line-qty">
                      <button
                        type="button"
                        className="gg-icon-btn"
                        aria-label="Decrease quantity"
                        onClick={() => setLineQuantity(line.item.id, line.quantity - 1)}
                      >
                        −
                      </button>
                      <span>{line.quantity}</span>
                      <button
                        type="button"
                        className="gg-icon-btn"
                        aria-label="Increase quantity"
                        disabled={line.quantity >= line.item.quantity}
                        onClick={() => setLineQuantity(line.item.id, line.quantity + 1)}
                      >
                        +
                      </button>
                    </div>
                    <span className="gg-pos__line-total">
                      {formatCents(line.item.priceCents * line.quantity)}
                    </span>
                    <button
                      type="button"
                      className="gg-icon-btn"
                      aria-label={`Remove ${line.item.cardName}`}
                      onClick={() => removeLine(line.item.id)}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            <PosTotals subtotalCents={preview.subtotalCents} taxCents={preview.taxCents} totalCents={preview.totalCents} />

            <Button
              variant="primary"
              size="md"
              className="gg-pos__charge"
              disabled={ticket.length === 0}
              loading={creating}
              onClick={startSale}
            >
              Charge {formatCents(preview.totalCents)}
            </Button>
          </>
        )}

        {phase === "payment" && sale && (
          <PosPaymentStep
            sale={sale}
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
            cashTendered={cashTendered}
            setCashTendered={setCashTendered}
            onPayCash={payCash}
            onPayCard={payCard}
            terminal={terminal}
            onVoid={() => setVoidConfirmOpen(true)}
          />
        )}

        {phase === "confirming" && (
          <div className="gg-pos__confirming">
            <Spinner label="Confirming payment" />
            <p className="gg-muted">This only takes a moment.</p>
          </div>
        )}

        {phase === "done" && sale && (
          <PosReceipt
            sale={sale}
            ticket={ticket}
            customer={customer}
            paidVia={paidVia}
            changeCents={changeCents}
            onNewSale={resetSale}
          />
        )}
      </aside>

      <CustomerPickerModal
        open={customerModalOpen}
        onClose={() => setCustomerModalOpen(false)}
        onSelect={(c) => {
          setCustomer(c);
          setCustomerModalOpen(false);
        }}
        onClear={() => {
          setCustomer(null);
          setCustomerModalOpen(false);
        }}
      />

      <TaxSettingsModal
        open={settingsOpen}
        taxBps={taxBps}
        onClose={() => setSettingsOpen(false)}
        onSaved={setTaxBps}
      />

      <ConfirmDialog
        open={voidConfirmOpen}
        title="Void this sale?"
        message="This restores the cards to stock and cancels the order. Nothing has been charged yet."
        confirmLabel="Void sale"
        tone="danger"
        onConfirm={voidSale}
        onCancel={() => setVoidConfirmOpen(false)}
      />
    </div>
  );
}

function PosTotals({
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

function PosPaymentStep({
  sale,
  paymentMethod,
  setPaymentMethod,
  cashTendered,
  setCashTendered,
  onPayCash,
  onPayCard,
  terminal,
  onVoid,
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
        <div className="gg-pos__cash">
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
            <Button variant="ghost" onClick={() => setPaymentMethod(null)}>
              Back
            </Button>
            <Button variant="primary" disabled={changeCents < 0} onClick={onPayCash}>
              Complete cash sale
            </Button>
          </div>
        </div>
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
        Void sale
      </Button>
    </div>
  );
}

function PosReceipt({
  sale,
  ticket,
  customer,
  paidVia,
  changeCents,
  onNewSale,
}: {
  sale: PosSaleResult;
  ticket: TicketLine[];
  customer: Customer | null;
  paidVia: "cash" | "card" | null;
  changeCents: number | null;
  onNewSale: () => void;
}) {
  return (
    <div className="gg-pos__receipt">
      <h3>Sale complete</h3>
      <p className="gg-muted">Order #{sale.orderId.slice(0, 8).toUpperCase()}</p>
      <p className="gg-muted">{customer ? `${customer.firstName} ${customer.lastName}`.trim() : "Walk-in customer"}</p>
      <div className="gg-pos__lines">
        {ticket.map((line) => (
          <div className="gg-pos__line" key={line.item.id}>
            <span className="gg-pos__line-name">
              {line.item.cardName} × {line.quantity}
            </span>
            <span>{formatCents(line.item.priceCents * line.quantity)}</span>
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
          New sale
        </Button>
      </div>
    </div>
  );
}

function CustomerPickerModal({
  open,
  onClose,
  onSelect,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (c: Customer) => void;
  onClear: () => void;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [quickAdd, setQuickAdd] = useState(false);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    setTerm("");
    setResults([]);
    setQuickAdd(false);
  }, [open]);

  useEffect(() => {
    if (!open || term.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const rows = await userRepository.listCustomers({ search: term });
        setResults(rows.slice(0, 8));
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [term, open]);

  async function handleQuickAdd() {
    if (!email.trim()) return;
    try {
      const { customer } = await userRepository.addCustomer({ email, firstName, lastName });
      onSelect(customer);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add customer.");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Attach a customer" size="sm">
      {!quickAdd ? (
        <>
          <SearchInput label="Search customers" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus />
          {loading && <Spinner label="Searching" />}
          <div className="gg-pos__customer-results">
            {results.map((c) => (
              <button
                key={c.id}
                type="button"
                className="gg-pos__customer-result"
                onClick={() => onSelect(c)}
              >
                {`${c.firstName} ${c.lastName}`.trim() || c.email} <span className="gg-muted">{c.email}</span>
              </button>
            ))}
          </div>
          <div className="gg-pos__customer-actions">
            <Button variant="ghost" size="sm" onClick={onClear}>
              Walk-in (no customer)
            </Button>
            <Button variant="secondary" size="sm" icon="plus" onClick={() => setQuickAdd(true)}>
              New customer
            </Button>
          </div>
        </>
      ) : (
        <div className="gg-form">
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <TextField label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <TextField label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          <div className="gg-pos__customer-actions">
            <Button variant="ghost" size="sm" onClick={() => setQuickAdd(false)}>
              Back
            </Button>
            <Button variant="primary" size="sm" onClick={handleQuickAdd}>
              Add customer
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function TaxSettingsModal({
  open,
  taxBps,
  onClose,
  onSaved,
}: {
  open: boolean;
  taxBps: number;
  onClose: () => void;
  onSaved: (bps: number) => void;
}) {
  const [pct, setPct] = useState((taxBps / 100).toString());
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (open) setPct((taxBps / 100).toString());
  }, [open, taxBps]);

  async function save() {
    const bps = Math.round(parseFloat(pct || "0") * 100);
    if (!Number.isFinite(bps) || bps < 0 || bps > 10000) {
      toast.error("Enter a percentage between 0 and 100.");
      return;
    }
    setSaving(true);
    try {
      const settings = await posRepository.saveSettings(bps);
      onSaved(settings.salesTaxBps);
      toast.success("Tax rate saved.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the tax rate.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sales tax"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <TextField
        label="Sales tax rate (%)"
        type="number"
        step="0.01"
        min="0"
        max="100"
        value={pct}
        onChange={(e) => setPct(e.target.value)}
        hint="Applied to every in-store sale's subtotal. Online orders are never taxed by this setting."
      />
    </Modal>
  );
}
