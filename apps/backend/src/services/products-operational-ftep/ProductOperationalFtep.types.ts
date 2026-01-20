/**
 * Layer 3 — ProductOperationalFTEP
 *
 * Truth Exposure Policy for operational signals.
 *
 * RULES:
 * - Lossy downgrade only
 * - No intelligence leakage
 * - Null represents suppressed or unknowable truth
 */
export interface ProductOperationalFT2Exposure {
  operational: {
    inventory: 'ok' | 'gaps' | 'unknown';
    fulfillment: 'visible' | 'missing' | 'unknown';
    stability: 'stable' | 'fragile' | 'unknown';
  } | null;
}