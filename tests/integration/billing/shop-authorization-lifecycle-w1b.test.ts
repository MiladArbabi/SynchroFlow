import crypto from 'crypto';
import type { Knex } from 'knex';
import { systemTransaction, setTenantContext, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import {
  grantAuthorization,
  processAuthorizationEvent,
  revokeAuthorization,
  type TrustedAuthorizationEvent,
} from 'api-src/services/billing/shopAuthorizationLifecycle.service';

async function fixtureShop(prefix: string): Promise<number> {
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${prefix}-${crypto.randomBytes(6).toString('hex')}`);
    await setTenantContext(trx, id);
    return id;
  });
}

function grantEvent(shopId: number, overrides: Partial<TrustedAuthorizationEvent> = {}): TrustedAuthorizationEvent {
  return {
    shopId,
    operation: 'grant',
    authorityKind: 'admin',
    authorityRef: 'admin-1',
    sourceEventKey: `evt-${crypto.randomBytes(8).toString('hex')}`,
    targetKind: 'module',
    targetKey: 'returns',
    lifecycleOwnerKind: 'admin',
    lifecycleOwnerRef: 'admin-1',
    ...overrides,
  };
}

describe('W1-B S2 — trusted authorization lifecycle', () => {
  it('R1/R2/R4/R5: revoking subscription ownership preserves overlapping admin and migration authorities', async () => {
    const shopId = await fixtureShop('w1b-s2-overlap');
    const ids = await withTenant(shopId, async (trx) => {
      const admin = await grantAuthorization({
        shopId, targetKind: 'module', targetKey: 'returns',
        authorityKind: 'admin', authorityRef: 'admin-1',
        lifecycleOwnerKind: 'admin', lifecycleOwnerRef: 'admin-1',
      }, trx);
      const migration = await grantAuthorization({
        shopId, targetKind: 'module', targetKey: 'returns',
        authorityKind: 'migration', authorityRef: 'migration-1',
        lifecycleOwnerKind: 'migration', lifecycleOwnerRef: 'migration-1',
      }, trx);
      const subscription = await grantAuthorization({
        shopId, targetKind: 'module', targetKey: 'returns',
        authorityKind: 'subscription', authorityRef: 'subscription-1',
        lifecycleOwnerKind: 'subscription', lifecycleOwnerRef: 'subscription-1',
        provider: 'stripe', providerSubscriptionId: 'sub_test_1',
      }, trx);
      const revoked = await revokeAuthorization(shopId, {
        lifecycleOwnerKind: 'subscription', lifecycleOwnerRef: 'subscription-1',
      }, {
        revokedByKind: 'system', revokedByRef: 'test', reason: 'subscription_closed',
      }, trx);
      expect(revoked.authorizationIds).toEqual([subscription.authorizationId]);
      return { admin: admin.authorizationId, migration: migration.authorizationId, subscription: subscription.authorizationId };
    });

    const rows = await withTenant(shopId, (trx) => trx('shop_authorizations')
      .whereIn('id', [ids.admin, ids.migration, ids.subscription])
      .select('id', 'authority_kind', 'revoked_at'));
    expect(rows.find((row: any) => row.id === ids.admin)?.revoked_at).toBeNull();
    expect(rows.find((row: any) => row.id === ids.migration)?.revoked_at).toBeNull();
    expect(rows.find((row: any) => row.id === ids.subscription)?.revoked_at).not.toBeNull();
  });

  it('R3/R4: targeted revocation preserves identity/provenance and permits safe regrant after closure', async () => {
    const shopId = await fixtureShop('w1b-s2-regrant');
    const result = await withTenant(shopId, async (trx) => {
      const first = await grantAuthorization({
        shopId, targetKind: 'flag', targetKey: 'returns.analysis',
        authorityKind: 'admin', authorityRef: 'admin-1',
        lifecycleOwnerKind: 'admin', lifecycleOwnerRef: 'owner-1',
      }, trx);
      await revokeAuthorization(shopId, { authorizationId: first.authorizationId }, {
        revokedByKind: 'admin', revokedByRef: 'admin-2', reason: 'manual_revoke',
      }, trx);
      const second = await grantAuthorization({
        shopId, targetKind: 'flag', targetKey: 'returns.analysis',
        authorityKind: 'admin', authorityRef: 'admin-1',
        lifecycleOwnerKind: 'admin', lifecycleOwnerRef: 'owner-1',
      }, trx);
      return { first, second };
    });
    expect(result.first.authorizationId).not.toBe(result.second.authorizationId);
    const rows = await withTenant(shopId, (trx) => trx('shop_authorizations')
      .where({ shop_id: shopId, target_kind: 'flag', target_key: 'returns.analysis' })
      .orderBy('created_at').select('*'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      authority_kind: 'admin', authority_ref: 'admin-1',
      lifecycle_owner_kind: 'admin', lifecycle_owner_ref: 'owner-1',
      revoked_by_kind: 'admin', revoked_by_ref: 'admin-2', revocation_reason: 'manual_revoke',
    });
    expect(rows[1].revoked_at).toBeNull();
  });

  it('R6: first delivery applies once and identical replay makes no additional effect', async () => {
    const shopId = await fixtureShop('w1b-s2-replay');
    const event = grantEvent(shopId, { sourceEventKey: 'evt-replay-1' });
    const first = await withTenant(shopId, (trx) => processAuthorizationEvent(event, trx));
    const replay = await withTenant(shopId, (trx) => processAuthorizationEvent({ ...event }, trx));
    expect(first.outcome).toBe('applied');
    expect(replay).toMatchObject({ outcome: 'replay', eventId: first.eventId });
    const counts = await withTenant(shopId, async (trx) => ({
      authorizations: Number((await trx('shop_authorizations').where({ shop_id: shopId }).count('* as count'))[0].count),
      events: Number((await trx('shop_authorization_events').where({ shop_id: shopId }).count('* as count'))[0].count),
    }));
    expect(counts).toEqual({ authorizations: 1, events: 1 });
  });

  it('R6: same key with different payload returns conflict with zero additional effects', async () => {
    const shopId = await fixtureShop('w1b-s2-conflict');
    const firstEvent = grantEvent(shopId, { sourceEventKey: 'evt-conflict-1' });
    const first = await withTenant(shopId, (trx) => processAuthorizationEvent(firstEvent, trx));
    const conflict = await withTenant(shopId, (trx) => processAuthorizationEvent({
      ...firstEvent, targetKey: 'wms',
    }, trx));
    expect(first.outcome).toBe('applied');
    expect(conflict.outcome).toBe('conflict');
    const counts = await withTenant(shopId, async (trx) => ({
      authorizations: Number((await trx('shop_authorizations').where({ shop_id: shopId }).count('* as count'))[0].count),
      events: Number((await trx('shop_authorization_events').where({ shop_id: shopId }).count('* as count'))[0].count),
    }));
    expect(counts).toEqual({ authorizations: 1, events: 1 });
  });

  it('R6: unrelated SQLSTATE 23505 propagates and is never reported as replay', async () => {
    const shopId = await fixtureShop('w1b-s2-23505');
    const duplicateId = crypto.randomUUID();
    await withTenant(shopId, (trx) => grantAuthorization({
      authorizationId: duplicateId,
      shopId, targetKind: 'module', targetKey: 'returns',
      authorityKind: 'admin', authorityRef: 'admin-existing',
      lifecycleOwnerKind: 'admin', lifecycleOwnerRef: 'admin-existing',
    }, trx));

    await expect(withTenant(shopId, (trx) => processAuthorizationEvent(grantEvent(shopId, {
      authorizationId: duplicateId,
      sourceEventKey: 'evt-unrelated-23505',
      targetKey: 'wms',
      authorityRef: 'admin-new', lifecycleOwnerRef: 'admin-new',
    }), trx))).rejects.toMatchObject({ code: '23505' });

    const events = await withTenant(shopId, (trx) => trx('shop_authorization_events')
      .where({ shop_id: shopId, source_event_key: 'evt-unrelated-23505' }));
    expect(events).toHaveLength(0);
  });

  it('R10: caller tenant mismatch rejects cross-tenant grant and revocation', async () => {
    const shopA = await fixtureShop('w1b-s2-tenant-a');
    const shopB = await fixtureShop('w1b-s2-tenant-b');
    const authorization = await withTenant(shopA, (trx) => grantAuthorization({
      shopId: shopA, targetKind: 'module', targetKey: 'returns',
      authorityKind: 'admin', authorityRef: 'admin-1',
      lifecycleOwnerKind: 'admin', lifecycleOwnerRef: 'admin-1',
    }, trx));
    await expect(withTenant(shopB, (trx) => grantAuthorization({
      shopId: shopA, targetKind: 'module', targetKey: 'wms',
      authorityKind: 'admin', authorityRef: 'admin-2',
      lifecycleOwnerKind: 'admin', lifecycleOwnerRef: 'admin-2',
    }, trx))).rejects.toThrow('caller tenant does not match');
    await expect(withTenant(shopB, (trx) => revokeAuthorization(shopA, {
      authorizationId: authorization.authorizationId,
    }, {
      revokedByKind: 'admin', revokedByRef: 'admin-2', reason: 'cross_tenant',
    }, trx))).rejects.toThrow('caller tenant does not match');
  });

  it('R11: caller rollback removes both a newly applied event and authorization', async () => {
    const shopId = await fixtureShop('w1b-s2-rollback');
    await expect(withTenant(shopId, async (trx) => {
      await processAuthorizationEvent(grantEvent(shopId, { sourceEventKey: 'evt-rollback-1' }), trx);
      throw new Error('W1B_S2_INJECTED_ROLLBACK');
    })).rejects.toThrow('W1B_S2_INJECTED_ROLLBACK');
    const counts = await withTenant(shopId, async (trx) => ({
      authorizations: Number((await trx('shop_authorizations').where({ shop_id: shopId }).count('* as count'))[0].count),
      events: Number((await trx('shop_authorization_events').where({ shop_id: shopId }).count('* as count'))[0].count),
    }));
    expect(counts).toEqual({ authorizations: 0, events: 0 });
  });

  it('R11: caller rollback restores a revoked authorization', async () => {
    const shopId = await fixtureShop('w1b-s2-revoke-rollback');
    const authorization = await withTenant(shopId, (trx) => grantAuthorization({
      shopId, targetKind: 'module', targetKey: 'returns',
      authorityKind: 'admin', authorityRef: 'admin-1',
      lifecycleOwnerKind: 'admin', lifecycleOwnerRef: 'admin-1',
    }, trx));
    await expect(withTenant(shopId, async (trx) => {
      await revokeAuthorization(shopId, { authorizationId: authorization.authorizationId }, {
        revokedByKind: 'admin', revokedByRef: 'admin-2', reason: 'rollback',
      }, trx);
      throw new Error('W1B_S2_REVOKE_ROLLBACK');
    })).rejects.toThrow('W1B_S2_REVOKE_ROLLBACK');
    const row = await withTenant(shopId, (trx) => trx('shop_authorizations')
      .where({ id: authorization.authorizationId }).first('revoked_at', 'valid_until'));
    expect(row).toEqual({ revoked_at: null, valid_until: null });
  });

  it('R11: event persistence failure rolls back the preceding authorization mutation', async () => {
    const shopId = await fixtureShop('w1b-s2-event-failure');
    await expect(withTenant(shopId, (trx) => processAuthorizationEvent(grantEvent(shopId, {
      sourceEventKey: 'x'.repeat(256),
    }), trx))).rejects.toMatchObject({ code: '23514' });
    const counts = await withTenant(shopId, async (trx) => ({
      authorizations: Number((await trx('shop_authorizations').where({ shop_id: shopId }).count('* as count'))[0].count),
      events: Number((await trx('shop_authorization_events').where({ shop_id: shopId }).count('* as count'))[0].count),
    }));
    expect(counts).toEqual({ authorizations: 0, events: 0 });
  });

  it('R11/R12: S2 writes do not touch subscriptions, transition ledger, or legacy entitlements', async () => {
    const shopId = await fixtureShop('w1b-s2-no-legacy');
    const before = await withTenant(shopId, async (trx) => ({
      subscriptions: Number((await trx('shop_subscriptions').where({ shop_id: shopId }).count('* as count'))[0].count),
      transitions: Number((await trx('shop_subscription_transitions').where({ shop_id: shopId }).count('* as count'))[0].count),
      legacy: Number((await trx('shop_module_entitlements').where({ shop_id: shopId }).count('* as count'))[0].count),
    }));
    await withTenant(shopId, (trx) => processAuthorizationEvent(grantEvent(shopId), trx));
    const after = await withTenant(shopId, async (trx) => ({
      subscriptions: Number((await trx('shop_subscriptions').where({ shop_id: shopId }).count('* as count'))[0].count),
      transitions: Number((await trx('shop_subscription_transitions').where({ shop_id: shopId }).count('* as count'))[0].count),
      legacy: Number((await trx('shop_module_entitlements').where({ shop_id: shopId }).count('* as count'))[0].count),
    }));
    expect(after).toEqual(before);
  });
});
