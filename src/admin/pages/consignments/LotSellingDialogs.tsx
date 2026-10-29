import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { SelectField, TextArea, TextField } from "../../components/ui/Field";
import { useToast } from "../../hooks/useToast";
import { dollarsToCents } from "../../../store/lib/consignmentReceiving";
import { consignmentAdminApi, type LotQuantities, type LotRecord } from "./consignmentAdminApi";

// The selling steps for one accepted card line: list it on the website, change
// its price, take copies off sale, or record a TCGplayer/eBay sale. Every rule
// (approved channels, the consignor's minimum, how many copies are free) is
// enforced by the database; these dialogs check what they can first so staff
// see the problem before saving.

const money = (c: number | null | undefined) => (c == null ? "—" : `$${(c / 100).toFixed(2)}`);
const centsText = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2));

export type SellingAction = "list" | "price" | "unlist" | "sale";

function useSubmit(onDone: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      toast.success(await fn());
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, submit };
}

function Footer({ onClose, busy, label, onSubmit }: { onClose: () => void; busy: boolean; label: string; onSubmit: () => void }) {
  return (
    <div className="gg-btn-row">
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="primary" loading={busy} onClick={onSubmit}>
        {label}
      </Button>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p className="gg-field__error" role="alert">
      {error}
    </p>
  ) : null;
}

function wholeCount(value: string, max: number, label: string): number | string {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return `${label}: enter a whole number of at least 1.`;
  if (n > max) return `${label}: at most ${max}.`;
  return n;
}

