// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CustomerTrade, CustomerTradeSummary, TradeTerms } from "../src/store/lib/tradeCenter";
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
    // Starting doesn't reserve anything.
    expect(cart).toHaveTextContent("Starting a trade doesn’t reserve these yet");

    await user.click(within(cart).getByRole("button", { name: "Start my trade" }));
    await waitFor(() => expect(window.location.pathname).toBe("/account/trades/new-trade"));
    expect(world.posts).toEqual([{ body: { action: "start", items: [{ inventoryItemId: "i1", quantity: 1 }] }, auth: "Bearer member-token" }]);
    expect(JSON.parse(window.localStorage.getItem("gg-trade-cart") ?? "null")).toEqual([]);
  });

  it("explains reservations, the confirmation and shipping windows and the deposit, from the settings", async () => {
    at("/trade-cards", <TradeCardsPage />);
    expect(await screen.findByText("Our cards reserved for you once you confirm")).toBeInTheDocument();
    expect(screen.getByText("Decline the final offer with no penalty")).toBeInTheDocument();
    // The worked example is a real deadline: 3 qualifying days from Friday 2 PM skips Sunday.
    expect(screen.getByText(/confirm on a Friday at 2 PM and you'd ship by Tuesday at 2 PM/)).toBeInTheDocument();
    expect(screen.getByText(/Once we approve it you have 48 hours to confirm \(Sundays don't count\)/)).toBeInTheDocument();

    const deposit = screen.getByRole("heading", { name: "The refundable deposit" }).closest("section")!;
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
    at("/trade-cards", <TradeCardsPage />);
    await screen.findByText("80% of your cards' value as trade credit");
    expect(screen.queryByRole("heading", { name: "The refundable deposit" })).toBeNull();
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
    world.trade = customerTrade({ status: "awaiting_trade_list", listDueAt: "2099-01-01T05:59:59Z", estimatedValueCents: 8000, offered: [sheoldred, elves] });
    at(`/account/trades/${TRADE_ID}`, <TradeDetail tradeId={TRADE_ID} />);
    const send = await screen.findByRole("button", { name: "Send for review" });
    expect(send).toBeDisabled();
    expect(screen.getByText(/Send it for review by/)).toHaveTextContent("or it closes.");
    expect(screen.getByText(/These stay on sale until you confirm your approved trade, so they aren't reserved yet/)).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Add tracking number" }));
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0].body).toEqual({ action: "tracking", tradeId: TRADE_ID, carrier: "USPS", trackingNumber: "9400111899223197428490" });
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
