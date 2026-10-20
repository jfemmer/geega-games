import {
  PDFDocument,
  rgb,
  appendBezierCurve,
  clip,
  closePath,
  concatTransformationMatrix,
  endPath,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSpacing,
  setFillingColor,
  type PDFFont,
  type PDFImage,
  type PDFOperator,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { qrPath } from "./qrCode";
import {
  YARD_SALE_SIGN_LEDE,
  YARD_SALE_SIGN_TAGLINE,
  yardSaleSignFootnote,
  yardSaleSignHand,
} from "./yardSaleSign";
import type { FlyerJob } from "../components/partners/FlyerPrintView";
import interRegularUrl from "../assets/fonts/Inter-Regular.ttf?url";
import interSemiBoldUrl from "../assets/fonts/Inter-SemiBold.ttf?url";
import signLogoUrl from "../assets/logo-black-background-print.jpg";

// The yard sale sign as a PDF file (the sign preview → Save PDF), to print
// somewhere other than this computer: a print shop, another printer, a
// phone's print app. Drawn with pdf-lib to the same design and measurements
// as YardSaleSign.tsx and its .gg-ysign rules in admin.css: US Letter, the
// 7.7 × 10.1in sign at 0.4in margins, exactly as Print lays it out. Text is
// real text in Inter (embedded) and the QR code is vector, so both stay
// crisp at any print size. A change to the sign's layout or sizes belongs in
// both places; its words are shared (utils/yardSaleSign.ts).
//
// Measurements below are in inches (CSS's) unless they say points, and y
// runs down from the top of the sign like CSS; draw() turns them into PDF
// points from the bottom of the page.

const PT = 72;
const PAGE = { width: 8.5, height: 11, margin: 0.4 };
const SHEET = { width: 7.7, height: 10.1 };
const PAD_X = 0.45;
const CONTENT_W = SHEET.width - PAD_X * 2;

const INK = rgb(0x17 / 255, 0x12 / 255, 0x1f / 255);
const SOFT = rgb(0x4f / 255, 0x46 / 255, 0x5c / 255);
const VIOLET = rgb(0x6a / 255, 0x0f / 255, 0xd6 / 255);
const LINE = rgb(0xe4 / 255, 0xda / 255, 0xf3 / 255);
const WHITE = rgb(1, 1, 1);
const BLACK = rgb(0, 0, 0);

/** .gg-ysign__band */
const BAND = { padY: 0.14, logoHeight: 1 };
/** .gg-ysign__body */
const BODY = { padTop: 0.3, padBottom: 0.22, gap: 0.18, plainGap: 0.75 };
/** .gg-ysign__fan: the card, its turn, and its box (for n cards). */
const FAN = {
  cardWidth: 2.2,
  aspect: 680 / 488,
  turnDegrees: 6.5,
  /** transform-origin: 50% 300% — three card heights below a card's top. */
  pivotHeights: 3,
  top: 0.06,
  boxExtra: (n: number) => 0.07 + (n - 1) * 0.105,
  /** A Magic card's rounded corners: 1/8in on a 2.5in-wide card. */
  cornerRatio: 0.05,
  /** box-shadow: -0.02in 0.03in 0.09in rgba(23, 18, 31, 0.38) */
  shadow: { x: -0.02, y: 0.03, blur: 0.09, color: "rgba(23, 18, 31, 0.38)" },
};
/** .gg-ysign__scan and friends; `plain` is .gg-ysign--plain (no cards). */
const SCAN = { gap: 0.32, qrPad: 0.09, qrBorder: 0.04, qrRadius: 0.14, howGap: 0.12, stepGap: 0.07, dot: 0.21, dotColumn: 0.27 };
const SIZES = {
  normal: { headline: 31, qr: 2.15, cta: 19, step: 12.5, url: 13 },
  plain: { headline: 36, qr: 2.9, cta: 22, step: 13.5, url: 14 },
};
/** .gg-ysign__foot */
const FOOT = { padTop: 0.12, padBottom: 0.14, border: 1 / 96, size: 8.5, lineHeight: 1.35 };

// ---------------------------------------------------------------------------
// Words into lines
// ---------------------------------------------------------------------------

/** How a block of text breaks into lines, like CSS text-wrap. */
export type WrapMode = "wrap" | "balance" | "pretty";

/**
 * Breaks text into lines no wider than `maxWidth` (`measure` gives a
 * string's width in the same units). "balance" evens out the lines without
 * adding one (text-wrap: balance); "pretty" keeps a single word from ending
 * up alone on the last line when it can (text-wrap: pretty). A word wider
 * than the line gets a line to itself.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number, mode: WrapMode = "wrap"): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wrap = (width: number) => {
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > width) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  };
  const lines = wrap(maxWidth);
  if (lines.length < 2 || mode === "wrap") return lines;
  if (mode === "balance") {
    // The narrowest width that still takes no more lines.
    let narrow = 0;
    let wide = maxWidth;
    for (let i = 0; i < 24; i++) {
      const mid = (narrow + wide) / 2;
      if (wrap(mid).length <= lines.length) wide = mid;
      else narrow = mid;
    }
    return wrap(wide);
  }
  // pretty: bring a word down to join one left alone on the last line.
  if (lines[lines.length - 1].includes(" ")) return lines;
  const tighter = wrap(measure(lines[lines.length - 2]) - 0.001);
  return tighter.length === lines.length && tighter[tighter.length - 1].includes(" ") ? tighter : lines;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

interface FontFace {
  font: PDFFont;
  /** hhea ascent and descent, in ems (what browsers use to place a line's text). */
  ascent: number;
  descent: number;
  /** Characters the font can draw (others are left out). */
  has: (codePoint: number) => boolean;
}

