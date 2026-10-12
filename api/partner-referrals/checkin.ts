import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { verifyGuestToken } from "../_lib/guestAccess.js";
import { notifyStaff } from "../_lib/staffPush.js";
import { readRawBody } from "../_lib/http.js";
import { resultPage } from "../_lib/resultPage.js";
import { siteUrl } from "../_lib/assets.js";
import { CHECKIN_ANSWERS, isCheckinAnswer, type CheckinAnswer } from "../../src/store/lib/partnerTypes.js";

// The seller's answer to "did <store> get in touch?" (the check-in email a
// week after we pass their details to a partner store).
//
// GET  /api/partner-referrals/checkin?r=<referral>&a=<answer>&t=<token>
//      shows the question with their answer picked and a Send button. It never
//      records anything: email security scanners open links on their own, and
//      a "yes, I sold" nobody meant would corrupt the fee records.
// POST same fields (+ an optional amount) records the answer. Answering again
//      replaces it.
//
// The token (guestAccess "checkin") proves the request came from that
// seller's email, so nobody can answer for someone else's referral.

const MAX_AMOUNT_CENTS = 100_000_000;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** "$1,250.50" / "1250" → cents, or null. */
export function parseDollars(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isFinite(cents) && cents >= 0 && cents <= MAX_AMOUNT_CENTS ? cents : null;
}

function questionPage(opts: {
  storeName: string;
  referralId: string;
  token: string;
  answer: CheckinAnswer | null;
  previous: CheckinAnswer | null;
}): string {
  const home = siteUrl();
  const options = CHECKIN_ANSWERS.map(
    (a) => `<label class="opt"><input type="radio" name="a" value="${a.value}"${
      a.value === opts.answer ? " checked" : ""
    } required /> <span>${escapeHtml(a.label)}</span></label>`,
  ).join("\n");
  const previousNote = opts.previous
    ? `<p class="note">You already told us: “${escapeHtml(
        CHECKIN_ANSWERS.find((x) => x.value === opts.previous)?.label ?? opts.previous,
      )}”. Sending again replaces it.</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex" />
<title>Did ${escapeHtml(opts.storeName)} get in touch? — Geega Games</title>
<style>
  :root { --brand:#663399; --deep:#4c2a85; --gold:#e0b341; --ink:#1a1526; --parchment:#f7f4ef; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    font-family:Inter,system-ui,-apple-system,sans-serif; color:var(--ink);
    background:radial-gradient(1200px 600px at 50% -10%, rgba(102,51,153,.10), transparent 60%), var(--parchment);
    padding:24px; }
  .card { background:#fff; border:1px solid #e7e0f2; border-radius:18px; max-width:480px; width:100%;
    padding:32px 28px; box-shadow:0 10px 30px rgba(76,42,133,.10); }
  .logo { height:56px; margin:0 auto 16px; display:block; }
  h1 { font-size:21px; margin:0 0 8px; color:var(--deep); text-align:center; }
  p { font-size:15px; line-height:23px; color:#4a4356; margin:0 0 16px; }
  .opt { display:flex; gap:10px; align-items:flex-start; padding:12px 14px; border:1px solid #e7e0f2;
    border-radius:12px; margin:0 0 10px; cursor:pointer; font-size:15px; }
  .opt input { margin-top:3px; accent-color:var(--brand); }
  label.amount { display:block; font-size:14px; font-weight:600; margin:14px 0 6px; }
  input[type=text] { width:100%; padding:11px 12px; font-size:16px; border:1px solid #d9cfe9; border-radius:10px; }
  .hint { font-size:13px; color:#6b6076; margin:6px 0 0; }
  .note { font-size:14px; background:#f4eaff; border-radius:10px; padding:10px 12px; }
  button { width:100%; margin-top:18px; background:var(--brand); color:#fff; border:0; font-weight:600;
    font-size:16px; padding:13px 18px; border-radius:10px; cursor:pointer; }
  button:focus-visible, input:focus-visible { outline:3px solid var(--gold); outline-offset:2px; }
</style>
</head>
<body>
  <main class="card">
    <img class="logo" src="${home}/logo.png" alt="Geega Games" />
    <h1>Did ${escapeHtml(opts.storeName)} get in touch?</h1>
    <p>Pick the answer that fits and press Send.</p>
    ${previousNote}
    <form method="post" action="/api/partner-referrals/checkin">
      <input type="hidden" name="r" value="${escapeHtml(opts.referralId)}" />
      <input type="hidden" name="t" value="${escapeHtml(opts.token)}" />
      ${options}
      <label class="amount" for="amount">If you sold, about how much did they pay you? (optional)</label>
      <input id="amount" type="text" name="amount" inputmode="decimal" autocomplete="off" placeholder="$" />
      <p class="hint">Only used to check our records with the store. We never share it.</p>
      <button type="submit">Send</button>
    </form>
  </main>
</body>
</html>`;
}

