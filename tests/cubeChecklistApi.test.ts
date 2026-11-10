import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeId, fakeResponse, type FakeState } from "./helpers/fakeSupabase";
import { colorCategoryFor, defaultRarityRule, mainType, mergeCards } from "../src/store/lib/cubeChecklist";

// The cube checklist endpoints: the public share link (POST /api/cube-checklist)
// and the staff side (/api/admin/cube-checklists). The database and Scryfall
// are stand-ins; these tests are about the rules — the token is the only
// access, a pauper cube only takes commons, a card can't be on the list
// twice, undo goes back to the cube's own card, and a find keeps whoever got
// there first.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

let state: FakeState = createFakeState();
const scry = vi.hoisted(() => ({
  searchCards: vi.fn(),
  searchPage: vi.fn(),
}));
const cube = vi.hoisted(() => ({ fetchCubeList: vi.fn() }));

vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));
vi.mock("../api/_lib/scryfall.js", () => ({
  scryfallSearchCards: scry.searchCards,
  scryfallSearchPage: scry.searchPage,
}));
vi.mock("../api/_lib/cubeCobra.js", async (orig) => ({
  ...(await orig<typeof import("../api/_lib/cubeCobra")>()),
  fetchCubeList: cube.fetchCubeList,
}));

const { default: share } = await import("../api/cube-checklist.ts");
const { default: admin } = await import("../api/admin/cube-checklists.ts");

const TOKEN = "s".repeat(32);
const STAFF = "staff-token";
const LIST = "11111111-1111-4111-8111-111111111111";
const SKYFISHER = "22222222-2222-4222-8222-000000000001";
const COUNTERSPELL = "22222222-2222-4222-8222-000000000002";

function card(id: string, position: number, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    checklist_id: LIST,
    position,
    name,
    type_line: null,
    color_category: null,
    original_name: null,
    original_type_line: null,
    original_color_category: null,
    swapped_by: null,
    swapped_at: null,
    found_by: null,
    found_at: null,
    updated_at: "2026-11-10T00:00:00.000Z",
    ...extra,
  };
}

function scryCard(name: string, extra: Record<string, unknown> = {}) {
  return {
    object: "card",
    id: fakeId(),
    name,
    lang: "en",
    layout: "normal",
    rarity: "common",
    set: "x",
    set_name: "X",
    collector_number: "1",
    type_line: "Instant",
    mana_cost: "{U}{U}",
    colors: ["U"],
    cmc: 2,
    edhrec_rank: 10,
    image_uris: { small: `https://img/${name}.jpg`, normal: `https://img/${name}-n.jpg` },
    ...extra,
  };
}

async function post(handler: typeof share, body: Record<string, unknown>, auth?: string) {
  const res = fakeResponse();
  await handler(
    {
      method: "POST",
      body,
      headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), "x-forwarded-for": "1.2.3.4" },
      query: {},
      socket: { remoteAddress: "1.2.3.4" },
    } as never,
    res as never,
  );
  return { status: res.statusCode, body: res.body as Record<string, any> }; // oxlint-disable-line typescript/no-explicit-any
}

const cardsTable = () => state.tables.cube_checklist_cards;
const row = (id: string) => cardsTable().find((c) => c.id === id)!;

beforeEach(() => {
  state = createFakeState();
  state.tables.cube_checklists = [
    {
      id: LIST,
      name: "The Pauper Cube",
      cube_id: "thepaupercube",
      rarity_rule: "common",
      share_token: TOKEN,
      share_enabled: true,
      created_at: "2026-11-10T00:00:00.000Z",
      updated_at: "2026-11-10T00:00:00.000Z",
    },
  ];
  state.tables.cube_checklist_cards = [
    card(SKYFISHER, 0, "Kor Skyfisher", { color_category: "White" }),
    card(COUNTERSPELL, 1, "Counterspell", { type_line: "Instant", color_category: "Blue" }),
  ];
  state.sessions[STAFF] = { id: fakeId(), email: "jordan@geega-games.com", app_metadata: { role: "admin" } };
  scry.searchCards.mockReset();
  scry.searchPage.mockReset();
  cube.fetchCubeList.mockReset();
});

