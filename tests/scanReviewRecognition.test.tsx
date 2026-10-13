// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import type { CardPrinting, CardRecognitionResult, CardScan, ScanSession } from "../src/admin/types";

// Scan Review with cards identified on the scanner PC: A / B / C to pick
// between look-alikes, Enter approving with today's Scryfall price,
// "Approve sure matches" for the whole batch, and "Re-run" going to the
// scanner PC first.

const repo = {
  getSession: vi.fn(),
  filterCounts: vi.fn(),
  listScans: vi.fn(),
  updateScan: vi.fn(),
  getByScryfallId: vi.fn(),
  recognize: vi.fn(),
};

vi.mock("../src/admin/repositories", () => ({
  scanRepository: {
    getSession: (...a: unknown[]) => repo.getSession(...a),
    filterCounts: (...a: unknown[]) => repo.filterCounts(...a),
    listScans: (...a: unknown[]) => repo.listScans(...a),
    updateScan: (...a: unknown[]) => repo.updateScan(...a),
    previewCommit: vi.fn(),
    commitReady: vi.fn(),
    bulkUpdate: vi.fn(),
    deleteScan: vi.fn(),
  },
  scryfallRepository: { getByScryfallId: (id: string) => repo.getByScryfallId(id) },
  inventoryRepository: { getPriceFloors: async () => [{ rarity: "common", minPriceCents: 25, updatedAt: "", updatedBy: null }] },
  recognitionProvider: { recognize: (...a: unknown[]) => repo.recognize(...a) },
}));
vi.mock("../src/admin/hooks/useCurrentAdmin", () => ({ useCurrentAdmin: () => ({ name: "Test Staff", email: null, userId: null }) }));

const { ScanReviewPage } = await import("../src/admin/pages/scan/ScanReviewPage");

function printing(id: string, overrides: Partial<CardPrinting> = {}): CardPrinting {
  return {
    id,
    cardName: "Lightning Bolt",
    setName: "Magic 2010",
    setCode: "M10",
    collectorNumber: "146",
    rarity: "common",
    cardType: "Instant",
    imageUrl: null,
    availableFinishes: ["nonfoil", "foil"],
    scryfallPriceCents: 150,
    scryfallId: id,
    oracleId: "o",
    images: { small: null, normal: `https://img/${id}.jpg`, large: null, png: null, artCrop: null },
    faces: [],
    layout: "normal",
    artist: null,
    releasedAt: null,
    language: "en",
    frame: null,
    frameEffects: [],
    borderColor: null,
    fullArt: false,
    textless: false,
    promo: false,
    promoTypes: [],
    treatments: [],
    prices: { usd: 150, usdFoil: 400, usdEtched: null },
    ...overrides,
  } as CardPrinting;
}

function recognition(overrides: Partial<CardRecognitionResult> = {}): CardRecognitionResult {
  return {
    detectedName: "Lightning Bolt",
    detectedSetCode: "M10",
    detectedCollectorNumber: "146",
    detectedLanguage: "en",
    finishGuess: "foil",
    candidatePrintings: [
      { scryfallId: "m10", cardName: "Lightning Bolt", setCode: "M10", collectorNumber: "146", confidence: 0.88, reason: "Picture match 96%", imageUrl: "https://img/m10.jpg" },
      { scryfallId: "m11", cardName: "Lightning Bolt", setCode: "M11", collectorNumber: "149", confidence: 0.87, reason: "Picture match 96%", imageUrl: "https://img/m11.jpg" },
    ],
    confidence: 0.88,
    fieldConfidence: {},
    warnings: [],
    decisionReason: "Close call: Lightning Bolt (M10 #146) looks the same as M11 #149.",
    visualSimilarity: 0.96,
    engine: "scanner_pc",
    scannerPc: { version: "1.0.0", decision: "check", orientation: 0, sidesSwapped: false, ocrText: null, timingsMs: {}, library: { builtAt: null, entries: 1, model: "m" } },
    ...overrides,
  };
}

