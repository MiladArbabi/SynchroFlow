// tests/integration/inventory/stock-protection-recommendation-api.contract.test.ts
//
// STOCK-PROTECT-02 — API/DB integration contract for the read-only Buffer
// Diagnosis recommendation endpoint. PERMANENT regression contract,
// authored RED.
// ============================================================================
// ROUTE UNDER TEST (does not exist yet — this file expects it to)
//   GET /api/v1/modules/demand/stock-protection-recommendation/:variantId
//   Sibling of the already-live STOCK-PROTECT-01 route
//   GET /api/v1/modules/demand/stock-protection-policy/:variantId — same
//   router, same authenticateToken -> requireFt2 ->
//   requireCapability('demand.forecasting') chain
//   (apps/backend/src/api/demand/demand.routes.ts). This placement was
//   confirmed consistent with existing routing conventions before writing
//   this file; it is not a new pattern.
//
// INDEPENDENTLY RED
//   The route is not registered. Every request below is expected to fail
//   with 404 ("Cannot GET/PUT ...") — that is the RED signal for this file,
//   identical in kind to tests/integration/suppliers/sourcing-worklist-
//   contract.test.ts's documented RED convention for a not-yet-built
//   endpoint. It is not a malformed test: the route/controller genuinely
//   does not exist.
//
// WHAT IS ASSERTED
//   - unauthenticated request rejected (401)
//   - tenant/capability boundary respected (a foreign tenant's variant is
//     never resolvable through this route)
//   - a valid request returns the full explanation contract (recommended_
//     safety_days, baseline_safety_days, confidence, adjustments, evidence,
//     limitations, generated_at)
//   - the insufficient-history case returns baseline 5 + confidence
//     'insufficient'
//   - recalculation is READ-ONLY: no change to stock_protection_policies,
//     stock_protection_policy_transitions, or the policy's version, before
//     vs. after the GET. This sub-test is expected to remain green even
//     during RED (a missing route trivially mutates nothing) — its RED
//     value is realized once the route exists; see PR RAW evidence for
//     confirmation this does not silently certify unbuilt behaviour.

import crypto from 'crypto';
import request from 'supertest';

import { createApp } from 'api-src/bootstrap/express';

import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { upsertStockProtectionPolicy } from 'api-src/services/inventory/stockProtectionPolicy.service';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

function recommendationPath(variantId: string) {
  return `/api/v1/modules/demand/stock-protection-recommendation/${variantId}`;
}

async function bootstrapShop(unique: string) {
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `sp-buf-api-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `sp-buf-api+${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');
    return Number(row.id ?? row);
  });

  await withTenant(shopId, async (trx) => {
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: userId, role: 'owner' });
    // Mechanical fixture prerequisite (COMMAND CORRECTIONS): requireFt2 gates
    // on LifecycleService.resolveForUser, which reads this table — omitted
    // from the initial fixture, not a business-semantics change. Matches the
    // convention already used by sourcing-worklist-contract.test.ts.
    await trx('user_lifecycle_snapshot').insert({
      shop_id: shopId,
      user_id: userId,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    });
    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'growth',
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    });
  });

  return { shopId, userId, token: issueTestToken({ userId, shopId, tier: 'growth' }) };
}

async function seedVariant(shopId: number): Promise<string> {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'SP-BUF API fixture product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `SP-BUF-API-${variantId.slice(0, 8)}`,
      title: 'SP-BUF API fixture variant',
      unit_cost: '5.00',
      status: 'active',
    });
  });
  return variantId;
}

