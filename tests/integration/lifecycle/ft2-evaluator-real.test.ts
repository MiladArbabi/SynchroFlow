/**
 * SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02, Slice 2.
 *
 * Certifies the REAL, non-bypassed FT2EvaluatorService body — the six
 * blockers, the sync guard, the readiness gate, and the new presence-
 * suppression rules for a legitimately empty, authoritatively-completed
 * store. Calls FT2EvaluatorService.evaluateReal(shopId) directly, the
 * environment-independent seam extracted in this slice — no NODE_ENV
 * mutation anywhere in this permanent file.
 *
 * Isolated fixture shops throughout — no dev_seed, no shared shop_id=1,
 * no ambient DB. Uses the disposable backend-integration harness, the
 * same real HMAC install pattern as fresh-install-release-path.test.ts.
 *
 * CASE E (unstable populated counts) calls FT2EvaluatorService
 * .classifyBlockers(facts) directly — the pure classification function
 * evaluateReal() itself calls after doing its DB reads (see the file
 * header comment on classifyBlockers in ft2-evaluator.service.ts). This
 * is the SAME implementation, not a test-only recreation: hand-
 * constructing disagreeing counts is possible because the function takes
 * already-read facts, with no DB access and no timing dependency.
 *
 * CASE F was rewritten as a structural-invariant regression (F1-F3)
 * against the real disposable Postgres DB, proving the schema itself
 * forbids the orphan shape the evaluator's whereNull check looks for —
 * see FT2-CROSS-DOMAIN-DEAD-CHECK-06 (parked, not fixed here).
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import { FT2EvaluatorService } from 'api-src/services/ft2-evaluator.service';

const app = createApp();

async function installFreshShop(shopDomain: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { shop: shopDomain, timestamp };
  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key as keyof typeof params]}`)
    .join('&');
  const hmac = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(message)
    .digest('hex');

  const install = await request(app)
    .get('/api/v1/integrations/shopify/install')
    .query({ ...params, hmac })
    .redirects(0);

  expect(install.status).toBe(302);

  const ghostEmail = `shopify-install+${shopDomain}@lasyncro.internal`;
  const ghostLookup = await systemQuery(
    db.raw('SELECT public.resolve_auth_user_by_email(?) AS value', [ghostEmail])
  );
  const ghostUser = ghostLookup.rows?.[0]?.value;
  expect(ghostUser).toBeTruthy();

  return { shopId: ghostUser.shop_id as number };
}

/** Authoritative main-path completion — sync_last_error explicitly null,
 *  matching exactly what shopifyIntegrationStatus.service.ts writes. */
async function seedAuthoritativeIntegration(shopId: number, shopDomain: string) {
  await withTenant(shopId, (trx) =>
    trx('integrations').insert({
      shop_id: shopId,
      platform: 'shopify',
      platform_shop_name: shopDomain,
      sync_status: 'COMPLETED',
      sync_last_error: null,
      updated_at: new Date(),
    })
  );
}

/** PCD-fallback-shaped completion — mirrors shopify-fallback.service.ts's
 *  own direct write exactly. */
async function seedPcdFallbackIntegration(shopId: number, shopDomain: string) {
  await withTenant(shopId, (trx) =>
    trx('integrations').insert({
      shop_id: shopId,
      platform: 'shopify',
      platform_shop_name: shopDomain,
      sync_status: 'COMPLETED',
      sync_last_error: 'PCD access required for orders and customers',
      updated_at: new Date(),
    })
  );
}

async function seedReadiness(shopId: number) {
  await withTenant(shopId, (trx) =>
    trx('system_readiness_state').insert({
      shop_id: shopId,
      became_ready_at: new Date(),
    })
  );
}

async function seedProduct(shopId: number) {
  const lasyncroProductId = crypto.randomUUID();
  await withTenant(shopId, (trx) =>
    trx('products').insert({
      lasyncro_product_id: lasyncroProductId,
      shop_id: shopId,
      title: 'Test Product',
    })
  );
  return lasyncroProductId;
}

/** order_revenue_units.lasyncro_variant_id is NOT NULL with its own FK to
 *  variants — F1/F2/F3 need a valid variant so the ONLY constraint under
 *  test is the product-identity one. */
