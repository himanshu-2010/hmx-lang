import { useCallback, useEffect, useRef } from "react";

/**
 * Returns a trailing-edge debounced wrapper around `callback`. Repeated
 * triggers (double-clicks, Ctrl/⌘+Enter spam) collapse into one invocation
 * `delay` ms after the last one. Any pending call is dropped on unmount.
 */
export function useDebouncedCallback<A extends unknown[]>(
  callback: (...args: A) => void,
  delay: number,
): (...args: A) => void {
  const callbackRef = useRef(callback);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  callbackRef.current = callback;

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  return useCallback(
    (...args: A) => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        callbackRef.current(...args);
      }, delay);
    },
    [delay],
  );
}