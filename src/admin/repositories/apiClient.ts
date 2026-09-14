// Shared authenticated fetch for privileged /api/admin/* calls from the browser.
//
// The browser attaches the caller's Supabase access token as a Bearer header;
// the server verifies it with requireStaff() and uses the service_role key. The
// service_role key is never in the browser. This mirrors the pattern established
// in inventory.supabase.ts, centralized so the new user/campaign/reservation
// repositories don't each re-implement it.

import { supabase } from "../../supabase";

async function getAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function adminFetch<T>(
  path: string,
  init: { method: string; body?: unknown } = { method: "GET" },
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error(
      "You must be signed in as staff to perform this action. Please sign in and try again.",
    );
  }
  const res = await fetch(path, {
    method: init.method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    credentials: "same-origin",
    body: init.body != null ? JSON.stringify(init.body) : undefined,
  });

  if (res.status === 401 || res.status === 403) {
    // Preserve a server-provided message when present (e.g. admin-only actions).
    let message =
      "Your session isn't authorized for this action. Sign in as a staff user and retry.";
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}