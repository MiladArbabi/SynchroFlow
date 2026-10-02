// GH-1179 Slice D / planned MIGRATION 0201
//
// Permanent DB contract for immutable Opening Inventory Shopify cutover
// generations.
//
// Slice D owns immutable request facts only:
//   generation header
//   generation entries
//   exact immutable provider batches
//
// Shopify execution attempts/results/convergence belong to Slice E.
//
// This suite is schema/database-contract only.
// No Shopify client, mutation executor, controller, frontend, or external I/O.

import crypto from 'crypto';

import {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';

import { createTenantShop } from
  '@lasyncro/backend-core/services/pre-tenant.service.js';

jest.setTimeout(60000);

const GENERATIONS = 'opening_inventory_cutover_generations';
const ENTRIES = 'opening_inventory_cutover_generation_entries';
const BATCHES = 'opening_inventory_cutover_generation_batches';

type ColumnContract = {
  nullable: boolean;
  udt: string[];
};

const TEXT = ['varchar', 'text'];
const INT = ['int4', 'int8'];

const GENERATION_COLUMNS: Record<string, ColumnContract> = {
  generation_id:                 { nullable: false, udt: ['uuid'] },
  shop_id:                       { nullable: false, udt: INT },
  generation_sequence:           { nullable: false, udt: INT },

  opening_snapshot_id:           { nullable: false, udt: ['uuid'] },
  warehouse_id:                  { nullable: false, udt: ['uuid'] },
  shopify_location_gid:          { nullable: false, udt: TEXT },
  shopify_shop_domain:           { nullable: false, udt: TEXT },
  shopify_shop_gid:              { nullable: false, udt: TEXT },

  requested_api_version:         { nullable: false, udt: TEXT },
  served_api_version:            { nullable: false, udt: TEXT },
  cas_mode:                      { nullable: false, udt: TEXT },

  quantity_name:                 { nullable: false, udt: TEXT },
  reason:                        { nullable: false, udt: TEXT },

  approved_by_actor_type:        { nullable: false, udt: TEXT },
  approved_by_actor_id:          { nullable: false, udt: TEXT },
  approved_by_role:              { nullable: false, udt: TEXT },
  approved_at:                   { nullable: false, udt: ['timestamptz'] },
  physical_truth_accepted_at:    { nullable: true,  udt: ['timestamptz'] },

  identity_fingerprint:          { nullable: false, udt: TEXT },
  target_fingerprint:            { nullable: false, udt: TEXT },
  provider_read_fingerprint:     { nullable: false, udt: TEXT },
  generation_fingerprint:        { nullable: false, udt: TEXT },

  canonicalization_version:      { nullable: false, udt: TEXT },
  batching_version:              { nullable: false, udt: TEXT },
  batch_size:                    { nullable: false, udt: INT },

  provider_read_started_at:      { nullable: false, udt: ['timestamptz'] },
  provider_read_completed_at:    { nullable: false, udt: ['timestamptz'] },
  provider_page_count:           { nullable: false, udt: INT },

  target_item_count:             { nullable: false, udt: INT },
  provider_only_item_count:      { nullable: false, udt: INT },
  write_count:                   { nullable: false, udt: INT },
  batch_count:                   { nullable: false, udt: INT },

  status:                        { nullable: false, udt: TEXT },
  frozen_at:                     { nullable: true,  udt: ['timestamptz'] },
  created_at:                    { nullable: false, udt: ['timestamptz'] },
};

const ENTRY_COLUMNS: Record<string, ColumnContract> = {
  generation_id:                 { nullable: false, udt: ['uuid'] },
  shop_id:                       { nullable: false, udt: INT },
  ordinal:                       { nullable: false, udt: INT },

  lasyncro_variant_id:           { nullable: true,  udt: ['uuid'] },
  shopify_inventory_item_gid:    { nullable: false, udt: TEXT },
  shopify_variant_gid:           { nullable: true,  udt: TEXT },

  target_quantity:               { nullable: true,  udt: INT },
  observed_on_hand_quantity:     { nullable: true,  udt: INT },

  inventory_level_present:       { nullable: false, udt: ['bool'] },
  inventory_level_active:        { nullable: true,  udt: ['bool'] },
  tracked:                       { nullable: true,  udt: ['bool'] },

  disposition:                   { nullable: false, udt: TEXT },
  batch_index:                   { nullable: true,  udt: INT },
  batch_position:                { nullable: true,  udt: INT },

  created_at:                    { nullable: false, udt: ['timestamptz'] },
};

const BATCH_COLUMNS: Record<string, ColumnContract> = {
  generation_id:                 { nullable: false, udt: ['uuid'] },
  shop_id:                       { nullable: false, udt: INT },
  batch_index:                   { nullable: false, udt: INT },

  requested_api_version:         { nullable: false, udt: TEXT },
  served_api_version:            { nullable: false, udt: TEXT },
  cas_mode:                      { nullable: false, udt: TEXT },

  operation_name:                { nullable: false, udt: TEXT },
  graphql_document:              { nullable: false, udt: TEXT },
  canonical_variables:           { nullable: false, udt: TEXT },

  reference_document_uri:        { nullable: false, udt: TEXT },
  idempotency_key:               { nullable: true,  udt: TEXT },

  request_sha256:                { nullable: false, udt: TEXT },
  entry_count:                   { nullable: false, udt: INT },

  created_at:                    { nullable: false, udt: ['timestamptz'] },
};

type Fixture = {
  shopId: number;
  warehouseId: string;
  snapshotId: string;
  variantId: string;
};

async function createFixture(prefix: string): Promise<Fixture> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${prefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const warehouseId = crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();

  await withTenant(shopId, async (trx) => {
    await trx('shop_wms_settings')
      .insert({
        shop_id: shopId,
        bootstrap_model: 'reconcile_opening_expectation_v2',
      })
      .onConflict('shop_id')
      .ignore();

    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: `Generation warehouse ${unique}`,
      root_location_code: `GEN-${unique}-ROOT`,
      is_default: true,
      active: true,
      external_location_id: `8${shopId}`,
    });

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Generation product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `GEN-${unique}`,
      title: 'Generation variant',
      unit_cost: '1.00',
      status: 'active',
    });

    await trx('external_product_identity_map').insert({
      id: crypto.randomUUID(),
      lasyncro_variant_id: variantId,
      shop_id: shopId,
      platform: 'shopify',
      external_product_id:
        `gid://shopify/Product/6${shopId}`,
      external_variant_id:
        `gid://shopify/ProductVariant/7${shopId}`,
      external_inventory_item_id: `9${shopId}`,
      external_sku: `GEN-${unique}`,
    });

    await trx('opening_inventory_shopify_snapshots').insert({
      snapshot_id: snapshotId,
      shop_id: shopId,
      warehouse_id: warehouseId,
      shopify_location_id: `gid://shopify/Location/8${shopId}`,
      attempt_number: 1,
      status: 'collecting',
      collection_token: crypto.randomUUID(),
      collection_started_at: new Date(),
      lease_expires_at: new Date(Date.now() + 5 * 60_000),
      completed_at: null,
      line_count: null,
      page_count: null,
      shopify_api_version: '2026-04',
      failure_code: null,
    });

    await trx('opening_inventory_shopify_snapshots')
      .where({ shop_id: shopId, snapshot_id: snapshotId })
      .update({
        status: 'complete',
        completed_at: new Date(),
        line_count: 0,
        page_count: 1,
      });
  });

  return { shopId, warehouseId, snapshotId, variantId };
}

