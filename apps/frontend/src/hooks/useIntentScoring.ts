// apps/frontend/src/hooks/useIntentScoring.ts
import { useState, useCallback, useEffect } from 'react';
import { 
  IntentData, 
  IntentLevel, 
  calculateIntentScore, 
  updateIntentScore, 
  getIntentLevel 
} from '../utils/intentScoring';

export const useIntentScoring = () => {
  const [intentData, setIntentData] = useState<IntentData>({
    pageViews: [],
    timeOnSite: 0,
    productsViewed: [],
    scrollDepth: 0,
    mouseMovements: 0,
    clicks: 0
  });

  const [intentScore, setIntentScore] = useState(0);
  const [intentLevel, setIntentLevel] = useState<IntentLevel>('low');

  // Recalculate score when intent data changes
  useEffect(() => {
    const score = calculateIntentScore(intentData);
    const level = getIntentLevel(score);
    setIntentScore(score);
    setIntentLevel(level);
  }, [intentData]);

  const trackPageView = useCallback((path: string) => {
    setIntentData(current => updateIntentScore(current, {
      pageView: { path, timestamp: Date.now() }
    }));
  }, []);

  const trackProductView = useCallback((productId: string) => {
    setIntentData(current => updateIntentScore(current, {
      productsViewed: [...current.productsViewed, productId]
    }));
  }, []);

  const trackScrollDepth = useCallback((depth: number) => {
    setIntentData(current => updateIntentScore(current, {
      scrollDepth: Math.max(current.scrollDepth, depth)
    }));
  }, []);

  const trackMouseMovement = useCallback(() => {
    setIntentData(current => updateIntentScore(current, {
      mouseMovements: current.mouseMovements + 1
    }));
  }, []);

  const trackClick = useCallback(() => {
    setIntentData(current => updateIntentScore(current, {
      clicks: current.clicks + 1
    }));
  }, []);

  const resetIntent = useCallback(() => {
    setIntentData({
      pageViews: [],
      timeOnSite: 0,
      productsViewed: [],
      scrollDepth: 0,
      mouseMovements: 0,
      clicks: 0
    });
  }, []);

  // Track time on site
  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const currentTime = Math.floor((Date.now() - startTime) / 1000); // seconds
      setIntentData(current => updateIntentScore(current, {
        timeOnSite: currentTime
      }));
    }, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, []);

  return {
    intentScore,
    intentLevel,
    intentData,
    trackPageView,
    trackProductView,
    trackScrollDepth,
    trackMouseMovement,
    trackClick,
    resetIntent
  };
};