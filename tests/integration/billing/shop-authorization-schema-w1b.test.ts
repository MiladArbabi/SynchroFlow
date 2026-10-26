import crypto from 'crypto';
import { systemTransaction, setTenantContext, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

const AUTHORIZATIONS = 'shop_authorizations';
const EVENTS = 'shop_authorization_events';

async function fixtureShop(prefix: string): Promise<number> {
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${prefix}-${crypto.randomBytes(6).toString('hex')}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function columns(shopId: number, table: string) {
  const { rows } = await withTenant(shopId, (trx) => trx.raw(
    `SELECT column_name, udt_name, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ?`,
    [table]
  ));
  return new Map(rows.map((row: any) => [row.column_name, row]));
}

describe('W1-B R3/R6/R10 — durable authorization schema contracts', () => {
  it('R3: shop_authorizations exposes durable target, authority, lifecycle, interval, revocation, and subscription identities', async () => {
    const shopId = await fixtureShop('w1b-r3');
    const actual = await columns(shopId, AUTHORIZATIONS);
    const required = [
      'id', 'shop_id', 'target_kind', 'target_key',
      'authority_kind', 'authority_ref',
      'lifecycle_owner_kind', 'lifecycle_owner_ref',
      'valid_from', 'valid_until',
      'revoked_at', 'revoked_by_kind', 'revoked_by_ref', 'revocation_reason',
      'provider', 'provider_subscription_id', 'created_at', 'updated_at',
    ];
    expect([...actual.keys()]).toEqual(expect.arrayContaining(required));
    expect(actual.get('id')?.is_nullable).toBe('NO');
    expect(actual.get('shop_id')?.is_nullable).toBe('NO');
    expect(actual.get('authority_kind')?.is_nullable).toBe('NO');
    expect(actual.get('authority_ref')?.is_nullable).toBe('NO');
    expect(actual.get('lifecycle_owner_kind')?.is_nullable).toBe('NO');
    expect(actual.get('lifecycle_owner_ref')?.is_nullable).toBe('NO');
  });

  it('R6: shop_authorization_events exposes tenant/authority event identity and immutable payload hash', async () => {
    const shopId = await fixtureShop('w1b-r6');
    const actual = await columns(shopId, EVENTS);
    const required = [
      'id', 'shop_id', 'authority_kind', 'authority_ref',
      'source_event_key', 'payload_hash', 'authorization_id', 'created_at',
    ];
    expect([...actual.keys()]).toEqual(expect.arrayContaining(required));
    for (const name of ['shop_id', 'authority_kind', 'authority_ref', 'source_event_key', 'payload_hash']) {
      expect(actual.get(name)?.is_nullable).toBe('NO');
    }
  });

  it.each([AUTHORIZATIONS, EVENTS])('R10: %s has forced row-level security', async (table) => {
    const shopId = await fixtureShop('w1b-r10');
    const { rows } = await withTenant(shopId, (trx) => trx.raw(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE oid = to_regclass('public.' || ?)`,
      [table]
    ));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('R6: event uniqueness is exactly shop + authority + source event key', async () => {
    const shopId = await fixtureShop('w1b-r6-key');
    const { rows } = await withTenant(shopId, (trx) => trx.raw(
      `SELECT pg_get_indexdef(i.indexrelid) AS definition
         FROM pg_index i
        WHERE i.indrelid = to_regclass('public.shop_authorization_events')
          AND i.indisunique`
    ));
    const normalized = rows.map((row: any) => row.definition.replace(/\s+/g, ' '));
    expect(normalized.some((definition: string) =>
      /\(shop_id, authority_kind, authority_ref, source_event_key\)/.test(definition)
    )).toBe(true);
  });

  it.each([AUTHORIZATIONS, EVENTS])('R10: sf_app has least-privilege table access on %s', async (table) => {
    const shopId = await fixtureShop('w1b-r10-priv');
    const { rows } = await withTenant(shopId, (trx) => trx.raw(
      `SELECT current_user,
              has_table_privilege(current_user, ?, 'SELECT') AS can_select,
              has_table_privilege(current_user, ?, 'INSERT') AS can_insert,
              has_table_privilege(current_user, ?, 'UPDATE') AS can_update,
              has_table_privilege(current_user, ?, 'DELETE') AS can_delete`,
      [table, table, table, table]
    ));
    expect(rows[0].current_user).toBe('sf_app');
    expect(rows[0].can_select).toBe(true);
    expect(rows[0].can_insert).toBe(true);
    expect(rows[0].can_delete).toBe(false);
    expect(rows[0].can_update).toBe(table === AUTHORIZATIONS);
  });

  it('R10: forced RLS blocks cross-tenant authorization reads and writes for sf_app', async () => {
    const shopA = await fixtureShop('w1b-r10-a');
    const shopB = await fixtureShop('w1b-r10-b');
    await withTenant(shopA, (trx) => trx(AUTHORIZATIONS).insert({
      shop_id: shopA,
      target_kind: 'module', target_key: 'returns',
      authority_kind: 'admin', authority_ref: 'admin-1',
      lifecycle_owner_kind: 'admin', lifecycle_owner_ref: 'admin-1',
    }));

    const rows = await withTenant(shopB, (trx) => trx(AUTHORIZATIONS)
      .where({ shop_id: shopA }).select('id'));
    expect(rows).toHaveLength(0);

    await expect(withTenant(shopB, (trx) => trx(AUTHORIZATIONS).insert({
      shop_id: shopA,
      target_kind: 'module', target_key: 'wms',
      authority_kind: 'admin', authority_ref: 'admin-2',
      lifecycle_owner_kind: 'admin', lifecycle_owner_ref: 'admin-2',
    }))).rejects.toMatchObject({ code: '42501' });
  });

  it('R10: composite foreign keys reject cross-tenant event-to-authorization references', async () => {
    const shopA = await fixtureShop('w1b-r10-fk-a');
    const shopB = await fixtureShop('w1b-r10-fk-b');
    const authorizationId = await withTenant(shopA, async (trx) => {
      const [row] = await trx(AUTHORIZATIONS).insert({
        shop_id: shopA,
        target_kind: 'module', target_key: 'returns',
        authority_kind: 'admin', authority_ref: 'admin-1',
        lifecycle_owner_kind: 'admin', lifecycle_owner_ref: 'admin-1',
      }).returning('id');
      return row.id;
    });

    await expect(withTenant(shopB, (trx) => trx(EVENTS).insert({
      shop_id: shopB,
      authority_kind: 'admin', authority_ref: 'admin-1',
      source_event_key: `evt-${crypto.randomBytes(8).toString('hex')}`,
      payload_hash: 'd'.repeat(64),
      event_kind: 'grant',
      target_kind: 'module', target_key: 'returns',
      authorization_id: authorizationId,
    }))).rejects.toMatchObject({ code: '23503' });
  });
});
