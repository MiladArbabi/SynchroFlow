/**
 * Finances FT1 — readiness manifest (RED)
 *
 * Purpose:
 * - Define the expected FT1 manifest shape for Finances
 * - Finances is diagnostic-only in FT1
 * - No tasks, no CTA, signals only
 *
 * This test MUST FAIL until:
 * - Finances is added to readiness.manifest.ts
 */

import { MODULE_ONBOARDING_MANIFESTS } from 'api-src/onboarding/readiness.manifest';

describe('Finances FT1 readiness manifest', () => {
  test('finances module is declared as diagnostic-only', () => {
    const finances = MODULE_ONBOARDING_MANIFESTS.find(
      (m) => m.moduleId === 'finances'
    );

    expect(finances).toBeDefined();

    expect(finances).toEqual(
      expect.objectContaining({
        moduleId: 'finances',
        displayName: expect.any(String),
        requiredSignals: [
          'finances.transactionCount',
          'finances.costDataReady',
          'finances.baseSignalsReady',
        ],
        tasks: [],
      })
    );
  });
});
