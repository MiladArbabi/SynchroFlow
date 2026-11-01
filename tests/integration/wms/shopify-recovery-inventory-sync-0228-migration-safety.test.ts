// S4-5 I4 — migration 0228 Shopify recovery inventory sync.
//
//   F1 head carries every 0228 object: three tables, forced RLS + tenant
//      policies, triggers, the tenant-listing function; sf_app holds exactly
//      SELECT + INSERT (capture tables) and SELECT + INSERT + UPDATE (sync
//      table) — never DELETE.
//   F2 runtime scenarios execute as restricted sf_app.
//   R1 tenant isolation: another shop neither sees nor writes this shop's rows.
//   R2 sf_app cannot delete or rewrite identity; held rows cannot jump to a
//      terminal or dispatch state; a non-credit movement cannot be registered.
//   M1 without 0228 evidence, DOWN removes every object and UP restores head.
//   M2 DOWN refuses while a sync row exists, leaving the schema in place.
//
// MECHANISM (precedent: receive-held-recovery-0227-migration-safety): every
// scenario runs in its OWN transaction that is ALWAYS rolled back; probes
// settle inside savepoints. Nothing is committed except the two tenant shops.

import crypto from 'crypto';
import knexLib, { Knex } from 'knex';

import { setTenantContext, systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

import * as migration0228 from
  '../../../apps/backend/migrations/20261101120000_0228_shopify_recovery_inventory_sync';

jest.setTimeout(120000);

const SYNCS = 'shopify_recovery_inventory_syncs';
const HEADERS = 'opening_inventory_recovery_capture_headers';
const CAPTURED = 'opening_inventory_recovery_capture_credits';

let admin: Knex;
let shopId: number;
let otherShopId: number;

function assertDisposableDatabase(): void {
  const name = process.env.PGDATABASE ?? '';
  if (!/^synchroflow_test_[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `S4-5 I4 0228 migration safety refuses to run: PGDATABASE="${name}" is not a ` +
        `disposable synchroflow_test_* database. Run via: npm run test:integration`,
    );
  }
}

const SENTINEL = new Error('__rollback__');

async function asAdminRolledBack(body: (trx: Knex.Transaction) => Promise<void>): Promise<void> {
  try {
    await admin.transaction(async (trx) => { await body(trx); throw SENTINEL; });
  } catch (err) {
    if (err !== SENTINEL) throw err;
  }
}

async function asRuntimeRolledBack(shop: number, body: (trx: Knex.Transaction) => Promise<void>): Promise<void> {
  try {
    await withTenant(shop, async (trx) => { await body(trx); throw SENTINEL; });
  } catch (err) {
    if (err !== SENTINEL) throw err;
  }
}

async function inSavepoint(
  trx: Knex.Transaction,
  body: (sp: Knex.Transaction) => Promise<unknown>,
): Promise<{ ok: true } | { ok: false; error: any }> {
  return trx.transaction(async (sp) => { await body(sp); }).then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

const asTenant = (trx: Knex.Transaction, id: number) =>
  trx.raw(`SELECT set_config('app.current_tenant', ?, true)`, [String(id)]);

const failure = (outcome: { ok: boolean; error?: any }) =>
  (outcome.ok ? null : `${outcome.error?.code ?? 'NO_CODE'} ${String(outcome.error?.message ?? '').match(/RECOVERY_SYNC_[A-Z_]+|RECOVERY_CAPTURE_[A-Z_]+|permission denied|row-level security|durable/)?.[0] ?? ''}`.trim());

async function schema0228(trx: Knex.Transaction) {
  const r = await trx.raw(`
    SELECT
      (SELECT array_agg(t ORDER BY t) FROM unnest(ARRAY[
        '${HEADERS}', '${CAPTURED}', '${SYNCS}']) t WHERE to_regclass('public.' || t) IS NOT NULL) AS tables,
      (SELECT array_agg(relname::text ORDER BY relname) FROM pg_class
        WHERE relname IN ('${HEADERS}', '${CAPTURED}', '${SYNCS}')
          AND relrowsecurity AND relforcerowsecurity) AS forced_rls,
      (SELECT count(*)::int FROM pg_policies
        WHERE tablename IN ('${HEADERS}', '${CAPTURED}', '${SYNCS}')
          AND qual IS NOT NULL AND with_check IS NOT NULL) AS policies,
      (SELECT array_agg(tgname::text ORDER BY tgname) FROM pg_trigger
        WHERE NOT tgisinternal AND tgrelid IN (
          SELECT oid FROM pg_class WHERE relname IN ('${HEADERS}', '${CAPTURED}', '${SYNCS}'))) AS triggers,
      to_regprocedure('public.list_shopify_recovery_inventory_sync_tenants()') IS NOT NULL AS tenant_function,
      (SELECT array_agg(table_name || ':' || privilege_type ORDER BY table_name, privilege_type)
         FROM information_schema.role_table_grants
        WHERE grantee = 'sf_app' AND table_name IN ('${HEADERS}', '${CAPTURED}', '${SYNCS}')) AS sf_app_grants
  `);
  return r.rows[0];
}

const HEAD = {
  tables: [CAPTURED, HEADERS, SYNCS],
  forced_rls: [CAPTURED, HEADERS, SYNCS],
  policies: 3,
  triggers: [
    'opening_inventory_recovery_capture_credits_no_delete',
    'opening_inventory_recovery_capture_credits_no_update',
    'opening_inventory_recovery_capture_credits_validate',
    'opening_inventory_recovery_capture_headers_no_delete',
    'opening_inventory_recovery_capture_headers_no_update',
    'opening_inventory_recovery_capture_headers_validate',
    'shopify_recovery_inventory_syncs_enforce',
    'shopify_recovery_inventory_syncs_no_delete',
  ],
  tenant_function: true,
  sf_app_grants: [
    `${CAPTURED}:INSERT`, `${CAPTURED}:SELECT`,
    `${HEADERS}:INSERT`, `${HEADERS}:SELECT`,
    `${SYNCS}:INSERT`, `${SYNCS}:SELECT`, `${SYNCS}:UPDATE`,
  ],
};

const ABSENT = {
  tables: null,
  forced_rls: null,
  policies: 0,
  triggers: null,
  tenant_function: false,
  sf_app_grants: null,
};

async function createShop(label: string): Promise<number> {
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `s45i4-0228-${label}-${crypto.randomBytes(4).toString('hex')}`);
    await setTenantContext(trx, id);
    return id;
  });
}

