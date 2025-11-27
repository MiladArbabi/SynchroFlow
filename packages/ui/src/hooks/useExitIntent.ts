// packages/ui/src/hooks/useExitIntent.ts
import { useState, useEffect, useCallback } from 'react';
import { useIntentScoring } from './useIntentScoring';

export const useExitIntent = () => {
  const [exitIntentDetected, setExitIntentDetected] = useState(false);
  const { intentScore, intentLevel } = useIntentScoring();

  const handleMouseLeave = useCallback((event: MouseEvent) => {
    // Only trigger if mouse leaves from the top of the viewport
    if (event.clientY <= 0) {
      setExitIntentDetected(true);
    }
  }, []);

  const handleBeforeUnload = useCallback(() => {
    setExitIntentDetected(true);
  }, []);

  const resetExitIntent = useCallback(() => {
    setExitIntentDetected(false);
  }, []);

  useEffect(() => {
    // Add event listeners
    document.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      // Clean up event listeners
      document.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [handleMouseLeave, handleBeforeUnload]);

  // Determine if we should show an offer based on intent score and exit intent
  const shouldShowOffer = exitIntentDetected && intentLevel === 'high';

  return {
    exitIntentDetected,
    shouldShowOffer,
    resetExitIntent,
    intentScore,
    intentLevel,
  };
};