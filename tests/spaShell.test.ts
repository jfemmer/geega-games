import { describe, expect, it } from "vitest";
import {
  FETCHED_SHELL_MAX_AGE_MS,
  createSpaShellLoader,
  shellOrigins,
  type ShellLoaderDeps,
} from "../api/_lib/spaShell";

// The catalog function (api/catalog-page.ts) fills in the storefront's HTML
// shell. It should use the copy packaged with it; if that's ever missing it
// fetches the shell from the site instead, and only ever from this site.

const SHELL = "<head><!--seo-head--><title>Shell</title><!--/seo-head--></head><body><div id=\"root\"></div></body>";
const OTHER_SHELL = SHELL.replace("Shell", "Newer shell");
const SIGN_IN_WALL = "<html><body>Log in to Vercel</body></html>";

function setup(opts: {
  files?: Record<string, string>;
  site?: Record<string, { ok?: boolean; html: string } | Error>;
}) {
  let time = 1_000_000;
  const read: string[] = [];
  const fetched: string[] = [];
  const site = { ...opts.site };
  const deps: ShellLoaderDeps = {
    files: ["/var/task/dist/spa.html", "/var/task/api/../dist/spa.html"],
    readFile: async (file) => {
      read.push(file);
      const content = opts.files?.[file];
      if (content === undefined) throw new Error("ENOENT");
      return content;
    },
    fetch: async (url, init) => {
      fetched.push(url);
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const answer = site[url];
      if (!answer) return { ok: false, text: async () => "Not found" };
      if (answer instanceof Error) throw answer;
      return { ok: answer.ok ?? true, text: async () => answer.html };
    },
    now: () => time,
  };
  return {
    loader: createSpaShellLoader(deps),
    read,
    fetched,
    site,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe("the packaged shell", () => {
  it("is used when it's there, and read only once", async () => {
    const t = setup({ files: { "/var/task/dist/spa.html": SHELL } });
    expect(await t.loader.load("geega-games.com")).toEqual({ html: SHELL, source: "bundle" });
    t.advance(24 * 60 * 60 * 1000);
    expect(await t.loader.load("geega-games.com")).toEqual({ html: SHELL, source: "bundle" });
    expect(t.read).toEqual(["/var/task/dist/spa.html"]);
    expect(t.fetched).toEqual([]);
  });

  it("is looked for in the second place a function can be laid out", async () => {
    const t = setup({ files: { "/var/task/api/../dist/spa.html": SHELL } });
    expect(await t.loader.load()).toEqual({ html: SHELL, source: "bundle" });
    expect(t.read).toEqual(["/var/task/dist/spa.html", "/var/task/api/../dist/spa.html"]);
  });

  it("is ignored if it isn't a shell that can be filled in", async () => {
    const t = setup({
      files: { "/var/task/dist/spa.html": "<html>not the shell</html>" },
      site: { "https://geega-games.com/spa.html": { html: SHELL } },
    });
    expect(await t.loader.load("geega-games.com")).toEqual({ html: SHELL, source: "fetch" });
  });
});

describe("the fetched shell", () => {
  it("comes from the host the request arrived on, when that host is ours", async () => {
    const t = setup({ site: { "https://geega-games.vercel.app/spa.html": { html: SHELL } } });
    expect(await t.loader.load("geega-games.vercel.app")).toEqual({ html: SHELL, source: "fetch" });
    expect(t.fetched).toEqual(["https://geega-games.vercel.app/spa.html"]);
  });

  it("falls back to the production site when that host answers with something else", async () => {
    // A preview deployment's own address answers with a sign-in page.
    const t = setup({
      site: {
        "https://geega-games-abc123-team.vercel.app/spa.html": { html: SIGN_IN_WALL },
        "https://geega-games.com/spa.html": { html: SHELL },
      },
    });
    expect(await t.loader.load("geega-games-abc123-team.vercel.app")).toEqual({ html: SHELL, source: "fetch" });
    expect(t.fetched).toEqual([
      "https://geega-games-abc123-team.vercel.app/spa.html",
      "https://geega-games.com/spa.html",
    ]);
  });

  it("is never fetched from a host that isn't this site", async () => {
    const t = setup({
      site: { "https://evil.example/spa.html": { html: SHELL }, "https://geega-games.com/spa.html": { html: SHELL } },
    });
    await t.loader.load("evil.example");
    expect(t.fetched).toEqual(["https://geega-games.com/spa.html"]);
  });

  it("skips an error answer, a failed request and a page that isn't the shell", async () => {
    const t = setup({
      site: {
        "https://geega-games.vercel.app/spa.html": new Error("socket hang up"),
        "https://geega-games.com/spa.html": { ok: false, html: SHELL },
      },
    });
    expect(await t.loader.load("geega-games.vercel.app")).toBeNull();
    expect(t.fetched).toHaveLength(2);
  });

  it("is trusted for a few minutes, then fetched again", async () => {
    const t = setup({ site: { "https://geega-games.com/spa.html": { html: SHELL } } });
    expect((await t.loader.load("geega-games.com"))?.html).toBe(SHELL);
    t.advance(FETCHED_SHELL_MAX_AGE_MS - 1);
    await t.loader.load("geega-games.com");
    expect(t.fetched).toHaveLength(1);

    // A release has gone out since: the next fetch picks up its shell.
    t.site["https://geega-games.com/spa.html"] = { html: OTHER_SHELL };
    t.advance(1);
    expect(await t.loader.load("geega-games.com")).toEqual({ html: OTHER_SHELL, source: "fetch" });
    expect(t.fetched).toHaveLength(2);
  });

  it("keeps serving the last copy if it can't be refreshed", async () => {
    const t = setup({ site: { "https://geega-games.com/spa.html": { html: SHELL } } });
    await t.loader.load("geega-games.com");
    delete t.site["https://geega-games.com/spa.html"];
    t.advance(FETCHED_SHELL_MAX_AGE_MS + 1);
    expect(await t.loader.load("geega-games.com")).toEqual({ html: SHELL, source: "fetch" });
  });

  it("switches to the packaged copy as soon as there is one", async () => {
    const files: Record<string, string> = {};
    const t = setup({ files, site: { "https://geega-games.com/spa.html": { html: SHELL } } });
    expect((await t.loader.load("geega-games.com"))?.source).toBe("fetch");
    files["/var/task/dist/spa.html"] = OTHER_SHELL;
    t.advance(FETCHED_SHELL_MAX_AGE_MS + 1);
    expect(await t.loader.load("geega-games.com")).toEqual({ html: OTHER_SHELL, source: "bundle" });
  });
});

describe("when there is no shell at all", () => {
  it("returns null, and tries again on the next request", async () => {
    const t = setup({});
    expect(await t.loader.load("geega-games.com")).toBeNull();
    t.site["https://geega-games.com/spa.html"] = { html: SHELL };
    expect(await t.loader.load("geega-games.com")).toEqual({ html: SHELL, source: "fetch" });
  });

  it("forgets what it had when reset", async () => {
    const t = setup({ site: { "https://geega-games.com/spa.html": { html: SHELL } } });
    await t.loader.load("geega-games.com");
    delete t.site["https://geega-games.com/spa.html"];
    t.loader.reset();
    expect(await t.loader.load("geega-games.com")).toBeNull();
  });
});

describe("shellOrigins", () => {
  it("allows only this site's own hosts", () => {
    expect(shellOrigins("geega-games.com")).toEqual(["https://geega-games.com"]);
    expect(shellOrigins("www.geega-games.com")).toEqual(["https://www.geega-games.com", "https://geega-games.com"]);
    expect(shellOrigins(" GEEGA-GAMES.vercel.app ")).toEqual(["https://geega-games.vercel.app", "https://geega-games.com"]);
    expect(shellOrigins("geega-games-git-fix-seo-team.vercel.app")).toEqual([
      "https://geega-games-git-fix-seo-team.vercel.app",
      "https://geega-games.com",
    ]);
  });

  it("ignores every other host, however it's dressed up", () => {
    for (const host of [
      undefined,
      "",
      "evil.example",
      "geega-games.com.evil.example",
      "geega-games.vercel.app.evil.example",
      "evil-geega-games.vercel.app",
      "notgeega-games.com",
      "geega-games.com:8080",
      "geega-games.com/@evil.example",
      "geega-games.vercel.app#.evil.example",
      "localhost",
      "169.254.169.254",
    ]) {
      expect(shellOrigins(host), String(host)).toEqual(["https://geega-games.com"]);
    }
  });
});
