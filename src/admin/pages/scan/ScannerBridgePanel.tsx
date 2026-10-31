import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { SectionCard } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Icon } from "../../components/ui/Icon";
import { EmptyState } from "../../components/ui/States";
import { useToast } from "../../hooks/useToast";
import { ADMIN_BASE } from "../../hooks/useRouter";
import { formatDate, formatDateTime, formatNumber, timeAgo } from "../../utils/format";
import {
  BridgeUnreachableError,
  compareVersions,
  diagnoseUnreachableBridge,
  LATEST_BRIDGE_VERSION,
  postToBridge,
  SCANNER_BRIDGE_URL,
  type BridgeProblem,
} from "../../utils/scannerBridge";
import type { BadgeTone } from "../../utils/labels";
import type { ScanRecognitionMode } from "../../types";

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
// actionable. When it's unreachable, the panel also works out why where it
// can: Chrome blocking local access for this site, or a bridge that's
// running but set up for a different address of the site
// (diagnoseUnreachableBridge in utils/scannerBridge.ts).
//
// A public HTTPS page fetching http://127.0.0.1 crosses Chrome's Local
// Network Access boundary (shipped Chrome 142, Oct 2025; "Apps on device" in
// site settings since Chrome 145) — the browser shows a one-time permission
// prompt before this ever succeeds.
//
// The bridge's status server starts before it signs in, so the panel can
// show a sign-in problem (state "error" + lastError) rather than nothing.
//
// It also reports its version. Updating the scanning PC takes three steps
// (git pull; npm install + npm run build; restart) and a half-done update
// leaves the old code running with no sign of it, so the panel asks for an
// update when the bridge is older than LATEST_BRIDGE_VERSION, and says
// exactly which step is left when the bridge sees newer files on disk than
// the code it's running (pendingUpdate).
//
// "Scan now" and "Check scanner connection" drive the fi-8170 directly via
// the bridge's scan endpoints, which run NAPS2.Console.exe (TWAIN by
// default) — no PaperStream IP window; see scanner-bridge/README.md section
// 7. The Foil / Non-foil switch is sent with each scan and pre-selects the
// finish for that batch. The scan type switch picks what the batch is for
// (scanner-bridge/src/scanKind.ts): Inventory identifies each card from its
// front at 300 dpi; Condition grades from both sides at 600 dpi without
// matching; Inventory + condition does both at 600 dpi. Each type goes into
// its own session. Bridges before 1.3.0 don't report sessionsByKind, so the
// switch only shows for ones that can do it. The "Card recognition" block reports the bridge's
// on-PC recognizer (scanner-bridge/README.md section 8): its card library,
// build progress and self-test score — or, when it can't run on that PC
// ("unavailable"), why, with a link to the fix.

const POLL_MS = 4000;

type BridgeState = "starting" | "watching" | "uploading" | "scanning" | "error";
type BatchFinish = "nonfoil" | "foil";
/** The scan types "Scan now" offers — the session scan modes. */
type ScanKind = ScanRecognitionMode;

const SCAN_KINDS: readonly ScanKind[] = ["card_matching", "condition", "both"];

const SCAN_KIND_COPY: Record<ScanKind, { tab: string; button: string; name: string; hint: (dpi: number) => string }> = {
  card_matching: {
    tab: "Inventory",
    button: "Inventory scan",
    name: "inventory",
    hint: (dpi) => `Identifies each card from its front at ${dpi} dpi — the fastest. No grading: set condition in review. Feed cards face up.`,
  },
  condition: {
    tab: "Condition",
    button: "Condition scan",
    name: "condition",
    hint: (dpi) =>
      `Grades each card from both sides at ${dpi} dpi so wear shows — slower. No matching: match each card with Find Match in review.`,
  },
  both: {
    tab: "Inventory + condition",
    button: "Inventory + condition scan",
    name: "inventory + condition",
    hint: (dpi) => `Identifies and grades each card from both sides at ${dpi} dpi — slower than an inventory scan. Check each suggested grade in review.`,
  },
};
type RecognizerState =
  | "off"
  | "starting"
  | "downloading_model"
  | "building_library"
  | "ready"
  | "error"
  | "unavailable";

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
  /** A link to the fix (e.g. a Windows component to install). Older bridges don't send it. */
  help?: { label: string; url: string } | null;
  library: { entries: number; builtAt: string; cardListRefreshedAt: string | null } | null;
  build: { phase: string; done: number; total: number; failed: number; startedAt: string } | null;
  modelDownload: { receivedBytes: number; totalBytes: number | null } | null;
  selfTest: SelfTestSummary | null;
  selfTestRunning: boolean;
  textReader: boolean;
  lastError: string | null;
}

