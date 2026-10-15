import { useCallback, useEffect, useState } from 'react';

export type Loaded<T> =
  | { state: 'loading' }
  | { state: 'ok'; data: T }
  | { state: 'error'; status: number; message: string };

// Load once on mount (and whenever `deps` change); reload() fetches again.
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): Loaded<T> & { reload: () => void } {
  const [v, setV] = useState<Loaded<T>>({ state: 'loading' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    fn()
      .then((data) => alive && setV({ state: 'ok', data }))
      .catch((e: { status?: number; message?: string }) =>
        alive && setV({ state: 'error', status: e?.status ?? 0, message: e?.message ?? 'error' }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...v, reload };
}
