//apps/frontend/src/activation/useFT0Promotion.ts
import { useEffect, useRef } from 'react';

export function useFT0Promotion(ft0Phase?: string) {
  const prevPhase = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (
      prevPhase.current &&
      prevPhase.current !== 'COMPLETED' &&
      ft0Phase === 'COMPLETED'
    ) {
      console.log('[FT0] Promotion detected');
      window.dispatchEvent(new CustomEvent('ft0:completed'));
    }

    prevPhase.current = ft0Phase;
  }, [ft0Phase]);
}