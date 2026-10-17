// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import { ScannerBridgePanel } from "../src/admin/pages/scan/ScannerBridgePanel";
import { LATEST_BRIDGE_VERSION } from "../src/admin/utils/scannerBridge";

// The Scanner panel talks to the bridge on the scanning PC: the Foil switch,
// "Scan now" carrying it, and the on-PC recognizer's library + self-test.

const BRIDGE = "http://127.0.0.1:8787";

function bridgeStatus(overrides: Record<string, unknown> = {}) {
  return {
    version: LATEST_BRIDGE_VERSION,
    pendingUpdate: null,
    state: "watching",
    watchFolder: "C:\\GeegaScans\\Incoming",
    pendingFiles: 0,
    lastBatchSize: 0,
    lastBatchAt: null,
    totalCardsCreated: 50,
    totalCardsRecognized: 50,
    totalCardsRecognizedOnPc: 48,
    totalRecognitionFailures: 0,
    lastError: null,
    startedAt: "2026-10-12T12:00:00.000Z",
    currentSessionId: null,
    lastScanResult: null,
    batchFinish: "nonfoil",
    scanDpi: 300,
    recognizer: {
      state: "ready",
      message: "Ready — 108,512 card faces in the library.",
      library: { entries: 108512, builtAt: "2026-10-12T06:00:00.000Z", cardListRefreshedAt: "2026-09-16T03:22:29.000Z" },
      build: null,
      modelDownload: null,
      selfTest: { at: "2026-10-12T07:00:00.000Z", samples: 200, exactPrinting: 0.985, rightName: 1, sure: 180, sureCorrect: 180, check: 20, none: 0, meanMs: 420 },
      selfTestRunning: false,
      textReader: true,
      lastError: null,
    },
    ...overrides,
  };
}

function stubBridge(status: Record<string, unknown>) {
  const calls: { url: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url === `${BRIDGE}/status`) return new Response(JSON.stringify(status), { status: 200 });
    if (url === `${BRIDGE}/settings`) {
      status.batchFinish = body.batchFinish;
      return new Response(JSON.stringify({ ok: true, batchFinish: body.batchFinish }), { status: 200 });
    }
    if (url === `${BRIDGE}/scan/start`) return new Response(JSON.stringify({ started: true }), { status: 202 });
    if (url === `${BRIDGE}/library/update`) return new Response(JSON.stringify({ ok: true }), { status: 202 });
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function renderPanel() {
  return render(
    <ToastProvider>
      <ScannerBridgePanel onNavigate={vi.fn()} />
    </ToastProvider>,
  );
}

/** No bridge answers this page: optionally something answers a no-cors probe, and Chrome's local-access permission state. */
function stubUnreachable({ answersProbe = false, permission }: { answersProbe?: boolean; permission?: PermissionState } = {}) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.mode === "no-cors" && answersProbe) return new Response(null, { status: 200 });
    throw new TypeError("Failed to fetch");
  });
  vi.stubGlobal("fetch", fetchMock);
  if (permission) {
    Object.defineProperty(window.navigator, "permissions", {
      configurable: true,
      value: {
        query: vi.fn(async ({ name }: { name: string }) => {
          if (name !== "loopback-network") throw new TypeError(`Unknown permission ${name}`);
          return { state: permission };
        }),
      },
    });
  }
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window.navigator as unknown as Record<string, unknown>).permissions;
});

