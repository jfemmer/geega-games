'use client';

/**
 * useFilterUrl.ts — Small hook shared by filter controls to read/toggle/set
 * filter params in the URL. Centralizes the "reset to page 1 on any filter
 * change" rule so every control behaves consistently.
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';

export function useFilterUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const commit = useCallback(
    (params: URLSearchParams) => {
      params.delete('page'); // any filter change resets pagination
      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      });
    },
    [pathname, router]
  );

  /** Toggle one value inside a comma-separated multi-select param. */
  const toggleMulti = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      const current = (params.get(key) ?? '').split(',').filter(Boolean);
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      if (next.length) params.set(key, next.join(','));
      else params.delete(key);
      commit(params);
    },
    [searchParams, commit]
  );

  /** Set or clear a single-value param. */
  const setSingle = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      commit(params);
    },
    [searchParams, commit]
  );

  /** Set or clear several params at once (e.g. min+max price together). */
  const setMany = useCallback(
    (entries: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(entries)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      commit(params);
    },
    [searchParams, commit]
  );

  const clearAll = useCallback(() => {
    startTransition(() => {
      router.replace(pathname, { scroll: false });
    });
  }, [pathname, router]);

  const has = useCallback(
    (key: string, value: string) =>
      (searchParams.get(key) ?? '').split(',').includes(value),
    [searchParams]
  );

  return { toggleMulti, setSingle, setMany, clearAll, has, isPending, searchParams };
}
