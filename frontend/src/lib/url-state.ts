import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Keeps list filters in the URL so views are shareable and dashboard links land on the right filter.
 * Empty values are removed from the query string.
 */
export function useUrlFilters<T extends Record<string, string>>(defaults: T) {
  const [params, setParams] = useSearchParams();
  const values = useMemo(() => {
    const out = { ...defaults } as T;
    for (const key of Object.keys(defaults) as Array<keyof T & string>) {
      const v = params.get(key);
      if (v !== null) out[key] = v as T[keyof T & string];
    }
    return out;
  }, [defaults, params]);

  const set = useCallback(
    (patch: Partial<T>, replace = false) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === null || v === '' || v === defaults[k as keyof T]) next.delete(k);
            else next.set(k, String(v));
          }
          return next;
        },
        { replace },
      );
    },
    [defaults, setParams],
  );

  return [values, set] as const;
}
