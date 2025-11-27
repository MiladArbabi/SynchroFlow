// tests/unit/ui/hooks/useNudgeEngine.test.tsx
import { renderHook, act } from '@testing-library/react';
import { useNudgeEngine } from 'hooks/useNudgeEngine';

// Mock dependencies
jest.mock('hooks/useIntentScoring', () => ({
  useIntentScoring: () => ({
    intentScore: 75,
    intentLevel: 'high',
    trackPageView: jest.fn(),
    trackProductView: jest.fn(),
    trackScrollDepth: jest.fn(),
    trackMouseMovement: jest.fn(),
    trackClick: jest.fn(),
    resetIntent: jest.fn(),
  }),
}));

jest.mock('hooks/useExitIntent', () => ({
  useExitIntent: () => ({
    exitIntentDetected: false,
    shouldShowOffer: false,
    resetExitIntent: jest.fn(),
    intentScore: 75,
    intentLevel: 'high',
  }),
}));

describe('useNudgeEngine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize with empty active nudges', () => {
    const { result } = renderHook(() => useNudgeEngine());

    expect(result.current.activeNudges).toEqual([]);
    expect(result.current.nudgePerformance).toEqual({});
  });

  it('should register a new nudge', () => {
    const { result } = renderHook(() => useNudgeEngine());

    act(() => {
      result.current.registerNudge({
        id: 'exit-offer-1',
        type: 'exit-intent',
        triggerCondition: { intentLevel: 'high', exitIntentDetected: true },
        variants: [
          { id: 'A', offer: '10% OFF', weight: 0.5 },
          { id: 'B', offer: 'Free Shipping', weight: 0.5 },
        ],
      });
    });

    expect(result.current.activeNudges).toHaveLength(1);
    expect(result.current.activeNudges[0].id).toBe('exit-offer-1');
  });

  it('should select variant based on weights', () => {
    const { result } = renderHook(() => useNudgeEngine());

    act(() => {
      result.current.registerNudge({
        id: 'test-nudge',
        type: 'exit-intent',
        triggerCondition: { intentLevel: 'high' }, // Remove exitIntentDetected requirement
        variants: [
          { id: 'A', offer: '10% OFF', weight: 0.3 },
          { id: 'B', offer: '15% OFF', weight: 0.7 },
        ],
      });
    });

    const variant = result.current.getNudgeVariant('test-nudge');
    expect(variant).toBeDefined();
    expect(['A', 'B']).toContain(variant?.id);
  });

  it('should track nudge performance', () => {
    const { result } = renderHook(() => useNudgeEngine());

    act(() => {
      result.current.trackNudgeImpression('test-nudge', 'A');
    });

    act(() => {
      result.current.trackNudgeConversion('test-nudge', 'A', 50.00);
    });

    expect(result.current.nudgePerformance['test-nudge']).toBeDefined();
    expect(result.current.nudgePerformance['test-nudge'].A.impressions).toBe(1);
    expect(result.current.nudgePerformance['test-nudge'].A.conversions).toBe(1);
    expect(result.current.nudgePerformance['test-nudge'].A.revenue).toBe(50.00);
  });

  it('should calculate conversion rate', () => {
    const { result } = renderHook(() => useNudgeEngine());

    // Track multiple impressions and one conversion
    act(() => {
      result.current.trackNudgeImpression('test-nudge', 'A');
      result.current.trackNudgeImpression('test-nudge', 'A');
      result.current.trackNudgeConversion('test-nudge', 'A', 25.00);
    });

    const conversionRate = result.current.getConversionRate('test-nudge', 'A');
    expect(conversionRate).toBe(0.5); // 1 conversion / 2 impressions
  });

  it('should remove inactive nudges', () => {
    const { result } = renderHook(() => useNudgeEngine());

    act(() => {
      result.current.registerNudge({
        id: 'temp-nudge',
        type: 'exit-intent',
        triggerCondition: { intentLevel: 'high', exitIntentDetected: true },
        variants: [{ id: 'A', offer: '10% OFF', weight: 1 }],
      });
    });

    expect(result.current.activeNudges).toHaveLength(1);

    act(() => {
      result.current.removeNudge('temp-nudge');
    });

    expect(result.current.activeNudges).toHaveLength(0);
  });

  describe('useNudgeEngine - Edge Cases', () => {
      it('should not trigger nudge when conditions are not met', () => {
      const { result } = renderHook(() => useNudgeEngine());

      // Register nudge with high intent requirement
      act(() => {
        result.current.registerNudge({
          id: 'high-intent-nudge',
          type: 'exit-intent',
          triggerCondition: { intentLevel: 'high' as const, minIntentScore: 80 },
          variants: [{ id: 'A', offer: '15% OFF', weight: 1 }],
        });
      });

      // With current mock (intentScore: 75), should not trigger
      const variant = result.current.getNudgeVariant('high-intent-nudge');
      expect(variant).toBeNull();
    });

    it('should handle multiple nudges with different conditions', () => {
      const { result } = renderHook(() => useNudgeEngine());

      act(() => {
        // Low intent nudge
        result.current.registerNudge({
          id: 'low-intent-nudge',
          type: 'banner',
          triggerCondition: { intentLevel: 'low' as const },
          variants: [{ id: 'A', offer: '5% OFF', weight: 1 }],
        });

        // High intent nudge
        result.current.registerNudge({
          id: 'high-intent-nudge',
          type: 'modal',
          triggerCondition: { intentLevel: 'high' as const },
          variants: [{ id: 'B', offer: '20% OFF', weight: 1 }],
        });
      });

      // Should only return high intent nudge (based on mock data)
      const variant = result.current.getNudgeVariant('high-intent-nudge');
      expect(variant?.id).toBe('B');
    });

    it('should handle duplicate nudge registration gracefully', () => {
      const { result } = renderHook(() => useNudgeEngine());

      const nudgeConfig = {
        id: 'duplicate-test',
        type: 'exit-intent',
        triggerCondition: { intentLevel: 'high' as const }, // Add type assertion
        variants: [{ id: 'A', offer: '10% OFF', weight: 1 }],
      };

      act(() => {
        result.current.registerNudge(nudgeConfig);
        result.current.registerNudge(nudgeConfig); // Duplicate
      });

      // Should only have one instance
      expect(result.current.activeNudges).toHaveLength(1);
    });

    it('should handle removing non-existent nudge gracefully', () => {
      const { result } = renderHook(() => useNudgeEngine());

      // Remove nudge that doesn't exist
      act(() => {
        result.current.removeNudge('non-existent');
      });

      // Should not throw error and maintain state
      expect(result.current.activeNudges).toEqual([]);
    });

    it('should track performance across multiple variants', () => {
      const { result } = renderHook(() => useNudgeEngine());

      act(() => {
        result.current.registerNudge({
          id: 'multi-variant-test',
          type: 'exit-intent',
          triggerCondition: { intentLevel: 'high' },
          variants: [
            { id: 'A', offer: '10% OFF', weight: 0.5 },
            { id: 'B', offer: '15% OFF', weight: 0.5 },
          ],
        });
      });

      // Track impressions for both variants
      act(() => {
        result.current.trackNudgeImpression('multi-variant-test', 'A');
        result.current.trackNudgeImpression('multi-variant-test', 'B');
        result.current.trackNudgeImpression('multi-variant-test', 'A');
      });

      // Track conversions
      act(() => {
        result.current.trackNudgeConversion('multi-variant-test', 'A', 100);
      });

      const performance = result.current.nudgePerformance['multi-variant-test'];
      expect(performance.A.impressions).toBe(2);
      expect(performance.A.conversions).toBe(1);
      expect(performance.A.revenue).toBe(100);
      expect(performance.B.impressions).toBe(1);
      expect(performance.B.conversions).toBe(0);
      expect(performance.B.revenue).toBe(0);
    });

    it('should handle rapid state updates without race conditions', () => {
      const { result } = renderHook(() => useNudgeEngine());

      // Rapidly register multiple nudges
      act(() => {
        for (let i = 0; i < 10; i++) {
          result.current.registerNudge({
            id: `nudge-${i}`,
            type: 'banner',
            triggerCondition: { intentLevel: 'high' },
            variants: [{ id: 'A', offer: `${i}% OFF`, weight: 1 }],
          });
        }
      });

      expect(result.current.activeNudges).toHaveLength(10);
    });

    it('should maintain performance data after nudge removal', () => {
      const { result } = renderHook(() => useNudgeEngine());

      // Register and track performance
      act(() => {
        result.current.registerNudge({
          id: 'temp-nudge',
          type: 'exit-intent',
          triggerCondition: { intentLevel: 'high' },
          variants: [{ id: 'A', offer: '10% OFF', weight: 1 }],
        });
      });

      act(() => {
        result.current.trackNudgeImpression('temp-nudge', 'A');
        result.current.trackNudgeConversion('temp-nudge', 'A', 50);
      });

      // Remove nudge
      act(() => {
        result.current.removeNudge('temp-nudge');
      });

      // Performance data should persist
      expect(result.current.nudgePerformance['temp-nudge']).toBeDefined();
      expect(result.current.nudgePerformance['temp-nudge'].A.conversions).toBe(1);
    });
  });
});