import { useEffect, useRef } from "react";
import { useAuth } from "./AuthContext";
import { useRouter } from "./router";

// Reports storefront page views to /api/track for the admin Overview's
// "Website visitors" section. See api/track.ts for what is (and isn't)
// stored — no cookies, no IPs, no user ids.
//
// Nothing is sent when:
//   * the browser asks not to be tracked (Do Not Track / Global Privacy
//     Control),
//   * a staff/admin account is signed in — and that device is remembered as
//     a staff device, so browsing it signed-out later doesn't count either,
//   * nothing navigated (re-renders, session refreshes): a path is only
//     reported again after the visitor has been somewhere else.

const STAFF_DEVICE_KEY = "gg_staff_device";
const STAFF_ROLES = new Set(["staff", "admin"]);

function optedOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

function isStaffDevice(): boolean {
  try {
    return localStorage.getItem(STAFF_DEVICE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Called by the admin sign-in gate too, so the owner's devices never count. */
export function markStaffDevice(): void {
  try {
    localStorage.setItem(STAFF_DEVICE_KEY, "1");
  } catch {
    /* storage blocked — the signed-in role check still applies */
  }
}

function send(path: string, referrer: string) {
  const body = JSON.stringify({ p: path, r: referrer });
  try {
    // A Blob keeps it a "simple" request; sendBeacon survives page unloads.
    if (navigator.sendBeacon?.("/api/track", new Blob([body], { type: "text/plain" }))) return;
  } catch {
    /* fall through */
  }
  void fetch("/api/track", { method: "POST", body, keepalive: true }).catch(() => {});
}

export function usePageViewTracking(): void {
  const { path } = useRouter();
  const { user, loading } = useAuth();
  const roleValue = (user?.app_metadata as Record<string, unknown> | undefined)?.role;
  const role = typeof roleValue === "string" ? roleValue : null;
  const lastPath = useRef<string | null>(null);
  const first = useRef(true);

  useEffect(() => {
    // Wait for the session to be restored so a signed-in staff member's
    // first page load isn't counted before we know who they are.
    if (loading) return;

    if (role && STAFF_ROLES.has(role)) {
      markStaffDevice();
      return;
    }
    if (optedOut() || isStaffDevice()) return;

    if (lastPath.current === path) return;
    lastPath.current = path;

    // Only the landing page view carries where the visitor came from.
    const referrer = first.current ? document.referrer : "";
    first.current = false;
    send(path, referrer);
  }, [path, role, loading]);
}

/** Mount once inside RouterProvider + AuthProvider. */
export function PageViewTracker(): null {
  usePageViewTracking();
  return null;
}
