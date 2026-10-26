import crypto from 'crypto';
import db, { setTenantContext, systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { resolveEffectiveAccessForShop } from '@lasyncro/backend-core/services/effective-access.service.js';
import { modulesForTier, flagsForTier } from '@lasyncro/commercial-policy';
import { grantAuthorization, revokeAuthorization } from 'api-src/services/billing/shopAuthorizationLifecycle.service';
import { resolveShopCapabilityDecision } from 'api-src/services/shop-capability-decision.service';
import { requireCapability } from 'api-src/middleware/require-entitlement.middleware';

type Tier = 'starter' | 'core' | 'growth' | 'scale';

async function fixture(prefix: string, tier: Tier = 'starter') {
  const suffix = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${prefix}-${suffix}`);
    await setTenantContext(trx, id);
    return id;
  });
  const userId = await withTenant(shopId, async (trx) => {
    const [user] = await trx('users').insert({
      shop_id: shopId,
      email: `${prefix}+${suffix}@test.example`,
      password_hash: 'not-a-real-hash',
      first_name: 'Owner',
      role: 'owner',
    }).returning('id');
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: user.id, role: 'owner' });
    await trx('shop_subscriptions').insert({ shop_id: shopId, tier });
    return user.id as number;
  });
  return { shopId, userId };
}

async function grant(shopId: number, targetKind: 'module' | 'flag', targetKey: string, ref: string) {
  return withTenant(shopId, (trx) => grantAuthorization({
    shopId, targetKind, targetKey,
    authorityKind: 'admin', authorityRef: ref,
    lifecycleOwnerKind: 'admin', lifecycleOwnerRef: ref,
  }, trx));
}

async function legacy(shopId: number, values: Record<string, unknown>) {
  return withTenant(shopId, (trx) => trx('shop_module_entitlements').insert({
    shop_id: shopId,
    module_key: null,
    flag_key: null,
    source: 'admin',
    valid_from: new Date(Date.now() - 60_000),
    valid_until: null,
    ...values,
  }));
}

afterAll(async () => db.destroy());

describe('W1-B S3 — canonical effective access', () => {
  it.each<Tier>(['starter', 'core', 'growth', 'scale'])(
    'preserves the canonical %s standard module and flag floor', async (tier) => {
      const { shopId } = await fixture(`s3-tier-${tier}`, tier);
      const access = await resolveEffectiveAccessForShop(shopId);
      expect(access.tier).toBe(tier);
      expect(access.modules).toEqual(modulesForTier(tier));
      expect(access.flags).toEqual(flagsForTier(tier));
    },
  );

  it('adds valid independent module and feature targets without raising tier or implying a module', async () => {
    const { shopId } = await fixture('s3-independent');
    await grant(shopId, 'module', 'wms', 'admin-module');
    await grant(shopId, 'flag', 'returns.analysis', 'admin-flag');
    const access = await resolveEffectiveAccessForShop(shopId);
    expect(access.tier).toBe('starter');
    expect(access.modules.has('wms')).toBe(true);
    expect(access.flags.has('returns.analysis')).toBe(true);
    expect(access.modules.has('returns')).toBe(false);
  });

  it('preserves minimumTier even when an independent module target is present', async () => {
    const { shopId } = await fixture('s3-minimum-tier');
    await grant(shopId, 'module', 'wms', 'admin-wms');
    const resolved = await resolveShopCapabilityDecision(shopId, 'warehouse.operations');
    expect(resolved.currentTier).toBe('starter');
    expect(resolved.decision).toMatchObject({ allowed: false, reason: 'TIER_TOO_LOW', requiredTier: 'core' });
  });

  it('excludes future, expired, revoked, unknown, and subscription-owned targets', async () => {
    const { shopId } = await fixture('s3-invalid');
    await withTenant(shopId, async (trx) => {
      await grantAuthorization({
        shopId, targetKind: 'module', targetKey: 'wms', authorityKind: 'admin', authorityRef: 'future',
        lifecycleOwnerKind: 'admin', lifecycleOwnerRef: 'future', validFrom: new Date(Date.now() + 60_000),
      }, trx);
      await grantAuthorization({
        shopId, targetKind: 'module', targetKey: 'returns', authorityKind: 'admin', authorityRef: 'expired',
        lifecycleOwnerKind: 'admin', lifecycleOwnerRef: 'expired',
        validFrom: new Date(Date.now() - 120_000), validUntil: new Date(Date.now() - 60_000),
      }, trx);
      const revoked = await grantAuthorization({
        shopId, targetKind: 'module', targetKey: 'demand', authorityKind: 'admin', authorityRef: 'revoked',
        lifecycleOwnerKind: 'admin', lifecycleOwnerRef: 'revoked',
      }, trx);
      await revokeAuthorization(shopId, { authorizationId: revoked.authorizationId }, {
        revokedByKind: 'admin', revokedByRef: 'test', reason: 'closed',
      }, trx);
      await grantAuthorization({
        shopId, targetKind: 'module', targetKey: 'unknown-target', authorityKind: 'admin', authorityRef: 'unknown',
        lifecycleOwnerKind: 'admin', lifecycleOwnerRef: 'unknown',
      }, trx);
      await grantAuthorization({
        shopId, targetKind: 'module', targetKey: 'floor-planning',
        authorityKind: 'subscription', authorityRef: 'foreign-subscription',
        lifecycleOwnerKind: 'subscription', lifecycleOwnerRef: 'foreign-subscription',
        provider: 'shopify', providerSubscriptionId: 'foreign-provider-id',
      }, trx);
    });
    const access = await resolveEffectiveAccessForShop(shopId);
    expect([...access.modules]).toEqual([...modulesForTier('starter')]);
  });

  it('keeps overlap effective until the final independent authority is revoked', async () => {
    const { shopId } = await fixture('s3-overlap');
    const first = await grant(shopId, 'module', 'returns', 'admin-one');
    const second = await grant(shopId, 'module', 'returns', 'admin-two');
    await withTenant(shopId, (trx) => revokeAuthorization(shopId, { authorizationId: first.authorizationId }, {
      revokedByKind: 'admin', revokedByRef: 'test', reason: 'first-closed',
    }, trx));
    expect((await resolveEffectiveAccessForShop(shopId)).modules.has('returns')).toBe(true);
    await withTenant(shopId, (trx) => revokeAuthorization(shopId, { authorizationId: second.authorizationId }, {
      revokedByKind: 'admin', revokedByRef: 'test', reason: 'second-closed',
    }, trx));
    expect((await resolveEffectiveAccessForShop(shopId)).modules.has('returns')).toBe(false);
  });

  it('never lets another tenant authorization influence the requested shop', async () => {
    const first = await fixture('s3-tenant-a');
    const second = await fixture('s3-tenant-b');
    await grant(second.shopId, 'module', 'wms', 'tenant-b-admin');
    const access = await resolveEffectiveAccessForShop(first.shopId);
    expect(access.shopId).toBe(first.shopId);
    expect(access.modules.has('wms')).toBe(false);
  });

  it('preserves eligible legacy compatibility while excluding historical and closed rows', async () => {
    const { shopId } = await fixture('s3-legacy');
    await legacy(shopId, { module_key: 'wms', source: 'admin' });
    await legacy(shopId, { module_key: 'returns', source: 'migration' });
    await legacy(shopId, { module_key: 'demand', source: 'billing' });
    await legacy(shopId, { module_key: 'floor-planning', source: 'billing:stripe' });
    await legacy(shopId, { module_key: 'problem-center', source: 'admin', valid_until: new Date(Date.now() - 1_000) });
    await legacy(shopId, { module_key: 'alerts', flag_key: 'alerts.rules', source: 'migration' });
    const access = await resolveEffectiveAccessForShop(shopId);
    expect(access.modules.has('wms')).toBe(true);
    expect(access.modules.has('returns')).toBe(true);
    expect(access.modules.has('demand')).toBe(true);
    expect(access.modules.has('floor-planning')).toBe(false);
    expect(access.modules.has('problem-center')).toBe(false);
    expect(access.flags.has('alerts.rules')).toBe(true);
  });

  it('deduplicates tier, legacy, and independent targets without mutating persistence', async () => {
    const { shopId } = await fixture('s3-dedup', 'core');
    await legacy(shopId, { module_key: 'wms', source: 'admin' });
    await grant(shopId, 'module', 'wms', 'admin-wms');
    const before = await withTenant(shopId, async (trx) => ({
      legacy: Number((await trx('shop_module_entitlements').count('* as count'))[0].count),
      auth: Number((await trx('shop_authorizations').count('* as count'))[0].count),
    }));
    const access = await resolveEffectiveAccessForShop(shopId);
    expect([...access.modules].filter((key) => key === 'wms')).toHaveLength(1);
    const after = await withTenant(shopId, async (trx) => ({
      legacy: Number((await trx('shop_module_entitlements').count('* as count'))[0].count),
      auth: Number((await trx('shop_authorizations').count('* as count'))[0].count),
    }));
    expect(after).toEqual(before);
  });

  it('converges entitlement, activation-input, shop-service, and middleware decisions on one fresh snapshot', async () => {
    const { shopId, userId } = await fixture('s3-readers', 'growth');
    await grant(shopId, 'flag', 'exports.column_selection', 'admin-export');
    const effective = await resolveEffectiveAccessForShop(shopId);
    const entitlements = await EntitlementsService.getForUser(userId);
    expect(new Set(entitlements!.modules)).toEqual(effective.modules);
    expect(new Set(entitlements!.flags)).toEqual(effective.flags);
    expect((await resolveShopCapabilityDecision(shopId, 'exports.column_selection')).decision.allowed).toBe(true);

    const req: any = { user: { userId, shopId, tier: 'starter' }, path: '/test', method: 'GET' };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    await requireCapability('exports.column_selection')(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('uses current authoritative tier and reflects committed revocation on the next middleware decision', async () => {
    const { shopId, userId } = await fixture('s3-freshness', 'core');
    const authorization = await grant(shopId, 'module', 'wms', 'admin-fresh');
    const request = () => ({ user: { userId, shopId, tier: 'scale' }, path: '/test', method: 'GET' } as any);
    const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() } as any);
    let res = response();
    let next = jest.fn();
    await requireCapability('warehouse.operations')(request(), res, next);
    expect(next).toHaveBeenCalledWith();

    await withTenant(shopId, (trx) => revokeAuthorization(shopId, { authorizationId: authorization.authorizationId }, {
      revokedByKind: 'admin', revokedByRef: 'test', reason: 'fresh-revoke',
    }, trx));
    res = response();
    next = jest.fn();
    await requireCapability('warehouse.operations')(request(), res, next);
    // Core tier still includes WMS; downgrade proves the middleware ignores stale req.user.tier.
    await withTenant(shopId, (trx) => trx('shop_subscriptions').where({ shop_id: shopId }).update({ tier: 'starter' }));
    res = response();
    next = jest.fn();
    await requireCapability('warehouse.operations')(request(), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'TIER_TOO_LOW', currentTier: 'starter' }));
  });

  it('fails closed through next(error) when authoritative shop truth cannot be resolved', async () => {
    const req: any = { user: { userId: 999999, shopId: 2147483000, tier: 'scale' }, path: '/test', method: 'GET' };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    await requireCapability('warehouse.operations')(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
  });
});