/** A recovery-shaped I3 credit (ledger only) inside the caller's transaction. */
async function seedCredit(trx: Knex.Transaction, shop: number) {
  await asTenant(trx, shop);
  await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
  const unique = crypto.randomBytes(4).toString('hex');
  const warehouseId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const location = `I4M-${unique}-A1`;
  await trx('warehouses').insert({
    warehouse_id: warehouseId, shop_id: shop, name: `0228 ${unique}`, root_location_code: `I4M-${unique}-ROOT`,
    is_default: false, active: true,
  });
  await trx('warehouse_locations').insert([
    { shop_id: shop, warehouse_id: warehouseId, location_code: `I4M-${unique}-ROOT`, type: 'warehouse', parent_location_code: null, active: true, zone_type: null },
    { shop_id: shop, warehouse_id: warehouseId, location_code: location, type: 'bin', parent_location_code: `I4M-${unique}-ROOT`, active: true, zone_type: 'storage' },
  ]);
  await trx('products').insert({ lasyncro_product_id: productId, shop_id: shop, title: '0228', status: 'active', product_type: 'physical' });
  await trx('variants').insert({
    lasyncro_variant_id: variantId, lasyncro_product_id: productId, shop_id: shop,
    sku: `I4M-${unique}`, title: '0228', unit_cost: '1.00', status: 'active',
  });
  const credit = {
    credit_movement_id: crypto.randomUUID(),
    device_event_id: crypto.randomUUID(),
    lasyncro_unit_id: `LSU-${unique}`,
    lasyncro_variant_id: variantId,
    location_code: location,
  };
  await trx('inventory_movements').insert({
    lasyncro_inventory_movement_id: credit.credit_movement_id, lasyncro_variant_id: variantId, shop_id: shop,
    movement_type: 'inbound_purchase', quantity_delta: 1, location_code: location,
    reference_type: 'inventory_unit', reference_id: crypto.randomUUID(), platform: 'wms',
    occurred_at: new Date(), device_event_id: credit.device_event_id, triggered_by: 'receive_recovery',
  });
  return credit;
}

const syncRow = (shop: number, credit: Awaited<ReturnType<typeof seedCredit>>, status = 'held_no_baseline') => ({
  shop_id: shop,
  ...credit,
  idempotency_key: `lasyncro:receive-recovery:${shop}:${credit.credit_movement_id}`,
  reference_document_uri: `gid://lasyncro/ReceiveRecoveryCredit/shop-${shop}-movement-${credit.credit_movement_id}`,
  status,
  hold_reason: 'NO_CONVERGED_CUTOVER',
});

beforeAll(async () => {
  assertDisposableDatabase();
  admin = knexLib({
    client: 'pg',
    connection: {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGMIGRATION_USER,
      password: process.env.PGMIGRATION_PASSWORD,
      database: process.env.PGDATABASE,
    },
    pool: { min: 0, max: 2 },
  });
  shopId = await createShop('a');
  otherShopId = await createShop('b');
});

afterAll(async () => {
  if (admin) await admin.destroy();
});

