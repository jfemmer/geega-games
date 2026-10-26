import type { ReactElement } from "react";
import type { ShippingIllustration as Kind } from "../../lib/tradeShipping";

// Small line drawings of packing cards the right way, for the first-time
// shipper guide: a sleeved card, the card in a toploader, toploaders taped
// together (tape on the plastic only), rigid protection inside a padded
// mailer, and a sealed box. Drawn to show real, safe packing, not decoration.
// Decorative to assistive tech: each one's caption says what it shows.

const INK = "#3a1260";
const LINE = "#8e6cc0";
const ART = "#d9c7f0";
const TEXT = "#b9a6d6";
const SLEEVE = "#f1e9fb";
const PLASTIC = "#faf7ff";

/** A card face: frame, art box and text lines, at (x, y) and w × h. */
function CardFace({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const pad = w * 0.11;
  const artH = h * 0.33;
  const textY = y + pad + artH + h * 0.1;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={2.5} fill="#fff" stroke={INK} strokeWidth={1.3} />
      <rect x={x + pad} y={y + pad} width={w - pad * 2} height={artH} rx={1.5} fill={ART} />
      <path
        d={`M${x + pad} ${textY}h${w - pad * 2}M${x + pad} ${textY + 5}h${(w - pad * 2) * 0.78}M${x + pad} ${textY + 10}h${(w - pad * 2) * 0.88}`}
        stroke={TEXT}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </g>
  );
}

/** A toploader's outline, with the thumb notch at the top. */
function toploaderPath(x: number, y: number, w: number, h: number): string {
  const r = 3;
  const notch = w * 0.15;
  const cx = x + w / 2;
  return [
    `M${x + r} ${y}`,
    `H${cx - notch}`,
    `A${notch} ${notch * 0.75} 0 0 0 ${cx + notch} ${y}`,
    `H${x + w - r}`,
    `Q${x + w} ${y} ${x + w} ${y + r}`,
    `V${y + h - r}`,
    `Q${x + w} ${y + h} ${x + w - r} ${y + h}`,
    `H${x + r}`,
    `Q${x} ${y + h} ${x} ${y + h - r}`,
    `V${y + r}`,
    `Q${x} ${y} ${x + r} ${y}`,
    "Z",
  ].join(" ");
}

function Sleeve() {
  return (
    <>
      <rect x={38} y={5} width={44} height={80} rx={4} fill={SLEEVE} stroke={LINE} strokeWidth={1.5} />
      <CardFace x={42} y={12} w={36} h={69} />
      <path d="M41 8.5h38" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" />
    </>
  );
}

function Toploader() {
  return (
    <>
      <path d={toploaderPath(32, 4, 56, 82)} fill={PLASTIC} stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
      <rect x={37} y={13} width={46} height={69} rx={3} fill={SLEEVE} stroke={LINE} strokeWidth={1.2} />
      <CardFace x={40} y={17} w={40} h={62} />
    </>
  );
}

function Stack() {
  return (
    <>
      <path d={toploaderPath(42, 12, 48, 72)} fill={PLASTIC} stroke={LINE} strokeWidth={1.6} strokeLinejoin="round" />
      <path d={toploaderPath(37, 8, 48, 72)} fill={PLASTIC} stroke={LINE} strokeWidth={1.6} strokeLinejoin="round" />
      <path d={toploaderPath(32, 4, 48, 72)} fill={PLASTIC} stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
      <CardFace x={38} y={13} w={36} h={58} />
      {/* Painter's tape around the stack, over the openings: on the toploaders, never the cards. */}
      <path d="M27 18h68v9H27z" fill="#e8c66a" opacity={0.9} />
      <path d="M27 18l-2 4.5 2 4.5M95 18l2 4.5-2 4.5" fill="none" stroke="#c9a544" strokeWidth={1} />
    </>
  );
}

function Mailer() {
  const bubbles: [number, number][] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 10; col += 1) {
      const x = 16 + col * 9 + (row % 2) * 4.5;
      const y = 25 + row * 10;
      if (x < 102) bubbles.push([x, y]);
    }
  }
  return (
    <>
      <rect x={8} y={16} width={104} height={62} rx={4} fill="#efe6fb" stroke="#663399" strokeWidth={2} />
      <g fill="#dccbf3">
        {bubbles.map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={3} />
        ))}
      </g>
      <path d="M100 16v62" stroke="#663399" strokeWidth={1.4} strokeDasharray="3 3" />
      {/* Inside the mailer: a stiff card behind the toploader. */}
      <rect x={34} y={21} width={42} height={52} rx={2} fill="#ead7b6" stroke="#a88552" strokeWidth={1.3} strokeDasharray="4 2" />
      <path d={toploaderPath(39, 25, 32, 44)} fill={PLASTIC} stroke={INK} strokeWidth={1.8} strokeDasharray="4 2" />
      <CardFace x={43} y={31} w={24} h={34} />
    </>
  );
}

function Box() {
  return (
    <>
      <path d="M20 30 60 16 100 30 60 44Z" fill="#ead2a6" stroke="#8a6a3b" strokeWidth={1.5} strokeLinejoin="round" />
      <path d="M20 30 60 44 60 82 20 68Z" fill="#dcbd8d" stroke="#8a6a3b" strokeWidth={1.5} strokeLinejoin="round" />
      <path d="M60 44 100 30 100 68 60 82Z" fill="#c9a676" stroke="#8a6a3b" strokeWidth={1.5} strokeLinejoin="round" />
      <path d="M40 23 80 37" stroke="#8a6a3b" strokeWidth={1.2} />
      {/* Tape along the seam and down the side. */}
      <path d="M37 22 81 37.5" stroke="#f4e6c4" strokeWidth={7} strokeLinecap="butt" opacity={0.95} />
      <path d="M80 37v16" stroke="#f4e6c4" strokeWidth={7} opacity={0.95} />
    </>
  );
}

const DRAWINGS: Record<Kind, () => ReactElement> = {
  sleeve: Sleeve,
  toploader: Toploader,
  stack: Stack,
  mailer: Mailer,
  box: Box,
};

export function ShippingIllustration({ kind }: { kind: Kind }) {
  const Drawing = DRAWINGS[kind];
  return (
    <svg className="gg-tc-pack__art" viewBox="0 0 120 90" width="120" height="90" aria-hidden="true" focusable="false">
      <Drawing />
    </svg>
  );
}
