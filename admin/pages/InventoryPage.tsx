import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Icon } from "../components/ui/Icon";
import { SearchInput, SelectField } from "../components/ui/Field";
import { DataTable, type Column } from "../components/ui/DataTable";
import { Pagination } from "../components/ui/Nav";
import { TableSkeleton, ErrorState, EmptyState } from "../components/ui/States";
import { Modal } from "../components/ui/Modal";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { AddInventoryDrawer } from "./AddInventoryDrawer";
import { useAsync } from "../hooks/useAsync";
import { useToast } from "../hooks/useToast";
import { inventoryRepository } from "../repositories";
import { formatCents, formatDateTime, timeAgo } from "../utils/format";
import {
  CONDITION_LABELS,
  FINISH_LABELS,
  RARITY_LABELS,
  RARITY_TONE,
  LISTING_STATUS_LABELS,
  LISTING_STATUS_TONE,
  MOVEMENT_REASON_LABELS,
} from "../utils/labels";
import type {
  CardCondition,
  CardFinish,
  InventoryItem,
  InventoryMovement,
  InventoryQuery,
  ListingStatus,
} from "../types";

const PAGE_SIZE = 10;

export function InventoryPage({
  query,
  onNavigate,
}: {
  query: URLSearchParams;
  onNavigate: (path: string) => void;
}) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ListingStatus | "all">("all");
  const [stock, setStock] = useState<"all" | "low" | "out">(
    (query.get("stock") as "low") ? "low" : "all",
  );
  const [condition, setCondition] = useState<CardCondition | "all">("all");
  const [finish, setFinish] = useState<CardFinish | "all">("all");
  const [setCode, setSetCode] = useState<string>("all");
  const [sortBy, setSortBy] = useState<NonNullable<InventoryQuery["sortBy"]>>("updated");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<InventoryItem | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<InventoryItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const setCodes = useAsync(() => inventoryRepository.setCodes(), []);

  const q: InventoryQuery = useMemo(
    () => ({
      search: search.trim() || undefined,
      status,
      stock,
      condition,
      finish,
      setCode,
      sortBy,
      sortDir,
      page,
      pageSize: PAGE_SIZE,
    }),
    [search, status, stock, condition, finish, setCode, sortBy, sortDir, page],
  );

  const inv = useAsync(() => inventoryRepository.list(q), [q]);

  // Reset to page 1 when filters change.
  useEffect(() => {
    setPage(1);
  }, [search, status, stock, condition, finish, setCode, sortBy, sortDir]);

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

  const columns: Column<InventoryItem>[] = [
    {
      key: "card",
      header: "Card",
      sortKey: "name",
      render: (r) => (
        <div className="gg-cardcell">
          <img
            src={r.imageUrl ?? ""}
            alt=""
            className="gg-cardcell__img"
            width={32}
            height={45}
            loading="lazy"
          />
          <div className="gg-cardcell__text">
            <span className="gg-cardcell__name">{r.cardName}</span>
            <span className="gg-cardcell__set">
              {r.setCode} · #{r.collectorNumber} ·{" "}
              <Badge tone={RARITY_TONE[r.rarity]}>{RARITY_LABELS[r.rarity]}</Badge>
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
    status !== "all" ||
    stock !== "all" ||
    condition !== "all" ||
    finish !== "all" ||
    setCode !== "all" ||
    search.trim() !== "";

  return (
    <div className="gg-page">
      <PageHeader
        title="Inventory"
        description="Every sellable line — one printing, condition, and finish per row."
        actions={
          <div className="gg-btn-row">
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

      <SectionCard title="">
        <div className="gg-filters">
          <SearchInput
            label="Search inventory"
            placeholder="Search by card name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="gg-filters__selects">
            <SelectField
              label="Stock"
              value={stock}
              onChange={(e) => setStock(e.target.value as typeof stock)}
            >
              <option value="all">All stock</option>
              <option value="low">Low stock</option>
              <option value="out">Out of stock</option>
            </SelectField>
            <SelectField
              label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="archived">Archived</option>
            </SelectField>
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
              {(setCodes.data ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="gg-bulkbar" role="region" aria-label="Bulk actions">
            <span className="gg-bulkbar__count">
              {selectedIds.size} selected
            </span>
            <div className="gg-bulkbar__actions">
              <Button
                variant="ghost"
                size="sm"
                icon="download"
                onClick={exportCsv}
              >
                Export selected
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon="trash"
                onClick={() =>
                  toast.info(
                    "Bulk archive is confirmed per-item in the mock to protect data.",
                  )
                }
              >
                Archive
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
            title={activeFilters ? "No matches" : "No inventory yet"}
            message={
              activeFilters
                ? "Try adjusting or clearing your filters."
                : "Add your first card to get started."
            }
            action={
              activeFilters ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    setStatus("all");
                    setStock("all");
                    setCondition("all");
                    setFinish("all");
                    setSetCode("all");
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button variant="primary" icon="plus" onClick={() => setAddOpen(true)}>
                  Add card
                </Button>
              )
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
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              onPage={setPage}
            />
          </>
        )}
      </SectionCard>

      <AddInventoryDrawer
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={() => {
          inv.reload();
          setCodes.reload();
        }}
      />

      <InventoryDetail
        item={detailItem}
        onClose={() => {
          setDetailItem(null);
          // Drop the ?item param on close.
          if (query.get("item")) onNavigate("/admin_dashboard/inventory");
        }}
        onArchive={(it) => setArchiveTarget(it)}
        onChanged={() => inv.reload()}
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

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import inventory (CSV)"
        size="md"
        footer={
          <div className="gg-drawer-actions__buttons">
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setImportOpen(false);
                toast.info(
                  "CSV import is stubbed in the mock — no rows were written.",
                );
              }}
            >
              Upload file
            </Button>
          </div>
        }
      >
        <div className="gg-import">
          <div className="gg-import__drop">
            <Icon name="upload" size={28} />
            <p>Drag a CSV here, or click Upload file.</p>
            <p className="gg-muted">
              Expected columns: Card, Set, Collector #, Condition, Finish,
              Quantity, Price.
            </p>
          </div>
          <p className="gg-muted">
            Import validates rows, detects duplicates, and previews changes
            before writing in production. This preview does not modify data.
          </p>
        </div>
      </Modal>
    </div>
  );
}

/* --------------------------- Detail drawer --------------------------- */

function InventoryDetail({
  item,
  onClose,
  onArchive,
  onChanged,
}: {
  item: InventoryItem | null;
  onClose: () => void;
  onArchive: (item: InventoryItem) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
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
        "Jordan Vega",
      );
      toast.success(
        `${delta > 0 ? "Added" : "Removed"} ${Math.abs(delta)} — ${item.cardName}.`,
      );
      const fresh = await inventoryRepository.movements(item.id);
      setMovements(fresh);
      onChanged();
    } catch {
      toast.error("Could not adjust quantity.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title={item.cardName}
      variant="drawer"
      size="md"
      headerExtra={
        <Badge tone={LISTING_STATUS_TONE[item.status]}>
          {LISTING_STATUS_LABELS[item.status]}
        </Badge>
      }
      footer={
        <div className="gg-drawer-actions__buttons">
          <Button
            variant="danger"
            icon="trash"
            onClick={() => onArchive(item)}
            disabled={item.status === "archived"}
          >
            Archive
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="gg-detail">
        <div className="gg-detail__hero">
          <img
            src={item.imageUrl ?? ""}
            alt=""
            className="gg-detail__img"
            width={110}
            height={153}
          />
          <dl className="gg-detail__facts">
            <div>
              <dt>Set</dt>
              <dd>
                {item.setName} ({item.setCode})
              </dd>
            </div>
            <div>
              <dt>Collector #</dt>
              <dd>{item.collectorNumber}</dd>
            </div>
            <div>
              <dt>Condition / finish</dt>
              <dd>
                {CONDITION_LABELS[item.condition]} · {FINISH_LABELS[item.finish]}
              </dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>{formatCents(item.priceCents)}</dd>
            </div>
            {item.scryfallPriceCents != null && (
              <div>
                <dt>Scryfall ref.</dt>
                <dd>{formatCents(item.scryfallPriceCents)}</dd>
              </div>
            )}
            {item.storageLocation && (
              <div>
                <dt>Location</dt>
                <dd>{item.storageLocation}</dd>
              </div>
            )}
          </dl>
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
              Apply
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
                      {mv.adminName} · {timeAgo(mv.createdAt)}
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
