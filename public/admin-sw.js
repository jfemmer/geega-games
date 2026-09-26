// Geega Admin service worker — push notifications only.
//
// Registered by the admin app with scope /admin_dashboard (see
// src/admin/services/push.ts), so it never touches the storefront. It deliberately
// has no fetch handler and caches nothing: every deploy is live the moment
// the app is opened, and there's no stale-cache state to debug.
//
// Payloads come from api/_lib/staffPush.ts:
//   { title, body, url, tag, kind, at }
//
// Sounds: web push can't pick a notification sound, so when Geega Admin is
// open and visible we ask it to play the event's own sound
// (src/admin/services/sounds.ts) and show the notification silently. If the
// app can't play audio (not tapped since it opened, or sounds turned off),
// the notification makes the device's normal sound instead.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** The admin window someone is looking at right now, if any (focused first). */
async function visibleAdminWindow() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const admin = windows.filter(
    (client) => client.visibilityState === "visible" && new URL(client.url).pathname.startsWith("/admin_dashboard"),
  );
  return admin.find((client) => client.focused) ?? admin[0] ?? null;
}

/** Ask an open admin window to play this kind's sound. Resolves whether it did. */
function playInApp(client, data) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), 800);
    channel.port1.onmessage = (message) => {
      clearTimeout(timer);
      resolve(Boolean(message.data && message.data.played));
    };
    client.postMessage(
      { type: "gg-admin-push", kind: typeof data.kind === "string" ? data.kind : "default", tag: data.tag },
      [channel.port2],
    );
  });
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(showPush(data));
});

async function showPush(data) {
  const client = await visibleAdminWindow().catch(() => null);
  const playedInApp = client ? await playInApp(client, data).catch(() => false) : false;

  const title = typeof data.title === "string" && data.title ? data.title : "Geega Admin";
  const options = {
    body: typeof data.body === "string" ? data.body : "",
    icon: "/admin-icon-192.png",
    badge: "/admin-badge-96.png",
    // Same tag = the newer notification replaces the older one (e.g. a
    // second response on the same lead) instead of stacking.
    tag: typeof data.tag === "string" ? data.tag : undefined,
    renotify: typeof data.tag === "string" && !playedInApp,
    timestamp: typeof data.at === "string" ? Date.parse(data.at) || Date.now() : Date.now(),
    // The app already played this event's own sound — don't add the system one.
    silent: playedInApp,
    data: { url: typeof data.url === "string" ? data.url : "/admin_dashboard" },
  };

  try {
    await self.registration.showNotification(title, options);
  } catch {
    // Every push must show something (Safari revokes push otherwise), so
    // fall back to the plainest notification if an option is rejected.
    await self.registration.showNotification(title, { body: options.body, data: options.data });
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