async function seedVariant(shopId: number, lasyncroProductId: string) {
  const lasyncroVariantId = crypto.randomUUID();
  await withTenant(shopId, (trx) =>
    trx('variants').insert({
      lasyncro_variant_id: lasyncroVariantId,
      lasyncro_product_id: lasyncroProductId,
      shop_id: shopId,
      title: 'Test Variant',
      unit_cost: 5,
    })
  );
  return lasyncroVariantId;
}

/** Raw orders insert — the evaluator only ever reads counts, so a raw row
 *  is a faithful, minimal fixture for "orders exist" without needing the
 *  full ingestion pipeline. */
async function seedOrder(shopId: number, opts: { customerHashedId?: string | null } = {}) {
  const lasyncroOrderId = crypto.randomUUID();
  const now = new Date();
  await withTenant(shopId, (trx) =>
    trx('orders').insert({
      lasyncro_order_id: lasyncroOrderId,
      shop_id: shopId,
      currency: 'USD',
      total_price: 10,
      subtotal_price: 10,
      total_tax: 0,
      order_created_at: now,
      order_updated_at: now,
      payment_state: 'unpaid',
      aggregate_version: 1,
      customer_hashed_id: opts.customerHashedId ?? null,
      created_at: now,
      updated_at: now,
    })
  );
  return lasyncroOrderId;
}

