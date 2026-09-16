import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Icon } from "../components/ui/Icon";
import { SearchInput, SelectField, TextField } from "../components/ui/Field";
import { DataTable, type Column } from "../components/ui/DataTable";
import { InventoryCardImage } from "../components/cards/InventoryCardImage";
import { CardPrintingBadges } from "../components/cards/CardPrintingBadges";
import { Pagination } from "../components/ui/Nav";
import { TableSkeleton, ErrorState, EmptyState } from "../components/ui/States";
import { Modal } from "../components/ui/Modal";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { AddInventoryDrawer } from "./AddInventoryDrawer";
import { EditInventoryDrawer } from "./EditInventoryDrawer";
import { ImportInventoryModal } from "./ImportInventoryModal";
import { useAsync } from "../hooks/useAsync";
import { useCurrentAdmin } from "../hooks/useCurrentAdmin";
import { useToast } from "../hooks/useToast";
import {
  inventoryRepository,
  reservationRepository,
  userRepository,
} from "../repositories";
import { formatCents, formatDateTime, timeAgo, fullName } from "../utils/format";
import {
  CONDITION_LABELS,
  FINISH_LABELS,
  RARITY_LABELS,
  rarityLabel,
  rarityTone,
  LISTING_STATUS_LABELS,
  LISTING_STATUS_TONE,
  MOVEMENT_REASON_LABELS,
} from "../utils/labels";
import type {
  CardCondition,
  CardFinish,
  Customer,
  CustomerReservations,
  FloorableRarity,
  InventoryItem,
  InventoryMovement,
  InventoryQuery,
} from "../types";

const PAGE_SIZE = 10;

/**
 * The inventory "state" tabs. Each tab maps to a specific (status, stock)
 * combination executed IN THE DATABASE by admin_search_inventory, so a tab
 * never downloads rows it will only hide:
 *   in_stock     → status active, quantity > 0   (default working set)
 *   out_of_stock → status active, quantity == 0  (restock queue)
 *   reserved     → a USER-CENTRIC view of active reservations (own component,
 *                  NOT an inventory_items query — reservations are a separate,
 *                  quantity-aware model layered on top of physical stock)
 *   archived     → status archived               (reversible, history kept)
 */
type InventoryTab = "in_stock" | "out_of_stock" | "reserved" | "archived";

interface TabDef {
  key: InventoryTab;
  label: string;
  status: InventoryQuery["status"];
  stock: InventoryQuery["stock"];
}

const TABS: TabDef[] = [
  { key: "in_stock", label: "In Stock", status: "active", stock: "in" },
  { key: "out_of_stock", label: "Out of Stock", status: "active", stock: "out" },
  { key: "reserved", label: "Reserved", status: "active", stock: "all" },
  { key: "archived", label: "Archived", status: "archived", stock: "all" },
];

