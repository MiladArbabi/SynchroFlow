// GH-1221 / TIER-06 — WMS settings management authorization.
//
// PATCH /api/v1/wms/settings mutates shop-wide WMS configuration and must be
// gated by the canonical management write authority `wms:settings:write`
// (owner/admin), not `wms:read` (which includes operator). GET stays
// `wms:read` and operator-accessible.
//
// CONTRACT-1221-A: owner @ Core PATCH -> 200, DB value changed.
// CONTRACT-1221-B: admin @ Core PATCH -> 200, DB value changed.
// CONTRACT-1221-C: operator @ Core PATCH -> 403 ACTION_FORBIDDEN on
//   wms:settings:write (never COMMERCIAL_ACCESS_DENIED), DB value unchanged.
// CONTRACT-1221-D: operator @ Core GET -> 200, settings returned.
// CONTRACT-1221-E: owner @ Starter PATCH -> 403 COMMERCIAL_ACCESS_DENIED on
//   warehouse.operations, DB value unchanged (commercial gate stays
//   independently authoritative).
//
// Operator authority is the canonical default policy: no shop_role_permissions
// rows are seeded, so requireAction resolves through ACTION_ROLE_MAP defaults.
// The operator is never granted wms:settings:write.
//
// Real Express app (createApp()), real disposable Postgres, real middleware
// chain. Authoritative tier (GH-1136) is established via the canonical
// transitionShopSubscription path. No worker, no provider call.

import request from 'supertest';
import crypto from 'crypto';
import { createApp } from 'api-src/bootstrap/express';
import db, {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { transitionShopSubscription } from 'api-src/services/billing/subscriptionTransition.service';
import { issueTestToken } from '../../unit/helpers/auth';

jest.setTimeout(30000);

const app = createApp();

const SETTINGS_ROUTE = '/api/v1/wms/settings';
const INITIAL_IDLE_THRESHOLD = 20;

type Tier = 'starter' | 'core';
type Role = 'owner' | 'admin' | 'operator';

let SHOP_ID: number;
const USER_IDS: Partial<Record<Role, number>> = {};

async function createMember(shopId: number, unique: string, role: Role): Promise<number> {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `wms-settings-1221-${role}-${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: role,
        role,
      })
      .returning('id');
    const userId = row.id as number;

    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: userId,
      role,
      revoked_at: null,
    });

    return userId;
  });
}

async function seedFixture(): Promise<void> {
  const unique = crypto.randomBytes(6).toString('hex');

  SHOP_ID = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `wms-settings-1221-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  USER_IDS.owner = await createMember(SHOP_ID, unique, 'owner');
  USER_IDS.admin = await createMember(SHOP_ID, unique, 'admin');
  USER_IDS.operator = await createMember(SHOP_ID, unique, 'operator');

  await withTenant(SHOP_ID, async (trx) => {
    await trx('shop_wms_settings').insert({
      shop_id: SHOP_ID,
      bootstrap_model: 'legacy_opening_balance_v1',
      idle_alert_threshold_minutes: INITIAL_IDLE_THRESHOLD,
    });

    // requireFt2 -> LifecycleService.resolveForUser reads the shop-scoped
    // snapshot, so one FT2 row satisfies every member of this shop.
    await trx('user_lifecycle_snapshot').insert({
      shop_id: SHOP_ID,
      user_id: USER_IDS.owner,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    });
  });
}

/** GH-1136 — authoritative tier via the canonical transition path. */
async function setCurrentTier(tier: Tier): Promise<void> {
  await withTenant(SHOP_ID, (trx) =>
    transitionShopSubscription(
      {
        shopId: SHOP_ID,
        to: { tier, status: 'active', billingProvider: 'shopify' },
        source: 'gh1221_settings_authorization_test',
        reason: 'test_tier_fixture',
        actorType: 'shopify',
        actingProvider: 'shopify',
      },
      trx,
    ),
  );
}

function tokenFor(role: Role, tier: Tier): string {
  return issueTestToken({
    userId: USER_IDS[role] as number,
    shopId: SHOP_ID,
    tier,
    roles: [role],
  });
}

async function readIdleThreshold(): Promise<number> {
  const row = await withTenant(SHOP_ID, (trx) =>
    trx('shop_wms_settings')
      .where({ shop_id: SHOP_ID })
      .first('idle_alert_threshold_minutes'),
  );
  return row.idle_alert_threshold_minutes as number;
}

function patchSettings(role: Role, tier: Tier, body: Record<string, unknown>) {
  return request(app)
    .patch(SETTINGS_ROUTE)
    .set('Authorization', `Bearer ${tokenFor(role, tier)}`)
    .send(body);
}

beforeAll(async () => {
  await seedFixture();
});

afterAll(async () => {
  await db.destroy();
});

describe('GH-1221 PATCH /api/v1/wms/settings management authorization', () => {
  it('A — GREEN CONTROL: owner @ Core updates the setting', async () => {
    await setCurrentTier('core');
    const before = await readIdleThreshold();
    const next = 30;
    expect(before).not.toBe(next);

    const res = await patchSettings('owner', 'core', { idle_alert_threshold_minutes: next });

    expect(res.status).toBe(200);
    expect(res.body.settings.idle_alert_threshold_minutes).toBe(next);
    expect(await readIdleThreshold()).toBe(next);
  });

  it('B — GREEN CONTROL: admin @ Core updates the setting', async () => {
    await setCurrentTier('core');
    const before = await readIdleThreshold();
    const next = 40;
    expect(before).not.toBe(next);

    const res = await patchSettings('admin', 'core', { idle_alert_threshold_minutes: next });

    expect(res.status).toBe(200);
    expect(res.body.settings.idle_alert_threshold_minutes).toBe(next);
    expect(await readIdleThreshold()).toBe(next);
  });

  it('C — EXPECTED RED: operator @ Core is denied wms:settings:write with zero mutation', async () => {
    await setCurrentTier('core');
    const before = await readIdleThreshold();
    const attempted = 55;
    expect(before).not.toBe(attempted);

    const res = await patchSettings('operator', 'core', { idle_alert_threshold_minutes: attempted });

    expect(res.body?.error).not.toBe('COMMERCIAL_ACCESS_DENIED');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACTION_FORBIDDEN');
    expect(res.body.action).toBe('wms:settings:write');
    expect(await readIdleThreshold()).toBe(before);
  });

  it('D — GREEN CONTROL: operator @ Core can still read settings', async () => {
    await setCurrentTier('core');

    const res = await request(app)
      .get(SETTINGS_ROUTE)
      .set('Authorization', `Bearer ${tokenFor('operator', 'core')}`);

    expect(res.status).toBe(200);
    expect(res.body.settings).toBeDefined();
    expect(Number(res.body.settings.shop_id)).toBe(SHOP_ID);
  });

  it('E — GREEN CONTROL: owner @ Starter is commercially denied with zero mutation', async () => {
    await setCurrentTier('starter');
    const before = await readIdleThreshold();
    const attempted = 70;
    expect(before).not.toBe(attempted);

    const res = await patchSettings('owner', 'starter', { idle_alert_threshold_minutes: attempted });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: 'COMMERCIAL_ACCESS_DENIED',
      capabilityId: 'warehouse.operations',
      currentTier: 'starter',
    });
    expect(await readIdleThreshold()).toBe(before);
  });
});