describe('SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02 — real FT2 evaluator', () => {
  beforeAll(() => {
    process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
    process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  });

  it('CASE A/G — fully empty authoritative store is legitimately empty and eligible (consolidated: explicit authoritative-zero-data framing folded in as evidence assertions rather than a duplicate fixture)', async () => {
    const shopDomain = `evaluator-empty-${Date.now()}.myshopify.com`;
    const { shopId } = await installFreshShop(shopDomain);
    await seedAuthoritativeIntegration(shopId, shopDomain);
    await seedReadiness(shopId);

    const result = await FT2EvaluatorService.evaluateReal(shopId);

    expect(result.eligible).toBe(true);
    expect(result.status).toBe('ELIGIBLE');
    expect(
      result.blockers.some((b) => b.category === 'DATA_COVERAGE' && b.domain === 'ORDERS')
    ).toBe(false);
    expect(
      result.blockers.some((b) => b.category === 'DATA_COVERAGE' && b.domain === 'PRODUCTS')
    ).toBe(false);
    expect(result.evidence.customers.advisory.present).toBe(false);
    expect(
      result.blockers.some((b) => b.category === 'SIGNAL_STABILITY')
    ).toBe(false);
    expect(result.evidence.orders_products_join.orphanCount).toBe(0);

    // CASE G's distinct signal: the reasoning trail, not just the outcome —
    // proves the authoritative/legitimate-empty discriminator was actually
    // exercised, not merely that the final verdict happened to be eligible.
    expect(result.evidence.authoritativeSync).toBe(true);
    expect(result.evidence.orders.legitimatelyEmpty).toBe(true);
    expect(result.evidence.products.legitimatelyEmpty).toBe(true);
  });

  it('CASE B — products exist, zero orders: orders blocker suppressed, products blocker never fires', async () => {
    const shopDomain = `evaluator-products-only-${Date.now()}.myshopify.com`;
    const { shopId } = await installFreshShop(shopDomain);
    await seedAuthoritativeIntegration(shopId, shopDomain);
    await seedReadiness(shopId);
    await seedProduct(shopId);

    const result = await FT2EvaluatorService.evaluateReal(shopId);

    expect(result.eligible).toBe(true);
    expect(
      result.blockers.some((b) => b.category === 'DATA_COVERAGE' && b.domain === 'ORDERS')
    ).toBe(false);
    expect(
      result.blockers.some((b) => b.category === 'DATA_COVERAGE' && b.domain === 'PRODUCTS')
    ).toBe(false);
    expect(result.evidence.orders.legitimatelyEmpty).toBe(true);
  });

  it('CASE C — populated valid store: existing behavior unaffected by suppression rules', async () => {
    const shopDomain = `evaluator-populated-${Date.now()}.myshopify.com`;
    const { shopId } = await installFreshShop(shopDomain);
    await seedAuthoritativeIntegration(shopId, shopDomain);
    await seedReadiness(shopId);
    await seedProduct(shopId);
    await seedOrder(shopId, { customerHashedId: 'hashed-customer-1' });

    const result = await FT2EvaluatorService.evaluateReal(shopId);

    expect(result.eligible).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.evidence.orders.legitimatelyEmpty).toBe(false);
    expect(result.evidence.products.legitimatelyEmpty).toBe(false);
  });

  it('CASE D — orders exist, products absent: PRODUCTS blocker fires and is NOT suppressed (critical safety regression)', async () => {
    const shopDomain = `evaluator-orders-no-products-${Date.now()}.myshopify.com`;
    const { shopId } = await installFreshShop(shopDomain);
    await seedAuthoritativeIntegration(shopId, shopDomain);
    await seedReadiness(shopId);
    await seedOrder(shopId);

    const result = await FT2EvaluatorService.evaluateReal(shopId);

    expect(result.eligible).toBe(false);
    const productsBlocker = result.blockers.find(
      (b) => b.category === 'DATA_COVERAGE' && b.domain === 'PRODUCTS'
    );
    expect(productsBlocker).toBeDefined();
    expect((productsBlocker as any).reason).toBe('No products present');
    expect(result.evidence.products.legitimatelyEmpty).toBe(false);
  });

  /**
   * CASE E — unstable populated counts (SIGNAL_STABILITY), deterministic.
   *
   * Calls FT2EvaluatorService.classifyBlockers(facts) directly — the
   * exact pure function evaluateReal() calls after its DB reads, not a
   * test-only recreation. Hand-constructed disagreeing counts stand in
   * for what two real consecutive reads would produce under a genuine
   * concurrent write; no DB, no timing, no NODE_ENV involved.
   */
  it('CASE E — order/product/customer count disagreement each produce their own SIGNAL_STABILITY blocker, via the same classifyBlockers() evaluateReal() calls', () => {
    const baseFacts = {
      authoritativeSync: true,
      ordersCountA: 1,
      ordersCountB: 1,
      productsCountA: 1,
      productsCountB: 1,
      customersCountA: 1,
      customersCountB: 1,
      orphanCount: 0,
      customerOrphanCount: 0,
    };

    const ordersUnstable = FT2EvaluatorService.classifyBlockers({
      ...baseFacts,
      ordersCountA: 1,
      ordersCountB: 2,
    });
    expect(
      ordersUnstable.blockers.some(
        (b) =>
          b.category === 'SIGNAL_STABILITY' &&
          b.domain === 'ORDERS' &&
          (b as any).reason === 'Order count is not stable across consecutive reads'
      )
    ).toBe(true);
    expect(ordersUnstable.evidence.orders.stable).toBe(false);

    const productsUnstable = FT2EvaluatorService.classifyBlockers({
      ...baseFacts,
      productsCountA: 1,
      productsCountB: 2,
    });
    expect(
      productsUnstable.blockers.some(
        (b) =>
          b.category === 'SIGNAL_STABILITY' &&
          b.domain === 'PRODUCTS' &&
          (b as any).reason === 'Product count is not stable across consecutive reads'
      )
    ).toBe(true);
    expect(productsUnstable.evidence.products.stable).toBe(false);

    const customersUnstable = FT2EvaluatorService.classifyBlockers({
      ...baseFacts,
      customersCountA: 1,
      customersCountB: 2,
    });
    expect(
      customersUnstable.blockers.some(
        (b) =>
          b.category === 'SIGNAL_STABILITY' &&
          b.domain === 'CUSTOMERS' &&
          (b as any).reason === 'Customer count is not stable across consecutive reads'
      )
    ).toBe(true);
    expect(customersUnstable.evidence.customers.stable).toBe(false);
  });

  it('CASE H — PCD-fallback-shaped completion: presence blockers fire, suppression never engages', async () => {
    const shopDomain = `evaluator-pcd-${Date.now()}.myshopify.com`;
    const { shopId } = await installFreshShop(shopDomain);
    await seedPcdFallbackIntegration(shopId, shopDomain);
    await seedReadiness(shopId);

    const result = await FT2EvaluatorService.evaluateReal(shopId);

    expect(result.eligible).toBe(false);
    expect(result.evidence.authoritativeSync).toBe(false);
    const ordersBlocker = result.blockers.find(
      (b) => b.category === 'DATA_COVERAGE' && b.domain === 'ORDERS'
    );
    const productsBlocker = result.blockers.find(
      (b) => b.category === 'DATA_COVERAGE' && b.domain === 'PRODUCTS'
    );
    expect(ordersBlocker).toBeDefined();
    expect(productsBlocker).toBeDefined();
    expect(result.evidence.orders.legitimatelyEmpty).toBe(false);
    expect(result.evidence.products.legitimatelyEmpty).toBe(false);
  });

  it('SYNC GUARD — non-COMPLETED integration blocks unconditionally, unchanged', async () => {
    const shopDomain = `evaluator-syncing-${Date.now()}.myshopify.com`;
    const { shopId } = await installFreshShop(shopDomain);
    await withTenant(shopId, (trx) =>
      trx('integrations').insert({
        shop_id: shopId,
        platform: 'shopify',
        platform_shop_name: shopDomain,
        sync_status: 'SYNCING_ORDERS',
        updated_at: new Date(),
      })
    );

    const result = await FT2EvaluatorService.evaluateReal(shopId);

    expect(result.eligible).toBe(false);
    expect(result.blockers).toEqual([
      { category: 'DATA_COVERAGE', domain: 'ORDERS', reason: 'SYNC_IN_PROGRESS' },
    ]);
  });

  it('READINESS GATE — authoritative completion without system_readiness_state blocks unchanged', async () => {
    const shopDomain = `evaluator-not-ready-${Date.now()}.myshopify.com`;
    const { shopId } = await installFreshShop(shopDomain);
    await seedAuthoritativeIntegration(shopId, shopDomain);
    // No seedReadiness() call — readiness deliberately absent.

    const result = await FT2EvaluatorService.evaluateReal(shopId);

    expect(result.eligible).toBe(false);
    expect(result.blockers).toEqual([
      { category: 'DATA_COVERAGE', domain: 'ORDERS', reason: 'SYSTEM_NOT_READY' },
    ]);
  });

  it('CUSTOMERS ZERO — remains advisory-only, never a DATA_COVERAGE blocker', async () => {
    const shopDomain = `evaluator-guest-checkout-${Date.now()}.myshopify.com`;
    const { shopId } = await installFreshShop(shopDomain);
    await seedAuthoritativeIntegration(shopId, shopDomain);
    await seedReadiness(shopId);
    await seedProduct(shopId);
    await seedOrder(shopId, { customerHashedId: null }); // guest checkout

    const result = await FT2EvaluatorService.evaluateReal(shopId);

    expect(result.eligible).toBe(true);
    expect(
      result.blockers.some((b) => b.category === 'DATA_COVERAGE' && b.domain === 'CUSTOMERS')
    ).toBe(false);
    expect(result.evidence.customers.advisory.present).toBe(false);
    expect(result.evidence.orders_customers_join.joinable).toBe(true);
  });

  /**
   * CASE F1-F3 — structural invariant regression, real disposable
   * Postgres, replacing the impossible "insert a null-product-id
   * orphan" fixture.
   *
   * `order_revenue_units.lasyncro_product_id` is NOT NULL with a FK to
   * products ON DELETE RESTRICT (migration
   * 0007_order_revenue_units_sovereign.ts; never relaxed by any later
   * migration — audited: the only later ALTER on this table's identity
   * columns, 0039_enforce_variant_not_null_on_revenue_units.ts, touches
   * the separate lasyncro_variant_id column). F1/F2 prove the DB itself
   * rejects the two ways an "orphan" could otherwise arise; F3 proves a
   * validly-persisted row is correctly classified joinable. Together
   * these prove the evaluator's whereNull('ru.lasyncro_product_id')
   * check cannot currently match any row the schema allows to exist —
   * see FT2-CROSS-DOMAIN-DEAD-CHECK-06 below.
   */
  it('CASE F1 — order_revenue_units.lasyncro_product_id NULL is rejected by a real NOT NULL constraint', async () => {
    const shopDomain = `evaluator-oru-null-${Date.now()}.myshopify.com`;
    const { shopId } = await installFreshShop(shopDomain);
    await seedAuthoritativeIntegration(shopId, shopDomain);
    await seedReadiness(shopId);
    const productId = await seedProduct(shopId);
    const orderId = await seedOrder(shopId);
    const variantId = await seedVariant(shopId, productId);

    let caughtError: any = null;
    try {
      await withTenant(shopId, (trx) =>
        trx('order_revenue_units').insert({
          lasyncro_revenue_unit_id: crypto.randomUUID(),
          lasyncro_order_id: orderId,
          lasyncro_product_id: null,
          lasyncro_variant_id: variantId,
          title: 'Test Line Item',
          quantity: 1,
          unit_price: 10,
          line_total: 10,
          estimated_unit_cost: 5,
        })
      );
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    // Verified against the live disposable DB, not hardcoded blindly:
    // Postgres SQLSTATE 23502 is not_null_violation.
    expect(caughtError.code).toBe('23502');

    const rows = await withTenant(shopId, (trx) =>
      trx('order_revenue_units').where({ lasyncro_order_id: orderId })
    );
    expect(rows).toHaveLength(0);
  });

  it('CASE F2 — order_revenue_units.lasyncro_product_id referencing a nonexistent product is rejected by the real FK', async () => {
    const shopDomain = `evaluator-oru-fk-${Date.now()}.myshopify.com`;
    const { shopId } = await installFreshShop(shopDomain);
    await seedAuthoritativeIntegration(shopId, shopDomain);
    await seedReadiness(shopId);
    const productId = await seedProduct(shopId);
    const orderId = await seedOrder(shopId);
    const variantId = await seedVariant(shopId, productId);
    const nonexistentProductId = crypto.randomUUID();

    let caughtError: any = null;
    try {
      await withTenant(shopId, (trx) =>
        trx('order_revenue_units').insert({
          lasyncro_revenue_unit_id: crypto.randomUUID(),
          lasyncro_order_id: orderId,
          lasyncro_product_id: nonexistentProductId,
          lasyncro_variant_id: variantId,
          title: 'Test Line Item',
          quantity: 1,
          unit_price: 10,
          line_total: 10,
          estimated_unit_cost: 5,
        })
      );
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    // Verified against the live disposable DB, not hardcoded blindly:
    // Postgres SQLSTATE 23503 is foreign_key_violation.
    expect(caughtError.code).toBe('23503');

    const rows = await withTenant(shopId, (trx) =>
      trx('order_revenue_units').where({ lasyncro_order_id: orderId })
    );
    expect(rows).toHaveLength(0);
  });

  it('CASE F3 — a validly-persisted revenue unit is classified joinable, orphanCount 0 (regression)', async () => {
    const shopDomain = `evaluator-oru-valid-${Date.now()}.myshopify.com`;
    const { shopId } = await installFreshShop(shopDomain);
    await seedAuthoritativeIntegration(shopId, shopDomain);
    await seedReadiness(shopId);
    const productId = await seedProduct(shopId);
    const orderId = await seedOrder(shopId, { customerHashedId: 'hashed-customer-f3' });
    const variantId = await seedVariant(shopId, productId);

    await withTenant(shopId, (trx) =>
      trx('order_revenue_units').insert({
        lasyncro_revenue_unit_id: crypto.randomUUID(),
        lasyncro_order_id: orderId,
        lasyncro_product_id: productId,
        lasyncro_variant_id: variantId,
        title: 'Test Line Item',
        quantity: 1,
        unit_price: 10,
        line_total: 10,
        estimated_unit_cost: 5,
      })
    );

    const result = await FT2EvaluatorService.evaluateReal(shopId);

    expect(result.evidence.orders_products_join.orphanCount).toBe(0);
    expect(result.evidence.orders_products_join.joinable).toBe(true);
    expect(
      result.blockers.some((b) => b.category === 'CROSS_DOMAIN')
    ).toBe(false);
  });

  /**
   * PARKED FOLLOW-UP — FT2-CROSS-DOMAIN-DEAD-CHECK-06
   * ----------------------------------------------------
   * FT2EvaluatorService's CROSS_DOMAIN blocker checks
   * order_revenue_units.lasyncro_product_id IS NULL, but the database
   * structurally forbids NULL there and also enforces a foreign key to
   * products (proven by CASE F1/F2 above). The current null-orphan
   * branch therefore appears unreachable under any schema-valid state.
   * Future scope: audit whether the blocker is redundant and should be
   * removed, or whether the intended cross-domain integrity question is
   * different and the query should test something else. NOT addressed
   * in SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02 — reported only.
   */
});
