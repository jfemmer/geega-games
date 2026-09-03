import { useEffect, useMemo, useState } from "react";
import { Modal } from "../components/ui/Modal";
import { Button } from "../components/ui/Button";
import { TextField, TextArea, SelectField } from "../components/ui/Field";
import { Badge } from "../components/ui/Badge";
import { Icon } from "../components/ui/Icon";
import { Spinner } from "../components/ui/States";
import { inventoryRepository } from "../repositories";
import { useToast } from "../hooks/useToast";
import { CURRENT_ADMIN } from "../data/session.mock";
import { formatCents } from "../utils/format";
import {
  CONDITION_LABELS,
  FINISH_LABELS,
  RARITY_LABELS,
} from "../utils/labels";
import type {
  CardCondition,
  CardFinish,
  CardPrinting,
  InventoryItem,
} from "../types";

const CONDITIONS: CardCondition[] = ["NM", "LP", "MP", "HP", "DMG"];

function centsFromInput(dollars: string): number {
  const n = Number.parseFloat(dollars);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

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
  const [term, setTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [printings, setPrintings] = useState<CardPrinting[]>([]);
  const [selected, setSelected] = useState<CardPrinting | null>(null);

  const [condition, setCondition] = useState<CardCondition>("NM");
  const [finish, setFinish] = useState<CardFinish>("nonfoil");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [addAnother, setAddAnother] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dupe, setDupe] = useState<InventoryItem | null>(null);

  useEffect(() => {
    if (!open) {
      setTerm("");
      setPrintings([]);
      setSelected(null);
      resetForm();
    }
  }, [open]);

  function resetForm() {
    setCondition("NM");
    setFinish("nonfoil");
    setQuantity("1");
    setPrice("");
    setCost("");
    setLocation("");
    setNotes("");
    setDupe(null);
  }

  // Debounced printing search.
  useEffect(() => {
    if (!open) return;
    const q = term.trim();
    if (q.length < 2) {
      setPrintings([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      const res = await inventoryRepository.searchPrintings(q);
      setPrintings(res);
      setSearching(false);
    }, 250);
    return () => clearTimeout(handle);
  }, [term, open]);

  // Dupe detection when printing + condition + finish are chosen.
  useEffect(() => {
    let active = true;
    if (!selected) {
      setDupe(null);
      return;
    }
    inventoryRepository
      .findMatch(selected.setCode, selected.collectorNumber, condition, finish)
      .then((match) => {
        if (active) setDupe(match);
      });
    return () => {
      active = false;
    };
  }, [selected, condition, finish]);

  const finishOptions = useMemo(() => {
    const list = selected?.availableFinishes ?? ["nonfoil", "foil", "etched", "glossy"];
    return list.map((f) => ({ value: f, label: FINISH_LABELS[f] }));
  }, [selected]);

  useEffect(() => {
    if (selected && !selected.availableFinishes.includes(finish)) {
      setFinish(selected.availableFinishes[0] ?? "nonfoil");
    }
  }, [selected, finish]);

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
    setSaving(true);
    try {
      if (dupe) {
        await inventoryRepository.adjustQuantity(
          dupe.id,
          qty,
          "manual_add",
          CURRENT_ADMIN.name,
        );
        toast.success(
          `Added ${qty} to existing stock of ${dupe.cardName} (${condition}, ${FINISH_LABELS[finish]}).`,
        );
      } else {
        await inventoryRepository.create(
          {
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
            scryfallPriceCents: selected.scryfallPriceCents,
          },
          CURRENT_ADMIN.name,
        );
        toast.success(`Added ${selected.cardName} to inventory.`);
      }
      onSaved();
      if (addAnother) {
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
      size="md"
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
          <>
            <TextField
              label="Search for a card"
              placeholder="e.g. Ragavan, Lightning Bolt…"
              value={term}
              autoFocus
              onChange={(e) => setTerm(e.target.value)}
              hint="Search mirrors Scryfall in production; results are mocked here."
            />
            <div className="gg-printing-results">
              {searching && (
                <div className="gg-printing-loading">
                  <Spinner label="Searching printings" />
                </div>
              )}
              {!searching &&
                term.trim().length >= 2 &&
                printings.length === 0 && (
                  <p className="gg-muted">No printings match “{term}”.</p>
                )}
              {printings.map((p) => (
                <button
                  key={p.id}
                  className="gg-printing"
                  onClick={() => setSelected(p)}
                >
                  <img
                    src={p.imageUrl}
                    alt=""
                    className="gg-printing__img"
                    width={44}
                    height={61}
                  />
                  <span className="gg-printing__text">
                    <span className="gg-printing__name">{p.cardName}</span>
                    <span className="gg-printing__set">
                      {p.setName} ({p.setCode}) · #{p.collectorNumber} ·{" "}
                      {RARITY_LABELS[p.rarity]}
                    </span>
                  </span>
                  {p.scryfallPriceCents != null && (
                    <span className="gg-printing__price">
                      {formatCents(p.scryfallPriceCents)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="gg-selected-printing">
              <img
                src={selected.imageUrl}
                alt=""
                className="gg-selected-printing__img"
                width={64}
                height={89}
              />
              <div className="gg-selected-printing__meta">
                <div className="gg-selected-printing__name">
                  {selected.cardName}
                </div>
                <div className="gg-muted">
                  {selected.setName} ({selected.setCode}) · #
                  {selected.collectorNumber}
                </div>
                <div className="gg-selected-printing__tags">
                  <Badge tone="purple">{RARITY_LABELS[selected.rarity]}</Badge>
                  {selected.scryfallPriceCents != null && (
                    <span className="gg-muted">
                      Scryfall {formatCents(selected.scryfallPriceCents)}
                    </span>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon="close"
                onClick={() => setSelected(null)}
                aria-label="Choose a different card"
              >
                Change
              </Button>
            </div>

            {dupe && (
              <div className="gg-inline-note gg-inline-note--warning" role="status">
                <Icon name="warning" size={18} />
                <div>
                  You already stock this exact printing, condition, and finish (
                  {dupe.quantity} on hand). Saving will{" "}
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
            </div>
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