interface TextStyle {
  face: FontFace;
  /** Points. */
  size: number;
  /** A multiple of the size, or null for the font's normal line height. */
  lineHeight: number | null;
  /** letter-spacing, in ems. */
  tracking?: number;
  color: RGB;
}

interface TextBlock {
  style: TextStyle;
  lines: string[];
  /** Inches. */
  height: number;
}

/** Everything the PDF needs that comes from the network or the browser. */
export interface YardSaleSignPdfAssets {
  regular: Uint8Array;
  semiBold: Uint8Array;
  /** The logo on black: a JPEG or PNG. */
  logo: SignImage;
  /** One per card in the showcase (most valuable first), or null for one whose picture couldn't be loaded. */
  cards: (SignImage | null)[];
  /** A PNG of a card's soft shadow (cardShadowPng), or null to leave shadows off. */
  shadow: Uint8Array | null;
}

export interface SignImage {
  bytes: Uint8Array;
  kind: "jpg" | "png";
}

function lineBox(style: TextStyle): number {
  const size = style.size / PT;
  return style.lineHeight === null ? size * (style.face.ascent + style.face.descent) : size * style.lineHeight;
}

function clean(text: string, face: FontFace): string {
  return [...text].filter((c) => c === " " || face.has(c.codePointAt(0) ?? 0)).join("");
}

function measurer(style: TextStyle) {
  return (s: string) =>
    (style.face.font.widthOfTextAtSize(s, style.size) + (style.tracking ?? 0) * style.size * [...s].length) / PT;
}

function block(text: string, style: TextStyle, maxWidth: number, mode: WrapMode = "wrap"): TextBlock {
  const lines = wrapText(clean(text, style.face), maxWidth, measurer(style), mode);
  return { style, lines, height: lines.length * lineBox(style) };
}

/** The sign's page, with CSS-style coordinates: inches from the sign's top left. */
class SignPage {
  readonly page: PDFPage;

  constructor(page: PDFPage) {
    this.page = page;
  }

  x(inches: number) {
    return (PAGE.margin + inches) * PT;
  }

  y(inches: number) {
    return (PAGE.height - PAGE.margin - inches) * PT;
  }

  rect(left: number, top: number, width: number, height: number, color: RGB) {
    this.page.drawRectangle({ x: this.x(left), y: this.y(top + height), width: width * PT, height: height * PT, color });
  }

