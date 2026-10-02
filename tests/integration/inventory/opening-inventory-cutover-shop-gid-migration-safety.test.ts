// GH-1179 D26 — migration 0202 durable-evidence safety.
//
// Inherited rule (0201 down): durable opening-inventory generation evidence must
// never be invented or destroyed by migration.
//
//   0202 up   must refuse to add stable Shop identity retrospectively when a
//             generation already exists (no inferred/backfilled GID).
//   0202 down must refuse to drop shopify_shop_gid when a generation exists.
//
// MECHANISM (precedent: tests/integration/returns/returns-schema-drift-02.test.ts,
// tests/integration/wms/carrier-settings-schema-drift-01.test.ts,
// tests/integration/suppliers/purchase-order-display-number-1109.test.ts)
//   The harness migrates the disposable DB to head (through 0202). Each scenario
//   opens its OWN migration-role transaction, builds a real frozen generation
//   through the real 0201 guards, shapes only 0202-owned schema where needed,
//   invokes the REAL 0202 migration source inside a savepoint, asserts, then
//   ALWAYS rolls back. PostgreSQL DDL is transactional, so the shared
//   disposable DB is left at head regardless of outcome.

import crypto from 'crypto';
import knexLib, { Knex } from 'knex';

import { setTenantContext, systemTransaction } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

import * as migration0202 from
  '../../../apps/backend/migrations/20261002193000_0202_add_opening_inventory_cutover_shop_gid';

jest.setTimeout(120000);

const GENERATIONS = 'opening_inventory_cutover_generations';
const SHOP_GID_COLUMN = 'shopify_shop_gid';
const SHOP_GID_CONSTRAINT = 'opening_inventory_cutover_generations_shop_gid_valid';

let db: Knex;

function assertDisposableDatabase(): void {
  const name = process.env.PGDATABASE ?? '';
  if (!/^synchroflow_test_[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `GH-1179 D26 migration safety refuses to run: PGDATABASE="${name}" is not a ` +
        `disposable synchroflow_test_* database. Run via: npm run test:integration`,
    );
  }
}

/** Run `body` in a migration-role transaction that is ALWAYS rolled back. */
async function inRolledBackTransaction(
  body: (trx: Knex.Transaction) => Promise<void>,
): Promise<void> {
  const sentinel = new Error('__rollback__');
  try {
    await db.transaction(async (trx) => {
      await body(trx);
      throw sentinel;
    });
  } catch (err) {
    if (err !== sentinel) throw err;
  }
}

