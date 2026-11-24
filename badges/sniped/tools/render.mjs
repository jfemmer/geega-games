// Render the SNIPED badge to transparent PNG frames at exactly 60 FPS.
//
//   node badges/sniped/tools/render.mjs [--size 720] [--out <dir>] [--times 0.5,2.2,...]
//
// --times renders only those timestamps (for quick checks) into <out>/t_<sec>.png.
// Needs Playwright with Chromium (preinstalled in the cloud dev box; locally:
// `npx playwright install chromium`).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const size = parseInt(opt("size", "720"), 10);
const out = path.resolve(opt("out", path.join(root, "build", `frames-${size}`)));
const times = opt("times", null);

const types = { ".html": "text/html", ".png": "image/png", ".woff2": "font/woff2", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: size, height: size } });
page.on("pageerror", (e) => console.error("page error:", e.message));
page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
await page.goto(`http://127.0.0.1:${port}/sniped.html?size=${size}`);
await page.waitForFunction(() => window.SNIPED);
await page.evaluate(() => window.SNIPED.ready);
const meta = await page.evaluate(() => ({ d: window.SNIPED.DURATION, fps: window.SNIPED.FPS, n: window.SNIPED.frameCount }));
fs.mkdirSync(out, { recursive: true });

const grab = (t) =>
  page.evaluate((tt) => {
    window.SNIPED.render(tt);
    return document.getElementById("c").toDataURL("image/png");
  }, t);
const save = (file, dataUrl) => fs.writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));

const started = Date.now();
if (times) {
  for (const s of times.split(",").map(Number)) save(path.join(out, `t_${s.toFixed(3)}.png`), await grab(s));
} else {
  for (let i = 0; i < meta.n; i++) {
    save(path.join(out, `f_${String(i).padStart(4, "0")}.png`), await grab(i / meta.fps));
    if (i % 60 === 0) process.stdout.write(`\r${i}/${meta.n}`);
  }
  process.stdout.write(`\r${meta.n}/${meta.n} frames\n`);
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s -> ${out}  (${meta.n} frames @ ${meta.fps}fps, ${meta.d}s)`);
await browser.close();
server.close();
