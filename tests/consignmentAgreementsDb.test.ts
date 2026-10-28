import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { STANDINS, UPSERT } from "./helpers/tradeDbStandins";

// Consignments, Phase 2 (supabase/migrations/20261028150000_consignment_agreements.sql)
// in PGlite: versions lock once published; an invitation freezes its text and
// terms; signing checks the invited consignor, the exact text, every
// acknowledgment and election, and records everything at once; signing
// records can't be changed; a consignor sees only their own consignments.

const MIGRATIONS = [
  "../supabase/migrations/20261024170000_trades.sql",
  "../supabase/migrations/20261025200000_trade_center.sql",
  "../supabase/migrations/20261026233000_trade_function_search_path.sql",
  "../supabase/migrations/20261027230000_trade_local_pickup.sql",
  "../supabase/migrations/20261028010000_trade_local_terms.sql",
  "../supabase/migrations/20261028030000_trade_meet_spot.sql",
  "../supabase/migrations/20261028120000_consignment_foundation.sql",
  "../supabase/migrations/20261028150000_consignment_agreements.sql",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

// oxlint-disable-next-line typescript/no-explicit-any
type Row = Record<string, any>;

let db: PGlite;
const one = async (q: string, params?: unknown[]): Promise<Row> => (await db.query<Row>(q, params)).rows[0];
async function errorOf(statement: string, params?: unknown[]): Promise<{ code?: string; message?: string } | null> {
  try {
    await db.query(statement, params);
    return null;
  } catch (e) {
    return e as { code?: string; message?: string };
  }
}
const asRole = (role: string) => db.query(`select set_config('test.role', $1, false)`, [role]);
const asUser = (uid: string) => db.query(`select set_config('test.uid', $1, false)`, [uid]);
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const pat = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const eve = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const BODY = "## 1. Parties\n\n" + "Consignment terms. ".repeat(20) + "\n\n{{fee_table}}";
const RENDERED = "## 1. Parties\n\n" + "Consignment terms. ".repeat(20) + "\n\n| Channel | Fee |";
const ACKS = { esign: true, reviewed: true, commission: true, deductions: true, shipping_liability: true, inspection: true, term: true, estimates: true };
const CHANNELS = { website: true, tcgplayer: false, ebay: true };

let versionId: string;
let consignmentId: string;

async function invite(token = "a".repeat(64), expires = "now() + interval '14 days'"): Promise<string> {
  await asRole("service_role");
  try {
    return (
      await one(
        `select public.consignment_create_invitation($1, $2, $3, '{"commission":{}}'::jsonb, 'Pat@X.com', $4, ${expires}, 'jacob') as id`,
        [consignmentId, versionId, RENDERED, token],
      )
    ).id;
  } finally {
    await asRole("");
  }
}

function sign(agreementId: string, over: Partial<{ user: string; email: string; name: string; sig: string; acks: object; channels: object; insurance: boolean | null; hash: string }> = {}) {
  return errorOf(
    `select public.consignment_sign_agreement($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, '203.0.113.9', 'Mozilla/5.0') as id`,
    [
      agreementId,
      over.user ?? pat,
      over.email ?? "pat@x.com",
      over.name ?? "Pat  Consignor",
      over.sig ?? "pat consignor",
      JSON.stringify(over.acks ?? ACKS),
      JSON.stringify(over.channels ?? CHANNELS),
      over.insurance === undefined ? true : over.insurance,
      over.hash ?? sha(RENDERED),
    ],
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STANDINS);
  await db.exec(UPSERT);
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;`);
  for (const sql of MIGRATIONS) await db.exec(sql);
  await db.query(`insert into auth.users (id, email) values ($1, 'pat@x.com'), ($2, 'eve@x.com')`, [pat, eve]);
  const consignor = await one(`insert into public.consignors (legal_name, email) values ('Pat Consignor', 'pat@x.com') returning id`);
  consignmentId = (await one(`insert into public.consignments (consignor_id) values ($1) returning id`, [consignor.id])).id;
  versionId = (await one(`insert into public.consignment_agreement_versions (version_number, body_md) values (2, $1) returning id`, [BODY])).id;
});

afterAll(async () => {
  await db?.close();
});

describe("agreement versions", () => {
  it("seeds the drafted agreement as version 1, as a draft", async () => {
    const v1 = await one(`select status, title, body_md, body_sha256 from public.consignment_agreement_versions where version_number = 1`);
    expect(v1.status).toBe("draft");
    expect(v1.body_md).toMatch(/## 9\. Governing law/);
    expect(v1.body_md).toContain("{{fee_table}}");
    expect(v1.body_sha256).toBe(sha(v1.body_md));
  });

  it("can't be sent until published", async () => {
    await asRole("service_role");
    const err = await errorOf(
      `select public.consignment_create_invitation($1, $2, $3, '{}'::jsonb, 'pat@x.com', $4, now() + interval '1 day', 'jacob')`,
      [consignmentId, versionId, RENDERED, "b".repeat(64)],
    );
    await asRole("");
    expect(err?.code).toBe("GC032");
  });

  it("locks the text once published, and keeps it", async () => {
    await db.query(`update public.consignment_agreement_versions set body_md = body_md || ' Edited.' where id = $1`, [versionId]);
    await db.query(`update public.consignment_agreement_versions set status = 'published', published_at = now() where id = $1`, [versionId]);
    expect((await errorOf(`update public.consignment_agreement_versions set body_md = 'x' where id = $1`, [versionId]))?.code).toBe("GC021");
    expect((await errorOf(`delete from public.consignment_agreement_versions where id = $1`, [versionId]))?.code).toBe("GC020");
    // Only one version is offered at a time.
    const second = await errorOf(`update public.consignment_agreement_versions set status = 'published', published_at = now() where version_number = 1`);
    expect(second?.code).toBe("23505");
  });
});

describe("invitations", () => {
  it("freezes the rendered text with its hash and moves the consignment to awaiting signature", async () => {
    const id = await invite();
    const a = await one(`select status, rendered_sha256, invited_email from public.consignment_agreements where id = $1`, [id]);
    expect(a).toEqual({ status: "pending", rendered_sha256: sha(RENDERED), invited_email: "pat@x.com" });
    expect((await one(`select status from public.consignments where id = $1`, [consignmentId])).status).toBe("awaiting_signature");
    expect((await errorOf(`update public.consignment_agreements set rendered_md = rendered_md || 'x' where id = $1`, [id]))?.code).toBe("GC024");
    expect((await errorOf(`delete from public.consignment_agreements where id = $1`, [id]))?.code).toBe("GC023");
  });

  it("voids the open invitation when a new one is sent", async () => {
    const before = (await one(`select id from public.consignment_agreements where status = 'pending'`)).id;
    const after = await invite("c".repeat(64));
    expect((await one(`select status, void_reason from public.consignment_agreements where id = $1`, [before]))).toEqual({
      status: "void",
      void_reason: "Replaced by a new invitation",
    });
    await asRole("service_role");
    expect((await sign(before))?.code).toBe("GC035");
    await asRole("");
    expect(after).not.toBe(before);
  });

  it("is only for the service role", async () => {
    const err = await errorOf(
      `select public.consignment_create_invitation($1, $2, $3, '{}'::jsonb, 'pat@x.com', $4, now() + interval '1 day', 'x')`,
      [consignmentId, versionId, RENDERED, "d".repeat(64)],
    );
    expect(err?.code).toBe("42501");
  });
});

describe("signing", () => {
  const pending = async () => (await one(`select id from public.consignment_agreements where status = 'pending'`)).id as string;

  it("refuses anyone but the invited consignor", async () => {
    await asRole("service_role");
    try {
      expect((await sign(await pending(), { user: eve, email: "eve@x.com" }))?.code).toBe("GC036");
    } finally {
      await asRole("");
    }
  });

  it("refuses text other than what was frozen, and missing answers", async () => {
    await asRole("service_role");
    try {
      const id = await pending();
      expect((await sign(id, { hash: sha(RENDERED + " ") }))?.code).toBe("GC037");
      expect((await sign(id, { acks: { ...ACKS, inspection: false } }))?.code).toBe("GC038");
      expect((await sign(id, { channels: { website: true, tcgplayer: false } }))?.code).toBe("GC038");
      expect((await sign(id, { channels: { website: false, tcgplayer: false, ebay: false } }))?.message).toMatch(/at least one sales channel/);
      expect((await sign(id, { insurance: null }))?.code).toBe("GC038");
      expect((await sign(id, { sig: "P. Consignor" }))?.code).toBe("GC039");
      // None of those left a trace.
      expect((await one(`select count(*)::int as n from public.consignment_signatures`)).n).toBe(0);
    } finally {
      await asRole("");
    }
  });

  it("records the signature, elections and account link together", async () => {
    await asRole("service_role");
    try {
      const id = await pending();
      expect(await sign(id)).toBeNull();
      const s = await one(`select * from public.consignment_signatures where agreement_id = $1`, [id]);
      expect(s).toMatchObject({
        legal_name: "Pat Consignor",
        typed_signature: "pat consignor",
        signer_email: "pat@x.com",
        user_id: pat,
        additional_insurance: true,
        agreement_sha256: sha(RENDERED),
        ip: "203.0.113.9",
        user_agent: "Mozilla/5.0",
        channels: CHANNELS,
      });
      expect(s.record_sha256).toMatch(/^[0-9a-f]{64}$/);
      const c = await one(`select status, signed_at from public.consignments where id = $1`, [consignmentId]);
      expect(c.status).toBe("signed");
      expect(c.signed_at).not.toBeNull();
      expect((await one(`select user_id from public.consignors limit 1`)).user_id).toBe(pat);
      const elections = (await one(`select public.consignment_current_elections($1) as e`, [consignmentId])).e;
      expect(elections).toEqual({ channels: CHANNELS, additionalInsurance: true });
      // Signing twice is refused.
      expect((await sign(id))?.code).toBe("GC034");
    } finally {
      await asRole("");
    }
  });

  it("keeps signing records and election history unchangeable, except to attach the PDF once", async () => {
    const s = await one(`select id from public.consignment_signatures limit 1`);
    expect((await errorOf(`update public.consignment_signatures set legal_name = 'Someone Else' where id = $1`, [s.id]))?.code).toBe("GC028");
    expect((await errorOf(`delete from public.consignment_signatures where id = $1`, [s.id]))?.code).toBe("GC027");
    await db.query(`update public.consignment_signatures set pdf_path = 'x/1.pdf', pdf_sha256 = $2, pdf_generated_at = now() where id = $1`, [s.id, "f".repeat(64)]);
    expect((await errorOf(`update public.consignment_signatures set pdf_path = 'x/2.pdf' where id = $1`, [s.id]))?.code).toBe("GC028");
    expect((await errorOf(`update public.consignment_channel_authorizations set authorized = false`))?.code).toBe("GC029");
    expect((await errorOf(`insert into public.consignment_signatures (agreement_id) values (gen_random_uuid())`))?.code).toBe("GC026");
  });

  it("can't be resent once signed", async () => {
    await asRole("service_role");
    const err = await errorOf(
      `select public.consignment_create_invitation($1, $2, $3, '{}'::jsonb, 'pat@x.com', $4, now() + interval '1 day', 'x')`,
      [consignmentId, versionId, RENDERED, "e".repeat(64)],
    );
    await asRole("");
    expect(err?.code).toBe("GC031");
  });
});

describe("a consignor's own view", () => {
  it("shows Pat their consignment and agreement, and Eve nothing", async () => {
    await asUser(pat);
    const mine = (await one(`select public.my_consignments() as m`)).m;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ consignmentNumber: 1001, status: "signed", elections: { channels: CHANNELS, additionalInsurance: true } });
    expect(mine[0].agreements).toHaveLength(1);
    expect(mine[0].agreements[0]).toMatchObject({ status: "signed", versionNumber: 2, hasPdf: true });
    expect(JSON.stringify(mine)).not.toContain("invite_token_hash");
    await asUser(eve);
    expect((await one(`select public.my_consignments() as m`)).m).toEqual([]);
    await asUser("");
  });
});
