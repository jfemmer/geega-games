// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import { NAV_ITEMS, SECTION_TITLES } from "../src/admin/components/layout/nav";
import { adminSection } from "../src/admin/hooks/useRouter";
import type { CardPrinting, InventoryItem } from "../src/admin/types";
import type { StaffTradeView } from "../src/store/lib/trades";

// Admin → Trade Evaluator: the customer's cards typed at TCG low, the cards
// they want picked from inventory at the regular website price (never a deal
// price), the trade credit percentage, and what they pay or the credit they
// have left. Confirming needs their name, saves the trade, and gives it a link
// to text or email them. Kept on the device until it's cleared.

const inventory = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn() }));
const scryfall = vi.hoisted(() => ({ searchPrintingsPage: vi.fn(), resolveExact: vi.fn() }));
vi.mock("../src/admin/repositories", () => ({ inventoryRepository: inventory, scryfallRepository: scryfall }));
const trades = vi.hoisted(() => ({ recent: vi.fn(), confirm: vi.fn(), email: vi.fn(), texted: vi.fn() }));
vi.mock("../src/admin/repositories/trades.supabase", () => ({ tradeRepository: trades }));
// The online trade terms (admin Trades, Settings): not set up unless a test says so.
const tradeCenter = vi.hoisted(() => ({ settings: vi.fn() }));
vi.mock("../src/admin/repositories/tradeCenter.supabase", () => ({ tradeCenterRepository: tradeCenter }));

const { TradeEvaluatorPage } = await import("../src/admin/pages/TradeEvaluatorPage");

const NOW = "2026-10-24T17:00:00.000Z";
const SIGNET_ID = "11111111-1111-4111-8111-111111111111";
const SOL_ID = "22222222-2222-4222-8222-222222222222";
const TRADE_ID = "33333333-3333-4333-8333-333333333333";
const LINK = `https://geega-games.com/trade?t=${"a".repeat(32)}`;

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: SIGNET_ID,
    scryfallId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    cardName: "Arcane Signet",
    setName: "Commander Legends",
    setCode: "cmr",
    collectorNumber: "297",
    rarity: "common",
    cardType: "Artifact",
    imageUrl: "https://cards.scryfall.io/small/front/a/a/signet.jpg",
    condition: "NM",
    finish: "nonfoil",
    variantType: null,
    quantity: 3,
    priceCents: 1000,
    costCents: null,
    storageLocation: null,
    sku: null,
    notes: null,
    status: "active",
    scryfallPriceCents: null,
    isDeal: false,
    originalPriceCents: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const signet = item();
// On the website's deals for $8.00; its regular price is $10.00.
const solRing = item({
  id: SOL_ID,
  cardName: "Sol Ring",
  collectorNumber: "263",
  imageUrl: "https://cards.scryfall.io/small/front/s/o/sol.jpg",
  quantity: 1,
  priceCents: 800,
  isDeal: true,
  dealSource: "aged_inventory",
  originalPriceCents: 1000,
});

// One of the customer's cards, as the card search (the one Add Inventory uses) finds it.
const SOL_PRINTING_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const solRingPrinting = {
  id: SOL_PRINTING_ID,
  cardName: "Sol Ring",
  setName: "Commander Legends",
  setCode: "cmr",
  collectorNumber: "263",
  rarity: "uncommon",
  cardType: "Artifact",
  imageUrl: "https://cards.scryfall.io/normal/front/s/o/sol.jpg",
  availableFinishes: ["nonfoil", "foil"],
  scryfallPriceCents: 150,
  scryfallId: SOL_PRINTING_ID,
  oracleId: "o",
  images: {
    small: "https://cards.scryfall.io/small/front/s/o/sol.jpg",
    normal: "https://cards.scryfall.io/normal/front/s/o/sol.jpg",
    large: null,
    png: null,
    artCrop: null,
  },
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
} as CardPrinting;

function staffTrade(overrides: Partial<StaffTradeView> = {}): StaffTradeView {
  return {
    id: TRADE_ID,
    tradeNumber: 1001,
    createdAt: NOW,
    customerName: "Sam Rivera",
    creditPercent: 70,
    theirCards: [{ name: "Rhystic Study", quantity: 1, tcgLowCents: 4000 }],
    yourCards: [],
    theirTcgLowCents: 4000,
    creditCents: 2800,
    yourCardsCents: 3000,
    balanceCents: -200,
    link: LINK,
    customerPhone: "314-555-0100",
    customerEmail: null,
    confirmedByEmail: "staff@example.com",
    emailedTo: null,
    emailedAt: null,
    textedTo: null,
    textedAt: null,
    ...overrides,
  };
}

