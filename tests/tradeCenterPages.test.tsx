// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CustomerTrade, CustomerTradeSummary, TradeTerms } from "../src/store/lib/tradeCenter";
import type { CatalogCard } from "../src/store/lib/useCatalog";
import { TRADE_ID, TRADE_TERMS, confirmation, customerCard, customerSummary, customerTrade, shipment } from "./helpers/tradeFixtures";

// The storefront's Trade Center: the Trade Cards page and its trade cart,
// "Add to trade" on card pages, a trade's own page at each step (building
// it, confirming with or without the refundable deposit, shipping and
// tracking, proof of shipping, canceling, the final offer, how it settled,
// an expired reservation, coming back from a bank check), and My Trades.
// The real API client runs; fetch is the stand-in for /api/trade-center, so
// these tests see exactly what's sent and with whose session. Stripe's card
// form is a stand-in (card details never reach our pages anyway).

const world = vi.hoisted(() => ({
  session: "member-token" as string | null,
  addresses: [] as Record<string, unknown>[],
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

vi.mock("../src/supabase", () => {
  const chain = {
    select: () => chain,
    order: () => chain,
    eq: () => chain,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: world.addresses, error: null }).then(resolve),
  };
  return {
    isSupabaseConfigured: true,
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: world.session ? { access_token: world.session } : null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      from: () => chain,
      rpc: async (name: string) => (name === "get_card_detail" ? { data: CARD_DETAIL, error: null } : { data: null, error: null }),
    },
  };
});

vi.mock("../src/store/lib/AuthContext", () => ({
  useAuth: () => ({ user: world.session ? { id: "ann", email: "ann@example.com" } : null, loading: false, signOut: async () => {} }),
}));
vi.mock("../src/store/lib/CartContext", () => ({ useCart: () => ({ addItem: async () => {} }) }));
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
      // On deal: trades use the price before the discount.
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
const { resetTradeCartForTests } = await import("../src/store/lib/tradeCart");
const { default: TradeCardsPage } = await import("../src/store/pages/TradeCardsPage");
const { default: TradeDetail } = await import("../src/store/components/trades/TradeDetail");
const { default: MyTrades } = await import("../src/store/components/trades/MyTrades");
const { default: CardDetailPage } = await import("../src/store/pages/CardDetailPage");
const { default: ProductCard } = await import("../src/store/components/ProductCard");
const { TradeCartProgress } = await import("../src/store/components/trades/TradeCartProgress");

function at(path: string, ui: React.ReactNode) {
  window.history.replaceState({}, "", path);
  return render(<RouterProvider>{ui}</RouterProvider>);
}

const CART_ITEM = {
  inventoryItemId: "i1",
  cardName: "The One Ring",
  setCode: "LTR",
  setName: "The Lord of the Rings",
  collectorNumber: "246",
  condition: "NM",
  finish: "nonfoil",
  imageUrl: null,
  quantity: 1,
  maxQuantity: 1,
  tradePriceCents: 7999,
  cardPath: "/shop/card/the-one-ring",
};