interface BridgeStatus {
  /** Older bridges (before 1.1.0) don't report these. */
  version?: string;
  pendingUpdate?: { version: string; step: "build" | "restart" } | null;
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
  /** Bridges before 1.3.0 don't report these (no scan type switch). */
  scanKind?: ScanKind | "standard";
  scanDpiByKind?: Record<ScanKind, number>;
  sessionsByKind?: Record<ScanKind, string | null>;
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
  unavailable: "danger",
};

const RECOGNIZER_LABEL: Record<RecognizerState, string> = {
  off: "Off",
  starting: "Starting",
  downloading_model: "Downloading model",
  building_library: "Building library",
  ready: "Ready",
  error: "Needs attention",
  unavailable: "Needs setup",
};

/** What to tell staff when the bridge can't be reached, by likely cause. */
function unreachableCopy(problem: BridgeProblem | null): { title: string; message: string } {
  if (problem === "browser_blocked") {
    return {
      title: "Chrome is blocking the scanner bridge",
      message:
        'This site isn\'t allowed to reach apps on this computer. If this is the scanning PC, click the icon at the left end of the address bar, open Site settings, set "Apps on device" (older Chrome: "Local network access") to Allow, then reload this page. On any other computer, this is fine as it is.',
    };
  }
  if (problem === "wrong_site") {
    const origin = window.location.origin;
    return {
      title: "Scanner bridge is set up for a different address",
      message: `The scanner bridge is running on this computer but won't talk to ${origin}. In scanner-bridge/.env set GEEGA_API_BASE_URL=${origin} and restart the bridge, or open the dashboard at the address the bridge is set up for.`,
    };
  }
  return {
    title: "Not connected from this computer",
    message:
      'Normal if you\'re not at the scanning PC. At the scanning PC, start the scanner bridge and wait for "Ready" in its window (if it stops, bridge-error.log in its folder says why). If Chrome asks to let this site use apps on this device, click Allow.',
  };
}

const STOP_THE_BRIDGE = 'close its window, or end its "Node.js" task in Task Manager when it runs in the background';

/** What's left to do when the scanning PC isn't running the latest bridge (null: it is). */
function updateNotice(status: BridgeStatus): { title: string; message: ReactNode } | null {
  const running = status.version;
  const pending = status.pendingUpdate;
  if (running && pending) {
    if (pending.step === "restart") {
      return {
        title: "Restart the scanner bridge to finish updating",
        message: `Version ${pending.version} is installed, but version ${running} is still running. Stop it (${STOP_THE_BRIDGE}), then start it again.`,
      };
    }
    return {
      title: "Finish updating the scanner bridge",
      message: (
        <>
          This PC has the files for version {pending.version}, but they haven&rsquo;t been built, so version {running} is still
          running. Stop the bridge ({STOP_THE_BRIDGE}). In the scanner-bridge folder run <code>npm install</code>, then{" "}
          <code>npm run build</code>, and start it again.
        </>
      ),
    };
  }
  if (running && compareVersions(running, LATEST_BRIDGE_VERSION) >= 0) return null;
  return {
    title: "Update the scanner bridge on this PC",
    message: (
      <>
        It&rsquo;s running {running ? `version ${running}` : "an older version"}; the latest is {LATEST_BRIDGE_VERSION}. Scans
        still upload meanwhile, but card recognition misses the latest fixes. Stop the bridge ({STOP_THE_BRIDGE}). In the
        scanner-bridge folder run <code>git pull</code>, <code>npm install</code> and <code>npm run build</code>, then start
        it again.
      </>
    ),
  };
}

const pct = (v: number) => `${(v * 100).toFixed(1).replace(/\.0$/, "")}%`;