function scan(id: string, seq: number, overrides: Partial<CardScan> = {}): CardScan {
  return {
    id,
    scanSessionId: "s1",
    sequenceNumber: seq,
    frontImagePath: "x",
    backImagePath: "y",
    frontImageUrl: "https://scan/front.jpg",
    backImageUrl: null,
    frontPreviewUrl: null,
    backPreviewUrl: null,
    selectedScryfallId: null,
    selectedPrinting: null,
    recognitionStatus: "low_confidence",
    recognitionConfidence: 0.88,
    recognitionData: recognition(),
    suggestedCondition: null,
    suggestedConditionConfidence: null,
    conditionFindings: null,
    confirmedCondition: null,
    selectedFinish: null,
    quantity: 1,
    priceCents: null,
    costCents: null,
    storageLocation: null,
    notes: null,
    reviewStatus: "needs_manual_match",
    reviewedBy: null,
    reviewedAt: null,
    inventoryItemId: null,
    createdAt: "2026-10-12T00:00:00Z",
    updatedAt: "2026-10-12T00:00:00Z",
    ...overrides,
  };
}

const session: ScanSession = {
  id: "s1",
  label: "Scan Session #1",
  createdBy: "x",
  scannerName: "Ricoh fi-8170",
  sourceType: "scanner_bridge",
  scanMode: "both",
  status: "pending_review",
  totalFiles: 4,
  totalCards: 2,
  reviewedCards: 0,
  matchedCards: 1,
  readyCards: 0,
  addedCards: 0,
  rejectedCards: 0,
  failedCards: 0,
  note: null,
  createdAt: "2026-10-12T00:00:00Z",
  updatedAt: "2026-10-12T00:00:00Z",
  completedAt: null,
} as ScanSession;

const sure = scan("sure-1", 1, {
  selectedScryfallId: "m10",
  selectedPrinting: printing("m10"),
  recognitionStatus: "recognized",
  recognitionConfidence: 0.96,
  reviewStatus: "matched",
  selectedFinish: "foil",
  recognitionData: recognition({ scannerPc: { ...recognition().scannerPc!, decision: "sure" } }),
});
const closeCall = scan("check-1", 2);

