// apps/frontend/src/activation/hooks/useCompletionSound.ts

/**
 * useCompletionSound
 * --------------------------------------------------
 * Responsibility:
 * - Encapsulate AudioContext lifecycle
 * - Prevent repeated instantiation leaks
 * - Provide stable play() API
 */

import { useRef } from 'react';

export function useCompletionSound(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);

  const getCtx = () => {
    if (!ctxRef.current) {
      try {
        ctxRef.current = new AudioContext();
      } catch {
        // instrumentation: audio not supported
        console.warn('[useCompletionSound] AudioContext unavailable');
        return null;
      }
    }
    return ctxRef.current;
  };

  const play = () => {
    if (!enabled) return;

    const ctx = getCtx();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.4);

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.6);
  };

  return { play };
}