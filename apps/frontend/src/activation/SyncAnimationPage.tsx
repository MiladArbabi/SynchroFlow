import React, { useEffect, useState } from 'react';
import type { UILifecyclePhase } from '../lifecycle/types';
import { useShopLifecycle } from '../lifecycle/ShopLifecycleContext';
import { SyncAnimationExperience } from './SyncAnimationExperience';
import { useSyncStatus } from './hooks/useSyncStatus';

export function isFirstActivationPhase(phase: UILifecyclePhase): boolean {
  return phase === 'FT_MINUS_ONE' || phase === 'FT0' || phase === 'FT0_SYNCING' || phase === 'FT0_PREPARING';
}

export function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(media.matches);
    onChange();
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);

  return reducedMotion;
}

const SyncAnimationPage: React.FC = () => {
  const { phase } = useShopLifecycle();
  const { status, counts, progress, lastError } = useSyncStatus();
  const reducedMotion = usePrefersReducedMotion();

  return (
    <SyncAnimationExperience
      syncSnapshot={{ status, counts, progress, lastError }}
      firstActivation={isFirstActivationPhase(phase)}
      reducedMotion={reducedMotion}
    />
  );
};

export default SyncAnimationPage;