function generationRow(
  fixture: Fixture,
  overrides: Record<string, unknown> = {}
) {
  const now = new Date();

  return {
    generation_id: crypto.randomUUID(),
    shop_id: fixture.shopId,
    generation_sequence: 1,

    opening_snapshot_id: fixture.snapshotId,
    warehouse_id: fixture.warehouseId,
    shopify_location_gid: `gid://shopify/Location/8${fixture.shopId}`,
    shopify_shop_domain: `shop-${fixture.shopId}.myshopify.com`,
    shopify_shop_gid: `gid://shopify/Shop/${fixture.shopId}`,

    requested_api_version: '2026-04',
    served_api_version: '2026-04',
    cas_mode: 'change_from_quantity',

    quantity_name: 'on_hand',
    reason: 'correction',

    approved_by_actor_type: 'user',
    approved_by_actor_id: `user-${fixture.shopId}`,
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

    target_item_count: 1,
    provider_only_item_count: 0,
    write_count: 1,
    batch_count: 1,

    status: 'assembling',
    frozen_at: null,

    ...overrides,
  };
}

function entryRow(
  fixture: Fixture,
  generationId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    generation_id: generationId,
    shop_id: fixture.shopId,
    ordinal: 1,

    lasyncro_variant_id: fixture.variantId,
    shopify_inventory_item_gid:
      `gid://shopify/InventoryItem/9${fixture.shopId}`,
    shopify_variant_gid:
      `gid://shopify/ProductVariant/7${fixture.shopId}`,

    target_quantity: 7,
    observed_on_hand_quantity: 5,

    inventory_level_present: true,
    inventory_level_active: true,
    tracked: true,

    disposition: 'write',
    batch_index: 1,
    batch_position: 1,

    ...overrides,
  };
}

