import type { User } from "@supabase/supabase-js";

// Lets staff know a new customer signed up (admin push notification): on a
// brand-new account's first signed-in session — after the email is
// confirmed — tell the server once. The server re-checks everything from the
// session token and never notifies twice for the same account (see
// api/account/new-account.ts); the local flag just saves a request on every
// later page load.

const REPORTED_KEY = "gg_new_account_reported";
const NEW_ACCOUNT_WINDOW_MS = 48 * 60 * 60 * 1000;

export function reportNewAccount(user: User, accessToken: string): void {
  const createdAt = Date.parse(user.created_at);
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > NEW_ACCOUNT_WINDOW_MS) return;
  try {
    if (localStorage.getItem(REPORTED_KEY) === user.id) return;
  } catch {
    /* storage blocked — the server dedupes anyway */
  }
  void fetch("/api/account/new-account", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    keepalive: true,
  })
    .then((res) => {
      if (!res.ok) return;
      try {
        localStorage.setItem(REPORTED_KEY, user.id);
      } catch {
        /* ignore */
      }
    })
    .catch(() => undefined);
}
