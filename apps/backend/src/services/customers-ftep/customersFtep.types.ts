//apps/backend/src/services/customers-ftep/customersFtep.types.ts
export interface CustomersFT2Exposure {
  context: {
    period: {
      from: string;
      to: string;
    };
    customersObserved: number | null;
  };

  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  } | null;

  trend: {
    direction: 'unknown';
  } | null;
}