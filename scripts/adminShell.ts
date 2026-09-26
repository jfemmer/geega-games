// The admin dashboard's own HTML shell (dist/admin.html), written by
// scripts/prerender.ts and served for /admin and /admin_dashboard/* by
// vercel.json.
//
// It's the same empty app shell as spa.html, plus what makes the dashboard
// installable as its own app ("Geega Admin"): the web app manifest, the iOS
// home-screen tags and the admin icon. It has to be a separate file rather
// than tags added at runtime because iOS Safari reads them from the HTML
// when you tap "Add to Home Screen" — and on iPhone, push notifications only
// work for web apps added that way. Keeping them out of the storefront's
// HTML means shoppers are never offered the admin app.

export const ADMIN_APP_HEAD = [
  "<title>Geega Admin</title>",
  '<meta name="robots" content="noindex, nofollow" />',
  '<link rel="manifest" href="/admin.webmanifest" />',
  '<meta name="mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-title" content="Geega Admin" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
].join("\n    ");

const REPLACEMENTS: [RegExp, string][] = [
  [/<link rel="apple-touch-icon" href="[^"]*" ?\/?>/, '<link rel="apple-touch-icon" href="/admin-apple-touch-icon.png" />'],
  [/<meta name="theme-color" content="[^"]*" ?\/?>/, '<meta name="theme-color" content="#120719" />'],
];

/** Swap the storefront's icon and theme color for the admin app's. Throws if the template changed shape. */
export function toAdminShell(shell: string): string {
  let html = shell;
  for (const [pattern, replacement] of REPLACEMENTS) {
    if (!pattern.test(html)) {
      throw new Error(`admin shell: index.html no longer has ${pattern} — update scripts/adminShell.ts`);
    }
    html = html.replace(pattern, replacement);
  }
  return html;
}
