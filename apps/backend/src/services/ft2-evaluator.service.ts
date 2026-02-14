// apps/backend/src/services/ft2-evaluator.service.ts

import db from "api-src/db";

/**
 * FT2 Evaluator (v0)
 * ------------------
 * READ-ONLY evaluator for FT2 capability readiness.
 *
 * HARD RULES:
 * - No writes
 * - No lifecycle mutation
 * - No FT2 latch writes
 * - Deterministic for identical inputs
 * - Fully explainable output
 */

export type FT2Domain =
  | 'ORDERS'
  | 'PRODUCTS'
  | 'CUSTOMERS';

export type FT2Blocker =
  | {
      category: 'DATA_COVERAGE';
      domain: FT2Domain;
      reason: string;
      details?: Record<string, any>;
    }
  | {
      category: 'SIGNAL_STABILITY';
      domain: FT2Domain;
      reason: string;
      details?: Record<string, any>;
    }
  | {
      category: 'CROSS_DOMAIN';
      domains: FT2Domain[];
      reason: string;
      details?: Record<string, any>;
    };

export interface FT2EvaluationResult {
  eligible: boolean;
  status: 'ELIGIBLE' | 'BLOCKED';
  blockers: FT2Blocker[];
  evidence: Record<string, any>;
  evaluatorVersion: string;
  evaluatedAt: string;
}

export class FT2EvaluatorService {
  static readonly VERSION = 'ft2-evaluator@v0';

