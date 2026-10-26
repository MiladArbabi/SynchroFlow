import crypto from 'crypto';
import {
  systemTransaction,
  setTenantContext,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { transitionShopSubscription } from 'api-src/services/billing/subscriptionTransition.service';
import {
  grantAuthorization,
  processAuthorizationEvent,
  type TrustedAuthorizationEvent,
} from 'api-src/services/billing/shopAuthorizationLifecycle.service';

async function fixture(): Promise<number> {
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(
      trx,
      `w1b-s4-composition-${crypto.randomUUID()}`
    );
    await setTenantContext(trx, id);
    return id;
  });

  await withTenant(shopId, (trx) =>
    trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'starter',
      status: 'active',
      billing_provider: 'stripe',
    })
  );

  return shopId;
}

function grantEvent(
  shopId: number,
  sourceEventKey: string
): TrustedAuthorizationEvent {
  return {
    shopId,
    operation: 'grant',
    authorityKind: 'admin',
    authorityRef: `s4-admin-${shopId}`,
    sourceEventKey,
    targetKind: 'module',
    targetKey: 'demand',
    lifecycleOwnerKind: 'admin',
    lifecycleOwnerRef: `s4-admin-${shopId}`,
  };
}

async function state(shopId: number) {
  return withTenant(shopId, async (trx) => ({
    subscription: await trx('shop_subscriptions')
      .where({ shop_id: shopId })
      .first('tier', 'status', 'billing_provider'),

    ledger: await trx('shop_subscription_transitions')
      .where({ shop_id: shopId })
      .orderBy('id')
      .select('id', 'from_tier', 'to_tier', 'source'),

    authorizations: await trx('shop_authorizations')
      .where({ shop_id: shopId })
      .orderBy('id')
      .select('id', 'target_key', 'authority_kind', 'revoked_at'),

    events: await trx('shop_authorization_events')
      .where({ shop_id: shopId })
      .orderBy('id')
      .select('id', 'source_event_key', 'payload_hash'),

    legacy: await trx('shop_module_entitlements')
      .where({ shop_id: shopId })
      .orderBy('id')
      .select('id', 'module_key', 'flag_key', 'source'),
  }));
}

async function compose(
  shopId: number,
  event: TrustedAuthorizationEvent,
  injectFailure = false
) {
  return withTenant(shopId, async (trx) => {
    const transition = await transitionShopSubscription({
      shopId,
      to: {
        tier: 'core',
        status: 'active',
        billingProvider: 'stripe',
      },
      source: 'w1b_s4_composition_test',
      reason: 'verified_transaction_composition',
      actorType: 'system',
      idempotencyKey: `s4-transition-${shopId}`,
    }, trx);

    if (!transition.applied) {
      throw new Error('S4_TRANSITION_NOT_APPLIED');
    }

    // Existing W1-A-compatible tier projection.
    // Not an independent authorization.
    await EntitlementsService.applyFromCommercialGrant(trx, [{
      shop_id: shopId,
      module_key: 'wms',
      flag_key: null,
      source: 'tier:core',
    }]);

    // Separately owned authorization, not a tier materialization.
    const result = await processAuthorizationEvent(event, trx);

    if (result.outcome !== 'applied') {
      throw new Error(`S4_AUTH_EVENT_${result.outcome.toUpperCase()}`);
    }

    if (injectFailure) {
      throw new Error('S4_INJECTED_AFTER_ALL_WRITES');
    }

    return { transition, result };
  });
}

describe('W1-B S4 — transaction composition only', () => {
  it('commits tier, ledger, compatibility projection and independent authorization together', async () => {
    const shopId = await fixture();

    const result = await compose(
      shopId,
      grantEvent(shopId, 's4-commit')
    );

    expect(result.transition.applied).toBe(true);
    expect(result.result.outcome).toBe('applied');

    const after = await state(shopId);

    expect(after.subscription).toMatchObject({
      tier: 'core',
      status: 'active',
      billing_provider: 'stripe',
    });

    expect(after.ledger).toHaveLength(1);
    expect(after.ledger[0]).toMatchObject({
      from_tier: 'starter',
      to_tier: 'core',
    });

    expect(after.legacy).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          module_key: 'wms',
          source: 'tier:core',
        }),
      ])
    );

    expect(after.authorizations).toEqual([
      expect.objectContaining({
        target_key: 'demand',
        authority_kind: 'admin',
        revoked_at: null,
      }),
    ]);

    expect(after.events).toHaveLength(1);
    expect(after.events[0].source_event_key).toBe('s4-commit');
  });

  it('rolls back all four write surfaces after an injected failure', async () => {
    const shopId = await fixture();

    // An unrelated independent authority must survive rollback.
    await withTenant(shopId, (trx) =>
      grantAuthorization({
        shopId,
        targetKind: 'module',
        targetKey: 'demand',
        authorityKind: 'migration',
        authorityRef: 'existing-migration',
        lifecycleOwnerKind: 'migration',
        lifecycleOwnerRef: 'existing-migration',
      }, trx)
    );

    const before = await state(shopId);

    await expect(
      compose(
        shopId,
        grantEvent(shopId, 's4-rollback'),
        true
      )
    ).rejects.toThrow('S4_INJECTED_AFTER_ALL_WRITES');

    expect(await state(shopId)).toEqual(before);
  });

  it('rejects conflicting event identity and rolls back the attempted transition', async () => {
    const shopId = await fixture();

    const original = grantEvent(shopId, 's4-conflict');

    const first = await withTenant(shopId, (trx) =>
      processAuthorizationEvent(original, trx)
    );

    expect(first.outcome).toBe('applied');

    const before = await state(shopId);

    // Same authority/event key, different target and payload.
    const conflicting = {
      ...original,
      targetKey: 'returns',
    };

    await expect(
      compose(shopId, conflicting)
    ).rejects.toThrow('S4_AUTH_EVENT_CONFLICT');

    expect(await state(shopId)).toEqual(before);
  });
});