describe("share link", () => {
  it("only opens with a valid, switched-on token", async () => {
    expect((await post(share, { token: "nope", action: "get" })).status).toBe(404);
    expect((await post(share, { token: "x".repeat(32), action: "get" })).status).toBe(404);
    state.tables.cube_checklists[0].share_enabled = false;
    expect((await post(share, { token: TOKEN, action: "get" })).status).toBe(404);
  });

  it("loads the list, without the token or other admin details", async () => {
    const { status, body } = await post(share, { token: TOKEN, action: "get" });
    expect(status).toBe(200);
    expect(body.view.cards.map((c: { name: string }) => c.name)).toEqual(["Kor Skyfisher", "Counterspell"]);
    expect(body.view.rarityRule).toBe("common");
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("needs a name to mark cards, and credits it", async () => {
    expect((await post(share, { token: TOKEN, action: "found", cardId: SKYFISHER, found: true })).status).toBe(400);
    const { body } = await post(share, { token: TOKEN, who: "  Sam  ", action: "found", cardId: SKYFISHER, found: true });
    expect(body.card.foundBy).toBe("Sam");
    expect(row(SKYFISHER).found_at).toBeTruthy();
  });

  it("keeps the first finder's credit", async () => {
    await post(share, { token: TOKEN, who: "Sam", action: "found", cardId: SKYFISHER, found: true });
    const { body } = await post(share, { token: TOKEN, who: "Alex", action: "found", cardId: SKYFISHER, found: true });
    expect(body.alreadyFound).toBe(true);
    expect(body.card.foundBy).toBe("Sam");
  });

  it("swaps in a common, keeps the original, and undo puts it back", async () => {
    await post(share, { token: TOKEN, who: "Sam", action: "found", cardId: COUNTERSPELL, found: true });
    scry.searchCards.mockResolvedValueOnce([scryCard("Mana Leak", { cmc: 2 })]);
    const swapped = await post(share, { token: TOKEN, who: "Sam", action: "swap", cardId: COUNTERSPELL, newName: "mana leak" });
    expect(swapped.status).toBe(200);
    expect(scry.searchCards.mock.calls[0][0]).toBe('!"mana leak" game:paper r:common');
    expect(row(COUNTERSPELL)).toMatchObject({
      name: "Mana Leak",
      color_category: "Blue",
      original_name: "Counterspell",
      swapped_by: "Sam",
      found_at: null, // a different card hasn't been found yet
    });

    // Swapping again still remembers the cube's own card.
    scry.searchCards.mockResolvedValueOnce([scryCard("Prohibit")]);
    await post(share, { token: TOKEN, who: "Alex", action: "swap", cardId: COUNTERSPELL, newName: "Prohibit" });
    expect(row(COUNTERSPELL).original_name).toBe("Counterspell");

    await post(share, { token: TOKEN, who: "Alex", action: "unswap", cardId: COUNTERSPELL });
    expect(row(COUNTERSPELL)).toMatchObject({ name: "Counterspell", type_line: "Instant", original_name: null, swapped_at: null });
  });

  it("refuses a card that was never a common, and one already on the list", async () => {
    scry.searchCards.mockResolvedValueOnce([]);
    const rare = await post(share, { token: TOKEN, who: "Sam", action: "swap", cardId: COUNTERSPELL, newName: "Force of Will" });
    expect(rare.status).toBe(400);
    expect(rare.body.message).toMatch(/hasn't been printed at common/);

    const dup = await post(share, { token: TOKEN, who: "Sam", action: "swap", cardId: COUNTERSPELL, newName: "KOR SKYFISHER" });
    expect(dup.status).toBe(409);
    expect(row(COUNTERSPELL).name).toBe("Counterspell");
  });

  it("suggests similar commons that aren't already on the list", async () => {
    scry.searchCards
      .mockResolvedValueOnce([scryCard("Counterspell")]) // the card itself
      .mockResolvedValueOnce([scryCard("Kor Skyfisher"), scryCard("Mana Leak"), scryCard("Exclude", { cmc: 3, edhrec_rank: null })]);
    const { body } = await post(share, { token: TOKEN, action: "suggest", cardId: COUNTERSPELL });
    expect(scry.searchCards.mock.calls[1]).toEqual([
      'game:paper r:common -!"Counterspell" c=u t:instant mv>=1 mv<=3',
      "edhrec",
    ]);
    expect(body.options.map((o: { name: string }) => o.name)).toEqual(["Mana Leak", "Exclude"]);
    // The card on the list comes back too, so it can be shown beside the options.
    expect(body.current).toMatchObject({ name: "Counterspell", manaCost: "{U}{U}", typeLine: "Instant", edhrecRank: 10 });
    expect(body.options[0]).toMatchObject({ manaCost: "{U}{U}", edhrecRank: 10, imageSmall: "https://img/Mana Leak.jpg" });
  });

  it("searches by name only, within the rarity rule", async () => {
    scry.searchCards.mockResolvedValueOnce([scryCard("Lightning Bolt")]);
    const { body } = await post(share, { token: TOKEN, action: "search", query: 'bolt" r:mythic' });
    expect(scry.searchCards.mock.calls[0][0]).toBe('name:"bolt r:mythic" game:paper r:common');
    expect(body.options[0].name).toBe("Lightning Bolt");
  });
});

describe("staff side", () => {
  it("needs a staff session", async () => {
    expect((await post(admin, { action: "get", id: LIST })).status).toBe(401);
  });

  it("copies a cube in, commons only for a pauper cube whatever was asked", async () => {
    cube.fetchCubeList.mockResolvedValue({
      cubeId: "thepaupercube",
      name: "The Pauper Cube",
      cards: [
        { name: "Ponder", type: "Sorcery", colorCategory: "Blue" },
        { name: "ponder", type: "Sorcery", colorCategory: "Blue" },
        { name: "Preordain", type: "Sorcery", colorCategory: "Blue" },
      ],
    });
    state.defaults.cube_checklists = () => ({ id: fakeId(), share_enabled: true, created_at: "x", updated_at: "x" });
    state.defaults.cube_checklist_cards = () => ({ id: fakeId(), updated_at: "x" });
    const { status, body } = await post(admin, { action: "create", cubeId: "thepaupercube", rarityRule: "common_uncommon" }, STAFF);
    expect(status).toBe(201);
    const created = state.tables.cube_checklists.find((l) => l.id === body.checklist.id)!;
    expect(created).toMatchObject({ name: "The Pauper Cube", rarity_rule: "common", created_by: "jordan@geega-games.com" });
    expect(String(created.share_token)).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(cardsTable().filter((c) => c.checklist_id === created.id).map((c) => c.name)).toEqual(["Ponder", "Preordain"]);
  });

  it("credits staff by their email name, and can replace the link", async () => {
    const { body } = await post(admin, { id: LIST, action: "found", cardId: SKYFISHER, found: true }, STAFF);
    expect(body.card.foundBy).toBe("jordan");

    await post(admin, { id: LIST, action: "update", rotateToken: true }, STAFF);
    expect(state.tables.cube_checklists[0].share_token).not.toBe(TOKEN);
    expect((await post(share, { token: TOKEN, action: "get" })).status).toBe(404);
  });

  it("brings over this browser's old ticks without overwriting anyone's finds", async () => {
    row(SKYFISHER).found_by = "Sam";
    row(SKYFISHER).found_at = "2026-11-10T00:00:00.000Z";
    const { body } = await post(admin, { id: LIST, action: "import-found", names: ["kor skyfisher", "Counterspell", "Nope"] }, STAFF);
    expect(body.marked).toBe(1);
    expect(row(SKYFISHER).found_by).toBe("Sam");
    expect(row(COUNTERSPELL).found_by).toBe("jordan");
  });
});

describe("helpers", () => {
  it("knows pauper cubes are commons only", () => {
    expect(defaultRarityRule("thepaupercube")).toBe("common");
    expect(defaultRarityRule("vintagecube")).toBe("common_uncommon");
  });

  it("works out CubeCobra color categories and main types", () => {
    expect(colorCategoryFor("Land — Island Swamp", ["U", "B"])).toBe("Lands");
    expect(colorCategoryFor("Artifact Creature — Golem", [])).toBe("Colorless");
    expect(colorCategoryFor("Instant", ["U", "R"])).toBe("Multicolored");
    expect(colorCategoryFor("Creature — Kor", ["W"])).toBe("White");
    expect(mainType("Artifact Creature — Golem")).toBe("Creature");
    expect(mainType("Instant // Sorcery")).toBe("Instant");
  });

  it("merges refreshes by id without letting an older copy win", () => {
    const a = { id: "a", position: 0, updatedAt: "2026-01-02" } as never;
    const older = { id: "a", position: 0, updatedAt: "2026-01-01", name: "old" } as never;
    const b = { id: "b", position: 1, updatedAt: "2026-01-01" } as never;
    expect(mergeCards([a], [older, b])).toEqual([a, b]);
  });
});
