// RUN_ID: SF-TIER-W1A-RED-001 ATTEMPT: 04
import crypto from 'crypto';
jest.mock('api-src/utils/analytics', () => ({ captureEvent: jest.fn() }));
const mockRetrieve = jest.fn();
jest.mock('stripe', () => ({ __esModule: true, default: jest.fn(() => ({ subscriptions: { retrieve: (...args: any[]) => mockRetrieve(...args) } })) }));
// Bound BOTH the caller transaction and the pre-fix independent revoke.
jest.mock('@lasyncro/backend-core/db.js', () => {
  const actual = jest.requireActual('@lasyncro/backend-core/db.js');
  return { ...actual, __esModule: true, default: actual.default, withTenant: (id: number, fn: any) => actual.withTenant(id, async (trx: any) => {
    await trx.raw("SET LOCAL lock_timeout = '1000ms'");
    await trx.raw("SET LOCAL statement_timeout = '3000ms'");
    return fn(trx);
  }) };
});
import db, { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { EntitlementRevocationService } from 'api-src/services/entitlement-revocation.service';
import { handleSubscriptionDeleted } from 'api-src/api/billing/handlers/handleSubscriptionDeleted';
import { forceDowngradeShopToStarter } from 'api-src/services/shopify/forceDowngradeToStarter.service';
import { attributeStripeSubscription } from 'api-src/services/billing/stripeSubscriptionAuthority.service';
beforeAll(() => { process.env.STRIPE_SECRET_KEY = 'sk_test_w1_local_stub_only'; });

async function fixture(provider: 'stripe' | 'shopify') {
  const suffix = crypto.randomUUID();
  const shopId = await systemTransaction(async trx => {
    const id = await createTenantShop(trx, `w1-atomic-${suffix}`);
    await setTenantContext(trx, id);
    return id;
  });
  const userId = await withTenant(shopId, async trx => {
    await trx('shop_subscriptions').insert({ shop_id: shopId, tier: 'growth', status: 'active', billing_provider: provider, stripe_subscription_id: `sub_${suffix}`, stripe_customer_id: `cus_${suffix}` });
    const [user] = await trx('users').insert({ shop_id: shopId, email: `${suffix}@test.example`, password_hash: 'test', role: 'owner' }).returning('id');
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: user.id, role: 'owner' });
    await trx('shop_module_entitlements').insert([
      { module_key: 'floor-planning', source: 'tier:growth' },
      { module_key: 'demand', source: 'admin' },
      { module_key: 'problem-center', source: 'migration' },
      { module_key: 'returns', source: 'billing' },
      { module_key: 'shared', source: 'internal' },
    ].map(row => ({ ...row, shop_id: shopId, flag_key: null, valid_from: new Date(Date.now() - 60000), valid_until: null })));
    // Distinct identities only: temporal controls do not overlap independent
    // authorizations of the same capability (that remains W1-B).
    await trx('shop_module_entitlements').insert([
      { shop_id: shopId, module_key: 'returns', flag_key: 'returns.analysis', source: 'admin', valid_from: new Date(Date.now() - 60000), valid_until: new Date(Date.now() + 3600000) },
      { shop_id: shopId, module_key: 'order-nexus', flag_key: null, source: 'migration', valid_from: new Date(Date.now() - 120000), valid_until: new Date(Date.now() - 60000) },
      { shop_id: shopId, module_key: 'suppliers-portal', flag_key: null, source: 'admin', valid_from: new Date(Date.now() + 3600000), valid_until: null },
    ]);
    return Number(user.id);
  });
  return { shopId, userId };
}
async function state(shopId: number) {
  return withTenant(shopId, async trx => ({
    subscription: await trx('shop_subscriptions').where({ shop_id: shopId }).first(),
    ledger: await trx('shop_subscription_transitions').where({ shop_id: shopId }).orderBy('id'),
    grants: await trx('shop_module_entitlements').where({ shop_id: shopId }).orderBy('id'),
  }));
}
async function downgrade(shopId: number, provider: string) {
  if (provider === 'shopify') return withTenant(shopId, trx => forceDowngradeShopToStarter(shopId, trx, 'w1_test_downgrade'));
  const current = await withTenant(shopId, trx => trx('shop_subscriptions').where({ shop_id: shopId }).first());
  const rawPayload = { id: current.stripe_subscription_id, customer: current.stripe_customer_id, status: 'canceled' };
  mockRetrieve.mockReset().mockResolvedValue(rawPayload);
  const envelope = { integration: 'stripe', shopId, eventId: `evt_${crypto.randomUUID()}`, eventType: 'customer.subscription.deleted', verified: true as const, receivedAt: new Date(), rawPayload };
  const authority = await attributeStripeSubscription(envelope);
  return withTenant(shopId, trx => handleSubscriptionDeleted(envelope, trx, authority));
}
afterAll(async () => { await db.destroy(); });

