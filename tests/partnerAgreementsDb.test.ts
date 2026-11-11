import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// Partner agreements (supabase/migrations/20261111010000_partner_agreements.sql)
// in PGlite: sending freezes the text with its hash and replaces any open
// link; signing checks the link is open, the exact text, every required box
// and a signature matching the legal name, then records it and makes an
// applicant active at the fee they signed for; a signed agreement can't be
// changed or deleted; only the service role can send or sign.

const MIGRATION = readFileSync(new URL("../supabase/migrations/20261111010000_partner_agreements.sql", import.meta.url), "utf8");

const SETUP = `
create role anon; create role authenticated; create role service_role;
create schema auth; create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table auth.users (id uuid primary key, email text);
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), 'anon') $$;
create function public.is_staff() returns boolean language sql stable as $$ select false $$;
create table public.partners (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  status text not null default 'applied',
  business_name text not null,
  fee_percent numeric(5,2) not null,
  approved_at timestamptz
);
`;

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
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const TEXT = "# Geega Games Referral Partner Agreement\n\n" + "A referral fee is earned only on a Closed Direct Purchase. ".repeat(12);
const ACKS = ["esign", "reviewed", "direct_purchase", "no_store_fee", "conduct", "taxes"];
const ALL_TICKED = Object.fromEntries(ACKS.map((k) => [k, true]));

let tokenN = 0;
const nextHash = () => sha(`token-${++tokenN}`);

async function addPartner(row: Partial<{ kind: string; status: string; fee: number }> = {}): Promise<string> {
  return (
    await one(`insert into public.partners (kind, status, business_name, fee_percent) values ($1, $2, 'NITE Run Delivery LLC', $3) returning id`, [
      row.kind ?? "referrer",
      row.status ?? "applied",
      row.fee ?? 3,
    ])
  ).id;
}

async function send(partnerId: string, opts: Partial<{ kind: string; fee: number; expires: string }> = {}): Promise<string> {
  await asRole("service_role");
  try {
    return (
      await one(
        `select public.partner_create_agreement($1, $2, 1, 'Geega Games Referral Partner Agreement', $3, $4, $5, 'Chay@Example.com', $6, ${opts.expires ?? "now() + interval '14 days'"}, null, 'owner@geega-games.com') as id`,
        [partnerId, opts.kind ?? "referrer", TEXT, opts.fee ?? 3, ACKS, nextHash()],
      )
    ).id;
  } finally {
    await asRole("");
  }
}

async function sign(
  agreementId: string,
  over: Partial<{ name: string; title: string; sig: string; acks: object; hash: string; role: string }> = {},
): Promise<{ result: Row | null; error: { code?: string; message?: string } | null }> {
  await asRole(over.role ?? "service_role");
  try {
    const row = await one(
      `select public.partner_sign_agreement($1, $2, $3, $4, $5::jsonb, $6, '203.0.113.9', 'Mozilla/5.0') as r`,
      [
        agreementId,
        over.name ?? "Chayson  Ingram-Gray",
        over.title ?? "Owner",
        over.sig ?? "chayson ingram-gray",
        JSON.stringify(over.acks ?? ALL_TICKED),
        over.hash ?? sha(TEXT),
      ],
    );
    return { result: row.r, error: null };
  } catch (e) {
    return { result: null, error: e as { code?: string; message?: string } };
  } finally {
    await asRole("");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(MIGRATION);
});

afterAll(async () => {
  await db?.close();
});

describe("sending", () => {
  it("freezes the text with its hash, lowercases the email, and needs the service role", async () => {
    const p = await addPartner();
    expect(
      (await errorOf(`select public.partner_create_agreement($1, 'referrer', 1, 'T', $2, 3, $3, 'a@b.co', $4, now() + interval '1 day', null, null)`, [p, TEXT, ACKS, nextHash()]))?.code,
    ).toBe("42501");
    const id = await send(p);
    const a = await one(`select status, rendered_sha256, invited_email, fee_percent, required_acks from public.partner_agreements where id = $1`, [id]);
    expect(a).toMatchObject({ status: "pending", rendered_sha256: sha(TEXT), invited_email: "chay@example.com" });
    expect(Number(a.fee_percent)).toBe(3);
    expect(a.required_acks).toEqual(ACKS);
  });

  it("replaces an open link with a new one, so only the newest works", async () => {
    const p = await addPartner();
    const first = await send(p);
    const second = await send(p);
    const rows = (await db.query<Row>(`select id, status, void_reason from public.partner_agreements where partner_id = $1 order by created_at`, [p])).rows;
    expect(rows.find((r) => r.id === first)).toMatchObject({ status: "void", void_reason: "Replaced by a newer agreement." });
    expect(rows.find((r) => r.id === second)?.status).toBe("pending");
    expect((await sign(first)).error?.code).toBe("GP015");
  });

  it("refuses a declined partner, and an agreement for the wrong kind", async () => {
    const declined = await addPartner({ status: "declined" });
    await asRole("service_role");
    const e1 = await errorOf(
      `select public.partner_create_agreement($1, 'referrer', 1, 'T', $2, 3, $3, 'a@b.co', $4, now() + interval '1 day', null, null)`,
      [declined, TEXT, ACKS, nextHash()],
    );
    const store = await addPartner({ kind: "store" });
    const e2 = await errorOf(
      `select public.partner_create_agreement($1, 'referrer', 1, 'T', $2, 3, $3, 'a@b.co', $4, now() + interval '1 day', null, null)`,
      [store, TEXT, ACKS, nextHash()],
    );
    await asRole("");
    expect(e1?.code).toBe("GP012");
    expect(e2?.code).toBe("GP011");
  });
});

