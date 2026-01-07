// tests/unit/backend/customers/customersFt2.provider.test.ts
import { getCustomersFt2Snapshot } from 'api-src/services/customers-ft2.provider';

jest.mock('api-src/services/customers-facts', () => ({
  getCustomersFacts: jest.fn().mockResolvedValue({
    shopId: 1,
    period: { from: '2024-01-01', to: '2024-01-07' },
    customersObserved: 2,
    extractedAt: '2024-01-08T00:00:00.000Z'
  })
}));

jest.mock('api-src/services/customers-intelligence', () => ({
  deriveCustomersIntelligence: jest.fn().mockReturnValue({
    outcome: { status: 'positive' },
    trend: { direction: 'unknown' }
  })
}));

jest.mock('api-src/services/customers-ftep', () => ({
  applyCustomersFtep: jest.fn().mockReturnValue({
    context: {
      period: { from: '2024-01-01', to: '2024-01-07' },
      customersObserved: 2
    },
    outcome: { status: 'positive' },
    trend: { direction: 'unknown' }
  })
}));

describe('Customers FT2 Provider', () => {
  it('orchestrates Facts → Intelligence → FTEP and returns exposure', async () => {
    const snapshot = await getCustomersFt2Snapshot({
      shopId: 1,
      period: { from: '2024-01-01', to: '2024-01-07' }
    });

    expect(snapshot.context.customersObserved).toBe(2);
    expect(snapshot.outcome?.status).toBe('positive');
  });
});