/** Settle a migration call inside a savepoint so a failure cannot abort the outer trx. */
async function inSavepoint(
  trx: Knex.Transaction,
  body: (sp: Knex.Transaction) => Promise<void>,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  return trx.transaction(body).then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

async function shopGidColumn(
  trx: Knex.Transaction,
): Promise<{ udt_name: string; is_nullable: string } | undefined> {
  const { rows } = await trx.raw(
    `SELECT udt_name, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`,
    [GENERATIONS, SHOP_GID_COLUMN],
  );
  return rows[0];
}

async function shopGidConstraint(trx: Knex.Transaction): Promise<string | undefined> {
  const { rows } = await trx.raw(
    `SELECT pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = ? AND c.conname = ?`,
    [GENERATIONS, SHOP_GID_CONSTRAINT],
  );
  return rows[0]?.def;
}

/** Head schema owned by 0202: NOT NULL text column + named canonical CHECK. */
async function expectHeadShopGidSchema(trx: Knex.Transaction): Promise<void> {
  expect(await shopGidColumn(trx)).toEqual({ udt_name: 'text', is_nullable: 'NO' });
  expect(await shopGidConstraint(trx)).toMatch(/shopify_shop_gid/);
}

type DurableGeneration = {
  shopId: number;
  generationId: string;
  shopGid: string;
};

let shopId: number;

async function createShop(): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `d26-mig-safety-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

/**
 * Smallest legitimate durable generation: complete scoped snapshot, zero
 * entries/batches, inserted assembling and frozen through the real 0201 freeze
 * guard, then the deferred frozen-at-commit contract is forced to evaluate NOW.
 * No guard/trigger is disabled. Lives only inside the caller's transaction.
 */
async function insertDurableGeneration(trx: Knex.Transaction): Promise<DurableGeneration> {
  await trx.raw(`SELECT set_config('app.current_tenant', ?, true)`, [String(shopId)]);

  const unique = crypto.randomBytes(6).toString('hex');
  const warehouseId = crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  const generationId = crypto.randomUUID();
  const locationGid = `gid://shopify/Location/8${shopId}`;
  const shopGid = `gid://shopify/Shop/${shopId}`;
  const now = new Date();

  await trx('shop_wms_settings')
    .insert({ shop_id: shopId, bootstrap_model: 'reconcile_opening_expectation_v2' })
    .onConflict('shop_id')
    .ignore();

  await trx('warehouses').insert({
    warehouse_id: warehouseId,
    shop_id: shopId,
    name: `D26 migration safety ${unique}`,
    root_location_code: `D26M-${unique}-ROOT`,
    is_default: true,
    active: true,
    external_location_id: `8${shopId}`,
  });

  await trx('opening_inventory_shopify_snapshots').insert({
    snapshot_id: snapshotId,
    shop_id: shopId,
    warehouse_id: warehouseId,
    shopify_location_id: locationGid,
    attempt_number: 1,
    status: 'collecting',
    collection_token: crypto.randomUUID(),
    collection_started_at: now,
    lease_expires_at: new Date(now.getTime() + 5 * 60_000),
    completed_at: null,
    line_count: null,
    page_count: null,
    shopify_api_version: '2026-04',
    failure_code: null,
  });

  await trx('opening_inventory_shopify_snapshots')
    .where({ shop_id: shopId, snapshot_id: snapshotId })
    .update({ status: 'complete', completed_at: new Date(), line_count: 0, page_count: 1 });

  await trx(GENERATIONS).insert({
    generation_id: generationId,
    shop_id: shopId,
    generation_sequence: 1,

    opening_snapshot_id: snapshotId,
    warehouse_id: warehouseId,
    shopify_location_gid: locationGid,
    shopify_shop_domain: `d26-mig-safety-${unique}.myshopify.com`,
    shopify_shop_gid: shopGid,

    requested_api_version: '2026-04',
    served_api_version: '2026-04',
    cas_mode: 'change_from_quantity',

    quantity_name: 'on_hand',
    reason: 'correction',

    approved_by_actor_type: 'user',
    approved_by_actor_id: `user-${shopId}`,
    approved_by_role: 'owner',
    approved_at: now,
    physical_truth_accepted_at: now,

    identity_fingerprint: '1'.repeat(64),
    target_fingerprint: '2'.repeat(64),
    provider_read_fingerprint: '3'.repeat(64),
    generation_fingerprint: '4'.repeat(64),

    canonicalization_version: 'v1',
    batching_version: 'v1',
    batch_size: 250,

    provider_read_started_at: new Date(now.getTime() - 1000),
    provider_read_completed_at: now,
    provider_page_count: 1,

    target_item_count: 0,
    provider_only_item_count: 0,
    write_count: 0,
    batch_count: 0,

    status: 'assembling',
    frozen_at: null,
  });

  await trx(GENERATIONS)
    .where({ shop_id: shopId, generation_id: generationId, status: 'assembling' })
    .update({ status: 'frozen', frozen_at: trx.fn.now() });

  // Evaluate the deferred frozen-at-commit contract now: this generation would
  // legitimately survive COMMIT.
  await trx.raw(`SET CONSTRAINTS opening_inventory_cutover_generations_frozen_at_commit IMMEDIATE`);

  const persisted = await trx(GENERATIONS)
    .where({ shop_id: shopId, generation_id: generationId })
    .first('status', 'frozen_at', SHOP_GID_COLUMN);

  expect(persisted?.status).toBe('frozen');
  expect(persisted?.frozen_at).toBeTruthy();
  expect(persisted?.[SHOP_GID_COLUMN]).toBe(shopGid);

  return { shopId, generationId, shopGid };
}

