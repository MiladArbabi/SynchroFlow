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

export type FulfillmentOperationalReality =
  | 'real'
  | 'unreal'
  | 'unknown';

export type FulfillmentVisibility =
  | 'sufficient'
  | 'insufficient'
  | 'unknown';

export interface OrderFulfillmentIntelligence {
  operationalReality: FulfillmentOperationalReality;
  visibility: FulfillmentVisibility;
}

export function deriveOrderFulfillmentIntelligence(input: {
  fulfillmentSignal: 'present' | 'absent' | null;
  visibility: 'sufficient' | 'insufficient' | null;
}): OrderFulfillmentIntelligence {

  const { fulfillmentSignal, visibility } = input;

  // Epistemic guard — cannot classify without usable visibility
  if (visibility === null) {
    return {
      operationalReality: 'unknown',
      visibility: 'unknown',
    };
  }

  if (visibility === 'insufficient') {
    return {
      operationalReality: 'unknown',
      visibility: 'insufficient',
    };
  }

  if (fulfillmentSignal === 'present') {
    return {
      operationalReality: 'real',
      visibility: 'sufficient',
    };
  }

  if (fulfillmentSignal === 'absent') {
    return {
      operationalReality: 'unreal',
      visibility: 'sufficient',
    };
  }

  return {
    operationalReality: 'unknown',
    visibility: 'unknown',
  };
}