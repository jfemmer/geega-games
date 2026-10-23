import { useCallback, useId, useMemo, useState } from "react";
import { PageHeader } from "../../components/layout/PageHeader";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Icon } from "../../components/ui/Icon";
import { Modal } from "../../components/ui/Modal";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { SelectField, TextField } from "../../components/ui/Field";
import { EmptyState, ErrorState, Spinner } from "../../components/ui/States";
import { useAsync } from "../../hooks/useAsync";
import { useToast } from "../../hooks/useToast";
import { useCurrentAdmin } from "../../hooks/useCurrentAdmin";
import { useDefaultCondition } from "../../hooks/useDefaultCondition";
import { ADMIN_BASE } from "../../hooks/useRouter";
import { inventoryRepository, scanRepository } from "../../repositories";
import { formatCents } from "../../utils/format";
import { CONDITION_LABELS, FINISH_LABELS, type BadgeTone } from "../../utils/labels";
import {
  carriedPrice,
  defaultFinish,
  inQuickApprove,
  QUICK_APPROVE_BATCH,
  quickProposal,
  suggestedPrice,
  type QuickKind,
  type QuickProposal,
} from "../../utils/scanApproval";
import type { CardCondition, CardScan, InventoryPriceFloor, QuickApproveResult, RecognitionCandidate } from "../../types";

// Quick approve: every card in a session that isn't in inventory yet, on one
// screen, as your scan next to the printing it matched. Sure matches come
// pre-ticked; close calls and unsure matches show their best guess, one tap
// away. Pick the condition once, and "Add to inventory" approves and adds
// everything ticked in one go (QUICK_APPROVE_BATCH cards per request, so a
// session of hundreds still goes through in under a minute).
//
// Same rules as approving one card in review (utils/scanApproval.ts): the
// finish from the batch's foil switch, today's Scryfall price for it (raised
// to the price floors) unless one was typed, and the condition chosen here
// only for cards nobody graded. The server re-reads every printing itself
// (api/admin/scan-sessions/[id]/approve.ts).

const CONDITIONS: CardCondition[] = ["NM", "LP", "MP", "HP", "DMG"];
const PAGE_SIZE = 500;
const MAX_PAGES = 20;

const KIND_LABEL: Record<QuickKind, string> = {
  sure: "Matched",
  confirm: "Quick confirm",
  listTie: "Original or The List?",
  closeCall: "Close call",
  check: "Check",
  noMatch: "No match",
};

const KIND_TONE: Record<QuickKind, BadgeTone> = {
  sure: "success",
  confirm: "info",
  listTie: "warning",
  closeCall: "warning",
  check: "warning",
  noMatch: "neutral",
};

type Filter = "all" | "ticked" | "look";

/** Every card in the session not yet added or rejected, across pages. */
async function openScans(sessionId: string): Promise<CardScan[]> {
  const first = await scanRepository.listScans(sessionId, { filter: "all", pageSize: PAGE_SIZE, page: 1 });
  const byId = new Map(first.rows.map((s) => [s.id, s]));
  for (let page = 2; (page - 1) * PAGE_SIZE < first.total && page <= MAX_PAGES; page++) {
    const next = await scanRepository.listScans(sessionId, { filter: "all", pageSize: PAGE_SIZE, page });
    if (next.rows.length === 0) break;
    for (const s of next.rows) byId.set(s.id, s);
  }
  return [...byId.values()].filter(inQuickApprove).sort((a, b) => a.sequenceNumber - b.sequenceNumber);
}

const seqLabel = (n: number) => `#${String(n).padStart(3, "0")}`;

