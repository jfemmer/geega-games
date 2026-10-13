import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// The three endpoints a batch of scans goes through — mint upload URLs,
// ingest what was uploaded into card_scans rows, and bulk-edit in review —
// at real batch sizes. Their bodies are far bigger than the 4 KB default the
// public forms use (a 100-card duplex batch is ~40 KB to ingest), which used
// to turn away any batch of more than about ten cards.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

const { default: uploads } = await import("../api/admin/scan-sessions/[id]/uploads.ts");
const { default: ingest } = await import("../api/admin/scan-sessions/[id]/ingest.ts");
const { default: bulk } = await import("../api/admin/scans/bulk.ts");

const TOKEN = "staff-token";
const SESSION = "5e551011-0000-4000-8000-000000000001";

async function call(handler: typeof uploads, method: string, body: unknown, query: Record<string, string> = { id: SESSION }) {
  const res = fakeResponse();
  await handler({ method, headers: { authorization: `Bearer ${TOKEN}` }, query, body } as never, res as never);
  return res as typeof res & { body: Record<string, unknown> };
}

/** A 100-card duplex batch as the scanner bridge names it. */
function batchFiles(cards: number) {
  return Array.from({ length: cards * 2 }, (_, i) => ({
    fileName: `scan_1760300000000_${String(i + 1).padStart(4, "0")}.jpg`,
    side: i % 2 === 0 ? ("front" as const) : ("back" as const),
    sequenceHint: Math.floor(i / 2) + 1,
  }));
}

beforeEach(() => {
  state = createFakeState();
  state.sessions[TOKEN] = { id: "staff-1", email: "scanner@example.com", app_metadata: { role: "staff" } };
  state.rpc.recompute_scan_session = () => ({ data: {}, error: null });
  state.tables.scan_sessions = [{ id: SESSION, total_files: 0, status: "scanning" }];
  state.tables.card_scans = [];
});

describe("a 100-card duplex batch", () => {
  it("gets upload URLs for all 200 files in one request", async () => {
    const files = batchFiles(100);
    expect(JSON.stringify({ files }).length).toBeGreaterThan(4096);
    const res = await call(uploads, "POST", { files });
    expect(res.statusCode).toBe(200);
    const targets = res.body.uploads as { path: string; token: string; sequenceHint: number }[];
    expect(targets).toHaveLength(200);
    expect(targets.every((t) => t.path.startsWith(`${SESSION}/`) && t.token)).toBe(true);
  });

  it("is ingested as 100 cards in order, and a retried ingest adds nothing twice", async () => {
    const files = batchFiles(100).map((f) => ({ ...f, path: `${SESSION}/${f.sequenceHint}-${f.side}-00000000-0000-4000-8000-${String(f.sequenceHint).padStart(12, "0")}-${f.fileName}` }));
    expect(JSON.stringify({ uploads: files }).length).toBeGreaterThan(30_000);
    const res = await call(ingest, "POST", { uploads: files });
    expect(res.statusCode).toBe(200);
    const created = res.body.created as { sequence_number: number; front_image_path: string; back_image_path: string }[];
    expect(created).toHaveLength(100);
    expect(created[0]).toMatchObject({ sequence_number: 1, front_image_path: files[0].path, back_image_path: files[1].path });
    expect(created[99].sequence_number).toBe(100);

    // The client never saw the response and sends the same batch again.
    const again = await call(ingest, "POST", { uploads: files });
    expect(again.statusCode).toBe(200);
    expect(again.body.created).toEqual([]);
    expect(state.tables.card_scans).toHaveLength(100);
  });

  it("refuses an absurd number of files in one ingest", async () => {
    const files = batchFiles(501).map((f) => ({ ...f, path: `${SESSION}/x-${f.fileName}` }));
    const res = await call(ingest, "POST", { uploads: files });
    expect(res.statusCode).toBe(400);
  });
});

describe("bulk edits in Scan Review", () => {
  it("apply to hundreds of selected scans at once", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`);
    state.tables.card_scans = ids.map((id, i) => ({ id, scan_session_id: SESSION, sequence_number: i + 1, storage_location: null }));
    expect(JSON.stringify({ scanIds: ids }).length).toBeGreaterThan(4096);
    const res = await call(bulk, "PATCH", { scanIds: ids, storageLocation: "Box 7" }, {});
    expect(res.statusCode).toBe(200);
    expect(res.body.scans as unknown[]).toHaveLength(250);
    expect(state.tables.card_scans.every((s) => s.storage_location === "Box 7")).toBe(true);
  });

  it("refuses ids that aren't scan ids", async () => {
    const res = await call(bulk, "PATCH", { scanIds: ["1 or 1=1"], notes: "x" }, {});
    expect(res.statusCode).toBe(400);
  });
});
