import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { formatPercent } from "../../utils/format";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`gg-card ${className}`}>{children}</div>;
}

export function SectionCard({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`gg-card gg-section ${className}`}>
      <header className="gg-section__head">
        <h2 className="gg-section__title">{title}</h2>
        {action}
      </header>
      <div className="gg-section__body">{children}</div>
    </section>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  icon?: IconName;
  /** Percentage change vs previous period. */
  change?: number;
  /** Optional caption under the value. */
  caption?: string;
  /** Highlights the card (e.g. urgent counts). */
  accent?: "default" | "gold" | "purple" | "warning";
  onClick?: () => void;
}

export function StatCard({
  label,
  value,
  icon,
  change,
  caption,
  accent = "default",
  onClick,
}: StatCardProps) {
  const Tag = onClick ? "button" : "div";
  const trendClass =
    change === undefined
      ? ""
      : change > 0
        ? "gg-stat__trend--up"
        : change < 0
          ? "gg-stat__trend--down"
          : "gg-stat__trend--flat";
  return (
    <Tag
      className={`gg-card gg-stat gg-stat--${accent} ${onClick ? "gg-stat--clickable" : ""}`}
      onClick={onClick}
      {...(onClick ? { type: "button" as const } : {})}
    >
      <div className="gg-stat__row">
        <span className="gg-stat__label">{label}</span>
        {icon && (
          <span className="gg-stat__icon">
            <Icon name={icon} size={18} />
          </span>
        )}
      </div>
      <div className="gg-stat__value">{value}</div>
      <div className="gg-stat__foot">
        {change !== undefined && (
          <span className={`gg-stat__trend ${trendClass}`}>
            <Icon
              name={change >= 0 ? "arrowUp" : "arrowDown"}
              size={13}
            />
            {formatPercent(Math.abs(change))}
          </span>
        )}
        {caption && <span className="gg-stat__caption">{caption}</span>}
      </div>
    </Tag>
  );
}