function batchRow(
  fixture: Fixture,
  generationId: string,
  overrides: Record<string, unknown> = {}
) {
  const idempotencyKey = crypto.randomUUID();

  return {
    generation_id: generationId,
    shop_id: fixture.shopId,
    batch_index: 1,

    requested_api_version: '2026-04',
    served_api_version: '2026-04',
    cas_mode: 'change_from_quantity',

    operation_name: 'OpeningInventoryCutoverSetOnHand',
    graphql_document:
      'mutation OpeningInventoryCutoverSetOnHand($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) { inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) { userErrors { code field message } } }',

    canonical_variables: JSON.stringify({
      idempotencyKey,
      input: {
        name: 'on_hand',
        reason: 'correction',
        referenceDocumentUri:
          `gid://lasyncro/OpeningInventoryCutover/shop-${fixture.shopId}-generation-${generationId}-batch-1`,
        quantities: [
          {
            inventoryItemId:
              `gid://shopify/InventoryItem/9${fixture.shopId}`,
            locationId:
              `gid://shopify/Location/8${fixture.shopId}`,
            quantity: 7,
            changeFromQuantity: 5,
          },
        ],
      },
    }),

    reference_document_uri:
      `gid://lasyncro/OpeningInventoryCutover/shop-${fixture.shopId}-generation-${generationId}-batch-1`,
    idempotency_key: idempotencyKey,

    request_sha256: '5'.repeat(64),
    entry_count: 1,

    ...overrides,
  };
}

async function insertFrozenGeneration(
  fixture: Fixture,
  overrides: Record<string, unknown> = {}
) {
  const generation = generationRow(fixture, overrides);

  await withTenant(fixture.shopId, async (trx) => {
    await trx(GENERATIONS).insert(generation);

    await trx(ENTRIES).insert(
      entryRow(fixture, String(generation.generation_id))
    );

    await trx(BATCHES).insert(
      batchRow(fixture, String(generation.generation_id))
    );

    await trx(GENERATIONS)
      .where({
        shop_id: fixture.shopId,
        generation_id: generation.generation_id,
      })
      .update({
        status: 'frozen',
        frozen_at: new Date(),
      });
  });

  return generation;
}

async function columnShape(
  shopId: number,
  table: string,
  column: string
) {
  const { rows } = await withTenant(shopId, (trx) =>
    trx.raw(
      `
        SELECT udt_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ?
          AND column_name = ?
      `,
      [table, column]
    )
  );

  return rows;
}

async function constraintDefinitions(
  shopId: number,
  table: string
): Promise<string[]> {
  const { rows } = await withTenant(shopId, (trx) =>
    trx.raw(
      `
        SELECT pg_get_constraintdef(con.oid) AS definition
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = rel.relnamespace
        WHERE ns.nspname = 'public'
          AND rel.relname = ?
        ORDER BY con.conname
      `,
      [table]
    )
  );

  return rows.map((row: any) => String(row.definition));
}

async function indexDefinitions(
  shopId: number,
  table: string
): Promise<string[]> {
  const { rows } = await withTenant(shopId, (trx) =>
    trx.raw(
      `
        SELECT indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = ?
        ORDER BY indexname
      `,
      [table]
    )
  );

  return rows.map((row: any) => String(row.indexdef));
}

