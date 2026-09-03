// Pure formatting + small helpers shared across the admin UI.

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatPercent(value: number, digits = 0): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

/** Percentage change from `prev` to `current`, guarding divide-by-zero. */
export function percentChange(current: number, prev: number): number {
  if (prev === 0) return current === 0 ? 0 : 100;
  return ((current - prev) / prev) * 100;
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const DATETIME_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return DATE_FMT.format(new Date(iso));
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return DATETIME_FMT.format(new Date(iso));
}

/** Human "time ago" that also handles future dates gracefully. */
export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60000);
  const hrs = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  let label: string;
  if (mins < 1) label = "just now";
  else if (mins < 60) label = `${mins}m`;
  else if (hrs < 24) label = `${hrs}h`;
  else label = `${days}d`;
  if (label === "just now") return label;
  return diffMs >= 0 ? `${label} ago` : `in ${label}`;
}

/** Duration a value has been waiting, from an ISO timestamp until now. */
export function waitingSince(iso: string): string {
  const hrs = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (hrs < 1) return `${Math.max(1, Math.round(hrs * 60))}m`;
  if (hrs < 48) return `${Math.round(hrs)}h`;
  return `${Math.round(hrs / 24)}d`;
}

/** Deterministic-enough id for mock rows created at runtime. */
let counter = 0;
export function mockId(prefix = "id"): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function fullName(first: string, last: string): string {
  return `${first} ${last}`.trim();
}

export function initials(first: string, last: string): string {
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}

/** Simulate async latency so loading states are demonstrable in the mock. */
export function delay<T>(value: T, ms = 350): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
