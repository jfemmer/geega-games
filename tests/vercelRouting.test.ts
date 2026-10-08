import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { seoRoutes } from "../src/seo/routes";
import { APP_SHELL_ROUTES, CATALOG_ROUTES, INDEXABLE_APP_SHELL_ROUTES } from "../src/seo/appRoutes";
import {
  createRouter,
  expectedPages,
  routingProblems,
  sampleAddresses,
  type VercelRoutingConfig,
} from "../scripts/vercelRoutes";

// vercel.json decides what every address on the live site returns, and it has
// no catch-all: an address it doesn't name is a real 404. So it has to agree
// with the pages the app actually has —
//   * src/seo/routes.ts       prerendered content pages
//   * src/seo/appRoutes.ts    app-only pages and the catalog (card/set) pages
//   * src/App.tsx             the route table the browser uses
// — or a real page 404s in production while working fine in local dev (the
// dev server answers every address). The build runs the same check
// (scripts/prerender.ts); these tests explain a failure and cover the rest:
// the old site's addresses, trailing slashes and which pages say "noindex".

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

type Config = VercelRoutingConfig & {
  functions?: Record<string, { includeFiles?: string }>;
};
const config = JSON.parse(read("vercel.json")) as Config;
const route = createRouter(config);
const prerendered = seoRoutes().map((r) => r.path);

/** Where vercel.json sends a page (the rewrite's target), or what else it does with it. */
function servedFrom(path: string): string {
  const result = route(path);
  return result.type === "rewrite" ? result.destination : result.type;
}

describe("vercel.json serves every page the site has", () => {
  it("passes the check the build runs", () => {
    expect(routingProblems(config, expectedPages(prerendered))).toEqual([]);
  });

  it("sends each prerendered page to its own HTML file", () => {
    for (const path of prerendered) {
      if (path === "/") continue; // dist/index.html itself; no rule needed (or wanted)
      expect(servedFrom(path), path).toBe(`${path}/index.html`);
    }
    expect(route("/").type).toBe("unmatched");
  });

  it("sends card and set pages to the catalog function, with the address in the query", () => {
    expect(servedFrom("/shop/card/force-of-will")).toBe("/api/catalog-page?kind=card&slug=force-of-will");
    expect(servedFrom("/shop/set/mh2")).toBe("/api/catalog-page?kind=set&code=mh2");
    expect(existsSync(new URL("api/catalog-page.ts", root))).toBe(true);
  });

  it("packages the app shell with the catalog function, which fills it in", () => {
    expect(config.functions?.["api/catalog-page.ts"]?.includeFiles).toBe("dist/spa.html");
  });

  it("sends the app-only pages to the neutral shell", () => {
    for (const path of [
      "/login",
      "/signup",
      "/forgot-password",
      "/reset-password",
      "/checkout",
      "/track-order",
      "/sell/offer",
      "/kiosk",
      "/account",
      "/account/orders",
      "/account/orders/0b5f8c1e",
      "/account/decks/abc/edit",
    ]) {
      expect(servedFrom(path), path).toBe("/spa.html");
    }
  });

  it("sends the admin dashboard to its own installable-app shell", () => {
    for (const path of ["/admin", "/admin_dashboard", "/admin_dashboard/orders", "/admin_dashboard/scanning/abc"]) {
      expect(servedFrom(path), path).toBe("/admin.html");
    }
  });

  it("keeps the sitemap on its function and never rewrites /api", () => {
    expect(servedFrom("/sitemap.xml")).toBe("/api/sitemap");
    expect(servedFrom("/feeds/products.xml")).toBe("/api/merchant-feed");
    expect(existsSync(new URL("api/merchant-feed.ts", root))).toBe(true);
    expect(route("/api/sell/submit").type).toBe("unmatched");
    expect(route("/api/catalog-page").type).toBe("unmatched");
  });
});

