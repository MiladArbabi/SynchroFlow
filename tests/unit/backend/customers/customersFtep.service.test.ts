// tests/unit/backend/customers/customersFtep.service.test.ts
import { applyCustomersFtep } from 'api-src/services/customers-ftep/customersFtep.service';
import { CustomersFacts } from 'api-src/services/customers-facts';
import { CustomersIntelligence } from 'api-src/services/customers-intelligence';

describe('CustomersFTEP.service (FT2)', () => {
  const baseFacts: CustomersFacts = {
    shopId: 1,
    period: { from: '2024-01-01', to: '2024-01-07' },
    customersObserved: 3,
    extractedAt: new Date().toISOString()
  };

  it('exposes outcome and trend when intelligence is known', () => {
    const intelligence: CustomersIntelligence = {
      outcome: { status: 'positive' },
      trend: { direction: 'unknown' }
    };

    const exposure = applyCustomersFtep({ facts: baseFacts, intelligence });

    expect(exposure.context.customersObserved).toBe(3);
    expect(exposure.outcome?.status).toBe('positive');
    expect(exposure.trend?.direction).toBe('unknown');
  });

  it('returns null outcome and trend when intelligence is unknown', () => {
    const intelligence: CustomersIntelligence = {
      outcome: { status: 'unknown' },
      trend: { direction: 'unknown' }
    };

    const exposure = applyCustomersFtep({ facts: baseFacts, intelligence });

    expect(exposure.outcome).toBeNull();
    expect(exposure.trend).toBeNull();
  });

  it('never exposes timestamps or internal objects', () => {
    const intelligence: CustomersIntelligence = {
      outcome: { status: 'positive' },
      trend: { direction: 'unknown' }
    };

    const exposure = applyCustomersFtep({ facts: baseFacts, intelligence });

    const serialized = JSON.stringify(exposure);

    expect(serialized).not.toMatch(/extractedAt|facts|intelligence/i);
  });
});