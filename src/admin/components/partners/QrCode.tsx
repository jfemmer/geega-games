import { useMemo } from "react";
import { qrPath } from "../../utils/qrCode";

// A QR code as inline SVG (one path from utils/qrCode.ts), for the Marketing
// page, referral partners' links and the printable flyer. Downloads (PNG and
// SVG) live in utils/qrCode.ts.

export function QrCode({ value, size = 180, label }: { value: string; size?: number; label: string }) {
  const { path, size: grid } = useMemo(() => qrPath(value), [value]);
  return (
    <svg
      className="gg-qr"
      width={size}
      height={size}
      viewBox={`0 0 ${grid} ${grid}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
    >
      <rect width={grid} height={grid} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
