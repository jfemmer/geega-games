// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CustomerTrade, CustomerTradeSummary, TradeTerms } from "../src/store/lib/tradeCenter";
import type { CartLine } from "../src/store/lib/CartContext";
import type { CatalogCard } from "../src/store/lib/useCatalog";
import { TRADE_ID, TRADE_TERMS, confirmation, customerCard, customerSummary, customerTrade, shipment } from "./helpers/tradeFixtures";

// The storefront's Trade Center: trading toward the shopping cart ("Use My
// Magic Cards", on the Trade Cards page and at checkout), how trading is
// shown while shopping (the shop banner, the card page's note, the old trade
// cart moving into the cart), a trade's own page at each step (building it,
// choosing each card's condition, confirming with or without the refundable
// deposit, shipping and tracking, proof of shipping, canceling, the final
// offer, how it settled, an expired reservation, coming back from a bank
// check), and My Trades. The real API client runs; fetch is the stand-in for
// /api/trade-center, so these tests see exactly what's sent and with whose
// session. The shopping cart is a small stand-in that keeps its lines (so
// the panel re-renders as they change). Stripe's card form is a stand-in
// (card details never reach our pages anyway).

const world = vi.hoisted(() => ({
  session: "member-token" as string | null,
  addresses: [] as Record<string, unknown>[],
  /** inventory_public rows: what each cart line counts for in a trade. */
  inventory: [] as Record<string, unknown>[],
  terms: null as unknown as TradeTerms,
  trade: null as unknown as CustomerTrade,
  trades: [] as CustomerTradeSummary[],
  posts: [] as { body: Record<string, unknown>; auth: string | undefined }[],
  /** The trade asked for isn't the customer's (or doesn't exist). */
  missing: false,
  /** A POST's answer (default: ok with the current trade). */
  respond: null as null | ((body: Record<string, unknown>) => { status: number; json: Record<string, unknown> }),
  /** What the public card search (/api/sell/scryfall-search) finds. */
  printings: [] as Record<string, unknown>[],
}));

/** The shopping cart: its lines, and what was added to it. */
const cart = vi.hoisted(() => {
  let lines: unknown[] = [];
  const listeners = new Set<() => void>();
  return {
    added: [] as { id: string; qty: number }[],
    get: () => lines,
    set(next: unknown[]) {
      lines = next;
      for (const fn of listeners) fn();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
});

vi.mock("../src/supabase", () => {
  const chainFor = (table: string) => {
    const chain = {
      select: () => chain,
      order: () => chain,
      eq: () => chain,
      in: () => chain,
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: table === "inventory_public" ? world.inventory : world.addresses, error: null }).then(resolve),
    };
    return chain;
  };
  return {
    isSupabaseConfigured: true,
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: world.session ? { access_token: world.session } : null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      from: (table: string) => chainFor(table),
      rpc: async (name: string) => (name === "get_card_detail" ? { data: CARD_DETAIL, error: null } : { data: null, error: null }),
    },
  };
});

vi.mock("../src/store/lib/AuthContext", () => ({
  useAuth: () => ({ user: world.session ? { id: "ann", email: "ann@example.com" } : null, loading: false, signOut: async () => {} }),
}));
vi.mock("../src/store/lib/CartContext", async () => {
  const { useSyncExternalStore } = await import("react");
  type Line = { inventoryItemId: string; quantity: number };
  return {
    useCart: () => {
      const lines = useSyncExternalStore(cart.subscribe, cart.get) as Line[];
      return {
        lines,
        loading: false,
        addItem: async (id: string, qty = 1) => {
          cart.added.push({ id, qty });
        },
        setQuantity: async (id: string, qty: number) =>
          cart.set((cart.get() as Line[]).map((l) => (l.inventoryItemId === id ? { ...l, quantity: qty } : l))),
        removeItem: async (id: string) => cart.set((cart.get() as Line[]).filter((l) => l.inventoryItemId !== id)),
      };
    },
  };
});
vi.mock("../src/store/lib/stripeClient", () => ({ isStripeConfigured: true, getStripePromise: () => null }));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: ReactNode }) => <div data-testid="stripe-elements">{children}</div>,
  PaymentElement: () => null,
  useStripe: () => null,
  useElements: () => null,
}));
vi.mock("../src/store/lib/WishlistContext", () => ({
  useWishlist: () => ({ isWishlisted: () => false, pending: new Set<string>(), toggle: async () => {} }),
}));

const CARD_DETAIL = {
  oracleId: "o-sheol",
  cardName: "Sheoldred, the Apocalypse",
  inStockCount: 2,
  minPriceCents: 6800,
  maxPriceCents: 6800,
  listings: [
    {
      id: "listing-1",
      scryfallId: null,
      setCode: "dmu",
      setName: "Dominaria United",
      collectorNumber: "107",
      rarity: "mythic",
      condition: "NM",
      finish: "nonfoil",
      variantType: null,
      imageUrl: null,
      quantity: 2,
      priceCents: 6800,
      isDeal: true,
      originalPriceCents: 8000,
      dealDiscountPercent: 15,
      dealSource: "manual",
      dealNote: null,
    },
  ],
};

const fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
  const u = new URL(url, "http://localhost");
  const reply = (status: number, json: unknown) => ({ ok: status < 400, status, json: async () => json });
  if (u.pathname === "/api/sell/scryfall-search") return reply(200, { data: world.printings, totalCards: world.printings.length, hasMore: false, page: 1 });
  if (u.pathname !== "/api/trade-center") return reply(404, { ok: false });
  if ((init?.method ?? "GET") === "GET") {
    if (u.searchParams.get("view") === "mine") return reply(200, { ok: true, terms: world.terms, trades: world.trades });
    if (u.searchParams.get("id")) {
      return world.missing ? reply(404, { ok: false, message: "That trade isn't there." }) : reply(200, { ok: true, terms: world.terms, trade: world.trade });
    }
    return reply(200, { ok: true, terms: world.terms });
  }
  const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
  world.posts.push({ body, auth: init?.headers?.Authorization });
  if (world.respond) {
    const out = world.respond(body);
    return reply(out.status, out.json);
  }
  return reply(200, { ok: true, terms: world.terms, trade: world.trade });
});
vi.stubGlobal("fetch", fetchMock);
Element.prototype.scrollIntoView = vi.fn();

const { RouterProvider } = await import("../src/store/lib/router");
const { loadTradeTerms, resetTradeTermsForTests } = await import("../src/store/lib/tradeCenterApi");
const { LegacyTradeCartMove } = await import("../src/store/lib/tradeCart");
const { default: TradeCardsPage } = await import("../src/store/pages/TradeCardsPage");
const { default: TradeDetail } = await import("../src/store/components/trades/TradeDetail");
const { default: MyTrades } = await import("../src/store/components/trades/MyTrades");
const { default: CardDetailPage } = await import("../src/store/pages/CardDetailPage");
const { default: ProductCard } = await import("../src/store/components/ProductCard");
const { TradeBanner } = await import("../src/store/components/trades/TradeBanner");

function at(path: string, ui: React.ReactNode) {
  window.history.replaceState({}, "", path);
  return render(<RouterProvider>{ui}</RouterProvider>);
}

/** A copy in the shopping cart, at the price it's sold at today. */
function cartLine(over: Partial<CartLine> = {}): CartLine {
  return {
    inventoryItemId: "i1",
    quantity: 1,
    name: "The One Ring",
    setCode: "ltr",
    setName: "The Lord of the Rings",
    condition: "NM",
    finish: "nonfoil",
    imageUrl: null,
    priceCents: 7999,
    sellable: 1,
    variantType: null,
    saleOnly: false,
    ...over,
  };
}

/**
 * Puts lines in the cart, each counting in a trade at its regular price:
 * `regular` (the price before a deal) when given, else the cart price.
 */
function fillCart(...lines: (CartLine & { regular?: number })[]) {
  world.inventory = lines.map((l) => ({
    id: l.inventoryItemId,
    price_cents: l.priceCents,
    original_price_cents: l.regular ?? null,
    sale_only: l.saleOnly,
  }));
  cart.set(lines.map(({ regular: _regular, ...l }) => l));
}

beforeEach(() => {
  window.localStorage.clear();
  resetTradeTermsForTests();
  cart.set([]);
  cart.added = [];
  world.session = "member-token";
  world.addresses = [];
  world.inventory = [];
  world.terms = TRADE_TERMS;
  world.trade = customerTrade();
  world.trades = [];
  world.posts = [];
  world.respond = null;
  world.missing = false;
  world.printings = [];
  fetchMock.mockClear();
});

afterEach(() => {
  cleanup();
});

