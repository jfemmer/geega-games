import { useEffect, useRef } from "react";
import { useAuth } from "./AuthContext";
import { useRouter } from "./router";

// Reports storefront page views to /api/track for the admin Overview's
// "Website visitors" section. See api/track.ts for what is (and isn't)
// stored — no cookies, no IPs, no user ids.
//
// People, not machines: a page view is sent once the visitor scrolls, taps,
// types or moves the mouse on it (engaged), or when they leave the page
// without doing any of that (not engaged). Someone who switches away and
// comes back to interact turns that view engaged. Machines that load a page
// and do nothing — Facebook's link checks, bots running a browser — are then
// left out of the visitor numbers (migration 20261027050000), and ones that
// never leave cleanly send nothing at all.
//
// Nothing is sent when:
//   * the browser asks not to be tracked (Do Not Track / Global Privacy
//     Control), or is driven by automation software (navigator.webdriver),
//   * a staff/admin account is signed in — and that device is remembered as
//     a staff device, so browsing it signed-out later doesn't count either,
//   * nothing navigated (re-renders, session refreshes): a path is only
//     reported again after the visitor has been somewhere else.
//
// The landing page view also carries where the visitor came from: the
// referring site and the link's campaign tags (utm_source / utm_medium /
// utm_campaign, which the admin's "Copy Facebook post link" adds).

const STAFF_DEVICE_KEY = "gg_staff_device";
const STAFF_ROLES = new Set(["staff", "admin"]);

function optedOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true || nav.webdriver === true;
}

export function isStaffDevice(): boolean {
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

/** Sends one event to /api/track; a beacon survives the page closing. */
export function sendTrackingEvent(event: Record<string, unknown>): void {
  const body = JSON.stringify(event);
  try {
    // A Blob keeps it a "simple" request; sendBeacon survives page unloads.
    if (navigator.sendBeacon?.("/api/track", new Blob([body], { type: "text/plain" }))) return;
  } catch {
    /* fall through */
  }
  void fetch("/api/track", { method: "POST", body, keepalive: true }).catch(() => {});
}

/**
 * Whether this visitor may be counted: not staff, not opted out, not an
 * automated browser. `null` while the session is still being restored.
 */
export function useTrackingAllowed(): boolean | null {
  const { user, loading } = useAuth();
  const roleValue = (user?.app_metadata as Record<string, unknown> | undefined)?.role;
  const role = typeof roleValue === "string" ? roleValue : null;
  if (loading) return null;
  if (role && STAFF_ROLES.has(role)) return false;
  if (optedOut() || isStaffDevice()) return false;
  return true;
}

interface Utm {
  s?: string;
  m?: string;
  c?: string;
}

/** The landing link's campaign tags, or null when it had none. */
export function landingUtm(search: string): Utm | null {
  const params = new URLSearchParams(search);
  const pick = (name: string) => params.get(name)?.trim().slice(0, 100) || undefined;
  const utm: Utm = { s: pick("utm_source"), m: pick("utm_medium"), c: pick("utm_campaign") };
  return utm.s || utm.m || utm.c ? utm : null;
}

interface CurrentView {
  path: string;
  referrer: string;
  utm: Utm | null;
  /** waiting: nothing sent yet; unengaged: sent on leaving with no interaction; engaged: sent with one. */
  state: "waiting" | "unengaged" | "engaged";
}

// What a person does: pointer, touch, keys, the mouse wheel and moving the
// mouse. Not "scroll": the site scrolls the page itself (to the top on a
// new page, to a #section), and that isn't anyone doing anything.
const INTERACTIONS = ["pointerdown", "touchstart", "keydown", "wheel", "mousemove"] as const;

/** Page-view tracking with the engagement rule above. Exported for tests. */
export function createPageViewTracker(send: (event: Record<string, unknown>) => void = sendTrackingEvent) {
  let current: CurrentView | null = null;
  let listening = false;

  function sendView(view: CurrentView, engaged: boolean) {
    view.state = engaged ? "engaged" : "unengaged";
    const event: Record<string, unknown> = { p: view.path, r: view.referrer, e: engaged };
    if (view.utm) event.u = view.utm;
    send(event);
  }

  const onInteraction = (e: Event) => {
    if (!e.isTrusted || !current) return; // scripted events aren't a person
    if (current.state === "waiting") sendView(current, true);
    else if (current.state === "unengaged") {
      // They switched away and came back: the view already sent becomes engaged.
      current.state = "engaged";
      send({ t: "e", p: current.path });
    }
  };
  const onHide = () => {
    if (current?.state === "waiting") sendView(current, false);
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") onHide();
  };

  function listen() {
    if (listening) return;
    listening = true;
    for (const type of INTERACTIONS) window.addEventListener(type, onInteraction, { capture: true, passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
  }

  return {
    /** A new page: the previous one is sent (if it wasn't yet), and this one waits for a person. */
    view(path: string, referrer: string, utm: Utm | null) {
      // Moving on without a trusted interaction (a redirect) still sends the last page.
      if (current?.state === "waiting") sendView(current, false);
      current = { path, referrer, utm, state: "waiting" };
      listen();
    },
    stop() {
      if (!listening) return;
      listening = false;
      for (const type of INTERACTIONS) window.removeEventListener(type, onInteraction, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
    },
  };
}

export function usePageViewTracking(): void {
  const { path } = useRouter();
  const { user, loading } = useAuth();
  const roleValue = (user?.app_metadata as Record<string, unknown> | undefined)?.role;
  const role = typeof roleValue === "string" ? roleValue : null;
  const lastPath = useRef<string | null>(null);
  const first = useRef(true);
  const tracker = useRef<ReturnType<typeof createPageViewTracker> | null>(null);

  useEffect(() => () => tracker.current?.stop(), []);

  useEffect(() => {
    // Wait for the session to be restored so a signed-in staff member's
    // first page load isn't counted before we know who they are.
    if (loading) return;

    if (role && STAFF_ROLES.has(role)) {
      markStaffDevice();
      tracker.current?.stop();
      return;
    }
    if (optedOut() || isStaffDevice()) return;

    if (lastPath.current === path) return;
    lastPath.current = path;

    // Only the landing page view carries where the visitor came from.
    const landing = first.current;
    first.current = false;
    tracker.current ??= createPageViewTracker();
    tracker.current.view(path, landing ? document.referrer : "", landing ? landingUtm(window.location.search) : null);
  }, [path, role, loading]);
}

/** Mount once inside RouterProvider + AuthProvider. */
export function PageViewTracker(): null {
  usePageViewTracking();
  return null;
}
