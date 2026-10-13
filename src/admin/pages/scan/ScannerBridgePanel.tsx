import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Icon } from "../../components/ui/Icon";
import { EmptyState } from "../../components/ui/States";
import { useToast } from "../../hooks/useToast";
import { ADMIN_BASE } from "../../hooks/useRouter";
import { formatDate, formatDateTime, formatNumber, timeAgo } from "../../utils/format";
import { postToBridge, SCANNER_BRIDGE_URL } from "../../utils/scannerBridge";
import type { BadgeTone } from "../../utils/labels";

// Live view of the LOCAL scanner-bridge process (scanner-bridge/src/index.ts)
// — a separate Windows program that drives the Ricoh fi-8170 (or watches for
// PaperStream IP scans), identifies each card ON THAT PC, and uploads it. This
// panel polls its local status server (scanner-bridge/src/statusServer.ts
// is the canonical shape for BridgeStatus — mirrored here, not imported,
// since the bridge is a separate deployable program that only talks to this
// app over HTTP).
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
//
// "Scan now" and "Check scanner connection" drive the fi-8170 directly via
// the bridge's scan endpoints, which run NAPS2.Console.exe (TWAIN by
// default) — no PaperStream IP window; see scanner-bridge/README.md section
// 7. The Foil / Non-foil switch is sent with each scan and pre-selects the
// finish for that batch. The "Card recognition" block reports the bridge's
// on-PC recognizer (scanner-bridge/README.md section 8): its card library,
// build progress and self-test score.

const POLL_MS = 4000;

type BridgeState = "starting" | "watching" | "uploading" | "scanning" | "error";
type BatchFinish = "nonfoil" | "foil";
type RecognizerState = "off" | "starting" | "downloading_model" | "building_library" | "ready" | "error";

interface DeviceCheckResult {
  ok: boolean;
  message: string;
  rawOutput: string;
}

interface SelfTestSummary {
  at: string;
  samples: number;
  exactPrinting: number;
  rightName: number;
  sure: number;
  sureCorrect: number;
  check: number;
  none: number;
  meanMs: number;
}

interface RecognizerStatus {
  state: RecognizerState;
  message: string;
  library: { entries: number; builtAt: string; cardListRefreshedAt: string | null } | null;
  build: { phase: string; done: number; total: number; failed: number; startedAt: string } | null;
  modelDownload: { receivedBytes: number; totalBytes: number | null } | null;
  selfTest: SelfTestSummary | null;
  selfTestRunning: boolean;
  textReader: boolean;
  lastError: string | null;
}

interface BridgeStatus {
  state: BridgeState;
  watchFolder: string;
  pendingFiles: number;
  lastBatchSize: number;
  lastBatchAt: string | null;
  totalCardsCreated: number;
  totalCardsRecognized: number;
  /** Older bridges don't report these. */
  totalCardsRecognizedOnPc?: number;
  totalRecognitionFailures: number;
  lastError: string | null;
  startedAt: string;
  currentSessionId: string | null;
  lastScanResult: {
    ok: boolean;
    pagesScanned: number;
    message: string;
    at: string;
  } | null;
  batchFinish?: BatchFinish;
  scanDpi?: number;
  recognizer?: RecognizerStatus;
}

const STATE_LABEL: Record<BridgeState, string> = {
  starting: "Starting",
  watching: "Watching for scans",
  uploading: "Uploading a batch",
  scanning: "Scanning cards",
  error: "Error",
};

const STATE_TONE: Record<BridgeState, BadgeTone> = {
  starting: "info",
  watching: "success",
  uploading: "info",
  scanning: "info",
  error: "danger",
};

const RECOGNIZER_TONE: Record<RecognizerState, BadgeTone> = {
  off: "neutral",
  starting: "info",
  downloading_model: "info",
  building_library: "info",
  ready: "success",
  error: "danger",
};

const RECOGNIZER_LABEL: Record<RecognizerState, string> = {
  off: "Off",
  starting: "Starting",
  downloading_model: "Downloading model",
  building_library: "Building library",
  ready: "Ready",
  error: "Needs attention",
};

const pct = (v: number) => `${(v * 100).toFixed(1).replace(/\.0$/, "")}%`;

