/**
 * FRESH-INSTALL-04 — the reviewer's path, walked end to end.
 *
 * The Shopify reviewer installed on their own store, got a tenant with one
 * warehouse root and zero bins, and hit POST /wms/batch/release eleven times
 * for a 500. SHOP-REV-02 fixed the bins-only inventory filter in both the
 * evaluator and the reservation path — but neither fix was ever exercised
 * over HTTP on an install-shaped tenant. The evaluator half was checked via a
 * snapshot read; the reservation half via a pure-function unit test. This
 * closes that gap: real install, real lifecycle ladder, real endpoint.
 *
 * Ladder (docs/playbooks/lifecycle_playbook.md §2), every rung driven, none
 * hand-inserted — dev_seed and seed_reviewer both shortcut straight to
 * ft0/completed and lifecycle/ft2_confirmed, which is why the natural
 * progression had never run:
 *
 *   install (HMAC)      -> shop, ghost owner, WH-{shopId}-ROOT, zero bins
 *   seedFreshInstall    -> products, 125u opening balance at root, 5 orders
 *   orders/create       -> FirstInsightService post-commit
 *   first_insight_*     -> FT0CompletionService
 *   ft0.completed       -> system_readiness_state, FT_MINUS_ONE->FT0->FT1
 *   POST /ft2/confirm   -> lifecycle/ft2_confirmed
 *   ft2_confirmed       -> FT1->FT2
 *   POST /batch/release -> reservation_hold at WH-{shopId}-ROOT
 *
 * KNOWN COVERAGE LIMIT: FT2EvaluatorService.evaluate returns eligible:true
 * unconditionally when NODE_ENV === 'test' (ft2-evaluator.service.ts:92), so
 * this test does NOT cover the six data-coverage blockers. It does cover the
 * SYNC GUARD above the bypass (line 70), which is why the integration row
 * below carries sync_status COMPLETED — that gate is real in every
 * environment. Do not read a pass here as evidence the evaluator works.
 *
 * processDomainEvent reads on its own connection, so it must run AFTER
 * seedFreshInstall's withTenant transaction commits, and each call needs a
 * runWithTenantContext frame (SEED-RLS-01).
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { issueTestToken } from '../unit/helpers/auth';
import { encrypt } from 'api-src/security/encryption.service';

const app = createApp();

/** Drains every unprocessed domain event for the shop, oldest first. */
async function pumpEvents(shopId: number) {
  const rows = await withTenant(shopId, (trx) =>
    trx('domain_events').where({ shop_id: shopId }).orderBy('id', 'asc').select('id')
  );

  for (const row of rows) {
    await runWithTenantContext(shopId, () => processDomainEvent(row.id));
  }

  return rows.length;
}

describe('fresh install: install -> lifecycle ladder -> batch release', () => {
  const shopDomain = `fresh-release-test-${Date.now()}.myshopify.com`;

  beforeAll(() => {
    process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
    process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
    process.env.API_URL = process.env.API_URL || 'https://api.test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
  });

  it('releases a batch against root-only inventory', async () => {
    // ---- 1. install ----------------------------------------------------
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

    const shopId = ghostUser.shop_id as number;
    const rootLocationCode = `WH-${shopId}-ROOT`;

    // The reviewer's exact shape: nothing stowed, no bins at all.
    const bins = await withTenant(shopId, (trx) =>
      trx('warehouse_locations').where({ shop_id: shopId, type: 'bin' })
    );
    expect(bins).toHaveLength(0);

    // ---- 2. seed, then drive the ladder --------------------------------
    await seedFreshInstall(shopId);

    // The FT2 sync guard (ft2-evaluator.service.ts:70) runs above the NODE_ENV
    // bypass and is unconditional, so this row is a genuine precondition rather
    // than a shortcut. The OAuth callback cannot run offline — it exchanges a
    // code with Shopify and 502s on ACCESS_TOKEN_MISSING — so the row is
    // written directly, using the same encrypt() the controller's local
    // encryptToken wraps. Requires ENCRYPTION_KEY (.env:38).
    await withTenant(shopId, (trx) =>
      trx('integrations').insert({
        shop_id: shopId,
        platform: 'shopify',
        platform_shop_name: shopDomain,
        access_token_encrypted: encrypt('offline-test-token-no-network-call'),
        sync_status: 'COMPLETED',
        updated_at: new Date(),
      })
    );

    // Two passes: the first drains orders/create, whose post-commit hook emits
    // first_insight_delivered; the second drains that and the ft0.completed it
    // produces. Each pass processes events the previous pass created.
    await pumpEvents(shopId);
    await pumpEvents(shopId);
    await pumpEvents(shopId);

    const readiness = await withTenant(shopId, (trx) =>
      trx('system_readiness_state').where({ shop_id: shopId }).first()
    );
    expect(readiness).toBeDefined();

    const atFt1 = await withTenant(shopId, (trx) =>
      trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first()
    );

    expect(atFt1?.phase).toBe('FT1');
    // LIFECYCLE-ID-01: shop lifecycle remains anchored to its founding owner.
    expect(atFt1?.user_id).toBe(ghostUser.id);

    // ---- 3. confirm FT2 through the real endpoint ----------------------
    const token = issueTestToken({ userId: ghostUser.id, shopId });

    const confirm = await request(app)
      .post('/api/v1/lifecycle/ft2/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(confirm.status).toBe(200);

    await pumpEvents(shopId);

    const atFt2 = await withTenant(shopId, (trx) =>
      trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first()
    );
    expect(atFt2?.phase).toBe('FT2');
    expect(atFt2?.user_id).toBe(ghostUser.id);

    // ---- 4. the endpoint the reviewer hit ------------------------------
    const release = await request(app)
      .post('/api/v1/wms/batch/release')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    // 200 is the no-op path SHOP-REV-03 stopped swallowing — it must not pass.
    expect(release.status).toBe(201);

    const holds = await withTenant(shopId, (trx) =>
      trx('inventory_movements').where({
        shop_id: shopId,
        movement_type: 'reservation_hold',
        location_code: rootLocationCode,
      })
    );
    expect(holds.length).toBeGreaterThan(0);
  }, 60000);
});