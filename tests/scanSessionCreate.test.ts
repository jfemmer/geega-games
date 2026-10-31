import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// Creating a scan session. The scanner bridge asks for a label naming the
// scan type ("Inventory Scan #N", "Condition Scan #N", "Inventory + Condition
// Scan #N") so they're easy to tell apart; everything else is labelled as before.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

const { default: createSession } = await import("../api/admin/scan-sessions/index.ts");

const TOKEN = "staff-token";

async function post(body: unknown, token: string | null = TOKEN) {
  const res = fakeResponse();
  await createSession(
    { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, query: {}, body } as never,
    res as never,
  );
  return res as typeof res & { body: Record<string, unknown> };
}

beforeEach(() => {
  state = createFakeState();
  state.sessions[TOKEN] = { id: "staff-1", email: "scanner@example.com", app_metadata: { role: "staff" } };
  state.tables.scan_sessions = [{ id: "existing-1" }, { id: "existing-2" }];
});

describe("creating a scan session", () => {
  it.each([
    ["card_matching", "Inventory Scan #3"],
    ["condition", "Condition Scan #3"],
    ["both", "Inventory + Condition Scan #3"],
  ])("labels the scanner bridge's %s sessions by their scan type", async (scanMode, label) => {
    const res = await post({ scannerName: "Ricoh fi-8170", sourceType: "scanner_bridge", scanMode, labelByMode: true });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ label, scan_mode: scanMode, source_type: "scanner_bridge" });
  });

  it("still labels a 1.2.0 bridge's condition scan", async () => {
    const res = await post({ sourceType: "scanner_bridge", scanMode: "both", purpose: "condition" });
    expect(res.body).toMatchObject({ label: "Condition Scan #3", scan_mode: "both" });
  });

  it("labels everything else as before", async () => {
    const res = await post({ sourceType: "scanner_bridge", scanMode: "card_matching" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ label: "Scan Session #3", scan_mode: "card_matching" });
  });

  it("refuses an unknown purpose", async () => {
    const res = await post({ sourceType: "scanner_bridge", purpose: "deluxe" });
    expect(res.statusCode).toBe(400);
    expect(state.tables.scan_sessions).toHaveLength(2);
  });

  it("is staff-only", async () => {
    const res = await post({ purpose: "condition" }, null);
    expect(res.statusCode).toBe(401);
    expect(state.tables.scan_sessions).toHaveLength(2);
  });
});
