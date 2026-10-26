import crypto from 'crypto';
import { systemTransaction, setTenantContext, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import {
  grantAuthorization,
  revokeAuthorization,
} from 'api-src/services/billing/shopAuthorizationLifecycle.service';

async function fixtureShop(prefix: string): Promise<number> {
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${prefix}-${crypto.randomBytes(6).toString('hex')}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function openAuthorities(shopId: number, targetKind: string, targetKey: string): Promise<string[]> {
  const rows = await withTenant(shopId, (trx) => trx('shop_authorizations')
    .where({ shop_id: shopId, target_kind: targetKind, target_key: targetKey })
    .whereNull('revoked_at').select('authority_kind'));
  return rows.map((row: any) => row.authority_kind).sort();
}

describe('W1-B R1/R2/R4/R5/R8 — independent overlapping authorities', () => {
  it('R1/R2/R5: the new authorization schema permits distinct active authorities for one target', async () => {
    const shopId = await fixtureShop('w1b-r5-new');
    await withTenant(shopId, (trx) => trx('shop_authorizations').insert([
      {
        shop_id: shopId,
        target_kind: 'module', target_key: 'returns',
        authority_kind: 'admin', authority_ref: 'admin-1',
        lifecycle_owner_kind: 'admin', lifecycle_owner_ref: 'admin-1',
      },
      {
        shop_id: shopId,
        target_kind: 'module', target_key: 'returns',
        authority_kind: 'subscription', authority_ref: 'stripe-sub-1',
        lifecycle_owner_kind: 'subscription', lifecycle_owner_ref: 'stripe-sub-1',
        provider: 'stripe', provider_subscription_id: 'sub_test_1',
      },
      {
        shop_id: shopId,
        target_kind: 'module', target_key: 'returns',
        authority_kind: 'migration', authority_ref: 'migration-1',
        lifecycle_owner_kind: 'migration', lifecycle_owner_ref: 'migration-1',
      },
    ]));

    const rows = await withTenant(shopId, (trx) => trx('shop_authorizations')
      .where({ shop_id: shopId, target_kind: 'module', target_key: 'returns' })
      .whereNull('revoked_at').select('authority_kind'));
    expect(rows.map((row: any) => row.authority_kind).sort()).toEqual([
      'admin', 'migration', 'subscription',
    ]);
  });

  it('R1/R5 SEC-07: admin and subscription authorities coexist on one module and are revoked independently', async () => {
    const shopId = await fixtureShop('w1b-r1');
    const ids = await withTenant(shopId, async (trx) => ({
      admin: (await grantAuthorization({
        shopId, targetKind: 'module', targetKey: 'returns',
        authorityKind: 'admin', authorityRef: 'admin-1',
        lifecycleOwnerKind: 'admin', lifecycleOwnerRef: 'admin-1',
      }, trx)).authorizationId,
      subscription: (await grantAuthorization({
        shopId, targetKind: 'module', targetKey: 'returns',
        authorityKind: 'subscription', authorityRef: 'stripe-sub-1',
        lifecycleOwnerKind: 'subscription', lifecycleOwnerRef: 'stripe-sub-1',
        provider: 'stripe', providerSubscriptionId: 'sub_test_1',
      }, trx)).authorizationId,
    }));
    expect(ids.admin).not.toBe(ids.subscription);
    expect(await openAuthorities(shopId, 'module', 'returns')).toEqual(['admin', 'subscription']);

    const closedSubscription = await withTenant(shopId, (trx) => revokeAuthorization(shopId, {
      lifecycleOwnerKind: 'subscription', lifecycleOwnerRef: 'stripe-sub-1',
    }, { revokedByKind: 'system', revokedByRef: 'stripe', reason: 'subscription_closed' }, trx));
    expect(closedSubscription.authorizationIds).toEqual([ids.subscription]);
    expect(await openAuthorities(shopId, 'module', 'returns')).toEqual(['admin']);

    const closedAdmin = await withTenant(shopId, (trx) => revokeAuthorization(shopId, {
      authorizationId: ids.admin,
    }, { revokedByKind: 'admin', revokedByRef: 'admin-2', reason: 'manual_revoke' }, trx));
    expect(closedAdmin.authorizationIds).toEqual([ids.admin]);
    expect(await openAuthorities(shopId, 'module', 'returns')).toEqual([]);

    // Legacy persistence keeps its single-open-row restriction; overlap lives only in shop_authorizations.
    await expect(withTenant(shopId, async (trx) => {
      await trx('shop_module_entitlements').insert({
        shop_id: shopId, module_key: 'returns', flag_key: null, source: 'admin',
      });
      await trx('shop_module_entitlements').insert({
        shop_id: shopId, module_key: 'returns', flag_key: null, source: 'billing:stripe',
      });
    })).rejects.toMatchObject({ code: '23505', constraint: 'shop_module_entitlements_open_module_unique' });
  });

  it('R2/R5 SEC-08: migration and subscription authorities coexist on one flag and are revoked independently', async () => {
    const shopId = await fixtureShop('w1b-r2');
    const ids = await withTenant(shopId, async (trx) => ({
      migration: (await grantAuthorization({
        shopId, targetKind: 'flag', targetKey: 'returns.analysis',
        authorityKind: 'migration', authorityRef: 'migration-1',
        lifecycleOwnerKind: 'migration', lifecycleOwnerRef: 'migration-1',
      }, trx)).authorizationId,
      subscription: (await grantAuthorization({
        shopId, targetKind: 'flag', targetKey: 'returns.analysis',
        authorityKind: 'subscription', authorityRef: 'stripe-sub-1',
        lifecycleOwnerKind: 'subscription', lifecycleOwnerRef: 'stripe-sub-1',
        provider: 'stripe', providerSubscriptionId: 'sub_test_1',
      }, trx)).authorizationId,
    }));
    expect(ids.migration).not.toBe(ids.subscription);
    expect(await openAuthorities(shopId, 'flag', 'returns.analysis')).toEqual(['migration', 'subscription']);

    const closedMigration = await withTenant(shopId, (trx) => revokeAuthorization(shopId, {
      lifecycleOwnerKind: 'migration', lifecycleOwnerRef: 'migration-1',
    }, { revokedByKind: 'system', revokedByRef: 'migration', reason: 'migration_retired' }, trx));
    expect(closedMigration.authorizationIds).toEqual([ids.migration]);
    expect(await openAuthorities(shopId, 'flag', 'returns.analysis')).toEqual(['subscription']);

    const closedSubscription = await withTenant(shopId, (trx) => revokeAuthorization(shopId, {
      authorizationId: ids.subscription,
    }, { revokedByKind: 'system', revokedByRef: 'stripe', reason: 'subscription_closed' }, trx));
    expect(closedSubscription.authorizationIds).toEqual([ids.subscription]);
    expect(await openAuthorities(shopId, 'flag', 'returns.analysis')).toEqual([]);

    await expect(withTenant(shopId, async (trx) => {
      await trx('shop_module_entitlements').insert({
        shop_id: shopId, module_key: 'returns', flag_key: 'returns.analysis', source: 'migration',
      });
      await trx('shop_module_entitlements').insert({
        shop_id: shopId, module_key: 'returns', flag_key: 'returns.analysis', source: 'billing:stripe',
      });
    })).rejects.toMatchObject({ code: '23505', constraint: 'shop_module_entitlements_shop_id_module_key_flag_key_unique' });
  });

  it('R4/R8: authorization identity and lifecycle ownership are separate durable fields, not reconstructed from source', async () => {
    const shopId = await fixtureShop('w1b-r4');
    const { rows } = await withTenant(shopId, (trx) => trx.raw(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'shop_authorizations'
          AND column_name IN ('authority_kind','authority_ref','lifecycle_owner_kind','lifecycle_owner_ref')`
    ));
    expect(rows.map((row: any) => row.column_name).sort()).toEqual([
      'authority_kind', 'authority_ref', 'lifecycle_owner_kind', 'lifecycle_owner_ref',
    ]);
  });
});
