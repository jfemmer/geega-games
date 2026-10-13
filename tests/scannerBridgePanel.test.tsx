// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import { ScannerBridgePanel } from "../src/admin/pages/scan/ScannerBridgePanel";

// The Scanner panel talks to the bridge on the scanning PC: the Foil switch,
// "Scan now" carrying it, and the on-PC recognizer's library + self-test.

const BRIDGE = "http://127.0.0.1:8787";

function bridgeStatus(overrides: Record<string, unknown> = {}) {
  return {
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
});
