// Where to send a visitor after sign-in / sign-up, and how the storefront's
// "sign in to …" prompts hand the current page along as `?next=`.

/**
 * Sanitise a `?next=` redirect target: only same-site absolute paths are
 * allowed, so a crafted link can't bounce someone off-site after sign-in.
 */
export function safeNextPath(next: string | null, fallback = "/account"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return fallback;
  }
  return next;
}

/** `/signup` or `/login` carrying the current page as `next`, for "sign in to …" prompts. */
export function authLinkWithReturn(base: "/login" | "/signup", returnTo?: string): string {
  const target = returnTo ?? window.location.pathname + window.location.search;
  return `${base}?next=${encodeURIComponent(target)}`;
}

// Where a visitor was headed when they started signing up. The confirmation
// email always lands on plain /login (a query string there could fall outside
// Supabase's redirect allow-list), so the destination is remembered on this
// device and picked up by the first sign-in after confirming.
const PENDING_NEXT_KEY = "gg_signup_next";
const PENDING_NEXT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function rememberSignupNext(next: string): void {
  try {
    localStorage.setItem(PENDING_NEXT_KEY, JSON.stringify({ next, at: Date.now() }));
  } catch {
    /* storage blocked — they'll land on /account instead */
  }
}

/** Read and clear the remembered destination (returns null if none or stale). */
export function takeSignupNext(): string | null {
  try {
    const raw = localStorage.getItem(PENDING_NEXT_KEY);
    if (!raw) return null;
    localStorage.removeItem(PENDING_NEXT_KEY);
    const parsed = JSON.parse(raw) as { next?: unknown; at?: unknown };
    if (typeof parsed.next !== "string" || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > PENDING_NEXT_TTL_MS) return null;
    return parsed.next;
  } catch {
    return null;
  }
}
