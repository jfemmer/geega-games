import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "../../components/layout/PageHeader";
import { SectionCard } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Icon } from "../../components/ui/Icon";
import { Spinner, EmptyState, ErrorState } from "../../components/ui/States";
import { useAsync } from "../../hooks/useAsync";
import { useToast } from "../../hooks/useToast";
import { scanRepository } from "../../repositories";
import { ensureScanSeed } from "../../repositories/scan.mock";
import { CURRENT_ADMIN } from "../../data/session.mock";
import { ADMIN_BASE } from "../../hooks/useRouter";
import { formatDateTime, timeAgo } from "../../utils/format";
import { NewScanSessionModal } from "./NewScanSessionModal";
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
  const [seeded, setSeeded] = useState(false);

  // Seed a demo session once so the section isn't empty on first load in dev.
  useEffect(() => {
    ensureScanSeed(CURRENT_ADMIN.name).finally(() => setSeeded(true));
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

  const rows = sessions.data ?? [];

  return (
    <>
      <PageHeader
        title="Card Scanning"
        description="Ingest large batches from your Ricoh fi-8170, review them fast, and add matched cards to inventory."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setNewOpen(true)}>
            New scan session
          </Button>
        }
      />

      <SectionCard title="Scan sessions">
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
              <SessionRow key={s.id} session={s} onOpen={onNavigate} />
            ))}
          </div>
        )}
      </SectionCard>

      <NewScanSessionModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={handleCreated}
      />
    </>
  );
}

function SessionRow({
  session,
  onOpen,
}: {
  session: ScanSession;
  onOpen: (path: string) => void;
}) {
  const pct = useMemo(() => {
    if (session.totalCards === 0) return 0;
    return Math.round(
      ((session.addedCards + session.rejectedCards) / session.totalCards) * 100,
    );
  }, [session]);

  return (
    <button
      className="gg-sessionrow"
      onClick={() => onOpen(`${ADMIN_BASE}/scanning/${session.id}`)}
    >
      <span className="gg-sessionrow__icon">
        <Icon name="layers" size={22} />
      </span>
      <span className="gg-sessionrow__main">
        <span className="gg-sessionrow__title">
          {session.label}
          <Badge tone={STATUS_TONE[session.status]}>
            {STATUS_LABELS[session.status]}
          </Badge>
        </span>
        <span className="gg-sessionrow__sub">
          {session.scannerName ?? "Manual import"} ·{" "}
          {session.totalCards} cards · created{" "}
          <span title={formatDateTime(session.createdAt)}>
            {timeAgo(session.createdAt)}
          </span>
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
        <SessionStat label="Left" value={session.totalCards - session.addedCards - session.rejectedCards} />
      </span>
      <Icon name="chevronRight" size={18} className="gg-sessionrow__chev" />
    </button>
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
