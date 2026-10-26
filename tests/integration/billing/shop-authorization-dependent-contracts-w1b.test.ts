import crypto from 'crypto';
import { systemTransaction, setTenantContext, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

async function fixtureShop(prefix: string): Promise<number> {
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${prefix}-${crypto.randomBytes(6).toString('hex')}`);
    await setTenantContext(trx, id);
    return id;
  });
}

describe('W1-B R4/R5/R6/R10 — dependent database contracts', () => {
  it('R4/R5: authorization uniqueness includes authority identity and does not collapse a target capability', async () => {
    const shopId = await fixtureShop('w1b-r5-key');
    const { rows } = await withTenant(shopId, (trx) => trx.raw(
      `SELECT pg_get_indexdef(i.indexrelid) AS definition
         FROM pg_index i
        WHERE i.indrelid = to_regclass('public.shop_authorizations')
          AND i.indisunique`
    ));
    const definitions = rows.map((row: any) => row.definition.replace(/\s+/g, ' '));
    expect(definitions.some((definition: string) =>
      /\(shop_id, target_kind, target_key, authority_kind, authority_ref\)/.test(definition)
    )).toBe(true);
    expect(definitions.some((definition: string) =>
      /\(shop_id, target_kind, target_key\)/.test(definition) &&
      !/authority_kind/.test(definition)
    )).toBe(false);
  });

  it('R6: event identity is unique only at shop + authority + source-event scope', async () => {
    const shopId = await fixtureShop('w1b-r6-key');
    const { rows } = await withTenant(shopId, (trx) => trx.raw(
      `SELECT pg_get_indexdef(i.indexrelid) AS definition
         FROM pg_index i
        WHERE i.indrelid = to_regclass('public.shop_authorization_events')
          AND i.indisunique`
    ));
    const definitions = rows.map((row: any) => row.definition.replace(/\s+/g, ' '));
    expect(definitions.some((definition: string) =>
      /\(shop_id, authority_kind, authority_ref, source_event_key\)/.test(definition)
    )).toBe(true);
  });

  it('R6/R10: an event-to-authorization reference is tenant-scoped through shop_id', async () => {
    const shopId = await fixtureShop('w1b-r10-fk');
    const { rows } = await withTenant(shopId, (trx) => trx.raw(
      `SELECT pg_get_constraintdef(con.oid) AS definition
         FROM pg_constraint con
        WHERE con.contype = 'f'
          AND con.conrelid = to_regclass('public.shop_authorization_events')
          AND con.confrelid = to_regclass('public.shop_authorizations')`
    ));
    const definitions = rows.map((row: any) => row.definition.replace(/\s+/g, ' '));
    expect(definitions.some((definition: string) =>
      /FOREIGN KEY \(shop_id, authorization_id\) REFERENCES shop_authorizations\(shop_id, id\)/.test(definition)
    )).toBe(true);
  });

  it('R6: payload_hash has database enforcement preventing mutation after event acceptance', async () => {
    const shopId = await fixtureShop('w1b-r6-hash');
    const authorizationId = await withTenant(shopId, async (trx) => {
      const [authorization] = await trx('shop_authorizations').insert({
        shop_id: shopId,
        target_kind: 'module', target_key: 'returns',
        authority_kind: 'admin', authority_ref: 'admin-1',
        lifecycle_owner_kind: 'admin', lifecycle_owner_ref: 'admin-1',
        valid_from: new Date(),
      }).returning('id');
      return authorization.id;
    });
    const eventId = await withTenant(shopId, async (trx) => {
      const [event] = await trx('shop_authorization_events').insert({
        shop_id: shopId,
        authority_kind: 'admin', authority_ref: 'admin-1',
        source_event_key: `evt-${crypto.randomBytes(8).toString('hex')}`,
        payload_hash: 'a'.repeat(64),
        event_kind: 'grant',
        target_kind: 'module', target_key: 'returns',
        authorization_id: authorizationId,
      }).returning('id');
      return event.id;
    });

    await expect(withTenant(shopId, (trx) => trx('shop_authorization_events')
      .where({ shop_id: shopId, id: eventId })
      .update({ payload_hash: 'b'.repeat(64) }))).rejects.toBeDefined();

    await expect(withTenant(shopId, (trx) => trx('shop_authorization_events')
      .where({ shop_id: shopId, id: eventId })
      .del())).rejects.toBeDefined();

    const row = await withTenant(shopId, (trx) => trx('shop_authorization_events')
      .where({ shop_id: shopId, id: eventId })
      .first('payload_hash'));
    expect(row?.payload_hash).toBe('a'.repeat(64));
  });

  it('R6: event identity collides only within one shop and authority', async () => {
    const shopA = await fixtureShop('w1b-r6-a');
    const shopB = await fixtureShop('w1b-r6-b');
    const sourceEventKey = `evt-${crypto.randomBytes(8).toString('hex')}`;

    async function insertAuthorization(shopId: number, authorityRef: string) {
      return withTenant(shopId, async (trx) => {
        const [row] = await trx('shop_authorizations').insert({
          shop_id: shopId,
          target_kind: 'module', target_key: 'returns',
          authority_kind: 'admin', authority_ref: authorityRef,
          lifecycle_owner_kind: 'admin', lifecycle_owner_ref: authorityRef,
        }).returning('id');
        return row.id;
      });
    }

    async function insertEvent(shopId: number, authorityRef: string, authorizationId: string) {
      return withTenant(shopId, (trx) => trx('shop_authorization_events').insert({
        shop_id: shopId,
        authority_kind: 'admin', authority_ref: authorityRef,
        source_event_key: sourceEventKey,
        payload_hash: 'c'.repeat(64),
        event_kind: 'grant',
        target_kind: 'module', target_key: 'returns',
        authorization_id: authorizationId,
      }));
    }

    const authA1 = await insertAuthorization(shopA, 'admin-1');
    const authA2 = await insertAuthorization(shopA, 'admin-2');
    const authB1 = await insertAuthorization(shopB, 'admin-1');
    await insertEvent(shopA, 'admin-1', authA1);

    await expect(insertEvent(shopA, 'admin-1', authA1)).rejects.toMatchObject({ code: '23505' });
    await expect(insertEvent(shopA, 'admin-2', authA2)).resolves.toBeDefined();
    await expect(insertEvent(shopB, 'admin-1', authB1)).resolves.toBeDefined();
  });
});
