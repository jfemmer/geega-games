import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// The storefront's visitor statistics in PGlite (a real Postgres in
// WebAssembly): the tracking migrations as they ran on production, then
// 20261027050000_visitor_insights.sql on top of visits recorded before it.
// What's checked: past machine visits are marked once, the admin Overview
// and the staff digest count people only, searches and campaign tags add
// up, and none of it is open to anyone but staff.

const migration = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const BEFORE = [
  "20260924070000_site_visitor_tracking.sql",
  "20260924130000_site_visitor_city_region.sql",
  "20261003170000_site_visitor_counts.sql",
].map(migration);
const INSIGHTS = migration("20261027050000_visitor_insights.sql");

const STANDINS = `
create role anon; create role authenticated; create role service_role;
create schema cron;
create table cron.job (jobname text primary key, schedule text not null, command text not null);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
  insert into cron.job values (p_name, p_schedule, p_command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning 1::bigint $$;
create function public.is_staff() returns boolean language sql stable as $$
  select coalesce(current_setting('test.staff', true), '') = 'on' $$;
`;

let db: PGlite;
let n = 0;
/** A 32-character anonymous id. */
const hash = (label: string) => `${label}${"0".repeat(32)}`.slice(0, 32);

interface View {
  visitor: string;
  path: string;
  minutesAgo: number;
  referrer?: string | null;
  country?: string | null;
  city?: string | null;
  region?: string | null;
  device?: "mobile" | "tablet" | "desktop";
  engaged?: boolean | null;
  utmSource?: string | null;
  utmCampaign?: string | null;
}

