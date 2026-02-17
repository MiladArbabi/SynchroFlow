//apps/backend/src/services/customers-facts/customersFacts.service.ts
import db from '@lasyncro/backend-core/db.js';
import {
  CustomersFacts,
  GetCustomersFactsInput
} from './customersFacts.types.js';

/**
 * Customers Facts (FT2)
 * --------------------
 * Deterministic extraction of customer existence facts.
 *
 * HARD RULES:
 * - Read-only
 * - Period enforced server-side
 * - Null represents epistemic absence
 * - No semantics, no metrics, no inference
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

/**
 * Domain 1 — Identity Presence Reality
 * Domain 2 — Activity Presence Reality
 *
 * FT2 constraint:
 * Customer creation is the sole activity proxy.
 *
 * This is an explicit modeling decision,
 * not a behavioral claim.
 */
  return {
    shopId, 
    period,

    customersObserved:
      Number.isFinite(count) ? count : null,

    activityObserved:
      Number.isFinite(count)
        ? count > 0
        : null,

    extractedAt: new Date().toISOString()
  };

}