describe("ScannerBridgePanel", () => {
  it("shows the card library and its self-test score", async () => {
    stubBridge(bridgeStatus());
    renderPanel();
    expect(await screen.findByText("Card recognition on this PC")).toBeInTheDocument();
    expect(screen.getByText(/108,512 card faces · library built/)).toBeInTheDocument();
    expect(screen.getByText(/Scryfall card list from/)).toBeInTheDocument();
    expect(screen.getByText(/98\.5% exact printing, 100% right card/)).toBeInTheDocument();
    expect(screen.getByText("On this PC")).toBeInTheDocument();
  });

  it("sends the foil switch with Scan now, and saves it when flipped", async () => {
    const status = bridgeStatus();
    const calls = stubBridge(status);
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("radio", { name: "Foil" }));
    await waitFor(() => expect(calls.some((c) => c.url === `${BRIDGE}/settings`)).toBe(true));
    expect(calls.find((c) => c.url === `${BRIDGE}/settings`)?.body).toEqual({ batchFinish: "foil" });
    await waitFor(() => expect(screen.getByRole("radio", { name: "Foil" })).toHaveAttribute("aria-checked", "true"));

    await user.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(calls.some((c) => c.url === `${BRIDGE}/scan/start`)).toBe(true));
    expect(calls.find((c) => c.url === `${BRIDGE}/scan/start`)?.body).toEqual({ batchFinish: "foil" });
    expect(await screen.findByText(/foil batch/)).toBeInTheDocument();
  });

  it("shows build progress while the library is being made, and can be asked to update", async () => {
    const calls = stubBridge(
      bridgeStatus({
        recognizer: {
          ...bridgeStatus().recognizer,
          state: "building_library",
          message: "Building the card library… 45% (50,000 of 110,000)",
          library: null,
          selfTest: null,
          build: { phase: "fingerprinting", done: 50000, total: 110000, failed: 0, startedAt: "2026-10-12T01:00:00.000Z" },
        },
      }),
    );
    renderPanel();
    expect(await screen.findByRole("progressbar", { name: "Card library build" })).toHaveAttribute("aria-valuenow", "45");
    expect(screen.getByRole("button", { name: "Update card library" })).toBeDisabled();
    expect(calls.some((c) => c.url === `${BRIDGE}/library/update`)).toBe(false);
  });

  it("works with an older bridge that has no recognizer", async () => {
    const old = bridgeStatus();
    delete (old as Record<string, unknown>).recognizer;
    delete (old as Record<string, unknown>).batchFinish;
    delete (old as Record<string, unknown>).totalCardsRecognizedOnPc;
    const calls = stubBridge(old);
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(calls.some((c) => c.url === `${BRIDGE}/scan/start`)).toBe(true));
    expect(calls.find((c) => c.url === `${BRIDGE}/scan/start`)?.body).toBeUndefined();
    expect(screen.queryByRole("radio", { name: "Foil" })).toBeNull();
    expect(screen.queryByText("Card recognition on this PC")).toBeNull();
  });

  it("says the bridge isn't connected from this computer when nothing answers", async () => {
    stubUnreachable();
    renderPanel();
    expect(await screen.findByText("Not connected from this computer")).toBeInTheDocument();
    expect(screen.getByText(/bridge-error\.log/)).toBeInTheDocument();
  });

  it("tells staff how to unblock Chrome when it denies this site local access", async () => {
    stubUnreachable({ permission: "denied" });
    renderPanel();
    expect(await screen.findByText("Chrome is blocking the scanner bridge")).toBeInTheDocument();
    expect(screen.getByText(/"Apps on device"/)).toBeInTheDocument();
  });

  it("spots a bridge that's running but set up for another address of the site", async () => {
    stubUnreachable({ answersProbe: true, permission: "granted" });
    renderPanel();
    expect(await screen.findByText("Scanner bridge is set up for a different address")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`GEEGA_API_BASE_URL=${window.location.origin}`))).toBeInTheDocument();
  });

  it("explains a recognizer that can't run on the scanning PC, with a link to the fix", async () => {
    const calls = stubBridge(
      bridgeStatus({
        recognizer: {
          ...bridgeStatus().recognizer,
          state: "unavailable",
          message:
            "Card recognition can't start on this PC: Windows is missing the Microsoft Visual C++ Redistributable it needs (MSVCP140_1.dll not found). Install it (free, from Microsoft), then restart the scanner bridge. Until then, scans still upload and are identified online, as before.",
          help: { label: "Download the Visual C++ Redistributable", url: "https://aka.ms/vs/17/release/vc_redist.x64.exe" },
          library: null,
          selfTest: null,
        },
      }),
    );
    renderPanel();
    expect(await screen.findByText("Needs setup")).toBeInTheDocument();
    expect(screen.getByText(/Windows is missing the Microsoft Visual C\+\+ Redistributable/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Download the Visual C++ Redistributable" });
    expect(link).toHaveAttribute("href", "https://aka.ms/vs/17/release/vc_redist.x64.exe");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("button", { name: "Update card library" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Run self-test" })).toBeNull();
    // Scanning itself is unaffected.
    expect(screen.getByRole("button", { name: "Scan now" })).toBeEnabled();
    expect(calls.some((c) => c.url === `${BRIDGE}/library/update`)).toBe(false);
  });

  it("never links anywhere but https", async () => {
    stubBridge(
      bridgeStatus({
        recognizer: { ...bridgeStatus().recognizer, state: "unavailable", message: "x", help: { label: "Fix it", url: "javascript:alert(1)" } },
      }),
    );
    renderPanel();
    expect(await screen.findByText("Needs setup")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Fix it" })).toBeNull();
  });

  it("offers Try again when the recognizer couldn't start", async () => {
    const calls = stubBridge(
      bridgeStatus({
        recognizer: {
          ...bridgeStatus().recognizer,
          state: "error",
          message: "Card recognizer couldn't start: Couldn't reach huggingface.co to download the card-recognition model (ENOTFOUND).",
          library: null,
          selfTest: null,
        },
      }),
    );
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(calls.some((c) => c.url === `${BRIDGE}/library/update`)).toBe(true));
  });

  it("holds Scan now while the bridge signs in or can't sign in, saying why", async () => {
    const status: Record<string, unknown> = bridgeStatus({ state: "starting" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(status), { status: 200 })),
    );
    const view = renderPanel();
    expect(await screen.findByRole("button", { name: "Scan now" })).toBeDisabled();
    expect(screen.getByText(/signing in/)).toBeInTheDocument();

    status.state = "error";
    status.lastError = "Could not sign in as scanner@example.com: Invalid login credentials.";
    view.unmount();
    renderPanel();
    expect(await screen.findByText(/Could not sign in as scanner@example.com/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan now" })).toBeDisabled();
    expect(screen.getByText(/Scanning is paused until the problem above is fixed/)).toBeInTheDocument();
  });

  it("shows the bridge's version, with no update notice when it's the latest", async () => {
    stubBridge(bridgeStatus());
    renderPanel();
    expect(await screen.findByText(new RegExp(`Bridge version ${LATEST_BRIDGE_VERSION.replace(/\./g, "\\.")}, running since`))).toBeInTheDocument();
    expect(screen.queryByText(/Update the scanner bridge/)).toBeNull();
  });

  it("asks for an update when the bridge is older than the site, or predates version reporting", async () => {
    const old = bridgeStatus();
    delete (old as Record<string, unknown>).version;
    delete (old as Record<string, unknown>).pendingUpdate;
    stubBridge(old);
    const view = renderPanel();
    expect(await screen.findByText("Update the scanner bridge on this PC")).toBeInTheDocument();
    expect(screen.getByText(/running an older version/)).toBeInTheDocument();
    expect(screen.getByText("git pull")).toBeInTheDocument();
    expect(screen.getByText("npm run build")).toBeInTheDocument();
    // Scanning still works meanwhile.
    expect(screen.getByRole("button", { name: "Scan now" })).toBeEnabled();
    view.unmount();

    stubBridge(bridgeStatus({ version: "1.0.0" }));
    renderPanel();
    expect(await screen.findByText(/It.s running version 1\.0\.0; the latest is/)).toBeInTheDocument();
  });

  it("says exactly what's left when an update was pulled but not built, or built but not restarted", async () => {
    stubBridge(bridgeStatus({ version: "1.1.0", pendingUpdate: { version: "9.0.0", step: "build" } }));
    const view = renderPanel();
    expect(await screen.findByText("Finish updating the scanner bridge")).toBeInTheDocument();
    expect(screen.getByText(/files for version 9\.0\.0, but they haven.t been built, so version 1\.1\.0 is still/)).toBeInTheDocument();
    expect(screen.getByText("npm install")).toBeInTheDocument();
    view.unmount();

    stubBridge(bridgeStatus({ version: "1.1.0", pendingUpdate: { version: "9.0.0", step: "restart" } }));
    renderPanel();
    expect(await screen.findByText("Restart the scanner bridge to finish updating")).toBeInTheDocument();
    expect(screen.getByText(/Version 9\.0\.0 is installed, but version 1\.1\.0 is still running/)).toBeInTheDocument();
  });

  it("shows the bridge's own reason when it turns a scan down", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === `${BRIDGE}/status`) return new Response(JSON.stringify(bridgeStatus()), { status: 200 });
      if (url === `${BRIDGE}/scan/start`) {
        return new Response(JSON.stringify({ ok: false, message: "The scanner bridge is still starting up — try again in a few seconds." }), {
          status: 503,
        });
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Scan now" }));
    expect(await screen.findByText(/still starting up — try again in a few seconds/)).toBeInTheDocument();
  });
});
