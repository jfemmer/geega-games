import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Icon } from "../../components/ui/Icon";
import { EmptyState } from "../../components/ui/States";
import { useToast } from "../../hooks/useToast";
import { ADMIN_BASE } from "../../hooks/useRouter";
import { formatDateTime, timeAgo } from "../../utils/format";
import type { BadgeTone } from "../../utils/labels";

// Live view of the LOCAL scanner-bridge process (scanner-bridge/src/index.ts)
// — a separate Windows program that watches for PaperStream IP scans and
// uploads them, running on the same machine as whoever's operating the
// physical Ricoh fi-8170. This panel polls its local status server
// (scanner-bridge/src/statusServer.ts is the canonical shape for
// BridgeStatus — mirrored here, not imported, since the bridge is a
// separate deployable program that only talks to this app over HTTP).
//
// Most staff viewing this page are NOT at the scanning workstation — for
// them the bridge is simply unreachable, which is normal, not an error.
// Distinguish that ("not connected from this computer") from the bridge
// itself reporting trouble (state === "error" / lastError set), which IS
// actionable.
//
// A public HTTPS page fetching http://127.0.0.1 crosses Chrome's Local
// Network Access boundary (shipped Chrome 142, Oct 2025) — the browser may
// show a one-time "access devices on your local network?" permission
// prompt before this ever succeeds. Denying it looks identical to "bridge
// not running" from here, so the empty state mentions it explicitly rather
// than leaving staff to guess.

const BRIDGE_URL =
  (import.meta.env.VITE_SCANNER_BRIDGE_URL as string | undefined) ?? "http://127.0.0.1:8787";
const POLL_MS = 4000;

type BridgeState = "starting" | "watching" | "uploading" | "error";

interface BridgeStatus {
  state: BridgeState;
  watchFolder: string;
  pendingFiles: number;
  lastBatchSize: number;
  lastBatchAt: string | null;
  totalCardsCreated: number;
  totalCardsRecognized: number;
  totalRecognitionFailures: number;
  lastError: string | null;
  startedAt: string;
  currentSessionId: string | null;
}

const STATE_LABEL: Record<BridgeState, string> = {
  starting: "Starting",
  watching: "Watching for scans",
  uploading: "Uploading a batch",
  error: "Error",
};

const STATE_TONE: Record<BridgeState, BadgeTone> = {
  starting: "info",
  watching: "success",
  uploading: "info",
  error: "danger",
};

export function ScannerBridgePanel({
  onNavigate,
}: {
  onNavigate: (path: string) => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [ending, setEnding] = useState(false);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${BRIDGE_URL}/status`);
      if (!res.ok) throw new Error(`Bridge returned ${res.status}`);
      const data = (await res.json()) as BridgeStatus;
      setStatus(data);
      setUnreachable(false);
    } catch {
      setStatus(null);
      setUnreachable(true);
    }
  }, []);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [poll]);

  const endSession = useCallback(async () => {
    setEnding(true);
    try {
      const res = await fetch(`${BRIDGE_URL}/session/end`, { method: "POST" });
      if (!res.ok) throw new Error(`Bridge returned ${res.status}`);
      toast.success("Session ended — the next batch will start a new one.");
      await poll();
    } catch {
      toast.error("Could not reach the scanner bridge to end the session.");
    } finally {
      setEnding(false);
    }
  }, [poll, toast]);

  // Nothing rendered until the first check resolves (status and unreachable
  // both still at their initial values) — avoids a flash of "not connected"
  // for the (common) case where the bridge answers fast.
  if (!status && !unreachable) return null;

  if (unreachable) {
    return (
      <SectionCard title="Scanner bridge" className="gg-bridge-panel">
        <EmptyState
          icon="scan"
          title="Not connected from this computer"
          message={`Normal if you're not at the scanning workstation. If you are, make sure scanner-bridge is running there, and if Chrome shows a "use devices on your local network?" prompt for this site, click Allow.`}
        />
      </SectionCard>
    );
  }

  if (!status) return null;

  return (
    <SectionCard
      title="Scanner bridge"
      className="gg-bridge-panel"
      action={
        <Badge tone={STATE_TONE[status.state]} dot>
          {STATE_LABEL[status.state]}
        </Badge>
      }
    >
      <div className="gg-bridge-panel__stats">
        <BridgeStat label="Pending files" value={status.pendingFiles} />
        <BridgeStat label="Cards created" value={status.totalCardsCreated} />
        <BridgeStat label="Recognized" value={status.totalCardsRecognized} />
        <BridgeStat
          label="Recognition failures"
          value={status.totalRecognitionFailures}
          tone={status.totalRecognitionFailures > 0 ? "danger" : undefined}
        />
      </div>

      <p className="gg-bridge-panel__meta">
        Last batch:{" "}
        {status.lastBatchAt
          ? `${status.lastBatchSize} card(s), ${timeAgo(status.lastBatchAt)}`
          : "none yet"}
      </p>

      {status.lastError && (
        <p className="gg-bridge-panel__error" role="alert">
          <Icon name="alert" size={16} />
          {status.lastError}
        </p>
      )}

      <div className="gg-bridge-panel__actions">
        {status.currentSessionId ? (
          <Button
            variant="secondary"
            size="sm"
            iconRight="chevronRight"
            onClick={() => onNavigate(`${ADMIN_BASE}/scanning/${status.currentSessionId}`)}
          >
            Review current session
          </Button>
        ) : (
          <span className="gg-muted">No active session yet — starts on the next batch.</span>
        )}
        <Button
          variant="ghost"
          size="sm"
          loading={ending}
          disabled={!status.currentSessionId}
          onClick={endSession}
          title="The next batch will start a fresh session instead of continuing this one."
        >
          End session
        </Button>
      </div>

      <p className="gg-bridge-panel__started">
        Bridge running since {formatDateTime(status.startedAt)}
      </p>
    </SectionCard>
  );
}

function BridgeStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger";
}) {
  return (
    <span className={`gg-bridgestat ${tone ? `gg-bridgestat--${tone}` : ""}`}>
      <span className="gg-bridgestat__value">{value}</span>
      <span className="gg-bridgestat__label">{label}</span>
    </span>
  );
}
