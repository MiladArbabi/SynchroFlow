// tests/unit/ui/utils/nudgeUtils.test.ts
import {
  selectVariant,
  calculateConversionRate,
  shouldTriggerNudge,
  TriggerCondition,
  NudgeContext,
} from 'utils/nudgeUtils';

describe('nudgeUtils', () => {
  describe('selectVariant', () => {
    it('should select variant based on weights', () => {
      const variants = [
        { id: 'A', offer: '10% OFF', weight: 0.3 },
        { id: 'B', offer: '15% OFF', weight: 0.7 },
      ];

      // Test multiple times to ensure distribution
      const selections = Array(1000).fill(0).map(() => 
        selectVariant(variants)
      );

      const aCount = selections.filter(v => v.id === 'A').length;
      const bCount = selections.filter(v => v.id === 'B').length;

      // Should roughly follow the weights (within 5% tolerance)
      expect(aCount / 1000).toBeCloseTo(0.3, 1);
      expect(bCount / 1000).toBeCloseTo(0.7, 1);
    });

    it('should handle single variant', () => {
      const variants = [
        { id: 'A', offer: '10% OFF', weight: 1 },
      ];

      const variant = selectVariant(variants);
      expect(variant.id).toBe('A');
    });

    it('should normalize weights if they dont sum to 1', () => {
      const variants = [
        { id: 'A', offer: '10% OFF', weight: 1 },
        { id: 'B', offer: '15% OFF', weight: 1 },
      ];

      const variant = selectVariant(variants);
      expect(['A', 'B']).toContain(variant.id);
    });
  });

  describe('calculateConversionRate', () => {
    it('should calculate conversion rate correctly', () => {
      expect(calculateConversionRate(10, 100)).toBe(0.1);
      expect(calculateConversionRate(0, 100)).toBe(0);
      expect(calculateConversionRate(100, 100)).toBe(1);
    });

    it('should handle zero impressions', () => {
      expect(calculateConversionRate(0, 0)).toBe(0);
    });
  });

    describe('shouldTriggerNudge', () => {
    it('should trigger when all conditions are met', () => {
      const condition: TriggerCondition = {
        intentLevel: 'high',
        exitIntentDetected: true,
        minIntentScore: 70,
      };

      const context: NudgeContext = {
        intentLevel: 'high',
        exitIntentDetected: true,
        intentScore: 75,
      };

      expect(shouldTriggerNudge(condition, context)).toBe(true);
    });

    it('should not trigger when conditions are not met', () => {
      const condition: TriggerCondition = {
        intentLevel: 'high',
        exitIntentDetected: true,
      };

      const context: NudgeContext = {
        intentLevel: 'medium', // Doesn't match
        exitIntentDetected: true,
        intentScore: 50,
      };

      expect(shouldTriggerNudge(condition, context)).toBe(false);
    });

    it('should handle partial conditions', () => {
      const condition: TriggerCondition = {
        intentLevel: 'high',
        // No exit intent requirement
      };

      const context: NudgeContext = {
        intentLevel: 'high',
        exitIntentDetected: false, // Should still trigger
        intentScore: 80,
      };

      expect(shouldTriggerNudge(condition, context)).toBe(true);
    });

    it('should handle minIntentScore condition', () => {
      const condition: TriggerCondition = {
        minIntentScore: 70,
      };

      const context1: NudgeContext = { intentScore: 75 };
      const context2: NudgeContext = { intentScore: 65 };

      expect(shouldTriggerNudge(condition, context1)).toBe(true);
      expect(shouldTriggerNudge(condition, context2)).toBe(false);
    });
  });

  describe('nudgeUtils - Edge Cases', () => {
  describe('selectVariant - Edge Cases', () => {
    it('should throw error for empty variants array', () => {
      expect(() => selectVariant([])).toThrow('No variants provided');
    });

    it('should handle zero weights by normalizing', () => {
      const variants = [
        { id: 'A', offer: '10% OFF', weight: 0 },
        { id: 'B', offer: '15% OFF', weight: 0 },
        { id: 'C', offer: '20% OFF', weight: 1 },
      ];

      const variant = selectVariant(variants);
      expect(variant.id).toBe('C'); // Only non-zero weight should be selected
    });

    it('should handle very small weights', () => {
      const variants = [
        { id: 'A', offer: '10% OFF', weight: 0.0001 },
        { id: 'B', offer: '15% OFF', weight: 0.9999 },
      ];

      const variant = selectVariant(variants);
      expect(['A', 'B']).toContain(variant.id);
    });

    it('should handle negative weights by treating as zero', () => {
      const variants = [
        { id: 'A', offer: '10% OFF', weight: -1 },
        { id: 'B', offer: '15% OFF', weight: 2 },
      ];

      const variant = selectVariant(variants);
      expect(variant.id).toBe('B');
    });
  });

  describe('calculateConversionRate - Edge Cases', () => {
    it('should handle very large numbers', () => {
      expect(calculateConversionRate(1000000, 2000000)).toBe(0.5);
    });

    it('should handle decimal impressions and conversions', () => {
      expect(calculateConversionRate(2.5, 10)).toBe(0.25);
    });

    it('should return 0 for negative impressions', () => {
      expect(calculateConversionRate(5, -10)).toBe(0);
    });

    it('should return 0 for negative conversions', () => {
      expect(calculateConversionRate(-5, 10)).toBe(0);
    });
  });

    describe('shouldTriggerNudge - Edge Cases', () => {
      it('should handle undefined context values', () => {
        const condition: TriggerCondition = {
          intentLevel: 'high',
          minIntentScore: 70,
        };

        const context: NudgeContext = {
          // intentLevel and intentScore are undefined
        };

        expect(shouldTriggerNudge(condition, context)).toBe(false);
      });

      it('should handle partial context with partial conditions', () => {
        const condition: TriggerCondition = {
          minIntentScore: 50,
        };

        const context: NudgeContext = {
          intentScore: 60,
          // intentLevel and exitIntentDetected are undefined
        };

        expect(shouldTriggerNudge(condition, context)).toBe(true);
      });

      it('should return true for empty condition object', () => {
        const condition: TriggerCondition = {};
        const context: NudgeContext = { intentScore: 50 };

        expect(shouldTriggerNudge(condition, context)).toBe(true);
      });

      it('should handle multiple combined conditions', () => {
        const condition: TriggerCondition = {
          intentLevel: 'high',
          exitIntentDetected: true,
          minIntentScore: 70,
        };

        const matchingContext: NudgeContext = {
          intentLevel: 'high',
          exitIntentDetected: true,
          intentScore: 80,
        };

        const nonMatchingContext: NudgeContext = {
          intentLevel: 'high',
          exitIntentDetected: true,
          intentScore: 60, // Below minimum
        };

        expect(shouldTriggerNudge(condition, matchingContext)).toBe(true);
        expect(shouldTriggerNudge(condition, nonMatchingContext)).toBe(false);
      });

      it('should handle exact boundary scores', () => {
        const condition: TriggerCondition = {
          minIntentScore: 70,
        };

        const boundaryContext: NudgeContext = {
          intentScore: 70, // Exactly the minimum
        };

        expect(shouldTriggerNudge(condition, boundaryContext)).toBe(true);
      });
    });
  });
});