export function ScannerBridgePanel({
  onNavigate,
}: {
  onNavigate: (path: string) => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [ending, setEnding] = useState(false);
  const [starting, setStarting] = useState(false);
  const [checkingDevices, setCheckingDevices] = useState(false);
  const [deviceCheck, setDeviceCheck] = useState<DeviceCheckResult | null>(null);
  const [finishSaving, setFinishSaving] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState<"update" | "selftest" | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${SCANNER_BRIDGE_URL}/status`);
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
      const res = await fetch(`${SCANNER_BRIDGE_URL}/session/end`, { method: "POST" });
      if (!res.ok) throw new Error(`Bridge returned ${res.status}`);
      toast.success("Session ended — the next batch will start a new one.");
      await poll();
    } catch {
      toast.error("Could not reach the scanner bridge to end the session.");
    } finally {
      setEnding(false);
    }
  }, [poll, toast]);

  const batchFinish: BatchFinish = status?.batchFinish ?? "nonfoil";
  const supportsFinish = status?.batchFinish !== undefined;

  const startScan = useCallback(async () => {
    setStarting(true);
    try {
      const reply = await postToBridge("/scan/start", supportsFinish ? { batchFinish } : undefined);
      if (reply.status === 409) {
        toast.error("A scan is already running.");
        return;
      }
      if (!reply.ok) throw new Error(`Bridge returned ${reply.status}`);
      toast.success(
        batchFinish === "foil"
          ? "Scan started (foil batch) — feed the cards into the ADF now."
          : "Scan started — feed the cards into the ADF now.",
      );
      await poll();
    } catch {
      toast.error("Could not reach the scanner bridge to start a scan.");
    } finally {
      setStarting(false);
    }
  }, [batchFinish, supportsFinish, poll, toast]);

  const setFinish = useCallback(
    async (next: BatchFinish) => {
      if (next === batchFinish) return;
      setFinishSaving(true);
      try {
        const reply = await postToBridge("/settings", { batchFinish: next });
        if (!reply.ok) throw new Error(`Bridge returned ${reply.status}`);
        await poll();
      } catch {
        toast.error("Could not reach the scanner bridge to change the finish.");
      } finally {
        setFinishSaving(false);
      }
    },
    [batchFinish, poll, toast],
  );

  const updateLibrary = useCallback(async () => {
    setLibraryBusy("update");
    try {
      const reply = await postToBridge<{ ok?: boolean; message?: string }>("/library/update");
      if (reply.ok) toast.success("Updating the card library in the background.");
      else toast.error(reply.data.message ?? "The card library couldn't start updating.");
      await poll();
    } catch {
      toast.error("Could not reach the scanner bridge.");
    } finally {
      setLibraryBusy(null);
    }
  }, [poll, toast]);

  const runSelfTest = useCallback(async () => {
    setLibraryBusy("selftest");
    try {
      const reply = await postToBridge<{ ok?: boolean; message?: string }>("/library/self-test");
      if (reply.ok) toast.success("Self-test started — the score appears here in a few minutes.");
      else toast.error(reply.data.message ?? "The self-test couldn't start.");
      await poll();
    } catch {
      toast.error("Could not reach the scanner bridge.");
    } finally {
      setLibraryBusy(null);
    }
  }, [poll, toast]);

  const checkDevices = useCallback(async () => {
    setCheckingDevices(true);
    setDeviceCheck(null);
    try {
      const res = await fetch(`${SCANNER_BRIDGE_URL}/scan/devices`);
      const data = (await res.json()) as DeviceCheckResult;
      setDeviceCheck(data);
    } catch {
      setDeviceCheck({
        ok: false,
        message: "Could not reach the scanner bridge.",
        rawOutput: "",
      });
    } finally {
      setCheckingDevices(false);
    }
  }, []);

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

  const scanning = status.state === "scanning" || status.state === "uploading";

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
        {status.totalCardsRecognizedOnPc !== undefined && (
          <BridgeStat label="On this PC" value={status.totalCardsRecognizedOnPc} />
        )}
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

      <div className="gg-bridge-panel__scannow">
        {supportsFinish && (
          <div className="gg-tabs gg-bridge-panel__finish" role="radiogroup" aria-label="Finish for this batch">
            {(["nonfoil", "foil"] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={batchFinish === f}
                className={`gg-tab ${batchFinish === f ? "gg-tab--active" : ""}`}
                disabled={finishSaving || scanning}
                onClick={() => void setFinish(f)}
              >
                {f === "foil" ? "Foil" : "Non-foil"}
              </button>
            ))}
          </div>
        )}
        <Button variant="primary" icon="scan" loading={starting} disabled={scanning} onClick={startScan}>
          Scan now
        </Button>
        <span className="gg-muted">
          Drives the fi-8170 directly{status.scanDpi ? ` at ${status.scanDpi} dpi` : ""} — no need to open
          PaperStream IP. Feed cards into the ADF once this starts
          {supportsFinish ? "; put foils in their own batch with Foil selected" : ""}.
        </span>
      </div>

      {status.lastScanResult && (
        <p
          className={
            status.lastScanResult.ok ? "gg-bridge-panel__diagnostic-ok" : "gg-bridge-panel__error"
          }
          role={status.lastScanResult.ok ? undefined : "alert"}
        >
          {status.lastScanResult.ok ? (
            <Icon name="checkCircle" size={16} />
          ) : (
            <Icon name="alert" size={16} />
          )}
          Last direct scan ({timeAgo(status.lastScanResult.at)}): {status.lastScanResult.message}
        </p>
      )}

      {status.recognizer && (
        <RecognizerBlock
          recognizer={status.recognizer}
          busy={libraryBusy}
          onUpdate={updateLibrary}
          onSelfTest={runSelfTest}
        />
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

      <div className="gg-bridge-panel__diagnostic">
        <Button variant="ghost" size="sm" loading={checkingDevices} onClick={checkDevices}>
          Check scanner connection
        </Button>
        {deviceCheck && (
          <p
            className={deviceCheck.ok ? "gg-bridge-panel__diagnostic-ok" : "gg-bridge-panel__error"}
            role={deviceCheck.ok ? undefined : "alert"}
          >
            {deviceCheck.ok ? <Icon name="checkCircle" size={16} /> : <Icon name="alert" size={16} />}
            {deviceCheck.message}
            {deviceCheck.rawOutput && (
              <>
                {" — "}
                <code className="gg-bridge-panel__diagnostic-raw">{deviceCheck.rawOutput.trim()}</code>
              </>
            )}
          </p>
        )}
      </div>

      <p className="gg-bridge-panel__started">
        Bridge running since {formatDateTime(status.startedAt)}
      </p>
    </SectionCard>
  );
}

/** The on-PC card recognizer: library, progress, self-test. */
function RecognizerBlock({
  recognizer,
  busy,
  onUpdate,
  onSelfTest,
}: {
  recognizer: RecognizerStatus;
  busy: "update" | "selftest" | null;
  onUpdate: () => void;
  onSelfTest: () => void;
}) {
  const { state, library, build, modelDownload, selfTest } = recognizer;
  const building = build !== null;
  const progress =
    modelDownload && modelDownload.totalBytes
      ? modelDownload.receivedBytes / modelDownload.totalBytes
      : build && build.phase === "fingerprinting" && build.total > 0
        ? build.done / build.total
        : null;

  return (
    <div className="gg-bridge-recog" aria-live="polite">
      <div className="gg-bridge-recog__head">
        <span className="gg-bridge-recog__title">Card recognition on this PC</span>
        <Badge tone={RECOGNIZER_TONE[state]} dot>
          {RECOGNIZER_LABEL[state]}
        </Badge>
      </div>
      <p className={state === "error" ? "gg-bridge-panel__error" : "gg-bridge-recog__message"}>{recognizer.message}</p>
      {progress !== null && (
        <div
          className="gg-bridge-recog__bar"
          role="progressbar"
          aria-label={modelDownload ? "Model download" : "Card library build"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <div className="gg-bridge-recog__fill" style={{ width: `${Math.max(2, Math.round(progress * 100))}%` }} />
        </div>
      )}
      {building && state === "ready" && build && (
        <p className="gg-bridge-recog__meta">
          Updating in the background: {formatNumber(build.done)} of {formatNumber(build.total)} new card images
          {build.failed ? ` (${build.failed} couldn't be downloaded)` : ""}.
        </p>
      )}
      {library && (
        <p className="gg-bridge-recog__meta">
          {formatNumber(library.entries)} card faces · library built {formatDate(library.builtAt)}
          {library.cardListRefreshedAt ? ` · Scryfall card list from ${formatDate(library.cardListRefreshedAt)}` : ""}
        </p>
      )}
      {selfTest && selfTest.samples > 0 && (
        <p className="gg-bridge-recog__meta">
          Self-test ({formatDate(selfTest.at)}, {selfTest.samples} cards): {pct(selfTest.exactPrinting)} exact printing,{" "}
          {pct(selfTest.rightName)} right card · "sure" right {selfTest.sureCorrect} of {selfTest.sure} · ~
          {selfTest.meanMs} ms per card
        </p>
      )}
      {recognizer.selfTestRunning && <p className="gg-bridge-recog__meta">Self-test running…</p>}
      {state !== "off" && (
        <div className="gg-bridge-recog__actions">
          <Button
            variant="ghost"
            size="sm"
            icon="download"
            loading={busy === "update"}
            disabled={building || state === "starting" || state === "downloading_model"}
            onClick={onUpdate}
          >
            Update card library
          </Button>
          <Button
            variant="ghost"
            size="sm"
            loading={busy === "selftest"}
            disabled={state !== "ready" || recognizer.selfTestRunning}
            onClick={onSelfTest}
          >
            Run self-test
          </Button>
        </div>
      )}
    </div>
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