  roundedRect(left: number, top: number, width: number, height: number, radius: number, color: RGB) {
    this.page.pushOperators(
      pushGraphicsState(),
      setFillingColor(color),
      ...roundedRectPath(this.x(left), this.y(top + height), width * PT, height * PT, radius * PT),
      fill(),
      popGraphicsState(),
    );
  }

  /** Draws each line; returns where the block ends. `align` places lines within [left, left + width]. */
  text(b: TextBlock, left: number, top: number, width: number, align: "left" | "right" | "center" = "left"): number {
    const { style } = b;
    const box = lineBox(style);
    const size = style.size / PT;
    const baseline = (box - size * (style.face.ascent + style.face.descent)) / 2 + size * style.face.ascent;
    const measure = measurer(style);
    b.lines.forEach((line, i) => {
      const w = measure(line);
      const x = align === "right" ? left + width - w : align === "center" ? left + (width - w) / 2 : left;
      if (style.tracking) this.page.pushOperators(pushGraphicsState(), setCharacterSpacing(style.tracking * style.size));
      this.page.drawText(line, {
        x: this.x(x),
        y: this.y(top + i * box + baseline),
        size: style.size,
        font: style.face.font,
        color: style.color,
      });
      if (style.tracking) this.page.pushOperators(popGraphicsState());
    });
    return top + b.height;
  }
}

function roundedRectPath(x: number, y: number, w: number, h: number, r: number): PDFOperator[] {
  const k = 0.5522847498 * r;
  return [
    moveTo(x + r, y),
    lineTo(x + w - r, y),
    appendBezierCurve(x + w - r + k, y, x + w, y + r - k, x + w, y + r),
    lineTo(x + w, y + h - r),
    appendBezierCurve(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h),
    lineTo(x + r, y + h),
    appendBezierCurve(x + r - k, y + h, x, y + h - r + k, x, y + h - r),
    lineTo(x, y + r),
    appendBezierCurve(x, y + r - k, x + r - k, y, x + r, y),
    closePath(),
  ];
}

async function face(pdf: PDFDocument, bytes: Uint8Array): Promise<FontFace> {
  const parsed = fontkit.create(bytes);
  return {
    font: await pdf.embedFont(bytes, { subset: true }),
    ascent: parsed.ascent / parsed.unitsPerEm,
    descent: Math.abs(parsed.descent) / parsed.unitsPerEm,
    has: (cp) => parsed.hasGlyphForCodePoint(cp),
  };
}

function embedImage(pdf: PDFDocument, image: SignImage): Promise<PDFImage> {
  return image.kind === "jpg" ? pdf.embedJpg(image.bytes) : pdf.embedPng(image.bytes);
}

/** The shadow image's margin around the card: room for the blur to fade out. */
export const SHADOW_MARGIN = 0.16;

/**
 * Builds the sign's PDF: one US Letter page, the same as Print. Cards whose
 * picture couldn't be loaded are left out of the hand; with none left, it's
 * the sign without cards (bigger QR code), like the printed one.
 */
