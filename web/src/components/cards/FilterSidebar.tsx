'use client';

/**
 * FilterSidebar.tsx — Faceted filters (sets, colors, rarity, condition, finish,
 * price). Reads available options from server-provided facets so it only shows
 * filters that can actually return results. All state lives in the URL.
 */
import { useState } from 'react';
import { useFilterUrl } from '@/features/inventory/useFilterUrl';
import type { InventoryFacets } from '@/features/inventory/queries';
import { CARD_CONDITIONS, CARD_FINISHES, CONDITION_LABELS } from '@/lib/domain/enums';
import { formatCents } from '@/lib/domain/pricing';

const COLORS: { code: string; label: string }[] = [
  { code: 'W', label: 'White' },
  { code: 'U', label: 'Blue' },
  { code: 'B', label: 'Black' },
  { code: 'R', label: 'Red' },
  { code: 'G', label: 'Green' },
  { code: 'C', label: 'Colorless' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-neutral-200 py-4">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? 'border-brand bg-brand text-white'
          : 'border-neutral-300 bg-white text-neutral-700 hover:border-brand-300'
      }`}
    >
      {children}
    </button>
  );
}

export function FilterSidebar({ facets }: { facets: InventoryFacets }) {
  const { toggleMulti, clearAll, has, searchParams, setMany } = useFilterUrl();
  const [minPrice, setMinPrice] = useState(searchParams.get('min') ?? '');
  const [maxPrice, setMaxPrice] = useState(searchParams.get('max') ?? '');

  const hasAnyFilter = Array.from(searchParams.keys()).some(
    (k) => !['sort', 'page'].includes(k)
  );

  const applyPrice = () => {
    setMany({ min: minPrice || null, max: maxPrice || null });
  };

  return (
    <aside className="w-full lg:w-64 lg:shrink-0">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-neutral-900">Filters</h2>
        {hasAnyFilter && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs font-medium text-brand-600 hover:text-brand-800"
          >
            Clear all
          </button>
        )}
      </div>

      <Section title="Color">
        <div className="flex flex-wrap gap-1.5">
          {COLORS.map((c) => (
            <Chip key={c.code} active={has('colors', c.code)} onClick={() => toggleMulti('colors', c.code)}>
              {c.label}
            </Chip>
          ))}
        </div>
      </Section>

      {facets.rarities.length > 0 && (
        <Section title="Rarity">
          <div className="flex flex-wrap gap-1.5">
            {facets.rarities.map((r) => (
              <Chip key={r} active={has('rarities', r)} onClick={() => toggleMulti('rarities', r)}>
                {r[0].toUpperCase() + r.slice(1)}
              </Chip>
            ))}
          </div>
        </Section>
      )}

      <Section title="Condition">
        <div className="flex flex-wrap gap-1.5">
          {CARD_CONDITIONS.map((c) => (
            <Chip key={c} active={has('conditions', c)} onClick={() => toggleMulti('conditions', c)}>
              {CONDITION_LABELS[c]}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Finish">
        <div className="flex flex-wrap gap-1.5">
          {CARD_FINISHES.map((f) => (
            <Chip key={f} active={has('finishes', f)} onClick={() => toggleMulti('finishes', f)}>
              {f[0].toUpperCase() + f.slice(1)}
            </Chip>
          ))}
        </div>
      </Section>

      {facets.sets.length > 0 && (
        <Section title="Set">
          <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
            {facets.sets.map((s) => (
              <Chip key={s} active={has('sets', s)} onClick={() => toggleMulti('sets', s)}>
                {s.toUpperCase()}
              </Chip>
            ))}
          </div>
        </Section>
      )}

      <Section title="Price">
        {facets.priceMinCents != null && facets.priceMaxCents != null && (
          <p className="mb-2 text-xs text-neutral-500">
            Range: {formatCents(facets.priceMinCents)} – {formatCents(facets.priceMaxCents)}
          </p>
        )}
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            placeholder="Min $"
            aria-label="Minimum price in dollars"
            className="w-full rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand-200"
          />
          <span className="text-neutral-400">–</span>
          <input
            type="number"
            min={0}
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            placeholder="Max $"
            aria-label="Maximum price in dollars"
            className="w-full rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand-200"
          />
        </div>
        <button
          type="button"
          onClick={applyPrice}
          className="mt-2 w-full rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700"
        >
          Apply price
        </button>
      </Section>
    </aside>
  );
}