it('A-ATOMIC-ROLLBACK: Stripe and Shopify roll back real revocation with subscription and ledger', async () => {
  const results = [];
  for (const provider of ['stripe', 'shopify'] as const) {
    const f = await fixture(provider);
    const before = await state(f.shopId);
    const effective = await EntitlementsService.getForUser(f.userId);
    const real = EntitlementRevocationService.revokeEntitlements.bind(EntitlementRevocationService);
    const spy = jest.spyOn(EntitlementRevocationService, 'revokeEntitlements').mockImplementation(async (...args: any[]) => {
      await (real as any)(...args);
      throw new Error('W1_AFTER_REAL_REVOKE');
    });
    let error: any;
    try { await downgrade(f.shopId, provider); } catch (e) { error = e; } finally { spy.mockRestore(); }
    expect(error?.message).toBe('W1_AFTER_REAL_REVOKE');
    const after = await state(f.shopId);
    expect(after.subscription).toEqual(before.subscription);
    expect(after.ledger).toEqual(before.ledger);
    results.push({ provider, grantsRestored: JSON.stringify(after.grants) === JSON.stringify(before.grants), effectiveRestored: JSON.stringify(await EntitlementsService.getForUser(f.userId)) === JSON.stringify(effective) });
  }
  expect(results).toEqual([
    { provider: 'stripe', grantsRestored: true, effectiveRestored: true },
    { provider: 'shopify', grantsRestored: true, effectiveRestored: true },
  ]);
}, 45000);

it('A-COMMITTED-DOWNGRADE: close attributable plan grants and preserve disjoint independent grants', async () => {
  const f = await fixture('stripe');
  const other = await fixture('stripe');
  const before = await state(f.shopId);
  const otherBefore = await state(other.shopId);
  await downgrade(f.shopId, 'stripe');
  const after = await state(f.shopId);
  expect(after.subscription).toMatchObject({ tier: 'starter', status: 'canceled' });
  expect(after.ledger).toHaveLength(1);
  expect(after.ledger[0]).toMatchObject({ from_tier: 'growth', to_tier: 'starter', source: 'stripe_webhook' });
  expect(after.grants.map(row => row.id)).toEqual(before.grants.map(row => row.id));
  expect(after.grants.find(row => row.source === 'tier:growth').valid_until).not.toBeNull();
  expect(await state(other.shopId)).toEqual(otherBefore);
  await withTenant(f.shopId, async trx => {
    expect(await trx('shop_module_entitlements').where({ shop_id: other.shopId }).update({ valid_until: new Date() })).toBe(0);
  });
  const preserved = after.grants.filter(row => row.source !== 'tier:growth');
  const snapshot = await EntitlementsService.getForUser(f.userId);
  console.info('W1_COMMITTED_DOWNGRADE', { preserved: preserved.map(row => ({ source: row.source, module: row.module_key, flag: row.flag_key, validUntil: row.valid_until })), snapshot });
  // Canonical Starter floor must not resurrect expired/future grants.
  expect(snapshot.modules).not.toContain('order-nexus');
  expect(snapshot.modules).not.toContain('suppliers-portal');
  expect(snapshot.modules).not.toContain('floor-planning');
  expect(preserved).toEqual(before.grants.filter(row => row.source !== 'tier:growth'));
  expect(snapshot.modules).toContain('demand');
}, 25000);
