import { useEffect, useMemo, useState } from "react";
import { Modal } from "../components/ui/Modal";
import { Button } from "../components/ui/Button";
import { TextField, TextArea, SelectField } from "../components/ui/Field";
import { Icon } from "../components/ui/Icon";
import { ScryfallSearch } from "../components/cards/ScryfallSearch";
import {
  SelectedPrintingPreview,
  priceForFinish,
} from "../components/cards/PrintingPreview";
import { inventoryRepository } from "../repositories";
import { useToast } from "../hooks/useToast";
import { useCurrentAdmin } from "../hooks/useCurrentAdmin";
import { formatCents } from "../utils/format";
import { CONDITION_LABELS, FINISH_LABELS } from "../utils/labels";
import { applyPriceFloor } from "../utils/pricing";
import type {
  CardCondition,
  CardFinish,
  CardPrinting,
  InventoryItem,
  InventoryPriceFloor,
} from "../types";

const CONDITIONS: CardCondition[] = ["NM", "LP", "MP", "HP", "DMG"];

function centsFromInput(dollars: string): number {
  const n = Number.parseFloat(dollars);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * Manual add-inventory flow. Search Scryfall → pick the EXACT printing → confirm
 * the artwork in a large preview → choose condition/finish/qty/price → save.
 * Duplicate detection is by scryfall_id + condition + finish (falling back to
 * set/collector for legacy rows), and duplicates ADD to the existing line
 * through the movement ledger rather than creating a new one.
 */
export function AddInventoryDrawer({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const currentAdmin = useCurrentAdmin();
  const [selected, setSelected] = useState<CardPrinting | null>(null);

  const [condition, setCondition] = useState<CardCondition>("NM");
  const [finish, setFinish] = useState<CardFinish>("nonfoil");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [storefrontPlacement, setStorefrontPlacement] = useState<"main" | "deals">("main");
  const [dealDiscount, setDealDiscount] = useState("20");
  const [dealReason, setDealReason] = useState<"manual" | "flawed">("manual");
  const [flawNote, setFlawNote] = useState("");
  const [addAnother, setAddAnother] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dupe, setDupe] = useState<InventoryItem | null>(null);
  const [priceFloors, setPriceFloors] = useState<InventoryPriceFloor[]>([]);

  useEffect(() => {
    if (!open) {
      setSelected(null);
      resetForm();
    }
  }, [open]);

  // Loaded once when the drawer opens so the price auto-fill below can floor
  // the Scryfall reference price to the seller's per-rarity minimum.
  useEffect(() => {
    if (!open) return;
    let active = true;
    inventoryRepository.getPriceFloors().then((floors) => {
      if (active) setPriceFloors(floors);
    });
    return () => {
      active = false;
    };
  }, [open]);

  function resetForm() {
    setCondition("NM");
    setFinish("nonfoil");
    setQuantity("1");
    setPrice("");
    setCost("");
    setLocation("");
    setNotes("");
    setStorefrontPlacement("main");
    setDealDiscount("20");
    setDealReason("manual");
    setFlawNote("");
    setDupe(null);
  }

  // When a printing is chosen, constrain the finish to its available finishes
  // and seed the price field from the finish-specific Scryfall reference.
  useEffect(() => {
    if (!selected) return;
    const first = selected.availableFinishes[0] ?? "nonfoil";
    setFinish((prev) =>
      selected.availableFinishes.includes(prev) ? prev : first,
    );
  }, [selected]);

  // Reference price follows the selected finish; only prefill when price empty.
  // Floored to the rarity's minimum (if staff has set one above 0) so a
  // below-market Scryfall reference never gets suggested as-is.
  useEffect(() => {
    if (!selected) return;
    const ref = applyPriceFloor(
      priceForFinish(selected, finish),
      selected.rarity,
      priceFloors,
    );
    if (ref != null) {
      setPrice((prev) => (prev === "" ? (ref / 100).toFixed(2) : prev));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finish, selected, priceFloors]);

  // Dupe detection: prefer scryfall identity, fall back to set/collector.
  useEffect(() => {
    let active = true;
    if (!selected) {
      setDupe(null);
      return;
    }
    inventoryRepository
      .findMatchByScryfall(selected.scryfallId, condition, finish)
      .then(async (match) => {
        const resolved =
          match ??
          (await inventoryRepository.findMatch(
            selected.setCode,
            selected.collectorNumber,
            condition,
            finish,
          ));
        if (active) setDupe(resolved);
      });
    return () => {
      active = false;
    };
  }, [selected, condition, finish]);

  const finishOptions = useMemo(() => {
    const list = selected?.availableFinishes ?? ["nonfoil"];
    return list.map((f) => ({ value: f, label: FINISH_LABELS[f] }));
  }, [selected]);

  const refPrice = selected ? priceForFinish(selected, finish) : null;
  const previewPriceCents = centsFromInput(price);

  async function handleSave() {
    if (!selected) {
      toast.error("Choose a card printing first.");
      return;
    }
    const qty = Number.parseInt(quantity, 10);
    if (!Number.isFinite(qty) || qty < 1) {
      toast.error("Enter a quantity of at least 1.");
      return;
    }
    const priceCents = centsFromInput(price);
    if (priceCents <= 0) {
      toast.error("Enter a selling price.");
      return;
    }
    const discountPercent = Math.max(
      1,
      Math.min(90, Math.round(Number(dealDiscount) || 20)),
    );
    if (storefrontPlacement === "deals" && dealReason === "flawed" && !flawNote.trim()) {
      toast.error("Describe the flaw so customers know what they're buying.");
      return;
    }

    setSaving(true);
    try {
      await inventoryRepository.create(
        {
          scryfallId: selected.scryfallId,
          cardName: selected.cardName,
          setName: selected.setName,
          setCode: selected.setCode,
          collectorNumber: selected.collectorNumber,
          rarity: selected.rarity,
          cardType: selected.cardType,
          imageUrl: selected.imageUrl,
          condition,
          finish,
          quantity: qty,
          priceCents,
          costCents: cost ? centsFromInput(cost) : null,
          storageLocation: location || null,
          sku: null,
          notes: notes || null,
          status: "active",
          scryfallPriceCents: refPrice,
          isDeal: storefrontPlacement === "deals",
          dealDiscountPercent:
            storefrontPlacement === "deals" ? discountPercent : null,
          dealSource: storefrontPlacement === "deals" ? dealReason : null,
          dealNote:
            storefrontPlacement === "deals" && dealReason === "flawed"
              ? flawNote.trim()
              : null,
        },
        currentAdmin.name,
      );

      if (dupe) {
        toast.success(
          `Added ${qty} to existing stock of ${dupe.cardName} and updated its storefront placement.`,
        );
      } else {
        toast.success(
          storefrontPlacement === "deals"
            ? `Added ${selected.cardName} to Deals & Specials.`
            : `Added ${selected.cardName} to inventory.`,
        );
      }
      onSaved();
      if (addAnother) {
        setSelected(null);
        resetForm();
      } else {
        onClose();
      }
    } catch {
      toast.error("Could not save the card. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add inventory"
      variant="drawer"
      size="lg"
      footer={
        <div className="gg-drawer-actions">
          <label className="gg-check-inline">
            <input
              type="checkbox"
              checked={addAnother}
              onChange={(e) => setAddAnother(e.target.checked)}
            />
            Add another after saving
          </label>
          <div className="gg-drawer-actions__buttons">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              loading={saving}
              disabled={!selected}
            >
              {dupe ? "Add to stock" : "Add card"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="gg-addcard">
        {!selected ? (
          <ScryfallSearch onSelect={setSelected} autoFocus />
        ) : (
          <>
            <div className="gg-addcard__selhead">
              <SelectedPrintingPreview printing={selected} finish={finish} />
              <Button
                variant="ghost"
                size="sm"
                icon="close"
                onClick={() => setSelected(null)}
              >
                Change card
              </Button>
            </div>

            {dupe && (
              <div className="gg-inline-note gg-inline-note--warning" role="status">
                <Icon name="warning" size={18} />
                <div>
                  You already have {dupe.quantity} of this exact printing in{" "}
                  {condition} {FINISH_LABELS[finish]}. Saving will{" "}
                  <strong>add to the existing line</strong> through the movement
                  ledger rather than creating a duplicate.
                </div>
              </div>
            )}

            <div className="gg-form-grid">
              <SelectField
                label="Condition"
                value={condition}
                onChange={(e) => setCondition(e.target.value as CardCondition)}
              >
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {CONDITION_LABELS[c]}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Finish"
                value={finish}
                onChange={(e) => setFinish(e.target.value as CardFinish)}
              >
                {finishOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </SelectField>
              <TextField
                label="Quantity"
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
              <TextField
                label="Price (USD)"
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                hint={
                  refPrice != null
                    ? `Scryfall ${FINISH_LABELS[finish]}: ${formatCents(refPrice)}`
                    : undefined
                }
              />
              <TextField
                label="Cost (USD)"
                type="number"
                min={0}
                step="0.01"
                placeholder="Optional"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                hint="Used for margin reporting."
              />
              <TextField
                label="Storage location"
                placeholder="e.g. Box A-3"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
              <SelectField
                label="Storefront placement"
                value={storefrontPlacement}
                onChange={(e) =>
                  setStorefrontPlacement(e.target.value as "main" | "deals")
                }
                hint="Deals & Specials listings are also visible in normal shop searches."
              >
                <option value="main">Main Store</option>
                <option value="deals">Deals & Specials</option>
              </SelectField>
              {storefrontPlacement === "deals" && (
                <>
                  <SelectField
                    label="Deal reason"
                    value={dealReason}
                    onChange={(e) => setDealReason(e.target.value as "manual" | "flawed")}
                    hint="Flawed cards show their note to customers on the storefront."
                  >
                    <option value="manual">Hand-picked special</option>
                    <option value="flawed">Hard to grade / has a flaw</option>
                  </SelectField>
                  <TextField
                    label="Deal discount (%)"
                    type="number"
                    min={1}
                    max={90}
                    step={1}
                    value={dealDiscount}
                    onChange={(e) => setDealDiscount(e.target.value)}
                    hint={
                      previewPriceCents > 0
                        ? `Regular ${formatCents(previewPriceCents)} → Deal ${formatCents(
                            Math.max(
                              1,
                              Math.round(
                                previewPriceCents *
                                  (100 -
                                    Math.max(
                                      1,
                                      Math.min(90, Number(dealDiscount) || 20),
                                    )) /
                                  100,
                              ),
                            ),
                          )}`
                        : "Enter the regular price above; the discount is applied when saved."
                    }
                  />
                </>
              )}
            </div>
            {storefrontPlacement === "deals" && dealReason === "flawed" && (
              <TextArea
                label="Describe the flaw"
                placeholder="e.g. small crease on the bottom-left corner, factory miscut, slight ink smudge on the border…"
                value={flawNote}
                rows={2}
                onChange={(e) => setFlawNote(e.target.value)}
                hint="Shown to customers on the storefront so they know exactly what they're getting."
              />
            )}
            <TextArea
              label="Notes"
              placeholder="Optional — signed, altered, etc."
              value={notes}
              rows={2}
              onChange={(e) => setNotes(e.target.value)}
            />
          </>
        )}
      </div>
    </Modal>
  );
}