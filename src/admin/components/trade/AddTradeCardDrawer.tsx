import { useState, type KeyboardEvent } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { SelectField, TextField } from "../ui/Field";
import { ScryfallSearch } from "../cards/ScryfallSearch";
import { SelectedPrintingPreview } from "../cards/PrintingPreview";
import { priceForFinish } from "../../utils/pricing";
import { formatCents } from "../../utils/format";
import { CONDITION_LABELS, FINISH_LABELS } from "../../utils/labels";
import { MAX_TRADE_QUANTITY, parsePriceCents, parseQuantity } from "../../utils/tradeEvaluator";
import type { CardCondition, CardFinish, CardPrinting } from "../../types";

// Trade Evaluator → "They're trading in" → Add card: the same card search as
// Add Inventory (every printing on Scryfall, with pictures), then the
// condition, finish, how many, and the TCG low of the customer's copy.
// Scryfall's price for the finish is shown as a guide; staff still type the
// TCG low, which is usually below it.

/** One of the customer's cards, found with the search. */
export interface TradeCardPick {
  printing: CardPrinting;
  condition: CardCondition;
  finish: CardFinish;
  quantity: number;
  /** The TCG low as typed: blank when staff will add it on the trade. */
  price: string;
}

const CONDITIONS: CardCondition[] = ["NM", "LP", "MP", "HP", "DMG"];

export function AddTradeCardDrawer({ onClose, onAdd }: { onClose: () => void; onAdd: (pick: TradeCardPick) => void }) {
  const [selected, setSelected] = useState<CardPrinting | null>(null);
  const [condition, setCondition] = useState<CardCondition>("NM");
  const [finish, setFinish] = useState<CardFinish>("nonfoil");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [addAnother, setAddAnother] = useState(false);
  const [tried, setTried] = useState(false);

  const count = parseQuantity(quantity);
  const quantityError = count === null || count < 1 ? `Enter how many, from 1 to ${MAX_TRADE_QUANTITY}.` : undefined;
  const priceError = price.trim() !== "" && parsePriceCents(price) === null ? "Enter a price like 3.25." : undefined;
  const reference = selected ? priceForFinish(selected, finish) : null;

  function choose(printing: CardPrinting) {
    setSelected(printing);
    // Keep the finish when this printing has it; otherwise its first one.
    setFinish((prev) => (printing.availableFinishes.includes(prev) ? prev : (printing.availableFinishes[0] ?? "nonfoil")));
  }

  function add() {
    if (!selected) return;
    setTried(true);
    if (quantityError || priceError) return;
    onAdd({ printing: selected, condition, finish, quantity: count!, price: price.trim() });
    if (!addAnother) {
      onClose();
      return;
    }
    setSelected(null);
    setCondition("NM");
    setQuantity("1");
    setPrice("");
    setTried(false);
  }

  const addOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    add();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a card they're trading in"
      variant="drawer"
      size="lg"
      footer={
        <div className="gg-drawer-actions">
          <label className="gg-check-inline">
            <input type="checkbox" checked={addAnother} onChange={(e) => setAddAnother(e.target.checked)} />
            Add another after this one
          </label>
          <div className="gg-drawer-actions__buttons">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" icon="plus" onClick={add} disabled={!selected}>
              Add to trade
            </Button>
          </div>
        </div>
      }
    >
      <div className="gg-addcard">
        {!selected ? (
          <ScryfallSearch onSelect={choose} autoFocus />
        ) : (
          <>
            <div className="gg-addcard__selhead">
              <SelectedPrintingPreview printing={selected} finish={finish} />
              <Button variant="ghost" size="sm" icon="close" onClick={() => setSelected(null)}>
                Change card
              </Button>
            </div>
            <div className="gg-form-grid">
              <SelectField label="Condition" value={condition} onChange={(e) => setCondition(e.target.value as CardCondition)}>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {CONDITION_LABELS[c]}
                  </option>
                ))}
              </SelectField>
              <SelectField label="Finish" value={finish} onChange={(e) => setFinish(e.target.value as CardFinish)}>
                {(selected.availableFinishes.length > 0 ? selected.availableFinishes : (["nonfoil"] as CardFinish[])).map((f) => (
                  <option key={f} value={f}>
                    {FINISH_LABELS[f] ?? f}
                  </option>
                ))}
              </SelectField>
              <TextField
                label="Quantity"
                inputMode="numeric"
                autoComplete="off"
                value={quantity}
                error={tried ? quantityError : undefined}
                onChange={(e) => setQuantity(e.target.value)}
                onKeyDown={addOnEnter}
              />
              <TextField
                label="TCG low (each)"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={price}
                autoFocus
                error={tried ? priceError : undefined}
                hint={
                  reference != null
                    ? `Scryfall ${FINISH_LABELS[finish] ?? finish}: ${formatCents(reference)}, for reference. You can also add it on the trade.`
                    : "You can also add it on the trade."
                }
                onChange={(e) => setPrice(e.target.value)}
                onKeyDown={addOnEnter}
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
