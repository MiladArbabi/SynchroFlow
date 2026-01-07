import { describe, it, expect } from '@jest/globals';

// NOTE:
// These imports do NOT exist yet.
// This test is intentionally RED.
// Implementation will be forced to conform to this contract.
import { buildFinancesFtep } from 'api-src/services/finances-ftep/FinancesFtep.service';
import type { FinancesFacts } from 'api-src/services/finances-facts/FinancesFacts.types';
import type { FinancesIntelligence } from 'api-src/services/finances-intelligence/FinancesIntelligence.service';

describe('Finances FTEP — Truth Exposure Policy (FT2)', () => {
  const baseFacts: FinancesFacts = {
    shopId: 1,
    period: { from: '2025-01-01', to: '2025-01-31' },

    totalRevenue: 10000,
    totalCosts: 7000,
    netResult: 3000,

    dataCoverage: {
      completenessPct: 92,
    },

    extractedAt: '2025-02-01T00:00:00.000Z',
  };

  const baseIntelligence: FinancesIntelligence = {
    netResult: {
      value: 3000,
      status: 'good',
    },

    trend: {
      direction: 'up',
    },

    dataCoveragePct: 92,

    // INTERNAL — MUST NEVER LEAK
    marginPct: 30,
    lossReason: null,
  };

  it('exposes positive outcome without leaking intelligence', () => {
    const result = buildFinancesFtep({
      facts: baseFacts,
      intelligence: baseIntelligence,
    });

    expect(result.context.period).toEqual({
      from: '2025-01-01',
      to: '2025-01-31',
    });

    expect(result.context.netObserved).toBe(3000);

    expect(result.outcome?.status).toBe('positive');

    expect(result.trend?.direction).toBe('up');
  });

  it('does not leak intelligence-only fields', () => {
    const result = buildFinancesFtep({
      facts: baseFacts,
      intelligence: baseIntelligence,
    }) as any;

    expect(result.marginPct).toBeUndefined();
    expect(result.lossReason).toBeUndefined();
    expect(result.threshold).toBeUndefined();
  });

  it('passes serialization scan (no forbidden terms)', () => {
    const result = buildFinancesFtep({
      facts: baseFacts,
      intelligence: baseIntelligence,
    });

    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(/percent/i);
    expect(serialized).not.toMatch(/margin/i);
    expect(serialized).not.toMatch(/reason/i);
    expect(serialized).not.toMatch(/because/i);
    expect(serialized).not.toMatch(/threshold/i);
  });

  it('returns null outcome when intelligence is indeterminate', () => {
    const result = buildFinancesFtep({
      facts: baseFacts,
      intelligence: {
        ...baseIntelligence,
        netResult: {
          value: null,
          status: 'unknown',
        },
      },
    });

    expect(result.outcome).toBeNull();
  });
});