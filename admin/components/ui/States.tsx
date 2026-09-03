import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function Skeleton({
  width,
  height = 14,
  radius = 6,
  className = "",
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  className?: string;
}) {
  return (
    <span
      className={`gg-skeleton ${className}`}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="gg-table-skeleton" aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div className="gg-table-skeleton__row" key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} height={16} width={c === 0 ? "60%" : "80%"} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="gg-loading" role="status">
      <span className="gg-spinner gg-spinner--lg" aria-hidden="true" />
      <span className="gg-visually-hidden">{label}</span>
    </div>
  );
}

export function EmptyState({
  icon = "box",
  title,
  message,
  action,
}: {
  icon?: IconName;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="gg-empty">
      <span className="gg-empty__icon">
        <Icon name={icon} size={30} />
      </span>
      <h3 className="gg-empty__title">{title}</h3>
      <p className="gg-empty__msg">{message}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="gg-error-state" role="alert">
      <span className="gg-error-state__icon">
        <Icon name="alert" size={28} />
      </span>
      <p className="gg-error-state__msg">{message}</p>
      {onRetry && (
        <button className="gg-btn gg-btn--secondary gg-btn--md" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
