import sharp from "sharp";

// Synthetic Magic-style cards for tests (no real card images are needed or
// shipped): a border, a frame, a title bar, seeded "art", a type line with a
// set symbol, a text box and the two-line collector info in the corner. Two
// printings can share art and differ only in the set symbol or the collector
// number — exactly the look-alike cases the recognizer has to get right.

export interface SyntheticPrinting {
  id: string;
  name: string;
  set: string;
  cn: string;
  /** Seed for the art — same seed, same art (a reprint). */
  art: number;
  /** Which set-symbol shape (0–3). */
  symbol: number;
  rarity?: "C" | "U" | "R" | "M";
  border?: "black" | "white";
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function color(r: () => number): string {
  const c = () => Math.floor(40 + r() * 200);
  return `rgb(${c()},${c()},${c()})`;
}

function artSvg(seed: number): string {
  const r = rng(seed);
  const parts = [`<rect x="5" y="10.5" width="53" height="38" fill="${color(r)}"/>`];
  for (let i = 0; i < 9; i++) {
    const x = 5 + r() * 50;
    const y = 10.5 + r() * 35;
    if (r() < 0.5) {
      parts.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(2 + r() * 9).toFixed(2)}" fill="${color(r)}"/>`);
    } else {
      parts.push(
        `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(3 + r() * 16).toFixed(2)}" height="${(2 + r() * 12).toFixed(2)}" fill="${color(r)}" transform="rotate(${(r() * 60 - 30).toFixed(1)} ${x.toFixed(2)} ${y.toFixed(2)})"/>`,
      );
    }
  }
  return `<svg x="5" y="10.5" width="53" height="38" viewBox="5 10.5 53 38" overflow="hidden">${parts.join("")}</svg>`;
}

function symbolSvg(kind: number, rarity: string): string {
  const fill = rarity === "M" ? "#d4561c" : rarity === "R" ? "#c9a227" : rarity === "U" ? "#9aa4ad" : "#111";
  const cx = 55.5;
  const cy = 51.75;
  switch (kind % 4) {
    case 0:
      return `<circle cx="${cx}" cy="${cy}" r="1.7" fill="${fill}" stroke="#000" stroke-width="0.25"/>`;
    case 1:
      return `<polygon points="${cx},${cy - 1.9} ${cx + 1.9},${cy + 1.5} ${cx - 1.9},${cy + 1.5}" fill="${fill}" stroke="#000" stroke-width="0.25"/>`;
    case 2:
      return `<polygon points="${cx},${cy - 2} ${cx + 1.8},${cy} ${cx},${cy + 2} ${cx - 1.8},${cy}" fill="${fill}" stroke="#000" stroke-width="0.25"/>`;
    default:
      return `<rect x="${cx - 1.6}" y="${cy - 1.6}" width="3.2" height="3.2" fill="${fill}" stroke="#000" stroke-width="0.25" transform="rotate(20 ${cx} ${cy})"/>`;
  }
}

