//apps/backend/src/services/customers-facts/customersFacts.types.ts
export interface CustomersFacts {
  shopId: number;

  period: {
    from: string;
    to: string;
  };

  customersObserved: number | null;

  extractedAt: string;
}

export interface GetCustomersFactsInput {
  shopId: number;
  period: {
    from: string;
    to: string;
  };
}