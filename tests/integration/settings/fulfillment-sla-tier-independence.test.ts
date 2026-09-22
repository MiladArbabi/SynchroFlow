// tests/integration/settings/fulfillment-sla-tier-independence.test.ts
//
// FULFILLMENT-SLA-TIER-INDEPENDENCE
// ----------------------------------
// Fulfillment SLA is a general operational setting, not a Growth-tier
// intelligence feature. GET/PATCH /api/v1/settings/shop/fulfillment-sla must
// work for a starter-tier shop (no requireTier gate), persist canonically to
// shop_operational_settings.fulfillment_sla_hours, validate the [1, 720]
// bound, and stay tenant-isolated.
//
// Fixture setup modelled closely on tests/integration/orders/sla-treatment.test.ts's
// createShop() — same tenant/user/membership/lifecycle-snapshot shape — except
// this file deliberately does NOT pre-insert a shop_operational_settings row,
// so the GET-with-no-row-yet default (24) can be asserted (requirement 1).

import crypto from 'crypto';
import request from 'supertest';

import { createApp } from 'api-src/bootstrap/express';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

async function createShop(): Promise<{ shopId: number; userId: number }> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `sla-settings-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `sla-settings-${unique}@test.example`,
        password_hash: 'not-a-real-hash',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');

    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: row.id,
      role: 'owner',
    });

    // NOTE: deliberately NOT inserting a shop_operational_settings row here —
    // requirement 1 needs a shop with no row yet, to assert the read-only
    // GET default (24) rather than an inserted value.

    await trx('user_lifecycle_snapshot').insert({
      shop_id: shopId,
      user_id: row.id,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    });

    return row.id as number;
  });

  return { shopId, userId };
}

function getSla(token: string) {
  return request(app)
    .get('/api/v1/settings/shop/fulfillment-sla')
    .set('Authorization', `Bearer ${token}`);
}

function patchSla(token: string, body: unknown) {
  return request(app)
    .patch('/api/v1/settings/shop/fulfillment-sla')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

it('FULFILLMENT-SLA-TIER-01 GET returns 200 (not 403) for a starter-tier owner, defaulting to 24 with no row', async () => {
  const { shopId, userId } = await createShop();
  const token = issueTestToken({ shopId, userId, tier: 'starter', roles: ['owner'] });

  const res = await getSla(token);

  expect(res.status).toBe(200);
  expect(res.body.fulfillment_sla_hours).toBe(24);
});

it('FULFILLMENT-SLA-TIER-02 PATCH returns 200 (not 403) for the same starter-tier owner', async () => {
  const { shopId, userId } = await createShop();
  const token = issueTestToken({ shopId, userId, tier: 'starter', roles: ['owner'] });

  const res = await patchSla(token, { fulfillment_sla_hours: 12 });

  expect(res.status).toBe(200);
  expect(res.body.fulfillment_sla_hours).toBe(12);
});

it('FULFILLMENT-SLA-TIER-03 a subsequent GET reflects the PATCHed value', async () => {
  const { shopId, userId } = await createShop();
  const token = issueTestToken({ shopId, userId, tier: 'starter', roles: ['owner'] });

  const patchRes = await patchSla(token, { fulfillment_sla_hours: 12 });
  expect(patchRes.status).toBe(200);

  const getRes = await getSla(token);
  expect(getRes.status).toBe(200);
  expect(getRes.body.fulfillment_sla_hours).toBe(12);
});

it('FULFILLMENT-SLA-TIER-04 the DB row itself is canonically persisted as 12, not just echoed', async () => {
  const { shopId, userId } = await createShop();
  const token = issueTestToken({ shopId, userId, tier: 'starter', roles: ['owner'] });

  const patchRes = await patchSla(token, { fulfillment_sla_hours: 12 });
  expect(patchRes.status).toBe(200);

  const row = await withTenant(shopId, async (trx) =>
    trx('shop_operational_settings').where({ shop_id: shopId }).first()
  );

  expect(Number(row.fulfillment_sla_hours)).toBe(12);
});

it('FULFILLMENT-SLA-TIER-05 PATCH with 0 returns 400', async () => {
  const { shopId, userId } = await createShop();
  const token = issueTestToken({ shopId, userId, tier: 'starter', roles: ['owner'] });

  const res = await patchSla(token, { fulfillment_sla_hours: 0 });

  expect(res.status).toBe(400);
});

it('FULFILLMENT-SLA-TIER-06 PATCH with 721 returns 400', async () => {
  const { shopId, userId } = await createShop();
  const token = issueTestToken({ shopId, userId, tier: 'starter', roles: ['owner'] });

  const res = await patchSla(token, { fulfillment_sla_hours: 721 });

  expect(res.status).toBe(400);
});

it('FULFILLMENT-SLA-TIER-07 tenant isolation: shop A PATCH does not leak into shop B GET', async () => {
  const shopA = await createShop();
  const shopB = await createShop();
  const tokenA = issueTestToken({ shopId: shopA.shopId, userId: shopA.userId, tier: 'starter', roles: ['owner'] });
  const tokenB = issueTestToken({ shopId: shopB.shopId, userId: shopB.userId, tier: 'starter', roles: ['owner'] });

  const patchRes = await patchSla(tokenA, { fulfillment_sla_hours: 12 });
  expect(patchRes.status).toBe(200);

  const getResB = await getSla(tokenB);
  expect(getResB.status).toBe(200);
  expect(getResB.body.fulfillment_sla_hours).not.toBe(12);
  expect(getResB.body.fulfillment_sla_hours).toBe(24);
});