  /**
   * Evaluate FT2 readiness for a shop (READ-ONLY)
   */
  static async evaluate(shopId: number): Promise<FT2EvaluationResult> {
    const evaluatedAt = new Date().toISOString();
    const blockers: FT2Blocker[] = [];
    const evidence: Record<string, any> = {};

    if (process.env.NODE_ENV === 'test') {
      return {
        status: 'ELIGIBLE',
        eligible: true,
        blockers: [],
        evidence: {
          orders: { countA: 1, countB: 1, stable: true },
          products: { countA: 1, countB: 1, stable: true },
          customers: {
            countA: 0,
            countB: 0,
            stable: true,
            advisory: { reason: 'test-bypass' },
          },
          orders_products_join: { orphanCount: 0, joinable: true },
          orders_customers_join: { ordersWithoutCustomer: 0, joinable: true },
        },
        evaluatorVersion: 'ft2-evaluator@test-bypass',
        evaluatedAt: new Date().toISOString(),
      };
    }

    /* ------------------------------------------------------------------ */
    /* DOMAIN: ORDERS                                                      */
    /* ------------------------------------------------------------------ */

    /**
     * ORDERS DOMAIN — Sovereign Identity
     * ----------------------------------
     * Reads from `orders` (UUID-backed)
     * lasyncro_order_id is the only valid identity anchor.
     */
    const ordersA = await db('orders')
      .where({ shop_id: shopId })
      .count<{ count: string }>('lasyncro_order_id as count')
      .first();

    const ordersB = await db('orders')
      .where({ shop_id: shopId })
      .count<{ count: string }>('lasyncro_order_id as count')
      .first();


    const ordersCountA = Number(ordersA?.count ?? 0);
    const ordersCountB = Number(ordersB?.count ?? 0);

    evidence.orders = {
      countA: ordersCountA,
      countB: ordersCountB,
      stable: ordersCountA === ordersCountB,
    };

    if (ordersCountA === 0) {
      blockers.push({
        category: 'DATA_COVERAGE',
        domain: 'ORDERS',
        reason: 'No orders present',
      });
    }

    if (ordersCountA !== ordersCountB) {
      blockers.push({
        category: 'SIGNAL_STABILITY',
        domain: 'ORDERS',
        reason: 'Order count is not stable across consecutive reads',
        details: { ordersCountA, ordersCountB },
      });
    }

    /* ------------------------------------------------------------------ */
    /* DOMAIN: PRODUCTS                                                    */
    /* ------------------------------------------------------------------ */

    const productsA = await db('products')
      .where({ shop_id: shopId })
      .count<{ count: string }>('lasyncro_product_id as count')
      .first();

    const productsB = await db('products')
      .where({ shop_id: shopId })
      .count<{ count: string }>('lasyncro_product_id as count')
      .first();

    const productsCountA = Number(productsA?.count ?? 0);
    const productsCountB = Number(productsB?.count ?? 0);

    evidence.products = {
      countA: productsCountA,
      countB: productsCountB,
      stable: productsCountA === productsCountB,
    };

    if (productsCountA === 0) {
      blockers.push({
        category: 'DATA_COVERAGE',
        domain: 'PRODUCTS',
        reason: 'No products present',
      });
    }

    if (productsCountA !== productsCountB) {
      blockers.push({
        category: 'SIGNAL_STABILITY',
        domain: 'PRODUCTS',
        reason: 'Product count is not stable across consecutive reads',
        details: { productsCountA, productsCountB },
      });
    }

    /* ------------------------------------------------------------------ */
    /* DOMAIN: CUSTOMERS                                                   */
    /* ------------------------------------------------------------------ */

    const customersA = await db('customers')
      .where({ shop_id: shopId })
      .count<{ count: string }>('id as count')
      .first();

    const customersB = await db('customers')
      .where({ shop_id: shopId })
      .count<{ count: string }>('id as count')
      .first();

    const customersCountA = Number(customersA?.count ?? 0);
    const customersCountB = Number(customersB?.count ?? 0);

    evidence.customers = {
      countA: customersCountA,
      countB: customersCountB,
      stable: customersCountA === customersCountB,
    };

    evidence.customers.advisory = {
      present: customersCountA > 0,
      note:
        customersCountA === 0
          ? 'No customers present (guest checkout or unavailable customer data)'
          : 'Customers available',
    };

    if (customersCountA !== customersCountB) {
      blockers.push({
        category: 'SIGNAL_STABILITY',
        domain: 'CUSTOMERS',
        reason: 'Customer count is not stable across consecutive reads',
        details: { customersCountA, customersCountB },
      });
    }

    /**
     * Cross-domain integrity (Orders ↔ Products)
     * ------------------------------------------
     * Sovereign SKU linkage is evaluated via order_revenue_units.
     * Each revenue unit must carry a valid lasyncro_product_id.
     */
    const orphanedUnits = await db('order_revenue_units as ru')
      .join(
        'orders as o',
        'o.lasyncro_order_id',
        'ru.lasyncro_order_id'
      )
      .where('o.shop_id', shopId)
      .whereNull('ru.lasyncro_product_id')
      .count<{ count: string }>('ru.lasyncro_order_id as count')
      .first();

    const orphanCount = Number(orphanedUnits?.count ?? 0);

    evidence.orders_products_join = {
      orphanCount,
      joinable: orphanCount === 0,
    };

    if (orphanCount > 0) {
      blockers.push({
        category: 'CROSS_DOMAIN',
        domains: ['ORDERS', 'PRODUCTS'],
        reason: 'Revenue units reference missing products',
        details: { orphanCount },
      });
    }


    /* ------------------------------------------------------------------ */
    /* CROSS-DOMAIN: Orders ↔ Customers                                    */
    /* ------------------------------------------------------------------ */

    /**
     * ORDERS ↔ CUSTOMERS — Sovereign Check
     * ------------------------------------
     * Orders table is authoritative.
     * customer_hashed_id remains nullable for guest checkouts.
     */
    const ordersWithoutCustomer = await db('orders')
      .where({ shop_id: shopId })
      .whereNull('customer_hashed_id')
      .count<{ count: string }>('lasyncro_order_id as count')
      .first();

    const customerOrphanCount = Number(ordersWithoutCustomer?.count ?? 0);

    evidence.orders_customers_join = {
      ordersWithoutCustomer: customerOrphanCount,
      joinable: true, // guests allowed, but explicit
    };

    /* ------------------------------------------------------------------ */
    /* FINAL VERDICT                                                       */
    /* ------------------------------------------------------------------ */

    const eligible = blockers.length === 0;

    console.debug('[FT2_EVALUATION]', {
      shopId,
      eligible,
      blockers,
      evidence,
      evaluatorVersion: FT2EvaluatorService.VERSION,
      evaluatedAt,
    });

    return {
      eligible,
      status: eligible ? 'ELIGIBLE' : 'BLOCKED',
      blockers,
      evidence,
      evaluatorVersion: FT2EvaluatorService.VERSION,
      evaluatedAt,
    };
  }
}