export function LotSellingDialog({
  action,
  lot,
  quantities,
  onSale,
  approved,
  onClose,
  onDone,
}: {
  action: SellingAction;
  lot: LotRecord;
  quantities: LotQuantities;
  /** Copies on the website not held by a checkout. */
  onSale: number;
  approved: { website: boolean; tcgplayer: boolean; ebay: boolean };
  onClose: () => void;
  onDone: () => void;
}) {
  const { busy, error, setError, submit } = useSubmit(onDone);
  const [qty, setQty] = useState(String(action === "list" ? quantities.unlisted : 1));
  const [price, setPrice] = useState(centsText(lot.list_price_cents));
  const [channel, setChannel] = useState<"tcgplayer" | "ebay">(approved.tcgplayer ? "tcgplayer" : "ebay");
  const [soldOn, setSoldOn] = useState(new Date().toISOString().slice(0, 10));
  const [ref, setRef] = useState("");
  const [fee, setFee] = useState("");
  const [processing, setProcessing] = useState("");
  const [postage, setPostage] = useState("");
  const [notes, setNotes] = useState("");
  const min = lot.min_price_cents;
  const minNote = min != null ? `The consignor's minimum is ${money(min)}.` : "No minimum set.";
  const sellable = quantities.unlisted + onSale;

  function priceCents(): number | string {
    const c = dollarsToCents(price);
    if (!c) return "Enter a price in dollars.";
    if (min != null && c < min) return `That's below the consignor's minimum of ${money(min)}.`;
    return c;
  }

  if (action === "list") {
    return (
      <Modal open onClose={onClose} title={`List ${lot.card_name} on the website`} size="md" footer={<Footer onClose={onClose} busy={busy} label="List for sale" onSubmit={() => {
        const n = wholeCount(qty, quantities.unlisted, "Copies");
        const p = priceCents();
        if (typeof n === "string") return setError(n);
        if (typeof p === "string") return setError(p);
        void submit(async () => {
          await consignmentAdminApi.listLot(lot.id, n, p);
          return `Listed ${n} × ${lot.card_name} at ${money(p)}.`;
        });
      }} />}>
        <p className="gg-muted">
          Consigned copies sell at this price only: no member discount, storewide sale or deal applies, and they can't be traded. {minNote}
        </p>
        <div className="gg-cs-row">
          <TextField label="Copies" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} hint={`${quantities.unlisted} not listed yet`} />
          <TextField label="Price ($)" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} hint={`Market ${money(lot.market_price_cents)}`} />
        </div>
        <ErrorLine error={error} />
      </Modal>
    );
  }

  if (action === "price") {
    return (
      <Modal open onClose={onClose} title={`Change the price of ${lot.card_name}`} size="sm" footer={<Footer onClose={onClose} busy={busy} label="Save price" onSubmit={() => {
        const p = priceCents();
        if (typeof p === "string") return setError(p);
        void submit(async () => {
          await consignmentAdminApi.setLotPrice(lot.id, p);
          return `${lot.card_name} is now ${money(p)}.`;
        });
      }} />}>
        <TextField label="Price ($)" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} hint={`${minNote} Market ${money(lot.market_price_cents)}.`} />
        <ErrorLine error={error} />
      </Modal>
    );
  }

  if (action === "unlist") {
    return (
      <Modal open onClose={onClose} title={`Take ${lot.card_name} off sale`} size="sm" footer={<Footer onClose={onClose} busy={busy} label="Take off sale" onSubmit={() => {
        const n = wholeCount(qty, onSale, "Copies");
        if (typeof n === "string") return setError(n);
        void submit(async () => {
          await consignmentAdminApi.unlistLot(lot.id, n);
          return `Took ${n} × ${lot.card_name} off the website.`;
        });
      }} />}>
        <TextField label="Copies" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} hint={`${onSale} on sale and not in a checkout. They stay accepted and can be listed again.`} />
        <ErrorLine error={error} />
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={`Record a sale of ${lot.card_name}`} size="lg" footer={<Footer onClose={onClose} busy={busy} label="Record sale" onSubmit={() => {
      const n = wholeCount(qty, sellable, "Copies");
      const p = priceCents();
      if (typeof n === "string") return setError(n);
      if (typeof p === "string") return setError(p);
      if (!ref.trim()) return setError("Enter the marketplace order number.");
      const parsed = [fee, processing, postage].map((v) => dollarsToCents(v));
      if (parsed.some((v) => v === undefined)) return setError("Fees and postage must be dollar amounts.");
      const [feeC, processingC, postageC] = parsed.map((v) => v ?? 0);
      if (!soldOn || new Date(`${soldOn}T12:00:00`).getTime() > Date.now() + 86_400_000) return setError("Enter the date it sold.");
      void submit(async () => {
        await consignmentAdminApi.recordExternalSale({
          lotId: lot.id,
          channel,
          quantity: n,
          unitPriceCents: p,
          soldAt: new Date(`${soldOn}T12:00:00`).toISOString(),
          externalRef: ref.trim(),
          marketplaceFeeCents: feeC,
          processingFeeCents: processingC,
          postageCents: postageC,
          notes: notes.trim() || undefined,
        });
        return `Recorded the ${channel === "ebay" ? "eBay" : "TCGplayer"} sale. Mark it delivered when it arrives.`;
      });
    }} />}>
      <p className="gg-muted">
        For a sale made on a marketplace the consignor approved. Enter the actual fees from the marketplace's order page. {minNote} Copies come from
        the unlisted ones first, then off the website ({sellable} available).
      </p>
      <div className="gg-cs-row">
        <SelectField label="Sold on" value={channel} onChange={(e) => setChannel(e.target.value as "tcgplayer" | "ebay")}>
          {approved.tcgplayer && <option value="tcgplayer">TCGplayer</option>}
          {approved.ebay && <option value="ebay">eBay</option>}
        </SelectField>
        <TextField label="Order number" value={ref} maxLength={100} onChange={(e) => setRef(e.target.value)} />
        <TextField label="Date sold" type="date" value={soldOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setSoldOn(e.target.value)} />
      </div>
      <div className="gg-cs-row">
        <TextField label="Copies" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
        <TextField label="Price per card ($)" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} hint="Before shipping and tax" />
      </div>
      <div className="gg-cs-row">
        <TextField label="Marketplace fee ($)" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
        <TextField label="Payment processing ($)" inputMode="decimal" value={processing} onChange={(e) => setProcessing(e.target.value)} hint="0 on eBay (included in its fee)" />
        <TextField label="Postage after buyer's shipping ($)" inputMode="decimal" value={postage} onChange={(e) => setPostage(e.target.value)} hint="Label cost minus what the buyer paid, not below 0" />
      </div>
      <TextArea label="Notes (internal)" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <ErrorLine error={error} />
    </Modal>
  );
}