/** The Use My Magic Cards panel, once its trade prices have loaded. */
async function usePanel() {
  const panel = await screen.findByRole("region", { name: "Use My Magic Cards" });
  await waitFor(() => expect(within(panel).queryByRole("button", { name: /tell us what you're trading|sign in to trade/i })).toBeEnabled());
  return panel;
}

describe("the Trade Cards page (1)", () => {
  /** The page, and how trading works once the terms have loaded. */
  async function openPage() {
    at("/trade-cards", <TradeCardsPage />);
    await screen.findByRole("heading", { level: 1, name: "Trade your cards toward your cart" });
    const how = await screen.findByRole("region", { name: "How trading works" });
    await waitFor(() => expect(how).toHaveTextContent("80% of their value in trade credit"));
    return how;
  }

  it("trades toward the cart: our cards at their regular price, what of theirs it takes, and starting the trade as the signed-in customer", async () => {
    const user = userEvent.setup();
    // On deal at $68 in the cart; a trade counts it at its regular $80.
    fillCart(cartLine({ priceCents: 6800, regular: 8000 }));
    world.respond = () => ({ status: 200, json: { ok: true, terms: TRADE_TERMS, trade: customerTrade({ id: "new-trade" }) } });
    await openPage();
    expect(screen.getByText(/We price your cards at TCG low, and you get 80% of that as trade credit\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Your trades" })).toHaveAttribute("href", "/account/trades");

    const panel = await usePanel();
    expect(panel).toHaveTextContent("Have Magic cards you’re not using? Trade them toward the cards in your cart!");
    expect(panel).toHaveTextContent("Eligible cards earn 80% of their TCG low value in trade credit");
    expect(within(panel).getByRole("heading", { name: "Step 1 of 3: the cards you want" })).toBeInTheDocument();
    expect(panel).toHaveTextContent("The One Ring");
    expect(within(panel).getByRole("link", { name: "Add more cards" })).toHaveAttribute("href", "/shop");
    expect(panel).toHaveTextContent("In a trade our cards count at their regular price: sale and member prices don’t apply.");
    expect(panel).toHaveTextContent("Our cards (1)$80.00");
    // $80 of our cards at 80% trade credit takes $100 of theirs, at TCG low.
    expect(within(panel).getByText("$100.00").closest("p")).toHaveTextContent("To cover our cards, trade in about $100.00 of your cards at TCG low");
    expect(panel).toHaveTextContent("At 80% trade credit. Trade in less and pay the rest by card, or more and keep the extra as store credit.");
    // No minimum set: nothing to say about one.
    expect(panel).not.toHaveTextContent("minimum");
    // What happens to our cards once they send it: held while we review, then the time to confirm.
    expect(panel).toHaveTextContent(
      "When you send your trade, we hold these for you for up to 12 hours while we review it; once approved you'll have 48 hours (not counting Sundays) to confirm.",
    );
    // The store-credit route, for someone not buying anything.
    expect(within(panel).getByRole("link", { name: "Get store credit for my cards" })).toHaveAttribute("href", "/sell");

    await user.click(within(panel).getByRole("button", { name: "Continue: tell us what you're trading" }));
    await waitFor(() => expect(window.location.pathname).toBe("/account/trades/new-trade"));
    expect(world.posts).toEqual([{ body: { action: "start", items: [{ inventoryItemId: "i1", quantity: 1 }], handoffMethod: "ship" }, auth: "Bearer member-token" }]);
    // They're on the trade now, not in the cart: nothing is bought twice.
    expect(cart.get()).toEqual([]);
  });

  it("keeps a consigned copy in the cart to buy normally, and trades the rest", async () => {
    const user = userEvent.setup();
    fillCart(cartLine(), cartLine({ inventoryItemId: "c1", name: "Consigned Bolt", priceCents: 500, saleOnly: true }));
    world.respond = () => ({ status: 200, json: { ok: true, terms: TRADE_TERMS, trade: customerTrade({ id: "new-trade" }) } });
    at("/trade-cards", <TradeCardsPage />);
    const panel = await usePanel();
    expect(panel).toHaveTextContent("Consigned Bolt is a consigned copy and can't be traded. It stays in your cart to buy normally.");
    expect(within(panel).queryByRole("combobox", { name: "How many Consigned Bolt" })).toBeNull();
    expect(panel).toHaveTextContent("Our cards (1)$79.99");

    await user.click(within(panel).getByRole("button", { name: "Continue: tell us what you're trading" }));
    await waitFor(() => expect(window.location.pathname).toBe("/account/trades/new-trade"));
    expect(world.posts[0].body.items).toEqual([{ inventoryItemId: "i1", quantity: 1 }]);
    expect(cart.get()).toEqual([expect.objectContaining({ inventoryItemId: "c1" })]);
  });

  it("explains trading by mail and in person, in tabs", async () => {
    const user = userEvent.setup();
    const how = await openPage();
    expect(how).toHaveTextContent("Trade by mail, or in person in the St. Louis area.");
    const ship = within(how).getByRole("tab", { name: "Ship your cards" });
    const local = within(how).getByRole("tab", { name: "Local pickup" });
    expect(ship).toHaveAttribute("aria-selected", "true");
    await user.click(local);
    const panel = within(how).getByRole("tabpanel", { name: "Local pickup" });
    expect(within(panel).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Choose our cards. Add singles from our shop to your cart, then choose Use My Magic Cards at checkout. There’s no shipping.",
      "Select local pickup. Choose Local pickup when you start your trade, then send it. You don’t need to list your cards in advance, though you’re welcome to add a note about what you plan to bring.",
      "We review your trade. We check that our cards are available and email you as soon as your trade is approved. Approving takes our cards off sale and holds them for you until we meet: there’s nothing to confirm, and no deposit.",
      "We set up the meetup. We message you on your trade page to schedule a time to meet in the St. Louis area. Changed your mind about one of our cards? Tell us and we’ll take it off. Can’t make it? Cancel at no cost so we can put our cards back on sale.",
      "Meet and settle. Bring your cards: staples valued at $15 or more each at TCG low. We review each card together, price it at its TCG low for its condition, and you receive 80% as trade credit. Pay any remaining balance in cash or by card, or keep leftover credit for a future order. You leave with our cards the same day.",
    ]);
    // Cards are graded together in person: no condition table for local pickup.
    expect(within(how).queryByRole("table")).toBeNull();
    // Arrow keys move between the tabs.
    await user.keyboard("{ArrowLeft}");
    expect(ship).toHaveFocus();
    expect(ship).toHaveAttribute("aria-selected", "true");
    expect(within(how).getByRole("table", { name: /You choose each card’s condition/ })).toBeInTheDocument();
  });

  it("starts from an empty cart with the way to the shop, and how trading works", async () => {
    const how = await openPage();
    const panel = screen.getByRole("region", { name: "Use My Magic Cards" });
    expect(panel).toHaveTextContent("Your cart is empty. Add the cards you’d like, then come back here to trade toward them.");
    expect(within(panel).getByRole("link", { name: "Shop Magic cards" })).toHaveAttribute("href", "/shop");
    expect(within(panel).queryByRole("button", { name: /tell us what you're trading/i })).toBeNull();
    expect(how).toBeInTheDocument();
  });

  it("explains trading in three steps: choose, tell us (choosing each card's condition), complete; and what each condition is worth", async () => {
    const how = await openPage();
    const steps = within(how).getAllByRole("listitem").map((li) => li.textContent);
    expect(steps).toEqual([
      "Choose your cards. Shop as usual and add singles to your cart. At checkout, choose Use My Magic Cards.",
      "Tell us what you're trading. Search for each card, paste a list or upload a CSV, and choose each card’s condition. We accept staples worth $15 or more each, and you’ll see an estimate as you go: 80% of their value in trade credit. When you send it, we hold your chosen cards for up to 12 hours while we review.",
      "Complete your trade. Once we approve it, confirm within 48 hours (trades of $300 or more take a refundable deposit), then ship your cards with tracking within 72 hours (4 days once you've completed 3 trades). Sundays don’t count. We check every card when it arrives and send your final offer at TCG low, with any change explained. Accept it and we ship your new cards; decline and we return yours with no penalty.",
    ]);
    // What each condition is worth; the customer chooses it, never its age.
    const conditions = within(how).getByRole("table", { name: /You choose each card’s condition; we check every card when it arrives/ });
    expect(within(conditions).getAllByRole("row").slice(1).map((r) => r.textContent)).toEqual([
      `Near Mint${TRADE_TERMS.conditionPercents.NM}% of a near-mint copy`,
      `Lightly Played${TRADE_TERMS.conditionPercents.LP}% of a near-mint copy`,
      `Moderately Played${TRADE_TERMS.conditionPercents.MP}% of a near-mint copy`,
      `Heavily Played${TRADE_TERMS.conditionPercents.HP}% of a near-mint copy`,
      `Damaged${TRADE_TERMS.conditionPercents.DMG}% of a near-mint copy`,
    ]);
    expect(within(conditions).getByRole("link", { name: "How we grade" })).toHaveAttribute("href", "/condition-guide");
    expect(how).not.toHaveTextContent(/years old|printing’s age/);
    // The FAQ says the same.
    expect(screen.getByText("How do you decide my cards' condition?")).toBeInTheDocument();
    expect(screen.getByText(/^You choose each card's condition when you list it, and your estimate uses it\./)).toBeInTheDocument();
    expect(screen.getByText(/we price each of your cards at its TCG low \(TCGplayer's lowest listed price\) for its condition and finish\. Your trade credit is 80% of that\./)).toBeInTheDocument();
    expect(screen.getByText(/One in better shape than listed is worth more, and one in worse shape is worth less/)).toBeInTheDocument();
    // No minimum set: the page doesn't advertise a $0 one.
    expect(screen.getByText(/^Not right now: a trade can be any amount of our cards\./)).toBeInTheDocument();
    expect(how).not.toHaveTextContent("$0");
  });

  it("explains holds, the confirmation and shipping windows and the deposit, from the settings", async () => {
    await openPage();
    // The worked example is a real deadline: 3 qualifying days from Friday 2 PM skips Sunday.
    expect(screen.getByText(/confirm on a Friday at 2 PM and you'd ship by Tuesday at 2 PM/)).toBeInTheDocument();
    // Loyalty tiers that give more time, in the same words.
    expect(screen.getByText(/^72 hours from confirming/)).toHaveTextContent("After 3 completed trades you get 4 days, and after 10, 5 days.");
    // Held from sending, through the confirmation window.
    expect(
      screen.getByText(
        "As soon as you send your trade for review, we hold the cards you picked for you for up to 12 hours while we look at it (on trades with up to $500 of our cards; bigger trades are held once we approve them). Once we approve it they stay held while you confirm: you have 48 hours to confirm (Sundays don't count). Confirming reserves them until your trade is done. If a card sells before you send your trade, we'll tell you and you can pick another.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Ask us to take another look, or decline it. We mail them back.")).toBeInTheDocument();

    const deposit = screen.getByText("The refundable deposit").closest("details")!;
    expect(deposit).toHaveTextContent("trades with $300.00 or more of our cards need a small deposit to confirm");
    const rows = within(deposit).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(rows).toEqual([
      "Under $100.00$5.00 only if we ask",
      "$100.00 to $299.99$10.00 only if we ask",
      "$300.00 to $599.99$20.00",
      "$600.00 or more$30.00",
    ]);
    expect(deposit).toHaveTextContent("Declining our final offer after your cards arrive, or canceling once the carrier has your package, never costs it.");
  });

  it("says when our cards stay on sale until confirming, while review holds are off", async () => {
    world.terms = { ...TRADE_TERMS, reviewHoldsEnabled: false };
    fillCart(cartLine());
    const how = await openPage();
    expect(how).not.toHaveTextContent("we hold your chosen cards");
    expect(screen.getByText(/^When you confirm your approved trade\. While you build your trade and while we review it, our cards stay on sale\./)).toBeInTheDocument();
    const panel = await usePanel();
    expect(panel).toHaveTextContent("These stay on sale until your trade is approved and confirmed.");
  });

  it("doesn't advertise a deposit while deposits are off", async () => {
    world.terms = { ...TRADE_TERMS, depositsEnabled: false };
    const how = await openPage();
    expect(screen.queryByText("The refundable deposit")).toBeNull();
    expect(how).not.toHaveTextContent("deposit");
    expect(screen.getByText(/Not right now\. If a trade ever needs one/)).toBeInTheDocument();
  });

  it("sends someone who isn't signed in to sign in first, and back to trading", async () => {
    const user = userEvent.setup();
    world.session = null;
    fillCart(cartLine());
    at("/trade-cards", <TradeCardsPage />);
    const panel = await usePanel();
    await user.click(within(panel).getByRole("button", { name: "Sign in to trade" }));
    expect(window.location.pathname).toBe("/login");
    expect(window.location.search).toBe("?next=%2Fcheckout%3Fpay%3Dtrade");
    expect(world.posts).toEqual([]);
    expect(screen.queryByRole("link", { name: "Your trades" })).toBeNull();
  });

  it("says when new trades are paused, and won't start one", async () => {
    world.terms = { ...TRADE_TERMS, paused: true, pauseMessage: "Back after the holidays." };
    fillCart(cartLine());
    at("/trade-cards", <TradeCardsPage />);
    expect((await screen.findAllByText("Back after the holidays.")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /tell us what you're trading/i })).toBeNull();
  });

  it("won't start a trade under the minimum, and follows the cart: the minimum, free shipping and the TCG low it takes", async () => {
    const user = userEvent.setup();
    world.terms = { ...TRADE_TERMS, minTradeValueCents: 7500 };
    fillCart(cartLine({ inventoryItemId: "i2", name: "Arcane Signet", quantity: 2, sellable: 9, priceCents: 2500 }));
    at("/trade-cards", <TradeCardsPage />);
    const panel = await screen.findByRole("region", { name: "Use My Magic Cards" });
    await waitFor(() => expect(panel).toHaveTextContent("Our cards (2)$50.00"));
    const startButton = () => within(panel).getByRole("button", { name: "Continue: tell us what you're trading" });
    const copies = (n: number) => user.selectOptions(within(panel).getByLabelText("How many Arcane Signet"), String(n));
    const need = () => within(panel).getByText(/^To cover our cards, trade in about/).closest("p");
    // $50 of our cards: not enough to start. It takes $62.50 of theirs at TCG low.
    expect(within(panel).getByText("Add $25 more in cards to reach the $75 minimum trade value!")).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
    expect(startButton()).toHaveAccessibleDescription("Add $25 more in cards to reach the $75 minimum trade value!");
    expect(need()).toHaveTextContent("To cover our cards, trade in about $62.50 of your cards at TCG low");
    // Shipping our cards is its own line, apart from shipping theirs to us.
    expect(panel).toHaveTextContent("Shipping our cards to youTracked · paid by card when your trade is final$3.99");
    // $100: past the minimum, $100 from free shipping.
    await copies(4);
    expect(cart.get()).toEqual([expect.objectContaining({ inventoryItemId: "i2", quantity: 4 })]);
    expect(within(panel).getByText("Your trade meets the minimum value requirement!")).toBeInTheDocument();
    expect(within(panel).getByText("You’re $100 away from FREE shipping!")).toBeInTheDocument();
    expect(startButton()).toBeEnabled();
    expect(need()).toHaveTextContent("trade in about $125.00 of your cards at TCG low");
    expect(panel).toHaveTextContent("Our cards (4)$100.00");
    // $200: free.
    await copies(8);
    expect(within(panel).getByText("Your trade qualifies for FREE tracked shipping!")).toBeInTheDocument();
    expect(panel).toHaveTextContent("Shipping our cards to youTracked, on usFREE");
    expect(need()).toHaveTextContent("trade in about $250.00 of your cards at TCG low");
    // Back under the minimum: the start is off again.
    await copies(1);
    expect(startButton()).toBeDisabled();
    // Taking a card off takes it out of the cart.
    await user.click(within(panel).getByRole("button", { name: /Remove Arcane Signet/ }));
    expect(cart.get()).toEqual([]);
    expect(world.posts).toEqual([]);
  });

  it("spells out the minimum, shipping and the processing fee from the settings", async () => {
    world.terms = { ...TRADE_TERMS, minTradeValueCents: 7500, processingFeeCents: 200 };
    fillCart(cartLine());
    const how = await openPage();
    expect(how).toHaveTextContent("Trades start at $75 of our cards.");
    const know = screen.getByRole("region", { name: "Good to know" });
    expect(know).toHaveTextContent("We’re looking for staples: cards worth less than $15 each at TCG low, in their condition, can’t be traded.");
    // Said up top too, where customers start.
    expect(screen.getByText(/We’re looking for staples:/, { selector: "strong" }).closest("p")).toHaveTextContent(
      "We’re looking for staples: cards worth $15+ each at TCG low, in their condition. No bulk, please.",
    );
    expect(know).toHaveTextContent("Our cards ship to you tracked: $3.99, or free on $200 or more of our cards. Paid by card when your trade is final, never out of your trade credit.");
    expect(know).toHaveTextContent("Shipping is never charged on a trade that’s canceled or declined, and it’s separate from any deposit.");
    expect(know).toHaveTextContent("A processing fee of $2.00 comes off each trade’s credit.");
    // The fee is covered too: ($79.99 + $2.00) at 80% takes $102.49 of theirs.
    const panel = await usePanel();
    expect(panel).toHaveTextContent("To cover our cards, trade in about $102.49 of your cards at TCG low");
    expect(panel).toHaveTextContent("At 80% trade credit, after the $2.00 processing fee.");
    expect(screen.getByText(/Yes: at least \$75 of our cards per trade/)).toHaveTextContent("takes $96.25 of your cards at TCG low to cover completely");
  });

  it("shows the start's refusal in its own words, leaving the cart as it was", async () => {
    const user = userEvent.setup();
    fillCart(cartLine());
    world.respond = () => ({ status: 409, json: { ok: false, message: "Only 0 of The One Ring available." } });
    at("/trade-cards", <TradeCardsPage />);
    const panel = await usePanel();
    await user.click(within(panel).getByRole("button", { name: "Continue: tell us what you're trading" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("Only 0 of The One Ring available.");
    expect(cart.get()).toHaveLength(1);
    expect(window.location.pathname).toBe("/trade-cards");
  });

  it("links to the customer's trades when the open-trade limit stops a new one", async () => {
    const user = userEvent.setup();
    fillCart(cartLine());
    world.respond = () => ({ status: 409, json: { ok: false, message: "You already have an open trade. Finish or cancel it first." } });
    at("/trade-cards", <TradeCardsPage />);
    const panel = await usePanel();
    await user.click(within(panel).getByRole("button", { name: "Continue: tell us what you're trading" }));
    const alert = await within(panel).findByRole("alert");
    expect(within(alert).getByRole("link", { name: "See your trades" })).toHaveAttribute("href", "/account/trades");
  });
});

describe("trading while shopping", () => {
  /** A copy in the shop's grid; on deal by default (15% off $80). */
  const shopCard = (over: Partial<CatalogCard> = {}): CatalogCard => ({
    id: "inv-1",
    oracleId: "o-sheol",
    name: "Sheoldred, the Apocalypse",
    set: "dmu",
    setName: "Dominaria United",
    collectorNumber: "107",
    type: "Legendary Creature — Phyrexian Praetor",
    rarity: "mythic",
    quantity: 2,
    imageUrl: null,
    priceCents: 6800,
    condition: "NM",
    finish: "nonfoil",
    foil: false,
    scryfallId: null,
    isDeal: true,
    originalPriceCents: 8000,
    dealDiscountPercent: 15,
    dealSource: "manual",
    dealNote: null,
    variantType: null,
    ...over,
  });

  it("says on a card's page that cards can be traded toward it, with no separate trade button", async () => {
    at("/shop/card/sheoldred-the-apocalypse", <CardDetailPage slug="sheoldred-the-apocalypse" />);
    await screen.findByRole("heading", { level: 1, name: "Sheoldred, the Apocalypse" });
    const note = (await screen.findByText(/You can trade your Magic cards toward this\./)).closest("p")!;
    expect(within(note).getByRole("link", { name: "How trading works" })).toHaveAttribute("href", "/trade-in-magic-cards");
    expect(screen.queryByRole("button", { name: /Add to trade/ })).toBeNull();
    expect(screen.queryByText(/^Trades at/)).toBeNull();
  });

  it("doesn't mention trading on a card's page while trading is paused", async () => {
    world.terms = { ...TRADE_TERMS, paused: true };
    at("/shop/card/sheoldred-the-apocalypse", <CardDetailPage slug="sheoldred-the-apocalypse" />);
    await screen.findByRole("heading", { level: 1, name: "Sheoldred, the Apocalypse" });
    await act(async () => {
      await loadTradeTerms();
    });
    expect(screen.queryByText(/You can trade your Magic cards toward this\./)).toBeNull();
  });

  it("offers only Add to cart on the shop's cards: there's one cart", async () => {
    at("/shop", <ProductCard card={shopCard()} />);
    await act(async () => {
      await loadTradeTerms();
    });
    expect(screen.getByRole("button", { name: "Add to cart" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add to trade/ })).toBeNull();
    expect(screen.queryByText(/^Trades at/)).toBeNull();
  });

  it("tells shoppers above the shop that they can trade toward their cart, only while trading is open", async () => {
    at("/shop", <TradeBanner />);
    const banner = (await screen.findByText(/Trade them toward your cart at checkout/)).closest("p")!;
    expect(banner).toHaveTextContent("Have Magic cards you’re not using? Trade them toward your cart at checkout: 80% of their value in trade credit.");
    expect(within(banner).getByRole("link", { name: "How trading works" })).toHaveAttribute("href", "/trade-in-magic-cards");
    cleanup();

    resetTradeTermsForTests();
    world.terms = { ...TRADE_TERMS, paused: true };
    at("/shop", <TradeBanner />);
    await act(async () => {
      await loadTradeTerms();
    });
    expect(screen.queryByText(/Trade them toward your cart/)).toBeNull();
  });

  it("moves an old trade cart into the shopping cart once, then forgets it", async () => {
    window.localStorage.setItem(
      "gg-trade-cart",
      JSON.stringify([
        { inventoryItemId: "i1", cardName: "The One Ring", quantity: 2, tradePriceCents: 7999 },
        { inventoryItemId: 7, quantity: 1 },
        { inventoryItemId: "i3", quantity: 0 },
      ]),
    );
    const { rerender } = at("/shop", <LegacyTradeCartMove />);
    await waitFor(() => expect(cart.added).toEqual([{ id: "i1", qty: 2 }]));
    expect(window.localStorage.getItem("gg-trade-cart")).toBeNull();
    rerender(
      <RouterProvider>
        <LegacyTradeCartMove />
      </RouterProvider>,
    );
    expect(cart.added).toHaveLength(1);
  });

  it("leaves the cart alone when there's no old trade cart, or it can't be read", async () => {
    window.localStorage.setItem("gg-trade-cart", "not json");
    at("/shop", <LegacyTradeCartMove />);
    await act(async () => {});
    expect(cart.added).toEqual([]);
    expect(window.localStorage.getItem("gg-trade-cart")).toBeNull();
  });
});

/** One of our cards on a trade at `cents`. */
function wantedItemFor(id: string, cents: number) {
  return { ...customerTrade().wanted[0], id, quantity: 1, unitPriceCents: cents, status: "requested" as const };
}

describe("a trade's page", () => {
  const sheoldred = customerCard({ id: "o1", quantity: 1 });

  it("says our cards are held, and until when, while the trade is reviewed or waits to be confirmed", async () => {
    world.trade = customerTrade({
      status: "pending_review",
      hold: { stage: "review", expiresAt: "2099-01-01T17:00:00Z" },
      wanted: [{ ...customerTrade().wanted[0], status: "reserved" as const }],
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    expect(await screen.findByText(/Held for you until .* while we review your trade, so they can't sell in the meantime/)).toBeInTheDocument();
  });
  const elves = customerCard({ id: "o3", cardName: "Llanowar Elves", setCode: "DOM", collectorNumber: "168", quantity: 4, referencePriceCents: 25, estimatedUnitCents: 25, eligibility: "below_minimum" });

  it("won't send a list with a card we can't take; sends it once that's off, with a note (3)", async () => {
    const user = userEvent.setup();
    world.trade = customerTrade({ status: "awaiting_trade_list", listDueAt: "2099-01-01T05:59:59Z", estimatedValueCents: 8000, offered: [sheoldred, elves] });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const send = await screen.findByRole("button", { name: "Submit My Trade" });
    expect(send).toBeDisabled();
    expect(screen.getByText(/Send it for review by/)).toHaveTextContent("or it closes.");
    expect(screen.getByText(/These stay on sale until you send your trade; then we hold them for you while we review it/)).toBeInTheDocument();
    expect(screen.getByText(/we'll hold our cards for you for up to 12 hours while we review/)).toBeInTheDocument();
    expect(screen.getByText(/you'll have 48 hours \(not counting Sundays\) to confirm/)).toBeInTheDocument();
    expect(screen.getByText("Take off the card we can't accept.")).toBeInTheDocument();
    expect(screen.getByText(/Under our \$15\.00 minimum per card/)).toBeInTheDocument();

    world.respond = (body) => ({ status: 200, json: { ok: true, terms: TRADE_TERMS, trade: { ...world.trade, offered: body.action === "saveOffer" ? [sheoldred] : world.trade.offered } } });
    await user.click(screen.getByRole("button", { name: "Remove Llanowar Elves" }));
    await waitFor(() => expect(send).toBeEnabled());
    expect(world.posts[0].body).toEqual({
      action: "saveOffer",
      tradeId: TRADE_ID,
      cards: [{ id: "o1", scryfallId: "s1", finish: "nonfoil", condition: "NM", quantity: 1, customerEstimateCents: null, note: null }],
    });

    await user.type(screen.getByLabelText("Note for us (optional)"), "Happy to drop off in person");
    await user.click(send);
    await waitFor(() => expect(world.posts).toHaveLength(2));
    expect(world.posts[1]).toEqual({ body: { action: "submit", tradeId: TRADE_ID, note: "Happy to drop off in person" }, auth: "Bearer member-token" });
  });

  it("adds the rest of the cart to a draft, then takes those cards out of the cart (consigned copies stay)", async () => {
    const user = userEvent.setup();
    world.trade = customerTrade({ status: "awaiting_trade_list", listDueAt: "2099-01-01T05:59:59Z", offered: [sheoldred] });
    const onTrade = world.trade.wanted[0];
    fillCart(
      cartLine({ inventoryItemId: "i9", name: "Arcane Signet", quantity: 2, sellable: 4, priceCents: 2500 }),
      cartLine({ inventoryItemId: "c1", name: "Consigned Bolt", saleOnly: true }),
      // Already on the trade: not offered twice.
      cartLine({ inventoryItemId: onTrade.inventoryItemId, name: onTrade.cardName }),
    );
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    expect(await screen.findByText("You have 1 more card in your cart.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add them to this trade" }));
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toEqual({
      action: "setWanted",
      tradeId: TRADE_ID,
      items: [
        ...world.trade.wanted.filter((w) => w.status === "requested" || w.status === "reserved").map((w) => ({ inventoryItemId: w.inventoryItemId, quantity: w.quantity })),
        { inventoryItemId: "i9", quantity: 2 },
      ],
    });
    await waitFor(() => expect(cart.get().map((l) => (l as CartLine).inventoryItemId)).toEqual(["c1", onTrade.inventoryItemId]));
  });

  it("doesn't offer the cart's cards once a trade can't change", async () => {
    world.trade = customerTrade({ status: "pending_review" });
    fillCart(cartLine({ inventoryItemId: "i9", name: "Arcane Signet" }));
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    await screen.findByRole("heading", { name: "Our cards" });
    expect(screen.queryByText(/more cards? in your cart/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Add them to this trade" })).toBeNull();
  });

  it("won't send a draft under the minimum, and shows the way to it under our cards", async () => {
    world.terms = { ...TRADE_TERMS, minTradeValueCents: 7500 };
    world.trade = customerTrade({
      status: "awaiting_trade_list",
      listDueAt: "2099-01-01T05:59:59Z",
      wantedTotalCents: 6000,
      estimatedValueCents: 8000,
      wanted: [wantedItemFor("w1", 6000)],
      offered: [sheoldred],
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    expect(await screen.findByRole("button", { name: "Submit My Trade" })).toBeDisabled();
    expect(screen.getByText("Add $15 more in cards to reach the $75 minimum trade value!")).toBeInTheDocument();
    const ours = screen.getByRole("heading", { name: "Our cards" }).closest("section")!;
    expect(within(ours).getByText("Add $15 more to start your trade!")).toBeInTheDocument();
  });

  it("says how much more of theirs would cover ours only while they can still add cards", async () => {
    world.trade = customerTrade({
      status: "awaiting_trade_list",
      listDueAt: "2099-01-01T05:59:59Z",
      wantedTotalCents: 15000,
      estimatedValueCents: 15000,
      wanted: [wantedItemFor("w1", 15000)],
      offered: [sheoldred],
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    // $150 of ours takes $187.50 of theirs at 80%: $37.50 more than the $150 estimate.
    const balance = await screen.findByRole("region", { name: "Your trade" });
    expect(balance).toHaveTextContent("About $37.50 more in your cards would cover ours, or pay the rest by card at the end.");
  });

  /** "YYYY-MM-DD", `years` years before today: a printing's release date. */
  const releasedYearsAgo = (years: number) => new Date(Date.now() - years * 365.25 * 86_400_000).toISOString().slice(0, 10);
  /** Ragavan, as the public card search finds it (out 4½ years: its age never sets its condition). */
  const ragavanPrinting = (releasedAt: string | null = releasedYearsAgo(4.5)) => ({
    scryfallId: "s9",
    cardName: "Ragavan, Nimble Pilferer",
    setName: "Modern Horizons 2",
    setCode: "mh2",
    collectorNumber: "138",
    rarity: "mythic",
    imageUrl: "",
    availableFinishes: ["nonfoil", "foil"],
    treatments: [],
    scryfallPriceCents: 5200,
    releasedAt,
    prices: { usd: 5200, usdFoil: 6000, usdEtched: null },
  });
  const draftWithNoCards = () => customerTrade({ status: "awaiting_trade_list", listDueAt: "2099-01-01T05:59:59Z", estimatedValueCents: 0, offered: [] });

  it("has the customer choose each card's condition, with nothing chosen for them, and sends it", async () => {
    const user = userEvent.setup();
    world.printings = [ragavanPrinting()];
    world.trade = draftWithNoCards();
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    // The page explains it before they start.
    expect(await screen.findByText(/Choose each card’s condition as best you can\./)).toHaveTextContent(
      "we price your cards at TCG low when we review your list and check every card when it arrives, so values can go up or down.",
    );
    await user.type(screen.getByLabelText("Search for a card"), "Ragavan");
    await user.click(await screen.findByRole("button", { name: /Ragavan, Nimble Pilferer/ }));

    const pick = screen.getByText("Ragavan, Nimble Pilferer", { selector: ".gg-tc-pick__name" }).closest(".gg-tc-pick") as HTMLElement;
    const condition = within(pick).getByRole("combobox", { name: "Condition" });
    // No default, and no estimate or adding until they choose.
    expect(condition).toHaveValue("");
    expect(condition).toHaveAccessibleDescription(/Your best guess\. We check every card when it arrives; not sure\? Pick the lower one\./);
    expect(within(pick).getByRole("link", { name: "How we grade" })).toHaveAttribute("href", "/condition-guide");
    expect(pick).toHaveTextContent("Choose its condition to see an estimate.");
    expect(within(pick).getByRole("button", { name: "Add to my cards" })).toBeDisabled();
    expect(pick).not.toHaveTextContent(/years old|Printed in|card’s age/);

    await user.selectOptions(condition, "LP");
    expect(pick).toHaveTextContent(
      "Estimated $46.80 each (based on today’s market price $52.00 × 90% for Lightly Played). Final value uses TCG low once we’ve checked your cards.",
    );
    await user.selectOptions(condition, "NM");
    expect(pick).toHaveTextContent("Estimated $52.00 each (based on today’s market price $52.00).");

    await user.click(within(pick).getByRole("button", { name: "Add to my cards" }));
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toEqual({
      action: "saveOffer",
      tradeId: TRADE_ID,
      cards: [{ scryfallId: "s9", finish: "nonfoil", condition: "NM", quantity: 1 }],
    });
  });

  it("lets them change a listed card's condition, and sends the change", async () => {
    const user = userEvent.setup();
    const offered = customerCard({ id: "o1", reportedCondition: "NM" });
    world.trade = customerTrade({ status: "awaiting_trade_list", listDueAt: "2099-01-01T05:59:59Z", offered: [offered] });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const select = await screen.findByRole("combobox", { name: `Condition of ${offered.cardName}` });
    expect(select).toHaveValue(offered.reportedCondition);
    await user.selectOptions(select, "MP");
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toEqual(
      expect.objectContaining({
        action: "saveOffer",
        tradeId: TRADE_ID,
        cards: [expect.objectContaining({ id: "o1", scryfallId: offered.scryfallId, condition: "MP" })],
      }),
    );
  });

  it("takes a condition written in a pasted list, and has them choose the rest, one by one or all at once", async () => {
    const user = userEvent.setup();
    world.printings = [ragavanPrinting()];
    world.trade = draftWithNoCards();
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    await user.click(await screen.findByRole("button", { name: "Paste it or upload a CSV" }));
    await user.click(screen.getByLabelText("Paste your list"));
    await user.paste("2 Ragavan, Nimble Pilferer [MH2] 138 LP\n1 Ragavan, Nimble Pilferer [MH2] 138");
    await user.click(screen.getByRole("button", { name: "Read my list" }));

    // The list's own condition is used as written.
    const written = (await screen.findByText("2 Ragavan, Nimble Pilferer [MH2] 138 LP")).closest("li") as HTMLElement;
    expect(within(written).getByRole("combobox", { name: /^Condition of/ })).toHaveValue("LP");
    expect(written).toHaveTextContent("~$46.80 ea");
    // The other has none: nothing is assumed, and it can't be added yet.
    const blank = screen.getByText("1 Ragavan, Nimble Pilferer [MH2] 138").closest("li") as HTMLElement;
    expect(within(blank).getByRole("combobox", { name: /^Condition of/ })).toHaveValue("");
    expect(blank).not.toHaveTextContent("~$");
    await user.click(screen.getByRole("button", { name: "Add 2 cards" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose the condition of each card you've ticked.");
    expect(world.posts).toEqual([]);

    // Set the rest at once: only the one without a condition changes.
    await user.selectOptions(screen.getByRole("combobox", { name: /1 card needs a condition\. Set them all to:/ }), "MP");
    expect(within(blank).getByRole("combobox", { name: /^Condition of/ })).toHaveValue("MP");
    expect(within(written).getByRole("combobox", { name: /^Condition of/ })).toHaveValue("LP");
    await user.click(screen.getByRole("button", { name: "Add 2 cards" }));
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toEqual({
      action: "saveOffer",
      tradeId: TRADE_ID,
      cards: [
        { scryfallId: "s9", finish: "nonfoil", condition: "LP", quantity: 2 },
        { scryfallId: "s9", finish: "nonfoil", condition: "MP", quantity: 1 },
      ],
    });
  });

  it("adds up the trade in the order it's read: what it takes, the credit, the rest of our cards, shipping by card, the deposit apart", async () => {
    world.trade = customerTrade({
      status: "awaiting_shipment",
      shipBy: "2099-01-01T05:59:59Z",
      wantedTotalCents: 15000,
      approvedValueCents: 15000,
      deposit: { cents: 1000, status: "paid", reason: "threshold", paidCents: 1000, paidAt: "2026-10-25T12:00:00Z", refundRequestedAt: null, refundedAt: null },
      offered: [{ ...sheoldred, reviewStatus: "approved", approvedQuantity: 1, approvedUnitCents: 15000 }],
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const balance = await screen.findByRole("region", { name: "Your trade" });
    // $150 of ours takes $187.50 of theirs at 80%; $150 approved earns $120: $30 of our cards and $3.99 shipping by card.
    expect(balance).toHaveTextContent("Cards you want$150.00");
    expect(balance).toHaveTextContent("Your cards neededAt TCG low, to cover ours at 80% trade credit$187.50");
    expect(balance).toHaveTextContent("Your approved trade value$150.00");
    expect(balance).toHaveTextContent("Trade credit at 80%$120.00");
    expect(balance).toHaveTextContent("Remaining balanceFor our cards, after your credit$30.00");
    expect(balance).toHaveTextContent("Shipping our cards to youFree from $200 · paid by card, not credit$3.99");
    expect(balance).toHaveTextContent("You'd pay by card$33.99");
    expect(balance).toHaveTextContent("Your credit covers 80% of our cards");
    expect(balance).toHaveTextContent("Refundable depositSeparate from your trade’s value and payment$10.00Paid (refundable)");
    // Their list is sent: no suggesting more cards now.
    expect(balance).not.toHaveTextContent("more in your cards would cover ours");
  });

  it("shows our cards on their way once the trade is done, with the tracking link", async () => {
    world.trade = customerTrade({
      status: "completed",
      finalValueCents: 25000,
      finalCreditCents: 20000,
      wantedTotalCents: 20000,
      shippingCents: 0,
      amountDueCents: 0,
      creditIssuedCents: 20000,
      excessCents: 0,
      orderId: "order-2",
      shipTo: { name: "Ann Lee", line1: "1 Main St", line2: null, city: "St. Louis", state: "MO", postalCode: "63101" },
      outgoing: { status: "shipped", carrier: "USPS", tracking: "9400111899223197428490", shippedAt: "2026-10-26T15:00:00Z", deliveredAt: null },
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const settled = (await screen.findByRole("heading", { name: "How your trade settled" })).closest("section")!;
    expect(settled).toHaveTextContent("Shipping our cards to youFREE");
    const out = within(settled).getByRole("heading", { name: "Your new cards are on the way" }).parentElement!;
    expect(within(out).getByRole("link", { name: "9400111899223197428490" })).toHaveAttribute("href", expect.stringContaining("usps.com"));
  });

  it("asks for what's left after accepting: the rest of our cards and shipping, itemized", async () => {
    world.trade = customerTrade({
      status: "awaiting_payment",
      wantedTotalCents: 15000,
      finalValueCents: 18750,
      finalCreditCents: 15000,
      shippingCents: 399,
      amountDueCents: 399,
      paymentDueAt: "2099-01-01T05:59:59Z",
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const pay = (await screen.findByRole("heading", { name: "Pay $3.99 to finish" })).closest("section")!;
    expect(pay).toHaveTextContent("Your trade credit covers $150.00 of our cards.");
    expect(pay).toHaveTextContent("Left to pay for our cards$0.00");
    expect(pay).toHaveTextContent("Shipping our cards to you$3.99");
    expect(pay).toHaveTextContent("Total by card$3.99");
  });

  it("won't send a list while one of our cards has fewer copies left than picked", async () => {
    world.trade = customerTrade({
      status: "awaiting_trade_list",
      listDueAt: "2099-01-01T05:59:59Z",
      offered: [sheoldred],
      wanted: [customerTrade().wanted[0], { ...customerTrade().wanted[1], quantity: 2, available: 1 }],
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    expect(await screen.findByRole("button", { name: "Submit My Trade" })).toBeDisabled();
    expect(screen.getByText("Only 1 left: lower the quantity")).toBeInTheDocument();
    expect(screen.getByText("One of our cards has fewer copies left than you picked.")).toBeInTheDocument();
  });

  it("confirms an approved trade with no deposit once the box is ticked, agreeing to the terms version shown (6)", async () => {
    const user = userEvent.setup();
    const approved = { ...sheoldred, reviewStatus: "approved" as const, approvedQuantity: 1, approvedUnitCents: 8000 };
    world.trade = customerTrade({
      status: "awaiting_confirmation",
      approvedValueCents: 8000,
      confirmBy: "2099-01-03T20:00:00.000Z",
      approvalConditions: "Sheoldred must be Near Mint.",
      confirmation: confirmation({ confirmBy: "2099-01-03T20:00:00.000Z", shipByIfConfirmedNow: "2099-01-06T20:00:00.000Z" }),
      offered: [approved],
    });
    world.respond = (body) => ({
      status: 200,
      json: {
        ok: true,
        terms: TRADE_TERMS,
        trade: body.action === "confirm" ? { ...world.trade, status: "awaiting_shipment", confirmation: null, shipBy: "2099-01-06T20:00:00.000Z" } : world.trade,
      },
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const panel = (await screen.findByRole("heading", { name: "Confirm your trade" })).closest("section")!;
    expect(panel).toHaveTextContent("Until you do, our cards stay on sale.");
    expect(panel).toHaveTextContent("Refundable depositNone needed");
    expect(panel).toHaveTextContent("Total reserved market value$88.99");
    expect(panel).toHaveTextContent("Your trade-in cards (approved estimate)$80.00Priced at TCG low. $64.00 in trade credit.");
    expect(panel).toHaveTextContent("if you confirm now: 72 hours, Sundays don’t count");
    expect(panel).toHaveTextContent("Approved on this condition: Sheoldred must be Near Mint.");
    expect(within(panel).getByRole("heading", { name: "What confirming means" })).toBeInTheDocument();

    const go = within(panel).getByRole("button", { name: "Confirm Trade" });
    expect(go).toBeDisabled();
    await user.click(within(panel).getByRole("checkbox"));
    await user.click(go);
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0]).toEqual({ body: { action: "confirm", tradeId: TRADE_ID, acknowledged: true, termsVersion: 1 }, auth: "Bearer member-token" });
    expect(await screen.findByRole("status")).toHaveTextContent(/Confirmed! Our cards are reserved for you: ship by/);
    expect(screen.getByRole("heading", { name: "You're all set! Ship your cards to Geega Games." })).toBeInTheDocument();
  });

  it("says our cards are already held while an approved trade waits to be confirmed", async () => {
    world.trade = customerTrade({
      status: "awaiting_confirmation",
      approvedValueCents: 8000,
      confirmBy: "2099-01-03T20:00:00.000Z",
      hold: { stage: "confirmation", expiresAt: "2099-01-03T20:00:00.000Z" },
      confirmation: confirmation({ confirmBy: "2099-01-03T20:00:00.000Z", shipByIfConfirmedNow: "2099-01-06T20:00:00.000Z" }),
      offered: [{ ...sheoldred, reviewStatus: "approved" as const, approvedQuantity: 1, approvedUnitCents: 8000 }],
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const panel = (await screen.findByRole("heading", { name: "Confirm your trade" })).closest("section")!;
    expect(panel).toHaveTextContent("We're holding our cards for you until then.");
    expect(panel).not.toHaveTextContent("stay on sale");
    expect(panel).toHaveTextContent("Confirming keeps our cards reserved for you until your trade is done.");
  });

  it("explains the reservation deposit in plain words before they pay it", async () => {
    world.trade = customerTrade({
      status: "awaiting_confirmation",
      wantedTotalCents: 32000,
      approvedValueCents: 8000,
      confirmBy: "2099-01-03T20:00:00.000Z",
      deposit: { cents: 2000, status: "payment_pending", reason: "threshold", paidCents: null, paidAt: null, refundRequestedAt: null, refundedAt: null },
      confirmation: confirmation({ confirmBy: "2099-01-03T20:00:00.000Z", depositCents: 2000, depositReason: "threshold" }),
      offered: [{ ...sheoldred, reviewStatus: "approved" as const, approvedQuantity: 1, approvedUnitCents: 8000 }],
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const panel = (await screen.findByRole("heading", { name: "Confirm your trade" })).closest("section")!;
    expect(panel).toHaveTextContent(
      "We’ll reserve your selected cards once your trade is approved and your reservation deposit is paid. The deposit protects against abandoned trades and is handled according to our cancellation policy.",
    );
    // Agreeing to the terms comes before paying.
    expect(within(panel).getByRole("button", { name: "Confirm Trade & Pay Deposit" })).toBeDisabled();
  });

  it("confirms with the refundable deposit: the terms, then the card form for exactly that amount (7)", async () => {
    const user = userEvent.setup();
    const approved = { ...sheoldred, reviewStatus: "approved" as const, approvedQuantity: 1, approvedUnitCents: 8000 };
    world.trade = customerTrade({
      status: "awaiting_confirmation",
      wantedTotalCents: 32000,
      approvedValueCents: 8000,
      confirmBy: "2099-01-03T20:00:00.000Z",
      deposit: { cents: 2000, status: "payment_pending", reason: "threshold", paidCents: null, paidAt: null, refundRequestedAt: null, refundedAt: null },
      confirmation: confirmation({ confirmBy: "2099-01-03T20:00:00.000Z", depositCents: 2000, depositReason: "threshold" }),
      offered: [approved],
    });
    world.respond = (body) => ({
      status: 200,
      json:
        body.action === "confirm"
          ? { ok: true, terms: TRADE_TERMS, trade: { ...world.trade, status: "awaiting_deposit" }, clientSecret: "pi_123_secret_abc", depositCents: 2000 }
          : { ok: true, terms: TRADE_TERMS, trade: world.trade },
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const panel = (await screen.findByRole("heading", { name: "Confirm your trade" })).closest("section")!;
    expect(within(panel).getByRole("heading", { name: "Refundable Reservation Deposit" })).toBeInTheDocument();
    expect(panel).toHaveTextContent("Refundable deposit$20.00");
    expect(panel).toHaveTextContent("We review every case before keeping a deposit.");
    expect(panel).toHaveTextContent("Potential cancellation chargeUp to $20.00 (your deposit), only if you cancel after confirming and before shipping");
    expect(panel).toHaveTextContent("Declining our offer after your cards arrive never costs your deposit.");

    await user.click(within(panel).getByRole("checkbox"));
    await user.click(within(panel).getByRole("button", { name: "Confirm Trade & Pay Deposit" }));
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toEqual({ action: "confirm", tradeId: TRADE_ID, acknowledged: true, termsVersion: 1 });
    // Nothing is reserved yet: the card form for the deposit takes over.
    expect(await within(panel).findByRole("heading", { name: "Pay your $20.00 deposit" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Pay the $20.00 deposit" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Finish paying your deposit" })).toBeInTheDocument();
  });

  it("says plainly when a card sold before they confirmed, and hands the trade back", async () => {
    const user = userEvent.setup();
    world.trade = customerTrade({
      status: "awaiting_confirmation",
      approvedValueCents: 8000,
      confirmBy: "2099-01-03T20:00:00.000Z",
      confirmation: confirmation({ confirmBy: "2099-01-03T20:00:00.000Z" }),
      offered: [{ ...sheoldred, reviewStatus: "approved", approvedQuantity: 1, approvedUnitCents: 8000 }],
    });
    const notice = "Some of our cards on this trade sold before you confirmed. Nothing was reserved or charged: update your selection and send the trade again.";
    world.respond = () => ({
      status: 200,
      json: {
        ok: true,
        terms: TRADE_TERMS,
        notice,
        trade: {
          ...world.trade,
          status: "revision_requested",
          confirmation: null,
          messages: [{ id: "m1", authorType: "system", authorLabel: null, body: "Some of our cards on this trade sold before it was confirmed: The One Ring.", createdAt: "2026-10-25T12:00:00Z", visibleToCustomer: true }],
        },
      },
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const panel = (await screen.findByRole("heading", { name: "Confirm your trade" })).closest("section")!;
    await user.click(within(panel).getByRole("checkbox"));
    await user.click(within(panel).getByRole("button", { name: "Confirm Trade" }));
    expect(await screen.findByText(notice)).toHaveClass("gg-alert-warn");
    expect(screen.getByRole("heading", { name: "Some of our cards sold" }).nextElementSibling).toHaveTextContent("The One Ring");
  });

  it("picks the deposit up again after a bank check, and cleans up the address", async () => {
    world.trade = customerTrade({
      status: "awaiting_deposit",
      confirmation: confirmation({ confirmBy: "2099-01-03T20:00:00.000Z", depositCents: 2000 }),
      deposit: { cents: 2000, status: "payment_pending", reason: "threshold", paidCents: null, paidAt: null, refundRequestedAt: null, refundedAt: null },
    });
    world.respond = (body) => ({
      status: 200,
      json:
        body.action === "confirmDeposit"
          ? {
              ok: true,
              terms: TRADE_TERMS,
              paymentStatus: "succeeded",
              trade: {
                ...world.trade,
                status: "awaiting_shipment",
                confirmation: null,
                shipBy: "2099-01-06T20:00:00.000Z",
                deposit: { ...world.trade.deposit, status: "paid", paidCents: 2000, paidAt: "2026-10-25T12:00:00Z" },
              },
            }
          : { ok: true, terms: TRADE_TERMS, trade: world.trade },
    });
    at(`/account/trades/${TRADE_ID}?pay=deposit&payment_intent=pi_123&payment_intent_client_secret=pi_123_secret&redirect_status=succeeded`, <TradeDetail tradeId={TRADE_ID} />);
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toEqual({ action: "confirmDeposit", tradeId: TRADE_ID, paymentIntentId: "pi_123" });
    expect(await screen.findByText(/Deposit paid\. Our cards are reserved for you: ship by/)).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe(""));
    const deposit = screen.getByRole("heading", { name: "Refundable deposit" }).closest("section")!;
    expect(deposit).toHaveTextContent("$20.00");
    expect(deposit).toHaveTextContent("Paid (refundable)");
  });

  it("shows where and how to ship once approved, and takes a clean tracking number (5)", async () => {
    const user = userEvent.setup();
    world.trade = customerTrade({
      status: "awaiting_shipment",
      approvedValueCents: 8000,
      shipBy: "2099-01-01T05:59:59Z",
      shipDays: 3,
      mailTo: { name: "Geega Games", line1: "100 Test Ave", line2: null, city: "Ballwin", state: "MO", postalCode: "63011" },
      packingInstructions: "Sleeve them.",
      offered: [
        { ...sheoldred, reviewStatus: "approved", approvedQuantity: 1, approvedUnitCents: 8000 },
        { ...elves, reviewStatus: "rejected", approvedQuantity: 0, reviewNote: "Under our minimum" },
      ],
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    expect(await screen.findByRole("heading", { name: "You're all set! Ship your cards to Geega Games." })).toBeInTheDocument();
    expect((await screen.findByText("100 Test Ave")).closest("address")).toHaveTextContent("Geega Games100 Test AveBallwin, MO 63011");
    expect(screen.getByText(/Put your trade ID, TR-1001, on a slip of paper inside\./)).toBeInTheDocument();
    // The address and the trade ID copy in a tap (for a label site or a note), one line per line of the address.
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await user.click(screen.getByRole("button", { name: "Copy the mailing address" }));
    expect(writeText).toHaveBeenLastCalledWith("Geega Games\n100 Test Ave\nBallwin, MO 63011");
    await user.click(screen.getByRole("button", { name: "Copy your trade ID, TR-1001" }));
    expect(writeText).toHaveBeenLastCalledWith("TR-1001");
    expect(screen.getByRole("heading", { name: "Leave these out" }).nextElementSibling).toHaveTextContent("Llanowar Elves");
    // Before mailing, a card we turned down says to leave it out.
    expect(screen.getByText("Not accepted: please leave it out")).toBeInTheDocument();

    expect(screen.getByText(/Ship by/)).toHaveTextContent("72 hours, Sundays don't count");
    expect(screen.getByText(/The carrier has to scan your package by then/)).toBeInTheDocument();

    // Protecting cards in the mail: always shown while they pack, with what damage on the way means.
    const notice = screen.getByRole("complementary", { name: "Protect Your Cards During Shipping" });
    expect(notice).toHaveTextContent(
      "Please package your cards carefully! We recommend protective sleeves, rigid card protection, and a padded envelope at a minimum. All incoming trade shipments must include tracking.",
    );
    expect(notice).toHaveTextContent("For valuable shipments, consider purchasing shipping insurance.");
    expect(notice).toHaveTextContent("Your final trade value will reflect the cards received and their verified condition.");
    expect(notice).toHaveTextContent("decline it with no penalty");
    // The first-time guide: collapsed, its reminder showing; open, five steps with drawings of good packing.
    const guide = screen.getByText("New to Shipping Magic Cards? Start Here!").closest("details")!;
    expect(guide).not.toHaveAttribute("open");
    expect(guide).toHaveTextContent("Sleeve every card, add rigid protection");
    await user.click(screen.getByText("New to Shipping Magic Cards? Start Here!"));
    expect(guide).toHaveAttribute("open");
    expect(within(guide).getAllByRole("listitem").filter((li) => li.classList.contains("gg-tc-guide__step"))).toHaveLength(5);
    expect(within(guide).getByText("USPS Ground Advantage and UPS Ground both include tracking; any reputable tracked service works.")).toBeVisible();
    expect(within(guide).getByText("Rigid protection inside a padded bubble mailer")).toBeInTheDocument();
    expect(guide).toHaveTextContent("You don't need to send them to us unless we ask.");

    await user.type(screen.getByLabelText("Tracking number"), "12-34");
    await user.click(screen.getByRole("button", { name: "Add tracking number" }));
    expect(await screen.findByText("That tracking number doesn't look right. Check it and try again.")).toBeInTheDocument();
    expect(world.posts).toEqual([]);
    // A UPS number with USPS chosen: the page says so (and switches the carrier).
    await user.clear(screen.getByLabelText("Tracking number"));
    await user.type(screen.getByLabelText("Tracking number"), "1Z999AA10123456784");
    await user.click(screen.getByRole("button", { name: "Add tracking number" }));
    expect(await screen.findByText(/That looks like a UPS tracking number/)).toBeInTheDocument();
    expect(world.posts).toEqual([]);
    await user.selectOptions(screen.getByLabelText("Carrier"), "USPS");
    await user.clear(screen.getByLabelText("Tracking number"));
    await user.type(screen.getByLabelText("Tracking number"), "9400 1118 9922 3197 4284 90");
    // Not without the packaging confirmation.
    await user.click(screen.getByRole("button", { name: "Add tracking number" }));
    expect(await screen.findByText("Tick the box to confirm your cards are packaged securely and shipped with tracking.")).toBeInTheDocument();
    expect(world.posts).toEqual([]);
    await user.click(
      screen.getByLabelText(
        "I confirm that my cards are securely packaged, protected against bending and movement, and shipped using a tracked shipping service.",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Add tracking number" }));
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toEqual({
      action: "tracking",
      tradeId: TRADE_ID,
      carrier: "USPS",
      trackingNumber: "9400111899223197428490",
      packagingConfirmed: true,
      shippedOn: null,
    });
  });

  it("fixes a tracking number: a new number needs the confirmation again, a date alone doesn't", async () => {
    const user = userEvent.setup();
    world.trade = customerTrade({
      status: "tracking_submitted",
      approvedValueCents: 8000,
      shipBy: "2099-01-01T05:59:59Z",
      reservedAt: "2026-10-20T12:00:00Z",
      shipment: shipment({
        carrier: "USPS",
        tracking: "9400111899223197428490",
        trackingAddedAt: "2026-10-25T12:00:00Z",
        packagingConfirmedAt: "2026-10-25T12:00:00Z",
      }),
      offered: [{ ...sheoldred, reviewStatus: "approved", approvedQuantity: 1, approvedUnitCents: 8000 }],
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const ship = (await screen.findByRole("heading", { name: "Waiting for the carrier's first scan" })).closest("section")!;
    expect(ship).toHaveTextContent(/Packaging confirmed/);
    // Already shipped: no packing notice until they change something.
    expect(within(ship).queryByRole("complementary", { name: "Protect Your Cards During Shipping" })).toBeNull();
    await user.click(within(ship).getByRole("button", { name: "Fix the tracking number" }));
    expect(within(ship).getByRole("complementary", { name: "Protect Your Cards During Shipping" })).toBeInTheDocument();
    // The same number: no new confirmation; a ship date can be added.
    expect(within(ship).queryByLabelText(/I confirm that my cards are securely packaged/)).toBeNull();
    expect(ship).toHaveTextContent("A new tracking number needs a new confirmation.");
    await user.type(within(ship).getByLabelText("Date shipped (optional)"), "2026-10-24");
    await user.click(within(ship).getByRole("button", { name: "Update tracking" }));
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toEqual({
      action: "tracking",
      tradeId: TRADE_ID,
      carrier: "USPS",
      trackingNumber: "9400111899223197428490",
      packagingConfirmed: false,
      shippedOn: "2026-10-24",
    });
    // A different number is a replacement shipment: the confirmation is asked for again.
    await user.click(await within(ship).findByRole("button", { name: "Fix the tracking number" }));
    await user.clear(within(ship).getByLabelText("Tracking number"));
    await user.type(within(ship).getByLabelText("Tracking number"), "9400111899223197428491");
    expect(within(ship).getByLabelText(/I confirm that my cards are securely packaged/)).not.toBeChecked();
    await user.click(within(ship).getByRole("button", { name: "Update tracking" }));
    expect(await within(ship).findByText("Tick the box to confirm your cards are packaged securely and shipped with tracking.")).toBeInTheDocument();
    expect(world.posts).toHaveLength(1);
  });

  it("waits for the carrier's scan once tracking is in, takes proof of shipping, and won't cancel online", async () => {
    const user = userEvent.setup();
    world.trade = customerTrade({
      status: "tracking_submitted",
      approvedValueCents: 8000,
      shipBy: "2099-01-01T05:59:59Z",
      canSendProof: true,
      shipment: shipment({ carrier: "USPS", tracking: "9400111899223197428490", trackingAddedAt: "2026-10-25T12:00:00Z", carrierStatus: "pre_transit" }),
      offered: [{ ...sheoldred, reviewStatus: "approved", approvedQuantity: 1, approvedUnitCents: 8000 }],
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const ship = (await screen.findByRole("heading", { name: "Waiting for the carrier's first scan" })).closest("section")!;
    expect(within(ship).getByRole("link", { name: "9400111899223197428490" })).toHaveAttribute("href", expect.stringContaining("usps.com"));
    expect(ship).toHaveTextContent("We check with the carrier regularly.");
    expect(screen.getByText(/Need to cancel\? Your tracking number is on file/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel this trade" })).toBeNull();

    await user.click(within(ship).getByRole("button", { name: "Send proof of shipping" }));
    await user.type(within(ship).getByLabelText("When and where did you ship it?"), "Post office on Main, Tuesday 10 AM");
    await user.click(within(ship).getByRole("button", { name: "Send proof of shipping" }));
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toEqual({ action: "proof", tradeId: TRADE_ID, draftId: expect.stringMatching(/^[0-9a-f-]{36}$/), note: "Post office on Main, Tuesday 10 AM" });
  });

  it("asks before canceling a reserved trade with a paid deposit, and says what it may cost", async () => {
    const user = userEvent.setup();
    world.trade = customerTrade({
      status: "awaiting_shipment",
      shipBy: "2099-01-01T05:59:59Z",
      deposit: { cents: 2000, status: "paid", reason: "threshold", paidCents: 2000, paidAt: "2026-10-25T12:00:00Z", refundRequestedAt: null, refundedAt: null },
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    await user.click(await screen.findByRole("button", { name: "Cancel this trade" }));
    const form = screen.getByRole("heading", { name: "Cancel this trade?" }).closest("form")!;
    expect(form).toHaveTextContent("your $20.00 deposit may be kept under the cancellation terms you agreed to; a person reviews every case first");
    const yes = within(form).getByRole("button", { name: "Yes, cancel my trade" });
    expect(yes).toBeDisabled();
    await user.click(within(form).getByRole("checkbox"));
    await user.click(yes);
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toEqual({ action: "cancel", tradeId: TRADE_ID, reason: null, acceptDepositReview: true });
  });

  it("cancels a trade that isn't confirmed yet at no cost, without the deposit warning", async () => {
    const user = userEvent.setup();
    world.trade = customerTrade({ status: "pending_review" });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    await user.click(await screen.findByRole("button", { name: "Cancel this trade" }));
    const form = screen.getByRole("heading", { name: "Cancel this trade?" }).closest("form")!;
    expect(form).toHaveTextContent("Nothing is reserved or charged yet, so canceling costs nothing.");
    expect(within(form).queryByRole("checkbox")).toBeNull();
    await user.click(within(form).getByRole("button", { name: "Yes, cancel my trade" }));
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toEqual({ action: "cancel", tradeId: TRADE_ID, reason: null, acceptDepositReview: false });
  });

  it("lets them withdraw with no penalty once the carrier has the package", async () => {
    const user = userEvent.setup();
    world.trade = customerTrade({
      status: "in_transit",
      shipBy: "2099-01-01T05:59:59Z",
      shipment: shipment({ carrier: "USPS", tracking: "9400111899223197428490", acceptedAt: "2026-10-25T15:00:00Z", acceptanceSource: "carrier", shippedOnTime: true }),
      deposit: { cents: 2000, status: "refund_pending", reason: "threshold", paidCents: 2000, paidAt: "2026-10-24T12:00:00Z", refundRequestedAt: "2026-10-25T15:05:00Z", refundedAt: null },
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    expect(await screen.findByRole("heading", { name: "Shipment verified" })).toBeInTheDocument();
    expect(screen.getByText(/Our cards stay reserved for you while it travels/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Refundable deposit" }).closest("section")).toHaveTextContent("Refund on its way");

    await user.click(screen.getByRole("button", { name: "Cancel and get my cards back" }));
    const form = screen.getByRole("heading", { name: "Cancel and get your cards back?" }).closest("form")!;
    expect(form).toHaveTextContent("There's no penalty for canceling once the carrier has your package");
    await user.click(within(form).getByRole("button", { name: "Cancel and return my cards" }));
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toEqual({ action: "withdraw", tradeId: TRADE_ID, reason: null });
  });

  it("explains an expired reservation, the deposit under review, and takes proof of shipping until the window closes", async () => {
    world.trade = customerTrade({
      status: "expired",
      expiredStage: "shipping",
      shipBy: "2026-10-22T19:00:00.000Z",
      canSendProof: true,
      proofDueAt: "2099-01-05T19:00:00.000Z",
      closeReason: "No tracking number by the shipping deadline.",
      deposit: { cents: 2000, status: "forfeiture_review", reason: "threshold", paidCents: 2000, paidAt: "2026-10-19T12:00:00Z", refundRequestedAt: null, refundedAt: null },
      wanted: customerTrade().wanted.map((w) => ({ ...w, status: "released" as const })),
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const closed = (await screen.findByRole("heading", { name: "Your reservation expired" })).closest("div")!;
    expect(closed).toHaveTextContent("No tracking number was added by the shipping deadline");
    expect(within(closed).getByRole("button", { name: "Send proof of shipping" })).toBeInTheDocument();
    expect(closed).toHaveTextContent("(by");
    const deposit = screen.getByRole("heading", { name: "Refundable deposit" }).closest("section")!;
    expect(deposit).toHaveTextContent("Under review");
    expect(deposit).toHaveTextContent("A person reviews every case under the terms you agreed to before any deposit is kept.");
    expect(screen.getAllByText("Released back to the shop")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Start a new trade" })).toHaveAttribute("href", "/trade-cards");
  });

  it("says a trade that wasn't confirmed in time closed with nothing reserved or charged", async () => {
    world.trade = customerTrade({ status: "offer_expired", expiredStage: "confirmation" });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const closed = (await screen.findByRole("heading", { name: "This trade closed" })).closest("div")!;
    expect(closed).toHaveTextContent("This trade wasn't confirmed in time, so it closed. Nothing was reserved or charged for it.");
  });

  it("accepts the final offer to a saved address, or declines it (8, 14)", async () => {
    const user = userEvent.setup();
    world.addresses = [{ id: "addr-1", label: "Home", recipient: "Ann Lee", line1: "1 Main St", line2: null, city: "St. Louis", state: "MO", postal_code: "63101", is_default: true }];
    world.trade = customerTrade({
      status: "awaiting_final_approval",
      approvedValueCents: 8000,
      finalValueCents: 7200,
      finalCreditCents: 5760,
      offered: [{ ...sheoldred, reviewStatus: "approved", approvedQuantity: 1, approvedUnitCents: 8000, inspected: true, receivedQuantity: 1, verifiedCondition: "LP", finalQuantity: 1, finalUnitCents: 7200, inspectionNote: "Whitening on the back" }],
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const final = (await screen.findByRole("heading", { name: "Your revised offer" })).closest("section")!;
    expect(final).toHaveTextContent("1 × $80.00");
    expect(final).toHaveTextContent("1 × $72.00");
    // Before and after, the difference, and why.
    // The credit before and after, the difference, and why, in a line; then card by card.
    expect(final).toHaveTextContent("Original estimated credit$64.0080% of $80.00, approved before you shipped");
    expect(final).toHaveTextContent("Final approved credit$57.6080% of $72.00, after we checked your cards");
    expect(final).toHaveTextContent("Difference−$6.40");
    expect(final).toHaveTextContent("Reason1 card was graded Lightly Played instead of Near Mint. Each card's reason is below.");
    expect(final).toHaveTextContent("−$8.00");
    expect(final).toHaveTextContent("Condition: Lightly Played (listed as Near Mint)");
    expect(final).toHaveTextContent("Whitening on the back");
    expect(final).toHaveTextContent("You’re free to decline with no penalty");

    await user.click(within(final).getByRole("button", { name: "Accept Final Offer" }));
    await user.click(await within(final).findByRole("button", { name: "Accept and finish my trade" }));
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toEqual({ action: "accept", tradeId: TRADE_ID, addressId: "addr-1" });
    cleanup();

    world.posts = [];
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const again = (await screen.findByRole("heading", { name: "Your revised offer" })).closest("section")!;
    await user.click(within(again).getByRole("button", { name: "Decline Final Offer" }));
    expect(again).toHaveTextContent("There’s no penalty for declining, and it never affects your deposit.");
    const confirm = within(again).getAllByRole("button").find((b) => /decline/i.test(b.textContent ?? "") && b.getAttribute("type") === "submit")!;
    await user.click(confirm);
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toMatchObject({ action: "decline", tradeId: TRADE_ID });
  });

  it("shows how a finished trade settled, and what's coming back", async () => {
    world.trade = customerTrade({
      status: "approved_for_fulfillment",
      approvedValueCents: 16000,
      finalValueCents: 8000,
      finalCreditCents: 6400,
      shippingCents: 399,
      amountDueCents: 2898,
      creditIssuedCents: 6400,
      excessCents: 0,
      orderId: "order-1",
      returnCarrier: "USPS",
      returnTracking: "9400111899223197428490",
      offered: [
        { ...sheoldred, quantity: 2, reviewStatus: "approved", approvedQuantity: 2, approvedUnitCents: 8000, inspected: true, receivedQuantity: 2, finalQuantity: 1, finalUnitCents: 8000, disposition: "accepted" },
        { ...elves, reviewStatus: "rejected", approvedQuantity: 0, disposition: "rejected" },
      ],
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const settled = (await screen.findByRole("heading", { name: "How your trade settled" })).closest("section")!;
    // $64 of credit on $88.99 of our cards: $24.99 for our cards and $3.99 shipping by card.
    expect(settled).toHaveTextContent("Trade credit issued at 80%$64.00");
    expect(settled).toHaveTextContent("Credit used on our cards$64.00");
    expect(settled).toHaveTextContent("Paid by card for our cards$24.99");
    expect(settled).toHaveTextContent("Shipping our cards to you$3.99 paid by card");
    expect(within(settled).getByRole("heading", { name: "We’re packing your new cards" })).toBeInTheDocument();
    const back = within(settled).getByRole("heading", { name: "Coming back to you" }).parentElement!;
    expect(back).toHaveTextContent("1 × Sheoldred, the Apocalypse (DMU #107)");
    expect(within(back).getByRole("link", { name: "9400111899223197428490" })).toHaveAttribute("href", expect.stringContaining("usps.com"));
    // After the trade, a card we turned down doesn't still say to leave it out.
    expect(screen.getByText("Not accepted")).toBeInTheDocument();
    expect(screen.queryByText("Not accepted: please leave it out")).toBeNull();
  });

  it("is someone else's trade: not found, nothing shown", async () => {
    world.missing = true;
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("That trade isn't there.");
    expect(screen.getByRole("link", { name: "Back to your trades" })).toHaveAttribute("href", "/account/trades");
  });
});

describe("My Trades", () => {
  it("lists the customer's trades, open ones first, each linking to its page", async () => {
    world.trades = [
      customerSummary({ id: "t-old", tradeNumber: 990, status: "completed", createdAt: "2026-09-01T12:00:00Z", wantedTotalCents: 4000, wantedCount: 2, offeredCount: 3 }),
      customerSummary({
        id: "t-conf",
        tradeNumber: 1000,
        status: "awaiting_confirmation",
        confirmBy: "2099-01-03T20:00:00.000Z",
        offeredCount: 1,
        depositStatus: "payment_pending",
        depositCents: 1000,
      }),
      customerSummary({
        id: "t-new",
        tradeNumber: 1001,
        status: "awaiting_shipment",
        createdAt: "2026-10-20T12:00:00Z",
        offeredCount: 1,
        shipBy: "2099-01-01T05:59:59Z",
        depositStatus: "paid",
        depositCents: 2000,
      }),
    ];
    at("/account/trades", <MyTrades />);
    const links = await screen.findAllByRole("link", { name: /TR-/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/account/trades/t-conf", "/account/trades/t-new", "/account/trades/t-old"]);
    expect(links[0]).toHaveTextContent("Ready for your confirmation");
    expect(links[0]).toHaveTextContent("Confirm by");
    // Said before they confirm, not sprung on them.
    expect(links[0]).toHaveTextContent("Refundable deposit of $10.00 when you confirm");
    expect(links[1]).toHaveTextContent("Waiting for your shipment");
    expect(links[1]).toHaveTextContent("Ship your cards by");
    expect(links[1]).toHaveTextContent("Deposit $20.00: paid (refundable)");
    expect(links[1]).toHaveTextContent("3 of our cards ($88.99) · 1 of yours");
    expect(links[2]).toHaveTextContent("Completed");
  });

  it("invites a first trade when there are none", async () => {
    at("/account/trades", <MyTrades />);
    expect(await screen.findByText("You haven’t started a trade yet.")).toBeInTheDocument();
  });
});

describe("local pickup on the storefront", () => {
  const LOCAL_TERMS = TRADE_TERMS;

  it("offers local pickup when trading toward the cart: no shipping, what to bring, and starts a local trade", async () => {
    const user = userEvent.setup();
    fillCart(cartLine());
    world.respond = () => ({ status: 200, json: { ok: true, terms: LOCAL_TERMS, trade: customerTrade({ id: "new-local", handoffMethod: "local" }) } });
    at("/trade-cards", <TradeCardsPage />);
    const panel = await usePanel();
    expect(within(panel).getByRole("group", { name: "How do you want to trade?" })).toBeInTheDocument();
    expect(within(panel).getByRole("radio", { name: /Ship my cards/ })).toBeChecked();
    await user.click(within(panel).getByRole("radio", { name: /Local pickup/ }));
    expect(panel).toHaveTextContent("Meet us in the St. Louis area");
    expect(panel).toHaveTextContent("ShippingYou pick our cards up when we meetNone");
    expect(within(panel).getByText("$99.99").closest("p")).toHaveTextContent("To cover our cards, bring about $99.99 of your cards at TCG low");
    expect(panel).toHaveTextContent("we hold these for you for up to 12 hours while we review it, then until we meet.");
    // The FAQ answers it too.
    expect(screen.getByText("Can I trade in person?")).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Continue: tell us what you're trading" }));
    await waitFor(() => expect(window.location.pathname).toBe("/account/trades/new-local"));
    expect(world.posts[0].body).toEqual({ action: "start", items: [{ inventoryItemId: "i1", quantity: 1 }], handoffMethod: "local" });
  });

  it("shows local pickup's own rate, per-card minimum and minimum trade once it's chosen", async () => {
    const user = userEvent.setup();
    world.terms = {
      ...TRADE_TERMS,
      localCreditRatePercent: 90,
      localMinCardValueCents: 500,
      localMinTradeValueCents: 10000,
      localCashPayoutEnabled: true,
    };
    fillCart(cartLine());
    at("/trade-cards", <TradeCardsPage />);
    const panel = await usePanel();
    const lead = () => document.querySelector(".gg-tc-cartpage__lead")?.textContent ?? "";
    const staples = () => document.querySelector(".gg-tc-staples")?.textContent ?? "";
    const startButton = () => within(panel).getByRole("button", { name: "Continue: tell us what you're trading" });
    // Shipping: shipping's terms.
    expect(lead()).toContain("80% of that");
    expect(staples()).toContain("$15+");
    expect(startButton()).toBeEnabled();

    await user.click(within(panel).getByRole("radio", { name: /Local pickup/ }));
    expect(lead()).toContain("90% of that");
    expect(staples()).toContain("$5+");
    expect(panel).toHaveTextContent("Eligible cards earn 90% of their TCG low value");
    expect(panel).toHaveTextContent("At 90% trade credit");
    expect(panel).toHaveTextContent("or take cash for it, at a lower rate");
    // $79.99 of our cards is under local pickup's $100 minimum.
    expect(startButton()).toBeDisabled();
    expect(panel).toHaveTextContent("Add $20.01 more in cards to reach the $100 minimum trade value!");
    // How trading works follows the choice, with local pickup's own numbers.
    const how = screen.getByRole("region", { name: "How trading works" });
    expect(within(how).getByRole("tab", { name: "Local pickup" })).toHaveAttribute("aria-selected", "true");
    const tab = within(how).getByRole("tabpanel");
    expect(tab).toHaveTextContent("Local trades start at $100 of our cards. There’s no shipping.");
    expect(tab).toHaveTextContent("staples valued at $5 or more each at TCG low");
    expect(tab).toHaveTextContent("you receive 90% as trade credit");
    expect(tab).toHaveTextContent("(or take it in cash, at a lower rate)");
    expect(screen.getByText(/Anything your 90% trade credit doesn't cover/)).toBeInTheDocument();
  });

  it("shows the meeting spot, with directions, when local pickup is chosen", async () => {
    const user = userEvent.setup();
    world.terms = { ...TRADE_TERMS, localMeetSpotName: "Ballwin Library", localMeetSpotAddress: "1600 Clarkson Rd, Ballwin, MO" };
    fillCart(cartLine());
    at("/trade-cards", <TradeCardsPage />);
    const panel = await usePanel();
    expect(panel).toHaveTextContent("Meet us at Ballwin Library.");
    expect(within(panel).queryByRole("link", { name: /Get directions/ })).toBeNull();
    await user.click(within(panel).getByRole("radio", { name: /Local pickup/ }));
    expect(panel).toHaveTextContent("Where we meetBallwin Library1600 Clarkson Rd, Ballwin, MO");
    expect(within(panel).getByRole("link", { name: /Get directions/ })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=Ballwin%20Library%2C%201600%20Clarkson%20Rd%2C%20Ballwin%2C%20MO",
    );
    expect(screen.getByText(/at our meeting spot, Ballwin Library, 1600 Clarkson Rd, Ballwin, MO/)).toBeInTheDocument();
  });

  it("doesn't offer local pickup while it's off", async () => {
    world.terms = { ...TRADE_TERMS, localPickupEnabled: false };
    fillCart(cartLine());
    at("/trade-cards", <TradeCardsPage />);
    const panel = await usePanel();
    expect(panel).toHaveTextContent("Our cards (1)$79.99");
    expect(within(panel).queryByRole("group", { name: "How do you want to trade?" })).toBeNull();
    expect(screen.queryByText("Can I trade in person?")).toBeNull();
  });

  it("sends a local draft without listing their cards, and can switch it to shipping", async () => {
    const user = userEvent.setup();
    world.trade = customerTrade({ status: "awaiting_trade_list", handoffMethod: "local", listDueAt: "2099-01-01T05:59:59Z", estimatedValueCents: 0, offered: [] });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const send = await screen.findByRole("button", { name: "Submit My Trade" });
    expect(send).toBeEnabled();
    expect(screen.getByRole("heading", { level: 2, name: "Send your trade for review" })).toBeInTheDocument();
    expect(screen.getByText(/Bring them when we meet/)).toBeInTheDocument();
    expect(screen.queryByText("Add the cards you're trading in.")).toBeNull();
    const steps = screen.getByRole("list", { name: "Trade progress" });
    expect(within(steps).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Our cards", "Review", "Meet up", "Done"]);
    // Nothing to confirm on a local trade: approving holds our cards.
    expect(screen.getByText(/These stay on sale until you send your trade; then we hold them for you while we review it/)).toBeInTheDocument();
    expect(screen.getByText(/Once approved, we hold them until we meet/)).toBeInTheDocument();
    expect(screen.getByText(/Once we approve your trade, we hold our cards for you and set up where and when to meet/)).toBeInTheDocument();
    const balance = screen.getByRole("region", { name: "Your trade" });
    expect(balance).toHaveTextContent("Local pickup");
    expect(balance).toHaveTextContent("Your cards to bring");

    await user.type(screen.getByLabelText(/Note for us \(optional\): when you're free/), "Weekends");
    await user.click(send);
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toEqual({ action: "submit", tradeId: TRADE_ID, note: "Weekends" });

    await user.click(screen.getByRole("radio", { name: /Ship my cards/ }));
    await waitFor(() => expect(world.posts).toHaveLength(2));
    expect(world.posts[1].body).toEqual({ action: "setHandoff", tradeId: TRADE_ID, handoffMethod: "ship" });
  });

  it("confirms a local trade: no deposit, how long we hold our cards, and agreeing to meet", async () => {
    const user = userEvent.setup();
    world.trade = customerTrade({
      status: "awaiting_confirmation",
      handoffMethod: "local",
      confirmBy: "2099-01-01T05:59:59.000Z",
      meetupDetails: "Saturday 2 PM at the Ballwin library",
      confirmation: confirmation({ confirmBy: "2099-01-01T05:59:59.000Z", local: true, shipDays: 7, termsText: "Confirming holds our cards for 7 days.\n\nThere's no deposit." }),
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const panel = (await screen.findByRole("heading", { name: "Confirm your trade" })).closest("section")!;
    expect(panel).toHaveTextContent("No shipping and no deposit");
    expect(panel).toHaveTextContent("We hold our cards until");
    expect(panel).toHaveTextContent("Saturday 2 PM at the Ballwin library");
    expect(panel).toHaveTextContent("Confirming holds our cards for 7 days.");
    const go = within(panel).getByRole("button", { name: "Confirm Trade" });
    expect(go).toBeDisabled();
    await user.click(within(panel).getByRole("checkbox", { name: /I’ll meet you to trade by/ }));
    await user.click(go);
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toEqual({ action: "confirm", tradeId: TRADE_ID, acknowledged: true, termsVersion: 1 });
  });

  it("shows the meetup once our cards are reserved, with nothing to ship", async () => {
    world.trade = customerTrade({
      status: "awaiting_shipment",
      handoffMethod: "local",
      shipBy: "2099-01-01T05:59:59.000Z",
      meetupDetails: "Saturday 2 PM at the Ballwin library",
      shipment: shipment(),
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const panel = (await screen.findByRole("heading", { name: "Let’s meet up" })).closest("section")!;
    // Held until we meet: no deadline (one an older trade carries is ignored), so nothing to ask more time for.
    expect(panel).toHaveTextContent("Our cards are held for you until we meet.");
    expect(panel).not.toHaveTextContent("2099");
    expect(panel).not.toHaveTextContent(/left\)/);
    expect(within(panel).queryByRole("button", { name: /more time/i })).toBeNull();
    expect(panel).toHaveTextContent("Saturday 2 PM at the Ballwin library");
    expect(panel).toHaveTextContent("The cards you’re trading in");
    expect(screen.getByRole("heading", { level: 2, name: "Reserved: let's meet up" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Tracking number/i)).toBeNull();
    expect(screen.getByText("Reserved for you until we meet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel this trade" })).toBeInTheDocument();
  });

  it("shows how a local trade settled in person", async () => {
    world.trade = customerTrade({
      status: "completed",
      handoffMethod: "local",
      wantedTotalCents: 8899,
      finalValueCents: 5000,
      finalCreditCents: 4000,
      creditIssuedCents: 4000,
      amountDueCents: 4899,
      localPaidCents: 4899,
      localPaymentMethod: "cash",
      excessCents: 0,
      metAt: "2026-10-31T19:00:00.000Z",
      offered: [customerCard({ id: "o1", quantity: 1, finalQuantity: 1, finalUnitCents: 5000, verifiedCondition: "LP", inspected: true })],
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const settled = (await screen.findByRole("heading", { name: "How your trade settled" })).closest("section")!;
    expect(settled).toHaveTextContent("You took our cards with you.");
    expect(settled).toHaveTextContent("Your cards we took$50.00");
    expect(settled).toHaveTextContent("Paid when we met (cash)$48.99");
    expect(settled).toHaveTextContent("1 × Sheoldred, the Apocalypse");
    expect(settled).not.toHaveTextContent("Shipping");
    expect(screen.getByText("Yours: you picked them up when we met.")).toBeInTheDocument();
  });

  it("marks local trades in My Trades, held until we meet (no deadline, even one an older trade carries)", async () => {
    world.trades = [customerSummary({ id: "t-l", status: "awaiting_shipment", handoffMethod: "local", shipBy: "2099-01-01T05:59:59Z" })];
    at("/account/trades", <MyTrades />);
    const [link] = await screen.findAllByRole("link", { name: /TR-/ });
    expect(link).toHaveTextContent("Reserved: let's meet up");
    expect(link).toHaveTextContent("Let's meet up");
    expect(link).not.toHaveTextContent("Meet up by");
    expect(link).toHaveTextContent("· local pickup");
  });
});
