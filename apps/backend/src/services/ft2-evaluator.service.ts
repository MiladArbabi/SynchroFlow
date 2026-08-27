// apps/backend/src/services/ft2-evaluator.service.ts

import db from '@lasyncro/backend-core/db.js';
import { Knex } from 'knex';

/**
 * FT2 Evaluator (v1)
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

type IntegrationRow = {
  sync_status: string | null;
  sync_last_error: string | null;
} | null;

type SyncGuardResult = {
  blocked: FT2EvaluationResult | null;
  integration: IntegrationRow;
};

/**
 * PURE BLOCKER-CLASSIFICATION FACTS (SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02,
 * Slice 2 correction)
 * ---------------------------------------------------------------------
 * Every already-read fact `classifyBlockers` needs. No DB access, no
 * timestamps, no I/O of any kind — deterministic in, deterministic out.
 */
export interface FT2ClassificationFacts {
  authoritativeSync: boolean;
  ordersCountA: number;
  ordersCountB: number;
  productsCountA: number;
  productsCountB: number;
  customersCountA: number;
  customersCountB: number;
  orphanCount: number;
  customerOrphanCount: number;
}

export interface FT2ClassificationResult {
  blockers: FT2Blocker[];
  evidence: Record<string, any>;
}

export class FT2EvaluatorService {
  /**
   * SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02, Slice 2: bumped from v0. The
   * ORDERS/PRODUCTS DATA_COVERAGE presence blockers now suppress for a
   * legitimately empty, authoritatively-completed store — a real,
   * observable change to which inputs produce ELIGIBLE vs BLOCKED, not a
   * cosmetic one. evaluatorVersion is logged and forwarded into
   * lifecycle.controller.ts's audit payload specifically so a verdict can
   * be traced back to the semantics that produced it; a version bump is
   * the intended use of this field for exactly this class of change. No
   * code depends on the literal string value (confirmed by search — the
   * only other reader is that audit forward, and the `ft2.confirm.*`
   * legacy tests mock the whole service with their own unrelated version
   * strings).
   */
  static readonly VERSION = 'ft2-evaluator@v1';