function centsFromInput(v: string): number | null {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/** The proposal, with the printing staff switched to (if any). */
function shown(proposal: QuickProposal, picked: RecognitionCandidate | undefined): QuickProposal {
  if (!picked) return proposal;
  return {
    ...proposal,
    scryfallId: picked.scryfallId,
    cardName: picked.cardName,
    setCode: picked.setCode,
    setName: null,
    collectorNumber: picked.collectorNumber,
    imageUrl: picked.imageUrl ?? null,
    note: null,
  };
}

/** The price approving will use, when it's known before asking Scryfall. */
function knownPrice(scan: CardScan, p: QuickProposal, floors: InventoryPriceFloor[], typed: number | undefined): number | null {
  if (typed != null) return typed;
  // The card's own price, when it goes with this printing (the server's rule).
  const carried = p.scryfallId ? carriedPrice(scan, p.scryfallId) : null;
  if (carried != null) return carried;
  if (!scan.selectedPrinting || p.scryfallId !== scan.selectedScryfallId) return null;
  return suggestedPrice(scan.selectedPrinting, defaultFinish(scan, scan.selectedPrinting), floors);
}

function finishLabel(scan: CardScan, p: QuickProposal): string {
  if (scan.selectedPrinting && p.scryfallId === scan.selectedScryfallId) {
    const finish = defaultFinish(scan, scan.selectedPrinting);
    if (finish) return FINISH_LABELS[finish];
  }
  return scan.recognitionData?.finishGuess === "foil" ? "Foil" : "Non-foil";
}

export function QuickApprovePage({ sessionId, onNavigate }: { sessionId: string; onNavigate: (path: string) => void }) {
  const toast = useToast();
  const currentAdmin = useCurrentAdmin();
  const [nonce, setNonce] = useState(0);
  const session = useAsync(() => scanRepository.getSession(sessionId), [sessionId, nonce]);
  const loaded = useAsync(() => openScans(sessionId), [sessionId, nonce]);
  const floorsState = useAsync(() => inventoryRepository.getPriceFloors(), []);
  const floors = useMemo(() => floorsState.data ?? [], [floorsState.data]);

  const [condition, setCondition] = useDefaultCondition();
  const [location, setLocation] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  /** Ticks staff changed (otherwise the proposal's preselect stands). */
  const [touched, setTouched] = useState<Map<string, boolean>>(new Map());
  /** Printings staff switched to. */
  const [picked, setPicked] = useState<Map<string, RecognitionCandidate>>(new Map());
  /** Prices typed for cards Scryfall has no price for. */
  const [typedPrices, setTypedPrices] = useState<Map<string, number>>(new Map());
  const [failures, setFailures] = useState<Map<string, string>>(new Map());
  const [lastRun, setLastRun] = useState<QuickApproveResult | null>(null);
  const [comparing, setComparing] = useState<CardScan | null>(null);
  const [confirming, setConfirming] = useState<"add" | "ready" | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const scans = useMemo(() => loaded.data ?? [], [loaded.data]);
  const proposals = useMemo(() => new Map(scans.map((s) => [s.id, quickProposal(s)])), [scans]);
  const display = useCallback((s: CardScan) => shown(proposals.get(s.id)!, picked.get(s.id)), [proposals, picked]);
  const isTicked = useCallback(
    (s: CardScan) => {
      const p = proposals.get(s.id)!;
      if (!p.scryfallId) return false;
      return touched.get(s.id) ?? p.preselect;
    },
    [proposals, touched],
  );

  const matchable = scans.filter((s) => proposals.get(s.id)!.kind !== "noMatch");
  const noMatch = scans.filter((s) => proposals.get(s.id)!.kind === "noMatch");
  const ticked = matchable.filter(isTicked);
  const visible = matchable.filter((s) =>
    filter === "ticked" ? isTicked(s) : filter === "look" ? !proposals.get(s.id)!.preselect : true,
  );
  const lookCount = matchable.filter((s) => !proposals.get(s.id)!.preselect).length;

  let estimate = 0;
  let unpriced = 0;
  for (const s of ticked) {
    const cents = knownPrice(s, display(s), floors, typedPrices.get(s.id));
    if (cents == null) unpriced++;
    else estimate += cents * s.quantity;
  }

  const setTick = (id: string, value: boolean) => setTouched((prev) => new Map(prev).set(id, value));
  const tickAll = (value: boolean) =>
    setTouched((prev) => {
      const next = new Map(prev);
      for (const s of visible) next.set(s.id, value);
      return next;
    });

  function choose(scan: CardScan, candidate: RecognitionCandidate) {
    setPicked((prev) => new Map(prev).set(scan.id, candidate));
    setTick(scan.id, true);
    setComparing(null);
  }

  async function run(addToInventory: boolean) {
    const items = ticked.map((s) => ({ scanId: s.id, scryfallId: display(s).scryfallId!, priceCents: typedPrices.get(s.id) ?? null }));
    if (items.length === 0) return;
    const seq = new Map(ticked.map((s) => [s.id, s.sequenceNumber]));
    const total: QuickApproveResult = { approvedCount: 0, addedCount: 0, createdCount: 0, incrementedCount: 0, failures: [] };
    let stopped: string | null = null;
    setConfirming(null);
    setProgress({ done: 0, total: items.length });
    for (let i = 0; i < items.length; i += QUICK_APPROVE_BATCH) {
      const batch = items.slice(i, i + QUICK_APPROVE_BATCH);
      try {
        const r = await scanRepository.quickApprove(
          sessionId,
          { items: batch, condition, storageLocation: location.trim() || null, addToInventory },
          currentAdmin.name,
        );
        total.approvedCount += r.approvedCount;
        total.addedCount += r.addedCount;
        total.createdCount += r.createdCount;
        total.incrementedCount += r.incrementedCount;
        total.failures.push(...r.failures);
      } catch (err) {
        // Something wider than one card (offline, the server down): stop here.
        stopped = err instanceof Error && err.message ? err.message : "The server didn't answer.";
        for (const item of items.slice(i)) total.failures.push({ scanId: item.scanId, sequenceNumber: seq.get(item.scanId) ?? 0, reason: "Not sent — stopped." });
        break;
      }
      setProgress({ done: Math.min(i + batch.length, items.length), total: items.length });
    }
    setProgress(null);
    setFailures(new Map(total.failures.map((f) => [f.scanId, f.reason])));
    setLastRun(total);
    setNonce((n) => n + 1);

    const done = addToInventory ? total.addedCount : total.approvedCount;
    const verb = addToInventory ? "added to inventory" : "marked ready";
    if (stopped) toast.error(`Stopped after ${done} card${done === 1 ? "" : "s"}: ${stopped}`);
    else if (total.failures.length > 0) toast.error(`${done} ${verb} — ${total.failures.length} need a look (marked below).`);
    else toast.success(`${done} card${done === 1 ? "" : "s"} ${verb}.`);
  }

  const backToReview = () => onNavigate(`${ADMIN_BASE}/scanning/${sessionId}`);
  const openInReview = (scan: CardScan) => onNavigate(`${ADMIN_BASE}/scanning/${sessionId}?scan=${scan.id}`);
  const running = progress !== null;
  const count = ticked.length;

  return (
    <div className="gg-qa">
      <PageHeader
        title="Quick approve"
        description={
          session.data
            ? `${session.data.label} · ${matchable.length} card${matchable.length === 1 ? "" : "s"} to approve`
            : undefined
        }
        actions={
          <Button variant="ghost" icon="chevronLeft" onClick={backToReview}>
            Back to review
          </Button>
        }
      />

      {lastRun && (lastRun.addedCount > 0 || lastRun.approvedCount > 0) && (
        <div className="gg-inline-note gg-inline-note--info gg-qa__result" role="status">
          <Icon name="checkCircle" size={16} />
          <div>
            {lastRun.addedCount > 0
              ? `Added ${lastRun.addedCount} card${lastRun.addedCount === 1 ? "" : "s"} to inventory (${lastRun.createdCount} new, ${lastRun.incrementedCount} more of ones you had).`
              : `Marked ${lastRun.approvedCount} card${lastRun.approvedCount === 1 ? "" : "s"} ready. They stay listed here until they're added to inventory.`}
            {lastRun.failures.length > 0 && ` ${lastRun.failures.length} couldn't be — they're marked in red below.`}
          </div>
        </div>
      )}

      {loaded.loading && !loaded.data && (
        <div className="gg-qa__loading">
          <Spinner label="Loading the cards" />
        </div>
      )}
      {loaded.error && <ErrorState message={loaded.error} onRetry={() => setNonce((n) => n + 1)} />}

      {loaded.data && matchable.length === 0 && noMatch.length === 0 && (
        <EmptyState icon="checkCircle" title="Nothing left to approve" message="Every card in this session is in inventory or rejected." />
      )}

      {matchable.length > 0 && (
        <>
          <div className="gg-qa__toolbar">
            <div className="gg-filtertabs" role="tablist" aria-label="Show">
              {(
                [
                  ["all", "All", matchable.length],
                  ["ticked", "Ticked", count],
                  ["look", "Needs a look", lookCount],
                ] as const
              ).map(([key, label, n]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={filter === key}
                  className={filter === key ? "gg-filtertab gg-filtertab--active" : "gg-filtertab"}
                  onClick={() => setFilter(key)}
                >
                  {label}
                  <span className="gg-filtertab__count">{n}</span>
                </button>
              ))}
            </div>
            <div className="gg-qa__tickall">
              <Button variant="ghost" size="sm" onClick={() => tickAll(true)} disabled={running}>
                Tick all shown
              </Button>
              <Button variant="ghost" size="sm" onClick={() => tickAll(false)} disabled={running}>
                Untick all shown
              </Button>
            </div>
          </div>

          <div className="gg-qa__grid">
            {visible.map((scan) => (
              <QuickTile
                key={scan.id}
                scan={scan}
                proposal={display(scan)}
                ticked={isTicked(scan)}
                disabled={running}
                price={knownPrice(scan, display(scan), floors, typedPrices.get(scan.id))}
                finish={finishLabel(scan, display(scan))}
                condition={scan.confirmedCondition}
                failure={failures.get(scan.id) ?? null}
                typedPrice={typedPrices.get(scan.id)}
                onTick={(v) => setTick(scan.id, v)}
                onCompare={() => setComparing(scan)}
                onPrice={(cents) =>
                  setTypedPrices((prev) => {
                    const next = new Map(prev);
                    if (cents == null) next.delete(scan.id);
                    else next.set(scan.id, cents);
                    return next;
                  })
                }
              />
            ))}
            {visible.length === 0 && <p className="gg-muted gg-qa__none">No cards here.</p>}
          </div>
        </>
      )}

      {noMatch.length > 0 && (
        <section className="gg-qa__nomatch" aria-label="Cards that need a manual match">
          <h2 className="gg-qa__subhead">
            {noMatch.length} card{noMatch.length === 1 ? "" : "s"} need a manual match
          </h2>
          <p className="gg-muted">Recognition had no suggestion for these. Find the printing in review.</p>
          <div className="gg-qa__nomatch-list">
            {noMatch.map((scan) => (
              <button key={scan.id} type="button" className="gg-qa__nomatch-item" onClick={() => openInReview(scan)}>
                <ScanImage url={scan.frontPreviewUrl ?? scan.frontImageUrl} alt={`Scan ${seqLabel(scan.sequenceNumber)}`} />
                <span>{seqLabel(scan.sequenceNumber)}</span>
                <span className="gg-qa__nomatch-go">
                  Find match <Icon name="chevronRight" size={12} />
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {matchable.length > 0 && (
        <div className="gg-qa__bar" role="region" aria-label="Approve">
          {running ? (
            <div className="gg-qa__progress" role="status">
              <span>
                Adding… {progress.done} of {progress.total}
              </span>
              <div className="gg-scanprogress__bar">
                <div className="gg-scanprogress__fill" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
              </div>
            </div>
          ) : (
            <>
              <div className="gg-qa__bar-fields">
                <SelectField
                  label="Condition (if not graded)"
                  value={condition}
                  onChange={(e) => setCondition(e.target.value as CardCondition)}
                >
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {CONDITION_LABELS[c]}
                    </option>
                  ))}
                </SelectField>
                <TextField
                  label="Storage location"
                  value={location}
                  placeholder="Optional, e.g. Box 12"
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>
              <div className="gg-qa__bar-actions">
                <span className="gg-qa__summary">
                  <strong>{count}</strong> ticked
                  {count > 0 && (
                    <>
                      {" · "}
                      {estimate > 0 ? `about ${formatCents(estimate)}` : ""}
                      {unpriced > 0 ? `${estimate > 0 ? " + " : ""}${unpriced} at today's price` : ""}
                    </>
                  )}
                </span>
                <Button variant="secondary" onClick={() => setConfirming("ready")} disabled={count === 0}>
                  Mark ready only
                </Button>
                <Button variant="primary" icon="checkCircle" onClick={() => setConfirming("add")} disabled={count === 0}>
                  Add {count} to inventory
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {comparing && (
        <CompareModal
          scan={comparing}
          proposal={display(comparing)}
          onClose={() => setComparing(null)}
          onChoose={(c) => choose(comparing, c)}
          onOpenInReview={() => openInReview(comparing)}
        />
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={confirming === "add" ? `Add ${count} card${count === 1 ? "" : "s"} to inventory?` : `Mark ${count} card${count === 1 ? "" : "s"} ready?`}
        message={
          `Priced at today's Scryfall price for each card's finish (raised to your price floors) unless a price was set. ` +
          `Cards not graded yet go in as ${CONDITION_LABELS[condition]}` +
          (location.trim() ? `, stored in "${location.trim()}"` : "") +
          "." +
          (confirming === "ready" ? ' They stay in this session until you click "Add ready to inventory".' : "")
        }
        confirmLabel={confirming === "add" ? `Add ${count} cards` : `Mark ${count} ready`}
        onCancel={() => setConfirming(null)}
        onConfirm={() => run(confirming === "add")}
      />
    </div>
  );
}

function ScanImage({ url, alt, large = false }: { url: string | null; alt: string; large?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <span className={large ? "gg-qa__img gg-qa__img--large gg-qa__img--empty" : "gg-qa__img gg-qa__img--empty"} role="img" aria-label={alt}>
        <Icon name="scan" size={18} />
      </span>
    );
  }
  return (
    <img
      className={large ? "gg-qa__img gg-qa__img--large" : "gg-qa__img"}
      src={url}
      alt={alt}
      loading={large ? "eager" : "lazy"}
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
}

function QuickTile({
  scan,
  proposal,
  ticked,
  disabled,
  price,
  finish,
  condition,
  failure,
  typedPrice,
  onTick,
  onCompare,
  onPrice,
}: {
  scan: CardScan;
  proposal: QuickProposal;
  ticked: boolean;
  disabled: boolean;
  price: number | null;
  finish: string;
  condition: CardCondition | null;
  failure: string | null;
  typedPrice: number | undefined;
  onTick: (value: boolean) => void;
  onCompare: () => void;
  onPrice: (cents: number | null) => void;
}) {
  const id = useId();
  const seq = seqLabel(scan.sequenceNumber);
  const needsPrice = !!failure && /price/i.test(failure);
  const [priceText, setPriceText] = useState(typedPrice != null ? (typedPrice / 100).toFixed(2) : "");
  const where = proposal.setName ?? proposal.setCode ?? "";

  return (
    <article
      className={[
        "gg-qa-tile",
        ticked ? "gg-qa-tile--ticked" : "",
        failure ? "gg-qa-tile--failed" : "",
        proposal.preselect ? "" : "gg-qa-tile--look",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="gg-qa-tile__head">
        <input
          id={id}
          type="checkbox"
          className="gg-qa-tile__check"
          checked={ticked}
          disabled={disabled}
          onChange={(e) => onTick(e.target.checked)}
          aria-label={`Approve ${seq} as ${proposal.cardName} (${proposal.setCode} #${proposal.collectorNumber})`}
        />
        <span className="gg-qa-tile__seq">{seq}</span>
        <Badge tone={KIND_TONE[proposal.kind]}>{KIND_LABEL[proposal.kind]}</Badge>
      </div>
      <button type="button" className="gg-qa-tile__pics" onClick={onCompare} title="Compare up close">
        <ScanImage url={scan.frontPreviewUrl ?? scan.frontImageUrl} alt={`Your scan ${seq}`} />
        <ScanImage url={proposal.imageUrl} alt={`${proposal.cardName} (${proposal.setCode} #${proposal.collectorNumber})`} />
      </button>
      <label htmlFor={id} className="gg-qa-tile__info">
        <span className="gg-qa-tile__name">{proposal.cardName}</span>
        <span className="gg-qa-tile__meta">
          {where} · #{proposal.collectorNumber}
        </span>
        <span className="gg-qa-tile__meta">
          {finish} · {price != null ? formatCents(price) : "today's price"}
          {condition ? ` · ${condition}` : ""}
          {scan.quantity > 1 ? ` · ×${scan.quantity}` : ""}
        </span>
        {proposal.note && <span className="gg-qa-tile__note">{proposal.note}</span>}
        {failure && (
          <span className="gg-qa-tile__fail" role="alert">
            {failure}
          </span>
        )}
      </label>
      {needsPrice && (
        <div className="gg-qa-tile__price">
          <TextField
            label="Selling price (USD)"
            type="number"
            min={0}
            step="0.01"
            value={priceText}
            onChange={(e) => setPriceText(e.target.value)}
            onBlur={() => onPrice(centsFromInput(priceText))}
          />
        </div>
      )}
      {proposal.alternatives.length > 0 && (
        <button type="button" className="gg-qa-tile__more" onClick={onCompare} disabled={disabled}>
          {proposal.kind === "sure" ? "Compare" : "Compare / other printings"}
        </button>
      )}
    </article>
  );
}

function CompareModal({
  scan,
  proposal,
  onClose,
  onChoose,
  onOpenInReview,
}: {
  scan: CardScan;
  proposal: QuickProposal;
  onClose: () => void;
  onChoose: (candidate: RecognitionCandidate) => void;
  onOpenInReview: () => void;
}) {
  const seq = seqLabel(scan.sequenceNumber);
  const others = proposal.alternatives.filter((c) => c.scryfallId !== proposal.scryfallId);
  return (
    <Modal
      open
      onClose={onClose}
      title={`${seq} · ${proposal.cardName ?? "Card"}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onOpenInReview}>
            Open in review
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="gg-qa-compare">
        <figure>
          <ScanImage url={scan.frontPreviewUrl ?? scan.frontImageUrl} alt={`Your scan ${seq}`} large />
          <figcaption>Your scan</figcaption>
        </figure>
        <figure>
          <ScanImage url={proposal.imageUrl} alt={`${proposal.cardName} (${proposal.setCode} #${proposal.collectorNumber})`} large />
          <figcaption>
            {proposal.setName ?? proposal.setCode} · #{proposal.collectorNumber}
          </figcaption>
        </figure>
      </div>
      {proposal.note && (
        <div className="gg-inline-note gg-inline-note--warning gg-qa-compare__note">
          <Icon name="warning" size={16} />
          <div>{proposal.note}</div>
        </div>
      )}
      {others.length > 0 && (
        <div className="gg-qa-alts">
          <p className="gg-qa-alts__title">Not this one? Pick the right printing:</p>
          <div className="gg-qa-alts__list">
            {others.map((c) => (
              <button key={c.scryfallId} type="button" className="gg-qa-alt" onClick={() => onChoose(c)}>
                <ScanImage url={c.imageUrl ?? null} alt={`${c.cardName} (${c.setCode} #${c.collectorNumber})`} />
                <span className="gg-qa-alt__name">{c.cardName}</span>
                <span className="gg-qa-alt__meta">
                  {c.setCode} · #{c.collectorNumber}
                </span>
                {c.reason && <span className="gg-qa-alt__reason">{c.reason}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
