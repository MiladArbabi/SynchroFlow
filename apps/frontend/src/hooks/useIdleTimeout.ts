// apps/frontend/src/hooks/useIdleTimeout.ts
//
// IDLE TIMEOUT
// ------------
// Logs the user out after `timeoutMs` of inactivity.
// Resets on any mouse, keyboard, touch, or scroll event.
// Wired into AppLayout so it only runs for authenticated sessions.

import { useEffect, useRef } from 'react';

const IDLE_EVENTS: (keyof WindowEventMap)[] = [
  'mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel',
];

export function useIdleTimeout(onTimeout: () => void, timeoutMs = 15 * 60 * 1000) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(onTimeout, timeoutMs);
    };

    // Start timer immediately
    reset();

    // Reset on any user interaction
    IDLE_EVENTS.forEach(e => window.addEventListener(e, reset, { passive: true }));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      IDLE_EVENTS.forEach(e => window.removeEventListener(e, reset));
    };
  }, [onTimeout, timeoutMs]);
}