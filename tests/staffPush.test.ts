import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// notifyStaff() runs inside order webhooks, lead submissions and the kiosk,
// so the contract that matters most: it pushes each event once, only to
// current staff, cleans up dead devices — and never throws.

const state: {
  subs: { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }[];
  subsError: { message: string } | null;
  claimError: { code?: string; message: string } | null;
  claimed: { event_key: string; kind: string }[];
  kindsFilter: string[] | null;
  deleted: string[][];
  touched: string[][];
  users: Record<string, { app_metadata: Record<string, unknown> } | null>;
  sendResults: Record<string, number>; // endpoint → status code to throw (0 = ok)
  sent: { endpoint: string; payload: string }[];
  badges: Record<string, Record<string, number>>; // user → admin_nav_badges() result
  badgeError: boolean;
} = {
  subs: [],
  subsError: null,
  claimError: null,
  claimed: [],
  kindsFilter: null,
  deleted: [],
  touched: [],
  users: {},
  sendResults: {},
  sent: [],
  badges: {},
  badgeError: false,
};

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    rpc: async (fn: string, args: { p_user_id: string }) => {
      if (fn !== "admin_nav_badges") throw new Error(`unexpected rpc ${fn}`);
      if (state.badgeError) throw new Error("statement timeout");
      return { data: state.badges[args.p_user_id] ?? null, error: null };
    },
    auth: {
      admin: {
        getUserById: async (id: string) => {
          const user = state.users[id];
          return user
            ? { data: { user }, error: null }
            : { data: { user: null }, error: { message: "User not found" } };
        },
      },
    },
    from: (table: string) => {
      if (table === "staff_push_subscriptions") {
        return {
          select: () => ({
            contains: async (_col: string, kinds: string[]) => {
              state.kindsFilter = kinds;
              return { data: state.subsError ? null : state.subs, error: state.subsError };
            },
          }),
          update: () => ({
            in: async (_col: string, ids: string[]) => {
              state.touched.push(ids);
              return { error: null };
            },
          }),
          delete: () => ({
            in: async (_col: string, ids: string[]) => {
              state.deleted.push(ids);
              return { error: null };
            },
          }),
        };
      }
      if (table === "staff_push_log") {
        return {
          insert: async (row: { event_key: string; kind: string }) => {
            if (state.claimError) return { error: state.claimError };
            state.claimed.push(row);
            return { error: null };
          },
          delete: () => ({ lt: async () => ({ error: null }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

vi.mock("web-push", () => {
  class WebPushError extends Error {
    statusCode: number;
    body: string;
    constructor(statusCode: number) {
      super(`push failed ${statusCode}`);
      this.statusCode = statusCode;
      this.body = "";
    }
  }
  return {
    WebPushError,
    default: {
      sendNotification: vi.fn(async (sub: { endpoint: string }, payload: string) => {
        const code = state.sendResults[sub.endpoint] ?? 0;
        if (code) throw new WebPushError(code);
        state.sent.push({ endpoint: sub.endpoint, payload });
        return { statusCode: 201 };
      }),
    },
  };
});

const { notifyStaff, isAllowedPushEndpoint, shortName } = await import("../api/_lib/staffPush.ts");

const EVENT = {
  key: "order:abc",
  kind: "order" as const,
  title: "New order GG-ABC · $12.00",
  body: "Jordan · 2 items",
  url: "/admin_dashboard/orders?order=abc",
  tag: "order:abc",
};

function sub(id: string, userId: string, host = "fcm.googleapis.com") {
  return { id, user_id: userId, endpoint: `https://${host}/fcm/send/${id}`, p256dh: "p".repeat(87), auth: "a".repeat(22) };
}

beforeEach(() => {
  process.env.VAPID_PUBLIC_KEY = "BPublicKeyForTests";
  process.env.VAPID_PRIVATE_KEY = "privateKeyForTests";
  state.subs = [];
  state.subsError = null;
  state.claimError = null;
  state.claimed = [];
  state.kindsFilter = null;
  state.deleted = [];
  state.touched = [];
  state.users = {};
  state.sendResults = {};
  state.sent = [];
  state.badges = {};
  state.badgeError = false;
});

afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});

describe("notifyStaff", () => {
  it("does nothing until the VAPID keys are configured", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    state.subs = [sub("s1", "u1")];
    expect(await notifyStaff(EVENT)).toEqual({ status: "skipped", reason: "not-configured" });
    expect(state.sent).toHaveLength(0);
  });

  it("only asks for devices that want this kind of event, and skips when there are none", async () => {
    expect(await notifyStaff(EVENT)).toEqual({ status: "skipped", reason: "no-subscribers" });
    expect(state.kindsFilter).toEqual(["order"]);
    expect(state.claimed).toHaveLength(0);
  });

  it("sends to every staff device with the payload the service worker expects", async () => {
    state.subs = [sub("s1", "u1"), sub("s2", "u1", "web.push.apple.com")];
    state.users = { u1: { app_metadata: { role: "staff" } } };
    const result = await notifyStaff(EVENT);
    expect(result).toEqual({ status: "sent", delivered: 2, failed: 0, removed: 0 });
    expect(state.claimed).toEqual([{ event_key: "order:abc", kind: "order" }]);
    const payload = JSON.parse(state.sent[0].payload);
    expect(payload).toMatchObject({
      title: EVENT.title,
      body: EVENT.body,
      url: EVENT.url,
      tag: EVENT.tag,
    });
    expect(state.touched).toEqual([["s1", "s2"]]);
  });

  it("pushes an event only once (webhook retry, or Stripe and PayPal racing)", async () => {
    state.subs = [sub("s1", "u1")];
    state.users = { u1: { app_metadata: { role: "admin" } } };
    state.claimError = { code: "23505", message: "duplicate key" };
    expect(await notifyStaff(EVENT)).toEqual({ status: "skipped", reason: "duplicate" });
    expect(state.sent).toHaveLength(0);
  });

  it("removes devices whose subscription expired (404/410), keeping ones with a temporary error", async () => {
    state.subs = [sub("gone", "u1"), sub("flaky", "u1"), sub("ok", "u1")];
    state.users = { u1: { app_metadata: { role: "staff" } } };
    state.sendResults = {
      [sub("gone", "u1").endpoint]: 410,
      [sub("flaky", "u1").endpoint]: 500,
    };
    const result = await notifyStaff(EVENT);
    expect(result).toEqual({ status: "sent", delivered: 1, failed: 1, removed: 1 });
    expect(state.deleted).toEqual([["gone"]]);
  });

  it("stops pushing to someone who is no longer staff, and forgets their devices", async () => {
    state.subs = [sub("s1", "former"), sub("s2", "current")];
    state.users = {
      former: { app_metadata: { role: "customer" } },
      current: { app_metadata: { role: "staff" } },
    };
    const result = await notifyStaff(EVENT);
    expect(state.sent.map((s) => s.endpoint)).toEqual([sub("s2", "current").endpoint]);
    expect(state.deleted).toEqual([["s1"]]);
    expect(result).toMatchObject({ delivered: 1, removed: 1 });
  });

  it("tells each person's devices how many things are waiting for them (the app icon number)", async () => {
    state.subs = [sub("s1", "u1"), sub("s2", "u2", "web.push.apple.com")];
    state.users = { u1: { app_metadata: { role: "staff" } }, u2: { app_metadata: { role: "admin" } } };
    state.badges = {
      u1: { new_leads: 2, new_users: 1 },
      u2: { needs_packing: 1 },
    };
    await notifyStaff(EVENT);
    const badgeAt = (endpoint: string) => JSON.parse(state.sent.find((s) => s.endpoint === endpoint)!.payload).badge;
    expect(badgeAt(sub("s1", "u1").endpoint)).toBe(3);
    expect(badgeAt(sub("s2", "u2", "web.push.apple.com").endpoint)).toBe(1);
  });

  it("still pushes when the waiting count can't be read, just without a number", async () => {
    state.subs = [sub("s1", "u1")];
    state.users = { u1: { app_metadata: { role: "staff" } } };
    state.badgeError = true;
    const result = await notifyStaff(EVENT);
    expect(result).toMatchObject({ status: "sent", delivered: 1 });
    expect(JSON.parse(state.sent[0].payload)).not.toHaveProperty("badge");
  });

  it("never throws, even when the database fails", async () => {
    state.subsError = { message: "connection reset" };
    await expect(notifyStaff(EVENT)).resolves.toEqual({ status: "skipped", reason: "error" });
  });
});

describe("isAllowedPushEndpoint", () => {
  it("accepts the browsers' push services", () => {
    for (const url of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://web.push.apple.com/QGx",
      "https://updates.push.services.mozilla.com/wpush/v2/x",
      "https://wns2-par02p.notify.windows.com/w/?token=x",
    ]) {
      expect(isAllowedPushEndpoint(url), url).toBe(true);
    }
  });

  it("refuses anything else, so a stored endpoint can't aim the server at other hosts", () => {
    for (const url of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://evil.example.com/push",
      "https://fcm.googleapis.com.evil.example.com/x",
      "https://169.254.169.254/latest/meta-data",
      "not a url",
    ]) {
      expect(isAllowedPushEndpoint(url), url).toBe(false);
    }
  });
});

describe("shortName", () => {
  it("keeps lock-screen notifications to a first name and initial", () => {
    expect(shortName("Jordan", "Vega")).toBe("Jordan V.");
    expect(shortName("Sam", null)).toBe("Sam");
    expect(shortName(null, null)).toBe("Someone");
  });
});
