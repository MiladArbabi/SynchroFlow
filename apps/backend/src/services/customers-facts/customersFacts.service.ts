//apps/backend/src/services/customers-facts/customersFacts.service.ts
import db from 'api-db';
import {
  CustomersFacts,
  GetCustomersFactsInput
} from './customersFacts.types';

/**
 * Customers Facts (FT2)
 * --------------------
 * Raw, interpretation-free extraction of customer existence.
 *
 * Rules:
 * - Read-only
 * - Period enforced server-side
 * - Null is first-class
 * - No semantics, no metrics
 */
export async function getCustomersFacts(
  input: GetCustomersFactsInput
): Promise<CustomersFacts> {
  const { shopId, period } = input;

  const fromTs = new Date(period.from);
  const toTs = new Date(period.to);

  const rows = await db('customers')
    .where('shop_id', shopId)
    .andWhere('created_at', '>=', fromTs)
    .andWhere('created_at', '<=', toTs)
    .count<{ count: string }[]>({ count: '*' });

  const count = Number(rows?.[0]?.count ?? 0);

  return {
    shopId,
    period,
    customersObserved: count > 0 ? count : null,
    extractedAt: new Date().toISOString()
  };
}