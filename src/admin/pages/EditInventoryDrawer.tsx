import { useEffect, useMemo, useState } from "react";
import { Modal } from "../components/ui/Modal";
import { Button } from "../components/ui/Button";
import { TextField, TextArea, SelectField } from "../components/ui/Field";
import { Icon } from "../components/ui/Icon";
import { Badge } from "../components/ui/Badge";
import { ScryfallSearch } from "../components/cards/ScryfallSearch";
import { InventoryCardImage } from "../components/cards/InventoryCardImage";
import { SelectedPrintingPreview } from "../components/cards/PrintingPreview";
import { inventoryRepository } from "../repositories";
import { useToast } from "../hooks/useToast";
import { useCurrentAdmin } from "../hooks/useCurrentAdmin";
import { formatCents } from "../utils/format";
import {
  CONDITION_LABELS,
  FINISH_LABELS,
  rarityLabel,
  rarityTone,
} from "../utils/labels";
import type {
  CardCondition,
  CardFinish,
  CardPrinting,
  InventoryItem,
  InventoryPrintingEdit,
} from "../types";

const CONDITIONS: CardCondition[] = ["NM", "LP", "MP", "HP", "DMG"];

function centsFromInput(dollars: string): number {
  const n = Number.parseFloat(dollars);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function dollarsFromCents(cents: number | null | undefined): string {
  return cents != null ? (cents / 100).toFixed(2) : "";
}

/**
 * Edit an existing inventory line: condition, finish, exact printing/art,
 * selling price, cost, storage location, SKU, and notes. Quantity is NOT edited
 * here — it stays on the detail drawer's adjustment controls so every change
 * flows through the movement ledger.
 *
 * Changing the printing reuses the SAME Scryfall exact-printing search as the
 * Add flow: search → pick the exact printing → confirm in a large preview →
 * save. On save the server re-resolves the exact printing, refreshes all
 * denormalized metadata + image together, constrains the finish to the
 * printing's available finishes, and rejects a duplicate identity with a
 * friendly message.
 */
export function EditInventoryDrawer({
  open,
  item,
  onClose,
  onSaved,
}: {
  open: boolean;
  item: InventoryItem | null;
  onClose: () => void;
  onSaved: (updated: InventoryItem) => void;
}) {
  const toast = useToast();
  const currentAdmin = useCurrentAdmin();

  const [condition, setCondition] = useState<CardCondition>("NM");
  const [finish, setFinish] = useState<CardFinish>("nonfoil");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [location, setLocation] = useState("");
  const [sku, setSku] = useState("");
  const [notes, setNotes] = useState("");
  const [storefrontPlacement, setStorefrontPlacement] = useState<"main" | "deals">("main");
  const [dealDiscount, setDealDiscount] = useState("20");
  const [dealReason, setDealReason] = useState<"manual" | "flawed">("manual");
  const [flawNote, setFlawNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Printing change: null = keep current printing; a value = staged new printing
  // awaiting save. `picking` toggles the Scryfall search UI.
  const [newPrinting, setNewPrinting] = useState<CardPrinting | null>(null);
  const [picking, setPicking] = useState(false);

  // Seed the form whenever a new item is opened.
  useEffect(() => {
    if (!item) return;
    setCondition(item.condition);
    setFinish(item.finish);
    setPrice(dollarsFromCents(item.priceCents));
    setCost(dollarsFromCents(item.costCents));
    setLocation(item.storageLocation ?? "");
    setSku(item.sku ?? "");
    setNotes(item.notes ?? "");
    setStorefrontPlacement(item.isDeal ? "deals" : "main");
    setDealDiscount(String(item.dealDiscountPercent ?? 20));
    setDealReason(item.dealSource === "flawed" ? "flawed" : "manual");
    setFlawNote(item.dealSource === "flawed" ? (item.dealNote ?? "") : "");
    setNewPrinting(null);
    setPicking(false);
  }, [item]);

  // Available finishes come from the staged new printing when present, else the
  // current printing isn't fully known here (only its stored finish), so fall
  // back to the full supported list. When a new printing is chosen, constrain.
  const finishOptions = useMemo<CardFinish[]>(() => {
    if (newPrinting) return newPrinting.availableFinishes;
    // Without the resolved current printing we allow the common finishes; the
    // server still validates against the real printing on save.
    return ["nonfoil", "foil", "etched", "glossy"];
  }, [newPrinting]);

  // When a new printing is chosen, constrain the selected finish to it.
  useEffect(() => {
    if (!newPrinting) return;
    setFinish((prev) =>
      newPrinting.availableFinishes.includes(prev)
        ? prev
        : (newPrinting.availableFinishes[0] ?? "nonfoil"),
    );
  }, [newPrinting]);

  if (!item) return null;

  async function handleSave() {
    if (!item) return;
    const priceCents = centsFromInput(price);
    if (priceCents <= 0) {
      toast.error("Enter a selling price.");
      return;
    }
    if (!finishOptions.includes(finish)) {
      toast.error("Choose a finish available for this printing.");
      return;
    }
    if (storefrontPlacement === "deals" && dealReason === "flawed" && !flawNote.trim()) {
      toast.error("Describe the flaw so customers know what they're buying.");
      return;
    }
    const discountPercent = Math.max(
      1,
      Math.min(90, Math.round(Number(dealDiscount) || 20)),
    );

    const edit: InventoryPrintingEdit = {
      condition,
      finish,
      priceCents,
      costCents: cost.trim() ? centsFromInput(cost) : null,
      storageLocation: location.trim() ? location.trim() : null,
      sku: sku.trim() ? sku.trim() : null,
      notes: notes.trim() ? notes.trim() : null,
    };
    // Only send printing identity when the admin actually changed it.
    if (newPrinting) {
      edit.scryfallId = newPrinting.scryfallId;
      edit.setCode = newPrinting.setCode;
      edit.collectorNumber = newPrinting.collectorNumber;
      edit.cardName = newPrinting.cardName;
    }

    setSaving(true);
    try {
      await inventoryRepository.updatePrinting(item.id, edit, currentAdmin.name);
      // Deal placement/reason/discount/note is a separate PATCH, mirroring how
      // AddInventoryDrawer sets it in a follow-up call after creating the row.
      const updated = await inventoryRepository.update(item.id, {
        isDeal: storefrontPlacement === "deals",
        dealDiscountPercent: storefrontPlacement === "deals" ? discountPercent : null,
        dealSource: storefrontPlacement === "deals" ? dealReason : null,
        dealNote:
          storefrontPlacement === "deals" && dealReason === "flawed"
            ? flawNote.trim()
            : null,
      });
      toast.success(`Saved changes to ${updated.cardName}.`);
      onSaved(updated);
      onClose();
    } catch (err) {
      // Friendly server messages (duplicate identity, unavailable finish, etc.)
      // are surfaced verbatim; unexpected errors get a generic fallback.
      toast.error(
        err instanceof Error ? err.message : "Could not save the changes.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit — ${item.cardName}`}
      variant="drawer"
      size="lg"
      footer={
        <div className="gg-drawer-actions__buttons">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>
            Save changes
          </Button>
        </div>
      }
    >
      <div className="gg-addcard">
        {picking ? (
          <div className="gg-editprint">
            <div className="gg-editprint__head">
              <h3 className="gg-detail__h3">Choose the exact printing</h3>
              <Button
                variant="ghost"
                size="sm"
                icon="close"
                onClick={() => setPicking(false)}
              >
                Cancel change
              </Button>
            </div>
            <ScryfallSearch
              autoFocus
              initialQuery={item.cardName}
              onSelect={(p) => {
                setNewPrinting(p);
                setPicking(false);
              }}
            />
          </div>
        ) : (
          <>
            {/* Current / staged printing preview */}
            {newPrinting ? (
              <>
                <div className="gg-inline-note gg-inline-note--info" role="status">
                  <Icon name="edit" size={18} />
                  <div>
                    Printing will change to{" "}
                    <strong>
                      {newPrinting.setName} ({newPrinting.setCode}) · #
                      {newPrinting.collectorNumber}
                    </strong>
                    . All artwork and printing details update on save.
                  </div>
                </div>
                <div className="gg-addcard__selhead">
                  <SelectedPrintingPreview printing={newPrinting} finish={finish} />
                  <div className="gg-editprint__actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="search"
                      onClick={() => setPicking(true)}
                    >
                      Change again
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="close"
                      onClick={() => setNewPrinting(null)}
                    >
                      Keep original
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="gg-editcurrent">
                <div className="gg-editcurrent__art">
                  <InventoryCardImage item={item} size="md" loadingPriority="eager" />
                </div>
                <div className="gg-editcurrent__meta">
                  <div className="gg-detail__setline">
                    <span className="gg-detail__setname">{item.setName}</span>
                    <span className="gg-detail__setmeta">
                      {item.setCode} · #{item.collectorNumber}
                    </span>
                  </div>
                  <div className="gg-detail__chips">
                    <Badge tone={rarityTone(item.rarity)}>
                      {rarityLabel(item.rarity)}
                    </Badge>
                    <span className="gg-chip">{CONDITION_LABELS[item.condition]}</span>
                    <span className="gg-chip">{FINISH_LABELS[item.finish]}</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="search"
                    onClick={() => setPicking(true)}
                  >
                    Change printing / art
                  </Button>
                </div>
              </div>
            )}

            {/* Editable fields */}
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
                hint={
                  newPrinting
                    ? "Constrained to this printing's finishes."
                    : undefined
                }
              >
                {finishOptions.map((f) => (
                  <option key={f} value={f}>
                    {FINISH_LABELS[f]}
                  </option>
                ))}
              </SelectField>
              <TextField
                label="Price (USD)"
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                hint={
                  item.scryfallPriceCents != null
                    ? `Scryfall ref: ${formatCents(item.scryfallPriceCents)}`
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
              <TextField
                label="SKU"
                placeholder="Optional"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
              <SelectField
                label="Storefront placement"
                value={storefrontPlacement}
                onChange={(e) => setStorefrontPlacement(e.target.value as "main" | "deals")}
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
                      centsFromInput(price) > 0
                        ? `Regular ${formatCents(centsFromInput(price))} → Deal ${formatCents(
                            Math.max(
                              1,
                              Math.round(
                                (centsFromInput(price) *
                                  (100 - Math.max(1, Math.min(90, Number(dealDiscount) || 20)))) /
                                  100,
                              ),
                            ),
                          )}`
                        : undefined
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

            <p className="gg-muted gg-editnote">
              <Icon name="info" size={14} /> Quantity isn't edited here. Use the
              quantity controls on the card detail so every change is recorded in
              the movement ledger.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}