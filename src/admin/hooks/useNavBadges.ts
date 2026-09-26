import { useCallback, useEffect, useRef, useState } from "react";
import { navBadgesRepository } from "../repositories/navBadges.supabase";
import { ADMIN_DATA_CHANGED_EVENT } from "../repositories/apiClient";
import { EMPTY_NAV_BADGES, navBadgeTotal, type NavBadgeCounts } from "../utils/navBadges";

// Live counts for the admin's number badges. They refresh:
//   * when the admin opens and on every page change;
//   * every minute while the app is on screen, and as soon as it comes back
//     to the front (switching back to the tab or the home-screen app);
//   * shortly after any change made in the admin (a lead reviewed, a pickup
//     marked ready…), throttled so a burst of changes is one refresh;
//   * when a push notification arrives (public/admin-sw.js tells the app).
// The total is mirrored on the installed app's icon where the device
// supports it (iPhone home-screen app with notifications on, Android, desktop).

const REFRESH_EVERY_MS = 60_000;
const AFTER_CHANGE_MS = 800;
const MIN_GAP_MS = 5_000;

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/** Sets or clears the number on the installed app's icon. Never throws. */
export async function setAppIconBadge(count: number): Promise<void> {
  if (typeof navigator === "undefined") return;
  const nav = navigator as BadgeNavigator;
  try {
    if (count > 0) await nav.setAppBadge?.(count);
    else await nav.clearAppBadge?.();
  } catch {
    // Not installed, notifications off, or not supported: nothing to show.
  }
}

export function useNavBadges(activeKey: string): NavBadgeCounts {
  const [counts, setCounts] = useState<NavBadgeCounts>(EMPTY_NAV_BADGES);
  const [loaded, setLoaded] = useState(false);
  const inFlight = useRef(false);
  const runAgain = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) {
      runAgain.current = true;
      return;
    }
    inFlight.current = true;
    try {
      do {
        runAgain.current = false;
        try {
          setCounts(await navBadgesRepository.counts());
          setLoaded(true);
        } catch {
          // Keep the last counts; the next refresh will try again.
        }
      } while (runAgain.current);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [activeKey, refresh]);

  useEffect(() => {
    const whenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(whenVisible, REFRESH_EVERY_MS);
    document.addEventListener("visibilitychange", whenVisible);
    window.addEventListener("focus", whenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", whenVisible);
      window.removeEventListener("focus", whenVisible);
    };
  }, [refresh]);

  useEffect(() => {
    let timer: number | undefined;
    let lastRun = 0;
    const soon = () => {
      if (timer !== undefined) return; // one is already on its way
      const wait = Math.max(AFTER_CHANGE_MS, lastRun + MIN_GAP_MS - Date.now());
      timer = window.setTimeout(() => {
        timer = undefined;
        lastRun = Date.now();
        void refresh();
      }, wait);
    };
    const onWorkerMessage = (event: MessageEvent) => {
      if ((event.data as { type?: unknown } | null)?.type === "gg-admin-push") soon();
    };
    const worker = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    window.addEventListener(ADMIN_DATA_CHANGED_EVENT, soon);
    worker?.addEventListener("message", onWorkerMessage);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener(ADMIN_DATA_CHANGED_EVENT, soon);
      worker?.removeEventListener("message", onWorkerMessage);
    };
  }, [refresh]);

  const total = navBadgeTotal(counts);
  useEffect(() => {
    // Only once real counts are in, so opening the app doesn't flash the icon to zero.
    if (loaded) void setAppIconBadge(total);
  }, [loaded, total]);

  return counts;
}