export function cardSvg(p: SyntheticPrinting): string {
  const border = p.border === "white" ? "#f2f0ea" : "#151515";
  const ink = p.border === "white" ? "#222" : "#f0f0f0";
  const rarity = p.rarity ?? "R";
  const lines = Array.from({ length: 6 }, (_, i) => `<rect x="7" y="${57 + i * 3.4}" width="${30 + ((p.art * (i + 3)) % 18)}" height="1.1" fill="#555"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="630" height="880" viewBox="0 0 63 88">
  <rect x="0" y="0" width="63" height="88" rx="3" fill="${border}"/>
  <rect x="3" y="3" width="57" height="79.5" rx="1" fill="#b9a27a"/>
  <rect x="4.5" y="4.5" width="54" height="5" rx="1" fill="#e9e1cf"/>
  <text x="6" y="8.3" font-family="DejaVu Sans, Arial, sans-serif" font-size="3.2" fill="#111">${p.name}</text>
  ${artSvg(p.art)}
  <rect x="4.5" y="49.5" width="54" height="4.5" rx="1" fill="#e9e1cf"/>
  <text x="6" y="52.9" font-family="DejaVu Sans, Arial, sans-serif" font-size="2.6" fill="#111">Creature — Test</text>
  ${symbolSvg(p.symbol, rarity)}
  <rect x="5" y="54.5" width="53" height="24.5" fill="#efe8d8"/>
  ${lines}
  <text x="4" y="84.6" font-family="DejaVu Sans, Arial, sans-serif" font-size="1.55" fill="${ink}">${p.cn.padStart(4, "0")} ${rarity}</text>
  <text x="4" y="86.6" font-family="DejaVu Sans, Arial, sans-serif" font-size="1.55" fill="${ink}">${p.set} • EN</text>
</svg>`;
}

/** The card rendered edge to edge at the given size (Scryfall "normal" is 488 × 680). */
export async function renderCard(p: SyntheticPrinting, width = 488, height = 680): Promise<Buffer> {
  return sharp(Buffer.from(cardSvg(p))).resize(width, height, { fit: "fill" }).flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer();
}

export interface ScanOptions {
  angle?: number;
  upsideDown?: boolean;
  background?: { r: number; g: number; b: number };
  dpi?: number;
  blur?: number;
  offset?: { x: number; y: number };
  brightness?: number;
}

/** A fake flatbed/ADF scan: the card at 300 dpi on a scanner background, slightly crooked. */
export async function fakeScan(p: SyntheticPrinting, options: ScanOptions = {}): Promise<Buffer> {
  const bg = options.background ?? { r: 246, g: 246, b: 244 };
  const card = await sharp(Buffer.from(cardSvg(p)))
    .resize(744, 1039, { fit: "fill" })
    .flatten({ background: bg })
    .modulate({ brightness: options.brightness ?? 1 })
    .png()
    .toBuffer();
  const canvas = await sharp({ create: { width: 1100, height: 1400, channels: 3, background: bg } })
    .composite([{ input: card, left: 150 + (options.offset?.x ?? 0), top: 160 + (options.offset?.y ?? 0) }])
    .png()
    .toBuffer();
  const rotated = await sharp(canvas)
    .rotate((options.angle ?? 0) + (options.upsideDown ? 180 : 0), { background: bg })
    .png()
    .toBuffer();
  let out = sharp(rotated);
  if (options.blur) out = out.blur(options.blur);
  return out.jpeg({ quality: 90 }).withMetadata({ density: options.dpi ?? 300 }).toBuffer();
}

/** The Magic card back stand-in: no card-face structure at all. */
export async function fakeCardBack(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="630" height="880" viewBox="0 0 63 88">
  <rect width="63" height="88" rx="3" fill="#2a1a0e"/>
  <ellipse cx="31.5" cy="44" rx="24" ry="36" fill="#6b4423"/>
  <ellipse cx="31.5" cy="44" rx="15" ry="26" fill="#3d2614"/>
  <circle cx="31.5" cy="25" r="4" fill="#e8d36b"/><circle cx="22" cy="44" r="4" fill="#3467a8"/>
  <circle cx="41" cy="44" r="4" fill="#a83434"/><circle cx="27" cy="62" r="4" fill="#222"/><circle cx="36" cy="62" r="4" fill="#2f7a3a"/>
</svg>`;
  const card = await sharp(Buffer.from(svg)).resize(744, 1039, { fit: "fill" }).flatten({ background: "#f6f6f4" }).png().toBuffer();
  return sharp({ create: { width: 1100, height: 1400, channels: 3, background: { r: 246, g: 246, b: 244 } } })
    .composite([{ input: card, left: 170, top: 180 }])
    .jpeg({ quality: 90 })
    .withMetadata({ density: 300 })
    .toBuffer();
}
