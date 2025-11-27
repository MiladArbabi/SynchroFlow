// packages/ui/src/utils/nudgeUtils.ts
export interface NudgeVariant {
  id: string;
  offer: string;
  weight: number;
}

export interface TriggerCondition {
  intentLevel?: 'low' | 'medium' | 'high';
  exitIntentDetected?: boolean;
  minIntentScore?: number;
}

export interface NudgeConfig {
  id: string;
  type: string;
  triggerCondition: TriggerCondition;
  variants: NudgeVariant[];
}

export interface NudgeContext {
  intentLevel?: 'low' | 'medium' | 'high';
  exitIntentDetected?: boolean;
  intentScore?: number;
}

export const selectVariant = (variants: NudgeVariant[]): NudgeVariant => {
  if (variants.length === 0) {
    throw new Error('No variants provided');
  }

  if (variants.length === 1) {
    return variants[0];
  }

  // Normalize weights to sum to 1
  const totalWeight = variants.reduce((sum, variant) => sum + variant.weight, 0);
  const normalizedVariants = variants.map(variant => ({
    ...variant,
    weight: variant.weight / totalWeight
  }));

  // Select variant based on weights
  const random = Math.random();
  let cumulativeWeight = 0;

  for (const variant of normalizedVariants) {
    cumulativeWeight += variant.weight;
    if (random <= cumulativeWeight) {
      return variant;
    }
  }

  // Fallback to first variant
  return normalizedVariants[0];
};

export const calculateConversionRate = (conversions: number, impressions: number): number => {
  if (impressions <= 0 || conversions < 0) return 0;
  return conversions / impressions;
};

export const shouldTriggerNudge = (condition: TriggerCondition, context: NudgeContext): boolean => {
  // Check intent level
  if (condition.intentLevel && condition.intentLevel !== context.intentLevel) {
    return false;
  }

  // Check exit intent
  if (condition.exitIntentDetected !== undefined && condition.exitIntentDetected !== context.exitIntentDetected) {
    return false;
  }

  // Check minimum intent score
  if (condition.minIntentScore !== undefined && (context.intentScore || 0) < condition.minIntentScore) {
    return false;
  }

  return true;
};