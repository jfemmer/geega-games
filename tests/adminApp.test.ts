import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADMIN_APP_HEAD, toAdminShell } from "../scripts/adminShell";

// The installable admin app: its HTML shell, manifest, service worker and
// routing have to line up, or iOS won't offer push and Android won't install.

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

interface Rewrite {
  source: string;
  destination: string;
}

describe("admin app shell", () => {
  it("adds the manifest and home-screen tags, and swaps in the admin icon and color", () => {
    const shell = toAdminShell(read("index.html").replace("<!--seo-head-->", `<!--seo-head-->${ADMIN_APP_HEAD}`));
    expect(shell).toContain('<link rel="manifest" href="/admin.webmanifest" />');
    expect(shell).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(shell).toContain('<meta name="apple-mobile-web-app-title" content="Geega Admin" />');
    expect(shell).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(shell).toContain('<link rel="apple-touch-icon" href="/admin-apple-touch-icon.png" />');
    expect(shell).toContain('<meta name="theme-color" content="#120719" />');
    expect(shell).not.toContain('href="/apple-touch-icon.png"');
  });

  it("fails the build instead of shipping a shell without the admin icon", () => {
    expect(() => toAdminShell("<html><head></head></html>")).toThrow(/admin shell/);
  });

  it("keeps the storefront free of the admin manifest", () => {
    expect(read("index.html")).not.toContain("admin.webmanifest");
  });
});

describe("admin manifest and service worker", () => {
  const manifest = JSON.parse(read("public/admin.webmanifest")) as {
    start_url: string;
    scope: string;
    display: string;
    icons: { src: string; sizes: string; purpose: string }[];
    shortcuts: { url: string }[];
  };

  it("is a standalone app scoped to the dashboard", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.scope).toBe("/admin_dashboard");
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
    for (const s of manifest.shortcuts) expect(s.url.startsWith(manifest.scope)).toBe(true);
  });

  it("points at icons that exist, including 192, 512 and maskable", () => {
    for (const icon of manifest.icons) expect(existsSync(new URL(`public${icon.src}`, root)), icon.src).toBe(true);
    expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
    for (const file of ["public/admin-apple-touch-icon.png", "public/admin-badge-96.png"]) {
      expect(existsSync(new URL(file, root)), file).toBe(true);
    }
  });

  it("registers the service worker with the same scope the manifest uses", () => {
    const push = read("src/admin/services/push.ts");
    expect(push).toContain(`ADMIN_SW_SCOPE = "${manifest.scope}"`);
    expect(existsSync(new URL("public/admin-sw.js", root))).toBe(true);
  });

  it("only ever opens admin pages from a notification tap", () => {
    const sw = read("public/admin-sw.js");
    expect(sw).toContain('candidate.pathname.startsWith("/admin_dashboard")');
    expect(sw).not.toMatch(/addEventListener\("fetch"/); // no caching layer to go stale
  });
});

describe("vercel.json routing for the admin app", () => {
  const rewrites = (JSON.parse(read("vercel.json")) as { rewrites: Rewrite[] }).rewrites;
  const indexOf = (source: string) => rewrites.findIndex((r) => r.source === source);

  it("serves the admin shell for /admin and every dashboard path", () => {
    for (const source of ["/admin", "/admin_dashboard", "/admin_dashboard/:path*"]) {
      const i = indexOf(source);
      expect(i, source).toBeGreaterThanOrEqual(0);
      expect(rewrites[i].destination).toBe("/admin.html");
    }
  });

  it("puts the admin rewrites before the storefront catch-all", () => {
    const catchAll = rewrites.findIndex((r) => r.destination === "/spa.html");
    expect(indexOf("/admin_dashboard/:path*")).toBeLessThan(catchAll);
  });
});