beforeAll(async () => {
  assertDisposableDatabase();
  db = knexLib({
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
  shopId = await createShop();
});

afterAll(async () => {
  if (db) await db.destroy();
});

describe('GH-1179 D26 — migration 0202 never invents or destroys durable Shop identity evidence', () => {
  it('D26-M3 — 0202 up fails closed when generation evidence already exists (no inferred Shop GID)', async () => {
    try {
      await inRolledBackTransaction(async (trx) => {
        const generation = await insertDurableGeneration(trx);

        // Shape ONLY 0202-owned schema back to the pre-0202 (0201) state.
        await trx.raw(`ALTER TABLE ${GENERATIONS} DROP CONSTRAINT ${SHOP_GID_CONSTRAINT}`);
        await trx.raw(`ALTER TABLE ${GENERATIONS} DROP COLUMN ${SHOP_GID_COLUMN}`);

        expect(await shopGidColumn(trx)).toBeUndefined();
        expect(await shopGidConstraint(trx)).toBeUndefined();

        const outcome = await inSavepoint(trx, (sp) => migration0202.up(sp));

        expect(outcome.ok).toBe(false);
        expect(String((outcome as any).error?.message)).toMatch(
          /OPENING_INVENTORY_CUTOVER_GENERATION_SHOP_GID_BACKFILL_BLOCKED/,
        );

        // No identity was invented: 0202-owned schema is still absent and the
        // durable generation is still the same frozen row.
        expect(await shopGidColumn(trx)).toBeUndefined();
        expect(await shopGidConstraint(trx)).toBeUndefined();

        const persisted = await trx(GENERATIONS)
          .where({ shop_id: generation.shopId, generation_id: generation.generationId })
          .first();

        expect(persisted?.status).toBe('frozen');
        expect(persisted).not.toHaveProperty(SHOP_GID_COLUMN);
      });
    } finally {
      // Rollback must leave the shared disposable DB at head, RED or GREEN.
      await inRolledBackTransaction(async (trx) => {
        await expectHeadShopGidSchema(trx);
        // eslint-disable-next-line no-console
        console.info('[GH1179_D26_MIG_HEAD_RESTORED]', 'D26-M3');
      });
    }
  });

  it('D26-M4 — 0202 down fails closed when durable generation evidence exists', async () => {
    try {
      await inRolledBackTransaction(async (trx) => {
        await expectHeadShopGidSchema(trx);

        const generation = await insertDurableGeneration(trx);

        const outcome = await inSavepoint(trx, (sp) => migration0202.down(sp));

        const column = await shopGidColumn(trx);
        const constraint = await shopGidConstraint(trx);

        expect({ downRejected: outcome.ok === false, column, constraint }).toEqual({
          downRejected: true,
          column: { udt_name: 'text', is_nullable: 'NO' },
          constraint: expect.stringMatching(/shopify_shop_gid/),
        });

        expect(String((outcome as any).error?.message)).toMatch(
          /OPENING_INVENTORY_CUTOVER_GENERATION\w*ROLLBACK_BLOCKED/,
        );

        const persisted = await trx(GENERATIONS)
          .where({ shop_id: generation.shopId, generation_id: generation.generationId })
          .first(SHOP_GID_COLUMN);

        expect(persisted?.[SHOP_GID_COLUMN]).toBe(generation.shopGid);
      });
    } finally {
      // Rollback must leave the shared disposable DB at head, RED or GREEN.
      await inRolledBackTransaction(async (trx) => {
        await expectHeadShopGidSchema(trx);
        // eslint-disable-next-line no-console
        console.info('[GH1179_D26_MIG_HEAD_RESTORED]', 'D26-M4');
      });
    }
  });
});
