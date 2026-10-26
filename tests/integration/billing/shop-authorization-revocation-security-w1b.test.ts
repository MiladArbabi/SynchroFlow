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

const PROVENANCE_COLUMNS = [
  'revoked_at', 'revoked_by_kind', 'revoked_by_ref', 'revocation_reason', 'valid_from', 'valid_until',
];

async function fixtureShop(prefix: string): Promise<number> {
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${prefix}-${crypto.randomBytes(6).toString('hex')}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function grantAdmin(shopId: number, ref = 'admin-1', validUntil: Date | null = null): Promise<string> {
  const result = await withTenant(shopId, (trx) => grantAuthorization({
    shopId, targetKind: 'module', targetKey: 'returns',
    authorityKind: 'admin', authorityRef: ref,
    lifecycleOwnerKind: 'admin', lifecycleOwnerRef: ref,
    validFrom: new Date(Date.now() - 60_000),
    validUntil,
  }, trx));
  return result.authorizationId;
}

async function revokeAdmin(shopId: number, authorizationId: string): Promise<void> {
  await withTenant(shopId, (trx) => revokeAuthorization(shopId, { authorizationId }, {
    revokedByKind: 'admin', revokedByRef: 'admin-revoker', reason: 'manual_revoke',
  }, trx));
}

async function snapshot(shopId: number, authorizationId: string): Promise<Record<string, unknown>> {
  return withTenant(shopId, (trx) => trx('shop_authorizations')
    .where({ shop_id: shopId, id: authorizationId }).first(PROVENANCE_COLUMNS));
}

async function counts(shopId: number) {
  return withTenant(shopId, async (trx) => ({
    authorizations: Number((await trx('shop_authorizations').where({ shop_id: shopId }).count('* as count'))[0].count),
    revoked: Number((await trx('shop_authorizations').where({ shop_id: shopId }).whereNotNull('revoked_at').count('* as count'))[0].count),
    events: Number((await trx('shop_authorization_events').where({ shop_id: shopId }).count('* as count'))[0].count),
  }));
}

function directUpdate(shopId: number, authorizationId: string, patch: Record<string, unknown>) {
  return withTenant(shopId, (trx: Knex) => trx('shop_authorizations')
    .where({ shop_id: shopId, id: authorizationId }).update(patch));
}

function revokeEvent(shopId: number, overrides: Partial<TrustedAuthorizationEvent> = {}): TrustedAuthorizationEvent {
  return {
    shopId,
    operation: 'revoke',
    authorityKind: 'admin',
    authorityRef: 'admin-1',
    sourceEventKey: `evt-${crypto.randomBytes(8).toString('hex')}`,
    targetKind: 'module',
    targetKey: 'returns',
    lifecycleOwnerKind: 'admin',
    lifecycleOwnerRef: 'admin-1',
    revocation: { revokedByKind: 'admin', revokedByRef: 'admin-1', reason: 'event_revoke' },
    ...overrides,
  };
}

describe('W1-B security — revocation provenance is irreversible at the database boundary', () => {
  it('SEC-01: a revoked authorization cannot be unrevoked through direct UPDATE', async () => {
    const shopId = await fixtureShop('w1b-sec01');
    const id = await grantAdmin(shopId);
    await revokeAdmin(shopId, id);
    const before = await snapshot(shopId, id);

    await expect(directUpdate(shopId, id, {
      revoked_at: null, revoked_by_kind: null, revoked_by_ref: null, revocation_reason: null, valid_until: null,
    })).rejects.toThrow('[REVOCATION_IMMUTABILITY]');

    expect(await snapshot(shopId, id)).toEqual(before);
  });

  it('SEC-02: revocation timestamp, actor, reason, and closed interval cannot be rewritten', async () => {
    const shopId = await fixtureShop('w1b-sec02');
    const id = await grantAdmin(shopId);
    await revokeAdmin(shopId, id);
    const before = await snapshot(shopId, id);
    const later = new Date(Date.now() + 86_400_000);

    for (const patch of [
      { revoked_at: later },
      { revoked_by_kind: 'system' },
      { revoked_by_ref: 'someone-else' },
      { revocation_reason: 'rewritten' },
      { valid_until: later },
    ]) {
      await expect(directUpdate(shopId, id, patch)).rejects.toThrow('[REVOCATION_IMMUTABILITY]');
    }
    expect(await snapshot(shopId, id)).toEqual(before);
  });

  it('SEC-PROV: direct revocation requires non-whitespace actor, reference, and reason', async () => {
    const shopId = await fixtureShop('w1b-sec-provenance');
    const id = await grantAdmin(shopId);
    const before = await snapshot(shopId, id);
    const revokedAt = new Date();
    const validProvenance = {
      revoked_at: revokedAt,
      revoked_by_kind: 'admin',
      revoked_by_ref: 'admin-2',
      revocation_reason: 'manual',
      valid_until: revokedAt,
    };
    const provenanceFields = [
      'revoked_by_kind', 'revoked_by_ref', 'revocation_reason',
    ] as const;
    const incompleteValues = ['', '   ', '\t\t', '\n', ' \t\n '];

    for (const field of provenanceFields) {
      for (const value of incompleteValues) {
        await expect(directUpdate(shopId, id, {
          ...validProvenance,
          [field]: value,
        })).rejects.toMatchObject({ code: '23514' });
        expect(await snapshot(shopId, id)).toEqual(before);
      }
    }

    await expect(directUpdate(shopId, id, validProvenance)).resolves.toBe(1);
    expect(await snapshot(shopId, id)).toMatchObject(validProvenance);
  });

  it('SEC-03: direct revocation must close an open-ended authorization no later than revoked_at', async () => {
    const shopId = await fixtureShop('w1b-sec03-open');
    const id = await grantAdmin(shopId);
    const before = await snapshot(shopId, id);
    const revokedAt = new Date();
    const provenance = {
      revoked_at: revokedAt,
      revoked_by_kind: 'admin',
      revoked_by_ref: 'admin-2',
      revocation_reason: 'manual',
    };

    await expect(directUpdate(shopId, id, {
      ...provenance,
      valid_until: null,
    })).rejects.toMatchObject({ code: '23514' });
    expect(await snapshot(shopId, id)).toEqual(before);

    await expect(directUpdate(shopId, id, {
      ...provenance,
      valid_until: new Date(revokedAt.getTime() + 1),
    })).rejects.toMatchObject({ code: '23514' });
    expect(await snapshot(shopId, id)).toEqual(before);

    await expect(directUpdate(shopId, id, {
      ...provenance,
      valid_until: revokedAt,
    })).resolves.toBe(1);
    const revoked = await snapshot(shopId, id);
    expect(new Date(revoked.valid_until as string).getTime()).toBe(revokedAt.getTime());
    expect(new Date(revoked.revoked_at as string).getTime()).toBe(revokedAt.getTime());
  });

  it('SEC-03: revocation never extends an existing earlier expiration (service and direct UPDATE)', async () => {
    const shopId = await fixtureShop('w1b-sec03');
    const expiry = new Date(Date.now() - 30_000);
    const viaService = await grantAdmin(shopId, 'admin-service', expiry);
    await revokeAdmin(shopId, viaService);
    const serviceRow = await snapshot(shopId, viaService);
    expect(new Date(serviceRow.valid_until as string).getTime()).toBe(expiry.getTime());
    expect(serviceRow.revoked_at).not.toBeNull();

    const viaSql = await grantAdmin(shopId, 'admin-sql', expiry);
    const before = await snapshot(shopId, viaSql);
    const now = new Date();
    const validFrom = new Date(before.valid_from as string);
    const shortenedExpiry = new Date(
      validFrom.getTime() + Math.floor((expiry.getTime() - validFrom.getTime()) / 2)
    );
    await expect(directUpdate(shopId, viaSql, {
      revoked_at: now, revoked_by_kind: 'admin', revoked_by_ref: 'x', revocation_reason: 'shorten',
      valid_until: shortenedExpiry,
    })).rejects.toMatchObject({ code: '23514' });
    expect(await snapshot(shopId, viaSql)).toEqual(before);
    await expect(directUpdate(shopId, viaSql, {
      revoked_at: now, revoked_by_kind: 'admin', revoked_by_ref: 'x', revocation_reason: 'extend',
      valid_until: now,
    })).rejects.toThrow('[REVOCATION_IMMUTABILITY]');
    await expect(directUpdate(shopId, viaSql, {
      revoked_at: now, revoked_by_kind: 'admin', revoked_by_ref: 'x', revocation_reason: 'reopen',
      valid_until: null,
    })).rejects.toThrow('[REVOCATION_IMMUTABILITY]');
    expect(await snapshot(shopId, viaSql)).toEqual(before);

    await expect(directUpdate(shopId, viaSql, {
      revoked_at: now, revoked_by_kind: 'admin', revoked_by_ref: 'x', revocation_reason: 'preserve',
      valid_until: expiry,
    })).resolves.toBe(1);
    const revoked = await snapshot(shopId, viaSql);
    expect(new Date(revoked.valid_until as string).getTime()).toBe(expiry.getTime());
    expect(new Date(revoked.revoked_at as string).getTime()).toBe(now.getTime());
  });

  it('SEC-03/E: pre-revocation validity changes and active-to-revoked transitions remain legitimate', async () => {
    const shopId = await fixtureShop('w1b-sec03-legit');
    const id = await grantAdmin(shopId);
    const expiry = new Date(Date.now() + 3_600_000);
    await expect(directUpdate(shopId, id, { valid_until: expiry })).resolves.toBe(1);
    const revokedAt = new Date();
    await expect(directUpdate(shopId, id, {
      revoked_at: revokedAt, revoked_by_kind: 'admin', revoked_by_ref: 'admin-2',
      revocation_reason: 'manual', valid_until: revokedAt,
    })).resolves.toBe(1);
    const row = await snapshot(shopId, id);
    expect(row).toMatchObject({ revoked_by_kind: 'admin', revoked_by_ref: 'admin-2', revocation_reason: 'manual' });
    expect(new Date(row.valid_until as string).getTime()).toBe(revokedAt.getTime());
  });
});

describe('W1-B security — event revocation is scoped to the event authority', () => {
  it('SEC-04/SEC-05: an ID-targeted event from another authority fails closed with zero side effects', async () => {
    const shopId = await fixtureShop('w1b-sec04-id');
    const adminId = await grantAdmin(shopId);
    const before = { row: await snapshot(shopId, adminId), counts: await counts(shopId) };

    await expect(withTenant(shopId, (trx) => processAuthorizationEvent(revokeEvent(shopId, {
      authorityKind: 'migration', authorityRef: 'migration-1',
      lifecycleOwnerKind: 'migration', lifecycleOwnerRef: 'migration-1',
      authorizationId: adminId,
    }), trx))).rejects.toThrow('event revocation must resolve exactly one authorization');

    expect(await snapshot(shopId, adminId)).toEqual(before.row);
    expect(await counts(shopId)).toEqual(before.counts);
    expect(before.counts).toEqual({ authorizations: 1, revoked: 0, events: 0 });
  });

  it('SEC-04/SEC-05: an owner-scoped event from another authority cannot revoke that owner\'s authorization', async () => {
    const shopId = await fixtureShop('w1b-sec04-owner');
    const adminId = await grantAdmin(shopId);
    const before = { row: await snapshot(shopId, adminId), counts: await counts(shopId) };

    await expect(withTenant(shopId, (trx) => processAuthorizationEvent(revokeEvent(shopId, {
      authorityKind: 'migration', authorityRef: 'migration-1',
    }), trx))).rejects.toThrow('event revocation must resolve exactly one authorization');

    expect(await snapshot(shopId, adminId)).toEqual(before.row);
    expect(await counts(shopId)).toEqual(before.counts);
  });

  it('SEC-05: a rejected cross-authority event rolls back earlier work in the caller transaction', async () => {
    const shopId = await fixtureShop('w1b-sec05-atomic');
    const adminId = await grantAdmin(shopId);
    const before = await counts(shopId);

    await expect(withTenant(shopId, async (trx) => {
      await processAuthorizationEvent({
        ...revokeEvent(shopId), operation: 'grant', revocation: undefined,
        authorityKind: 'migration', authorityRef: 'migration-1',
        lifecycleOwnerKind: 'migration', lifecycleOwnerRef: 'migration-1',
      }, trx);
      await processAuthorizationEvent(revokeEvent(shopId, {
        authorityKind: 'migration', authorityRef: 'migration-1',
        lifecycleOwnerKind: 'migration', lifecycleOwnerRef: 'migration-1',
        authorizationId: adminId,
      }), trx);
    })).rejects.toThrow('event revocation must resolve exactly one authorization');

    expect(await counts(shopId)).toEqual(before);
  });

  it('SEC-06: matching-authority ID and owner revocation apply; replay, conflict, and rollback are preserved', async () => {
    const shopId = await fixtureShop('w1b-sec06');
    const byId = await grantAdmin(shopId, 'admin-1');
    const byOwner = await grantAdmin(shopId, 'admin-2');

    const idEvent = revokeEvent(shopId, { authorizationId: byId, sourceEventKey: 'evt-sec06-id' });
    const applied = await withTenant(shopId, (trx) => processAuthorizationEvent(idEvent, trx));
    expect(applied).toMatchObject({ outcome: 'applied', authorizationIds: [byId] });
    const replay = await withTenant(shopId, (trx) => processAuthorizationEvent({ ...idEvent }, trx));
    expect(replay).toMatchObject({ outcome: 'replay', eventId: applied.eventId, authorizationIds: [byId] });
    const conflict = await withTenant(shopId, (trx) => processAuthorizationEvent({
      ...idEvent, revocation: { ...idEvent.revocation!, reason: 'different' },
      authorizationId: byOwner,
    }, trx));
    expect(conflict.outcome).toBe('conflict');
    expect(await counts(shopId)).toEqual({ authorizations: 2, revoked: 1, events: 1 });

    await expect(withTenant(shopId, async (trx) => {
      await processAuthorizationEvent(revokeEvent(shopId, {
        authorityRef: 'admin-2', lifecycleOwnerRef: 'admin-2', sourceEventKey: 'evt-sec06-rollback',
      }), trx);
      throw new Error('W1B_SEC06_ROLLBACK');
    })).rejects.toThrow('W1B_SEC06_ROLLBACK');
    expect((await snapshot(shopId, byOwner)).revoked_at).toBeNull();

    const owner = await withTenant(shopId, (trx) => processAuthorizationEvent(revokeEvent(shopId, {
      authorityRef: 'admin-2', lifecycleOwnerRef: 'admin-2', sourceEventKey: 'evt-sec06-owner',
    }), trx));
    expect(owner).toMatchObject({ outcome: 'applied', authorizationIds: [byOwner] });
    expect(await counts(shopId)).toEqual({ authorizations: 2, revoked: 2, events: 2 });
  });
});
