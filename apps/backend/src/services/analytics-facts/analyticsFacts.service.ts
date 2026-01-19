// apps/backend/src/services/analytics-facts/analyticsFacts.service.ts
import { AnalyticsFacts } from './analyticsFacts.types';
import { OrderFactsPeriod } from '../order-facts/orderFacts.types';

import { getOrderNexusFt2Snapshot } from '../order-nexus-ft2/orderNexusFt2.resolver';
import { getProductsFt2Snapshot } from '../products-ft2.provider';
import { getCustomersFt2Snapshot } from '../customers-ft2.provider';
import { getFinancesFt2Snapshot } from '../finances-ft2.provider';

/**
 * GetAnalyticsFactsInput
 *
 * Analytics Facts input.
 *
 * NOTE:
 * - Analytics does NOT own time.
 * - Date range is applied upstream (caller / lifecycle layer).
 * - Facts operate on the already-scoped dataset.
 */
interface GetAnalyticsFactsInput {
  shopId: number;

  // Analytics does NOT own time.
  // Period is resolved upstream (lifecycle / controller layer)
  // and must be forwarded unchanged.
  period: OrderFactsPeriod;
}

function generateSnapshotId(shopId: number) {
  return `${shopId}-${Date.now()}`;
}

/**
 * getAnalyticsFacts
 *
 * Layer 1 — Analytics Observability Aggregator
 *
 * CRITICAL GUARANTEES:
 * - NO database access
 * - NO interpretation
 * - NO cross-domain inference
 * - FT2 is the ONLY source of truth
 *
 * Analytics observes observability.
 * It does not create it.
 */
export async function getAnalyticsFacts(
  input: GetAnalyticsFactsInput
): Promise<AnalyticsFacts> {
  const { shopId, period } = input;

  const snapshotId = generateSnapshotId(shopId);
  const extractedAt = new Date().toISOString();

  // ─────────────────────────────────────────────
  // Orders — sourced from Orders FT2
  // ─────────────────────────────────────────────
  const ordersFt2 = await getOrderNexusFt2Snapshot({
    shopId,
    period,
  });

  const ordersObserved =
    ordersFt2.context?.ordersObserved ?? null;

  const ordersPresence =
    ordersObserved === null
      ? null
      : ordersObserved > 0;

  // ─────────────────────────────────────────────
  // Products — sourced from Products FT2
  // ─────────────────────────────────────────────
  const productsFt2 = await getProductsFt2Snapshot({
    shopId,
    period,
  });

  const productsObserved =
    productsFt2.context?.productsObserved ?? null;

  const productsPresence =
    productsObserved === null
      ? null
      : productsObserved > 0;

  // ─────────────────────────────────────────────
  // Customers — sourced from Customers FT2
  // ─────────────────────────────────────────────
  const customersFt2 = await getCustomersFt2Snapshot({
    shopId,
    period,
  });

  const customersObserved =
    customersFt2.context?.customersObserved ?? null;

  const customersPresence =
    customersObserved === null
      ? null
      : customersObserved > 0;

  // ─────────────────────────────────────────────
  // Finances — sourced from Finances FT2
  // Presence-only observability
  // ─────────────────────────────────────────────
  const financesFt2 = await getFinancesFt2Snapshot({
    shopId,
    period,
  });

  const financesObserved =
    financesFt2.context?.revenueObserved ?? null;

  const financesPresence =
    financesObserved === null
      ? null
      : financesObserved > 0;

  return {
    shopId,
    snapshotId,
    extractedAt,

    domains: {
      orders: {
        presence: ordersPresence,
        observationCount: ordersObserved,
        nullSurface: ordersPresence === null ? 1 : 0,
        firstSeenAt: null,
        lastSeenAt: null,
      },

      products: {
        presence: productsPresence,
        observationCount: productsObserved,
        nullSurface: productsPresence === null ? 1 : 0,
        firstSeenAt: null,
        lastSeenAt: null,
      },

      customers: {
        presence: customersPresence,
        observationCount: customersObserved,
        nullSurface: customersPresence === null ? 1 : 0,
        firstSeenAt: null,
        lastSeenAt: null,
      },

      finances: {
        presence: financesPresence,
        observationCount: financesObserved,
        nullSurface: financesPresence === null ? 1 : 0,
        firstSeenAt: null,
        lastSeenAt: null,
      },
    },
  };
}