import crypto from 'crypto';
import { systemTransaction, setTenantContext, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import {
  grantAuthorization,
  processAuthorizationEvent,
  revokeAuthorization,
  type TrustedAuthorizationEvent,
} from 'api-src/services/billing/shopAuthorizationLifecycle.service';

const LOCK_NAMESPACE = 91002;

async function fixtureShop(prefix: string): Promise<number> {
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${prefix}-${crypto.randomBytes(6).toString('hex')}`);
    await setTenantContext(trx, id);
    return id;
  });
}

function event(shopId: number): TrustedAuthorizationEvent {
  return {
    shopId, operation: 'grant', authorityKind: 'admin', authorityRef: 'admin-1',
    sourceEventKey: 'evt-concurrent-identical', targetKind: 'module', targetKey: 'returns',
    lifecycleOwnerKind: 'admin', lifecycleOwnerRef: 'admin-1',
  };
}

describe('W1-B S2 R9 — real PostgreSQL concurrency', () => {
  it('same-shop work visibly waits on the canonical 91002 advisory lock', async () => {
    const shopId = await fixtureShop('w1b-s2-lock-proof');
    let announcePid!: (pid: number) => void;
    const pidReady = new Promise<number>((resolve) => { announcePid = resolve; });
    let blockedGrant!: Promise<unknown>;

    await withTenant(shopId, async (holder) => {
      await holder.raw('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_NAMESPACE, shopId]);
      blockedGrant = withTenant(shopId, async (waiter) => {
        const { rows } = await waiter.raw('SELECT pg_backend_pid() AS pid');
        announcePid(rows[0].pid);
        return grantAuthorization({
          shopId, targetKind: 'module', targetKey: 'returns',
          authorityKind: 'admin', authorityRef: 'admin-1',
          lifecycleOwnerKind: 'admin', lifecycleOwnerRef: 'admin-1',
        }, waiter);
      });

      const waiterPid = await pidReady;
      let observed: any;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const { rows } = await holder.raw(
          `SELECT wait_event_type, wait_event FROM pg_stat_activity WHERE pid = ?`,
          [waiterPid]
        );
        observed = rows[0];
        if (observed?.wait_event_type === 'Lock' && observed?.wait_event === 'advisory') break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(observed).toMatchObject({ wait_event_type: 'Lock', wait_event: 'advisory' });
    });

    await expect(blockedGrant).resolves.toMatchObject({ applied: true });
  });

  it('concurrent identical events produce one applied effect and one replay', async () => {
    const shopId = await fixtureShop('w1b-s2-concurrent-event');
    const [a, b] = await Promise.all([
      withTenant(shopId, (trx) => processAuthorizationEvent(event(shopId), trx)),
      withTenant(shopId, (trx) => processAuthorizationEvent(event(shopId), trx)),
    ]);
    expect([a.outcome, b.outcome].sort()).toEqual(['applied', 'replay']);
    const counts = await withTenant(shopId, async (trx) => ({
      authorizations: Number((await trx('shop_authorizations').where({ shop_id: shopId }).count('* as count'))[0].count),
      events: Number((await trx('shop_authorization_events').where({ shop_id: shopId }).count('* as count'))[0].count),
    }));
    expect(counts).toEqual({ authorizations: 1, events: 1 });
  });

  it('same-shop distinct authorities for one target both survive concurrent grants', async () => {
    const shopId = await fixtureShop('w1b-s2-concurrent-grants');
    await Promise.all([
      withTenant(shopId, (trx) => grantAuthorization({
        shopId, targetKind: 'module', targetKey: 'returns',
        authorityKind: 'admin', authorityRef: 'admin-1',
        lifecycleOwnerKind: 'admin', lifecycleOwnerRef: 'admin-1',
      }, trx)),
      withTenant(shopId, (trx) => grantAuthorization({
        shopId, targetKind: 'module', targetKey: 'returns',
        authorityKind: 'migration', authorityRef: 'migration-1',
        lifecycleOwnerKind: 'migration', lifecycleOwnerRef: 'migration-1',
      }, trx)),
    ]);
    const rows = await withTenant(shopId, (trx) => trx('shop_authorizations')
      .where({ shop_id: shopId, target_key: 'returns' }).whereNull('revoked_at')
      .select('authority_kind'));
    expect(rows.map((row: any) => row.authority_kind).sort()).toEqual(['admin', 'migration']);
  });

  it('grant racing lifecycle-owner revocation serializes without revoking another authority', async () => {
    const shopId = await fixtureShop('w1b-s2-grant-revoke');
    await withTenant(shopId, (trx) => grantAuthorization({
      shopId, targetKind: 'module', targetKey: 'returns',
      authorityKind: 'subscription', authorityRef: 'subscription-1',
      lifecycleOwnerKind: 'subscription', lifecycleOwnerRef: 'subscription-1',
      provider: 'stripe', providerSubscriptionId: 'sub_test_1',
    }, trx));
    await Promise.all([
      withTenant(shopId, (trx) => grantAuthorization({
        shopId, targetKind: 'module', targetKey: 'returns',
        authorityKind: 'admin', authorityRef: 'admin-1',
        lifecycleOwnerKind: 'admin', lifecycleOwnerRef: 'admin-1',
      }, trx)),
      withTenant(shopId, (trx) => revokeAuthorization(shopId, {
        lifecycleOwnerKind: 'subscription', lifecycleOwnerRef: 'subscription-1',
      }, {
        revokedByKind: 'system', revokedByRef: 'test', reason: 'subscription_closed',
      }, trx)),
    ]);
    const rows = await withTenant(shopId, (trx) => trx('shop_authorizations')
      .where({ shop_id: shopId }).select('authority_kind', 'revoked_at'));
    expect(rows.find((row: any) => row.authority_kind === 'admin')?.revoked_at).toBeNull();
    expect(rows.find((row: any) => row.authority_kind === 'subscription')?.revoked_at).not.toBeNull();
  });

  it('different-shop authorization work completes while another shop lock is held', async () => {
    const shopA = await fixtureShop('w1b-s2-independent-a');
    const shopB = await fixtureShop('w1b-s2-independent-b');
    let completedB = false;
    await withTenant(shopA, async (trx) => {
      await trx.raw('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_NAMESPACE, shopA]);
      await withTenant(shopB, (otherTrx) => grantAuthorization({
        shopId: shopB, targetKind: 'module', targetKey: 'returns',
        authorityKind: 'admin', authorityRef: 'admin-1',
        lifecycleOwnerKind: 'admin', lifecycleOwnerRef: 'admin-1',
      }, otherTrx));
      completedB = true;
    });
    expect(completedB).toBe(true);
  });
});
