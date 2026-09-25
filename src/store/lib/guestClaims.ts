// Guest records waiting to be attached to an account.
//
// A guest order or sell submission comes with a signed token (from the
// checkout/submit response, or the `?claim=<kind>.<id>.<token>` link in its
// confirmation email). We keep those here until the visitor is signed in,
// then POST them to /api/account/claim, which verifies the token server-side
// and links the record to the account. Works whether the account was just
// created, needed email confirmation first, or already existed.

export type GuestClaim = { kind: "order" | "sell"; id: string; token: string };

const KEY = "gg_pending_claims";
const ID_RE = /^[0-9a-f-]{36}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function isClaim(v: unknown): v is GuestClaim {
  const c = v as GuestClaim;
  return (
    !!c &&
    (c.kind === "order" || c.kind === "sell") &&
    typeof c.id === "string" &&
    ID_RE.test(c.id) &&
    typeof c.token === "string" &&
    TOKEN_RE.test(c.token)
  );
}

function read(): GuestClaim[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isClaim) : [];
  } catch {
    return [];
  }
}

function write(claims: GuestClaim[]): void {
  try {
    if (claims.length) localStorage.setItem(KEY, JSON.stringify(claims.slice(-20)));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked — the email link still works later */
  }
}

export function rememberClaim(claim: GuestClaim): void {
  if (!isClaim(claim)) return;
  write([...read().filter((c) => !(c.kind === claim.kind && c.id === claim.id)), claim]);
}

/** Parses `<kind>.<id>.<token>` (the `claim` query param in emails). */
export function parseClaimParam(raw: string | null): GuestClaim | null {
  if (!raw) return null;
  const [kind, id, token] = raw.split(".");
  const claim = { kind, id, token } as GuestClaim;
  return isClaim(claim) ? claim : null;
}

/** Stores a `?claim=` from the current URL, if any. Safe to call on every page. */
export function captureClaimFromUrl(): void {
  try {
    const claim = parseClaimParam(new URLSearchParams(window.location.search).get("claim"));
    if (claim) rememberClaim(claim);
  } catch {
    /* ignore */
  }
}

export function hasPendingClaims(): boolean {
  return read().length > 0;
}

/**
 * Attaches every remembered record to the signed-in account. Claims that
 * succeed — or can never succeed (bad link, already on another account) —
 * are forgotten; transient failures stay for the next sign-in.
 * Returns how many records were linked.
 */
export async function flushClaims(accessToken: string): Promise<number> {
  const pending = read();
  if (!pending.length) return 0;
  let linked = 0;
  const keep: GuestClaim[] = [];
  for (const claim of pending) {
    try {
      const res = await fetch("/api/account/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        credentials: "same-origin",
        body: JSON.stringify(claim),
      });
      if (res.ok) linked += 1;
      else if (res.status >= 500 || res.status === 429 || res.status === 401) keep.push(claim);
    } catch {
      keep.push(claim);
    }
  }
  // Re-read so a claim remembered while this ran isn't lost.
  const done = new Set(pending.filter((c) => !keep.includes(c)).map((c) => `${c.kind}:${c.id}`));
  write(read().filter((c) => !done.has(`${c.kind}:${c.id}`)));
  return linked;
}
