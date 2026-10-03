import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Vercel packages each API function by tracing what it imports. That tracer
// follows `./x.js` to a `./x.ts` file, but never to a `./x.tsx` one, and a
// miss is only a build warning: the deploy succeeds and the function then
// dies with ERR_MODULE_NOT_FOUND every time it runs. TypeScript and Vitest
// both resolve `.tsx` happily, so nothing else notices.
//
// That is how the deck restock alert worker failed on every run: its email
// template was the one .tsx file under api/. So this checks every relative
// import reachable from api/ against the tracer's rule.

const REPO = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const SOURCE = /\.(ts|mts|cts|js|mjs)$/;

const isFile = (path: string) => existsSync(path) && statSync(path).isFile();

/** The relative imports a file needs when it runs (type-only imports are erased). */
function runtimeImports(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, false);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause as (ts.ImportClause & { phaseModifier?: ts.SyntaxKind }) | undefined;
      const typeOnly = clause?.isTypeOnly === true || clause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
      if (!typeOnly) found.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) found.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found.filter((specifier) => specifier.startsWith("./") || specifier.startsWith("../"));
}

/** The file Vercel's tracer loads for a relative import, or null when it finds none. */
function bundledFile(fromFile: string, specifier: string): string | null {
  const target = resolve(dirname(fromFile), specifier);
  if (isFile(target)) return target;
  if (specifier.endsWith(".js") && isFile(`${target.slice(0, -3)}.ts`)) return `${target.slice(0, -3)}.ts`;
  return null;
}

function sourceFilesUnder(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFilesUnder(full, found);
    else if (SOURCE.test(name) && !name.endsWith(".d.ts")) found.push(full);
  }
  return found;
}

/**
 * Every import, in any file reachable from `startDir`, that would be missing
 * from the deployed function. Each entry reads "file -> import (why)".
 */
function importsMissingFromBundle(root: string, startDir: string): string[] {
  const queue = sourceFilesUnder(startDir);
  const seen = new Set(queue);
  const missing: string[] = [];

  while (queue.length > 0) {
    const file = queue.pop()!;
    for (const specifier of runtimeImports(file)) {
      const found = bundledFile(file, specifier);
      if (!found) {
        const target = resolve(dirname(file), specifier);
        const why = isFile(`${target.replace(/\.js$/, "")}.tsx`)
          ? "it is a .tsx file: rename it to .ts and build it with React.createElement"
          : /\.[a-z]+$/.test(specifier)
            ? "no such file"
            : "it needs its .js extension";
        missing.push(`${relative(root, file)} -> ${specifier} (${why})`);
        continue;
      }
      if (SOURCE.test(found) && !seen.has(found)) {
        seen.add(found);
        queue.push(found);
      }
    }
  }
  return missing.sort();
}

describe("API functions can be bundled by Vercel", () => {
  it("every file they import is one the bundler will include", () => {
    expect(importsMissingFromBundle(REPO, join(REPO, "api"))).toEqual([]);
  });

  it("the deck restock alert worker's template is a plain .ts module", () => {
    expect(isFile(join(REPO, "api/_lib/emails/DeckStockAlert.ts"))).toBe(true);
    expect(bundledFile(join(REPO, "api/deck-alerts/process.ts"), "../_lib/emails/DeckStockAlert.js")).toBe(
      join(REPO, "api/_lib/emails/DeckStockAlert.ts"),
    );
  });
});

// The check above is only worth having if it fails when it should.
describe("the bundling check itself", () => {
  const fixture = mkdtempSync(join(tmpdir(), "gg-api-bundling-"));
  afterAll(() => rmSync(fixture, { recursive: true, force: true }));

  function project(name: string, files: Record<string, string>): string {
    const root = join(fixture, name);
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    return root;
  }

  it("passes when a .js import has a .ts file behind it", () => {
    const root = project("ok", {
      "api/worker.ts": 'import { template } from "./_lib/template.js";\nexport default template;\n',
      "api/_lib/template.ts": "export const template = 1;\n",
    });
    expect(importsMissingFromBundle(root, join(root, "api"))).toEqual([]);
  });

  it("catches a .tsx file imported as .js, which is what broke deck alerts", () => {
    const root = project("tsx", {
      "api/worker.ts": 'import { Template } from "./_lib/Template.js";\nexport default Template;\n',
      "api/_lib/Template.tsx": "export const Template = () => null;\n",
    });
    expect(importsMissingFromBundle(root, join(root, "api"))).toEqual([
      "api/worker.ts -> ./_lib/Template.js (it is a .tsx file: rename it to .ts and build it with React.createElement)",
    ]);
  });

  it("follows imports out of api/ into shared code", () => {
    const root = project("shared", {
      "api/worker.ts": 'export { slug } from "../src/lib/slug.js";\n',
      "src/lib/slug.ts": 'import { View } from "./View.js";\nexport const slug = String(View);\n',
      "src/lib/View.tsx": "export const View = () => null;\n",
    });
    expect(importsMissingFromBundle(root, join(root, "api"))).toEqual([
      "src/lib/slug.ts -> ./View.js (it is a .tsx file: rename it to .ts and build it with React.createElement)",
    ]);
  });

  it("catches a file that isn't there, a missing extension, and a lazy import", () => {
    const root = project("misc", {
      "api/worker.ts": [
        'import "./gone.js";',
        'import { helper } from "./helper";',
        'export const load = () => import("./Lazy.js");',
        "export default helper;",
        "",
      ].join("\n"),
      "api/helper.ts": "export const helper = 1;\n",
      "api/Lazy.tsx": "export default () => null;\n",
    });
    expect(importsMissingFromBundle(root, join(root, "api"))).toEqual([
      "api/worker.ts -> ./Lazy.js (it is a .tsx file: rename it to .ts and build it with React.createElement)",
      "api/worker.ts -> ./gone.js (no such file)",
      "api/worker.ts -> ./helper (it needs its .js extension)",
    ]);
  });

  it("ignores type-only imports, which never reach the deployed function", () => {
    const root = project("types", {
      "api/worker.ts": [
        'import type { Props } from "./View.js";',
        'export type { Props as ViewProps } from "./View.js";',
        "export const worker = (props: Props) => props;",
        "",
      ].join("\n"),
      "api/View.tsx": "export type Props = { id: string };\nexport const View = () => null;\n",
    });
    expect(importsMissingFromBundle(root, join(root, "api"))).toEqual([]);
  });
});
