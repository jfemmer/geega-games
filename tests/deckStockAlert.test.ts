import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@react-email/render";
import { DeckStockAlert, deckStockAlertText } from "../api/_lib/emails/DeckStockAlert.js";

// The deck restock alert: the email itself, and the worker that sends it
// (api/deck-alerts/process.ts). Supabase and the email sender are faked at
// the _lib boundary; the worker's own logic runs for real.

const props = {
  cardName: "Sol Ring",
  deckNames: ["Atraxa Superfriends"],
  productUrl: "https://geega-games.com/shop/card/sol-ring",
  siteUrl: "https://geega-games.com",
};

describe("deck restock alert email", () => {
  it("names the card, the deck and where to buy it", async () => {
    const html = await render(DeckStockAlert(props));

    expect(html).toContain("<title>Sol Ring is back in stock</title>");
    expect(html).toContain("Sol Ring<!-- --> is back in stock</h1>");
    expect(html).toContain("your deck<!-- --> <strong>Atraxa Superfriends</strong>");
    expect(html).toContain('href="https://geega-games.com/shop/card/sol-ring"');
    expect(html).toContain("View available card");
    expect(html).toContain("You can change deck notification settings from My Decks.");
  });

  it("renders without React complaining", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await render(DeckStockAlert(props));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("summarises several decks", async () => {
    const two = await render(DeckStockAlert({ ...props, deckNames: ["Affinity", "Hammer Time"] }));
    expect(two).toContain("your decks<!-- --> <strong>Affinity, Hammer Time</strong>");

    const four = await render(
      DeckStockAlert({ ...props, deckNames: ["Izzet Tempo", "Cube", "Jeskai Control", "Storm"] }),
    );
    expect(four).toContain("<strong>Izzet Tempo, Cube +2 more</strong>");
  });

  it("escapes card and deck names", async () => {
    const html = await render(
      DeckStockAlert({ ...props, cardName: "<b>R&D's</b> Secret Lair", deckNames: ["Mom's <deck>"] }),
    );
    expect(html).not.toContain("<b>R&D");
    expect(html).toContain("&lt;b&gt;R&amp;D&#x27;s&lt;/b&gt; Secret Lair");
    expect(html).toContain("<strong>Mom&#x27;s &lt;deck&gt;</strong>");
  });

  it("has a plain-text version listing every deck", () => {
    expect(deckStockAlertText({ ...props, deckNames: ["Affinity", "Hammer Time", "Cube"] })).toBe(
      [
        "Sol Ring is back in stock at Geega Games.",
        "",
        "You’re watching this card for: Affinity, Hammer Time, Cube.",
        "",
        "View available card: https://geega-games.com/shop/card/sol-ring",
        "",
        "You can change deck restock alerts from My Decks in your Geega Games account.",
      ].join("\n"),
    );
  });
});

// ── The worker ─────────────────────────────────────────────────────────────

type QueueRow = {
  id: string;
  user_id: string;
  card_name: string;
  inventory_item_id: string | null;
  deck_names: string[] | null;
  created_at: string;
};

const row: QueueRow = {
  id: "notif-1",
  user_id: "user-1",
  card_name: "Urza's Saga",
  inventory_item_id: "inv-1",
  deck_names: ["Affinity", "Hammer Time"],
  created_at: "2026-10-03T12:00:00.000Z",
};

const state: {
  rows: QueueRow[];
  loadError: { message: string } | null;
  emails: Record<string, string | null>;
  filters: unknown[][];
  updates: { table: string; values: Record<string, unknown>; id: unknown }[];
} = { rows: [], loadError: null, emails: {}, filters: [], updates: [] };

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      for (const method of ["select", "is", "order", "limit"]) {
        query[method] = (...args: unknown[]) => {
          state.filters.push([method, ...args]);
          return query;
        };
      }
      query.then = (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ data: state.loadError ? null : state.rows, error: state.loadError }).then(onFulfilled);
      query.update = (values: Record<string, unknown>) => ({
        eq: async (_column: string, id: unknown) => {
          state.updates.push({ table, values, id });
          return { error: null };
        },
      });
      return query;
    },
    auth: {
      admin: {
        getUserById: async (userId: string) => {
          const email = state.emails[userId];
          return email
            ? { data: { user: { id: userId, email } }, error: null }
            : { data: { user: null }, error: { message: "User not found" } };
        },
      },
    },
  }),
}));

