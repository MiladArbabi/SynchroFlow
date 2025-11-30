// apps/frontend/src/hooks/useNudgeEngine.ts
import { useState, useCallback } from 'react';
import { useIntentScoring } from './useIntentScoring';
import { useExitIntent } from './useExitIntent';
import { 
  NudgeConfig, 
  NudgeVariant, 
  selectVariant, 
  calculateConversionRate,
  shouldTriggerNudge 
} from '../utils/nudgeUtils';

export interface NudgePerformance {
  [nudgeId: string]: {
    [variantId: string]: {
      impressions: number;
      conversions: number;
      revenue: number;
    };
  };
}

export const useNudgeEngine = () => {
  const [activeNudges, setActiveNudges] = useState<NudgeConfig[]>([]);
  const [nudgePerformance, setNudgePerformance] = useState<NudgePerformance>({});
  
  const { intentLevel, intentScore } = useIntentScoring();
  const { exitIntentDetected } = useExitIntent();

  const registerNudge = useCallback((nudgeConfig: NudgeConfig) => {
    setActiveNudges(prev => {
      // Avoid duplicates
      if (prev.find(nudge => nudge.id === nudgeConfig.id)) {
        return prev;
      }
      return [...prev, nudgeConfig];
    });
  }, []);

  const removeNudge = useCallback((nudgeId: string) => {
    setActiveNudges(prev => prev.filter(nudge => nudge.id !== nudgeId));
  }, []);

  const getNudgeVariant = useCallback((nudgeId: string): NudgeVariant | null => {
    const nudge = activeNudges.find(n => n.id === nudgeId);
    if (!nudge) return null;

    // Check if nudge should trigger based on current context
    const context = { intentLevel, exitIntentDetected, intentScore };
    if (!shouldTriggerNudge(nudge.triggerCondition, context)) {
      return null;
    }

    return selectVariant(nudge.variants);
  }, [activeNudges, intentLevel, exitIntentDetected, intentScore]);

  const trackNudgeImpression = useCallback((nudgeId: string, variantId: string) => {
    setNudgePerformance(prev => {
      const nudgePerf = prev[nudgeId] || {};
      const variantPerf = nudgePerf[variantId] || { impressions: 0, conversions: 0, revenue: 0 };
      
      return {
        ...prev,
        [nudgeId]: {
          ...nudgePerf,
          [variantId]: {
            ...variantPerf,
            impressions: variantPerf.impressions + 1,
          },
        },
      };
    });
  }, []);

  const trackNudgeConversion = useCallback((nudgeId: string, variantId: string, revenue: number) => {
    setNudgePerformance(prev => {
      const nudgePerf = prev[nudgeId] || {};
      const variantPerf = nudgePerf[variantId] || { impressions: 0, conversions: 0, revenue: 0 };
      
      return {
        ...prev,
        [nudgeId]: {
          ...nudgePerf,
          [variantId]: {
            ...variantPerf,
            conversions: variantPerf.conversions + 1,
            revenue: variantPerf.revenue + revenue,
          },
        },
      };
    });
  }, []);

  const getConversionRate = useCallback((nudgeId: string, variantId: string): number => {
    const variantPerf = nudgePerformance[nudgeId]?.[variantId];
    if (!variantPerf) return 0;

    return calculateConversionRate(variantPerf.conversions, variantPerf.impressions);
  }, [nudgePerformance]);

  return {
    activeNudges,
    nudgePerformance,
    registerNudge,
    removeNudge,
    getNudgeVariant,
    trackNudgeImpression,
    trackNudgeConversion,
    getConversionRate,
  };
};