export function InventoryPage({
  query,
  onNavigate,
}: {
  query: URLSearchParams;
  onNavigate: (path: string) => void;
}) {
  const toast = useToast();

  // Deep-link ?stock=low still lands on In Stock with the low-stock sub-filter.
  const initialTab: InventoryTab = "in_stock";
  const [tab, setTab] = useState<InventoryTab>(initialTab);

  const [search, setSearch] = useState("");
  // Sub-filter within the In-Stock tab: all in-stock vs. low stock only.
  const [lowOnly, setLowOnly] = useState<boolean>(query.get("stock") === "low");
  const [condition, setCondition] = useState<CardCondition | "all">("all");
  const [finish, setFinish] = useState<CardFinish | "all">("all");
  const [setCode, setSetCode] = useState<string>("all");
  const [sortBy, setSortBy] = useState<NonNullable<InventoryQuery["sortBy"]>>("updated");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<InventoryItem | null>(null);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<InventoryItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);
  const [reserveTarget, setReserveTarget] = useState<InventoryItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [priceFloorsOpen, setPriceFloorsOpen] = useState(false);

  const setOptions = useAsync(() => inventoryRepository.setOptions(), []);

  const activeTab = TABS.find((t) => t.key === tab) ?? TABS[0];

  // The In-Stock tab's low-stock sub-filter narrows stock from "in" to "low".
  const effectiveStock: InventoryQuery["stock"] =
    tab === "in_stock" && lowOnly ? "low" : activeTab.stock;

  const q: InventoryQuery = useMemo(
    () => ({
      search: search.trim() || undefined,
      status: activeTab.status,
      stock: effectiveStock,
      condition,
      finish,
      setCode,
      sortBy,
      sortDir,
      page,
      pageSize: PAGE_SIZE,
    }),
    [
      search,
      activeTab.status,
      effectiveStock,
      condition,
      finish,
      setCode,
      sortBy,
      sortDir,
      page,
    ],
  );

  const inv = useAsync(
    () =>
      tab === "reserved"
        ? Promise.resolve({ rows: [], total: 0 })
        : inventoryRepository.list(q),
    [q, tab],
  );

  // Reset to page 1 when filters or the tab change.
  useEffect(() => {
    setPage(1);
  }, [search, tab, lowOnly, condition, finish, setCode, sortBy, sortDir]);

  // Deep-link: ?item=<id> opens detail.
  useEffect(() => {
    const id = query.get("item");
    if (id) {
      inventoryRepository.get(id).then((item) => {
        if (item) setDetailItem(item);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function handleSort(key: string) {
    const k = key as NonNullable<InventoryQuery["sortBy"]>;
    if (sortBy === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(k);
      setSortDir(k === "name" ? "asc" : "desc");
    }
  }

  const rows = inv.data?.rows ?? [];
  const total = inv.data?.total ?? 0;

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelectedIds((prev) => {
      if (rows.every((r) => prev.has(r.id))) {
        const next = new Set(prev);
        rows.forEach((r) => next.delete(r.id));
        return next;
      }
      const next = new Set(prev);
      rows.forEach((r) => next.add(r.id));
      return next;
    });
  }

  function exportCsv() {
    const header = [
      "Card",
      "Set",
      "Collector #",
      "Condition",
      "Finish",
      "Quantity",
      "Price",
      "Status",
    ];
    const lines = rows.map((r) =>
      [
        r.cardName,
        r.setCode,
        r.collectorNumber,
        r.condition,
        r.finish,
        r.quantity,
        (r.priceCents / 100).toFixed(2),
        r.status,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "geega-inventory.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} rows to CSV.`);
  }

  // Refresh helpers so a detail/edit/delete action reflects immediately and
  // keeps the selected detail item's data current.
  async function refreshDetail(id: string) {
    const fresh = await inventoryRepository.get(id);
    setDetailItem(fresh);
    inv.reload();
  }

  const columns: Column<InventoryItem>[] = [
    {
      key: "card",
      header: "Card",
      sortKey: "name",
      render: (r) => (
        <div className="gg-cardcell">
          <InventoryCardImage item={r} size="xs" />
          <div className="gg-cardcell__text">
            <span className="gg-cardcell__name">{r.cardName}</span>
            <span className="gg-cardcell__set">
              {r.setName ?? r.setCode} · #{r.collectorNumber} ·{" "}
              <Badge tone={rarityTone(r.rarity)}>{rarityLabel(r.rarity)}</Badge>
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "cond",
      header: "Cond.",
      render: (r) => <span title={CONDITION_LABELS[r.condition]}>{r.condition}</span>,
    },
    {
      key: "finish",
      header: "Finish",
      secondary: true,
      render: (r) => FINISH_LABELS[r.finish],
    },
    {
      key: "qty",
      header: "Qty",
      sortKey: "quantity",
      align: "right",
      render: (r) => (
        <span
          className={
            r.quantity === 0
              ? "gg-qty gg-qty--out"
              : r.quantity <= 2
                ? "gg-qty gg-qty--low"
                : "gg-qty"
          }
        >
          {r.quantity}
        </span>
      ),
    },
    {
      key: "price",
      header: "Price",
      sortKey: "price",
      align: "right",
      render: (r) => formatCents(r.priceCents),
    },
    {
      key: "status",
      header: "Status",
      secondary: true,
      render: (r) => (
        <Badge tone={LISTING_STATUS_TONE[r.status]}>
          {LISTING_STATUS_LABELS[r.status]}
        </Badge>
      ),
    },
    {
      key: "updated",
      header: "Updated",
      sortKey: "updated",
      secondary: true,
      align: "right",
      render: (r) => <span title={formatDateTime(r.updatedAt)}>{timeAgo(r.updatedAt)}</span>,
    },
  ];

  const activeFilters =
    condition !== "all" ||
    finish !== "all" ||
    setCode !== "all" ||
    (tab === "in_stock" && lowOnly) ||
    search.trim() !== "";

  function clearFilters() {
    setSearch("");
    setCondition("all");
    setFinish("all");
    setSetCode("all");
    setLowOnly(false);
  }

  const emptyCopy: Record<InventoryTab, { title: string; message: string }> = {
    in_stock: {
      title: "No cards in stock",
      message: "Add your first card, or check the Out of Stock tab to restock.",
    },
    out_of_stock: {
      title: "Nothing out of stock",
      message: "Every active card currently has stock on hand. Nice.",
    },
    reserved: {
      title: "No reserved cards",
      message: "Cards held for open orders will appear here.",
    },
    archived: {
      title: "No archived cards",
      message: "Archived cards are hidden from the storefront but kept here.",
    },
  };

  return (
    <div className="gg-page">
      <PageHeader
        title="Inventory"
        description="Every sellable line — one printing, condition, and finish per row."
        actions={
          <div className="gg-btn-row">
            <Button
              variant="secondary"
              icon="dollar"
              onClick={() => setPriceFloorsOpen(true)}
            >
              Price floors
            </Button>
            <Button variant="secondary" icon="upload" onClick={() => setImportOpen(true)}>
              Import
            </Button>
            <Button
              variant="secondary"
              icon="download"
              onClick={exportCsv}
              disabled={rows.length === 0}
            >
              Export
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setAddOpen(true)}>
              Add card
            </Button>
          </div>
        }
      />

      {/* Inventory state tabs: In Stock | Out of Stock | Reserved | Archived */}
      <div className="gg-tabs" role="tablist" aria-label="Inventory state">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? "gg-tab gg-tab--active" : "gg-tab"}
            onClick={() => {
              setTab(t.key);
              setSelectedIds(new Set());
              if (t.key !== "in_stock") setLowOnly(false);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "reserved" ? (
        <ReservedView onNavigate={onNavigate} />
      ) : (
      <SectionCard title="">
        <div className="gg-filters">
          <SearchInput
            label="Search inventory"
            placeholder="Search by card name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="gg-filters__selects">
            {tab === "in_stock" && (
              <SelectField
                label="Stock level"
                value={lowOnly ? "low" : "in"}
                onChange={(e) => setLowOnly(e.target.value === "low")}
              >
                <option value="in">All in stock</option>
                <option value="low">Low stock only</option>
              </SelectField>
            )}
            <SelectField
              label="Condition"
              value={condition}
              onChange={(e) => setCondition(e.target.value as typeof condition)}
            >
              <option value="all">Any condition</option>
              {(["NM", "LP", "MP", "HP", "DMG"] as CardCondition[]).map((c) => (
                <option key={c} value={c}>
                  {CONDITION_LABELS[c]}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Finish"
              value={finish}
              onChange={(e) => setFinish(e.target.value as typeof finish)}
            >
              <option value="all">Any finish</option>
              {(["nonfoil", "foil", "etched", "glossy"] as CardFinish[]).map((f) => (
                <option key={f} value={f}>
                  {FINISH_LABELS[f]}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Set"
              value={setCode}
              onChange={(e) => setSetCode(e.target.value)}
            >
              <option value="all">All sets</option>
              {(setOptions.data ?? []).map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </SelectField>
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="gg-bulkbar" role="region" aria-label="Bulk actions">
            <span className="gg-bulkbar__count">{selectedIds.size} selected</span>
            <div className="gg-bulkbar__actions">
              <Button variant="ghost" size="sm" icon="download" onClick={exportCsv}>
                Export selected
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </Button>
            </div>
          </div>
        )}

        {inv.loading ? (
          <TableSkeleton rows={8} cols={7} />
        ) : inv.error ? (
          <ErrorState message="Could not load inventory." onRetry={inv.reload} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={activeFilters ? "search" : "inventory"}
            title={activeFilters ? "No matches" : emptyCopy[tab].title}
            message={
              activeFilters
                ? "Try adjusting or clearing your filters."
                : emptyCopy[tab].message
            }
            action={
              activeFilters ? (
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : tab === "in_stock" ? (
                <Button variant="primary" icon="plus" onClick={() => setAddOpen(true)}>
                  Add card
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              onRowClick={(r) => setDetailItem(r)}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={handleSort}
              selectable
              selectedIds={selectedIds}
              onToggleRow={toggleRow}
              onToggleAll={toggleAll}
              caption="Inventory items"
            />
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          </>
        )}
      </SectionCard>
      )}

      <AddInventoryDrawer
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={() => {
          inv.reload();
          setOptions.reload();
        }}
      />

      <EditInventoryDrawer
        open={!!editItem}
        item={editItem}
        onClose={() => setEditItem(null)}
        onSaved={(updated) => {
          setEditItem(null);
          setDetailItem(updated);
          inv.reload();
          setOptions.reload();
        }}
      />

      <InventoryDetail
        item={detailItem}
        onClose={() => {
          setDetailItem(null);
          if (query.get("item")) onNavigate("/admin_dashboard/inventory");
        }}
        onEdit={(it) => setEditItem(it)}
        onArchive={(it) => setArchiveTarget(it)}
        onDelete={(it) => setDeleteTarget(it)}
        onReserve={(it) => setReserveTarget(it)}
        onRestore={async (it) => {
          await inventoryRepository.restore(it.id);
          toast.success(`${it.cardName} restored to active.`);
          await refreshDetail(it.id);
        }}
        onChanged={(id) => refreshDetail(id)}
      />

      <ConfirmDialog
        open={!!archiveTarget}
        title="Archive this card?"
        message={
          archiveTarget
            ? `${archiveTarget.cardName} (${archiveTarget.condition}, ${FINISH_LABELS[archiveTarget.finish]}) will be hidden from the storefront. Its history is preserved and it can be restored later.`
            : ""
        }
        confirmLabel="Archive"
        tone="danger"
        onConfirm={async () => {
          if (!archiveTarget) return;
          await inventoryRepository.archive(archiveTarget.id);
          toast.success(`${archiveTarget.cardName} archived.`);
          setArchiveTarget(null);
          setDetailItem(null);
          inv.reload();
        }}
        onCancel={() => setArchiveTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Permanently delete this card?"
        message={
          deleteTarget
            ? `${deleteTarget.cardName} (${deleteTarget.condition}, ${FINISH_LABELS[deleteTarget.finish]}) will be permanently removed from inventory, including its movement history. This cannot be undone. If this card has ever appeared on an order, deletion is blocked — archive it instead. Only delete lines entered by mistake.`
            : ""
        }
        confirmLabel="Delete permanently"
        tone="danger"
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await inventoryRepository.delete(deleteTarget.id);
            toast.success(`${deleteTarget.cardName} permanently deleted.`);
            setDeleteTarget(null);
            setDetailItem(null);
            inv.reload();
            setOptions.reload();
          } catch (err) {
            // Blocked (409) or other error — keep the dialog context but inform.
            setDeleteTarget(null);
            toast.error(
              err instanceof Error
                ? err.message
                : "Could not delete this card.",
            );
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <ImportInventoryModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          inv.reload();
          setOptions.reload();
        }}
      />
      <PriceFloorsModal
        open={priceFloorsOpen}
        onClose={() => setPriceFloorsOpen(false)}
        onSaved={() => {}}
      />
      <ReserveModal
        item={reserveTarget}
        open={!!reserveTarget}
        onClose={() => setReserveTarget(null)}
        onReserved={() => {
          if (reserveTarget) refreshDetail(reserveTarget.id);
          inv.reload();
        }}
      />
    </div>
  );
}

/* --------------------------- Detail drawer --------------------------- */

function InventoryDetail({
  item,
  onClose,
  onEdit,
  onArchive,
  onDelete,
  onReserve,
  onRestore,
  onChanged,
}: {
  item: InventoryItem | null;
  onClose: () => void;
  onEdit: (item: InventoryItem) => void;
  onArchive: (item: InventoryItem) => void;
  onDelete: (item: InventoryItem) => void;
  onReserve: (item: InventoryItem) => void;
  onRestore: (item: InventoryItem) => void | Promise<void>;
  onChanged: (id: string) => void;
}) {
  const toast = useToast();
  const currentAdmin = useCurrentAdmin();
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [adjust, setAdjust] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (item) {
      inventoryRepository.movements(item.id).then(setMovements);
      setAdjust("");
    }
  }, [item]);

  if (!item) return null;

  async function applyAdjust(delta: number) {
    if (!item || delta === 0) return;
    setBusy(true);
    try {
      await inventoryRepository.adjustQuantity(
        item.id,
        delta,
        delta > 0 ? "manual_add" : "manual_remove",
        currentAdmin.name,
      );
      toast.success(
        `${delta > 0 ? "Added" : "Removed"} ${Math.abs(delta)} — ${item.cardName}.`,
      );
      const fresh = await inventoryRepository.movements(item.id);
      setMovements(fresh);
      onChanged(item.id);
    } catch {
      toast.error("Could not adjust quantity.");
    } finally {
      setBusy(false);
    }
  }

  const isOutOfStock = item.quantity === 0 && item.status === "active";
  const isArchived = item.status === "archived";

  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title={item.cardName}
      variant="drawer"
      size="md"
      headerExtra={
        <Badge tone={LISTING_STATUS_TONE[item.status]}>
          {isOutOfStock ? "Out of Stock" : LISTING_STATUS_LABELS[item.status]}
        </Badge>
      }
      footer={
        <div className="gg-drawer-actions">
          <div className="gg-drawer-actions__left">
            <Button
              variant="danger"
              icon="trash"
              onClick={() => onDelete(item)}
            >
              Delete
            </Button>
          </div>
          <div className="gg-drawer-actions__buttons">
            {isArchived ? (
              <Button
                variant="secondary"
                icon="check"
                onClick={() => onRestore(item)}
              >
                Restore
              </Button>
            ) : (
              <Button
                variant="secondary"
                icon="trash"
                onClick={() => onArchive(item)}
              >
                Archive
              </Button>
            )}
            {!isArchived && item.quantity > 0 && (
              <Button
                variant="secondary"
                icon="box"
                onClick={() => onReserve(item)}
              >
                Reserve
              </Button>
            )}
            <Button variant="primary" icon="edit" onClick={() => onEdit(item)}>
              Edit
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      }
    >
      <div className="gg-detail">
        {isOutOfStock && (
          <div className="gg-inline-note gg-inline-note--warning" role="status">
            <Icon name="warning" size={18} />
            <div>
              This card is <strong>out of stock</strong> and hidden from the
              storefront. Add quantity below to restock it — it returns to In
              Stock and the storefront automatically.
            </div>
          </div>
        )}

        <div className="gg-detail__hero gg-detail__hero--card">
          <div className="gg-detail__art">
            <InventoryCardImage item={item} size="md" loadingPriority="eager" />
          </div>
          <div className="gg-detail__heroinfo">
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
              <CardPrintingBadges
                card={{
                  scryfallId: item.scryfallId ?? null,
                  setCode: item.setCode,
                  collectorNumber: item.collectorNumber,
                  imageUrl: item.imageUrl,
                  cardName: item.cardName,
                  finish: item.finish,
                }}
              />
            </div>
            <div className="gg-priceblock">
              <div className="gg-priceblock__main">
                <span className="gg-priceblock__label">Selling price</span>
                <span className="gg-priceblock__value">
                  {formatCents(item.priceCents)}
                </span>
              </div>
              {item.scryfallPriceCents != null && (
                <div className="gg-priceblock__ref">
                  <span className="gg-priceblock__label">Scryfall ref.</span>
                  <span className="gg-priceblock__refvalue">
                    {formatCents(item.scryfallPriceCents)}
                  </span>
                </div>
              )}
            </div>
            {item.storageLocation && (
              <div className="gg-detail__location">
                <Icon name="box" size={14} />
                <span>{item.storageLocation}</span>
              </div>
            )}
          </div>
        </div>

        <div className="gg-adjust">
          <div className="gg-adjust__now">
            <span className="gg-adjust__label">On hand</span>
            <span className="gg-adjust__qty">{item.quantity}</span>
          </div>
          <div className="gg-adjust__controls">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => applyAdjust(-1)}
              loading={busy}
              disabled={item.quantity === 0}
              aria-label="Remove one"
            >
              −1
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => applyAdjust(1)}
              loading={busy}
              aria-label="Add one"
            >
              +1
            </Button>
            <input
              className="gg-input gg-adjust__input"
              type="number"
              placeholder="±"
              value={adjust}
              onChange={(e) => setAdjust(e.target.value)}
              aria-label="Custom adjustment"
            />
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              onClick={() => {
                const n = Number.parseInt(adjust, 10);
                if (Number.isFinite(n) && n !== 0) applyAdjust(n);
              }}
            >
              {isOutOfStock ? "Restock" : "Apply"}
            </Button>
          </div>
        </div>

        <div className="gg-detail__section">
          <h3 className="gg-detail__h3">Movement history</h3>
          {movements.length === 0 ? (
            <p className="gg-muted">No movements recorded yet.</p>
          ) : (
            <ul className="gg-ledger">
              {movements.map((mv) => (
                <li key={mv.id} className="gg-ledger__row">
                  <span
                    className={`gg-ledger__delta ${
                      mv.delta >= 0 ? "gg-ledger__delta--pos" : "gg-ledger__delta--neg"
                    }`}
                  >
                    {mv.delta >= 0 ? "+" : ""}
                    {mv.delta}
                  </span>
                  <span className="gg-ledger__body">
                    <span className="gg-ledger__reason">
                      {MOVEMENT_REASON_LABELS[mv.reason]}
                      {mv.relatedOrderNumber && ` · ${mv.relatedOrderNumber}`}
                    </span>
                    <span className="gg-ledger__meta">
                      {mv.previousQuantity} → {mv.resultingQuantity} ·{" "}
                      {mv.actor ?? "System"} · {timeAgo(mv.createdAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
/* --------------------------- Reserved tab --------------------------- */

/**
 * USER-CENTRIC reserved view. Active reservations are grouped by customer (a
 * separate model from physical inventory_items). Releasing a hold — one line, a
 * partial quantity, or everything for a customer — immediately frees the copies
 * on the storefront because inventory_public subtracts ONLY active reservations.
 */
function ReservedView({ onNavigate }: { onNavigate: (path: string) => void }) {
  const toast = useToast();
  const groups = useAsync(() => reservationRepository.listGrouped(), []);
  const [releaseAllTarget, setReleaseAllTarget] =
    useState<CustomerReservations | null>(null);
  const [releaseOneId, setReleaseOneId] = useState<string | null>(null);

  const data = groups.data ?? [];

  async function releaseOne(reservationId: string, cardName: string) {
    try {
      await reservationRepository.release(reservationId);
      toast.success(`Released reservation — ${cardName}.`);
      groups.reload();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not release the reservation.",
      );
    } finally {
      setReleaseOneId(null);
    }
  }

  async function reduceOne(
    reservationId: string,
    cardName: string,
    qty: number,
  ) {
    try {
      await reservationRepository.release(reservationId, qty);
      toast.success(`Released ${qty} — ${cardName}.`);
      groups.reload();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not release the quantity.",
      );
    }
  }

  return (
    <SectionCard title="">
      {groups.loading ? (
        <TableSkeleton rows={4} cols={3} />
      ) : groups.error ? (
        <ErrorState
          message="Could not load reservations."
          onRetry={groups.reload}
        />
      ) : data.length === 0 ? (
        <EmptyState
          icon="inventory"
          title="No reserved cards"
          message="Reserve a card from its detail view to hold stock for a customer."
        />
      ) : (
        <div className="gg-reserved">
          {data.map((group) => {
            const name =
              fullName(
                group.customerFirstName ?? "",
                group.customerLastName ?? "",
              ) || group.customerEmail;
            return (
              <div key={group.customerId} className="gg-reserved__group">
                <div className="gg-reserved__grouphead">
                  <div className="gg-reserved__customer">
                    <button
                      className="gg-link gg-reserved__name"
                      onClick={() =>
                        onNavigate(
                          `/admin_dashboard/users?customer=${group.customerId}`,
                        )
                      }
                    >
                      {name}
                    </button>
                    <span className="gg-reserved__email">
                      {group.customerEmail}
                    </span>
                  </div>
                  <div className="gg-reserved__groupmeta">
                    <Badge tone="info">
                      {group.totalQuantity} card
                      {group.totalQuantity === 1 ? "" : "s"} reserved
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setReleaseAllTarget(group)}
                    >
                      Unreserve all
                    </Button>
                  </div>
                </div>

                <ul className="gg-reserved__list">
                  {group.reservations.map((r) => (
                    <li key={r.id} className="gg-reserved__item">
                      <div className="gg-reserved__card">
                        <InventoryCardImage
                          item={{
                            imageUrl: r.imageUrl,
                            scryfallId: null,
                            cardName: r.cardName,
                            setCode: r.setCode,
                            collectorNumber: r.collectorNumber,
                            finish: r.finish,
                          } as unknown as InventoryItem}
                          size="xs"
                        />
                        <div className="gg-reserved__cardtext">
                          <span className="gg-reserved__cardname">
                            {r.cardName}
                          </span>
                          <span className="gg-reserved__cardmeta">
                            {r.setName ?? r.setCode} · #{r.collectorNumber} ·{" "}
                            {r.condition} · {FINISH_LABELS[r.finish]}
                          </span>
                          <span className="gg-reserved__cardmeta gg-muted">
                            Qty {r.quantity} · reserved {timeAgo(r.reservedAt)}
                          </span>
                        </div>
                      </div>
                      <div className="gg-reserved__actions">
                        {r.quantity > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => reduceOne(r.id, r.cardName, 1)}
                            title="Release one copy"
                          >
                            −1
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setReleaseOneId(r.id)}
                        >
                          Unreserve
                        </Button>
                      </div>

                      <ConfirmDialog
                        open={releaseOneId === r.id}
                        title="Unreserve this card?"
                        message={`${r.quantity} × ${r.cardName} (${r.condition}, ${FINISH_LABELS[r.finish]}) will be released back to the storefront immediately.`}
                        confirmLabel="Unreserve"
                        tone="danger"
                        onConfirm={() => releaseOne(r.id, r.cardName)}
                        onCancel={() => setReleaseOneId(null)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!releaseAllTarget}
        title="Unreserve everything for this customer?"
        message={
          releaseAllTarget
            ? `All ${releaseAllTarget.totalQuantity} reserved card${
                releaseAllTarget.totalQuantity === 1 ? "" : "s"
              } for ${
                fullName(
                  releaseAllTarget.customerFirstName ?? "",
                  releaseAllTarget.customerLastName ?? "",
                ) || releaseAllTarget.customerEmail
              } will be released back to the storefront immediately.`
            : ""
        }
        confirmLabel="Unreserve all"
        tone="danger"
        onConfirm={async () => {
          if (!releaseAllTarget) return;
          try {
            const n = await reservationRepository.releaseAllForCustomer(
              releaseAllTarget.customerId,
            );
            toast.success(
              `Released ${n} reservation${n === 1 ? "" : "s"}.`,
            );
            groups.reload();
          } catch (err) {
            toast.error(
              err instanceof Error
                ? err.message
                : "Could not release reservations.",
            );
          } finally {
            setReleaseAllTarget(null);
          }
        }}
        onCancel={() => setReleaseAllTarget(null)}
      />
    </SectionCard>
  );
}

/* --------------------------- Reserve modal --------------------------- */

/**
 * Reserve stock for a customer from an active inventory line. Shows the current
 * SELLABLE availability (on hand minus active reservations) and never lets the
 * admin request more than that — the server also re-checks atomically, so the
 * client math is a convenience, not the authority.
 */
function ReserveModal({
  item,
  open,
  onClose,
  onReserved,
}: {
  item: InventoryItem | null;
  open: boolean;
  onClose: () => void;
  onReserved: () => void;
}) {
  const toast = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [search, setSearch] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reservedQty, setReservedQty] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !item) return;
    setCustomerId("");
    setSearch("");
    setQuantity("1");
    setLoading(true);
    Promise.all([
      userRepository.listCustomers({ accountStatus: "active" }),
      reservationRepository.listForItem(item.id),
    ])
      .then(([cs, rs]) => {
        setCustomers(cs);
        setReservedQty(rs.reduce((sum, r) => sum + r.quantity, 0));
      })
      .catch(() => {
        toast.error("Could not load reservation data.");
      })
      .finally(() => setLoading(false));
  }, [open, item, toast]);

  if (!item) return null;

  const available = Math.max(0, item.quantity - reservedQty);
  const filtered = customers.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.email.toLowerCase().includes(q) ||
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(q)
    );
  });

  async function submit() {
    if (!item) return;
    if (!customerId) {
      toast.error("Choose a customer.");
      return;
    }
    const n = Number.parseInt(quantity, 10);
    if (!Number.isFinite(n) || n < 1) {
      toast.error("Enter a quantity of at least 1.");
      return;
    }
    if (n > available) {
      toast.error(`Only ${available} available to reserve.`);
      return;
    }
    setBusy(true);
    try {
      await reservationRepository.create({
        inventoryItemId: item.id,
        customerId,
        quantity: n,
      });
      toast.success(`Reserved ${n} × ${item.cardName}.`);
      onReserved();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not reserve the card.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Reserve — ${item.cardName}`}
      size="sm"
      footer={
        <div className="gg-drawer-actions__buttons">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={available === 0}
            onClick={submit}
          >
            Reserve
          </Button>
        </div>
      }
    >
      <div className="gg-detail">
        <div className="gg-inline-note" role="status">
          <Icon name="box" size={16} />
          <div>
            <strong>{available}</strong> available to reserve
            <span className="gg-muted">
              {" "}
              ({item.quantity} on hand
              {reservedQty > 0 ? `, ${reservedQty} already reserved` : ""})
            </span>
          </div>
        </div>

        {loading ? (
          <p className="gg-muted">Loading customers…</p>
        ) : (
          <>
            <SearchInput
              label="Find customer"
              placeholder="Name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <SelectField
              label="Customer"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">Select a customer…</option>
              {filtered.map((c) => (
                <option key={c.id} value={c.id}>
                  {fullName(c.firstName, c.lastName) || c.email} · {c.email}
                </option>
              ))}
            </SelectField>
            {filtered.length === 0 && (
              <p className="gg-muted">
                No matching customers. Add one from the Users page first.
              </p>
            )}
            <TextField
              label="Quantity"
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              hint={`Up to ${available}.`}
            />
          </>
        )}
      </div>
    </Modal>
  );
}

const FLOOR_RARITIES: FloorableRarity[] = ["common", "uncommon", "rare", "mythic"];

function dollarsFromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}
function centsFromDollars(input: string): number {
  const n = Number.parseFloat(input);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
}

/**
 * Per-rarity minimum sell price. When staff price a card from its market
 * (Scryfall) reference — in Add Card or when matching a printing during
 * scan review — the suggested price is raised to this minimum if the
 * market price is below it. A price staff types in by hand is never
 * overridden, and existing inventory is never retroactively repriced.
 */
function PriceFloorsModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [values, setValues] = useState<Record<FloorableRarity, string>>({
    common: "0.00",
    uncommon: "0.00",
    rare: "0.00",
    mythic: "0.00",
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    inventoryRepository
      .getPriceFloors()
      .then((floors) => {
        const next = { common: "0.00", uncommon: "0.00", rare: "0.00", mythic: "0.00" };
        for (const f of floors) next[f.rarity] = dollarsFromCents(f.minPriceCents);
        setValues(next);
      })
      .catch(() => toast.error("Could not load price floors."))
      .finally(() => setLoading(false));
  }, [open, toast]);

  async function submit() {
    setSaving(true);
    try {
      await inventoryRepository.savePriceFloors({
        common: centsFromDollars(values.common),
        uncommon: centsFromDollars(values.uncommon),
        rare: centsFromDollars(values.rare),
        mythic: centsFromDollars(values.mythic),
      });
      toast.success("Price floors saved.");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save price floors.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Price floors"
      size="sm"
      footer={
        <div className="gg-drawer-actions__buttons">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={submit}>
            Save
          </Button>
        </div>
      }
    >
      <div className="gg-detail">
        <p className="gg-muted">
          Set a minimum sell price per rarity. When a card is priced from its market
          (Scryfall) reference — in Add Card or when matching a scan — the suggested
          price is raised to this minimum if the market price is below it. Leave a
          rarity at $0.00 for no minimum. This never changes existing inventory or a
          price you type in yourself.
        </p>
        {loading ? (
          <p className="gg-muted">Loading…</p>
        ) : (
          FLOOR_RARITIES.map((rarity) => (
            <TextField
              key={rarity}
              label={RARITY_LABELS[rarity]}
              type="number"
              min={0}
              step="0.01"
              value={values[rarity]}
              onChange={(e) =>
                setValues((v) => ({ ...v, [rarity]: e.target.value }))
              }
            />
          ))
        )}
      </div>
    </Modal>
  );
}