beforeEach(() => {
  window.localStorage.clear();
  resetTradeTermsForTests();
  resetTradeCartForTests();
  world.session = "member-token";
  world.addresses = [];
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

describe("the Trade Cards page (1)", () => {
  /** The cart's cards, the summary beside them, and how trading works, once the terms have loaded. */
  async function openCart() {
    at("/trade-cards", <TradeCardsPage />);
    await screen.findByRole("heading", { level: 1, name: "Your trade cart" });
    const how = await screen.findByRole("region", { name: "How trading works" });
    await waitFor(() => expect(how).toHaveTextContent("You receive 80% of your cards’ final TCG low"));
    return how;
  }

  it("is a trade cart: our cards, what of theirs it takes at TCG low, and starting the trade as the signed-in customer", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("gg-trade-cart", JSON.stringify([CART_ITEM]));
    world.respond = () => ({ status: 200, json: { ok: true, terms: TRADE_TERMS, trade: customerTrade({ id: "new-trade" }) } });
    await openCart();
    // What the page is, in a line.
    expect(screen.getByText(/We price your cards at TCG low, and you get 80% of that as trade credit toward ours\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Your trades" })).toHaveAttribute("href", "/account/trades");

    const items = screen.getByRole("region", { name: "Cards you want (1)" });
    expect(items).toHaveTextContent("The One Ring");
    expect(within(items).getByRole("link", { name: "Add more cards" })).toHaveAttribute("href", "/shop");
    expect(items).toHaveTextContent("Trade prices are our regular prices");

    const summary = screen.getByRole("complementary", { name: "Trade summary" });
    expect(summary).toHaveTextContent("Our cards (1)$79.99");
    // $79.99 of our cards at 80% trade credit takes $99.99 of theirs, at TCG low.
    expect(within(summary).getByText("$99.99").closest("p")).toHaveTextContent("To cover our cards, trade in $99.99 of your cards at TCG low");
    expect(summary).toHaveTextContent("At 80% trade credit. Trade in less and pay the rest by card, or more and keep the extra as store credit.");
    // Starting holds nothing: sending does.
    expect(summary).toHaveTextContent("Starting a trade doesn’t hold these yet: they stay on sale until you send your trade for review.");

    await user.click(within(summary).getByRole("button", { name: "Start my trade" }));
    await waitFor(() => expect(window.location.pathname).toBe("/account/trades/new-trade"));
    expect(world.posts).toEqual([{ body: { action: "start", items: [{ inventoryItemId: "i1", quantity: 1 }], handoffMethod: "ship" }, auth: "Bearer member-token" }]);
    expect(JSON.parse(window.localStorage.getItem("gg-trade-cart") ?? "null")).toEqual([]);
  });

  it("explains trading by mail and in person, in tabs", async () => {
    const user = userEvent.setup();
    const how = await openCart();
    expect(how).toHaveTextContent("Trade by mail, or in person in the St. Louis area.");
    const ship = within(how).getByRole("tab", { name: "Ship your cards" });
    const local = within(how).getByRole("tab", { name: "Local pickup" });
    expect(ship).toHaveAttribute("aria-selected", "true");
    await user.click(local);
    const panel = within(how).getByRole("tabpanel", { name: "Local pickup" });
    expect(within(panel).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Choose our cards. Add singles from our shop to your trade cart. There’s no shipping.",
      "Select local pickup. Choose Local pickup in your trade summary and submit your trade. You don’t need to list your cards in advance, though you’re welcome to add a note about what you plan to bring.",
      "We review your trade. Sending it takes our cards off sale and holds them for you while we review, and once we approve, until we meet: there’s nothing to confirm, and no deposit. We email you as soon as your trade is approved.",
      "We set up the meetup. We message you on your trade page to schedule a time to meet in the St. Louis area. Changed your mind about one of our cards? Tell us and we’ll take it off. Can’t make it? Cancel at no cost so we can put our cards back on sale.",
      "Meet and settle. Bring your cards: staples valued at $15 or more each at TCG low. We review each card together, price it at its TCG low for its condition, and you receive 80% as trade credit. Pay any remaining balance in cash or by card, or keep leftover credit for a future order. You leave with our cards the same day.",
    ]);
    // Cards are graded together in person: no age table for local pickup.
    expect(within(how).queryByRole("table")).toBeNull();
    // Arrow keys move between the tabs.
    await user.keyboard("{ArrowLeft}");
    expect(ship).toHaveFocus();
    expect(ship).toHaveAttribute("aria-selected", "true");
    expect(within(how).getByRole("table", { name: /Based on when/ })).toBeInTheDocument();
  });

  it("starts empty, with the way to the shop and how trading works", async () => {
    const how = await openCart();
    expect(screen.getByRole("heading", { level: 2, name: "Your trade cart is empty" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse cards to trade for" })).toHaveAttribute("href", "/shop");
    expect(screen.queryByRole("complementary", { name: "Trade summary" })).toBeNull();
    expect(screen.queryByRole("button", { name: /start my trade/i })).toBeNull();
    expect(how).toBeInTheDocument();
  });

  it("explains trading in short steps: the list priced at TCG low when we review it, conditions from each card's age, and values that can change when the cards arrive", async () => {
    const how = await openCart();
    const steps = within(how).getAllByRole("listitem").map((li) => li.textContent);
    expect(steps).toEqual([
      "Choose our cards. Add singles from our shop to your trade cart. Shipping is free on $200 or more of our cards.",
      "Submit your trade list. Start your trade, then add the cards you’re trading in by searching for each one or pasting a list. We accept staples valued at $15 or more each at TCG low. Each card’s condition is assigned from its printing’s age, and you’ll see an estimated value as you go.",
      "We review your trade. Once you send it, our cards are held for you, so no one else can buy them while we review. We price each card at its TCG low (the lowest listed price on TCGplayer) for its condition, and email you as soon as your trade is approved.",
      "Confirm and ship. Confirm within 2 days to keep our cards; trades of $300 or more require a refundable deposit. Then ship your cards with tracking within 3 days. Sundays don’t count toward either deadline.",
      "We inspect your cards. When your cards arrive, we verify each one’s condition. A card’s value may go up or down, and every change is itemized with the reason.",
      "Accept your final offer. You receive 80% of your cards’ final TCG low as trade credit. Pay any remaining balance by card or keep leftover credit for a future order, and we ship our cards to you. If you decline, we return your cards with no penalty.",
    ]);
    // How a card's age sets the condition it's listed at.
    const ages = within(how).getByRole("table", { name: /Based on when the card’s printing was released/ });
    expect(within(ages).getAllByRole("row").slice(1).map((r) => r.textContent)).toEqual([
      "Under 3 years oldNear Mint",
      "3 to 10 years oldLightly Played",
      "10 to 20 years oldModerately Played",
      "20 years or olderHeavily Played",
    ]);
    // The FAQ says the same.
    expect(screen.getByText("How do you decide my cards' condition?")).toBeInTheDocument();
    expect(
      screen.getByText(
        /From when each printing came out: Near Mint under 3 years old, Lightly Played 3 to 10 years, Moderately Played 10 to 20 years, Heavily Played 20 years or older\. When your cards arrive we check every one/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/we price each of your cards at its TCG low \(TCGplayer's lowest listed price\) for its condition and finish\. Your trade credit is 80% of that\./)).toBeInTheDocument();
    expect(screen.getByText(/One in better shape than listed is worth more, and one in worse shape is worth less/)).toBeInTheDocument();
    // No minimum set: the page doesn't advertise a $0 one.
    expect(screen.getByText(/^Not right now: a trade can be any amount of our cards\./)).toBeInTheDocument();
    expect(how).not.toHaveTextContent("$0");
  });

  it("explains reservations, the confirmation and shipping windows and the deposit, from the settings", async () => {
    await openCart();
    // The worked example is a real deadline: 3 qualifying days from Friday 2 PM skips Sunday.
    expect(screen.getByText(/confirm on a Friday at 2 PM and you'd ship by Tuesday at 2 PM/)).toBeInTheDocument();
    expect(screen.getByText(/Once we approve it you have 48 hours to confirm \(Sundays don't count\)/)).toBeInTheDocument();
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

  it("doesn't advertise a deposit while deposits are off", async () => {
    world.terms = { ...TRADE_TERMS, depositsEnabled: false };
    const how = await openCart();
    expect(screen.queryByText("The refundable deposit")).toBeNull();
    expect(how).not.toHaveTextContent("deposit");
    expect(screen.getByText(/Not right now\. If a trade ever needs one/)).toBeInTheDocument();
  });

  it("sends someone who isn't signed in to sign in first, and back", async () => {
    const user = userEvent.setup();
    world.session = null;
    window.localStorage.setItem("gg-trade-cart", JSON.stringify([CART_ITEM]));
    at("/trade-cards", <TradeCardsPage />);
    await user.click(await screen.findByRole("button", { name: "Sign in to start my trade" }));
    expect(window.location.pathname).toBe("/login");
    expect(window.location.search).toBe("?next=%2Ftrade-cards");
    expect(world.posts).toEqual([]);
    expect(screen.queryByRole("link", { name: "Your trades" })).toBeNull();
  });

  it("says when new trades are paused, and won't start one", async () => {
    world.terms = { ...TRADE_TERMS, paused: true, pauseMessage: "Back after the holidays." };
    window.localStorage.setItem("gg-trade-cart", JSON.stringify([CART_ITEM]));
    at("/trade-cards", <TradeCardsPage />);
    expect((await screen.findAllByText("Back after the holidays.")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /start my trade/i })).toBeNull();
  });

  it("won't start a trade under the minimum, and follows the cart: the minimum, free shipping and the TCG low it takes", async () => {
    const user = userEvent.setup();
    world.terms = { ...TRADE_TERMS, minTradeValueCents: 7500 };
    const signet = { ...CART_ITEM, inventoryItemId: "i2", cardName: "Arcane Signet", quantity: 2, maxQuantity: 9, tradePriceCents: 2500 };
    window.localStorage.setItem("gg-trade-cart", JSON.stringify([signet]));
    await openCart();
    const summary = screen.getByRole("complementary", { name: "Trade summary" });
    const copies = (n: number) => user.selectOptions(screen.getByLabelText("How many Arcane Signet"), String(n));
    const need = () => within(summary).getByText(/^To cover our cards, trade in/).closest("p");
    // $50 of our cards: browse and add freely, but not start. It takes $62.50 of theirs at TCG low.
    expect(within(summary).getByText("Add $25 more to start your trade!")).toBeInTheDocument();
    expect(within(summary).getByText("Add $25 more in cards to reach the $75 minimum trade value!")).toBeInTheDocument();
    expect(within(summary).getByRole("button", { name: "Start my trade" })).toBeDisabled();
    expect(need()).toHaveTextContent("To cover our cards, trade in $62.50 of your cards at TCG low");
    // Shipping our cards is its own line, apart from shipping theirs to us.
    expect(summary).toHaveTextContent("Shipping our cards to youTracked, free from $200 · paid by card when your trade is final$3.99");
    expect(screen.getByText(/You ship your cards to us separately, with tracking, at your cost\./)).toBeInTheDocument();
    // $100: past the minimum, $100 from free shipping.
    await copies(4);
    expect(screen.getByRole("region", { name: "Cards you want (4)" })).toBeInTheDocument();
    expect(within(summary).getByText("You’re $100 away from FREE shipping!")).toBeInTheDocument();
    expect(within(summary).getByText("Your trade meets the minimum value requirement!")).toBeInTheDocument();
    expect(within(summary).getByRole("button", { name: "Start my trade" })).toBeEnabled();
    expect(within(summary).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(need()).toHaveTextContent("trade in $125.00 of your cards at TCG low");
    expect(summary).toHaveTextContent("Our cards (4)$100.00");
    // $175: nearly there. $200: free.
    await copies(7);
    expect(within(summary).getByText("Add just $25 more to unlock FREE shipping!")).toBeInTheDocument();
    await copies(8);
    expect(within(summary).getByText("Your trade qualifies for FREE tracked shipping!")).toBeInTheDocument();
    expect(summary).toHaveTextContent("Shipping our cards to youTracked, on usFREE");
    expect(need()).toHaveTextContent("trade in $250.00 of your cards at TCG low");
    // The bar doesn't repeat the shipping line in the summary.
    expect(within(summary).queryByText(/^Shipping:/)).toBeNull();
    // Back under the minimum: the start is off again.
    await copies(1);
    expect(within(summary).getByRole("button", { name: "Start my trade" })).toBeDisabled();
    expect(world.posts).toEqual([]);
  });

  it("spells out the minimum, shipping and the processing fee from the settings", async () => {
    world.terms = { ...TRADE_TERMS, minTradeValueCents: 7500, processingFeeCents: 200 };
    window.localStorage.setItem("gg-trade-cart", JSON.stringify([CART_ITEM]));
    const how = await openCart();
    expect(how).toHaveTextContent("Trades start at $75 of our cards. Shipping is free on $200 or more of our cards.");
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
    const summary = screen.getByRole("complementary", { name: "Trade summary" });
    expect(summary).toHaveTextContent("To cover our cards, trade in $102.49 of your cards at TCG low");
    expect(summary).toHaveTextContent("At 80% trade credit, after the $2.00 processing fee.");
    expect(screen.getByText(/Yes: at least \$75 of our cards per trade/)).toHaveTextContent("takes $96.25 of your cards at TCG low to cover completely");
  });

  it("shows the start's refusal in its own words", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("gg-trade-cart", JSON.stringify([CART_ITEM]));
    world.respond = () => ({ status: 409, json: { ok: false, message: "Only 0 of The One Ring available." } });
    at("/trade-cards", <TradeCardsPage />);
    await user.click(await screen.findByRole("button", { name: "Start my trade" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only 0 of The One Ring available.");
    expect(JSON.parse(window.localStorage.getItem("gg-trade-cart") ?? "[]")).toHaveLength(1);
  });
});

describe("Add to trade on a card page", () => {
  it("puts the copy in the trade cart at its regular price, never the deal price", async () => {
    const user = userEvent.setup();
    world.terms = { ...TRADE_TERMS, minTradeValueCents: 7500 };
    at("/shop/card/sheoldred-the-apocalypse", <CardDetailPage slug="sheoldred-the-apocalypse" />);
    await screen.findByRole("heading", { level: 1, name: "Sheoldred, the Apocalypse" });
    expect(await screen.findByText("Trades at $80.00")).toBeInTheDocument();
    // Nothing in the trade cart yet: no bar.
    expect(screen.queryByRole("progressbar")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add to trade" }));
    expect(screen.getByRole("button", { name: "In your trade ✓" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View trade" })).toHaveAttribute("href", "/trade-cards");
    // The bar follows the cart: $80 is past the $75 minimum, $120 short of free shipping.
    expect(screen.getByText("You’re $120 away from FREE shipping!")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Our cards toward free shipping" })).toHaveAttribute("aria-valuenow", "80");
    // And what it takes of theirs: $80 at 80% trade credit is $100 at TCG low.
    expect(screen.getByText(/to cover ours/)).toHaveTextContent("Trade in $100.00 of your cards at TCG low to cover ours (80% trade credit)");
    expect(screen.getByRole("link", { name: "Review your trade" })).toHaveAttribute("href", "/trade-cards#trade-cart");
    expect(JSON.parse(window.localStorage.getItem("gg-trade-cart") ?? "[]")).toEqual([
      expect.objectContaining({ inventoryItemId: "listing-1", tradePriceCents: 8000, maxQuantity: 2, quantity: 1 }),
    ]);
  });

  it("isn't offered while trading is paused", async () => {
    world.terms = { ...TRADE_TERMS, paused: true };
    at("/shop/card/sheoldred-the-apocalypse", <CardDetailPage slug="sheoldred-the-apocalypse" />);
    await screen.findByRole("heading", { level: 1, name: "Sheoldred, the Apocalypse" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Add to trade" })).toBeNull();
  });
});

describe("Add to trade on the shop's cards", () => {
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
  const bolt = (over: Partial<CatalogCard> = {}) =>
    shopCard({ id: "inv-2", oracleId: "o-bolt", name: "Lightning Bolt", set: "2xm", setName: "Double Masters", collectorNumber: "117", priceCents: 250, isDeal: false, originalPriceCents: null, dealDiscountPercent: null, dealSource: null, ...over });

  it("adds a card to the trade cart at its regular price, then leads to the cart", async () => {
    const user = userEvent.setup();
    world.terms = { ...TRADE_TERMS, minTradeValueCents: 7500 };
    at(
      "/shop",
      <>
        <TradeCartProgress />
        <ProductCard card={shopCard()} />
        <ProductCard card={bolt()} />
      </>,
    );
    const add = await screen.findByRole("button", { name: "Add to trade: Sheoldred, the Apocalypse" });
    expect(add).toHaveTextContent(/^Add to trade$/);
    // Deals don't apply to trades: the deal card says what it trades at; the other doesn't need to.
    expect(screen.getAllByText(/^Trades at/)).toHaveLength(1);
    expect(add).toHaveAccessibleDescription("Trades at $80.00");
    expect(screen.getByRole("button", { name: "Add to trade: Lightning Bolt" })).not.toHaveAccessibleDescription();
    // Nothing in the trade cart yet: no progress.
    expect(screen.queryByRole("progressbar")).toBeNull();

    await user.click(add);

    const inTrade = screen.getByRole("link", { name: "In your trade: Sheoldred, the Apocalypse. Review your trade" });
    expect(inTrade).toHaveTextContent("In your trade ✓");
    expect(inTrade).toHaveAttribute("href", "/trade-cards#trade-cart");
    // The button became the link: focus stays on it.
    expect(inTrade).toHaveFocus();
    expect(JSON.parse(window.localStorage.getItem("gg-trade-cart") ?? "[]")).toEqual([
      expect.objectContaining({
        inventoryItemId: "inv-1",
        cardName: "Sheoldred, the Apocalypse",
        setCode: "dmu",
        condition: "NM",
        finish: "nonfoil",
        tradePriceCents: 8000,
        maxQuantity: 2,
        quantity: 1,
        cardPath: "/shop/card/sheoldred-the-apocalypse",
      }),
    ]);
    // The other card is untouched, and the progress above the grid follows the cart: $80 is past the $75 minimum.
    expect(screen.getByRole("button", { name: "Add to trade: Lightning Bolt" })).toBeInTheDocument();
    expect(screen.getByText("You’re $120 away from FREE shipping!")).toBeInTheDocument();
    expect(screen.getByText(/to cover ours/)).toHaveTextContent("Trade in $100.00 of your cards at TCG low to cover ours (80% trade credit)");
    expect(screen.getByText(/^Shipping:/)).toHaveTextContent("Shipping: $3.99");
    expect(screen.getByRole("link", { name: "Review your trade" })).toHaveAttribute("href", "/trade-cards#trade-cart");
  });

  it("shows a card that's already in the trade cart as in it", async () => {
    window.localStorage.setItem("gg-trade-cart", JSON.stringify([{ ...CART_ITEM, inventoryItemId: "inv-1", cardName: "Sheoldred, the Apocalypse" }]));
    at("/shop", <ProductCard card={shopCard()} />);
    expect(await screen.findByRole("link", { name: "In your trade: Sheoldred, the Apocalypse. Review your trade" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Add to trade/ })).toBeNull();
  });

  it("isn't offered for a card that's sold out or not for sale", async () => {
    at(
      "/shop",
      <>
        <ProductCard card={bolt()} />
        <ProductCard card={shopCard({ id: "inv-3", name: "Sold Out Sheoldred", quantity: 0 })} />
        <ProductCard card={bolt({ id: "inv-4", name: "Unpriced Bolt", priceCents: null })} />
        <ProductCard card={bolt({ id: "inv-5", name: "Free Bolt", priceCents: 0 })} />
      </>,
    );
    expect(await screen.findByRole("button", { name: "Add to trade: Lightning Bolt" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Add to trade/ })).toHaveLength(1);
  });

  it.each([
    ["switched off", { enabled: false }],
    ["paused", { paused: true }],
  ])("isn't offered while trading is %s", async (_label, change) => {
    world.terms = { ...TRADE_TERMS, ...change };
    at("/shop", <ProductCard card={bolt()} />);
    await act(async () => {
      await loadTradeTerms();
    });
    expect(screen.getByRole("button", { name: "Add to cart" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Add to trade/ })).toBeNull();
  });
});

/** One of our cards on a trade at `cents`. */
function wantedItemFor(id: string, cents: number) {
  return { ...customerTrade().wanted[0], id, quantity: 1, unitPriceCents: cents, status: "requested" as const };
}

describe("a trade's page", () => {
  const sheoldred = customerCard({ id: "o1", quantity: 1 });
  const elves = customerCard({ id: "o3", cardName: "Llanowar Elves", setCode: "DOM", collectorNumber: "168", quantity: 4, referencePriceCents: 25, estimatedUnitCents: 25, eligibility: "below_minimum" });

  it("won't send a list with a card we can't take; sends it once that's off, with a note (3)", async () => {
    const user = userEvent.setup();
    world.trade = customerTrade({ status: "awaiting_trade_list", listDueAt: "2099-01-01T05:59:59Z", estimatedValueCents: 8000, offered: [sheoldred, elves] });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const send = await screen.findByRole("button", { name: "Send for review" });
    expect(send).toBeDisabled();
    expect(screen.getByText(/Send it for review by/)).toHaveTextContent("or it closes.");
    expect(screen.getByText(/These stay on sale until you send your trade: then we hold them for you/)).toBeInTheDocument();
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
    expect(await screen.findByRole("button", { name: "Send for review" })).toBeDisabled();
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
  /** Ragavan, as the public card search finds it: out 4½ years, so it's listed Lightly Played. */
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

  it("adds a card from the search at the condition its age gives: nothing to pick, and none sent", async () => {
    const user = userEvent.setup();
    const released = releasedYearsAgo(4.5);
    world.printings = [ragavanPrinting(released)];
    world.trade = draftWithNoCards();
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    // The page explains it before they start.
    expect(await screen.findByText(/We set each card’s condition from its age \(Near Mint under 3 years old/)).toHaveTextContent(
      "We price your cards at TCG low when we review your list, and check their condition when they arrive, so values can go up or down.",
    );
    await user.type(screen.getByLabelText("Search for a card"), "Ragavan");
    await user.click(await screen.findByRole("button", { name: /Ragavan, Nimble Pilferer/ }));

    const pick = screen.getByText("Ragavan, Nimble Pilferer", { selector: ".gg-tc-pick__name" }).closest(".gg-tc-pick") as HTMLElement;
    expect(pick).toHaveTextContent(`Condition: Lightly PlayedPrinted in ${released.slice(0, 4)}. Set from the card’s age; we check it when your cards arrive.`);
    expect(within(pick).queryByRole("combobox")).toBeNull();
    expect(pick).toHaveTextContent("Estimated $46.80 each (today’s market price $52.00 × 90% for Lightly Played). We set the price at TCG low when we review your list.");

    await user.click(within(pick).getByRole("button", { name: "Add to my cards" }));
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toEqual({ action: "saveOffer", tradeId: TRADE_ID, cards: [{ scryfallId: "s9", finish: "nonfoil", quantity: 1 }] });
  });

  it("lists a brand-new printing, or one with no date, as Near Mint", async () => {
    const user = userEvent.setup();
    world.printings = [ragavanPrinting(null)];
    world.trade = draftWithNoCards();
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    await user.type(await screen.findByLabelText("Search for a card"), "Ragavan");
    await user.click(await screen.findByRole("button", { name: /Ragavan, Nimble Pilferer/ }));
    const pick = screen.getByText("Ragavan, Nimble Pilferer", { selector: ".gg-tc-pick__name" }).closest(".gg-tc-pick") as HTMLElement;
    expect(pick).toHaveTextContent("Condition: Near MintSet from the card’s age; we check it when your cards arrive.");
    expect(pick).toHaveTextContent("Estimated $52.00 each (today’s market price $52.00). We set the price at TCG low when we review your list.");
  });

  it("ignores a condition written in a pasted list: each card's comes from its age", async () => {
    const user = userEvent.setup();
    world.printings = [ragavanPrinting()];
    world.trade = draftWithNoCards();
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    await user.click(await screen.findByRole("button", { name: "Paste it or upload a CSV" }));
    await user.click(screen.getByLabelText("Paste your list"));
    await user.paste("2 Ragavan, Nimble Pilferer [MH2] 138 NM");
    await user.click(screen.getByRole("button", { name: "Read my list" }));

    const row = (await screen.findByText("2 Ragavan, Nimble Pilferer [MH2] 138 NM")).closest("li") as HTMLElement;
    expect(within(row).getByText("Lightly Played")).toBeInTheDocument();
    expect(row).toHaveTextContent("~$46.80 ea");
    expect(within(row).queryByRole("combobox", { name: /Condition/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add 1 card" }));
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toEqual({ action: "saveOffer", tradeId: TRADE_ID, cards: [{ scryfallId: "s9", finish: "nonfoil", quantity: 2 }] });
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
    expect(balance).toHaveTextContent("Our cards$150.00");
    expect(balance).toHaveTextContent("Your cards neededAt TCG low, to cover ours at 80% trade credit$187.50");
    expect(balance).toHaveTextContent("Your cards (approved)$150.00");
    expect(balance).toHaveTextContent("Trade credit at 80%$120.00");
    expect(balance).toHaveTextContent("Left to pay for our cards$30.00");
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
    expect(await screen.findByRole("button", { name: "Send for review" })).toBeDisabled();
    expect(screen.getByText("Only 1 left: lower the quantity")).toBeInTheDocument();
    expect(screen.getByText("One of our cards has fewer copies left than you picked.")).toBeInTheDocument();
  });

  it("a sent trade says our cards are held for the customer, through review and confirming", async () => {
    const held = customerTrade().wanted.map((w) => ({ ...w, status: "reserved" as const }));
    world.trade = customerTrade({ status: "pending_review", wanted: held });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    expect(await screen.findByText("Held for you while we review your trade: no one else can buy them.")).toBeInTheDocument();
    expect(screen.getByText(/Our cards are held for you meanwhile/)).toBeInTheDocument();
    cleanup();

    world.trade = customerTrade({
      status: "awaiting_confirmation",
      approvedValueCents: 8000,
      confirmBy: "2099-01-03T20:00:00.000Z",
      confirmation: confirmation({ confirmBy: "2099-01-03T20:00:00.000Z", shipByIfConfirmedNow: "2099-01-06T20:00:00.000Z" }),
      wanted: held,
    });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const panel = (await screen.findByRole("heading", { name: "Confirm your trade" })).closest("section")!;
    expect(panel).toHaveTextContent("Our cards are held for you until then.");
    expect(panel).not.toHaveTextContent("stay on sale");
    expect(screen.getByText("Held for you until your confirmation deadline. Confirm in time to keep them.")).toBeInTheDocument();
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
    expect(panel).toHaveTextContent("if you confirm now: 3 days, Sundays don’t count");
    expect(panel).toHaveTextContent("Approved on this condition: Sheoldred must be Near Mint.");
    expect(within(panel).getByRole("heading", { name: "What confirming means" })).toBeInTheDocument();

    const go = within(panel).getByRole("button", { name: "Confirm Trade" });
    expect(go).toBeDisabled();
    await user.click(within(panel).getByRole("checkbox"));
    await user.click(go);
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0]).toEqual({ body: { action: "confirm", tradeId: TRADE_ID, acknowledged: true, termsVersion: 1 }, auth: "Bearer member-token" });
    expect(await screen.findByRole("status")).toHaveTextContent(/Confirmed! Our cards are reserved for you: ship by/);
    expect(screen.getByRole("heading", { name: "Ship your cards" })).toBeInTheDocument();
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
    expect(await screen.findByText(/100 Test Ave/)).toHaveTextContent("Geega Games100 Test AveBallwin, MO 63011");
    expect(screen.getByText(/Put your trade ID, TR-1001, on a slip of paper inside\./)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Leave these out" }).nextElementSibling).toHaveTextContent("Llanowar Elves");
    // Before mailing, a card we turned down says to leave it out.
    expect(screen.getByText("Not accepted: please leave it out")).toBeInTheDocument();

    expect(screen.getByText(/Ship by/)).toHaveTextContent("3 days, Sundays don't count");
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
    expect(form).toHaveTextContent("Nothing is charged yet, so canceling costs nothing. Our cards held for your trade go back on sale.");
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
    expect(final).toHaveTextContent("Estimated before you shipped$80.00");
    expect(final).toHaveTextContent("Final value after inspection$72.00");
    expect(final).toHaveTextContent("Difference−$8.00");
    expect(final).toHaveTextContent("Trade credit$57.60was $64.00");
    expect(final).toHaveTextContent("Condition: Lightly Played (listed as Near Mint)");
    expect(final).toHaveTextContent("Whitening on the back");
    expect(final).toHaveTextContent("You’re free to decline with no penalty");

    await user.click(within(final).getByRole("button", { name: "Accept the offer" }));
    await user.click(await within(final).findByRole("button", { name: "Accept and finish my trade" }));
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toEqual({ action: "accept", tradeId: TRADE_ID, addressId: "addr-1" });
    cleanup();

    world.posts = [];
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const again = (await screen.findByRole("heading", { name: "Your revised offer" })).closest("section")!;
    await user.click(within(again).getByRole("button", { name: "Decline and get my cards back" }));
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
    expect(links[0]).toHaveTextContent("Awaiting your confirmation");
    expect(links[0]).toHaveTextContent("Confirm by");
    // Said before they confirm, not sprung on them.
    expect(links[0]).toHaveTextContent("Refundable deposit of $10.00 when you confirm");
    expect(links[1]).toHaveTextContent("Reserved: awaiting shipment");
    expect(links[1]).toHaveTextContent("Ship your cards by");
    expect(links[1]).toHaveTextContent("Deposit $20.00: paid (refundable)");
    expect(links[1]).toHaveTextContent("3 of our cards ($88.99) · 1 of yours");
    expect(links[2]).toHaveTextContent("Trade completed");
  });

  it("invites a first trade when there are none", async () => {
    at("/account/trades", <MyTrades />);
    expect(await screen.findByText("You haven’t started a trade yet.")).toBeInTheDocument();
  });
});

describe("local pickup on the storefront", () => {
  const LOCAL_TERMS = TRADE_TERMS;

  it("offers local pickup on the trade cart: no shipping, what to bring, and starts a local trade", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("gg-trade-cart", JSON.stringify([CART_ITEM]));
    world.respond = () => ({ status: 200, json: { ok: true, terms: LOCAL_TERMS, trade: customerTrade({ id: "new-local", handoffMethod: "local" }) } });
    at("/trade-cards", <TradeCardsPage />);
    const summary = await screen.findByRole("complementary", { name: "Trade summary" });
    await waitFor(() => expect(within(summary).getByRole("group", { name: "How do you want to trade?" })).toBeInTheDocument());
    expect(within(summary).getByRole("radio", { name: /Ship my cards/ })).toBeChecked();
    await user.click(within(summary).getByRole("radio", { name: /Local pickup/ }));
    expect(summary).toHaveTextContent("Meet us in the St. Louis area");
    expect(summary).toHaveTextContent("ShippingYou pick our cards up when we meetNone");
    expect(within(summary).getByText("$99.99").closest("p")).toHaveTextContent("To cover our cards, bring about $99.99 of your cards at TCG low");
    expect(summary).toHaveTextContent("Then we hold them for you, and once we approve it, until we meet.");
    // The FAQ answers it too.
    expect(screen.getByText("Can I trade in person?")).toBeInTheDocument();

    await user.click(within(summary).getByRole("button", { name: "Start my trade" }));
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
    window.localStorage.setItem("gg-trade-cart", JSON.stringify([CART_ITEM]));
    at("/trade-cards", <TradeCardsPage />);
    const summary = await screen.findByRole("complementary", { name: "Trade summary" });
    await waitFor(() => expect(within(summary).getByRole("group", { name: "How do you want to trade?" })).toBeInTheDocument());
    const lead = () => document.querySelector(".gg-tc-cartpage__lead")?.textContent ?? "";
    const staples = () => document.querySelector(".gg-tc-staples")?.textContent ?? "";
    // Shipping: shipping's terms.
    expect(lead()).toContain("80% of that");
    expect(staples()).toContain("$15+");
    expect(within(summary).getByRole("button", { name: "Start my trade" })).toBeEnabled();

    await user.click(within(summary).getByRole("radio", { name: /Local pickup/ }));
    expect(lead()).toContain("90% of that");
    expect(staples()).toContain("$5+");
    expect(summary).toHaveTextContent("At 90% trade credit");
    expect(summary).toHaveTextContent("or take cash for it, at a lower rate");
    // $79.99 of our cards is under local pickup's $100 minimum.
    expect(within(summary).getByRole("button", { name: "Start my trade" })).toBeDisabled();
    // How trading works follows the choice, with local pickup's own numbers.
    const how = screen.getByRole("region", { name: "How trading works" });
    expect(within(how).getByRole("tab", { name: "Local pickup" })).toHaveAttribute("aria-selected", "true");
    const panel = within(how).getByRole("tabpanel");
    expect(panel).toHaveTextContent("Local trades start at $100 of our cards. There’s no shipping.");
    expect(panel).toHaveTextContent("staples valued at $5 or more each at TCG low");
    expect(panel).toHaveTextContent("you receive 90% as trade credit");
    expect(panel).toHaveTextContent("(or take it in cash, at a lower rate)");
    expect(screen.getByText(/Anything your 90% trade credit doesn't cover/)).toBeInTheDocument();
  });

  it("shows the meeting spot, with directions, when local pickup is chosen", async () => {
    const user = userEvent.setup();
    world.terms = { ...TRADE_TERMS, localMeetSpotName: "Ballwin Library", localMeetSpotAddress: "1600 Clarkson Rd, Ballwin, MO" };
    window.localStorage.setItem("gg-trade-cart", JSON.stringify([CART_ITEM]));
    at("/trade-cards", <TradeCardsPage />);
    const summary = await screen.findByRole("complementary", { name: "Trade summary" });
    await waitFor(() => expect(within(summary).getByRole("radio", { name: /Local pickup/ })).toBeInTheDocument());
    expect(summary).toHaveTextContent("Meet us at Ballwin Library.");
    expect(within(summary).queryByRole("link", { name: /Get directions/ })).toBeNull();
    await user.click(within(summary).getByRole("radio", { name: /Local pickup/ }));
    expect(summary).toHaveTextContent("Where we meetBallwin Library1600 Clarkson Rd, Ballwin, MO");
    expect(within(summary).getByRole("link", { name: /Get directions/ })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=Ballwin%20Library%2C%201600%20Clarkson%20Rd%2C%20Ballwin%2C%20MO",
    );
    expect(screen.getByText(/at our meeting spot, Ballwin Library, 1600 Clarkson Rd, Ballwin, MO/)).toBeInTheDocument();
  });

  it("doesn't offer local pickup while it's off", async () => {
    world.terms = { ...TRADE_TERMS, localPickupEnabled: false };
    window.localStorage.setItem("gg-trade-cart", JSON.stringify([CART_ITEM]));
    at("/trade-cards", <TradeCardsPage />);
    const summary = await screen.findByRole("complementary", { name: "Trade summary" });
    await waitFor(() => expect(summary).toHaveTextContent("Our cards (1)$79.99"));
    expect(within(summary).queryByRole("group", { name: "How do you want to trade?" })).toBeNull();
    expect(screen.queryByText("Can I trade in person?")).toBeNull();
  });

  it("sends a local draft without listing their cards, and can switch it to shipping", async () => {
    const user = userEvent.setup();
    world.trade = customerTrade({ status: "awaiting_trade_list", handoffMethod: "local", listDueAt: "2099-01-01T05:59:59Z", estimatedValueCents: 0, offered: [] });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const send = await screen.findByRole("button", { name: "Send for review" });
    expect(send).toBeEnabled();
    expect(screen.getByRole("heading", { level: 2, name: "Draft: send it for review" })).toBeInTheDocument();
    expect(screen.getByText(/Bring them when we meet/)).toBeInTheDocument();
    expect(screen.queryByText("Add the cards you're trading in.")).toBeNull();
    const steps = screen.getByRole("list", { name: "Trade progress" });
    expect(within(steps).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Our cards", "Review", "Meet up", "Done"]);
    // Nothing to confirm on a local trade: approving holds our cards.
    expect(screen.getByText(/These stay on sale until you send your trade: then we hold them for you/)).toBeInTheDocument();
    expect(screen.getByText(/Sending it holds our cards for you\. Once we approve your trade, we set up where and when to meet/)).toBeInTheDocument();
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
