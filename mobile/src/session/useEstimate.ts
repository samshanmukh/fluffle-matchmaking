import { useEffect, useState } from 'react';

import { HTTP_URL } from '../config';
import type { Estimate } from './protocol';

const REFRESH_MS = 4000;

/** The start screen's estimate: asked again whenever the languages change, then every few seconds. */
export function useEstimate(languages: string[], active: boolean) {
  const key = [...languages].sort().join(',');
  const [result, setResult] = useState<{ key: string; estimate: Estimate | null; failed: boolean }>({
    key: '',
    estimate: null,
    failed: false,
  });

  useEffect(() => {
    if (!active || key === '') return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${HTTP_URL}/estimate?languages=${encodeURIComponent(key)}`);
        if (!res.ok) throw new Error(String(res.status));
        const estimate = (await res.json()) as Estimate;
        if (!cancelled) setResult({ key, estimate, failed: false });
      } catch {
        if (!cancelled) setResult({ key, estimate: null, failed: true });
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key, active]);

  // An answer for a different set of languages is not an answer.
  const fresh = result.key === key;
  return { estimate: fresh ? result.estimate : null, failed: fresh && result.failed };
}
