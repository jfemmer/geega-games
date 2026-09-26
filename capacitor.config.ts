import type { CapacitorConfig } from "@capacitor/cli";

// "Geega Admin" — the iPhone app for the admin dashboard (docs/IOS_APP.md).
//
// The app is a native shell around the live dashboard: it loads
// https://geega-games.com/admin_dashboard, so every Vercel deploy reaches it
// immediately and a new app build is only needed for native changes (or to
// refresh the TestFlight build before it expires). What the shell adds is
// native push notifications with a different sound per type — the one thing
// a web app can't do (see api/_lib/apns.ts).
//
// Only admin pages stay in the app: Capacitor opens any other address
// (storefront links, email links) in Safari.

const config: CapacitorConfig = {
  appId: "com.geegagames.admin",
  appName: "Geega Admin",
  // Bundled into the app: the offline screen and the notification sounds.
  webDir: "native/www",
  server: {
    url: "https://geega-games.com/admin_dashboard",
    errorPath: "offline.html",
  },
  ios: {
    // The dashboard's CSS doesn't pad for the notch/home bar; let iOS inset it.
    contentInset: "always",
    backgroundColor: "#ffffff",
    appendUserAgent: "GeegaAdminApp",
  },
  plugins: {
    PushNotifications: {
      // Show alerts (with their own sound) even while the app is open.
      presentationOptions: ["badge", "sound", "banner", "list"],
    },
  },
};

export default config;
