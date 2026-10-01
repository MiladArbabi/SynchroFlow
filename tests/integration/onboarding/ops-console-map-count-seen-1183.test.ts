/** GH-1183 desired API/DB contract. Execute ONLY with the disposable integration
 * harness and explicit permission for DB fixtures; never against development DB. */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import {
  runWithTenantContext,
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
const HANDOFF_URL = '/api/v1/user-state/ops-console/map-count-handoff-seen';
const FLAGS_URL = '/api/v1/user-state/onboarding-flags';
const HANDOFF_KEY = 'ops-console:map-count-handoff-seen';

jest.setTimeout(120000);

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

async function createOwnerShop(label: string) {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `ops-handoff-1183-${label}-${unique}`);
    await setTenantContext(trx, id);
    // getShopOpeningInventoryProgress requires a settings row (service lines
    // 559–579). All other required settings have defaults in migration 0087.
    await trx('shop_wms_settings').insert({ shop_id: id, bootstrap_model: 'reconcile_opening_expectation_v2' });
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `ops-handoff-1183-${label}-${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: label,
        role: 'owner',
      })
      .returning('id');
    const id = row.id as number;
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: id, role: 'owner', revoked_at: null });
    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'growth',
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    });
    return id;
  });

  return {
    shopId,
    userId,
    token: issueTestToken({ userId, shopId, tier: 'growth', roles: ['owner'] }),
  };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function userStateKeys(shopId: number, userId: number) {
  return withTenant(shopId, (trx) =>
    trx('user_states').where({ user_id: userId }).orderBy('key').pluck('key')
  );
}


async function addSecondUser(shopId: number) {
  const userId = await withTenant(shopId, async trx => {
    const [user] = await trx('users').insert({ shop_id: shopId,
      email: `handoff-other-${crypto.randomBytes(6).toString('hex')}@test.example`,
      password_hash: 'not_a_real_hash', first_name: 'Other', role: 'owner',
    }).returning('id');
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: user.id, role: 'owner', revoked_at: null });
    return user.id as number;
  });
  return { userId, token: issueTestToken({ userId, shopId, tier: 'growth', roles: ['owner'] }) };
}

// Snapshot actual canonical readiness and fixture-scoped opening state, not
// HTTP success alone. No provider calls are part of the WMS signal provider.
import { wmsOnboardingSignalProvider } from 'api-src/onboarding/readiness.providers';
import { getShopOpeningInventoryProgress } from 'api-src/services/wms/inventoryRecount.service';
async function businessState(shopId: number) {
  const signals = await runWithTenantContext(shopId, () => wmsOnboardingSignalProvider.getSignals({ shopId }));
  const inventory = await withTenant(shopId, async trx => ({
    settings: await trx('shop_wms_settings').where({ shop_id: shopId }).select('*'),
    tasks: await trx('inventory_recount_tasks').where({ shop_id: shopId }).select('*'),
    progress: await getShopOpeningInventoryProgress(trx, shopId),
  }));
  return { signals, inventory };
}

describe('GH-1183 map-count seen flag', () => {
  it('persists one dedicated user-scoped row, reads it back, and leaves onboarding/business state intact', async () => {
    const a = await createOwnerShop('a');
    const b = await createOwnerShop('b');
    const other = await addSecondUser(a.shopId);
    const existingFlags = { 'ops-console:intro-seen': true, 'checklist:completed': true, 'spotlight:dismissed:opening_inventory_count': true };
    await withTenant(a.shopId, trx => trx('user_states').insert(Object.keys(existingFlags).map(key => ({ user_id: a.userId, key, value: '1', updated_at: trx.fn.now() }))));
    const before = await request(app).get(FLAGS_URL).set(auth(a.token));
    expect(before.status).toBe(200);
    expect(before.body).toEqual(existingFlags);
    const beforeBusiness = await businessState(a.shopId);
    const beforeRows = await withTenant(a.shopId, trx => trx('user_states').where({ user_id: a.userId }).orderBy('key').select('*'));
    const first = await request(app).post(HANDOFF_URL).set(auth(a.token));
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ seen: true });
    expect((await request(app).post(HANDOFF_URL).set(auth(a.token))).status).toBe(200);
    const after = await request(app).get(FLAGS_URL).set(auth(a.token));
    expect(after.status).toBe(200);
    expect(after.body).toEqual({ ...existingFlags, [HANDOFF_KEY]: true });
    const handoffRows = await withTenant(a.shopId, trx => trx('user_states').where({ user_id: a.userId, key: HANDOFF_KEY }).select('value'));
    expect(handoffRows).toEqual([{ value: '1' }]);
    const preserved = await withTenant(a.shopId, trx => trx('user_states').where({ user_id: a.userId }).whereNot({ key: HANDOFF_KEY }).orderBy('key').select('*'));
    expect(preserved).toEqual(beforeRows);
    expect(await businessState(a.shopId)).toEqual(beforeBusiness);
    const sameTenantOtherUser = await request(app).get(FLAGS_URL).set(auth(other.token));
    expect(sameTenantOtherUser.status).toBe(200);
    expect(sameTenantOtherUser.body[HANDOFF_KEY]).toBeUndefined();
    expect(await userStateKeys(a.shopId, other.userId)).toEqual([]);
    const otherTenant = await request(app).get(FLAGS_URL).set(auth(b.token));
    expect(otherTenant.status).toBe(200);
    expect(otherTenant.body[HANDOFF_KEY]).toBeUndefined();
    expect(await userStateKeys(b.shopId, a.userId)).toEqual([]);
  });
  it('rejects unauthenticated writes without changing an existing user state', async () => {
    const a = await createOwnerShop('unauth');
    const before = await userStateKeys(a.shopId, a.userId);
    expect((await request(app).post(HANDOFF_URL)).status).toBe(401);
    expect(await userStateKeys(a.shopId, a.userId)).toEqual(before);
  });
});
