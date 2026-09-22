import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "../../components/layout/PageHeader";
import { SectionCard } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Icon } from "../../components/ui/Icon";
import { Spinner, EmptyState, ErrorState } from "../../components/ui/States";
import { Modal } from "../../components/ui/Modal";
import { useAsync } from "../../hooks/useAsync";
import { useToast } from "../../hooks/useToast";
import { isScanRepositoryLive, scanRepository } from "../../repositories";
import { ensureScanSeed } from "../../repositories/scan.mock";
import { ADMIN_BASE } from "../../hooks/useRouter";
import { formatDateTime, timeAgo } from "../../utils/format";
import { SCAN_MODE_SHORT } from "../../utils/labels";
import { NewScanSessionModal } from "./NewScanSessionModal";
import { ScannerBridgePanel } from "./ScannerBridgePanel";
import type { ScanSession, ScanSessionStatus } from "../../types";
import type { BadgeTone } from "../../utils/labels";

const STATUS_LABELS: Record<ScanSessionStatus, string> = {
  uploading: "Uploading",
  processing: "Processing",
  pending_review: "Pending review",
  reviewing: "Reviewing",
  completed: "Completed",
  partially_failed: "Partially failed",
  failed: "Failed",
};

const STATUS_TONE: Record<ScanSessionStatus, BadgeTone> = {
  uploading: "info",
  processing: "info",
  pending_review: "warning",
  reviewing: "purple",
  completed: "success",
  partially_failed: "warning",
  failed: "danger",
};

export function ScanSessionsPage({
  onNavigate,
}: {
  onNavigate: (path: string) => void;
}) {
  const toast = useToast();
  const [newOpen, setNewOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ScanSession | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Nothing to seed against the real database — starts already "seeded" so
  // the live path never touches the mock's fixture data.
  const [seeded, setSeeded] = useState(isScanRepositoryLive);

  // Seed a demo session once so the section isn't empty on first load in dev
  // — mock-only fixture data, never run against the live repository.
  useEffect(() => {
    if (isScanRepositoryLive) return;
    ensureScanSeed().finally(() => setSeeded(true));
  }, []);

  const sessions = useAsync(
    () => scanRepository.listSessions(),
    [seeded],
  );

  const handleCreated = useCallback(
    (session: ScanSession) => {
      setNewOpen(false);
      toast.success(`${session.label} created.`);
      onNavigate(`${ADMIN_BASE}/scanning/${session.id}`);
    },
    [onNavigate, toast],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.id);
    try {
      await scanRepository.deleteSession(deleteTarget.id);
      toast.success(`${deleteTarget.label} deleted.`);
      setDeleteTarget(null);
      await sessions.reload();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not delete the scan session.",
      );
    } finally {
      setDeletingId(null);
    }
  }, [deleteTarget, sessions, toast]);

  const rows = sessions.data ?? [];
  const activeCount = rows.filter((session) => session.status !== "completed").length;
  const completedCount = rows.filter((session) => session.status === "completed").length;

  return (
    <>
      <div className="gg-scan-sessions-head">
        <PageHeader
          title="Card Scanning"
          description="Ingest large batches from your Ricoh fi-8170, review them fast, and add matched cards to inventory."
          actions={
            <Button variant="primary" icon="plus" onClick={() => setNewOpen(true)}>
              New scan session
            </Button>
          }
        />
      </div>

      <ScannerBridgePanel onNavigate={onNavigate} />

      <SectionCard
        title="Scan sessions"
        className="gg-sessions-section"
      >
        {rows.length > 0 && (
          <div className="gg-session-summary" aria-label="Session summary">
            <span className="gg-session-summary__item">
              <strong>{rows.length}</strong>
              <span>Total sessions</span>
            </span>
            <span className="gg-session-summary__item">
              <strong>{activeCount}</strong>
              <span>Active</span>
            </span>
            <span className="gg-session-summary__item">
              <strong>{completedCount}</strong>
              <span>Completed</span>
            </span>
          </div>
        )}
        {sessions.loading && (
          <div style={{ padding: 30 }}>
            <Spinner label="Loading sessions" />
          </div>
        )}
        {sessions.error && (
          <ErrorState message={sessions.error} onRetry={sessions.reload} />
        )}
        {!sessions.loading && !sessions.error && rows.length === 0 && (
          <EmptyState
            icon="scan"
            title="No scan sessions yet"
            message="Start a session, then drag in a batch of scans to begin."
            action={
              <Button variant="primary" icon="plus" onClick={() => setNewOpen(true)}>
                New scan session
              </Button>
            }
          />
        )}
        {rows.length > 0 && (
          <div className="gg-sessions">
            {rows.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                onOpen={onNavigate}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        )}
      </SectionCard>

      <NewScanSessionModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={handleCreated}
      />

      <Modal
        open={deleteTarget !== null}
        onClose={() => {
          if (!deletingId) setDeleteTarget(null);
        }}
        title="Delete scan session?"
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setDeleteTarget(null)}
              disabled={Boolean(deletingId)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              icon="trash"
              loading={deletingId === deleteTarget?.id}
              onClick={handleDelete}
            >
              Delete session
            </Button>
          </>
        }
      >
        <p style={{ marginTop: 0 }}>
          This permanently deletes <strong>{deleteTarget?.label}</strong>, its scan
          records, and stored scan images.
        </p>
        <p className="gg-muted" style={{ marginBottom: 0 }}>
          Cards already added to inventory will remain in inventory. Completed
          sessions can be deleted even when they contain inventory-linked scans.
        </p>
      </Modal>
    </>
  );
}