function renderPage() {
  return render(
    <ToastProvider>
      <ScanReviewPage sessionId="s1" onNavigate={vi.fn()} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  // jsdom has no layout; the queue scrolls the next card into view.
  Element.prototype.scrollIntoView = vi.fn();
  repo.getSession.mockResolvedValue(session);
  repo.filterCounts.mockResolvedValue({ all: 2, matched: 1, needs_manual_match: 1 });
  repo.listScans.mockImplementation(async (_s: string, q: { filter?: string }) => ({
    rows: q.filter === "matched" ? [sure] : [sure, closeCall],
    total: 2,
  }));
  repo.updateScan.mockImplementation(async (id: string) => ({ id }));
  repo.getByScryfallId.mockImplementation(async (id: string) => printing(id, { prices: { usd: 160, usdFoil: 420, usdEtched: null }, scryfallPriceCents: 160 }));
  repo.recognize.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Scan Review with scanner-PC results", () => {
  it("shows look-alikes as pictures and picks one with the letter keys, keeping the batch's foil setting", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText("#002"));
    expect(await screen.findByText(/Close call — compare with the scan/)).toBeInTheDocument();
    expect(screen.getByAltText("Lightning Bolt (M11 #149)")).toHaveAttribute("src", "https://img/m11.jpg");
    expect(screen.getByText("Identified on the scanner PC")).toBeInTheDocument();

    await user.keyboard("b");
    await waitFor(() => expect(repo.updateScan).toHaveBeenCalled());
    expect(repo.getByScryfallId).toHaveBeenCalledWith("m11");
    expect(repo.updateScan).toHaveBeenCalledWith("check-1", expect.objectContaining({ selectedScryfallId: "m11", selectedFinish: "foil", priceCents: 420 }));
  });

  it("Enter approves with today's Scryfall price when none was typed", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText("#001"));
    await user.keyboard("1");
    await waitFor(() => expect(repo.updateScan).toHaveBeenCalledWith("sure-1", { confirmedCondition: "NM" }));
    // The reload hands back the graded card.
    sure.confirmedCondition = "NM";
    repo.listScans.mockImplementation(async (_s: string, q: { filter?: string }) => ({ rows: q.filter === "matched" ? [sure] : [sure, closeCall], total: 2 }));
    await user.click(await screen.findByText("#002"));
    await user.click(await screen.findByText("#001"));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(repo.updateScan).toHaveBeenCalledWith("sure-1", { reviewStatus: "ready", priceCents: 420 }));
    expect(await screen.findByText("Approved at $4.20 (Scryfall price).")).toBeInTheDocument();
    sure.confirmedCondition = null;
  });

  it("'Approve sure matches' approves every sure card in one go, with the condition chosen for ungraded ones", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Approve sure matches" }));
    const dialog = await screen.findByRole("dialog", { name: "Approve sure matches" });
    expect(await within(dialog).findByText(/sure match will be marked ready/)).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText(/Condition for the 1 card not graded yet/), "LP");
    await user.click(within(dialog).getByRole("button", { name: "Approve 1" }));
    await waitFor(() =>
      expect(repo.updateScan).toHaveBeenCalledWith("sure-1", { reviewStatus: "ready", confirmedCondition: "LP", priceCents: 420 }),
    );
    expect(await screen.findByText("1 card approved. 1 close call to pick from next.")).toBeInTheDocument();
    // The close calls are what's left, so they're shown next.
    expect(screen.getByRole("tab", { name: /Needs match/ })).toHaveAttribute("aria-selected", "true");
  });

  it("'Approve sure matches' covers a session bigger than one page", async () => {
    const second = { ...sure, id: "sure-2", sequenceNumber: 600 };
    repo.listScans.mockImplementation(async (_s: string, q: { filter?: string; page?: number }) =>
      q.filter === "matched"
        ? { rows: (q.page ?? 1) === 1 ? [sure] : (q.page ?? 1) === 2 ? [second, sure] : [], total: 501 }
        : { rows: [sure, closeCall], total: 2 },
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Approve sure matches" }));
    const dialog = await screen.findByRole("dialog", { name: "Approve sure matches" });
    // Two different cards across the pages (the repeated one counted once).
    expect(await within(dialog).findByRole("button", { name: "Approve 2" })).toBeInTheDocument();
    expect(repo.listScans).toHaveBeenCalledWith("s1", expect.objectContaining({ filter: "matched", page: 2 }));
  });

  it("re-runs on the scanner PC when it's reachable", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, message: "Re-recognized on the scanner PC." }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText("#002"));
    await user.click(await screen.findByRole("button", { name: "Re-run" }));
    expect(await screen.findByText("Re-recognized on the scanner PC.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/recognize", expect.objectContaining({ method: "POST", body: JSON.stringify({ scanId: "check-1" }) }));
    expect(repo.recognize).not.toHaveBeenCalled();
  });

  it("won't replace a scanner-PC result with the cloud reader when the PC isn't reachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText("#002"));
    await user.click(await screen.findByRole("button", { name: "Re-run" }));
    expect(await screen.findByText(/re-run it from that computer/)).toBeInTheDocument();
    expect(repo.recognize).not.toHaveBeenCalled();
  });

  it("says so when the scanner PC answers but its recognizer isn't ready, without falling back to the cloud", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: false, message: "The card recognizer on this PC isn't ready yet." }), { status: 503 })),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText("#002"));
    await user.click(await screen.findByRole("button", { name: "Re-run" }));
    expect(await screen.findByText(/card recognizer isn't ready right now/)).toBeInTheDocument();
    expect(repo.recognize).not.toHaveBeenCalled();
  });

  it("falls back to the cloud reader for cards it read in the first place", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    closeCall.recognitionData = recognition({ engine: "cloud", scannerPc: undefined });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText("#002"));
    await user.click(await screen.findByRole("button", { name: "Re-run" }));
    await waitFor(() => expect(repo.recognize).toHaveBeenCalledTimes(1));
    closeCall.recognitionData = recognition();
  });
});