  /**
   * Evaluate FT2 readiness for a shop (READ-ONLY)
   *
   * Public wrapper — preserves the exact production contract. The SYNC
   * GUARD is checked unconditionally, in every environment, before any
   * NODE_ENV branch — this was true before this refactor and remains
   * true: a test-mode caller with no completed integration still gets a
   * real BLOCKED/SYNC_IN_PROGRESS result, never the synthetic bypass.
   */
  static async evaluate(shopId: number): Promise<FT2EvaluationResult> {
    if (process.env.NODE_ENV === 'test') {
      const syncGuard = await db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);
        return FT2EvaluatorService.checkSyncGuard(
          trx,
          shopId,
          new Date().toISOString()
        );
      });

      if (syncGuard.blocked) {
        return syncGuard.blocked;
      }

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

    return FT2EvaluatorService.evaluateReal(shopId);
  }

  /**
   * ENVIRONMENT-INDEPENDENT REAL EVALUATOR SEAM (Slice 2)
   * -------------------------------------------------------
   * Never reads NODE_ENV. Runs the full production evaluation body — sync
   * guard, readiness gate, domain checks, cross-domain integrity,
   * presence-suppression rules — exactly as `evaluate()` does for a
   * non-test caller, because `evaluate()` delegates to this same function
   * for that case. This is what backend-integration tests call directly
   * to certify the real evaluator without ever mutating process.env.
   */
  static async evaluateReal(shopId: number): Promise<FT2EvaluationResult> {
    return db.transaction(async (trx) => {
      // SET LOCAL tenant context once for all queries in this evaluation.
      // All tables queried here (orders, products, customers, system_readiness_state)
      // have strict RLS enforced via app.current_tenant.
      await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);
      const evaluatedAt = new Date().toISOString();

      // -----------------------------------------------------------------
      // SYNC GUARD — FT2 cannot be evaluated during active sync
      // -----------------------------------------------------------------
      const syncGuard = await FT2EvaluatorService.checkSyncGuard(
        trx,
        shopId,
        evaluatedAt
      );

      if (syncGuard.blocked) {
        return syncGuard.blocked;
      }

      const integration = syncGuard.integration!;

      /**
       * LEGITIMATE-EMPTY DISCRIMINATOR (Slice 2)
       * -----------------------------------------
       * Authoritative == the main/real Shopify sync path (which clears
       * sync_last_error to null on every completion — see
       * shopifyIntegrationStatus.service.ts). The PCD-restricted fallback
       * path writes sync_status='COMPLETED' with a non-null
       * sync_last_error and structurally never satisfies this — "we
       * could not read orders" must never be reclassified as "the
       * merchant genuinely has no orders."
       */
      const authoritativeSync = (integration.sync_last_error ?? null) === null;

      /**
       * HARD GATE — System Readiness
       *
       * FT2 eligibility requires durable system readiness.
       *
       * Presence in system_readiness_state = READY
       * Absence = UNREADY
       *
       * Evaluator must not depend on legacy ft0_state.
       */
      const readiness = await db.transaction(async (trx2) => {
        await trx2.raw(`SET LOCAL app.current_tenant = '${shopId}'`);
        return trx2('system_readiness_state')
          .where({ shop_id: shopId })
          .first();
      });

      if (!readiness) {
        return {
          eligible: false,
          status: 'BLOCKED',
          blockers: [
            {
              category: 'DATA_COVERAGE',
              domain: 'ORDERS',
              reason: 'SYSTEM_NOT_READY',
            },
          ],
          evidence: {
            readiness: 'absent',
          },
          evaluatorVersion: FT2EvaluatorService.VERSION,
          evaluatedAt,
        };
      }

      /* ---------------------------------------------------------------- */
      /* DOMAIN READS — ORDERS, PRODUCTS, CUSTOMERS, CROSS-DOMAIN          */
      /* ---------------------------------------------------------------- */

      /**
       * ORDERS DOMAIN — Sovereign Identity
       * ----------------------------------
       * Reads from `orders` (UUID-backed)
       * lasyncro_order_id is the only valid identity anchor.
       */
      const ordersA = await trx('orders')
        .where({ shop_id: shopId })
        .count<{ count: string }>('lasyncro_order_id as count')
        .first();

      const ordersB = await trx('orders')
        .where({ shop_id: shopId })
        .count<{ count: string }>('lasyncro_order_id as count')
        .first();

      const ordersCountA = Number(ordersA?.count ?? 0);
      const ordersCountB = Number(ordersB?.count ?? 0);

      const productsA = await trx('products')
        .where({ shop_id: shopId })
        .count<{ count: string }>('lasyncro_product_id as count')
        .first();

      const productsB = await trx('products')
        .where({ shop_id: shopId })
        .count<{ count: string }>('lasyncro_product_id as count')
        .first();

      const productsCountA = Number(productsA?.count ?? 0);
      const productsCountB = Number(productsB?.count ?? 0);

      const customersA = await trx('customers')
        .where({ shop_id: shopId })
        .count<{ count: string }>('id as count')
        .first();

      const customersB = await trx('customers')
        .where({ shop_id: shopId })
        .count<{ count: string }>('id as count')
        .first();

      const customersCountA = Number(customersA?.count ?? 0);
      const customersCountB = Number(customersB?.count ?? 0);

      /**
       * Cross-domain integrity (Orders ↔ Products)
       * ------------------------------------------
       * Sovereign SKU linkage is evaluated via order_revenue_units.
       * Each revenue unit must carry a valid lasyncro_product_id.
       *
       * FT2-CROSS-DOMAIN-DEAD-CHECK-06 (parked, not addressed here):
       * order_revenue_units.lasyncro_product_id is NOT NULL with a FK to
       * products ON DELETE RESTRICT — the schema structurally forbids the
       * null-orphan shape this query looks for, so orphanCount is
       * expected to be 0 for any row the current schema can persist. See
       * ft2-evaluator-real.test.ts's F1-F3 for the proof. Left unchanged
       * per this slice's explicit scope.
       */
      const orphanedUnits = await trx('order_revenue_units as ru')
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

      /**
       * ORDERS ↔ CUSTOMERS — Sovereign Check
       * ------------------------------------
       * Orders table is authoritative.
       * customer_hashed_id remains nullable for guest checkouts.
       */
      const ordersWithoutCustomer = await trx('orders')
        .where({ shop_id: shopId })
        .whereNull('customer_hashed_id')
        .count<{ count: string }>('lasyncro_order_id as count')
        .first();

      const customerOrphanCount = Number(ordersWithoutCustomer?.count ?? 0);

      /* ---------------------------------------------------------------- */
      /* CLASSIFICATION — single pure implementation, also used directly  */
      /* by ft2-evaluator-real.test.ts's deterministic stability cases    */
      /* ---------------------------------------------------------------- */
      const classification = FT2EvaluatorService.classifyBlockers({
        authoritativeSync,
        ordersCountA,
        ordersCountB,
        productsCountA,
        productsCountB,
        customersCountA,
        customersCountB,
        orphanCount,
        customerOrphanCount,
      });

      const eligible = classification.blockers.length === 0;

      console.debug('[FT2_EVALUATION]', {
        shopId,
        eligible,
        blockers: classification.blockers,
        evidence: classification.evidence,
        evaluatorVersion: FT2EvaluatorService.VERSION,
        evaluatedAt,
      });

      return {
        eligible,
        status: eligible ? 'ELIGIBLE' : 'BLOCKED',
        blockers: classification.blockers,
        evidence: classification.evidence,
        evaluatorVersion: FT2EvaluatorService.VERSION,
        evaluatedAt,
      };
    });
  }

  /**
   * PURE BLOCKER CLASSIFICATION (SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02,
   * Slice 2 correction)
   * ---------------------------------------------------------------------
   * No DB access, no I/O, no timestamps — takes already-read facts and
   * returns the DATA_COVERAGE/SIGNAL_STABILITY/CROSS_DOMAIN blockers plus
   * the explanatory evidence, deterministically. `evaluateReal()` above
   * is the ONLY caller in production; ft2-evaluator-real.test.ts's
   * deterministic SIGNAL_STABILITY cases call this exact function
   * directly with hand-constructed disagreeing counts — there is no
   * second, test-only recreation of this logic.
   */
  static classifyBlockers(facts: FT2ClassificationFacts): FT2ClassificationResult {
    const {
      authoritativeSync,
      ordersCountA,
      ordersCountB,
      productsCountA,
      productsCountB,
      customersCountA,
      customersCountB,
      orphanCount,
      customerOrphanCount,
    } = facts;

    const blockers: FT2Blocker[] = [];
    const evidence: Record<string, any> = { authoritativeSync };

    /* ---------------------------------------------------------------- */
    /* DOMAIN: ORDERS                                                    */
    /* ---------------------------------------------------------------- */

    /**
     * ORDERS presence suppression (Slice 2)
     * ---------------------------------------
     * Suppress "No orders present" iff ALL hold: authoritative sync,
     * AND both consecutive reads agree the count is zero. The stability
     * check below is unaffected — it fires independently on ANY
     * disagreement between ordersCountA/B, suppressed or not.
     */
    const ordersLegitimatelyEmpty =
      authoritativeSync && ordersCountA === 0 && ordersCountB === 0;

    evidence.orders = {
      countA: ordersCountA,
      countB: ordersCountB,
      stable: ordersCountA === ordersCountB,
      legitimatelyEmpty: ordersLegitimatelyEmpty,
    };

    if (ordersCountA === 0 && !ordersLegitimatelyEmpty) {
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

    /* ---------------------------------------------------------------- */
    /* DOMAIN: PRODUCTS                                                  */
    /* ---------------------------------------------------------------- */

    /**
     * PRODUCTS presence suppression (Slice 2)
     * ------------------------------------------
     * Suppress "No products present" iff ALL hold: authoritative sync,
     * both product-count reads agree zero, AND both order-count reads
     * ALSO agree zero. A store with orders but zero products is
     * incomplete/invalid data, never legitimate absence — this
     * additional orders===0 condition is what keeps that case blocked
     * (CASE D). The stability check below is unaffected either way.
     */
    const productsLegitimatelyEmpty =
      authoritativeSync &&
      productsCountA === 0 &&
      productsCountB === 0 &&
      ordersCountA === 0 &&
      ordersCountB === 0;

    evidence.products = {
      countA: productsCountA,
      countB: productsCountB,
      stable: productsCountA === productsCountB,
      legitimatelyEmpty: productsLegitimatelyEmpty,
    };

    if (productsCountA === 0 && !productsLegitimatelyEmpty) {
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

    /* ---------------------------------------------------------------- */
    /* DOMAIN: CUSTOMERS                                                 */
    /* ---------------------------------------------------------------- */

    evidence.customers = {
      countA: customersCountA,
      countB: customersCountB,
      stable: customersCountA === customersCountB,
      advisory: {
        present: customersCountA > 0,
        note:
          customersCountA === 0
            ? 'No customers present (guest checkout or unavailable customer data)'
            : 'Customers available',
      },
    };

    if (customersCountA !== customersCountB) {
      blockers.push({
        category: 'SIGNAL_STABILITY',
        domain: 'CUSTOMERS',
        reason: 'Customer count is not stable across consecutive reads',
        details: { customersCountA, customersCountB },
      });
    }

    /* ---------------------------------------------------------------- */
    /* CROSS-DOMAIN                                                      */
    /* ---------------------------------------------------------------- */

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

    evidence.orders_customers_join = {
      ordersWithoutCustomer: customerOrphanCount,
      joinable: true, // guests allowed, but explicit
    };

    return { blockers, evidence };
  }

  /**
   * SYNC GUARD (shared)
   * --------------------
   * Extracted so `evaluate()`'s test-bypass path and `evaluateReal()` both
   * enforce the identical, unconditional check without duplicating the
   * query/verdict logic. Returns `{ blocked: <result> }` when the guard
   * fails, or `{ blocked: null, integration }` when it passes — callers
   * that pass use `integration` (guaranteed non-null) for the
   * legitimate-empty discriminator without a second query.
   */
  private static async checkSyncGuard(
    trx: Knex.Transaction,
    shopId: number,
    evaluatedAt: string
  ): Promise<SyncGuardResult> {
    const integration = await trx('integrations')
      .where({ shop_id: shopId })
      .first();

    if (!integration || integration.sync_status !== 'COMPLETED') {
      return {
        blocked: {
          eligible: false,
          status: 'BLOCKED',
          blockers: [
            {
              category: 'DATA_COVERAGE',
              domain: 'ORDERS',
              reason: 'SYNC_IN_PROGRESS',
            },
          ],
          evidence: {
            syncStatus: integration?.sync_status ?? 'NOT_INITIALIZED',
          },
          evaluatorVersion: FT2EvaluatorService.VERSION,
          evaluatedAt,
        },
        integration: integration ?? null,
      };
    }

    return { blocked: null, integration };
  }
}