function SessionRow({
  session,
  onOpen,
  onDelete,
}: {
  session: ScanSession;
  onOpen: (path: string) => void;
  onDelete: (session: ScanSession) => void;
}) {
  const pct = useMemo(() => {
    if (session.totalCards === 0) return 0;
    return Math.round(
      ((session.addedCards + session.rejectedCards) / session.totalCards) * 100,
    );
  }, [session]);

  const hasInventoryLinks = session.addedCards > 0;
  const protectedFromDelete = hasInventoryLinks && session.status !== "completed";

  return (
    <article className="gg-sessioncard">
      <button
        type="button"
        className="gg-sessioncard__body"
        onClick={() => onOpen(`${ADMIN_BASE}/scanning/${session.id}`)}
        aria-label={`Open ${session.label}`}
      >
        <span className="gg-sessioncard__identity">
          <span className="gg-sessionrow__icon">
            <Icon name="layers" size={22} />
          </span>
          <span className="gg-sessioncard__heading">
            <span className="gg-sessioncard__title">{session.label}</span>
            <span className="gg-sessioncard__badges">
              <Badge tone={STATUS_TONE[session.status]}>
                {STATUS_LABELS[session.status]}
              </Badge>
              {session.scanMode !== "both" && (
                <Badge tone="purple">{SCAN_MODE_SHORT[session.scanMode]}</Badge>
              )}
            </span>
          </span>
        </span>

        <span className="gg-sessioncard__meta">
          <span>{session.scannerName ?? "Manual import"}</span>
          <span aria-hidden="true">•</span>
          <span>{session.totalCards} cards</span>
          <span aria-hidden="true">•</span>
          <span title={formatDateTime(session.createdAt)}>
            Created {timeAgo(session.createdAt)}
          </span>
        </span>

        <span className="gg-sessioncard__progressgroup">
          <span className="gg-sessioncard__progresslabel">
            <span>Review progress</span>
            <strong>{pct}%</strong>
          </span>
          <span className="gg-sessionrow__progress" aria-hidden="true">
            <span
              className="gg-sessionrow__progressbar"
              style={{ width: `${pct}%` }}
            />
          </span>
        </span>

        <span className="gg-sessionrow__stats">
          <SessionStat label="Matched" value={session.matchedCards} />
          <SessionStat label="Ready" value={session.readyCards} tone="gold" />
          <SessionStat label="Added" value={session.addedCards} tone="success" />
          <SessionStat
            label="Remaining"
            value={Math.max(
              0,
              session.totalCards - session.addedCards - session.rejectedCards,
            )}
          />
        </span>
      </button>

      <div className="gg-sessioncard__actions">
        {hasInventoryLinks && (
          <span
            className="gg-sessioncard__protected"
            title="Cards from this session are already in inventory"
          >
            <Icon name="checkCircle" size={15} />
            Inventory linked
          </span>
        )}
        <Button
          variant="secondary"
          size="sm"
          iconRight="chevronRight"
          onClick={() => onOpen(`${ADMIN_BASE}/scanning/${session.id}`)}
        >
          Open
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon="trash"
          aria-label={`Delete ${session.label}`}
          title={
            protectedFromDelete
              ? "Finish the session before deleting it because it contains inventory-linked scans."
              : "Delete scan session"
          }
          disabled={protectedFromDelete}
          onClick={() => onDelete(session)}
        />
      </div>
    </article>
  );
}

function SessionStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "gold" | "success";
}) {
  return (
    <span className={`gg-sessionstat ${tone ? `gg-sessionstat--${tone}` : ""}`}>
      <span className="gg-sessionstat__value">{value}</span>
      <span className="gg-sessionstat__label">{label}</span>
    </span>
  );
}
