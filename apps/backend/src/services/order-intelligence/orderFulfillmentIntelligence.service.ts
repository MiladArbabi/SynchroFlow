/**
 * Fulfillment Intelligence (Layer 2)
 * ---------------------------------
 * Classifies whether economic order signals
 * are operationally grounded.
 *
 * Guarantees:
 * - Pure classification
 * - No lifecycle meaning
 * - No performance semantics
 * - Unknown propagates aggressively
 */

export function deriveOrderFulfillmentIntelligence(input: {
  fulfillmentSignal: 'present' | 'absent' | null;
  visibility: 'sufficient' | 'insufficient' | null;
}) {
  const { fulfillmentSignal, visibility } = input;

  // Epistemic guard
  if (visibility !== 'sufficient') {
    return {
      operationalReality: 'unknown' as const,
      visibility: 'unknown' as const,
    };
  }

  if (fulfillmentSignal === 'present') {
    return {
      operationalReality: 'real' as const,
      visibility: 'sufficient' as const,
    };
  }

  if (fulfillmentSignal === 'absent') {
    return {
      operationalReality: 'unreal' as const,
      visibility: 'sufficient' as const,
    };
  }

  return {
    operationalReality: 'unknown' as const,
    visibility: 'unknown' as const,
  };
}