/** A card of yours as the page keeps it on this device. */
function savedLine(from: InventoryItem, quantity: number, priceCents: number) {
  return {
    id: from.id,
    cardName: from.cardName,
    setName: from.setName,
    setCode: from.setCode,
    collectorNumber: from.collectorNumber,
    scryfallId: from.scryfallId,
    imageUrl: from.imageUrl,
    condition: from.condition,
    finish: from.finish,
    variantType: null,
    priceCents,
    dealPriceCents: null,
    stock: 3,
    quantity,
    unavailable: null,
  };
}

const renderPage = () => render(<ToastProvider>{<TradeEvaluatorPage />}</ToastProvider>);
const theirs = () => screen.getByRole("region", { name: "They're trading in" });
const yours = () => screen.getByRole("region", { name: "They want from you" });
const recentTrades = () => screen.getByRole("region", { name: "Recent trades" });
const summary = (name = "The trade") => screen.getByRole("region", { name });
const result = () => within(summary()).getByRole("status");
const total = (label: string, name?: string) => within(summary(name)).getByText(label).nextElementSibling;
const theirPrice = (line: number) => screen.getByLabelText(`TCG low price, line ${line} of their cards`);
const nameField = () => screen.getByLabelText(/^Customer name/);

/** Searches inventory and taps the card, `times` times. */
async function addFromInventory(user: ReturnType<typeof userEvent.setup>, search: string, card: InventoryItem, times = 1) {
  inventory.list.mockResolvedValue({ rows: [card], total: 1 });
  const box = within(yours()).getByLabelText("Find a card in your inventory");
  await user.clear(box);
  await user.type(box, search);
  const hit = await within(yours()).findByRole("button", { name: new RegExp(`${card.cardName}.*in stock`) });
  for (let i = 0; i < times; i++) await user.click(hit);
}

/** Their Rhystic Study at $40, your Sol Ring and two Arcane Signets: $28.00 credit against $30.00. */
async function buildTrade(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Card, line 1 of their cards"), "Rhystic Study");
  await user.type(theirPrice(1), "40");
  await addFromInventory(user, "sol", solRing);
  await addFromInventory(user, "arcane", signet, 2);
}

beforeEach(() => {
  window.localStorage.clear();
  for (const fn of [...Object.values(inventory), ...Object.values(trades), ...Object.values(scryfall)]) fn.mockReset();
  scryfall.resolveExact.mockResolvedValue(null);
  scryfall.searchPrintingsPage.mockResolvedValue({ printings: [solRingPrinting], hasMore: false, totalCards: 1 });
  inventory.list.mockResolvedValue({ rows: [], total: 0 });
  inventory.get.mockImplementation(async (id: string) => [signet, solRing].find((i) => i.id === id) ?? null);
  trades.recent.mockResolvedValue([]);
  tradeCenter.settings.mockReset();
  tradeCenter.settings.mockRejectedValue(new Error("Trade settings aren't set up yet."));
});

afterEach(() => {
  cleanup();
});