async function expectHeadRestored(): Promise<void> {
  await asAdminRolledBack(async (trx) => {
    expect(await schema0228(trx)).toEqual(HEAD);
  });
}

describe('S4-5 I4 — migration 0228 Shopify recovery inventory sync', () => {
  it('F1 — head carries every 0228 object; sf_app never holds DELETE', async () => {
    await asAdminRolledBack(async (trx) => {
      expect(await schema0228(trx)).toEqual(HEAD);
    });
  });

  it('F2 — runtime scenarios execute as restricted sf_app', async () => {
    await asRuntimeRolledBack(shopId, async (trx) => {
      const r = await trx.raw(
        `SELECT current_user AS usr, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
      expect(r.rows[0]).toEqual({ usr: 'sf_app', rolsuper: false, rolbypassrls: false });
    });
  });

  it('R1 — another shop neither sees nor writes this shop\'s sync rows', async () => {
    await asRuntimeRolledBack(shopId, async (trx) => {
      const credit = await seedCredit(trx, shopId);
      expect(failure(await inSavepoint(trx, (sp) => sp(SYNCS).insert(syncRow(shopId, credit))))).toBeNull();

      await asTenant(trx, otherShopId);
      expect(await trx(SYNCS).where({ credit_movement_id: credit.credit_movement_id })).toEqual([]);
      expect(await trx(HEADERS).where({ shop_id: shopId })).toEqual([]);
      expect(failure(await inSavepoint(trx, (sp) =>
        sp(SYNCS).insert(syncRow(shopId, { ...credit, credit_movement_id: crypto.randomUUID() }))))).toMatch(/row-level security/);
    });
  });

  it('R2 — sf_app cannot delete, rewrite identity, skip ahead or register a non-credit', async () => {
    await asRuntimeRolledBack(shopId, async (trx) => {
      const credit = await seedCredit(trx, shopId);
      await trx(SYNCS).insert(syncRow(shopId, credit));
      const where = { shop_id: shopId, credit_movement_id: credit.credit_movement_id };

      expect(failure(await inSavepoint(trx, (sp) => sp(SYNCS).where(where).del()))).toMatch(/permission denied/);
      expect(failure(await inSavepoint(trx, (sp) =>
        sp(SYNCS).where(where).update({ idempotency_key: 'other' })))).toMatch(/RECOVERY_SYNC_IDENTITY_IMMUTABLE/);
      for (const status of ['succeeded', 'dispatching', 'ambiguous', 'held_expired']) {
        expect(failure(await inSavepoint(trx, (sp) =>
          sp(SYNCS).where(where).update({ status })))).toMatch(/RECOVERY_SYNC_|check constraint|NO_CODE/);
      }
      expect(failure(await inSavepoint(trx, (sp) =>
        sp(SYNCS).insert(syncRow(shopId, { ...credit, credit_movement_id: crypto.randomUUID(), device_event_id: crypto.randomUUID(), lasyncro_unit_id: 'LSU-none' })))))
        .toMatch(/RECOVERY_SYNC_CREDIT_INVALID/);
      expect(failure(await inSavepoint(trx, (sp) => sp(HEADERS).where({ shop_id: shopId }).del()))).toMatch(/permission denied/);
    });
  });

  it('M1 — without 0228 evidence: DOWN removes every object and UP restores head', async () => {
    try {
      await asAdminRolledBack(async (trx) => {
        await trx.raw(`SET LOCAL row_security = off`);
        const evidence = await trx.raw(
          `SELECT (SELECT count(*)::int FROM ${SYNCS}) AS syncs,
                  (SELECT count(*)::int FROM ${HEADERS} WHERE source = 'freeze') AS freeze_headers`);
        expect(evidence.rows[0]).toEqual({ syncs: 0, freeze_headers: 0 });

        expect(await inSavepoint(trx, (sp) => migration0228.down(sp))).toEqual({ ok: true });
        expect(await schema0228(trx)).toEqual(ABSENT);
        expect(await inSavepoint(trx, (sp) => migration0228.up(sp))).toEqual({ ok: true });
        expect(await schema0228(trx)).toEqual(HEAD);
      });
    } finally {
      await expectHeadRestored();
    }
  });

  it('M2 — DOWN refuses while a sync row exists, leaving the 0228 schema in place', async () => {
    try {
      await asAdminRolledBack(async (trx) => {
        const credit = await seedCredit(trx, shopId);
        await trx(SYNCS).insert(syncRow(shopId, credit));
        const outcome = await inSavepoint(trx, (sp) => migration0228.down(sp));
        expect(outcome.ok).toBe(false);
        expect(String((outcome as any).error?.message)).toMatch(/SHOPIFY_RECOVERY_INVENTORY_SYNC_ROLLBACK_BLOCKED/);
        expect(await schema0228(trx)).toEqual(HEAD);
      });
    } finally {
      await expectHeadRestored();
    }
  });
});
