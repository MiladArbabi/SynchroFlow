//apps/backend/src/services/customers-intelligence/customersIntelligence.types.ts
export interface CustomersIntelligence {
  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  };

  trend: {
    direction: 'unknown';
  };
}
