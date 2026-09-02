import { siteUrl } from "./assets.js";

// Minimal, self-contained branded HTML page for confirmation/unsubscribe
// landings. Inline styles only (no external CSS) so it renders standalone.
export function resultPage(opts: {
  title: string;
  heading: string;
  body: string;
  tone: "success" | "error" | "neutral";
}): string {
  const accent =
    opts.tone === "success"
      ? "#2e7d5b"
      : opts.tone === "error"
        ? "#b3261e"
        : "#663399";
  const home = siteUrl();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(opts.title)} — Geega Games</title>
<style>
  :root { --brand:#663399; --deep:#4c2a85; --gold:#e0b341; --ink:#1a1526; --parchment:#f7f4ef; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    font-family:Inter,system-ui,-apple-system,sans-serif; color:var(--ink);
    background:radial-gradient(1200px 600px at 50% -10%, rgba(102,51,153,.10), transparent 60%), var(--parchment);
    padding:24px; }
  .card { background:#fff; border:1px solid #e7e0f2; border-radius:18px; max-width:460px; width:100%;
    padding:40px 32px; text-align:center; box-shadow:0 10px 30px rgba(76,42,133,.10); }
  .logo { height:64px; margin:0 auto 20px; display:block; }
  .dot { width:44px; height:44px; border-radius:50%; margin:0 auto 16px;
    display:flex; align-items:center; justify-content:center; color:#fff; font-size:22px; font-weight:700;
    background:${accent}; }
  h1 { font-size:22px; margin:0 0 10px; color:var(--deep); }
  p { font-size:15px; line-height:24px; color:#4a4356; margin:0 0 24px; }
  a.btn { display:inline-block; background:var(--brand); color:#fff; text-decoration:none;
    font-weight:600; padding:12px 22px; border-radius:10px; }
  a.btn:focus { outline:3px solid var(--gold); outline-offset:2px; }
</style>
</head>
<body>
  <main class="card">
    <img class="logo" src="${home}/logo.png" alt="Geega Games" />
    <div class="dot" aria-hidden="true">${opts.tone === "success" ? "✓" : opts.tone === "error" ? "!" : "•"}</div>
    <h1>${escapeHtml(opts.heading)}</h1>
    <p>${opts.body}</p>
    <a class="btn" href="${home}">Back to Geega Games</a>
  </main>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
