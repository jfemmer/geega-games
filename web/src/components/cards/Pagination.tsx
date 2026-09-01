/**
 * Pagination.tsx — Page navigation as real <a> links (crawlable, works without
 * JS). Server Component; builds hrefs from current searchParams.
 */
import Link from 'next/link';

function buildHref(
  searchParams: Record<string, string | string[] | undefined>,
  page: number
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v == null) continue;
    params.set(k, Array.isArray(v) ? v[0] : v);
  }
  if (page > 1) params.set('page', String(page));
  else params.delete('page');
  const s = params.toString();
  return s ? `?${s}` : '?';
}

/** Compact page window: 1 … (p-1) p (p+1) … last */
function pageWindow(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | 'gap')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('gap');
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < total - 1) pages.push('gap');
  pages.push(total);
  return pages;
}

export function Pagination({
  page,
  totalPages,
  searchParams,
}: {
  page: number;
  totalPages: number;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  if (totalPages <= 1) return null;
  const items = pageWindow(page, totalPages);

  return (
    <nav
      className="mt-8 flex items-center justify-center gap-1"
      aria-label="Pagination"
    >
      {page > 1 && (
        <Link
          href={buildHref(searchParams, page - 1)}
          rel="prev"
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:border-brand-300"
        >
          Previous
        </Link>
      )}
      {items.map((it, i) =>
        it === 'gap' ? (
          <span key={`gap-${i}`} className="px-2 text-neutral-400">
            …
          </span>
        ) : (
          <Link
            key={it}
            href={buildHref(searchParams, it)}
            aria-current={it === page ? 'page' : undefined}
            className={`min-w-[2.5rem] rounded-lg border px-3 py-2 text-center text-sm font-medium transition ${
              it === page
                ? 'border-brand bg-brand text-white'
                : 'border-neutral-300 text-neutral-700 hover:border-brand-300'
            }`}
          >
            {it}
          </Link>
        )
      )}
      {page < totalPages && (
        <Link
          href={buildHref(searchParams, page + 1)}
          rel="next"
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:border-brand-300"
        >
          Next
        </Link>
      )}
    </nav>
  );
}
