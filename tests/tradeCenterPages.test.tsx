// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CustomerTrade, CustomerTradeSummary, TradeTerms } from "../src/store/lib/tradeCenter";
import { TRADE_ID, TRADE_TERMS, customerCard, customerTrade } from "./helpers/tradeFixtures";

// The storefront's Trade Center: the Trade Cards page and its trade cart,
// "Add to trade" on card pages, a trade's own page at each step, and My
// Trades. The real API client runs; fetch is the stand-in for
// /api/trade-center, so these tests see exactly what's sent and with whose
// session.

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
const { resetTradeTermsForTests } = await import("../src/store/lib/tradeCenterApi");
const { resetTradeCartForTests } = await import("../src/store/lib/tradeCart");
const { default: TradeCardsPage } = await import("../src/store/pages/TradeCardsPage");
const { default: TradeDetail } = await import("../src/store/components/trades/TradeDetail");
const { default: MyTrades } = await import("../src/store/components/trades/MyTrades");
const { default: CardDetailPage } = await import("../src/store/pages/CardDetailPage");

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
  fetchMock.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("the Trade Cards page (1)", () => {
  it("advertises the terms and starts a trade from the trade cart, as the signed-in customer", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("gg-trade-cart", JSON.stringify([CART_ITEM]));
    world.respond = () => ({ status: 200, json: { ok: true, terms: TRADE_TERMS, trade: customerTrade({ id: "new-trade" }) } });
    at("/trade-cards", <TradeCardsPage />);
    expect(await screen.findByText("80% of your cards' value as trade credit")).toBeInTheDocument();
    expect(screen.getByText("Cards worth $15.00 or more each")).toBeInTheDocument();
    const cart = screen.getByRole("heading", { name: "Your trade cart" }).parentElement!;
    expect(cart).toHaveTextContent("The One Ring");
    expect(cart).toHaveTextContent("Our cards: $79.99");

    await user.click(within(cart).getByRole("button", { name: "Start my trade" }));
    await waitFor(() => expect(window.location.pathname).toBe("/account/trades/new-trade"));
    expect(world.posts).toEqual([{ body: { action: "start", items: [{ inventoryItemId: "i1", quantity: 1 }] }, auth: "Bearer member-token" }]);
    expect(JSON.parse(window.localStorage.getItem("gg-trade-cart") ?? "null")).toEqual([]);
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
  });

  it("says when new trades are paused, and won't start one", async () => {
    world.terms = { ...TRADE_TERMS, paused: true, pauseMessage: "Back after the holidays." };
    window.localStorage.setItem("gg-trade-cart", JSON.stringify([CART_ITEM]));
    at("/trade-cards", <TradeCardsPage />);
    expect((await screen.findAllByText("Back after the holidays.")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /start my trade/i })).toBeNull();
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
    at("/shop/card/sheoldred-the-apocalypse", <CardDetailPage slug="sheoldred-the-apocalypse" />);
    await screen.findByRole("heading", { level: 1, name: "Sheoldred, the Apocalypse" });
    expect(await screen.findByText("Trades at $80.00")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add to trade" }));
    expect(screen.getByRole("button", { name: "In your trade ✓" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View trade" })).toHaveAttribute("href", "/trade-cards");
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

describe("a trade's page", () => {
  const sheoldred = customerCard({ id: "o1", quantity: 1 });
  const elves = customerCard({ id: "o3", cardName: "Llanowar Elves", setCode: "DOM", collectorNumber: "168", quantity: 4, referencePriceCents: 25, estimatedUnitCents: 25, eligibility: "below_minimum" });

  it("won't send a list with a card we can't take; sends it once that's off, with a note (3)", async () => {
    const user = userEvent.setup();
    world.trade = customerTrade({ status: "awaiting_trade_list", holdExpiresAt: "2099-01-01T05:59:59Z", estimatedValueCents: 8000, offered: [sheoldred, elves] });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const send = await screen.findByRole("button", { name: "Send for review" });
    expect(send).toBeDisabled();
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

  it("shows where and how to ship once approved, and takes a clean tracking number (5)", async () => {
    const user = userEvent.setup();
    world.trade = customerTrade({
      status: "awaiting_shipment",
      approvedValueCents: 8000,
      shipBy: "2099-01-01T05:59:59Z",
      holdExpiresAt: "2099-01-02T05:59:59Z",
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

    await user.type(screen.getByLabelText("Tracking number"), "12-34");
    await user.click(screen.getByRole("button", { name: "Add tracking number" }));
    expect(world.posts).toEqual([]);
    await user.clear(screen.getByLabelText("Tracking number"));
    await user.type(screen.getByLabelText("Tracking number"), "9400 1118 9922 3197 4284 90");
    await user.click(screen.getByRole("button", { name: "Add tracking number" }));
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toMatchObject({ action: "tracking", tradeId: TRADE_ID, carrier: "USPS" });
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
    const final = (await screen.findByRole("heading", { name: "Your final offer" })).closest("section")!;
    expect(final).toHaveTextContent("1 × $80.00");
    expect(final).toHaveTextContent("1 × $72.00");
    expect(final).toHaveTextContent("Whitening on the back");

    await user.click(within(final).getByRole("button", { name: "Accept the offer" }));
    await user.click(await within(final).findByRole("button", { name: "Accept and finish my trade" }));
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toEqual({ action: "accept", tradeId: TRADE_ID, addressId: "addr-1" });
    cleanup();

    world.posts = [];
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const again = (await screen.findByRole("heading", { name: "Your final offer" })).closest("section")!;
    await user.click(within(again).getByRole("button", { name: "Decline and get my cards back" }));
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
      shippingCents: 0,
      amountDueCents: 2499,
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
    expect(settled).toHaveTextContent("Trade credit issued$64.00");
    expect(settled).toHaveTextContent("Paid by card$24.99");
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
      { id: "t-old", tradeNumber: 990, status: "completed", createdAt: "2026-09-01T12:00:00Z", updatedAt: "2026-09-10T12:00:00Z", wantedTotalCents: 4000, wantedCount: 2, offeredCount: 3, holdExpiresAt: null, shipBy: null, paymentDueAt: null },
      { id: "t-new", tradeNumber: 1001, status: "awaiting_shipment", createdAt: "2026-10-20T12:00:00Z", updatedAt: "2026-10-24T12:00:00Z", wantedTotalCents: 8899, wantedCount: 3, offeredCount: 1, holdExpiresAt: null, shipBy: "2099-01-01T05:59:59Z", paymentDueAt: null },
    ];
    at("/account/trades", <MyTrades />);
    const links = await screen.findAllByRole("link", { name: /TR-/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/account/trades/t-new", "/account/trades/t-old"]);
    expect(links[0]).toHaveTextContent("Approved: ship your cards");
    expect(links[0]).toHaveTextContent("3 of our cards ($88.99) · 1 of yours");
    expect(links[1]).toHaveTextContent("Complete");
  });

  it("invites a first trade when there are none", async () => {
    at("/account/trades", <MyTrades />);
    expect(await screen.findByText("You haven’t started a trade yet.")).toBeInTheDocument();
  });
});