describe("signing", () => {
  it("records the signature and makes an applicant active at the fee they signed for", async () => {
    const p = await addPartner({ fee: 3 });
    const id = await send(p, { fee: 3 });
    await db.query(`update public.partners set fee_percent = 9 where id = $1`, [p]); // changed after sending
    const { result, error } = await sign(id);
    expect(error).toBeNull();
    expect(result).toMatchObject({ partnerId: p, kind: "referrer", activated: true });
    const a = await one(`select * from public.partner_agreements where id = $1`, [id]);
    expect(a).toMatchObject({
      status: "signed",
      signer_legal_name: "Chayson Ingram-Gray",
      signer_title: "Owner",
      typed_signature: "chayson ingram-gray",
      signer_ip: "203.0.113.9",
    });
    expect(a.acknowledgments).toEqual(ALL_TICKED);
    expect(a.record_sha256).toMatch(/^[0-9a-f]{64}$/);
    const partner = await one(`select status, fee_percent, approved_at from public.partners where id = $1`, [p]);
    expect(partner.status).toBe("active");
    expect(Number(partner.fee_percent)).toBe(3);
    expect(partner.approved_at).not.toBeNull();
    // Once only.
    expect((await sign(id)).error?.code).toBe("GP014");
  });

  it("doesn't change the status of a partner who is already active or paused", async () => {
    const p = await addPartner({ status: "paused" });
    const { result } = await sign(await send(p));
    expect(result?.activated).toBe(false);
    expect((await one(`select status from public.partners where id = $1`, [p])).status).toBe("paused");
  });

  it("needs every box, the exact text, a title and a signature matching the legal name", async () => {
    const p = await addPartner();
    const id = await send(p);
    expect((await sign(id, { acks: { ...ALL_TICKED, no_store_fee: false } })).error?.code).toBe("GP017");
    expect((await sign(id, { acks: { esign: true } })).error?.code).toBe("GP017");
    expect((await sign(id, { hash: sha(TEXT + " edited") })).error?.code).toBe("GP016");
    expect((await sign(id, { sig: "Someone Else" })).error?.code).toBe("GP018");
    expect((await sign(id, { title: " " })).error?.code).toBe("GP018");
    expect((await sign(id, { name: "C", sig: "C" })).error?.code).toBe("GP018");
    expect((await sign(id, { role: "authenticated" })).error?.code).toBe("42501");
    expect((await one(`select status from public.partner_agreements where id = $1`, [id])).status).toBe("pending");
    expect((await one(`select status from public.partners where id = $1`, [p])).status).toBe("applied");
  });

  it("refuses an expired link, and a partner declined after it was sent", async () => {
    const p = await addPartner();
    const expired = await send(p, { expires: "now() - interval '1 minute'" });
    expect((await sign(expired)).error?.code).toBe("GP015");
    const q = await addPartner();
    const id = await send(q);
    await db.query(`update public.partners set status = 'declined' where id = $1`, [q]);
    expect((await sign(id)).error?.code).toBe("GP019");
  });
});

describe("the record", () => {
  it("can't be edited, reopened, signed by hand, or deleted", async () => {
    const p = await addPartner();
    const id = await send(p);
    // Only the signing function can sign.
    expect((await errorOf(`update public.partner_agreements set status = 'signed', signed_at = now(), signer_legal_name = 'X Y', typed_signature = 'X Y', record_sha256 = 'x' where id = $1`, [id]))?.code).toBe("GP006");
    expect((await errorOf(`update public.partner_agreements set rendered_md = rendered_md || ' more' where id = $1`, [id]))?.code).toBe("GP003");
    expect((await errorOf(`update public.partner_agreements set fee_percent = 1 where id = $1`, [id]))?.code).toBe("GP003");
    await sign(id);
    expect((await errorOf(`update public.partner_agreements set signer_legal_name = 'Someone Else' where id = $1`, [id]))?.code).toBe("GP004");
    expect((await errorOf(`update public.partner_agreements set status = 'void', voided_at = now() where id = $1`, [id]))?.code).toBe("GP004");
    expect((await errorOf(`delete from public.partner_agreements where id = $1`, [id]))?.code).toBe("GP001");
    // The PDF can be recorded once, afterwards.
    expect(await errorOf(`update public.partner_agreements set pdf_path = 'p/a.pdf', pdf_sha256 = 'abc' where id = $1`, [id])).toBeNull();
    expect((await errorOf(`update public.partner_agreements set pdf_path = 'other.pdf' where id = $1`, [id]))?.code).toBe("GP004");
    // A voided link stays void.
    const v = await send(p);
    await send(p);
    expect((await errorOf(`update public.partner_agreements set status = 'pending', voided_at = null where id = $1`, [v]))?.code).toBe("GP005");
  });

  it("keeps the PDF bucket private", async () => {
    expect(await one(`select public, allowed_mime_types from storage.buckets where id = 'partner-agreements'`)).toEqual({
      public: false,
      allowed_mime_types: ["application/pdf"],
    });
  });
});
