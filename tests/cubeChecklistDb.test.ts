import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// supabase/migrations/20261110060000_cube_checklists.sql in PGlite: the
// tables, the one-card-per-list rule (case-insensitive), the found/swap
// consistency checks, updated_at from the database clock, cascade delete,
// and that the browser roles can't write.

const MIGRATION = readFileSync(
  new URL("../supabase/migrations/20261110060000_cube_checklists.sql", import.meta.url),
  "utf8",
);
const ONE_OF_EACH = readFileSync(
  new URL("../supabase/migrations/20261110200000_cube_checklist_one_of_each.sql", import.meta.url),
  "utf8",
);

const STANDINS = `
create role anon; create role authenticated; create role service_role;
create function public.is_staff() returns boolean language sql stable as $$ select false $$;
`;

// oxlint-disable-next-line typescript/no-explicit-any
type Row = Record<string, any>;
let db: PGlite;
const one = async (q: string, params?: unknown[]): Promise<Row> => (await db.query<Row>(q, params)).rows[0];
async function errorCode(q: string, params?: unknown[]): Promise<string | null> {
  try {
    await db.query(q, params);
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "error";
  }
}

let listId = "";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STANDINS);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION); // safe to run twice
  await db.exec(ONE_OF_EACH);
  await db.exec(ONE_OF_EACH);
  listId = (
    await one(
      `insert into public.cube_checklists (name, cube_id, share_token) values ('The Pauper Cube', 'thepaupercube', repeat('a', 32)) returning id`,
    )
  ).id;
  await db.query(
    `insert into public.cube_checklist_cards (checklist_id, position, name) values ($1, 0, 'Kor Skyfisher'), ($1, 1, 'Counterspell')`,
    [listId],
  );
});
afterAll(() => db.close());

describe("cube checklist tables", () => {
  it("defaults to commons only, with the link on", async () => {
    const list = await one(`select rarity_rule, share_enabled from public.cube_checklists where id = $1`, [listId]);
    expect(list).toEqual({ rarity_rule: "common", share_enabled: true });
  });

  it("keeps each card on a list once, ignoring case", async () => {
    expect(
      await errorCode(
        `insert into public.cube_checklist_cards (checklist_id, position, name) values ($1, 2, 'counterspell')`,
        [listId],
      ),
    ).toBe("23505");
  });

  it("counts a two-part card by its front face, so the full name is a duplicate too", async () => {
    await db.query(
      `insert into public.cube_checklist_cards (checklist_id, position, name) values ($1, 5, 'Ardenvale Tactician')`,
      [listId],
    );
    expect(
      await errorCode(
        `insert into public.cube_checklist_cards (checklist_id, position, name) values ($1, 6, 'ardenvale tactician // Dizzying Swoop')`,
        [listId],
      ),
    ).toBe("23505");
    // A swap that would turn another slot into it is refused the same way.
    expect(
      await errorCode(
        `update public.cube_checklist_cards set name = 'Ardenvale Tactician // Dizzying Swoop', original_name = name, swapped_at = now() where name = 'Counterspell'`,
      ),
    ).toBe("23505");
    const idx = await db.query<Row>(`select indexname from pg_indexes where tablename = 'cube_checklist_cards' and indexname like '%uidx' order by 1`);
    expect(idx.rows.map((r) => r.indexname)).toEqual(["cube_checklist_cards_card_uidx"]);
  });

  it("refuses half-recorded finds and swaps, bad rarity rules and bad cube ids", async () => {
    expect(
      await errorCode(`update public.cube_checklist_cards set found_by = 'Sam' where name = 'Kor Skyfisher'`),
    ).toBe("23514");
    expect(
      await errorCode(`update public.cube_checklist_cards set original_name = 'Ponder' where name = 'Kor Skyfisher'`),
    ).toBe("23514");
    expect(await errorCode(`update public.cube_checklists set rarity_rule = 'rare'`)).toBe("23514");
    expect(
      await errorCode(
        `insert into public.cube_checklists (name, cube_id, share_token) values ('x', '../etc', repeat('b', 32))`,
      ),
    ).toBe("23514");
  });

  it("stamps updated_at from the database on every change", async () => {
    await db.query(`update public.cube_checklist_cards set updated_at = '2000-01-01' where name = 'Kor Skyfisher'`);
    const card = await one(
      `update public.cube_checklist_cards set found_by = 'Sam', found_at = now() where name = 'Kor Skyfisher' returning updated_at`,
    );
    expect(new Date(card.updated_at).getFullYear()).toBeGreaterThan(2000);
  });

  it("gives the browser roles no write access", async () => {
    const grants = await db.query<Row>(
      `select grantee, privilege_type from information_schema.role_table_grants
       where table_name in ('cube_checklists', 'cube_checklist_cards') and grantee in ('anon', 'authenticated')
       order by grantee, privilege_type`,
    );
    expect(grants.rows).toEqual([
      { grantee: "authenticated", privilege_type: "SELECT" },
      { grantee: "authenticated", privilege_type: "SELECT" },
    ]);
  });

  it("deletes a list's cards with the list", async () => {
    await db.query(`delete from public.cube_checklists where id = $1`, [listId]);
    expect((await one(`select count(*)::int as n from public.cube_checklist_cards`)).n).toBe(0);
  });
});
