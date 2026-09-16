import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PageHeader } from "../../components/layout/PageHeader";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Icon } from "../../components/ui/Icon";
import { Modal } from "../../components/ui/Modal";
import { SelectField, TextField, TextArea } from "../../components/ui/Field";
import { Spinner, ErrorState, EmptyState } from "../../components/ui/States";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { CardImage } from "../../components/cards/CardImage";
import { ScryfallSearch } from "../../components/cards/ScryfallSearch";
import { SelectedPrintingPreview } from "../../components/cards/PrintingPreview";
import { useAsync } from "../../hooks/useAsync";
import { useToast } from "../../hooks/useToast";
import {
  inventoryRepository,
  scanRepository,
  scryfallRepository,
  recognitionProvider,
} from "../../repositories";
import { useCurrentAdmin } from "../../hooks/useCurrentAdmin";
import { ADMIN_BASE } from "../../hooks/useRouter";
import { formatCents } from "../../utils/format";
import { CONDITION_LABELS, CONDITION_TONE, FINISH_LABELS, SCAN_MODE_LABELS } from "../../utils/labels";
import { applyPriceFloor } from "../../utils/pricing";
import type {
  BatchCommitPreview,
  CardCondition,
  CardFinish,
  CardPrinting,
  CardScan,
  DefectFinding,
  InventoryPriceFloor,
  RecognitionCandidate,
  RecognitionStatus,
  ScanFilterKey,
  ScanRecognitionMode,
  ScanSession,
} from "../../types";
import type { BadgeTone } from "../../utils/labels";

/** 0–1 confidence to a rounded percent string, e.g. 0.873 -> "87%". */
function confidencePct(v: number | null | undefined): string {
  return `${Math.round((v ?? 0) * 100)}%`;
}

const FILTERS: { key: ScanFilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unreviewed", label: "Unreviewed" },
  { key: "pending_match", label: "Pending match" },
  { key: "matched", label: "Matched" },
  { key: "needs_manual_match", label: "Needs match" },
  { key: "ready", label: "Ready" },
  { key: "added", label: "Added" },
  { key: "rejected", label: "Rejected" },
  { key: "missing_back", label: "Missing back" },
  { key: "error", label: "Errors" },
];

const CONDITIONS: CardCondition[] = ["NM", "LP", "MP", "HP", "DMG"];
/** Number-key → condition shortcuts, shown in the shortcut bar. */
const CONDITION_KEYS: Record<string, CardCondition> = {
  "1": "NM",
  "2": "LP",
  "3": "MP",
  "4": "HP",
  "5": "DMG",
};

