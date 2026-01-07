import { describe, it, expect, jest } from '@jest/globals';

import { getFinancesFt2Snapshot } from 'api-src/services/finances-ft2.provider';
import type { FinancesFacts } from 'api-src/services/finances-facts/FinancesFacts.types';
import type { FinancesIntelligence } from 'api-src/services/finances-intelligence/FinancesIntelligence.service';
import type { FinancesFT2Exposure } from 'api-src/services/finances-ftep';

const mockBuildFinancesFacts =
   buildFinancesFacts as jest.MockedFunction<typeof buildFinancesFacts>;

 const mockBuildFinancesIntelligence =
   buildFinancesIntelligence as jest.MockedFunction<
     typeof buildFinancesIntelligence
   >;

 const mockBuildFinancesFtep =
   buildFinancesFtep as jest.MockedFunction<typeof buildFinancesFtep>;

// ---- Mocks ----
jest.mock('api-src/services/finances-facts', () => ({
  buildFinancesFacts: jest.fn(),
}));

jest.mock(
  'api-src/services/finances-intelligence/FinancesIntelligence.service',
  () => ({
    buildFinancesIntelligence: jest.fn(),
  })
);

jest.mock('api-src/services/finances-ftep', () => ({
  buildFinancesFtep: jest.fn(),
}));

import { buildFinancesFacts } from 'api-src/services/finances-facts';
import { buildFinancesIntelligence } from 'api-src/services/finances-intelligence/FinancesIntelligence.service';
import { buildFinancesFtep } from 'api-src/services/finances-ftep';

describe('Finances FT2 Provider', () => {
  it('executes Facts → Intelligence → FTEP pipeline in order', async () => {
    const facts: FinancesFacts = {
      shopId: 1,
      period: { from: '2025-01-01', to: '2025-01-31' },
      totalRevenue: 10000,
      totalCosts: 7000,
      netResult: 3000,
      dataCoverage: { completenessPct: 95 },
      extractedAt: '2025-02-01T00:00:00.000Z',
    };

    const intelligence: FinancesIntelligence = {
      netResult: { value: 3000, status: 'good' },
      trend: { direction: 'up' },
      dataCoveragePct: 95,
      marginPct: 30,
      lossReason: null,
    };

    const exposure: FinancesFT2Exposure = {
      context: {
        period: { from: '2025-01-01', to: '2025-01-31' },
        netObserved: 3000,
      },
      outcome: { status: 'positive' },
      trend: { direction: 'up' },
      dataCoverage: { completenessPct: 95 },
    };

    mockBuildFinancesFacts.mockResolvedValue(facts);
    mockBuildFinancesIntelligence.mockReturnValue(intelligence);
    mockBuildFinancesFtep.mockReturnValue(exposure);

    const result = await getFinancesFt2Snapshot({
      shopId: 1,
      period: { from: '2025-01-01', to: '2025-01-31' },
    });

    expect(buildFinancesFacts).toHaveBeenCalledWith({
      shopId: 1,
      period: { from: '2025-01-01', to: '2025-01-31' },
    });

    expect(buildFinancesIntelligence).toHaveBeenCalledWith(facts);
    expect(buildFinancesFtep).toHaveBeenCalledWith({
      facts,
      intelligence,
    });

    expect(result).toEqual(exposure);
  });
});
