import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import { Icon } from "../ui/Icon";
import { inventoryRepository } from "../../repositories";
import { useToast } from "../../hooks/useToast";

type PriceMode = "none" | "set" | "percent";

// Applies the same field edit(s) across every selected inventory line in one
// call. Each field is independent: leaving one blank keeps it unchanged for
// every row. A percentage adjustment is computed server-side against each
// row's OWN current price — never a value trusted from this form.
export function InventoryBulkEditModal({
  open,
  onClose,
  itemIds,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  itemIds: string[];
  onApplied: (updatedCount: number) => void;
}) {
  const count = itemIds.length;
  const toast = useToast();
  const [priceMode, setPriceMode] = useState<PriceMode>("none");
  const [priceValue, setPriceValue] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setPriceMode("none");
    setPriceValue("");
    setLocation("");
  }

  async function apply(status?: "active" | "archived") {
    const patch: Parameters<typeof inventoryRepository.bulkUpdate>[1] = {};
    if (status) patch.status = status;
    if (priceMode === "set" && priceValue.trim()) {
      const cents = Math.round(Number(priceValue) * 100);
      if (!Number.isFinite(cents) || cents < 0) {
        toast.error("Enter a valid price.");
        return;
      }
      patch.priceCents = cents;
    } else if (priceMode === "percent" && priceValue.trim()) {
      const percent = Number(priceValue);
      if (!Number.isFinite(percent) || percent <= -100) {
        toast.error("Enter a valid percentage (greater than -100).");
        return;
      }
      patch.priceAdjustPercent = percent;
    }
    if (location.trim()) patch.storageLocation = location.trim();

    if (Object.keys(patch).length === 0) {
      toast.error("Choose at least one change to apply.");
      return;
    }

    setBusy(true);
    try {
      const { updatedCount } = await inventoryRepository.bulkUpdate(itemIds, patch);
      toast.success(
        `Updated ${updatedCount} card${updatedCount === 1 ? "" : "s"}.`,
      );
      onApplied(updatedCount);
      reset();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not apply the bulk edit.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Bulk edit ${count} card${count === 1 ? "" : "s"}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="ghost"
            icon="package"
            onClick={() => apply("archived")}
            loading={busy}
          >
            Archive selected
          </Button>
          <Button variant="primary" onClick={() => apply()} loading={busy}>
            Apply
          </Button>
        </>
      }
    >
      <div className="gg-form-stack">
        <div className="gg-inline-note gg-inline-note--warning">
          <Icon name="warning" size={16} />
          <div>
            Changes apply to all {count} selected cards at once. A price
            change is computed against each card's own current price, so a
            percentage adjustment never sets every card to the same amount.
          </div>
        </div>

        <div className="gg-radiorow">
          <label className="gg-check-inline">
            <input
              type="radio"
              name="bulk-price-mode"
              checked={priceMode === "none"}
              onChange={() => setPriceMode("none")}
            />
            Leave price unchanged
          </label>
          <label className="gg-check-inline">
            <input
              type="radio"
              name="bulk-price-mode"
              checked={priceMode === "set"}
              onChange={() => setPriceMode("set")}
            />
            Set every card to a fixed price
          </label>
          <label className="gg-check-inline">
            <input
              type="radio"
              name="bulk-price-mode"
              checked={priceMode === "percent"}
              onChange={() => setPriceMode("percent")}
            />
            Adjust by a percentage
          </label>
        </div>

        {priceMode !== "none" && (
          <TextField
            label={priceMode === "set" ? "Price (USD)" : "Adjustment (%, negative to lower)"}
            type="number"
            step={priceMode === "set" ? 0.01 : 1}
            value={priceValue}
            onChange={(e) => setPriceValue(e.target.value)}
            placeholder={priceMode === "set" ? "0.00" : "e.g. -10 or 15"}
          />
        )}

        <TextField
          label="Storage location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Leave blank to keep"
        />
      </div>
    </Modal>
  );
}