describe("the registries and vercel.json list the same pages", () => {
  const rewrites = config.rewrites ?? [];

  it("has a shell rewrite for exactly the pages in APP_SHELL_ROUTES", () => {
    const shellSources = rewrites.filter((r) => r.destination === "/spa.html").map((r) => r.source);
    expect([...shellSources].sort()).toEqual([...APP_SHELL_ROUTES].sort());
  });

  it("has the catalog rewrites exactly as CATALOG_ROUTES states them", () => {
    for (const entry of CATALOG_ROUTES) expect(rewrites).toContainEqual(entry);
    const catalogSources = rewrites.filter((r) => r.destination.startsWith("/api/catalog-page")).map((r) => r.source);
    expect(catalogSources).toEqual(CATALOG_ROUTES.map((r) => r.source));
  });

  it("only calls app-only pages indexable if they are app-only pages", () => {
    for (const source of INDEXABLE_APP_SHELL_ROUTES) {
      expect(APP_SHELL_ROUTES as readonly string[], source).toContain(source);
    }
  });
});

describe("every route in src/App.tsx is served", () => {
  // The app's route table is an if-chain, so this reads the addresses out of
  // the source. If App.tsx starts declaring routes some other way, the counts
  // below fail first: teach this test the new shape rather than deleting it.
  const app = read("src/App.tsx");
  const exact = [...app.matchAll(/\bpath(?:name)? === "(\/[^"]*)"/g)].map((m) => m[1]);
  const patterns = [...app.matchAll(/matchRoute\("(\/[^"]+)"/g)].map((m) => m[1]);
  const prefixes = [...app.matchAll(/\.startsWith\("(\/[^"]+)"\)/g)].map((m) => m[1]);

  it("can still see the route table", () => {
    expect(exact.length).toBeGreaterThanOrEqual(20);
    expect(exact).toEqual(expect.arrayContaining(["/", "/shop", "/login", "/checkout", "/account", "/kiosk"]));
    expect(patterns).toEqual(
      expect.arrayContaining(["/shop/set/:code", "/shop/card/:slug", "/sell-magic-cards/:slug", "/guides/:slug"]),
    );
    expect(prefixes).toContain("/account/");
  });

  it("has a rule in vercel.json for each one", () => {
    const addresses = [
      ...exact,
      ...patterns.flatMap((pattern) => sampleAddresses(pattern)),
      ...prefixes.map((prefix) => `${prefix}sample`),
    ];
    for (const address of addresses) {
      if (address === "/") continue;
      expect(
        route(address).type,
        `${address} is a page in src/App.tsx but vercel.json has no rewrite for it, so it would be a 404 on the live site`,
      ).toBe("rewrite");
    }
  });
});

describe("addresses nothing claims", () => {
  it("are left to the 404 page instead of being answered by the app", () => {
    for (const path of [
      "/this-page-does-not-exist",
      "/team",
      "/about-us",
      "/upload.html",
      "/wp-login.php",
      "/Shop",
      "/LOGIN",
      "/loginx",
      "/kiosk/extra",
      "/track-order/extra",
      "/shop/sets/extra",
      "/shop/card",
      "/shop/card/a/b",
      "/shop/set",
      "/images/other.png",
    ]) {
      expect(route(path).type, path).toBe("unmatched");
    }
  });

  it("don't include /favicon.ico: browsers and Google ask for it by habit, so it is a real file", () => {
    // With a catch-all this address answered "200 OK" with the app's HTML,
    // which no client can use as an icon.
    const icon = readFileSync(new URL("public/favicon.ico", root));
    expect([...icon.subarray(0, 4)]).toEqual([0, 0, 1, 0]); // ICO header
    expect(icon.readUInt16LE(4)).toBeGreaterThanOrEqual(2); // several sizes
  });

  it("includes a made-up guide or city, once the missing file is noticed", () => {
    // Their rewrites point at a file that isn't there; Vercel then carries on
    // and finds nothing. `exists` tells the model which files are there.
    const built = new Set(["/guides/real-guide/index.html", "/spa.html", "/admin.html"]);
    const withFiles = createRouter(config, (path) => built.has(path));
    expect(withFiles("/guides/real-guide")).toMatchObject({ type: "rewrite", destination: "/guides/real-guide/index.html" });
    expect(withFiles("/guides/made-up-guide").type).toBe("unmatched");
    expect(withFiles("/sell-magic-cards/atlantis").type).toBe("unmatched");
  });
});

describe("the old site's addresses", () => {
  // The site that lived on this domain before (static .html pages). Google
  // still asks for these; each goes to the page that replaced it.
  const moved: [from: string, to: string][] = [
    ["/index.html", "/"],
    ["/login.html", "/login"],
    ["/signup.html", "/signup"],
    ["/account.html", "/account"],
    ["/wishlist.html", "/account/wishlist"],
    ["/cart.html", "/shop"],
    ["/checkout.html", "/shop"],
    ["/checkout-success.html", "/track-order"],
    ["/request.html", "/contact"],
    ["/sell.html", "/sell-my-collection"],
    ["/tradeIn.html", "/sell"],
    ["/admin_dashboard.html", "/admin_dashboard"],
    ["/images/logo.png", "/logo.png"],
    ["/cards", "/shop"],
    ["/cards/abc123", "/shop"],
    ["/sell-magic-cards", "/sell-my-collection"],
  ];

  it.each(moved)("%s moves permanently to %s", (from, to) => {
    expect(route(from)).toEqual({ type: "redirect", status: 308, location: to });
  });

  it("lands on a page that exists, in one hop", () => {
    for (const [from, to] of moved) {
      const landing = route(to);
      expect(landing.type, `${from} → ${to}`).not.toBe("redirect");
      if (to === "/") continue;
      if (to === "/logo.png") {
        expect(existsSync(new URL("public/logo.png", root))).toBe(true);
        continue;
      }
      expect(landing.type, `${from} → ${to}`).toBe("rewrite");
    }
  });

  it("never redirects a page the site has now", () => {
    for (const path of ["/", ...prerendered]) expect(route(path).type, path).not.toBe("redirect");
  });
});

describe("the vercel.app address", () => {
  // Vercel gives the project geega-games.vercel.app as well as the real
  // domain. Two addresses for the same pages split their search signals, so
  // pages there move permanently to geega-games.com, as Vercel recommends:
  // https://vercel.com/kb/guide/avoiding-duplicate-content-with-vercel-app-urls
  const onVercelApp = (path: string) => route(path, { host: "geega-games.vercel.app" });

  it("sends every page to the same page on geega-games.com, in one permanent hop", () => {
    const cases: [string, string][] = [
      ["/", "https://geega-games.com/"],
      ["/shop", "https://geega-games.com/shop"],
      ["/shop/card/force-of-will", "https://geega-games.com/shop/card/force-of-will"],
      ["/sell-magic-cards/st-louis", "https://geega-games.com/sell-magic-cards/st-louis"],
      ["/sitemap.xml", "https://geega-games.com/sitemap.xml"],
    ];
    for (const [from, to] of cases) {
      expect(onVercelApp(from), from).toEqual({ type: "redirect", status: 308, location: to });
    }
  });

  it("leaves alone what must keep answering there: the API, the admin app and the in-store kiosk", () => {
    // Cron jobs and payment webhooks call the API; a redirect would break
    // them. The admin app and the kiosk keep their sign-in on the address
    // they were opened at (and the admin app its notifications).
    for (const path of ["/api/indexnow", "/api/stripe/webhook", "/admin", "/admin_dashboard/orders", "/admin-sw.js", "/admin.webmanifest", "/kiosk"]) {
      expect(onVercelApp(path).type, path).not.toBe("redirect");
    }
  });

  it("changes nothing on geega-games.com itself", () => {
    for (const path of ["/", "/shop", "/shop/card/force-of-will", "/sitemap.xml"]) {
      expect(route(path).type, path).not.toBe("redirect");
      expect(route(path, { host: "geega-games.com" }).type, path).not.toBe("redirect");
    }
  });
});

describe("caching", () => {
  it("keeps the app's fingerprinted files for a year: a changed file gets a new name", () => {
    // Vite names every file in /assets after a hash of its contents.
    const rule = (path: string) => (route(path) as { headers: Record<string, string> }).headers["cache-control"];
    expect(rule("/assets/index-AbC123.js")).toBe("public, max-age=31536000, immutable");
    expect(rule("/assets/store-9f8e7d.css")).toBe("public, max-age=31536000, immutable");
    // Files whose names never change are left to Vercel's default (always revalidated).
    for (const path of ["/", "/logo.png", "/favicon.ico", "/admin-sw.js", "/sitemap.xml", "/shop"]) {
      expect(rule(path), path).toBeUndefined();
    }
  });
});

describe("trailing slashes", () => {
  it("redirect to the address without one, so each page has a single address", () => {
    const cases: [string, string][] = [
      ["/shop/", "/shop"],
      ["/login/", "/login"],
      ["/account/orders/", "/account/orders"],
      ["/guides/where-to-sell-magic-cards/", "/guides/where-to-sell-magic-cards"],
      ["/shop/card/force-of-will/", "/shop/card/force-of-will"],
      ["/admin_dashboard/", "/admin_dashboard"],
    ];
    for (const [from, to] of cases) {
      expect(route(from), from).toEqual({ type: "redirect", status: 308, location: to });
    }
  });

  it("leave the homepage and the API alone", () => {
    expect(route("/").type).toBe("unmatched");
    expect(route("/api/track/").type).toBe("unmatched");
    expect(route("/api/").type).toBe("unmatched");
  });
});

describe("which pages ask not to be indexed", () => {
  const robots = (path: string) => {
    const result = route(path);
    return result.type === "redirect" ? undefined : result.headers["x-robots-tag"];
  };

  it("app-only pages do, apart from the ones listed as indexable", () => {
    for (const source of APP_SHELL_ROUTES) {
      const indexable = INDEXABLE_APP_SHELL_ROUTES.includes(source);
      for (const address of sampleAddresses(source)) {
        expect(robots(address), address).toBe(indexable ? undefined : "noindex");
      }
    }
  });

  it("the shell files themselves do", () => {
    for (const file of ["/spa.html", "/404.html", "/admin.html"]) expect(robots(file), file).toBe("noindex");
  });

  it("content pages and card and set pages don't", () => {
    for (const path of [...prerendered, "/shop/card/force-of-will", "/shop/set/mh2", "/sitemap.xml", "/logo.png"]) {
      expect(robots(path), path).toBeUndefined();
    }
  });
});

// The build check is only worth having if it fails when it should.
describe("the build's routing check", () => {
  const pages = expectedPages(["/", "/about"]);
  const good: VercelRoutingConfig = {
    rewrites: [
      { source: "/about", destination: "/about/index.html" },
      ...CATALOG_ROUTES,
      ...APP_SHELL_ROUTES.map((source) => ({ source, destination: "/spa.html" })),
    ],
  };

  it("passes a config that serves every page", () => {
    expect(routingProblems(good, pages)).toEqual([]);
  });

  it("catches a page with no rewrite", () => {
    const rewrites = good.rewrites!.filter((r) => r.source !== "/checkout");
    expect(routingProblems({ rewrites }, pages)).toEqual([
      '/checkout has no rewrite, so it would be "404 Not Found" on the live site. Add one to /spa.html.',
    ]);
  });

  it("catches a page sent to the wrong place", () => {
    const rewrites = good.rewrites!.map((r) => (r.source === "/about" ? { ...r, destination: "/spa.html" } : r));
    expect(routingProblems({ rewrites }, pages)).toEqual([
      "/about is rewritten to /spa.html; it should go to /about/index.html.",
    ]);
  });

  it("catches a redirect that swallows a page", () => {
    const redirects = [{ source: "/about", destination: "/", permanent: true }];
    expect(routingProblems({ ...good, redirects }, pages)).toEqual([
      "/about is redirected to /, but it is a page: it should be served from /about/index.html.",
    ]);
  });

  it("catches a catch-all rewrite coming back", () => {
    const rewrites = [...good.rewrites!, { source: "/((?!api/).*)", destination: "/spa.html" }];
    const problems = routingProblems({ rewrites }, pages);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/^\/no-such-page isn't a page, but it is rewritten to \/spa\.html\./);
  });

  it("matches addresses the way Vercel does: exactly, and case-sensitively", () => {
    const strict = createRouter({ rewrites: [{ source: "/login", destination: "/spa.html" }] });
    expect(strict("/login").type).toBe("rewrite");
    expect(strict("/login/").type).toBe("unmatched");
    expect(strict("/Login").type).toBe("unmatched");
    expect(strict("/login/reset").type).toBe("unmatched");
  });

  it("makes sample addresses from a pattern, and refuses patterns it can't sample", () => {
    expect(sampleAddresses("/login")).toEqual(["/login"]);
    expect(sampleAddresses("/shop/card/:slug")).toEqual(["/shop/card/sample"]);
    expect(sampleAddresses("/account/:path*")).toEqual(["/account/sample", "/account/sample/deeper"]);
    expect(() => sampleAddresses("/((?!api/).*)")).toThrow(/sample address/);
  });
});
