import { applyCustomersFtep } from 'api-src/services/customers-ftep/customersFtep.service';
import { CustomersFacts } from 'api-src/services/customers-facts';
import { CustomersIntelligence } from 'api-src/services/customers-intelligence';

describe('Customers FTEP — CTR exposure invariants', () => {
  const baseFacts: CustomersFacts = {
    shopId: 1,
    period: { from: '2024-01-01', to: '2024-01-31' },
    customersObserved: null,
    extractedAt: 'now',
  };

  test('CTR-1: customersObserved null → outcome and trend are null', () => {
    const intelligence: CustomersIntelligence = {
      outcome: { status: 'positive' },
      trend: { direction: 'unknown' },
    };

    const result = applyCustomersFtep({
      facts: baseFacts,
      intelligence,
    });

    expect(result.context.customersObserved).toBeNull();
    expect(result.outcome).toBeNull();
    expect(result.trend).toBeNull();
  });

  test('CTR-1: outcome status unknown → outcome and trend are null', () => {
    const facts: CustomersFacts = {
      ...baseFacts,
      customersObserved: 10,
    };

    const intelligence: CustomersIntelligence = {
      outcome: { status: 'unknown' },
      trend: { direction: 'unknown' },
    };

    const result = applyCustomersFtep({
      facts,
      intelligence,
    });

    expect(result.context.customersObserved).toBeNull();
    expect(result.outcome).toBeNull();
    expect(result.trend).toBeNull();
  });

  test('CTR-2: customersObserved present and status known → outcome and trend exposed', () => {
    const facts: CustomersFacts = {
      ...baseFacts,
      customersObserved: 5,
    };

    const intelligence: CustomersIntelligence = {
      outcome: { status: 'positive' },
      trend: { direction: 'unknown' },
    };

    const result = applyCustomersFtep({
      facts,
      intelligence,
    });

    expect(result.context.customersObserved).toBe(5);
    expect(result.outcome).toEqual({ status: 'positive' });
    expect(result.trend).toEqual({ direction: 'unknown' });
  });
});