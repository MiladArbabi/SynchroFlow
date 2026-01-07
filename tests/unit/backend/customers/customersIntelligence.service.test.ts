// tests/unit/backend/customers/customersIntelligence.service.test.ts
import { deriveCustomersIntelligence } from 'api-src/services/customers-intelligence/customersIntelligence.service';
import { CustomersFacts } from 'api-src/services/customers-facts';

describe('CustomersIntelligence.service (FT2)', () => {
  it('returns unknown when facts are missing', () => {
    const intelligence = deriveCustomersIntelligence({
      shopId: 1,
      period: { from: '2024-01-01', to: '2024-01-07' },
      customersObserved: null,
      extractedAt: new Date().toISOString()
    });

    expect(intelligence.outcome.status).toBe('unknown');
  });

  it('returns positive when customersObserved > 0', () => {
    const intelligence = deriveCustomersIntelligence({
      shopId: 1,
      period: { from: '2024-01-01', to: '2024-01-07' },
      customersObserved: 3,
      extractedAt: new Date().toISOString()
    });

    expect(intelligence.outcome.status).toBe('positive');
  });

  it('returns negative when customersObserved === 0', () => {
    const intelligence = deriveCustomersIntelligence({
      shopId: 1,
      period: { from: '2024-01-01', to: '2024-01-07' },
      customersObserved: 0,
      extractedAt: new Date().toISOString()
    });

    expect(intelligence.outcome.status).toBe('negative');
  });

  it('always returns unknown trend in FT2 Customers', () => {
    const intelligence = deriveCustomersIntelligence({
      shopId: 1,
      period: { from: '2024-01-01', to: '2024-01-07' },
      customersObserved: 5,
      extractedAt: new Date().toISOString()
    });

    expect(intelligence.trend.direction).toBe('unknown');
  });
});