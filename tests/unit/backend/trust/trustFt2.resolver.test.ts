// tests/unit/backend/trust/trustFt2.resolver.test.ts

import { getTrustFt2Snapshot } from 'api-src/services/trust-ft2/trustFt2.resolver';

jest.mock(
  'api-src/services/products-data-freshness.provider',
  () => ({
    getProductDataFreshnessSnapshot: jest.fn(),
  })
);

jest.mock(
  'api-src/services/products-data-integrity.provider',
  () => ({
    getProductDataIntegritySnapshot: jest.fn(),
  })
);

import {
  getProductDataFreshnessSnapshot,
} from 'api-src/services/products-data-freshness.provider';

import {
  getProductDataIntegritySnapshot,
} from 'api-src/services/products-data-integrity.provider';

describe('Trust FT2 Resolver — invariants', () => {
  const shopId = 1;

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─────────────────────────────────────────────
  // Freshness aggregation invariants
  // ─────────────────────────────────────────────

  test.each([
    {
      label: 'all domains null → unknown',
      freshness: {
        structural: null,
        inventory: null,
        sales: null,
        fulfillment: null,
        cost: null,
      },
      expected: 'unknown',
    },
    {
      label: 'one fresh, rest stale → fresh',
      freshness: {
        structural: 'fresh',
        inventory: 'stale',
        sales: 'stale',
        fulfillment: 'stale',
        cost: 'stale',
      },
      expected: 'fresh',
    },
    {
      label: 'all stale → stale',
      freshness: {
        structural: 'stale',
        inventory: 'stale',
        sales: 'stale',
        fulfillment: 'stale',
        cost: 'stale',
      },
      expected: 'stale',
    },
    {
      label: 'any null present → unknown',
      freshness: {
        structural: 'fresh',
        inventory: null,
        sales: 'stale',
        fulfillment: 'stale',
        cost: 'stale',
      },
      expected: 'unknown',
    },
  ])('freshness aggregation: $label', async ({ freshness, expected }) => {
    (getProductDataFreshnessSnapshot as jest.Mock).mockResolvedValue({
      freshness,
    });

    (getProductDataIntegritySnapshot as jest.Mock).mockResolvedValue({
      integrity: 'ok',
      duplication: 'absent',
    });

    const snapshot = await getTrustFt2Snapshot({ shopId });

    expect(snapshot.dataFreshness).toBe(expected);
  });

  // ─────────────────────────────────────────────
  // Integrity semantic mapping invariants
  // ─────────────────────────────────────────────

  test.each([
    { integrity: 'ok', expected: 'consistent' },
    { integrity: 'attention', expected: 'inconsistent' },
    { integrity: 'unknown', expected: 'unknown' },
    { integrity: null, expected: 'unknown' },
  ])(
    'integrity mapping: %s → %s',
    async ({ integrity, expected }) => {
      (getProductDataFreshnessSnapshot as jest.Mock).mockResolvedValue({
        freshness: {
          structural: 'fresh',
          inventory: 'fresh',
          sales: 'fresh',
          fulfillment: 'fresh',
          cost: 'fresh',
        },
      });

      (getProductDataIntegritySnapshot as jest.Mock).mockResolvedValue(
        integrity === null
          ? null
          : {
              integrity,
              duplication: 'absent',
            }
      );

      const snapshot = await getTrustFt2Snapshot({ shopId });

      expect(snapshot.dataIntegrity).toBe(expected);
    }
  );

  // ─────────────────────────────────────────────
  // Trust gate truth table (terminal)
  // ─────────────────────────────────────────────

  test.each([
    ['fresh', 'consistent', true],
    ['fresh', 'inconsistent', false],
    ['stale', 'consistent', false],
    ['stale', 'inconsistent', false],
    ['unknown', 'consistent', null],
    ['fresh', 'unknown', null],
    ['unknown', 'unknown', null],
  ])(
    'trust gate: freshness=%s integrity=%s → %s',
    async (freshness, integrity, expected) => {
      (getProductDataFreshnessSnapshot as jest.Mock).mockResolvedValue({
        freshness:
          freshness === 'unknown'
            ? {
                structural: null,
                inventory: null,
                sales: null,
                fulfillment: null,
                cost: null,
              }
            : {
                structural: freshness,
                inventory: freshness,
                sales: freshness,
                fulfillment: freshness,
                cost: freshness,
              },
      });

      (getProductDataIntegritySnapshot as jest.Mock).mockResolvedValue(
        integrity === 'unknown'
          ? { integrity: 'unknown', duplication: 'unknown' }
          : {
              integrity:
                integrity === 'consistent' ? 'ok' : 'attention',
              duplication: 'absent',
            }
      );

      const snapshot = await getTrustFt2Snapshot({ shopId });

      expect(snapshot.trustEligible).toBe(expected);
    }
  );

  // ─────────────────────────────────────────────
  // Structural invariant
  // ─────────────────────────────────────────────

  test('always returns full Trust FT2 snapshot shape', async () => {
    (getProductDataFreshnessSnapshot as jest.Mock).mockResolvedValue({
      freshness: null,
    });

    (getProductDataIntegritySnapshot as jest.Mock).mockResolvedValue(null);

    const snapshot = await getTrustFt2Snapshot({ shopId });

    expect(snapshot).toHaveProperty('dataFreshness');
    expect(snapshot).toHaveProperty('dataIntegrity');
    expect(snapshot).toHaveProperty('trustEligible');
  });
});
