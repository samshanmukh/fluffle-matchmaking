import { useEffect, useState } from 'react';

import { HTTP_URL } from '../config';

/** Someone waiting right now who shares a language: how to draw them, and where they are. Never who they are. */
export interface PersonHere {
  avatar: number;
  region: string | null;
}

export interface Presence {
  waiting: number;
  /** The first few people, longest wait first. */
  people: PersonHere[];
}

const REFRESH_MS = 4000;

/** Who is waiting right now for the chosen languages. Asked again when they change, then every few seconds. */
export function usePresence(languages: string[], active: boolean): Presence | null {
  const key = [...languages].sort().join(',');
  const [result, setResult] = useState<{ key: string; presence: Presence | null }>({ key: '', presence: null });

  useEffect(() => {
    if (!active || key === '') return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${HTTP_URL}/presence?languages=${encodeURIComponent(key)}`);
        if (!res.ok) throw new Error(String(res.status));
        const presence = (await res.json()) as Presence;
        if (!cancelled) setResult({ key, presence });
      } catch {
        if (!cancelled) setResult({ key, presence: null });
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key, active]);

  return active && result.key === key ? result.presence : null;
}
