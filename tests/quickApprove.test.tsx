// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import type { CardPrinting, CardRecognitionResult, CardScan, QuickApproveRequest, RecognitionCandidate, ScanSession } from "../src/admin/types";

// Quick approve: every card of a session on one screen as scan-vs-match
// tiles, the confident ones pre-ticked, the condition chosen once, and one
// click to approve and add them all to inventory.

const repo = {
  getSession: vi.fn(),
  listScans: vi.fn(),
  quickApprove: vi.fn(),
};

vi.mock("../src/admin/repositories", () => ({
  scanRepository: {
    getSession: (...a: unknown[]) => repo.getSession(...a),
    listScans: (...a: unknown[]) => repo.listScans(...a),
    quickApprove: (...a: unknown[]) => repo.quickApprove(...a),
  },
  inventoryRepository: { getPriceFloors: async () => [{ rarity: "common", minPriceCents: 25, updatedAt: "", updatedBy: null }] },
}));
vi.mock("../src/admin/hooks/useCurrentAdmin", () => ({ useCurrentAdmin: () => ({ name: "Test Staff", email: null, userId: null }) }));

const { QuickApprovePage } = await import("../src/admin/pages/scan/QuickApprovePage");
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

const candidate = (scryfallId: string, cardName: string, setCode: string, collectorNumber: string, confidence: number): RecognitionCandidate => ({
  scryfallId,
  cardName,
  setCode,
  collectorNumber,
  confidence,
  reason: `Picture match ${Math.round(confidence * 100)}%`,
  imageUrl: `https://img/${scryfallId}.jpg`,
});

function recognition(decision: "sure" | "check", candidates: RecognitionCandidate[], extra: Partial<CardRecognitionResult> = {}): CardRecognitionResult {
  return {
    detectedName: null,
    detectedSetCode: null,
    detectedCollectorNumber: null,
    detectedLanguage: null,
    finishGuess: "nonfoil",
    candidatePrintings: candidates,
    confidence: 0.9,
    fieldConfidence: {},
    warnings: [],
    decisionReason: "x",
    engine: "scanner_pc",
    scannerPc: { version: "1.1.0", decision, orientation: 0, sidesSwapped: false, ocrText: null, timingsMs: {}, library: { builtAt: null, entries: 1, model: "m" } },
    ...extra,
  };
}

function scan(id: string, seq: number, overrides: Partial<CardScan> = {}): CardScan {
  return {
    id,
    scanSessionId: "s1",
    sequenceNumber: seq,
    frontImagePath: "x",
    backImagePath: "y",
    frontImageUrl: `https://scan/${id}.jpg`,
    backImageUrl: null,
    frontPreviewUrl: null,
    backPreviewUrl: null,
    selectedScryfallId: null,
    selectedPrinting: null,
    recognitionStatus: "low_confidence",
    recognitionConfidence: 0.9,
    recognitionData: null,
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
    createdAt: "2026-10-14T00:00:00Z",
    updatedAt: "2026-10-14T00:00:00Z",
    ...overrides,
  };
}

const session = { id: "s1", label: "Scan Session #4", totalCards: 7 } as ScanSession;

const sure = scan("sure", 1, {
  selectedScryfallId: "m10",
  selectedPrinting: printing("m10"),
  recognitionStatus: "recognized",
  reviewStatus: "matched",
  recognitionData: recognition("sure", [candidate("m10", "Lightning Bolt", "M10", "146", 0.96)]),
});
const confirm = scan("confirm", 2, {
  recognitionData: recognition("sure", [candidate("gear", "Ghirapur Gearcrafter", "ORI", "149", 0.94), candidate("gear-ddu", "Ghirapur Gearcrafter", "DDU", "46", 0.79)]),
});
const listTie = scan("tie", 3, {
  selectedScryfallId: "plst",
  selectedPrinting: printing("plst", { cardName: "Lightning Javelin", setCode: "PLST", setName: "The List", collectorNumber: "ORI-153" }),
  recognitionStatus: "recognized",
  reviewStatus: "matched",
  recognitionData: recognition("sure", [candidate("plst", "Lightning Javelin", "PLST", "ORI-153", 0.93), candidate("ori", "Lightning Javelin", "ORI", "153", 0.78)]),
});
const closeCall = scan("close", 4, {
  recognitionData: recognition("check", [candidate("bolt-a", "Lightning Bolt", "M10", "146", 0.88), candidate("bolt-b", "Lightning Bolt", "M11", "149", 0.87)], {
    decisionReason: "Close call: Lightning Bolt (M10 #146) looks the same as M11 #149.",
  }),
});
const noMatch = scan("nomatch", 5, { recognitionData: recognition("check", []) });
const added = scan("added", 6, { reviewStatus: "added", inventoryItemId: "inv-1", selectedScryfallId: "m10", selectedPrinting: printing("m10") });
const rejected = scan("rejected", 7, { reviewStatus: "rejected" });

