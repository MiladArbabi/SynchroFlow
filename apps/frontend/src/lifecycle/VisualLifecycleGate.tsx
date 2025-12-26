// VisualLifecycleGate.tsx
//
// UX-only lifecycle stabilizer.
// Guarantees:
// - FT_MINUS_ONE is visible on cold boot
// - FT0 is always shown for a perceptual minimum
// - FT1 is instant on refresh
// - No regression after FT1
//
// ZERO business logic. ZERO backend knowledge.

import { useEffect, useRef, useState } from 'react';
import { useShopLifecycle } from './ShopLifecycleContext';
import { ShopLifecyclePhase } from './types';
import { ReactNode } from 'react';

const FT0_MIN_MS = 2500;

export function VisualLifecycleGate({
  children,
}: {
  children: (phase: ShopLifecyclePhase) => ReactNode;
}) {
  const { phase } = useShopLifecycle();

  const [visualPhase, setVisualPhase] =
    useState<ShopLifecyclePhase>('FT_MINUS_ONE');

  const ft0EnteredAtRef = useRef<number | null>(null);
  const hasSeenFT1Ref = useRef(false);
  const hasLeftMinusOneRef = useRef(false);

  useEffect(() => {
    // FT_MINUS_ONE is absorbing until user action
    if (phase === 'FT_MINUS_ONE' && !hasLeftMinusOneRef.current) {
        setVisualPhase('FT_MINUS_ONE');
        return;
    }

    // FT1 is absorbing visually
    if (hasSeenFT1Ref.current) {
      setVisualPhase('FT1_READY');
      return;
    }

    // Hard reset
    if (phase === 'FT_MINUS_ONE') {
      ft0EnteredAtRef.current = null;
      setVisualPhase('FT_MINUS_ONE');
      return;
    }

    // FT0 entry
    if (phase === 'FT0_SYNCING' || phase === 'FT0_PREPARING') {
      if (ft0EnteredAtRef.current == null) {
        ft0EnteredAtRef.current = performance.now();
      }

      hasLeftMinusOneRef.current = true;
      setVisualPhase(phase);
      return;
    }

    // FT1 promotion (with dwell)
    if (phase === 'FT1_READY') {
      if (ft0EnteredAtRef.current == null) {
        // Force perceptual FT0 once
        ft0EnteredAtRef.current = performance.now();
        hasLeftMinusOneRef.current = true;
        setVisualPhase('FT0_PREPARING');
        return;
      }

      const elapsed =
        performance.now() - ft0EnteredAtRef.current;

      if (elapsed >= FT0_MIN_MS) {
        hasSeenFT1Ref.current = true;
        setVisualPhase('FT1_READY');
        return;
      }

      const timer = setTimeout(() => {
        hasSeenFT1Ref.current = true;
        setVisualPhase('FT1_READY');
      }, FT0_MIN_MS - elapsed);

      return () => clearTimeout(timer);
    }
  }, [phase]);

  useEffect(() => {
    const onConnect = () => {
        hasLeftMinusOneRef.current = true;
    };

    window.addEventListener('ui:connect-store', onConnect);
    return () =>
        window.removeEventListener('ui:connect-store', onConnect);
  }, []);

  return <>{children(visualPhase)}</>;
}