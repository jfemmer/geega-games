'use client';

/**
 * SearchBox.tsx — Debounced card-name search. Writes `q` to the URL (debounced)
 * so the Server Component re-queries. Resets to page 1 on a new search.
 */
import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function SearchBox({ initialValue }: { initialValue: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialValue);
  const [isPending, startTransition] = useTransition();
  const firstRender = useRef(true);

  useEffect(() => {
    // Skip the effect on mount so we don't push a redundant navigation.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const handle = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set('q', value);
      else params.delete('q');
      params.delete('page'); // new search -> back to page 1
      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative">
      <input
        type="search"
        inputMode="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search cards by name…"
        aria-label="Search cards by name"
        className="w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 pr-10 text-sm shadow-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-200"
      />
      {isPending && (
        <span
          className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-brand-200 border-t-brand"
          aria-hidden
        />
      )}
    </div>
  );
}
