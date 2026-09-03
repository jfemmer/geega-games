import type { ReactNode } from "react";
import type { BadgeTone } from "../../utils/labels";

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  /** Small dot before the label, useful for status. */
  dot?: boolean;
}

export function Badge({ tone = "neutral", children, dot = false }: BadgeProps) {
  return (
    <span className={`gg-badge gg-badge--${tone}`}>
      {dot && <span className="gg-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