async function readForm(req: VercelRequest): Promise<Record<string, string>> {
  if (req.body && typeof req.body === "object") {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.body as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  }
  const raw = typeof req.body === "string" ? req.body : await readRawBody(req, 4096);
  return Object.fromEntries(new URLSearchParams(raw));
}

function sendHtml(res: VercelResponse, status: number, html: string) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  res.status(status).send(html);
}

const invalidLink = () =>
  resultPage({
    title: "Link not valid",
    heading: "This link didn't work",
    body: "It may have been copied incompletely. Reply to the email we sent you and we'll sort it out.",
    tone: "error",
  });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).send("Method not allowed");
  }

  try {
    const fields =
      req.method === "GET"
        ? {
            r: String(req.query.r ?? ""),
            t: String(req.query.t ?? ""),
            a: String(req.query.a ?? ""),
            amount: "",
          }
        : await readForm(req);
    const referralId = fields.r ?? "";
    const token = fields.t ?? "";
    if (!verifyGuestToken("checkin", referralId, token)) return sendHtml(res, 400, invalidLink());

    const db = getSupabaseAdmin();
    const { data: referral, error } = await db
      .from("partner_referrals")
      .select("id, partner_id, lead_reference, checkin_response")
      .eq("id", referralId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!referral) return sendHtml(res, 404, invalidLink());

    const { data: partner } = await db
      .from("partners")
      .select("business_name")
      .eq("id", referral.partner_id)
      .maybeSingle();
    const storeName = partner?.business_name ?? "the store";

    const answer = isCheckinAnswer(fields.a) ? fields.a : null;
    const previous = isCheckinAnswer(referral.checkin_response) ? referral.checkin_response : null;

    if (req.method === "GET" || !answer) {
      return sendHtml(res, 200, questionPage({ storeName, referralId, token, answer, previous }));
    }

    const amountCents = answer === "sold" ? parseDollars(fields.amount) : null;
    const { error: updateErr } = await db
      .from("partner_referrals")
      .update({
        checkin_response: answer,
        checkin_amount_cents: amountCents,
        checkin_responded_at: new Date().toISOString(),
      })
      .eq("id", referralId);
    if (updateErr) throw new Error(updateErr.message);

    if (answer === "not_contacted" && previous !== "not_contacted") {
      await notifyStaff({
        key: `partner_checkin:${referral.id}`,
        kind: "partner_lead",
        title: `Seller says ${storeName} never got in touch`,
        body: `${referral.lead_reference} — follow up with the store, or send the lead elsewhere.`,
        url: "/admin_dashboard/partner-leads",
        tag: `partner_checkin:${referral.id}`,
      });
    }

    const thanks =
      answer === "sold"
        ? "Congratulations on the sale, and thanks for letting us know."
        : answer === "not_sold"
          ? "Thanks for letting us know. If you'd like to try another buyer, just reply to our email."
          : `Thanks for letting us know. We'll follow up with ${escapeHtml(storeName)} and get back to you.`;
    return sendHtml(res, 200, resultPage({ title: "Thanks", heading: "Got it — thank you!", body: thanks, tone: "success" }));
  } catch (err) {
    console.error("[/api/partner-referrals/checkin] error:", err);
    return sendHtml(
      res,
      500,
      resultPage({
        title: "Something went wrong",
        heading: "Something went wrong",
        body: "We couldn't save your answer just now. Please try again in a minute.",
        tone: "error",
      }),
    );
  }
}