export function ScannerBridgePanel({
  onNavigate,
}: {
  onNavigate: (path: string) => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [problem, setProblem] = useState<BridgeProblem | null>(null);
  const diagnosing = useRef(false);
  const [ending, setEnding] = useState(false);
  const [starting, setStarting] = useState(false);
  const [checkingDevices, setCheckingDevices] = useState(false);
  const [deviceCheck, setDeviceCheck] = useState<DeviceCheckResult | null>(null);
  const [finishSaving, setFinishSaving] = useState(false);
  const [kindSaving, setKindSaving] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState<"update" | "selftest" | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${SCANNER_BRIDGE_URL}/status`);
      if (!res.ok) throw new Error(`Bridge returned ${res.status}`);
      const data = (await res.json()) as BridgeStatus;
      setStatus(data);
      setUnreachable(false);
      setProblem(null);
    } catch {
      setStatus(null);
      setUnreachable(true);
      if (!diagnosing.current) {
        diagnosing.current = true;
        void diagnoseUnreachableBridge()
          .then(setProblem)
          .catch(() => setProblem(null))
          .finally(() => {
            diagnosing.current = false;
          });
      }
    }
  }, []);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [poll]);

  const sessionsByKind = status?.sessionsByKind;
  const openSessions = sessionsByKind ? SCAN_KINDS.filter((k) => sessionsByKind[k]).length : status?.currentSessionId ? 1 : 0;
  const endSession = useCallback(async () => {
    setEnding(true);
    try {
      const res = await fetch(`${SCANNER_BRIDGE_URL}/session/end`, { method: "POST" });
      if (!res.ok) throw new Error(`Bridge returned ${res.status}`);
      toast.success(
        openSessions > 1
          ? "Sessions ended — the next batches will start new ones."
          : "Session ended — the next batch will start a new one.",
      );
      await poll();
    } catch {
      toast.error("Could not reach the scanner bridge to end the session.");
    } finally {
      setEnding(false);
    }
  }, [openSessions, poll, toast]);

  const batchFinish: BatchFinish = status?.batchFinish ?? "nonfoil";
  const supportsFinish = status?.batchFinish !== undefined;
  const supportsScanKind =
    status?.sessionsByKind !== undefined && status.scanDpiByKind !== undefined && SCAN_KINDS.includes(status.scanKind as ScanKind);
  const scanKind: ScanKind = supportsScanKind ? (status!.scanKind as ScanKind) : "card_matching";
  const kindDpi = status?.scanDpiByKind?.[scanKind] ?? null;

  const startScan = useCallback(async () => {
    setStarting(true);
    try {
      const body = {
        ...(supportsFinish ? { batchFinish } : {}),
        ...(supportsScanKind ? { scanKind } : {}),
      };
      const reply = await postToBridge<{ ok?: boolean; message?: string }>(
        "/scan/start",
        Object.keys(body).length > 0 ? body : undefined,
      );
      if (reply.status === 409) {
        toast.error("A scan is already running.");
        return;
      }
      if (!reply.ok) {
        // The bridge says why (still signing in, a sign-in that failed, …).
        toast.error(reply.data.message ?? `The scanner bridge couldn't start a scan (error ${reply.status}).`);
        await poll();
        return;
      }
      const what = [supportsScanKind && kindDpi ? `${kindDpi} dpi` : null, batchFinish === "foil" ? "foil batch" : null]
        .filter(Boolean)
        .join(", ");
      const started = supportsScanKind ? `${SCAN_KIND_COPY[scanKind].button} started` : "Scan started";
      toast.success(`${started}${what ? ` (${what})` : ""} — feed the cards into the ADF now.`);
      await poll();
    } catch (err) {
      toast.error(
        err instanceof BridgeUnreachableError
          ? "Could not reach the scanner bridge to start a scan."
          : "The scanner bridge couldn't start a scan.",
      );
    } finally {
      setStarting(false);
    }
  }, [batchFinish, supportsFinish, scanKind, supportsScanKind, kindDpi, poll, toast]);

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

  const setKind = useCallback(
    async (next: ScanKind) => {
      if (next === scanKind) return;
      setKindSaving(true);
      try {
        const reply = await postToBridge("/settings", { scanKind: next });
        if (!reply.ok) throw new Error(`Bridge returned ${reply.status}`);
        await poll();
      } catch {
        toast.error("Could not reach the scanner bridge to change the scan type.");
      } finally {
        setKindSaving(false);
      }
    },
    [scanKind, poll, toast],
  );

  const updateLibrary = useCallback(async () => {
    setLibraryBusy("update");
    try {
      const reply = await postToBridge<{ ok?: boolean; message?: string }>("/library/update");
      if (reply.ok) toast.success(reply.data.message ?? "Updating the card library in the background.");
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
    const copy = unreachableCopy(problem);
    return (
      <SectionCard title="Scanner bridge" className="gg-bridge-panel">
        <EmptyState icon="scan" title={copy.title} message={copy.message} />
      </SectionCard>
    );
  }

  if (!status) return null;

  const scanning = status.state === "scanning" || status.state === "uploading";
  // "starting": signing in. "error": sign-in failed (the reason is shown above).
  const cantScanYet = status.state === "starting" || status.state === "error";
  const update = updateNotice(status);

  return (
    <SectionCard
      title="Scanner bridge"
      className="gg-bridge-panel"
      action={
        <Badge tone={STATE_TONE[status.state] ?? "neutral"} dot>
          {STATE_LABEL[status.state] ?? status.state}
        </Badge>
      }
    >
      {update && (
        <div className="gg-inline-note gg-inline-note--warning gg-bridge-panel__update" role="status">
          <Icon name="warning" size={16} />
          <div>
            <p className="gg-bridge-panel__update-title">{update.title}</p>
            <p className="gg-bridge-panel__update-text">{update.message}</p>
          </div>
        </div>
      )}

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
        {supportsScanKind && (
          <div className="gg-tabs gg-bridge-panel__finish gg-bridge-panel__kind" role="radiogroup" aria-label="Scan type for this batch">
            {SCAN_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={scanKind === k}
                className={`gg-tab ${scanKind === k ? "gg-tab--active" : ""}`}
                disabled={kindSaving || scanning}
                onClick={() => void setKind(k)}
              >
                {SCAN_KIND_COPY[k].tab}
              </button>
            ))}
          </div>
        )}
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
        <Button
          variant="primary"
          icon="scan"
          loading={starting}
          disabled={scanning || cantScanYet}
          onClick={startScan}
        >
          Scan now
        </Button>
        <span className="gg-muted">
          {status.state === "starting"
            ? "The bridge is signing in — Scan now is ready in a moment."
            : status.state === "error"
              ? "Scanning is paused until the problem above is fixed."
              : supportsScanKind && kindDpi
                ? `${SCAN_KIND_COPY[scanKind].hint(kindDpi)}${supportsFinish ? " Put foils in their own batch with Foil selected." : ""}`
                : `Drives the fi-8170 directly${status.scanDpi ? ` at ${status.scanDpi} dpi` : ""} — no need to open PaperStream IP. Feed cards into the ADF once this starts${supportsFinish ? "; put foils in their own batch with Foil selected" : ""}.`}
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
        {openSessions > 0 ? (
          <div className="gg-bridge-panel__sessions">
            {sessionsByKind ? (
              SCAN_KINDS.filter((k) => sessionsByKind[k]).map((k) => (
                <Button
                  key={k}
                  variant="secondary"
                  size="sm"
                  iconRight="chevronRight"
                  onClick={() => onNavigate(`${ADMIN_BASE}/scanning/${sessionsByKind[k]}`)}
                >
                  Review {SCAN_KIND_COPY[k].name} session
                </Button>
              ))
            ) : (
              <Button
                variant="secondary"
                size="sm"
                iconRight="chevronRight"
                onClick={() => onNavigate(`${ADMIN_BASE}/scanning/${status.currentSessionId}`)}
              >
                Review current session
              </Button>
            )}
          </div>
        ) : (
          <span className="gg-muted">No active session yet — starts on the next batch.</span>
        )}
        <Button
          variant="ghost"
          size="sm"
          loading={ending}
          disabled={openSessions === 0}
          onClick={endSession}
          title={
            openSessions > 1
              ? "The next batch of each scan type will start a fresh session."
              : "The next batch will start a fresh session instead of continuing this one."
          }
        >
          {openSessions > 1 ? "End sessions" : "End session"}
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
        {status.version ? `Bridge version ${status.version}, running` : "Bridge running"} since {formatDateTime(status.startedAt)}
      </p>
    </SectionCard>
  );
}

