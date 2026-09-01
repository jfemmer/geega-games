'use client';

/**
 * SortSelect.tsx — Sort dropdown. Writes `sort` to the URL (preserves other
 * filters, resets page).
 */
import { useFilterUrl } from '@/features/inventory/useFilterUrl';
import { SORT_OPTIONS, SORT_LABELS, type SortOption } from '@/features/inventory/search-params';

export function SortSelect({ value }: { value: SortOption }) {
  const { setSingle } = useFilterUrl();
  return (
    <label className="flex items-center gap-2 text-sm text-neutral-600">
      <span className="hidden sm:inline">Sort</span>
      <select
        value={value}
        onChange={(e) =>
          setSingle('sort', e.target.value === 'name_asc' ? null : e.target.value)
        }
        className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand-200"
        aria-label="Sort cards"
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {SORT_LABELS[opt]}
          </option>
        ))}
      </select>
    </label>
  );
}
