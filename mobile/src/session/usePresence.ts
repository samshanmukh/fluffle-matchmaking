import { useEffect, useState } from 'react';

import { HTTP_URL } from '../config';

/** Someone online right now: how to draw them, and where they are. Never who they are. */
export interface PersonHere {
  avatar: number;
  region: string | null;
  /** In the queue and shares one of your languages: can be matched with you this minute. */
  waiting: boolean;
}

export interface Presence {
  /** Everyone connected, not counting you. */
  online: number;
  /** How many of them are waiting and share one of your languages. */
  waiting: number;
  /** The first few people: those waiting first, longest wait first. */
  people: PersonHere[];
}

const REFRESH_MS = 4000;

/** Who is online right now. Asked again when the chosen languages change, then every few seconds. */
export function usePresence(languages: string[], userId: string, active: boolean): Presence | null {
  const key = [...languages].sort().join(',');
  const [result, setResult] = useState<{ key: string; presence: Presence | null }>({ key: '', presence: null });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${HTTP_URL}/presence?languages=${encodeURIComponent(key)}&user_id=${encodeURIComponent(userId)}`);
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
  }, [key, userId, active]);

  return active && result.key === key ? result.presence : null;
}