/** The on-PC card recognizer: library, progress, self-test — or what it needs to run. */
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
  const trouble = state === "error" || state === "unavailable";
  // Only ever an https link from the bridge on this PC.
  const help = recognizer.help && /^https:\/\//i.test(recognizer.help.url) ? recognizer.help : null;
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
        <Badge tone={RECOGNIZER_TONE[state] ?? "neutral"} dot>
          {RECOGNIZER_LABEL[state] ?? state}
        </Badge>
      </div>
      <p className={trouble ? "gg-bridge-panel__error gg-bridge-recog__problem" : "gg-bridge-recog__message"}>
        {recognizer.message}
      </p>
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
      {(help || (state !== "off" && state !== "unavailable")) && (
        <div className="gg-bridge-recog__actions">
          {help && (
            <a
              className="gg-btn gg-btn--secondary gg-btn--sm gg-bridge-recog__help"
              href={help.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="download" size={15} />
              <span>{help.label}</span>
            </a>
          )}
          {state !== "off" && state !== "unavailable" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                icon={state === "error" ? undefined : "download"}
                loading={busy === "update"}
                disabled={building || state === "starting" || state === "downloading_model"}
                onClick={onUpdate}
              >
                {state === "error" ? "Try again" : "Update card library"}
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
            </>
          )}
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