function centsFromInput(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function ScanReviewPage({
  sessionId,
  onNavigate,
}: {
  sessionId: string;
  onNavigate: (path: string) => void;
}) {
  const toast = useToast();
  const currentAdmin = useCurrentAdmin();
  const [filter, setFilter] = useState<ScanFilterKey>("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [findMatchFor, setFindMatchFor] = useState<CardScan | null>(null);
  const [commitPreview, setCommitPreview] = useState<BatchCommitPreview | null>(null);
  const [committing, setCommitting] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [priceFloors, setPriceFloors] = useState<InventoryPriceFloor[]>([]);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Loaded once so the auto-suggested price (below, when a printing is
  // matched) can be floored to the seller's per-rarity minimum.
  useEffect(() => {
    let active = true;
    inventoryRepository.getPriceFloors().then((floors) => {
      if (active) setPriceFloors(floors);
    });
    return () => {
      active = false;
    };
  }, []);

  const session = useAsync(() => scanRepository.getSession(sessionId), [sessionId, nonce]);
  const counts = useAsync(() => scanRepository.filterCounts(sessionId), [sessionId, nonce]);
  const scansState = useAsync(
    () => scanRepository.listScans(sessionId, { filter, pageSize: 500 }),
    [sessionId, filter, nonce],
  );

  const scans = useMemo(() => scansState.data?.rows ?? [], [scansState.data]);
  const active = useMemo(
    () => scans.find((s) => s.id === activeId) ?? null,
    [scans, activeId],
  );

  const reloadAll = useCallback(() => setNonce((n) => n + 1), []);

  // Keep an active row selected as the list changes.
  useEffect(() => {
    if (scans.length === 0) {
      setActiveId(null);
      return;
    }
    if (!activeId || !scans.some((s) => s.id === activeId)) {
      setActiveId(scans[0].id);
    }
  }, [scans, activeId]);

  const moveActive = useCallback(
    (dir: 1 | -1) => {
      if (scans.length === 0) return;
      const idx = scans.findIndex((s) => s.id === activeId);
      const next = Math.max(0, Math.min(scans.length - 1, idx + dir));
      const target = scans[next];
      if (target) {
        setActiveId(target.id);
        rowRefs.current.get(target.id)?.scrollIntoView({ block: "nearest" });
      }
    },
    [scans, activeId],
  );

  // Update one scan then refresh derived views.
  const patchActive = useCallback(
    async (patch: Parameters<typeof scanRepository.updateScan>[1]) => {
      if (!active) return;
      await scanRepository.updateScan(active.id, patch);
      reloadAll();
    },
    [active, reloadAll],
  );

  const approveActive = useCallback(async () => {
    if (!active) return;
    if (!active.selectedScryfallId) {
      toast.error("Find a Scryfall match before approving.");
      return;
    }
    if (!active.confirmedCondition) {
      toast.error("Set a condition (keys 1–5) before approving.");
      return;
    }
    if (!active.selectedFinish) {
      toast.error("Choose a finish before approving.");
      return;
    }
    if (active.priceCents == null || active.priceCents <= 0) {
      toast.error("Enter a selling price before approving.");
      return;
    }
    await scanRepository.updateScan(active.id, { reviewStatus: "ready" });
    reloadAll();
    moveActive(1);
  }, [active, reloadAll, moveActive, toast]);

  // Keyboard workflow.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (typing || findMatchFor || bulkOpen || shortcutsOpen || commitPreview) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        moveActive(1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        moveActive(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        void approveActive();
      } else if (e.key === "f") {
        e.preventDefault();
        if (active) setFindMatchFor(active);
      } else if (e.key === "s") {
        e.preventDefault();
        moveActive(1);
      } else if (e.key === "x") {
        e.preventDefault();
        if (active) void patchActive({ reviewStatus: "rejected" });
      } else if (CONDITION_KEYS[e.key]) {
        e.preventDefault();
        void patchActive({ confirmedCondition: CONDITION_KEYS[e.key] });
      } else if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, moveActive, approveActive, patchActive, findMatchFor, bulkOpen, shortcutsOpen, commitPreview]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Shared by the "Find match" modal and one-click acceptance of a
  // recognition candidate — both are a human confirming an exact printing.
  const applyPrinting = useCallback(
    async (scan: CardScan, printing: CardPrinting) => {
      await scanRepository.updateScan(scan.id, {
        selectedScryfallId: printing.scryfallId,
        selectedPrinting: printing,
        selectedFinish:
          scan.selectedFinish && printing.availableFinishes.includes(scan.selectedFinish)
            ? scan.selectedFinish
            : printing.availableFinishes[0] ?? null,
        priceCents:
          scan.priceCents ??
          applyPriceFloor(printing.scryfallPriceCents, printing.rarity, priceFloors),
      });
      setActiveId(scan.id);
      reloadAll();
      toast.success(`Matched to ${printing.cardName} (${printing.setName}).`);
    },
    [reloadAll, toast, priceFloors],
  );

  async function handleMatchChosen(printing: CardPrinting) {
    if (!findMatchFor) return;
    await applyPrinting(findMatchFor, printing);
    setFindMatchFor(null);
  }

  const [recognizingId, setRecognizingId] = useState<string | null>(null);

  const rerunRecognition = useCallback(
    async (scan: CardScan) => {
      setRecognizingId(scan.id);
      try {
        await recognitionProvider.recognize(scan);
        reloadAll();
      } catch {
        toast.error("Recognition failed to run. Try again in a moment.");
      } finally {
        setRecognizingId(null);
      }
    },
    [reloadAll, toast],
  );

  const selectCandidate = useCallback(
    async (scan: CardScan, candidate: RecognitionCandidate) => {
      const printing = await scryfallRepository.getByScryfallId(candidate.scryfallId);
      if (!printing) {
        toast.error("Couldn't load that printing's details — try Find match instead.");
        return;
      }
      await applyPrinting(scan, printing);
    },
    [applyPrinting, toast],
  );

  async function openCommit() {
    const preview = await scanRepository.previewCommit(sessionId);
    setCommitPreview(preview);
  }

  async function doCommit() {
    setCommitting(true);
    try {
      const result = await scanRepository.commitReady(sessionId, currentAdmin.name);
      if (result.failedCount > 0) {
        toast.error(
          `${result.addedCount} added, ${result.failedCount} failed. Fix and retry.`,
        );
      } else {
        toast.success(
          `${result.addedCount} cards added — ${result.createdCount} new, ${result.incrementedCount} increased.`,
        );
      }
      setCommitPreview(null);
      reloadAll();
    } finally {
      setCommitting(false);
    }
  }

  const countMap = counts.data ?? {};
  const readyCount = countMap.ready ?? 0;

  return (
    <>
      <PageHeader
        title={session.data?.label ?? "Scan session"}
        description={
          session.data
            ? `${session.data.scannerName ?? "Manual import"} · ${session.data.totalCards} cards scanned` +
              (session.data.scanMode !== "both" ? ` · ${SCAN_MODE_LABELS[session.data.scanMode]}` : "")
            : undefined
        }
        actions={
          <div className="gg-scanhead-actions">
            <Button variant="ghost" icon="chevronLeft" onClick={() => onNavigate(`${ADMIN_BASE}/scanning`)}>
              Sessions
            </Button>
            <Button variant="ghost" icon="keyboard" onClick={() => setShortcutsOpen(true)}>
              Shortcuts
            </Button>
            <Button
              variant="secondary"
              icon="edit"
              disabled={selectedIds.size === 0}
              onClick={() => setBulkOpen(true)}
            >
              Bulk ({selectedIds.size})
            </Button>
            <Button
              variant="primary"
              icon="checkCircle"
              disabled={readyCount === 0}
              onClick={openCommit}
            >
              Add {readyCount} ready to inventory
            </Button>
          </div>
        }
      />

      {session.data && <ProgressBar session={session.data} />}

      <div className="gg-filtertabs" role="tablist" aria-label="Filter scans">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            className={
              filter === f.key
                ? "gg-filtertab gg-filtertab--active"
                : "gg-filtertab"
            }
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            <span className="gg-filtertab__count">{countMap[f.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="gg-scanlayout">
        {/* Queue */}
        <div className="gg-scanqueue">
          {scansState.loading && (
            <div style={{ padding: 24 }}>
              <Spinner label="Loading scans" />
            </div>
          )}
          {scansState.error && (
            <ErrorState message={scansState.error} onRetry={reloadAll} />
          )}
          {!scansState.loading && scans.length === 0 && (
            <EmptyState
              icon="layers"
              title="Nothing here"
              message="No scans match this filter."
            />
          )}
          {scans.map((scan) => (
            <ScanRow
              key={scan.id}
              scan={scan}
              active={scan.id === activeId}
              selected={selectedIds.has(scan.id)}
              onActivate={() => setActiveId(scan.id)}
              onToggleSelect={() => toggleSelect(scan.id)}
              registerRef={(el) => {
                if (el) rowRefs.current.set(scan.id, el);
                else rowRefs.current.delete(scan.id);
              }}
            />
          ))}
        </div>

        {/* Detail / compare */}
        <div className="gg-scandetail">
          {active ? (
            <ScanDetail
              key={active.id}
              scan={active}
              scanMode={session.data?.scanMode ?? "both"}
              onFindMatch={() => setFindMatchFor(active)}
              onPatch={patchActive}
              onApprove={approveActive}
              onReject={() => patchActive({ reviewStatus: "rejected" })}
              onRerunRecognition={() => rerunRecognition(active)}
              recognizing={recognizingId === active.id}
              onSelectCandidate={(c) => selectCandidate(active, c)}
            />
          ) : (
            <div className="gg-scandetail__empty">
              <Icon name="scan" size={30} />
              <p>Select a scan to review it here.</p>
            </div>
          )}
        </div>
      </div>

      {/* Find Match modal */}
      <Modal
        open={!!findMatchFor}
        onClose={() => setFindMatchFor(null)}
        title="Find Scryfall match"
        size="lg"
      >
        {findMatchFor && (
          <div className="gg-findmatch">
            <div className="gg-findmatch__scan">
              <span className="gg-comparelabel">My scan · #{String(findMatchFor.sequenceNumber).padStart(3, "0")}</span>
              <CardImage
                images={findMatchFor.frontImageUrl ? { small: findMatchFor.frontImageUrl, normal: findMatchFor.frontImageUrl, large: findMatchFor.frontImageUrl, png: findMatchFor.frontImageUrl, artCrop: findMatchFor.frontImageUrl } : null}
                alt="Scanned card"
                size="md"
                kind="scan"
              />
            </div>
            <div className="gg-findmatch__search">
              <ScryfallSearch onSelect={handleMatchChosen} autoFocus />
            </div>
          </div>
        )}
      </Modal>

      {/* Bulk actions */}
      <BulkActionsModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        count={selectedIds.size}
        onApply={async (patch) => {
          await scanRepository.bulkUpdate(
            Array.from(selectedIds),
            patch,
            currentAdmin.name,
          );
          setBulkOpen(false);
          setSelectedIds(new Set());
          reloadAll();
          toast.success("Bulk update applied.");
        }}
      />

      {/* Commit confirmation */}
      <Modal
        open={!!commitPreview}
        onClose={() => setCommitPreview(null)}
        title="Add ready cards to inventory"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCommitPreview(null)} disabled={committing}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={doCommit}
              loading={committing}
              disabled={!commitPreview || commitPreview.readyCount === 0}
            >
              Add {commitPreview?.readyCount ?? 0} cards
            </Button>
          </>
        }
      >
        {commitPreview && (
          <div className="gg-commit">
            <ul className="gg-commit__list">
              <li><strong>{commitPreview.readyCount}</strong> scan records ready</li>
              <li><strong>{commitPreview.willCreateCount}</strong> will create new inventory lines</li>
              <li><strong>{commitPreview.willIncrementCount}</strong> will increase existing inventory</li>
              <li className={commitPreview.errorCount > 0 ? "gg-commit__err" : ""}>
                <strong>{commitPreview.errorCount}</strong> errors
              </li>
            </ul>
            {commitPreview.errors.length > 0 && (
              <div className="gg-commit__errors">
                {commitPreview.errors.slice(0, 6).map((e) => (
                  <div key={e.scanId}>#{String(e.sequenceNumber).padStart(3, "0")} — {e.reason}</div>
                ))}
              </div>
            )}
            <p className="gg-muted">
              Each card commits individually through the movement ledger.
              Successful cards are kept even if some fail, and already-added
              scans are never double-counted.
            </p>
          </div>
        )}
      </Modal>

      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Progress bar
 * ------------------------------------------------------------------ */

function ProgressBar({ session }: { session: ScanSession }) {
  const reviewed = session.addedCards + session.rejectedCards;
  const pct = session.totalCards > 0 ? Math.round((reviewed / session.totalCards) * 100) : 0;
  return (
    <div className="gg-scanprogress">
      <div className="gg-scanprogress__bar">
        <div className="gg-scanprogress__fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="gg-scanprogress__stats">
        <span>{reviewed} / {session.totalCards} reviewed — {pct}%</span>
        <span className="gg-muted">
          {session.matchedCards} matched · {session.readyCards} ready ·{" "}
          {session.addedCards} added · {session.rejectedCards} rejected ·{" "}
          {session.failedCards} errors
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Queue row
 * ------------------------------------------------------------------ */

const REVIEW_TONE: Record<string, BadgeTone> = {
  unreviewed: "neutral",
  pending_match: "warning",
  matched: "info",
  needs_manual_match: "warning",
  ready: "gold",
  added: "success",
  rejected: "danger",
  error: "danger",
};

const RECOGNITION_TONE: Record<RecognitionStatus, BadgeTone> = {
  none: "neutral",
  queued: "neutral",
  processing: "info",
  recognized: "success",
  low_confidence: "warning",
  failed: "danger",
};

const RECOGNITION_LABEL: Record<RecognitionStatus, string> = {
  none: "Not recognized yet",
  queued: "Queued for recognition",
  processing: "Recognizing…",
  recognized: "Auto-matched",
  low_confidence: "Low confidence",
  failed: "Recognition failed",
};

function scanImages(url: string | null) {
  return url ? { small: url, normal: url, large: url, png: url, artCrop: url } : null;
}

function ScanRow({
  scan,
  active,
  selected,
  onActivate,
  onToggleSelect,
  registerRef,
}: {
  scan: CardScan;
  active: boolean;
  selected: boolean;
  onActivate: () => void;
  onToggleSelect: () => void;
  registerRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={registerRef}
      className={[
        "gg-scanrow",
        active ? "gg-scanrow--active" : "",
        selected ? "gg-scanrow--selected" : "",
      ].filter(Boolean).join(" ")}
      onClick={onActivate}
    >
      <input
        type="checkbox"
        className="gg-scanrow__check"
        checked={selected}
        onClick={(e) => e.stopPropagation()}
        onChange={onToggleSelect}
        aria-label={`Select scan ${scan.sequenceNumber}`}
      />
      <span className="gg-scanrow__seq">#{String(scan.sequenceNumber).padStart(3, "0")}</span>
      <CardImage images={scanImages(scan.frontImageUrl)} alt="Scan" size="xs" kind="scan" noPreview={!scan.frontImageUrl} />
      <span className="gg-scanrow__arrow"><Icon name="chevronRight" size={12} /></span>
      {scan.selectedPrinting ? (
        <CardImage
          images={scan.selectedPrinting.images}
          faces={scan.selectedPrinting.faces}
          alt={scan.selectedPrinting.cardName}
          size="xs"
        />
      ) : (
        <span className="gg-scanrow__nomatch"><Icon name="search" size={14} /></span>
      )}
      <span className="gg-scanrow__main">
        <span className="gg-scanrow__name">
          {scan.selectedPrinting?.cardName ?? "Unmatched"}
        </span>
        <span className="gg-scanrow__sub">
          {scan.selectedPrinting
            ? `${scan.selectedPrinting.setName} · #${scan.selectedPrinting.collectorNumber}`
            : "No Scryfall match yet"}
          {scan.confirmedCondition && ` · ${scan.confirmedCondition}`}
          {scan.selectedFinish && ` · ${FINISH_LABELS[scan.selectedFinish]}`}
        </span>
      </span>
      {scan.backImagePath == null && (
        <span className="gg-scanrow__flag" title="No back scan">
          <Icon name="info" size={13} />
        </span>
      )}
      <Badge tone={REVIEW_TONE[scan.reviewStatus] ?? "neutral"}>
        {scan.reviewStatus.replace(/_/g, " ")}
      </Badge>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Detail / side-by-side compare
 * ------------------------------------------------------------------ */

function ScanDetail({
  scan,
  scanMode,
  onFindMatch,
  onPatch,
  onApprove,
  onReject,
  onRerunRecognition,
  recognizing,
  onSelectCandidate,
}: {
  scan: CardScan;
  scanMode: ScanRecognitionMode;
  onFindMatch: () => void;
  onPatch: (patch: Parameters<typeof scanRepository.updateScan>[1]) => Promise<void>;
  onApprove: () => void;
  onReject: () => void;
  onRerunRecognition: () => void;
  recognizing: boolean;
  onSelectCandidate: (candidate: RecognitionCandidate) => Promise<void>;
}) {
  const [price, setPrice] = useState(
    scan.priceCents != null ? (scan.priceCents / 100).toFixed(2) : "",
  );
  const [cost, setCost] = useState(
    scan.costCents != null ? (scan.costCents / 100).toFixed(2) : "",
  );
  const [location, setLocation] = useState(scan.storageLocation ?? "");

  // Re-sync local fields when the active scan changes.
  useEffect(() => {
    setPrice(scan.priceCents != null ? (scan.priceCents / 100).toFixed(2) : "");
    setCost(scan.costCents != null ? (scan.costCents / 100).toFixed(2) : "");
    setLocation(scan.storageLocation ?? "");
  }, [scan.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const finishes = scan.selectedPrinting?.availableFinishes ?? [];

  return (
    <div className="gg-scandetail__inner">
      <div className="gg-compare">
        <div className="gg-compare__side">
          <span className="gg-comparelabel gg-comparelabel--scan">
            My scan · #{String(scan.sequenceNumber).padStart(3, "0")}
          </span>
          {scan.frontImageUrl ? (
            <img src={scan.frontImageUrl} alt="Front scan" className="gg-compare__img" />
          ) : (
            <div className="gg-compare__placeholder">No front scan</div>
          )}
          {scan.backImageUrl && (
            <img src={scan.backImageUrl} alt="Back scan" className="gg-compare__img gg-compare__img--back" />
          )}
        </div>
        <div className="gg-compare__side">
          <span className="gg-comparelabel">Scryfall reference</span>
          {scan.selectedPrinting ? (
            <SelectedPrintingPreview
              printing={scan.selectedPrinting}
              finish={scan.selectedFinish}
            />
          ) : scan.recognitionData && scan.recognitionData.candidatePrintings.length > 0 ? (
            <CandidateSuggestions
              candidates={scan.recognitionData.candidatePrintings}
              onSelect={onSelectCandidate}
              onSearchInstead={onFindMatch}
            />
          ) : (
            <div className="gg-compare__placeholder gg-compare__placeholder--match">
              <Icon name="search" size={24} />
              <p>No match selected.</p>
              <Button variant="primary" size="sm" icon="search" onClick={onFindMatch}>
                Find match
              </Button>
            </div>
          )}
        </div>
      </div>

      {scanMode !== "condition" ? (
        <RecognitionPanel scan={scan} recognizing={recognizing} onRerun={onRerunRecognition} />
      ) : (
        <div className="gg-inline-note gg-inline-note--info">
          <Icon name="info" size={16} />
          <div>Card matching is off for this session — match this card manually with Find Match.</div>
        </div>
      )}
      {scanMode !== "card_matching" ? (
        <ConditionPanel
          scan={scan}
          onApplySuggestion={(condition) => onPatch({ confirmedCondition: condition })}
        />
      ) : (
        <div className="gg-inline-note gg-inline-note--info">
          <Icon name="info" size={16} />
          <div>Condition grading is off for this session — set the condition manually below.</div>
        </div>
      )}

      <div className="gg-scanform">
        <div className="gg-scanform__row">
          <Button variant="secondary" icon="search" onClick={onFindMatch}>
            {scan.selectedPrinting ? "Change match" : "Find match"}
          </Button>
        </div>
        <div className="gg-form-grid">
          <SelectField
            label="Condition"
            value={scan.confirmedCondition ?? ""}
            onChange={(e) => onPatch({ confirmedCondition: e.target.value as CardCondition })}
          >
            <option value="" disabled>Choose…</option>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
            ))}
          </SelectField>
          <SelectField
            label="Finish"
            value={scan.selectedFinish ?? ""}
            onChange={(e) => onPatch({ selectedFinish: e.target.value as CardFinish })}
            disabled={finishes.length === 0}
          >
            <option value="" disabled>Choose…</option>
            {finishes.map((f) => (
              <option key={f} value={f}>{FINISH_LABELS[f]}</option>
            ))}
          </SelectField>
          <TextField
            label="Quantity"
            type="number"
            min={1}
            value={String(scan.quantity)}
            onChange={(e) => onPatch({ quantity: Math.max(1, Number.parseInt(e.target.value, 10) || 1) })}
          />
          <TextField
            label="Price (USD)"
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={() => onPatch({ priceCents: centsFromInput(price) })}
            hint={
              scan.selectedPrinting?.scryfallPriceCents != null
                ? `Scryfall ${formatCents(scan.selectedPrinting.scryfallPriceCents)}`
                : undefined
            }
          />
          <TextField
            label="Cost (USD)"
            type="number"
            min={0}
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            onBlur={() => onPatch({ costCents: centsFromInput(cost) })}
          />
          <TextField
            label="Storage location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            onBlur={() => onPatch({ storageLocation: location || null })}
          />
        </div>

        <div className="gg-scanform__actions">
          <Button variant="ghost" icon="close" onClick={onReject}>
            Reject (X)
          </Button>
          <Button variant="primary" icon="check" onClick={onApprove}>
            Approve → next (Enter)
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Recognition results — status, detected fields, why a match was (or
 * wasn't) accepted, and every low-confidence signal the pipeline found.
 * Never a black box: decisionReason + warnings are the pipeline's own
 * explanation, straight from api/_lib/recognition/pipeline.ts.
 * ------------------------------------------------------------------ */

function RecognitionPanel({
  scan,
  recognizing,
  onRerun,
}: {
  scan: CardScan;
  recognizing: boolean;
  onRerun: () => void;
}) {
  const data = scan.recognitionData;
  const status = scan.recognitionStatus;

  return (
    <div className="gg-recog">
      <div className="gg-recog__head">
        <Badge tone={RECOGNITION_TONE[status]} dot>
          {RECOGNITION_LABEL[status]}
        </Badge>
        {scan.recognitionConfidence != null && (
          <span className="gg-muted">{confidencePct(scan.recognitionConfidence)} confidence</span>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon="sparkle"
          loading={recognizing}
          disabled={recognizing || status === "processing"}
          onClick={onRerun}
        >
          {status === "none" ? "Run recognition" : "Re-run"}
        </Button>
      </div>

      {data && (data.detectedName || data.detectedSetCode || data.detectedCollectorNumber) && (
        <div className="gg-recog__detected">
          Detected: {data.detectedName ?? "—"}
          {data.detectedSetCode ? ` · ${data.detectedSetCode}` : ""}
          {data.detectedCollectorNumber ? ` #${data.detectedCollectorNumber}` : ""}
        </div>
      )}

      {data && (data.era === "vintage" || data.visualSimilarity != null || data.setSymbolMatch) && (
        <div className="gg-recog__signals">
          {data.era === "vintage" && (
            <span className="gg-recog__signal gg-recog__signal--warn">
              Possible vintage card — treated conservatively
            </span>
          )}
          {data.visualSimilarity != null && (
            <span className="gg-recog__signal">
              Visual match {confidencePct(data.visualSimilarity)}
            </span>
          )}
          {data.setSymbolMatch && (
            <span className="gg-recog__signal">
              Set symbol → {data.setSymbolMatch.setCode} ({confidencePct(data.setSymbolMatch.confidence)})
            </span>
          )}
        </div>
      )}

      {data?.decisionReason && (
        <div className="gg-inline-note gg-inline-note--info">
          <Icon name="info" size={16} />
          <div>{data.decisionReason}</div>
        </div>
      )}

      {data && data.warnings.length > 0 && (
        <div className="gg-inline-note gg-inline-note--warning">
          <Icon name="warning" size={16} />
          <div>
            {data.warnings.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Clickable recognition candidates shown in place of the empty "no match"
 * placeholder — a human still confirms the printing with one click, same as
 * picking from manual search, just pre-narrowed by the pipeline. */
function CandidateSuggestions({
  candidates,
  onSelect,
  onSearchInstead,
}: {
  candidates: RecognitionCandidate[];
  onSelect: (candidate: RecognitionCandidate) => Promise<void>;
  onSearchInstead: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function pick(c: RecognitionCandidate) {
    setBusyId(c.scryfallId);
    try {
      await onSelect(c);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="gg-candidates">
      <p className="gg-candidates__intro">
        Not confident enough to auto-match — recognition found{" "}
        {candidates.length === 1 ? "this possibility" : `these ${candidates.length} possibilities`}:
      </p>
      {candidates.map((c) => (
        <div key={c.scryfallId} className="gg-candidate">
          <div className="gg-candidate__info">
            <span className="gg-candidate__name">{c.cardName}</span>
            <span className="gg-candidate__meta">
              {c.setCode} · #{c.collectorNumber} · {confidencePct(c.confidence)}
            </span>
            {c.reason && <span className="gg-candidate__reason">{c.reason}</span>}
          </div>
          <Button
            variant="secondary"
            size="sm"
            loading={busyId === c.scryfallId}
            disabled={busyId != null}
            onClick={() => pick(c)}
          >
            Use this
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" icon="search" onClick={onSearchInstead}>
        Search manually instead
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Condition suggestion — explainable per-region defect findings, never
 * silently promoted to confirmedCondition (Part 9).
 * ------------------------------------------------------------------ */

const DEFECT_KIND_LABEL: Record<DefectFinding["kind"], string> = {
  corner_wear: "Corner wear",
  edge_whitening: "Edge whitening",
  surface_wear: "Surface wear",
  crease: "Crease",
  writing_or_ink: "Writing / ink",
  stain_or_liquid: "Stain / liquid",
  structural: "Structural damage",
};

function ConditionPanel({
  scan,
  onApplySuggestion,
}: {
  scan: CardScan;
  onApplySuggestion: (condition: CardCondition) => void;
}) {
  const suggested = scan.suggestedCondition;
  if (!suggested) return null;
  const findings = scan.conditionFindings;

  return (
    <div className="gg-condition">
      <div className="gg-condition__head">
        <span className="gg-comparelabel">Condition suggestion</span>
        <Badge tone={CONDITION_TONE[suggested]}>{CONDITION_LABELS[suggested]}</Badge>
        {scan.suggestedConditionConfidence != null && (
          <span className="gg-muted">
            {confidencePct(scan.suggestedConditionConfidence)} confidence
          </span>
        )}
        {scan.confirmedCondition !== suggested && (
          <Button
            variant="ghost"
            size="sm"
            icon="check"
            onClick={() => onApplySuggestion(suggested)}
          >
            Use suggestion
          </Button>
        )}
      </div>

      {findings?.backImageMissing && (
        <div className="gg-inline-note gg-inline-note--warning">
          <Icon name="info" size={16} />
          <div>No back scan — this suggestion is based on the front side only.</div>
        </div>
      )}

      {findings && findings.findings.length > 0 ? (
        <ul className="gg-defects">
          {findings.findings.map((f, i) => (
            <li key={i} className={`gg-defects__item gg-defects__item--${f.severity}`}>
              <span className="gg-defects__region">{f.region}</span>
              <span className="gg-defects__note">
                {DEFECT_KIND_LABEL[f.kind]} — {f.note}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        findings && <p className="gg-muted">No wear detected by automated analysis.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Bulk actions modal
 * ------------------------------------------------------------------ */

function BulkActionsModal({
  open,
  onClose,
  count,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  count: number;
  onApply: (patch: {
    storageLocation?: string | null;
    costCents?: number | null;
    notes?: string | null;
    reviewStatus?: CardScan["reviewStatus"];
  }) => Promise<void>;
}) {
  const [location, setLocation] = useState("");
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");
  const [markReviewed, setMarkReviewed] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [busy, setBusy] = useState(false);

  async function apply(reviewStatus?: CardScan["reviewStatus"]) {
    setBusy(true);
    try {
      const patch: Parameters<typeof onApply>[0] = {};
      if (location.trim()) patch.storageLocation = location.trim();
      if (cost.trim()) patch.costCents = centsFromInput(cost);
      if (note.trim()) patch.notes = note.trim();
      if (reviewStatus) patch.reviewStatus = reviewStatus;
      else if (markReviewed) patch.reviewStatus = "matched";
      await onApply(patch);
      setLocation("");
      setCost("");
      setNote("");
      setMarkReviewed(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Bulk edit ${count} scan${count === 1 ? "" : "s"}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={() => setConfirmReject(true)} disabled={busy}>
            Reject all
          </Button>
          <Button variant="primary" onClick={() => apply()} loading={busy}>
            Apply
          </Button>
        </>
      }
    >
      <div className="gg-bulk">
        <div className="gg-inline-note gg-inline-note--warning">
          <Icon name="warning" size={16} />
          <div>
            Bulk edits apply shared fields only. They never assign a Scryfall
            match — each card must be matched to its exact printing individually.
          </div>
        </div>
        <TextField label="Storage location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Leave blank to keep" />
        <TextField label="Acquisition cost (USD)" type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Leave blank to keep" />
        <TextArea label="Shared note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        <label className="gg-check-inline">
          <input type="checkbox" checked={markReviewed} onChange={(e) => setMarkReviewed(e.target.checked)} />
          Mark selected as reviewed (matched)
        </label>
      </div>
      <ConfirmDialog
        open={confirmReject}
        title="Reject selected scans?"
        message={`This marks ${count} scan${count === 1 ? "" : "s"} as rejected. They won't be added to inventory.`}
        confirmLabel="Reject them"
        tone="danger"
        onCancel={() => setConfirmReject(false)}
        onConfirm={async () => {
          setConfirmReject(false);
          await apply("rejected");
        }}
      />
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Shortcuts reference
 * ------------------------------------------------------------------ */

function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows: [string, string][] = [
    ["J / ↓", "Next card"],
    ["K / ↑", "Previous card"],
    ["Enter", "Approve (mark ready) → next"],
    ["F", "Find Scryfall match"],
    ["1–5", "Set condition (NM, LP, MP, HP, DMG)"],
    ["S", "Skip to next"],
    ["X", "Reject card"],
    ["?", "Show this help"],
  ];
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" size="sm">
      <table className="gg-shortcuts">
        <tbody>
          {rows.map(([k, d]) => (
            <tr key={k}>
              <td><kbd>{k}</kbd></td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