describe('STOCK-PROTECT-02 — stock-protection-recommendation API contract', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
  });

  it('SP-BUF-API-01: an unauthenticated request is rejected', async () => {
    const shopId = await systemTransaction(async (trx) => {
      const id = await createTenantShop(trx, `sp-buf-api-noauth-${crypto.randomBytes(4).toString('hex')}`);
      await setTenantContext(trx, id);
      return id;
    });
    const variantId = await seedVariant(shopId);

    const response = await request(app).get(recommendationPath(variantId));
    expect(response.status).toBe(401);
  });

  it('SP-BUF-API-02: tenant boundary is respected — a foreign tenant cannot resolve another shop\'s variant through this route', async () => {
    const unique = crypto.randomBytes(6).toString('hex');
    const owner = await bootstrapShop(unique);
    const ownerVariantId = await seedVariant(owner.shopId);

    const foreignUnique = crypto.randomBytes(6).toString('hex');
    const foreign = await bootstrapShop(foreignUnique);

    const response = await request(app)
      .get(recommendationPath(ownerVariantId))
      .set('Authorization', `Bearer ${foreign.token}`);

    expect(response.status).not.toBe(200);
  });

  it('SP-BUF-API-03: a valid request returns the full explanation contract', async () => {
    const unique = crypto.randomBytes(6).toString('hex');
    const { shopId, token } = await bootstrapShop(unique);
    const variantId = await seedVariant(shopId);

    const response = await request(app)
      .get(recommendationPath(variantId))
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        recommended_safety_days: expect.any(Number),
        baseline_safety_days: expect.any(Number),
        confidence: expect.stringMatching(/^(insufficient|low|medium|high)$/),
        adjustments: expect.any(Array),
        evidence: expect.any(Object),
        limitations: expect.any(Array),
        generated_at: expect.any(String),
      })
    );
  });

  it('SP-BUF-API-04: a variant with no sales/supplier history returns baseline 5 and confidence=insufficient', async () => {
    const unique = crypto.randomBytes(6).toString('hex');
    const { shopId, token } = await bootstrapShop(unique);
    const variantId = await seedVariant(shopId);

    const response = await request(app)
      .get(recommendationPath(variantId))
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.recommended_safety_days).toBe(5);
    expect(response.body.confidence).toBe('insufficient');
  });

  it('SP-BUF-API-05: recalculation is read-only — no change to stock_protection_policies, its transitions, or version', async () => {
    const unique = crypto.randomBytes(6).toString('hex');
    const { shopId, token } = await bootstrapShop(unique);
    const variantId = await seedVariant(shopId);

    // An approved policy already exists — the recommendation call must never
    // touch it.
    await withTenant(shopId, (trx) =>
      upsertStockProtectionPolicy(trx, {
        shopId,
        variantId,
        safetyDays: 9,
        reviewCycleDays: 14,
        planningSupplierId: null,
        source: 'ui_approval',
        reason: 'sp_buf_api_fixture_baseline',
        actorType: 'user',
        actorId: 'user-1',
        recommendationSnapshot: null,
      })
    );

    const before = await withTenant(shopId, async (trx) => ({
      current: await trx('stock_protection_policies').where({ shop_id: shopId, lasyncro_variant_id: variantId }).first(),
      transitionCount: Number(
        (await trx('stock_protection_policy_transitions').where({ shop_id: shopId, lasyncro_variant_id: variantId }).count({ n: '*' }).first())?.n ?? 0
      ),
    }));

    await request(app).get(recommendationPath(variantId)).set('Authorization', `Bearer ${token}`);
    await request(app).get(recommendationPath(variantId)).set('Authorization', `Bearer ${token}`);

    const after = await withTenant(shopId, async (trx) => ({
      current: await trx('stock_protection_policies').where({ shop_id: shopId, lasyncro_variant_id: variantId }).first(),
      transitionCount: Number(
        (await trx('stock_protection_policy_transitions').where({ shop_id: shopId, lasyncro_variant_id: variantId }).count({ n: '*' }).first())?.n ?? 0
      ),
    }));

    expect(after.current.version).toBe(before.current.version);
    expect(after.transitionCount).toBe(before.transitionCount);
    expect(after.current).toEqual(before.current);
  });
});