export async function buildYardSaleSignPdf(job: FlyerJob, assets: YardSaleSignPdfAssets): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle("Yard sale sign");
  pdf.setAuthor("Geega Games");
  pdf.setCreator("Geega Games");
  const page = new SignPage(pdf.addPage([PAGE.width * PT, PAGE.height * PT]));
  const [regular, semiBold] = await Promise.all([face(pdf, assets.regular), face(pdf, assets.semiBold)]);

  const showcase = job.yardSale?.showcase ?? [];
  const loaded = showcase
    .map((card, i) => ({ card, image: assets.cards[i] ?? null }))
    .filter((c): c is { card: (typeof showcase)[number]; image: SignImage } => c.image !== null);
  const hand = yardSaleSignHand(loaded);
  const plain = hand.length === 0;
  const sizes = plain ? SIZES.plain : SIZES.normal;
  const { copy } = job;

  // White sheet (a print shop's paper may not be).
  page.rect(0, 0, SHEET.width, SHEET.height, WHITE);

  // Band: the logo on black, and what we sell.
  const logo = await embedImage(pdf, assets.logo);
  const bandHeight = BAND.padY * 2 + BAND.logoHeight;
  page.rect(0, 0, SHEET.width, bandHeight, BLACK);
  const logoWidth = (BAND.logoHeight * logo.width) / logo.height;
  page.page.drawImage(logo, {
    x: page.x(PAD_X),
    y: page.y(BAND.padY + BAND.logoHeight),
    width: logoWidth * PT,
    height: BAND.logoHeight * PT,
  });
  const tagline = block(YARD_SALE_SIGN_TAGLINE, { face: semiBold, size: 15, lineHeight: 1.2, color: WHITE }, CONTENT_W);
  page.text(tagline, PAD_X, bandHeight / 2 - tagline.height / 2, CONTENT_W, "right");

  // Footer: how yard sale prices work, under a hairline.
  const footStyle: TextStyle = { face: regular, size: FOOT.size, lineHeight: FOOT.lineHeight, color: SOFT };
  const foot = block(yardSaleSignFootnote(job.yardSale?.discountPercent ?? 0), footStyle, CONTENT_W);
  const footTop = SHEET.height - (FOOT.border + FOOT.padTop + foot.height + FOOT.padBottom);
  page.rect(0, footTop, SHEET.width, FOOT.border, LINE);
  page.text(foot, PAD_X, footTop + FOOT.border + FOOT.padTop, CONTENT_W);

  // Body: the intro, the hand of cards and the QR code, spread from top to
  // bottom (or centered, without cards).
  const intro = [
    block(copy.headline, { face: semiBold, size: sizes.headline, lineHeight: 1.04, tracking: -0.025, color: INK }, CONTENT_W, "balance"),
    block(YARD_SALE_SIGN_LEDE, { face: regular, size: 14, lineHeight: 1.35, color: SOFT }, 6.2, "pretty"),
    ...(job.extraLine ? [block(job.extraLine, { face: semiBold, size: 14, lineHeight: null, color: INK }, CONTENT_W, "balance")] : []),
  ];
  const introHeight = intro.reduce((sum, b) => sum + b.height, 0) + 0.08 * (intro.length - 1);

  const cardHeight = FAN.cardWidth * FAN.aspect;
  const handHeight = plain ? 0 : cardHeight + FAN.boxExtra(hand.length);

  const qrOuter = sizes.qr + (SCAN.qrPad + SCAN.qrBorder) * 2;
  const howLeft = PAD_X + qrOuter + SCAN.gap;
  const howWidth = CONTENT_W - qrOuter - SCAN.gap;
  const cta = block(copy.cta, { face: semiBold, size: sizes.cta, lineHeight: 1.15, tracking: -0.015, color: INK }, howWidth, "balance");
  const stepStyle: TextStyle = { face: regular, size: sizes.step, lineHeight: 1.25, color: INK };
  const steps = copy.points.map((point) => block(point, stepStyle, howWidth - SCAN.dotColumn, "pretty"));
  const stepHeights = steps.map((s) => Math.max(s.height, SCAN.dot));
  const stepsHeight = stepHeights.reduce((a, b) => a + b, 0) + SCAN.stepGap * (steps.length - 1);
  const url = block(job.address, { face: semiBold, size: sizes.url, lineHeight: null, color: INK }, howWidth);
  const howHeight = cta.height + SCAN.howGap + stepsHeight + SCAN.howGap + url.height;
  const scanHeight = Math.max(qrOuter, howHeight);

  const bodyTop = bandHeight + BODY.padTop;
  const bodyHeight = footTop - BODY.padBottom - bodyTop;
  const heights = plain ? [introHeight, scanHeight] : [introHeight, handHeight, scanHeight];
  const used = heights.reduce((a, b) => a + b, 0);
  const spacing = plain ? BODY.plainGap : Math.max(BODY.gap, (bodyHeight - used) / (heights.length - 1));
  let top = plain ? bodyTop + (bodyHeight - used - spacing) / 2 : bodyTop;

  // Intro.
  let y = top;
  intro.forEach((b, i) => {
    y = page.text(b, PAD_X, y, CONTENT_W) + (i < intro.length - 1 ? 0.08 : 0);
  });
  top += introHeight + spacing;

  // The hand: each card turned about a point three card heights below its
  // top, each over the one before.
  if (!plain) {
    const shadow = assets.shadow ? await pdf.embedPng(assets.shadow) : null;
    const cardLeft = PAD_X + CONTENT_W / 2 - FAN.cardWidth / 2;
    const cardTop = top + FAN.top;
    const pivotX = page.x(cardLeft + FAN.cardWidth / 2);
    const pivotY = page.y(cardTop + cardHeight * FAN.pivotHeights);
    const radius = FAN.cardWidth * FAN.cornerRatio * PT;
    const [x, yBottom, w, h] = [page.x(cardLeft), page.y(cardTop + cardHeight), FAN.cardWidth * PT, cardHeight * PT];
    for (const [i, { image }] of hand.entries()) {
      // CSS turns clockwise for positive angles with y running down; PDF's y runs up.
      const turn = (-(i - (hand.length - 1) / 2) * FAN.turnDegrees * Math.PI) / 180;
      const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
      page.page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(cos, sin, -sin, cos, pivotX - pivotX * cos + pivotY * sin, pivotY - pivotX * sin - pivotY * cos),
      );
      if (shadow) {
        page.page.drawImage(shadow, {
          x: x + (FAN.shadow.x - SHADOW_MARGIN) * PT,
          y: yBottom - (FAN.shadow.y + SHADOW_MARGIN) * PT,
          width: w + SHADOW_MARGIN * 2 * PT,
          height: h + SHADOW_MARGIN * 2 * PT,
        });
      }
      const picture = await embedImage(pdf, image);
      // object-fit: cover, clipped to the card's rounded corners.
      const scale = Math.max(w / picture.width, h / picture.height);
      const [pw, ph] = [picture.width * scale, picture.height * scale];
      page.page.pushOperators(pushGraphicsState(), ...roundedRectPath(x, yBottom, w, h, radius), clip(), endPath());
      page.page.drawImage(picture, { x: x + (w - pw) / 2, y: yBottom + (h - ph) / 2, width: pw, height: ph });
      page.page.pushOperators(popGraphicsState(), popGraphicsState());
    }
    top += handHeight + spacing;
  }

  // The QR code in its violet frame, and how to shop beside it.
  const qrTop = top + (scanHeight - qrOuter) / 2;
  page.roundedRect(PAD_X, qrTop, qrOuter, qrOuter, SCAN.qrRadius, VIOLET);
  page.roundedRect(PAD_X + SCAN.qrBorder, qrTop + SCAN.qrBorder, qrOuter - SCAN.qrBorder * 2, qrOuter - SCAN.qrBorder * 2, SCAN.qrRadius - SCAN.qrBorder, WHITE);
  const qr = qrPath(job.url);
  const inset = SCAN.qrBorder + SCAN.qrPad;
  page.page.drawSvgPath(qr.path, {
    x: page.x(PAD_X + inset),
    y: page.y(qrTop + inset),
    scale: (sizes.qr * PT) / qr.size,
    color: BLACK,
  });

  y = top + (scanHeight - howHeight) / 2;
  y = page.text(cta, howLeft, y, howWidth) + SCAN.howGap;
  steps.forEach((step, i) => {
    const rowHeight = stepHeights[i];
    // The number in a violet dot, centered on the step's lines.
    const dotTop = y + (rowHeight - SCAN.dot) / 2;
    page.page.drawCircle({
      x: page.x(howLeft + SCAN.dot / 2),
      y: page.y(dotTop + SCAN.dot / 2),
      size: (SCAN.dot / 2) * PT,
      color: VIOLET,
    });
    const number = block(String(i + 1), { face: semiBold, size: 9, lineHeight: null, color: WHITE }, SCAN.dot);
    page.text(number, howLeft, dotTop + (SCAN.dot - number.height) / 2, SCAN.dot, "center");
    page.text(step, howLeft + SCAN.dotColumn, y + (rowHeight - step.height) / 2, howWidth - SCAN.dotColumn);
    y += rowHeight + SCAN.stepGap;
  });
  y += SCAN.howGap - SCAN.stepGap;
  page.text(url, howLeft, y, howWidth);

  return pdf.save();
}

