// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import type { CardPrinting, CardRecognitionResult, CardScan, ScanReviewPatch, ScanSession } from "../src/admin/types";

// Scan Review with cards identified on the scanner PC: A / B / C to pick
// between look-alikes, Enter approving with today's Scryfall price (and
// suggestion A, for a card with no match yet), Quick approve for the whole
// batch, The List's copy of a card never standing in for the original, and
// "Re-run" going to the scanner PC first. Then each card's changes saving in
// order, so approving straight after typing a price (or pressing a condition
// key, or picking B) keeps what was typed or picked.

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
const { ADMIN_BASE } = await import("../src/admin/hooks/useRouter");

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
  window.localStorage.clear();
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

  it("Enter on a card with no match yet approves suggestion A in one step, with the default condition", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText("#002"));
    expect(await screen.findByRole("button", { name: "Approve A → next (Enter)" })).toBeInTheDocument();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(repo.updateScan).toHaveBeenCalled());
    expect(repo.getByScryfallId).toHaveBeenCalledWith("m10");
    expect(repo.updateScan).toHaveBeenCalledWith(
      "check-1",
      expect.objectContaining({ selectedScryfallId: "m10", reviewStatus: "ready", confirmedCondition: "NM", selectedFinish: "foil", priceCents: 420 }),
    );
    expect(await screen.findByText("Approved Lightning Bolt (M10 #146) at $4.20, NM.")).toBeInTheDocument();
    // No reload of the whole list for one card.
    expect(repo.listScans).toHaveBeenCalledTimes(1);
  });

  it("approves ungraded cards as the default condition chosen above the list", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(await screen.findByLabelText("Default condition"), "LP");
    await user.click(await screen.findByText("#001"));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(repo.updateScan).toHaveBeenCalledWith("sure-1", { reviewStatus: "ready", confirmedCondition: "LP", priceCents: 420 }));
  });

  it("Quick approve opens the screen for the whole session", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ScanReviewPage sessionId="s1" onNavigate={onNavigate} />
      </ToastProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "Quick approve" }));
    expect(onNavigate).toHaveBeenCalledWith(`${ADMIN_BASE}/scanning/s1/approve`);
  });

  it("offers the original for a card matched to The List's copy of it", async () => {
    const list = printing("plst", { cardName: "Lightning Javelin", setCode: "PLST", setName: "The List", collectorNumber: "ORI-153" });
    const tie = scan("tie-1", 3, {
      selectedScryfallId: "plst",
      selectedPrinting: list,
      recognitionStatus: "recognized",
      reviewStatus: "matched",
      recognitionData: recognition({
        candidatePrintings: [
          { scryfallId: "plst", cardName: "Lightning Javelin", setCode: "PLST", collectorNumber: "ORI-153", confidence: 0.93, reason: "Picture match 87%" },
          { scryfallId: "ori", cardName: "Lightning Javelin", setCode: "ORI", collectorNumber: "153", confidence: 0.78, reason: "Picture match 87%" },
        ],
      }),
    });
    repo.listScans.mockImplementation(async () => ({ rows: [tie], total: 1 }));
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText(/The List copy has a small planeswalker symbol in the bottom-left corner/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use ORI #153 instead" }));
    await waitFor(() => expect(repo.updateScan).toHaveBeenCalledWith("tie-1", expect.objectContaining({ selectedScryfallId: "ori" })));
  });

  it("opens the card Quick approve sent you to", async () => {
    render(
      <ToastProvider>
        <ScanReviewPage sessionId="s1" query={new URLSearchParams("scan=check-1")} onNavigate={vi.fn()} />
      </ToastProvider>,
    );
    expect(await screen.findByText(/Close call — compare with the scan/)).toBeInTheDocument();
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

describe("Scan Review saves each card's changes in order", () => {
  // A stand-in for PATCH /api/admin/scans/:id: each request waits until the
  // test answers it; then the change is applied and the card sent back, with
  // a fresh updated_at, the way the real one does.
  let server: Map<string, CardScan>;
  let waiting: { id: string; patch: ScanReviewPatch; answer: () => void; fail: (message: string) => void }[];

  function serve(cards: CardScan[]) {
    server = new Map(cards.map((c) => [c.id, c]));
    waiting = [];
    let clock = 0;
    repo.listScans.mockImplementation(async () => ({ rows: cards, total: cards.length }));
    repo.updateScan.mockImplementation(
      (id: string, patch: ScanReviewPatch) =>
        new Promise<CardScan>((resolve, reject) => {
          waiting.push({
            id,
            patch,
            answer: () => {
              const fields: ScanReviewPatch = { ...patch };
              delete fields.selectedPrinting;
              const before = server.get(id)!;
              const card: CardScan = {
                ...before,
                ...fields,
                selectedPrinting: patch.selectedScryfallId ? printing(patch.selectedScryfallId) : before.selectedPrinting,
                reviewStatus: patch.reviewStatus ?? (patch.selectedScryfallId ? "matched" : before.reviewStatus),
                updatedAt: new Date(Date.UTC(2026, 9, 22, 20, 0, ++clock)).toISOString(),
              };
              server.set(id, card);
              resolve(card);
            },
            fail: (message) => reject(new Error(message)),
          });
        }),
    );
  }

  /** Answers the oldest request once it's been sent (or fails it, with a reason). */
  async function answerNext(fail?: string) {
    await waitFor(() => expect(waiting.length).toBeGreaterThan(0));
    const request = waiting.shift()!;
    await act(async () => {
      if (fail) request.fail(fail);
      else request.answer();
    });
    return request;
  }

  const matched = (id: string, seq: number, overrides: Partial<CardScan> = {}) =>
    scan(id, seq, {
      selectedScryfallId: "m10",
      selectedPrinting: printing("m10"),
      recognitionStatus: "recognized",
      reviewStatus: "matched",
      selectedFinish: "foil",
      ...overrides,
    });

  it("keeps a price typed just before clicking Approve, instead of today's Scryfall price", async () => {
    serve([matched("m-1", 1), matched("m-2", 2)]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText("#001"));
    await user.type(screen.getByLabelText("Price (USD)"), "12.50");
    await user.click(screen.getByRole("button", { name: "Approve → next (Enter)" }));

    // Leaving the field sent the price; approving waits for it to save.
    await waitFor(() => expect(waiting.map((w) => w.patch)).toEqual([{ priceCents: 1250 }]));
    await answerNext();
    expect((await answerNext()).patch).toEqual({ reviewStatus: "ready", confirmedCondition: "NM" });
    expect(server.get("m-1")).toMatchObject({ priceCents: 1250, reviewStatus: "ready", confirmedCondition: "NM" });
    expect(repo.getByScryfallId).not.toHaveBeenCalled();
    expect(screen.queryByText(/\(Scryfall price\)/)).toBeNull();

    // On to the next card; going back, the price is still the one typed.
    expect(await screen.findByText("My scan · #002")).toBeInTheDocument();
    await user.click(screen.getByText("#001"));
    expect(screen.getByLabelText("Price (USD)")).toHaveValue(12.5);
  });

  it("approves a card as the condition key pressed just before Enter", async () => {
    serve([matched("m-1", 1, { priceCents: 300 }), matched("m-2", 2)]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText("#001"));
    await user.keyboard("3{Enter}");
    await waitFor(() => expect(waiting.map((w) => w.patch)).toEqual([{ confirmedCondition: "MP" }]));
    await answerNext();
    expect((await answerNext()).patch).toEqual({ reviewStatus: "ready" });
    expect(server.get("m-1")).toMatchObject({ confirmedCondition: "MP", priceCents: 300, reviewStatus: "ready" });
  });

  it("keeps a typed price when approving suggestion A", async () => {
    serve([scan("c-1", 1)]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText("#001"));
    await user.type(screen.getByLabelText("Price (USD)"), "7");
    await user.click(screen.getByRole("button", { name: "Approve A → next (Enter)" }));
    expect((await answerNext()).patch).toEqual({ priceCents: 700 });
    const approve = await answerNext();
    expect(approve.patch).toMatchObject({ selectedScryfallId: "m10", reviewStatus: "ready", confirmedCondition: "NM", selectedFinish: "foil" });
    expect(approve.patch).not.toHaveProperty("priceCents");
    expect(server.get("c-1")).toMatchObject({ selectedScryfallId: "m10", priceCents: 700, reviewStatus: "ready" });
    expect(await screen.findByText("Approved Lightning Bolt (M10 #146) at $7.00, NM.")).toBeInTheDocument();
  });

  it("approves the printing picked just before Enter, not suggestion A", async () => {
    serve([scan("c-1", 1), scan("c-2", 2)]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText("#001"));
    await user.keyboard("b{Enter}");
    expect((await answerNext()).patch).toMatchObject({ selectedScryfallId: "m11", selectedFinish: "foil", priceCents: 420 });
    expect((await answerNext()).patch).toEqual({ reviewStatus: "ready", confirmedCondition: "NM" });
    expect(server.get("c-1")).toMatchObject({ selectedScryfallId: "m11", priceCents: 420, reviewStatus: "ready" });
    expect(repo.getByScryfallId).not.toHaveBeenCalledWith("m10");
  });

  it("says when a typed price didn't save, puts the saved one back, and doesn't approve the card", async () => {
    serve([matched("m-1", 1, { priceCents: 300 }), matched("m-2", 2)]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText("#001"));
    const price = screen.getByLabelText("Price (USD)");
    await user.clear(price);
    await user.type(price, "12.50");
    await user.click(screen.getByRole("button", { name: "Approve → next (Enter)" }));
    await answerNext("Failed to fetch");

    expect(await screen.findByText("Your change to #001 didn't save: Failed to fetch")).toBeInTheDocument();
    expect(
      await screen.findByText("#001 wasn't approved because a change to it didn't save. Check the card and approve it again."),
    ).toBeInTheDocument();
    expect(price).toHaveValue(3);
    expect(waiting).toHaveLength(0);
    expect(server.get("m-1")).toMatchObject({ priceCents: 300, reviewStatus: "matched" });
    expect(screen.getByText("My scan · #001")).toBeInTheDocument();

    // Approving again works from what's saved.
    await user.click(screen.getByRole("button", { name: "Approve → next (Enter)" }));
    expect((await answerNext()).patch).toEqual({ reviewStatus: "ready", confirmedCondition: "NM" });
  });

  it("stays on the card you moved to while an approve was saving", async () => {
    serve([matched("m-1", 1, { priceCents: 300 }), matched("m-2", 2), matched("m-3", 3)]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText("#001"));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(waiting).toHaveLength(1));
    await user.click(screen.getByText("#003"));
    await answerNext();
    expect(server.get("m-1")).toMatchObject({ reviewStatus: "ready" });
    expect(screen.getByText("My scan · #003")).toBeInTheDocument();
  });
});