let rows: CardScan[];
const onNavigate = vi.fn();

function renderPage() {
  return render(
    <ToastProvider>
      <QuickApprovePage sessionId="s1" onNavigate={onNavigate} />
    </ToastProvider>,
  );
}

const tile = (seq: string) => screen.getByText(seq).closest("article") as HTMLElement;
const tickbox = (seq: string) => within(tile(seq)).getByRole("checkbox");

beforeEach(() => {
  window.localStorage.clear();
  rows = [sure, confirm, listTie, closeCall, noMatch, added, rejected];
  repo.getSession.mockResolvedValue(session);
  repo.listScans.mockImplementation(async () => ({ rows, total: rows.length }));
  repo.quickApprove.mockImplementation(async (_s: string, request: QuickApproveRequest) => ({
    approvedCount: request.items.length,
    addedCount: request.addToInventory ? request.items.length : 0,
    createdCount: request.addToInventory ? request.items.length : 0,
    incrementedCount: 0,
    failures: [],
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Quick approve", () => {
  it("shows each card as your scan next to its match, the confident ones ticked", async () => {
    renderPage();
    expect(await screen.findByText("#001")).toBeInTheDocument();
    expect(screen.getByText("Scan Session #4 · 4 cards to approve")).toBeInTheDocument();
    expect(tickbox("#001")).toBeChecked();
    expect(tickbox("#002")).toBeChecked();
    expect(tickbox("#004")).not.toBeChecked();
    expect(within(tile("#001")).getByAltText("Your scan #001")).toHaveAttribute("src", "https://scan/sure.jpg");
    expect(within(tile("#001")).getByText("Nonfoil · $1.50")).toBeInTheDocument();

    // The List's copy: the original is proposed, ticked, with what to look for.
    const tie = tile("#003");
    expect(within(tie).getByText("Original or The List?")).toBeInTheDocument();
    expect(within(tie).getByText("ORI · #153")).toBeInTheDocument();
    expect(within(tie).getByText(/planeswalker symbol in the bottom-left corner/)).toBeInTheDocument();
    expect(tickbox("#003")).toBeChecked();

    // Added and rejected cards aren't here; a card with nothing to propose goes to review.
    expect(screen.queryByText("#006")).toBeNull();
    expect(screen.queryByText("#007")).toBeNull();
    expect(screen.getByText("1 card need a manual match")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add 3 to inventory" })).toBeEnabled();
  });

  it("adds every ticked card in one go, with the condition and location chosen once", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("#001");
    await user.selectOptions(screen.getByLabelText("Condition (if not graded)"), "LP");
    await user.type(screen.getByLabelText("Storage location"), "Box 3");
    await user.click(screen.getByRole("button", { name: "Add 3 to inventory" }));
    const dialog = await screen.findByRole("dialog", { name: "Add 3 cards to inventory?" });
    expect(within(dialog).getByText(/Cards not graded yet go in as Lightly Played, stored in "Box 3"/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Add 3 cards" }));
    await waitFor(() => expect(repo.quickApprove).toHaveBeenCalledTimes(1));
    expect(repo.quickApprove).toHaveBeenCalledWith(
      "s1",
      {
        items: [
          { scanId: "sure", scryfallId: "m10", priceCents: null },
          { scanId: "confirm", scryfallId: "gear", priceCents: null },
          { scanId: "tie", scryfallId: "ori", priceCents: null },
        ],
        condition: "LP",
        storageLocation: "Box 3",
        addToInventory: true,
      },
      "Test Staff",
    );
    expect(await screen.findByText("3 cards added to inventory.")).toBeInTheDocument();
    expect(repo.listScans.mock.calls.length).toBeGreaterThan(1);
    // Remembered for next time.
    expect(window.localStorage.getItem("gg-scan-default-condition")).toBe("LP");
  });

  it("sends big sessions in batches", async () => {
    rows = Array.from({ length: 30 }, (_, i) => ({ ...sure, id: `sure-${i}`, sequenceNumber: i + 1 }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Add 30 to inventory" }));
    await user.click(await screen.findByRole("button", { name: "Add 30 cards" }));
    await waitFor(() => expect(repo.quickApprove).toHaveBeenCalledTimes(2));
    expect((repo.quickApprove.mock.calls[0][1] as QuickApproveRequest).items).toHaveLength(25);
    expect((repo.quickApprove.mock.calls[1][1] as QuickApproveRequest).items).toHaveLength(5);
    expect(await screen.findByText("30 cards added to inventory.")).toBeInTheDocument();
  });

  it("ticks a close call by switching it to the right printing", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("#004");
    await user.click(within(tile("#004")).getByRole("button", { name: "Compare / other printings" }));
    const dialog = await screen.findByRole("dialog", { name: "#004 · Lightning Bolt" });
    await user.click(within(dialog).getByRole("button", { name: /M11 · #149/ }));
    expect(tickbox("#004")).toBeChecked();
    expect(within(tile("#004")).getByText("M11 · #149")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark ready only" }));
    await user.click(await screen.findByRole("button", { name: "Mark 4 ready" }));
    await waitFor(() => expect(repo.quickApprove).toHaveBeenCalled());
    const request = repo.quickApprove.mock.calls[0][1] as QuickApproveRequest;
    expect(request.addToInventory).toBe(false);
    expect(request.items).toContainEqual({ scanId: "close", scryfallId: "bolt-b", priceCents: null });
    expect(await screen.findByText("4 cards marked ready.")).toBeInTheDocument();
    expect(screen.getByText(/Marked 4 cards ready\. They stay listed here/)).toBeInTheDocument();
  });

  it("shows the price typed in review for a card that had no match yet", async () => {
    rows = [closeCall, { ...confirm, priceCents: 700 }];
    renderPage();
    await screen.findByText("#002");
    expect(within(tile("#002")).getByText("Non-foil · $7.00")).toBeInTheDocument();
    expect(within(tile("#004")).getByText("Non-foil · today's price")).toBeInTheDocument();
  });

  it("marks cards that couldn't be added, with a price box when Scryfall has no price", async () => {
    repo.quickApprove.mockImplementationOnce(async () => {
      // The two that went through are in inventory now; what's left is the one that didn't.
      rows = [confirm, closeCall];
      return {
        approvedCount: 2,
        addedCount: 2,
        createdCount: 1,
        incrementedCount: 1,
        failures: [{ scanId: "confirm", sequenceNumber: 2, reason: "No Scryfall price for this printing — enter a selling price before approving." }],
      };
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Add 3 to inventory" }));
    await user.click(await screen.findByRole("button", { name: "Add 3 cards" }));
    expect(await screen.findByText("2 added to inventory — 1 need a look (marked below).")).toBeInTheDocument();
    expect(screen.getByText(/Added 2 cards to inventory \(1 new, 1 more of ones you had\)/)).toBeInTheDocument();

    // The page reloads with what's left, the card that failed marked.
    const box = await within(tile("#002")).findByLabelText("Selling price (USD)");
    expect(within(tile("#002")).getByRole("alert")).toHaveTextContent(/No Scryfall price/);
    await user.type(box, "2.50");
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Add 1 to inventory" }));
    await user.click(await screen.findByRole("button", { name: "Add 1 cards" }));
    await waitFor(() => expect(repo.quickApprove).toHaveBeenCalledTimes(2));
    expect((repo.quickApprove.mock.calls[1][1] as QuickApproveRequest).items).toEqual([{ scanId: "confirm", scryfallId: "gear", priceCents: 250 }]);
  });

  it("stops when the server can't be reached, saying so", async () => {
    repo.quickApprove.mockRejectedValueOnce(new Error("Failed to fetch"));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Add 3 to inventory" }));
    await user.click(await screen.findByRole("button", { name: "Add 3 cards" }));
    expect(await screen.findByText("Stopped after 0 cards: Failed to fetch")).toBeInTheDocument();
  });

  it("sends a card with no suggestion to review", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /#005/ }));
    expect(onNavigate).toHaveBeenCalledWith(`${ADMIN_BASE}/scanning/s1?scan=nomatch`);
  });
});
