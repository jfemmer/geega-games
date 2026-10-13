import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// The bridge must start, scan and upload even on a PC where the card
// recognizer's native code can't load: ONNX Runtime needs the Microsoft
// Visual C++ Redistributable on Windows, and a missing one used to crash the
// whole bridge before its status server opened, so the dashboard only said
// "Not connected". So nothing the bridge loads at startup may reach ONNX
// Runtime or sharp. Only bridge.ts's dynamic import() does. This walks the
// real static import graph from the entry point, as Node will load it
// (TypeScript's own emit, so type-only imports are dropped exactly as in
// the build), and fails if that boundary is ever crossed again.

const SRC = path.dirname(fileURLToPath(import.meta.url));
const NATIVE_PACKAGES = ["onnxruntime-node", "onnxruntime-common", "sharp", "@gutenye/ocr-models"];
/** The only recognizer files the core may load: settings, status, types, load-failure wording. */
const LIGHT_RECOGNIZER_FILES = new Set(["status.ts", "loadFailure.ts", "types.ts"]);

const STATIC_IMPORT = /^\s*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/gm;

function staticImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName: file,
  }).outputText;
  return [...js.matchAll(STATIC_IMPORT)].map((m) => m[1]);
}

function packageOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** Every source file and package reachable from `entry` through static imports. */
function staticGraph(entry: string): { files: Set<string>; packages: Map<string, string[]> } {
  const files = new Set<string>();
  const packages = new Map<string, string[]>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of staticImports(file)) {
      if (specifier.startsWith(".")) {
        queue.push(path.resolve(path.dirname(file), specifier.replace(/\.js$/, ".ts")));
      } else if (!specifier.startsWith("node:")) {
        const pkg = packageOf(specifier);
        packages.set(pkg, [...(packages.get(pkg) ?? []), path.relative(SRC, file)]);
      }
    }
  }
  return { files, packages };
}

describe("the bridge's startup imports", () => {
  const graph = staticGraph(path.join(SRC, "index.ts"));

  it("include the core of the bridge", () => {
    const names = [...graph.files].map((f) => path.relative(SRC, f).split(path.sep).join("/"));
    expect(names).toEqual(
      expect.arrayContaining(["index.ts", "bridge.ts", "config.ts", "statusServer.ts", "watcher.ts", "uploader.ts", "auth.ts"]),
    );
  });

  it("never reach ONNX Runtime or sharp (the recognizer loads lazily)", () => {
    const offenders = NATIVE_PACKAGES.filter((pkg) => graph.packages.has(pkg)).map(
      (pkg) => `${pkg} ← ${graph.packages.get(pkg)!.join(", ")}`,
    );
    expect(offenders).toEqual([]);
  });

  it("load only the recognizer's light modules", () => {
    const recognizerFiles = [...graph.files]
      .filter((f) => path.dirname(f) === path.join(SRC, "recognizer"))
      .map((f) => path.basename(f))
      .filter((name) => !LIGHT_RECOGNIZER_FILES.has(name));
    expect(recognizerFiles).toEqual([]);
  });

  it("would catch a static import of the recognizer runtime", () => {
    // The walker itself works: the runtime's own graph does reach them.
    const runtimeGraph = staticGraph(path.join(SRC, "recognizer", "runtime.ts"));
    expect(runtimeGraph.packages.has("onnxruntime-node")).toBe(true);
    expect(runtimeGraph.packages.has("sharp")).toBe(true);
  });
});