describe(
  'GH-1179 Slice D — immutable opening inventory cutover generation persistence',
  () => {
    it('D-M01 — generation, entry and batch tables exist', async () => {
      const fixture = await createFixture('gen-tables');

      const { rows } = await withTenant(fixture.shopId, (trx) =>
        trx.raw(
          `
            SELECT
              to_regclass(?) AS generations,
              to_regclass(?) AS entries,
              to_regclass(?) AS batches
          `,
          [
            `public.${GENERATIONS}`,
            `public.${ENTRIES}`,
            `public.${BATCHES}`,
          ]
        )
      );

      expect({
        generations: rows[0].generations
          ? String(rows[0].generations)
          : null,
        entries: rows[0].entries ? String(rows[0].entries) : null,
        batches: rows[0].batches ? String(rows[0].batches) : null,
      }).toEqual({
        generations: GENERATIONS,
        entries: ENTRIES,
        batches: BATCHES,
      });
    });

    it.each(Object.entries(GENERATION_COLUMNS))(
      'D-M02 — generation.%s matches the immutable contract',
      async (column, expected) => {
        const fixture = await createFixture('gen-header-col');
        const rows = await columnShape(
          fixture.shopId,
          GENERATIONS,
          column
        );

        expect(rows).toHaveLength(1);
        expect(expected.udt).toContain(rows[0].udt_name);
        expect(rows[0].is_nullable).toBe(
          expected.nullable ? 'YES' : 'NO'
        );
      }
    );

    it.each(Object.entries(ENTRY_COLUMNS))(
      'D-M03 — entry.%s matches the immutable contract',
      async (column, expected) => {
        const fixture = await createFixture('gen-entry-col');
        const rows = await columnShape(
          fixture.shopId,
          ENTRIES,
          column
        );

        expect(rows).toHaveLength(1);
        expect(expected.udt).toContain(rows[0].udt_name);
        expect(rows[0].is_nullable).toBe(
          expected.nullable ? 'YES' : 'NO'
        );
      }
    );

    it.each(Object.entries(BATCH_COLUMNS))(
      'D-M04 — batch.%s matches the immutable contract',
      async (column, expected) => {
        const fixture = await createFixture('gen-batch-col');
        const rows = await columnShape(
          fixture.shopId,
          BATCHES,
          column
        );

        expect(rows).toHaveLength(1);
        expect(expected.udt).toContain(rows[0].udt_name);
        expect(rows[0].is_nullable).toBe(
          expected.nullable ? 'YES' : 'NO'
        );
      }
    );

    it('D-M05 — generation identity and tenant child FKs are constrained', async () => {
      const fixture = await createFixture('gen-fks');

      const generationDefs =
        await constraintDefinitions(fixture.shopId, GENERATIONS);

      const entryDefs =
        await constraintDefinitions(fixture.shopId, ENTRIES);

      const batchDefs =
        await constraintDefinitions(fixture.shopId, BATCHES);

      expect(
        generationDefs.some((value) =>
          /UNIQUE \(shop_id, generation_sequence\)/i.test(value)
        )
      ).toBe(true);

      expect(
        generationDefs.some((value) =>
          /UNIQUE \(generation_id, shop_id\)/i.test(value)
        )
      ).toBe(true);

      expect(
        entryDefs.some((value) =>
          /FOREIGN KEY \(generation_id, shop_id\)/i.test(value)
        )
      ).toBe(true);

      expect(
        batchDefs.some((value) =>
          /FOREIGN KEY \(generation_id, shop_id\)/i.test(value)
        )
      ).toBe(true);
    });

    it('D-M06 — provider target identity and non-null idempotency keys are unique', async () => {
      const fixture = await createFixture('gen-unique');

      const entryIndexes =
        await indexDefinitions(fixture.shopId, ENTRIES);

      const batchIndexes =
        await indexDefinitions(fixture.shopId, BATCHES);

      expect(
        entryIndexes.some((value) =>
          /UNIQUE.*generation_id.*shopify_inventory_item_gid/i
            .test(value)
        )
      ).toBe(true);

      expect(
        batchIndexes.some((value) =>
          /UNIQUE.*idempotency_key/i.test(value)
        )
      ).toBe(true);
    });

    it('D-M07 — all generation tables ENABLE and FORCE RLS', async () => {
      const fixture = await createFixture('gen-rls');

      const { rows } = await withTenant(fixture.shopId, (trx) =>
        trx.raw(
          `
            SELECT
              relname,
              relrowsecurity,
              relforcerowsecurity
            FROM pg_class
            WHERE relname = ANY(?)
            ORDER BY relname
          `,
          [[GENERATIONS, ENTRIES, BATCHES]]
        )
      );

      expect(
        rows.map((row: any) => ({
          relname: row.relname,
          enabled: row.relrowsecurity,
          forced: row.relforcerowsecurity,
        }))
      ).toEqual([
        { relname: BATCHES, enabled: true, forced: true },
        { relname: ENTRIES, enabled: true, forced: true },
        { relname: GENERATIONS, enabled: true, forced: true },
      ]);
    });

    it('D-M08 — generation sequence is unique per shop but reusable by another shop', async () => {
      const a = await createFixture('gen-seq-a');
      const b = await createFixture('gen-seq-b');

      await insertFrozenGeneration(a);

      await expect(
        withTenant(a.shopId, (trx) =>
          trx(GENERATIONS).insert(
            generationRow(a, {
              generation_id: crypto.randomUUID(),
              generation_sequence: 1,
            })
          )
        )
      ).rejects.toBeDefined();

      await expect(
        insertFrozenGeneration(b)
      ).resolves.toBeDefined();
    });

    it('D-M09 — child tenant mismatch cannot cross generation ownership', async () => {
      const a = await createFixture('gen-tenant-a');
      const b = await createFixture('gen-tenant-b');

      const generation = await insertFrozenGeneration(a);

      await expect(
        withTenant(b.shopId, (trx) =>
          trx(ENTRIES).insert(
            entryRow(b, String(generation.generation_id), {
              shop_id: b.shopId,
            })
          )
        )
      ).rejects.toBeDefined();
    });

    it('D-M10 — frozen request facts reject update, delete and late append', async () => {
      const fixture = await createFixture('gen-immutable');
      const generation = generationRow(fixture);

      await withTenant(fixture.shopId, async (trx) => {
        await trx(GENERATIONS).insert(generation);

        await trx(ENTRIES).insert(
          entryRow(fixture, String(generation.generation_id))
        );

        await trx(BATCHES).insert(
          batchRow(fixture, String(generation.generation_id))
        );

        await trx(GENERATIONS)
          .where({
            shop_id: fixture.shopId,
            generation_id: generation.generation_id,
          })
          .update({
            status: 'frozen',
            frozen_at: new Date(),
          });
      });

      await expect(
        withTenant(fixture.shopId, (trx) =>
          trx(GENERATIONS)
            .where({
              shop_id: fixture.shopId,
              generation_id: generation.generation_id,
            })
            .update({ generation_fingerprint: '9'.repeat(64) })
        )
      ).rejects.toBeDefined();

      await expect(
        withTenant(fixture.shopId, (trx) =>
          trx(ENTRIES)
            .where({
              shop_id: fixture.shopId,
              generation_id: generation.generation_id,
              ordinal: 1,
            })
            .update({ target_quantity: 99 })
        )
      ).rejects.toBeDefined();

      await expect(
        withTenant(fixture.shopId, (trx) =>
          trx(BATCHES)
            .where({
              shop_id: fixture.shopId,
              generation_id: generation.generation_id,
              batch_index: 1,
            })
            .update({ request_sha256: '9'.repeat(64) })
        )
      ).rejects.toBeDefined();

      await expect(
        withTenant(fixture.shopId, (trx) =>
          trx(ENTRIES).insert(
            entryRow(
              fixture,
              String(generation.generation_id),
              {
                ordinal: 2,
                shopify_inventory_item_gid:
                  `gid://shopify/InventoryItem/10${fixture.shopId}`,
                batch_position: 2,
              }
            )
          )
        )
      ).rejects.toBeDefined();

      await expect(
        withTenant(fixture.shopId, (trx) =>
          trx(GENERATIONS)
            .where({
              shop_id: fixture.shopId,
              generation_id: generation.generation_id,
            })
            .del()
        )
      ).rejects.toBeDefined();

      const persisted = await withTenant(
        fixture.shopId,
        (trx) =>
          trx(GENERATIONS)
            .where({
              shop_id: fixture.shopId,
              generation_id: generation.generation_id,
            })
            .first()
      );

      expect(persisted?.status).toBe('frozen');
      expect(persisted?.generation_fingerprint).toBe('4'.repeat(64));
    });

    it('D-M11 — another tenant cannot read frozen generation evidence', async () => {
      const owner = await createFixture('gen-owner');
      const other = await createFixture('gen-other');

      const generation = await insertFrozenGeneration(owner);

      const foreign = await withTenant(other.shopId, async (trx) => ({
        generations: await trx(GENERATIONS)
          .where({ generation_id: generation.generation_id }),
        entries: await trx(ENTRIES)
          .where({ generation_id: generation.generation_id }),
        batches: await trx(BATCHES)
          .where({ generation_id: generation.generation_id }),
      }));

      expect(foreign).toEqual({
        generations: [],
        entries: [],
        batches: [],
      });
    });
    it('D-M12 — an assembling generation cannot survive transaction commit', async () => {
      const fixture = await createFixture('gen-unfinished');

      await expect(
        withTenant(fixture.shopId, (trx) =>
          trx(GENERATIONS).insert(generationRow(fixture))
        )
      ).rejects.toThrow(
        /OPENING_INVENTORY_CUTOVER_GENERATION_UNFINISHED/
      );

      const persisted = await withTenant(
        fixture.shopId,
        (trx) => trx(GENERATIONS).select('*')
      );

      expect(persisted).toEqual([]);
    });

    it('D-M13 — retired legacy served CAS contracts fail closed', async () => {
      const fixture = await createFixture('gen-retired-contract');

      await expect(
        withTenant(fixture.shopId, (trx) =>
          trx(GENERATIONS).insert(
            generationRow(fixture, {
              requested_api_version: '2025-07',
              served_api_version: '2025-07',
              cas_mode: 'compare_quantity',
            })
          )
        )
      ).rejects.toBeDefined();

      const persisted = await withTenant(
        fixture.shopId,
        (trx) => trx(GENERATIONS).select('*')
      );

      expect(persisted).toEqual([]);
    });

    it('D26-M1 — generation header exposes NOT NULL text stable Shopify Shop GID', async () => {
      const fixture = await createFixture('gen-shop-gid-col');

      const rows = await columnShape(
        fixture.shopId,
        GENERATIONS,
        'shopify_shop_gid'
      );

      expect(rows).toHaveLength(1);
      expect(TEXT).toContain(rows[0].udt_name);
      expect(rows[0].is_nullable).toBe('NO');
    });

    it('D26-M2 — generation header enforces canonical Shopify Shop GID shape', async () => {
      const fixture = await createFixture('gen-shop-gid-check');

      const checks = (
        await constraintDefinitions(fixture.shopId, GENERATIONS)
      ).filter(
        (definition) =>
          /^CHECK\b/i.test(definition) &&
          /\bshopify_shop_gid\b/.test(definition)
      );

      // Extract case-sensitive POSIX match literals (`~ '...'`), excluding
      // `!~` and `~*`, so formatting/casts in the rendered expression do not
      // matter. Each candidate is then judged by PostgreSQL itself.
      const patterns = checks.flatMap((definition) =>
        Array.from(
          definition.matchAll(/(?:^|[^!~])~\s*'((?:[^']|'')*)'/g),
          (match) => match[1].replace(/''/g, "'")
        )
      );

      const accept = [
        'gid://shopify/Shop/1',
        'gid://shopify/Shop/1234567890',
      ];

      const reject = [
        '',
        'gid://shopify/Shop/',
        'gid://shopify/Shop/abc',
        'gid://shopify/Shop/12a',
        'gid://shopify/shop/1',
        'gid://shopify/Location/1',
        'xgid://shopify/Shop/1',
        'gid://shopify/Shop/1/2',
        'gid://shopify/Shop/1 ',
        'shop.myshopify.com',
      ];

      const canonical: string[] = [];

      for (const pattern of patterns) {
        const { rows } = await withTenant(fixture.shopId, (trx) =>
          trx.raw(
            `
              SELECT
                bool_and(sample ~ ?) FILTER (WHERE expected) AS accepts_all,
                bool_or(sample ~ ?) FILTER (WHERE NOT expected) AS accepts_any_invalid
              FROM (
                SELECT unnest(?::text[]) AS sample, true AS expected
                UNION ALL
                SELECT unnest(?::text[]) AS sample, false AS expected
              ) samples
            `,
            [pattern, pattern, accept, reject]
          )
        );

        if (
          rows[0].accepts_all === true &&
          rows[0].accepts_any_invalid === false
        ) {
          canonical.push(pattern);
        }
      }

      expect({ checks, canonical }).toEqual({
        checks: expect.any(Array),
        canonical: expect.arrayContaining([expect.any(String)]),
      });
    });

  }
);
