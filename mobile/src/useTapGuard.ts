import { useCallback, useRef } from 'react';

/** How long a newly shown screen ignores taps. Mutable so tests can switch it off. */
export const tapGuard = { ms: 600 };

/**
 * Screens here replace each other without the user asking (an offer arrives,
 * a wait begins), and their buttons sit where the last screen's buttons were.
 * A second tap of "Find a match" would land on "Stop looking"; a thumb already
 * moving would decline an offer it never saw. For the first moment after a
 * screen appears, its buttons do nothing.
 */
export function useTapGuard() {
  const shownAt = useRef(Date.now()).current;
  return useCallback(
    <A extends unknown[]>(action: (...args: A) => void) =>
      (...args: A) => {
        if (Date.now() - shownAt >= tapGuard.ms) action(...args);
      },
    [shownAt],
  );
}