async function view(v: View, withNewColumns = true) {
  n += 1;
  const cols = ["viewed_at", "visitor_hash", "path", "referrer_host", "country", "region", "city", "device"];
  const vals: unknown[] = [
    new Date(Date.now() - v.minutesAgo * 60_000).toISOString(),
    hash(v.visitor),
    v.path,
    v.referrer ?? null,
    v.country === undefined ? "US" : v.country,
    v.region ?? null,
    v.city ?? null,
    v.device ?? "mobile",
  ];
  if (withNewColumns) {
    cols.push("engaged", "utm_source", "utm_campaign");
    vals.push(v.engaged === undefined ? true : v.engaged, v.utmSource ?? null, v.utmCampaign ?? null);
  }
  await db.query(
    `insert into public.site_page_views (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    vals,
  );
}

async function search(visitor: string, query: string, results: number, minutesAgo: number, filtered = false) {
  await db.query(
    "insert into public.site_searches (searched_at, visitor_hash, query, results, filtered, device) values ($1, $2, $3, $4, $5, 'mobile')",
    [new Date(Date.now() - minutesAgo * 60_000).toISOString(), hash(visitor), query, results, filtered],
  );
}

async function traffic(range = "30d"): Promise<Record<string, unknown>> {
  await db.exec("set test.staff = 'on'");
  const { rows } = await db.query<{ t: Record<string, unknown> }>("select public.admin_site_traffic($1) as t", [range]);
  await db.exec("set test.staff = 'off'");
  return rows[0].t;
}

const DAY = 24 * 60;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STANDINS);
  for (const sql of BEFORE) await db.exec(sql);

  // Recorded before the update (no engagement, no campaign columns yet).
  const legacy = async (v: View) => view(v, false);
  // Facebook's servers checking a link: three Meta data centers in one second.
  await legacy({ visitor: "metaA", path: "/sell-my-collection", minutesAgo: 3 * DAY, referrer: "m.facebook.com", city: "Prineville", region: "OR" });
  await legacy({ visitor: "metaB", path: "/sell-my-collection", minutesAgo: 3 * DAY, referrer: "facebook.com", city: "Luleå", country: "SE" });
  await legacy({ visitor: "metaC", path: "/sell-my-collection", minutesAgo: 3 * DAY, referrer: "m.facebook.com", city: "Forest City", region: "NC", device: "desktop" });
  // One Meta visit with a second page (no referrer on it): still a machine.
  await legacy({ visitor: "metaD", path: "/privacy", minutesAgo: 4 * DAY, referrer: "m.facebook.com", city: "Prineville", region: "OR" });
  await legacy({ visitor: "metaD", path: "/sell-my-collection", minutesAgo: 4 * DAY - 1, city: "Prineville", region: "OR" });
  // A server farm abroad: one page, no referring site.
  await legacy({ visitor: "farm", path: "/", minutesAgo: 5 * DAY, country: "DE", city: "Falkenstein", device: "desktop" });
  // A person in Fort Worth arriving from Facebook... with a different referrer: kept.
  await legacy({ visitor: "fwPerson", path: "/shop", minutesAgo: 6 * DAY, referrer: "google.com", city: "Fort Worth", region: "TX" });
  // A real one-page visitor from St. Louis, and a real three-page visit.
  await legacy({ visitor: "stl", path: "/", minutesAgo: DAY + 60, referrer: "google.com", city: "St. Louis", region: "MO" });
  await legacy({ visitor: "multi", path: "/", minutesAgo: DAY + 50, referrer: "google.com", city: "St. Louis", region: "MO" });
  await legacy({ visitor: "multi", path: "/shop", minutesAgo: DAY + 49, city: "St. Louis", region: "MO" });
  await legacy({ visitor: "multi", path: "/", minutesAgo: DAY + 48, city: "St. Louis", region: "MO" });
  // A one-page visit from Canada that came from Google: a person, kept.
  await legacy({ visitor: "canada", path: "/sell-my-collection", minutesAgo: 7 * DAY, referrer: "google.com", country: "CA", city: "Toronto" });

  await db.exec(INSIGHTS);
});

afterAll(async () => {
  await db.close();
});

describe("past visits", () => {
  it("marks Facebook's servers and one-page visits from server farms abroad, and nothing else", async () => {
    const { rows } = await db.query<{ visitor_hash: string; is_bot: boolean }>(
      "select distinct visitor_hash, is_bot from public.site_page_views order by visitor_hash",
    );
    const bots = rows.filter((r) => r.is_bot).map((r) => r.visitor_hash.replace(/0+$/, ""));
    expect(bots.sort()).toEqual(["farm", "metaA", "metaB", "metaC", "metaD"]);
    // metaD's second page carries no referrer; the visit is still left out as a whole.
    const { rows: metaD } = await db.query<{ is_bot: boolean }>("select is_bot from public.site_page_views where visitor_hash = $1 order by viewed_at", [hash("metaD")]);
    expect(metaD.map((r) => r.is_bot)).toEqual([true, false]);
  });

  it("is safe to run again: newer views are never marked", async () => {
    await view({ visitor: "newOne", path: "/", minutesAgo: 30, country: "DE", engaged: false });
    await db.exec(INSIGHTS);
    const { rows } = await db.query<{ is_bot: boolean }>("select is_bot from public.site_page_views where visitor_hash = $1", [hash("newOne")]);
    expect(rows).toEqual([{ is_bot: false }]);
    await db.exec(`delete from public.site_page_views where visitor_hash = '${hash("newOne")}'`);
  });
});

describe("the admin Overview counts people only", () => {
  beforeAll(async () => {
    // After the update: a person who scrolled (engaged), one who left without
    // doing anything (not a person), and a two-page visit whose pages were
    // both sent on leaving (two pages: a person).
    await view({ visitor: "scroller", path: "/shop", minutesAgo: 60, referrer: "l.facebook.com", engaged: true, utmSource: "facebook", utmCampaign: "picks-20261027", city: "St. Louis", region: "MO" });
    await view({ visitor: "ghost", path: "/shop", minutesAgo: 50, engaged: false, device: "desktop" });
    await view({ visitor: "twoPages", path: "/", minutesAgo: 40, engaged: false, utmSource: "facebook", utmCampaign: "picks-20261027", city: "Ballwin", region: "MO" });
    await view({ visitor: "twoPages", path: "/shop/card/sheoldred-the-apocalypse", minutesAgo: 39, engaged: false, city: "Ballwin", region: "MO" });
    // Someone on the site right now.
    await view({ visitor: "live", path: "/shop", minutesAgo: 2, engaged: true, city: "St. Louis", region: "MO" });
  });

  it("counts visits by people, their pages, and the machines left out", async () => {
    const t = await traffic();
    // People: fwPerson, stl, multi (3 pages), canada, scroller, twoPages (2 pages), live.
    expect(t.visitors).toBe(7);
    expect(t.pageViews).toBe(1 + 1 + 3 + 1 + 1 + 2 + 1);
    // Left out: four Meta visits, the server farm, and the visit with no sign of a person.
    expect(t.filteredVisits).toBe(6);
    expect(t.liveNow).toBe(1);
  });

  it("lists pages, devices, countries and places from people's visits only", async () => {
    const t = await traffic();
    const pages = Object.fromEntries((t.topPages as { label: string; value: number }[]).map((p) => [p.label, p.value]));
    expect(pages["/sell-my-collection"]).toBe(1); // Canada's; none of Facebook's servers'
    expect(pages["/privacy"]).toBeUndefined();
    expect(pages["/shop"]).toBe(4); // fwPerson, multi, scroller, live; not the ghost
    expect(t.countries).toEqual([
      { label: "US", value: 6 },
      { label: "CA", value: 1 },
    ]);
    const cities = (t.cities as { city: string; value: number }[]).map((c) => c.city);
    expect(cities).not.toContain("Prineville");
    expect(cities).not.toContain("Falkenstein");
    expect(cities).toContain("Fort Worth");
  });

  it("counts each visit once, by the site it arrived from", async () => {
    const t = await traffic();
    const referrers = Object.fromEntries((t.referrers as { label: string; value: number }[]).map((r) => [r.label, r.value]));
    // google.com: fwPerson, stl, multi, canada. multi's later pages no longer count as "Direct".
    expect(referrers["google.com"]).toBe(4);
    expect(referrers["l.facebook.com"]).toBe(1);
    expect(referrers["Direct / unknown"]).toBe(2); // twoPages and live
    expect(referrers["m.facebook.com"]).toBeUndefined();
  });

  it("shows recent visitors who are people", async () => {
    const t = await traffic();
    const recent = t.recentVisitors as { lastPage: string; pages: number; city: string | null }[];
    expect(recent[0]).toMatchObject({ lastPage: "/shop", pages: 1, city: "St. Louis" }); // live
    expect(recent.find((r) => r.lastPage === "/shop/card/sheoldred-the-apocalypse")).toMatchObject({ pages: 2 });
    expect(recent.some((r) => r.city === "Prineville")).toBe(false);
    expect(recent).toHaveLength(5); // stl, multi, scroller, twoPages, live (within 2 days; the ghost is left out)
  });

  it("counts visits that arrived on a tagged link", async () => {
    const t = await traffic();
    expect(t.campaigns).toEqual([{ source: "facebook", campaign: "picks-20261027", value: 2 }]);
  });
});

describe("shop searches", () => {
  beforeAll(async () => {
    await search("s1", "sheoldred", 0, 300);
    await search("s2", "sheoldred", 0, 200);
    await search("s2", "sheoldred", 0, 190);
    await search("s3", "lightning bolt", 4, 100);
    await search("s4", "ragavan", 0, 90);
    await search("s4", "ragavan", 1, 10); // stocked since: no longer "not found"
    await search("s5", "goblin", 0, 80, true); // filters on: not counted as not found
    await search("s6", "old search", 0, 40 * DAY); // outside the range
  });

  it("lists the most searched queries, how many people and what the latest search found", async () => {
    const t = await traffic();
    const top = t.searches as { query: string; searches: number; people: number; results: number }[];
    expect(top[0]).toMatchObject({ query: "sheoldred", searches: 3, people: 2, results: 0 });
    expect(top.map((s) => s.query)).toEqual(["sheoldred", "ragavan", "goblin", "lightning bolt"]);
  });

  it("lists searches that found nothing, without filters, as of their latest search", async () => {
    const t = await traffic();
    expect((t.missedSearches as { query: string }[]).map((s) => s.query)).toEqual(["sheoldred"]);
  });

  it("is only open to staff", async () => {
    await db.exec("set test.staff = 'off'");
    await expect(db.query("select public.admin_site_traffic('30d')")).rejects.toThrow(/not authorized/);
    const { rows } = await db.query<{ anon: boolean; auth: boolean }>(
      "select has_table_privilege('anon', 'public.site_searches', 'select') as anon, has_table_privilege('authenticated', 'public.site_searches', 'insert') as auth",
    );
    expect(rows[0]).toEqual({ anon: false, auth: false });
    const { rows: fn } = await db.query<{ anon: boolean; auth: boolean }>(
      "select has_function_privilege('anon', 'public.site_visits(timestamptz, timestamptz)', 'execute') as anon, has_function_privilege('authenticated', 'public.site_visits(timestamptz, timestamptz)', 'execute') as auth",
    );
    expect(fn[0]).toEqual({ anon: false, auth: false });
  });

  it("keeps 13 months of searches", async () => {
    const { rows } = await db.query<{ schedule: string; command: string }>("select schedule, command from cron.job where jobname = 'geega-site-searches-retention'");
    expect(rows[0].schedule).toBe("25 4 * * *");
    expect(rows[0].command).toContain("interval '13 months'");
  });
});

describe("the staff digest", () => {
  it("counts people and their pages in a time window", async () => {
    const { rows } = await db.query<{ visitors: string; page_views: string }>(
      "select * from public.site_visitor_counts(now() - interval '3 hours', now())",
    );
    // scroller, twoPages (2 pages) and live; not the ghost.
    expect(rows[0]).toEqual({ visitors: 3, page_views: 4 });
  });
});
