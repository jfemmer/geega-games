// Geega Admin service worker — push notifications only.
//
// Registered by the admin app with scope /admin_dashboard (see
// src/admin/lib/push.ts), so it never touches the storefront. It deliberately
// has no fetch handler and caches nothing: every deploy is live the moment
// the app is opened, and there's no stale-cache state to debug.
//
// Payloads come from api/_lib/staffPush.ts:
//   { title, body, url, tag, at, badge? }
// `badge` is everything waiting for this staff member (the same total as the
// admin's menu button), shown on the app icon where the device supports it.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = typeof data.title === "string" && data.title ? data.title : "Geega Admin";
  const options = {
    body: typeof data.body === "string" ? data.body : "",
    icon: "/admin-icon-192.png",
    badge: "/admin-badge-96.png",
    // Same tag = the newer notification replaces the older one (e.g. a
    // second response on the same lead) instead of stacking.
    tag: typeof data.tag === "string" ? data.tag : undefined,
    renotify: typeof data.tag === "string",
    timestamp: typeof data.at === "string" ? Date.parse(data.at) || Date.now() : Date.now(),
    data: { url: typeof data.url === "string" ? data.url : "/admin_dashboard" },
  };
  const badge = Number.isInteger(data.badge) && data.badge >= 0 ? data.badge : null;

  event.waitUntil(
    Promise.all([self.registration.showNotification(title, options), setIconBadge(badge), tellOpenApps()]),
  );
});

// The number on the app icon. Supported on iPhone/iPad home-screen apps with
// notifications on, Android and desktop installs; elsewhere it's a no-op.
async function setIconBadge(count) {
  if (count === null) return;
  try {
    if (count > 0 && self.navigator.setAppBadge) await self.navigator.setAppBadge(count);
    else if (count === 0 && self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
  } catch {
    /* not permitted or not supported */
  }
}

// An open admin window refreshes its number badges straight away.
async function tellOpenApps() {
  try {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).pathname.startsWith("/admin_dashboard")) client.postMessage({ type: "gg-admin-push" });
    }
  } catch {
    /* a closed window can't be told; it refreshes when opened */
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Only ever open pages inside the admin app, whatever the payload says.
  let target = new URL("/admin_dashboard", self.location.origin);
  try {
    const candidate = new URL(event.notification.data?.url || "/admin_dashboard", self.location.origin);
    if (candidate.origin === self.location.origin && candidate.pathname.startsWith("/admin_dashboard")) {
      target = candidate;
    }
  } catch {
    /* keep the default */
  }
  const path = target.pathname + target.search;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).pathname.startsWith("/admin_dashboard"));
      if (open) {
        // Let the already-open app route in place (no reload, keeps state).
        open.postMessage({ type: "gg-admin-navigate", path });
        await open.focus();
        return;
      }
      await self.clients.openWindow(path);
    })(),
  );
});
