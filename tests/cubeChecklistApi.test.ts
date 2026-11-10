import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeId, fakeResponse, type FakeState } from "./helpers/fakeSupabase";
import {
  colorCategoryFor,
  defaultRarityRule,
  mainType,
  mergeCards,
  pairUpgrades,
  suggestionPool,
  type ChecklistCard,
  type SuggestionInfo,
} from "../src/store/lib/cubeChecklist";

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
const cube = vi.hoisted(() => ({ fetchCubeList: vi.fn(), fetchCubeRatings: vi.fn() }));

vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));
vi.mock("../api/_lib/scryfall.js", () => ({
  scryfallSearchCards: scry.searchCards,
  scryfallSearchPage: scry.searchPage,
}));
vi.mock("../api/_lib/cubeCobra.js", async (orig) => ({
  ...(await orig<typeof import("../api/_lib/cubeCobra")>()),
  fetchCubeList: cube.fetchCubeList,
  fetchCubeRatings: cube.fetchCubeRatings,
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
    elo: null,
    pick_count: null,
    mana_value: null,
    updated_at: "2026-11-10T00:00:00.000Z",
    ...extra,
  };
}

function suggestion(position: number, name: string, extra: Record<string, unknown> = {}) {
  return {
    checklist_id: LIST,
    position,
    name,
    card_name: name,
    type_line: "Instant",
    colors: ["U"],
    mana_value: 2,
    mana_cost: "{U}{U}",
    image_small: null,
    image_normal: null,
    edhrec_rank: null,
    paper_common: true,
    paper_uncommon: true,
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
      ratings_updated_at: new Date().toISOString(),
    },
  ];
  state.tables.cube_checklist_suggestions = [];
  state.tables.cube_checklist_cards = [
    card(SKYFISHER, 0, "Kor Skyfisher", { color_category: "White" }),
    card(COUNTERSPELL, 1, "Counterspell", { type_line: "Instant", color_category: "Blue" }),
  ];
  state.sessions[STAFF] = { id: fakeId(), email: "jordan@geega-games.com", app_metadata: { role: "admin" } };
  scry.searchCards.mockReset();
  scry.searchPage.mockReset();
  cube.fetchCubeList.mockReset();
  cube.fetchCubeRatings.mockReset();
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

  it("treats a two-part card's full name as the card already on the list", async () => {
    // CubeCobra lists the front face; Scryfall names the whole card.
    state.tables.cube_checklist_cards.push(card("22222222-2222-4222-8222-000000000003", 2, "Ardenvale Tactician"));

    // Not suggested…
    scry.searchCards
      .mockResolvedValueOnce([scryCard("Counterspell")])
      .mockResolvedValueOnce([scryCard("Ardenvale Tactician // Dizzying Swoop"), scryCard("Mana Leak")]);
    const suggest = await post(share, { token: TOKEN, action: "suggest", cardId: COUNTERSPELL });
    expect(suggest.body.options.map((o: { name: string }) => o.name)).toEqual(["Mana Leak"]);

    // …not in search results…
    scry.searchCards.mockResolvedValueOnce([scryCard("Ardenvale Tactician // Dizzying Swoop")]);
    const search = await post(share, { token: TOKEN, action: "search", query: "ardenvale" });
    expect(search.body.options).toEqual([]);

    // …and can't be swapped in, by either name.
    const byFull = await post(share, {
      token: TOKEN, who: "Sam", action: "swap", cardId: COUNTERSPELL, newName: "Ardenvale Tactician // Dizzying Swoop",
    });
    expect(byFull.status).toBe(409);
    // Accents and capitals don't make it a different card.
    const accented = await post(share, { token: TOKEN, who: "Sam", action: "swap", cardId: COUNTERSPELL, newName: "ARDENVALE TACTICIÁN" });
    expect(accented.status).toBe(409);
    // A name that only Scryfall knows is that card (its other half) is caught after the lookup.
    scry.searchCards.mockResolvedValueOnce([scryCard("Ardenvale Tactician // Dizzying Swoop")]);
    const backHalf = await post(share, { token: TOKEN, who: "Sam", action: "swap", cardId: COUNTERSPELL, newName: "Dizzying Swoop" });
    expect(scry.searchCards).toHaveBeenCalledTimes(4);
    expect(backHalf.status).toBe(409);
    expect(backHalf.body.message).toBe("Ardenvale Tactician // Dizzying Swoop is already on the list.");
    expect(row(COUNTERSPELL).name).toBe("Counterspell");
  });

  it("won't undo a swap if the cube's card is back on the list in another slot", async () => {
    scry.searchCards.mockResolvedValueOnce([scryCard("Mana Leak")]);
    await post(share, { token: TOKEN, who: "Sam", action: "swap", cardId: COUNTERSPELL, newName: "Mana Leak" });
    // Someone swaps Counterspell into the Kor Skyfisher slot.
    scry.searchCards.mockResolvedValueOnce([scryCard("Counterspell")]);
    expect((await post(share, { token: TOKEN, who: "Alex", action: "swap", cardId: SKYFISHER, newName: "Counterspell" })).status).toBe(200);

    const undo = await post(share, { token: TOKEN, who: "Sam", action: "unswap", cardId: COUNTERSPELL });
    expect(undo.status).toBe(409);
    expect(undo.body.message).toMatch(/Counterspell is on the list again in another slot/);
    expect(row(COUNTERSPELL).name).toBe("Mana Leak");
    expect(cardsTable().filter((c) => c.name === "Counterspell")).toHaveLength(1);
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

describe("suggestion list and upgrades", () => {
  it("puts cards from the suggestion list first in Better options, with their place on the list", async () => {
    state.tables.cube_checklist_suggestions = [
      suggestion(0, "Kor Skyfisher", { type_line: "Creature — Kor Soldier", colors: ["W"] }), // on the list already
      suggestion(1, "Memory Lapse"),
      suggestion(2, "Daze", { mana_value: 4 }), // 2 more than Counterspell: still close enough here
      suggestion(3, "Chainer's Edict", { colors: ["B"] }), // wrong color
      suggestion(4, "Arcane Denial", { paper_common: false }), // never a common
    ];
    scry.searchCards
      .mockResolvedValueOnce([scryCard("Counterspell")])
      .mockResolvedValueOnce([scryCard("Memory Lapse"), scryCard("Mana Leak")]);
    const { body } = await post(share, { token: TOKEN, action: "suggest", cardId: COUNTERSPELL });
    expect(body.options.map((o: { name: string; listRank?: number }) => [o.name, o.listRank ?? null])).toEqual([
      ["Memory Lapse", 2],
      ["Daze", 3],
      ["Mana Leak", null], // then the usual similar cards, without repeats
    ]);
  });

  it("pairs the lowest-rated cards with list cards in the same role", async () => {
    state.tables.cube_checklist_cards = [
      card(SKYFISHER, 0, "Kor Skyfisher", { color_category: "White", type_line: "Creature — Kor Soldier", elo: 1500, pick_count: 9000, mana_value: 2 }),
      card(COUNTERSPELL, 1, "Counterspell", { color_category: "Blue", type_line: "Instant", elo: 1450, pick_count: 9000, mana_value: 2 }),
      card("22222222-2222-4222-8222-000000000003", 2, "Mist Raven", { color_category: "Blue", type_line: "Creature — Bird", elo: 1100, pick_count: 800, mana_value: 4 }),
      card("22222222-2222-4222-8222-000000000004", 3, "Consider", { color_category: "Blue", type_line: "Instant", elo: 1050, pick_count: 900, mana_value: 1 }),
    ];
    state.tables.cube_checklist_suggestions = [
      suggestion(0, "Memory Lapse"), // blue spell, 2 -> replaces Consider (1)
      suggestion(1, "Man-o'-War", { type_line: "Creature — Jellyfish", mana_value: 3 }), // blue creature 3 -> Mist Raven (4)
    ];
    const { status, body } = await post(share, { token: TOKEN, action: "upgrades" });
    expect(status).toBe(200);
    expect(cube.fetchCubeRatings).not.toHaveBeenCalled(); // ratings are fresh
    // Only the weakest quarter is considered: 4 rated cards -> just Consider.
    expect(body.upgradesView.upgrades.map((u: { cut: { name: string }; add: { name: string } }) => [u.cut.name, u.add.name])).toEqual([
      ["Consider", "Memory Lapse"],
    ]);
    expect(body.upgradesView).toMatchObject({ ratedCount: 4, poolSize: 2 });
    expect(body.upgradesView.upgrades[0].add.listRank).toBe(1);
  });

  it("fetches CubeCobra ratings when they're a day old, and carries on if CubeCobra is down", async () => {
    state.tables.cube_checklists[0].ratings_updated_at = "2026-01-01T00:00:00.000Z";
    const setRatings = vi.fn(() => ({ data: 2, error: null }));
    state.rpc.cube_checklist_set_ratings = setRatings;
    cube.fetchCubeRatings.mockResolvedValueOnce([
      { name: "Kor Skyfisher", type: null, colorCategory: null, elo: 1500, pickCount: 9000, cmc: 2 },
      { name: "Ardenvale Tactician // Dizzying Swoop", type: null, colorCategory: null, elo: 1200, pickCount: 0, cmc: 3 },
    ]);
    expect((await post(share, { token: TOKEN, action: "upgrades" })).status).toBe(200);
    expect(setRatings).toHaveBeenCalledWith({
      p_checklist_id: LIST,
      p_ratings: [
        { key: "kor skyfisher", elo: 1500, pick_count: 9000, mana_value: 2 },
        { key: "ardenvale tactician", elo: 1200, pick_count: 0, mana_value: 3 },
      ],
    });

    cube.fetchCubeRatings.mockRejectedValueOnce(new Error("down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await post(share, { token: TOKEN, action: "upgrades" })).status).toBe(200);
    warn.mockRestore();
  });

  it("lets staff save a pasted list and reports what can't be used", async () => {
    state.rpc.cube_checklist_lookup_cards = (args) => ({
      data: (args.p_names as string[]).flatMap((n) =>
        n === "Not A Card"
          ? [{ requested: n, card_name: null, colors: [], paper_common: false, paper_uncommon: false }]
          : [
              {
                requested: n,
                card_name: n === "lorien revealed" ? "Lórien Revealed" : n,
                type_line: "Instant",
                colors: ["U"],
                mana_value: 2,
                paper_common: n !== "Arcane Denial",
                paper_uncommon: true,
              },
            ],
      ),
      error: null,
    });
    const pasted = "1 Memory Lapse\n2x Arcane Denial\nCounterspell\n# a comment\n\nNot A Card\nmemory lapse\n";
    const { status, body } = await post(admin, { id: LIST, action: "suggestions-set", names: pasted }, STAFF);
    expect(status).toBe(200);
    expect(body.summary).toEqual({
      saved: 4,
      usable: 1,
      alreadyOnList: 1,
      notAllowed: ["Arcane Denial"],
      notFound: ["Not A Card"],
    });
    expect(state.tables.cube_checklist_suggestions.map((r) => [r.position, r.name, r.card_name])).toEqual([
      [0, "Memory Lapse", "Memory Lapse"],
      [1, "Arcane Denial", "Arcane Denial"],
      [2, "Counterspell", "Counterspell"],
      [3, "Not A Card", null],
    ]);
    // Friends with the share link can't change it.
    expect((await post(share, { token: TOKEN, action: "suggestions-set", names: "Ponder" })).status).toBe(400);

    const got = await post(admin, { id: LIST, action: "suggestions-get" }, STAFF);
    expect(got.body.names).toEqual(["Memory Lapse", "Arcane Denial", "Counterspell", "Not A Card"]);
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

  it("only calls a card weak with enough picks, and leaves swapped-in cards alone", () => {
    const base = { originalName: null, swappedBy: null, swappedAt: null, foundBy: null, foundAt: null, updatedAt: "x", typeLine: "Instant", colorCategory: "Blue" };
    const cards = [
      { ...base, id: "1", position: 0, name: "New Card", elo: 900, pickCount: 3, manaValue: 2 }, // too few picks
      { ...base, id: "2", position: 1, name: "Swapped In", elo: 950, pickCount: 500, manaValue: 2, originalName: "X", swappedAt: "x" },
      { ...base, id: "3", position: 2, name: "Weak", elo: 1000, pickCount: 500, manaValue: 2 },
      { ...base, id: "4", position: 3, name: "Fine", elo: 1300, pickCount: 500, manaValue: 2 },
    ] as (ChecklistCard & { manaValue: number })[];
    const pool: SuggestionInfo[] = [
      { position: 0, name: "A", cardName: "A", typeLine: "Instant", colors: ["U"], manaValue: 2, manaCost: null, imageSmall: null, imageNormal: null, edhrecRank: null, paperCommon: true, paperUncommon: true },
    ];
    expect(pairUpgrades(cards, pool).map((p) => p.cut.name)).toEqual(["Weak"]);
  });

  it("builds the pool best first, allowed rarity only, one of each, nothing already on the list", () => {
    const s = (position: number, name: string, paperCommon = true): SuggestionInfo => ({
      position, name, cardName: name, typeLine: "Instant", colors: [], manaValue: 1, manaCost: null, imageSmall: null, imageNormal: null, edhrecRank: null, paperCommon, paperUncommon: true,
    });
    const pool = suggestionPool([s(2, "C"), s(0, "A"), s(1, "B", false), s(3, "a"), s(4, "On List")], new Set(["on list"]), "common");
    expect(pool.map((p) => p.name)).toEqual(["A", "C"]);
  });

  it("merges refreshes by id without letting an older copy win", () => {
    const a = { id: "a", position: 0, updatedAt: "2026-01-02" } as never;
    const older = { id: "a", position: 0, updatedAt: "2026-01-01", name: "old" } as never;
    const b = { id: "b", position: 1, updatedAt: "2026-01-01" } as never;
    expect(mergeCards([a], [older, b])).toEqual([a, b]);
  });
});