// ---------------------------------------------------------------------------
// Loading the pieces (browser)
// ---------------------------------------------------------------------------

async function fetchBytes(url: string): Promise<{ bytes: Uint8Array; type: string }> {
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status}).`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "" };
}

/** JPEG or PNG, which a PDF can hold as they are; anything else is null. */
export function imageKind(bytes: Uint8Array): SignImage["kind"] | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  return null;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't draw the picture."))), type, quality),
  );
}

/** Pictures in other formats (WebP, AVIF, SVG…) redrawn as a JPEG. */
async function asJpeg(bytes: Uint8Array, type: string): Promise<SignImage> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: type || "image/*" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Couldn't read the picture."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || 672;
    canvas.height = img.naturalHeight || 936;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't draw the picture.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { bytes: new Uint8Array(await (await canvasBlob(canvas, "image/jpeg", 0.92)).arrayBuffer()), kind: "jpg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadImage(url: string): Promise<SignImage> {
  const { bytes, type } = await fetchBytes(url);
  const kind = imageKind(bytes);
  return kind ? { bytes, kind } : asJpeg(bytes, type);
}

/**
 * The card's soft drop shadow (the CSS box-shadow), drawn once on a canvas:
 * a PNG the size of a card plus SHADOW_MARGIN all round, at 150 dpi. Null if
 * the browser can't draw it; the cards then go without.
 */
export async function cardShadowPng(): Promise<Uint8Array | null> {
  try {
    const dpi = 150;
    const w = FAN.cardWidth * dpi;
    const h = FAN.cardWidth * FAN.aspect * dpi;
    const m = SHADOW_MARGIN * dpi;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w + m * 2);
    canvas.height = Math.round(h + m * 2);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // Draw the card far off the canvas and only its shadow on it.
    const away = canvas.width * 4;
    ctx.shadowColor = FAN.shadow.color;
    ctx.shadowBlur = FAN.shadow.blur * dpi;
    ctx.shadowOffsetX = away;
    ctx.fillStyle = "#000";
    const [x, r] = [m - away, FAN.cardWidth * FAN.cornerRatio * dpi];
    ctx.beginPath();
    ctx.moveTo(x + r, m);
    ctx.arcTo(x + w, m, x + w, m + h, r);
    ctx.arcTo(x + w, m + h, x, m + h, r);
    ctx.arcTo(x, m + h, x, m, r);
    ctx.arcTo(x, m, x + w, m, r);
    ctx.closePath();
    ctx.fill();
    return new Uint8Array(await (await canvasBlob(canvas, "image/png")).arrayBuffer());
  } catch {
    return null;
  }
}

/** Fetches the fonts, the logo and the card pictures (a card that won't load is left out). */
export async function loadYardSaleSignPdfAssets(job: FlyerJob): Promise<YardSaleSignPdfAssets> {
  const showcase = job.yardSale?.showcase ?? [];
  const [regular, semiBold, logo, shadow, ...cards] = await Promise.all([
    fetchBytes(interRegularUrl).then((f) => f.bytes),
    fetchBytes(interSemiBoldUrl).then((f) => f.bytes),
    loadImage(signLogoUrl),
    showcase.length ? cardShadowPng() : Promise.resolve(null),
    ...showcase.map((card) => loadImage(card.imageUrl).catch(() => null)),
  ]);
  return { regular, semiBold, logo, shadow, cards };
}

/** The sign as a PDF file, ready to save or share. */
export async function makeYardSaleSignPdf(job: FlyerJob): Promise<Blob> {
  const bytes = await buildYardSaleSignPdf(job, await loadYardSaleSignPdfAssets(job));
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