type Sent = { to: string; subject: string; text: string; idempotencyKey: string; emailType: string };
const sendTrackedEmail = vi.fn(
  async (_args: Sent): Promise<{ status: "sent" } | { status: "deduped" } | { status: "failed"; error: string }> => ({
    status: "sent",
  }),
);
vi.mock("../api/_lib/emailService.js", () => ({
  sendTrackedEmail: (args: Sent) => sendTrackedEmail(args),
}));

async function runWorker(method = "POST") {
  const { default: handler } = await import("../api/deck-alerts/process.ts");
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    setHeader() {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  await handler({ method, headers: {} } as never, res as never);
  return res;
}

beforeEach(() => {
  vi.stubEnv("PUBLIC_SITE_URL", "https://geega-games.com");
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.rows = [row];
  state.loadError = null;
  state.emails = { "user-1": "sam@example.com" };
  state.filters = [];
  state.updates = [];
  sendTrackedEmail.mockReset();
  sendTrackedEmail.mockResolvedValue({ status: "sent" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the deck restock alert worker", () => {
  it("emails the customer about a queued restock and marks it sent", async () => {
    const res = await runWorker();

    expect(sendTrackedEmail).toHaveBeenCalledTimes(1);
    const sent = sendTrackedEmail.mock.calls[0][0];
    expect(sent.to).toBe("sam@example.com");
    expect(sent.emailType).toBe("deck_stock_alert");
    expect(sent.idempotencyKey).toBe("deck-stock-notif-1");
    expect(sent.subject).toBe("Urza's Saga is back in stock — Geega Games");
    expect(sent.text).toContain("You’re watching this card for: Affinity, Hammer Time.");
    expect(sent.text).toContain("View available card: https://geega-games.com/shop/card/urza-s-saga");

    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({ table: "deck_stock_notifications", id: "notif-1" });
    expect(Object.keys(state.updates[0].values)).toEqual(["email_sent_at"]);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1, sent: 1, failed: 0 });
  });

  it("only picks up alerts that haven't been sent or failed, oldest first", async () => {
    await runWorker();
    expect(state.filters).toContainEqual(["is", "email_sent_at", null]);
    expect(state.filters).toContainEqual(["is", "email_error", null]);
    expect(state.filters).toContainEqual(["order", "created_at", { ascending: true }]);
    expect(state.filters).toContainEqual(["limit", 25]);
  });

  it("does nothing when the queue is empty", async () => {
    state.rows = [];
    const res = await runWorker("GET");

    expect(sendTrackedEmail).not.toHaveBeenCalled();
    expect(state.updates).toEqual([]);
    expect(res.body).toEqual({ ok: true, processed: 0, sent: 0, failed: 0 });
  });

  it("treats an alert that already went out as sent, without sending it twice", async () => {
    sendTrackedEmail.mockResolvedValue({ status: "deduped" });
    const res = await runWorker();

    expect(Object.keys(state.updates[0].values)).toEqual(["email_sent_at"]);
    expect(res.body).toEqual({ ok: true, processed: 1, sent: 1, failed: 0 });
  });

  it("records why an alert couldn't be sent instead of retrying it forever", async () => {
    sendTrackedEmail.mockResolvedValue({ status: "failed", error: "Mailbox rejected the message" });
    const res = await runWorker();

    expect(state.updates).toEqual([
      { table: "deck_stock_notifications", values: { email_error: "Mailbox rejected the message" }, id: "notif-1" },
    ]);
    expect(res.body).toEqual({ ok: true, processed: 1, sent: 0, failed: 1 });
  });

  it("skips an alert whose account has no email address", async () => {
    state.emails = {};
    const res = await runWorker();

    expect(sendTrackedEmail).not.toHaveBeenCalled();
    expect(state.updates).toEqual([
      { table: "deck_stock_notifications", values: { email_error: "Account email unavailable." }, id: "notif-1" },
    ]);
    expect(res.body).toEqual({ ok: true, processed: 1, sent: 0, failed: 1 });
  });

  it("reports a queue it can't read, and refuses other HTTP methods", async () => {
    state.loadError = { message: "connection refused" };
    expect((await runWorker()).statusCode).toBe(500);
    expect(sendTrackedEmail).not.toHaveBeenCalled();

    expect((await runWorker("DELETE")).statusCode).toBe(405);
  });
});
