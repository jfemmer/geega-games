import type { ReactNode } from "react";
import { Icon } from "./Icon";

export interface TabItem {
  key: string;
  label: string;
  count?: number;
}

export function Tabs({
  items,
  active,
  onChange,
  ariaLabel,
}: {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="gg-tabs" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.key}
          role="tab"
          aria-selected={active === item.key}
          className={`gg-tab ${active === item.key ? "gg-tab--active" : ""}`}
          onClick={() => onChange(item.key)}
        >
          {item.label}
          {item.count !== undefined && (
            <span className="gg-tab__count">{item.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="gg-pagination">
      <span className="gg-pagination__info" aria-live="polite">
        {from}–{to} of {total}
      </span>
      <div className="gg-pagination__controls">
        <button
          className="gg-icon-btn"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <Icon name="chevronLeft" size={18} />
        </button>
        <span className="gg-pagination__page">
          Page {page} of {totalPages}
        </span>
        <button
          className="gg-icon-btn"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          <Icon name="chevronRight" size={18} />
        </button>
      </div>
    </div>
  );
}

export function Tooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="gg-tooltip" data-tip={label}>
      {children}
    </span>
  );
}