describe("Trade Evaluator", () => {
  it("prices their cards at TCG low and yours at the regular website price, never a deal price", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(within(result()).getByText("Add cards to see the trade.")).toBeInTheDocument();
    await buildTrade(user);

    expect(inventory.list).toHaveBeenLastCalledWith({ search: "arcane", stock: "in", status: "active", pageSize: 8 });
    const sol = within(yours()).getByText("Sol Ring", { selector: ".gg-trade__your-name" }).closest("li")!;
    expect(sol).toHaveTextContent("On deal for $8.00. Trades use the regular price.");
    expect(sol).toHaveTextContent("$10.00");
    const signetLine = within(yours()).getByText("Arcane Signet", { selector: ".gg-trade__your-name" }).closest("li")!;
    expect(signetLine).toHaveTextContent("$20.00$10.00 each");
    expect(within(yours()).getByText("3 cards")).toBeInTheDocument();
    expect(within(yours()).getByText("Website price total").nextElementSibling).toHaveTextContent("$30.00");

    expect(total("Their cards at TCG low")).toHaveTextContent("$40.00");
    expect(total("Trade credit at 70%")).toHaveTextContent("$28.00");
    expect(total("Your cards at website price")).toHaveTextContent("$30.00");
    expect(result()).toHaveTextContent("They pay you$2.00Or they trade in $2.86 more at TCG low to cover it.");

    // A different percentage, or a typed one that isn't a percentage.
    await user.click(screen.getByRole("button", { name: "80%" }));
    expect(result()).toHaveTextContent("You owe them in trade credit$2.00Or they pick $2.00 more of your cards.");
    const percent = screen.getByLabelText("Trade credit");
    await user.clear(percent);
    await user.type(percent, "0");
    expect(screen.getByText("Enter a whole number from 1 to 150.")).toBeInTheDocument();
    expect(within(summary()).queryByRole("status")).toBeNull();
  });

  it("finds their cards with the same search as Add Inventory", async () => {
    const user = userEvent.setup();
    const first = renderPage();
    await user.type(nameField(), "Sam Rivera");

    // Search, pick the printing, then the condition, finish, how many and the TCG low.
    await user.click(within(theirs()).getByRole("button", { name: "Add card" }));
    let drawer = await screen.findByRole("dialog", { name: "Add a card they're trading in" });
    await user.type(within(drawer).getByLabelText("Search every Magic printing"), "sol ring");
    await user.click(await within(drawer).findByRole("button", { name: /Commander Legends \(cmr\) · #263/ }));
    expect(scryfall.searchPrintingsPage).toHaveBeenLastCalledWith("sol ring", 1);
    await user.selectOptions(within(drawer).getByLabelText("Condition"), "LP");
    await user.selectOptions(within(drawer).getByLabelText("Finish"), "foil");
    // Scryfall's price is a guide, not the TCG low.
    expect(within(drawer).getByText("Scryfall Foil: $4.00, for reference. You can also add it on the trade.")).toBeInTheDocument();
    expect(within(drawer).getByLabelText("TCG low (each)")).toHaveValue("");
    await user.clear(within(drawer).getByLabelText("Quantity"));
    await user.type(within(drawer).getByLabelText("Quantity"), "2");
    await user.type(within(drawer).getByLabelText("TCG low (each)"), "3.25{Enter}");
    expect(screen.queryByRole("dialog")).toBeNull();

    // It takes the place of the empty line the trade started with.
    const line = within(theirs()).getByText("Sol Ring").closest("li")!;
    expect(line).toHaveTextContent("CMR #263 · Lightly Played · Foil · Scryfall $4.00");
    expect(within(theirs()).queryByLabelText("Card, line 1 of their cards")).toBeNull();
    expect(screen.getByLabelText("Quantity, line 1 of their cards")).toHaveValue("2");
    expect(theirPrice(1)).toHaveValue("3.25");
    expect(within(theirs()).getByText("TCG low total").nextElementSibling).toHaveTextContent("$6.50");

    // The same printing, condition and finish again adds to that line.
    await user.click(within(theirs()).getByRole("button", { name: "Add card" }));
    drawer = await screen.findByRole("dialog", { name: "Add a card they're trading in" });
    await user.type(within(drawer).getByLabelText("Search every Magic printing"), "sol ring");
    await user.click(await within(drawer).findByRole("button", { name: /Commander Legends \(cmr\) · #263/ }));
    await user.selectOptions(within(drawer).getByLabelText("Condition"), "LP");
    await user.selectOptions(within(drawer).getByLabelText("Finish"), "foil");
    await user.click(within(drawer).getByRole("button", { name: "Add to trade" }));
    expect(await screen.findByText("Added 1 more Sol Ring (3 on the trade).")).toBeInTheDocument();
    expect(screen.getByLabelText("Quantity, line 1 of their cards")).toHaveValue("3");
    expect(theirPrice(1)).toHaveValue("3.25");

    // A line can still be typed by hand.
    await user.click(within(theirs()).getByRole("button", { name: "Enter by hand" }));
    expect(screen.getByLabelText("Card, line 2 of their cards")).toHaveFocus();

    // Kept on the device with the rest of the trade.
    first.unmount();
    renderPage();
    expect(within(theirs()).getByText("Sol Ring").closest("li")).toHaveTextContent("CMR #263 · Lightly Played · Foil");

    trades.confirm.mockResolvedValue(staffTrade());
    await user.click(screen.getByRole("button", { name: "Confirm trade" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirm trade" }));
    expect(trades.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        theirs: [
          {
            name: "Sol Ring",
            quantity: 3,
            tcgLowCents: 325,
            printing: {
              scryfallId: SOL_PRINTING_ID,
              setName: "Commander Legends",
              setCode: "cmr",
              collectorNumber: "263",
              condition: "LP",
              finish: "foil",
            },
          },
        ],
        yours: [],
      }),
    );
    // Confirmed, the card still shows its printing.
    expect(await within(theirs()).findByText("Sol Ring")).toBeInTheDocument();
    expect(within(theirs()).getByText("Sol Ring").closest("li")).toHaveTextContent("CMR #263 · Lightly Played · Foil");
  });

  it("needs the customer's name to confirm", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(theirPrice(1), "10");
    await user.click(screen.getByRole("button", { name: "Confirm trade" }));

    expect(within(summary()).getByRole("alert")).toHaveTextContent("Enter their name to confirm the trade.");
    expect(screen.getByText("Enter their name.")).toBeInTheDocument();
    expect(nameField()).toHaveFocus();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trades.confirm).not.toHaveBeenCalled();

    // Typing it clears both.
    await user.type(nameField(), "Sam");
    expect(within(summary()).queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Enter their name.")).toBeNull();
  });

  it("confirms the trade, then texts, emails or copies them the link", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(nameField(), "Sam Rivera");
    await user.type(screen.getByLabelText("Phone"), "314-555-0100");
    await buildTrade(user);
    trades.confirm.mockResolvedValue(staffTrade());

    await user.click(screen.getByRole("button", { name: "Confirm trade" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm the trade with Sam Rivera?" });
    expect(dialog).toHaveTextContent("They pay you $2.00. This saves the trade, so you can text or email them the full breakdown.");
    await user.click(within(dialog).getByRole("button", { name: "Confirm trade" }));

    // The shop's cards go up with the regular price the page showed: the server checks it again.
    expect(trades.confirm).toHaveBeenCalledWith({
      customer: { name: "Sam Rivera", phone: "314-555-0100", email: null },
      creditPercent: 70,
      theirs: [{ name: "Rhystic Study", quantity: 1, tcgLowCents: 4000, printing: null }],
      yours: [
        { inventoryItemId: SOL_ID, quantity: 1, priceCents: 1000 },
        { inventoryItemId: SIGNET_ID, quantity: 2, priceCents: 1000 },
      ],
    });
    const confirmed = await screen.findByRole("region", { name: "Trade #1001" });
    expect(confirmed).toHaveTextContent("Confirmed for Sam Rivera");
    expect(within(recentTrades()).getByText("#1001 Sam Rivera")).toBeInTheDocument();

    // Nothing on the trade can change now.
    expect(screen.queryByRole("button", { name: "Confirm trade" })).toBeNull();
    expect(within(theirs()).queryByRole("textbox")).toBeNull();
    expect(within(theirs()).getByText("Rhystic Study")).toBeInTheDocument();
    expect(within(yours()).queryByLabelText("Find a card in your inventory")).toBeNull();
    expect(nameField()).toBeDisabled();
    expect(screen.getByRole("button", { name: "New trade" })).toBeInTheDocument();

    // Text: the phone's messages open with the number and the link filled in.
    const text = within(confirmed).getByRole("link", { name: "Text the link" });
    const message = `Hi Sam, here's the full breakdown of your trade with Geega Games (#1001): ${LINK}`;
    expect(text).toHaveAttribute("href", `sms:3145550100?&body=${encodeURIComponent(message)}`);
    trades.texted.mockResolvedValue(staffTrade({ textedTo: "314-555-0100", textedAt: NOW }));
    const stay = (e: Event) => e.preventDefault(); // jsdom can't open an sms: link
    document.addEventListener("click", stay, true);
    await user.click(text);
    document.removeEventListener("click", stay, true);
    expect(trades.texted).toHaveBeenCalledWith(TRADE_ID, "314-555-0100");
    expect(await within(confirmed).findByText(/Texted to 314-555-0100/)).toBeInTheDocument();

    // Email: once there's an address to send it to.
    const email = within(confirmed).getByRole("button", { name: "Email the link" });
    expect(email).toBeDisabled();
    await user.type(screen.getByLabelText("Email"), "sam@example.com");
    trades.email.mockResolvedValue(staffTrade({ customerEmail: "sam@example.com", emailedTo: "sam@example.com", emailedAt: NOW }));
    await user.click(email);
    expect(trades.email).toHaveBeenCalledWith(TRADE_ID, "sam@example.com");
    expect(await screen.findByText("Emailed trade #1001 to sam@example.com.")).toBeInTheDocument();
    expect(within(confirmed).getByText(/Emailed to sam@example.com/)).toBeInTheDocument();

    await user.click(within(confirmed).getByRole("button", { name: "Copy link" }));
    expect(await navigator.clipboard.readText()).toBe(LINK);
    expect(within(confirmed).getByRole("link", { name: "Open" })).toHaveAttribute("href", LINK);
  });

  it("keeps a confirmed trade on the device, and starts a new one when asked", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "gg-trade-draft",
      JSON.stringify({
        creditPercent: "75",
        customer: { name: "Sam Rivera", phone: "314-555-0100", email: "" },
        theirs: [{ name: "Rhystic Study", quantity: "1", price: "40" }],
        yours: [savedLine(signet, 3, 1000)],
        confirmed: staffTrade(),
      }),
    );
    renderPage();
    expect(screen.getByRole("region", { name: "Trade #1001" })).toHaveTextContent("Send them the full breakdown");
    // A confirmed trade isn't checked against inventory again: it's done.
    expect(inventory.get).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "New trade" }));
    expect(summary()).toBeInTheDocument();
    expect(nameField()).toHaveValue("");
    expect(theirPrice(1)).toHaveValue("");
    expect(within(yours()).getByText("Search your inventory to add the cards they want.")).toBeInTheDocument();
    // The percentage stays for the next trade.
    expect(screen.getByRole("button", { name: "75%" })).toHaveAttribute("aria-pressed", "true");
  });

  it("won't confirm at a website price that has changed, and shows the new price", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(nameField(), "Sam Rivera");
    await addFromInventory(user, "arcane", signet);
    trades.confirm.mockRejectedValue(
      new Error(
        "The website price changed since you added this card: Arcane Signet (cmr NM) is now $12.00, not $10.00. Check the new total with them, then confirm again.",
      ),
    );
    inventory.get.mockResolvedValue(item({ priceCents: 1200 }));

    await user.click(screen.getByRole("button", { name: "Confirm trade" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirm trade" }));

    expect(await within(summary()).findByRole("alert")).toHaveTextContent("Arcane Signet (cmr NM) is now $12.00, not $10.00");
    await waitFor(() => expect(total("Your cards at website price")).toHaveTextContent("$12.00"));
    expect(screen.getByRole("button", { name: "Confirm trade" })).toBeInTheDocument();
  });

  it("checks the cards again when it opens a trade left from before", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "gg-trade-draft",
      JSON.stringify({
        creditPercent: "70",
        customer: { name: "Sam Rivera", phone: "", email: "" },
        theirs: [{ name: "", quantity: "1", price: "40" }],
        yours: [savedLine(signet, 2, 1000), savedLine(solRing, 1, 1000)],
        confirmed: null,
      }),
    );
    // Since then: the Signet went up to $11.00 with one left, and the Sol Ring sold.
    inventory.get.mockImplementation(async (id: string) =>
      id === SIGNET_ID ? item({ priceCents: 1100, quantity: 1 }) : { ...solRing, quantity: 0 },
    );
    renderPage();

    const notice = await within(summary()).findByRole("alert");
    expect(notice).toHaveTextContent(
      "Updated from inventory: Arcane Signet is now $11.00, not $10.00; only 1 Arcane Signet is in stock; Sol Ring is sold out. Check the new total with them.",
    );
    const signetLine = within(yours()).getByText("Arcane Signet", { selector: ".gg-trade__your-name" }).closest("li")!;
    expect(signetLine).toHaveTextContent("$11.00");
    expect(within(signetLine).getByRole("button", { name: "One more Arcane Signet" })).toBeDisabled();
    expect(within(yours()).getByText("Sol Ring is sold out: take it off the trade.")).toBeInTheDocument();
    // The sold card stays listed until it's taken off, but isn't part of the trade.
    expect(within(yours()).queryByRole("button", { name: "One more Sol Ring" })).toBeNull();
    expect(within(yours()).getByText("1 card")).toBeInTheDocument();
    expect(total("Your cards at website price")).toHaveTextContent("$11.00");

    await user.click(screen.getByRole("button", { name: "Confirm trade" }));
    expect(within(summary()).getByRole("alert")).toHaveTextContent("Take Sol Ring off the trade: it isn't for sale any more.");
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Remove Sol Ring" }));
    await user.click(screen.getByRole("button", { name: "Confirm trade" }));
    expect(await screen.findByRole("dialog", { name: "Confirm the trade with Sam Rivera?" })).toBeInTheDocument();
  });

  it("won't add more of a card than are in stock", async () => {
    const user = userEvent.setup();
    renderPage();
    await addFromInventory(user, "sol", solRing, 2);
    expect(await screen.findByText("Only 1 in stock.")).toBeInTheDocument();
    expect(within(yours()).getByRole("button", { name: "One more Sol Ring" })).toBeDisabled();
    expect(within(yours()).getByText("1 card")).toBeInTheDocument();
    expect(within(yours()).getByText("1 on the trade")).toBeInTheDocument();
  });

  it("asks for the TCG low of a card typed without one", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(nameField(), "Sam");
    await user.type(screen.getByLabelText("Card, line 1 of their cards"), "Sol Ring");
    await user.click(screen.getByRole("button", { name: "Confirm trade" }));
    expect(within(summary()).getByRole("alert")).toHaveTextContent("Add the TCG low on line 1 of their cards, or remove it.");
    expect(trades.confirm).not.toHaveBeenCalled();
  });

  it("leaves out a price that isn't a number, and says so", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(theirPrice(1), "12.345");
    expect(theirPrice(1)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/1 line isn't counted: fix the\s+price or quantity outlined in red\./)).toBeInTheDocument();
    expect(total("Their cards at TCG low")).toHaveTextContent("$0.00");
  });

  it("adds and removes their cards, Enter moving down a column", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(theirPrice(1), "5{Enter}");
    expect(theirPrice(2)).toHaveFocus();
    await user.type(theirPrice(2), "7");
    expect(total("Their cards at TCG low")).toHaveTextContent("$12.00");

    await user.click(screen.getByRole("button", { name: "Remove line 1 of their cards" }));
    expect(theirPrice(1)).toHaveValue("7");
    expect(screen.queryByLabelText("TCG low price, line 2 of their cards")).toBeNull();
    // The last line empties rather than going away.
    await user.click(screen.getByRole("button", { name: "Remove line 1 of their cards" }));
    expect(theirPrice(1)).toHaveValue("");
  });

  it("keeps the trade on this device until it's cleared, and the percentage after that", async () => {
    const user = userEvent.setup();
    const first = renderPage();
    expect(screen.getByRole("button", { name: "Clear trade" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "60%" }));
    await user.type(nameField(), "Sam");
    await user.type(screen.getByLabelText("Card, line 1 of their cards"), "Sol Ring");
    await user.type(theirPrice(1), "3.50");
    first.unmount();

    // Back from another page (or the app reloading).
    renderPage();
    expect(nameField()).toHaveValue("Sam");
    expect(screen.getByLabelText("Card, line 1 of their cards")).toHaveValue("Sol Ring");
    expect(theirPrice(1)).toHaveValue("3.50");
    expect(screen.getByRole("button", { name: "60%" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Clear trade" }));
    const dialog = await screen.findByRole("dialog", { name: "Clear this trade?" });
    expect(dialog).toHaveTextContent("The customer and both lists are emptied. The trade credit stays at 60%.");
    await user.click(within(dialog).getByRole("button", { name: "Clear trade" }));
    expect(nameField()).toHaveValue("");
    expect(theirPrice(1)).toHaveValue("");
    expect(screen.getByRole("button", { name: "60%" })).toHaveAttribute("aria-pressed", "true");
    expect(JSON.parse(window.localStorage.getItem("gg-trade-draft") ?? "{}")).toMatchObject({
      creditPercent: "60",
      customer: { name: "", phone: "", email: "" },
      theirs: [{ name: "", quantity: "1", price: "" }],
      yours: [],
      confirmed: null,
    });
  });

  it("picks up a trade left in the first version, without its typed cards of yours", () => {
    window.localStorage.setItem(
      "gg-trade-evaluator",
      JSON.stringify({
        creditPercent: "60",
        theirs: [{ name: "Sol Ring", quantity: "2", price: "3.50" }],
        yours: [{ name: "Arcane Signet", quantity: "1", price: "1.00" }],
      }),
    );
    renderPage();
    expect(screen.getByLabelText("Card, line 1 of their cards")).toHaveValue("Sol Ring");
    expect(theirPrice(1)).toHaveValue("3.50");
    expect(screen.getByRole("button", { name: "60%" })).toHaveAttribute("aria-pressed", "true");
    expect(within(yours()).getByText("Search your inventory to add the cards they want.")).toBeInTheDocument();
    expect(window.localStorage.getItem("gg-trade-evaluator")).toBeNull();
    expect(window.localStorage.getItem("gg-trade-draft")).not.toBeNull();
  });

  it("starts afresh when what's stored can't be read", () => {
    window.localStorage.setItem("gg-trade-draft", "{not json");
    renderPage();
    expect(screen.getByLabelText("Trade credit")).toHaveValue("70");
    expect(theirPrice(1)).toHaveValue("");
  });

  it("lists recent trades to send again, and copes when they don't load", async () => {
    const user = userEvent.setup();
    trades.recent.mockRejectedValueOnce(new Error("offline"));
    renderPage();
    expect(await within(recentTrades()).findByText(/Couldn't load recent trades\./)).toBeInTheDocument();

    trades.recent.mockResolvedValue([staffTrade({ customerEmail: "sam@example.com" })]);
    await user.click(within(recentTrades()).getByRole("button", { name: "Try again" }));
    const row = (await within(recentTrades()).findByText("#1001 Sam Rivera")).closest("li")!;
    expect(row).toHaveTextContent("Not sent yet");
    expect(row).toHaveTextContent("They pay $2.00");
    expect(within(row).getByRole("link", { name: "Text trade #1001 to Sam Rivera" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^sms:3145550100\?&body=/),
    );

    trades.email.mockResolvedValue(staffTrade({ customerEmail: "sam@example.com", emailedTo: "sam@example.com", emailedAt: NOW }));
    await user.click(within(row).getByRole("button", { name: "Email trade #1001 to Sam Rivera" }));
    expect(trades.email).toHaveBeenCalledWith(TRADE_ID, "sam@example.com");
    expect(await within(recentTrades()).findByText(/Emailed$/)).toBeInTheDocument();
  });

  it("starts a first trade at the online rate, and points out cards under the trade-in minimum", async () => {
    const user = userEvent.setup();
    tradeCenter.settings.mockResolvedValue({ settings: { creditRatePercent: 80, minCardValueCents: 1500 }, owner: true });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Trade credit")).toHaveValue("80"));
    await user.type(screen.getByLabelText("Card, line 1 of their cards"), "Llanowar Elves");
    await user.type(theirPrice(1), "0.25");
    const row = screen.getByLabelText("Card, line 1 of their cards").closest("li")!;
    expect(row).toHaveTextContent("Under the $15.00 trade-in minimum");
    // Only a note: the card still counts.
    expect(total("Their cards at TCG low")).toHaveTextContent("$0.25");
    await user.clear(theirPrice(1));
    await user.type(theirPrice(1), "15");
    expect(row).not.toHaveTextContent("trade-in minimum");
  });

  it("keeps the percentage last used on this device, and mentions the online rate", async () => {
    window.localStorage.setItem("gg-trade-draft", JSON.stringify({ creditPercent: "70", customer: {}, theirs: [], yours: [], confirmed: null }));
    tradeCenter.settings.mockResolvedValue({ settings: { creditRatePercent: 80, minCardValueCents: 1500 }, owner: true });
    renderPage();
    expect(await screen.findByText(/Online trades get 80%\./)).toBeInTheDocument();
    expect(screen.getByLabelText("Trade credit")).toHaveValue("70");
  });

  it("works as before when the online trade terms aren't set up", async () => {
    renderPage();
    await waitFor(() => expect(tradeCenter.settings).toHaveBeenCalled());
    expect(screen.getByLabelText("Trade credit")).toHaveValue("70");
    expect(screen.queryByText(/Online trades get/)).toBeNull();
  });

  it("is in the admin menu, next to the register", () => {
    const keys = NAV_ITEMS.map((item) => item.key);
    expect(keys.indexOf("trade-evaluator")).toBe(keys.indexOf("pos") + 1);
    expect(NAV_ITEMS.find((item) => item.key === "trade-evaluator")).toMatchObject({
      label: "Trade Evaluator",
      path: "/admin_dashboard/trade-evaluator",
    });
    expect(adminSection("/admin_dashboard/trade-evaluator")).toBe("trade-evaluator");
    expect(SECTION_TITLES["trade-evaluator"]).toBe("Trade Evaluator");
  });
});
