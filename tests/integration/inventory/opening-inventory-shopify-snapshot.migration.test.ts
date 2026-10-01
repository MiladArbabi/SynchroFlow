// tests/integration/inventory/opening-inventory-shopify-snapshot.migration.test.ts
//
// GH-1179 Slice B / MIGRATION 0200 — permanent DB contract for the immutable,
// location-scoped Shopify on_hand snapshot captured at Opening Inventory start.
//
// Header: opening_inventory_shopify_snapshots (one collection attempt).
// Lines:  opening_inventory_shopify_snapshot_lines (one Shopify inventory level).
//
// Schema and database invariants only. No Shopify client, start orchestration,
// controller or UI. Trigger rejection text is not frozen: each rejection is
// asserted by failure plus unchanged persisted state.

import crypto from 'crypto';

import {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';

import { createTenantShop } from
  '@lasyncro/backend-core/services/pre-tenant.service.js';

jest.setTimeout(60000);

const SNAPSHOTS = 'opening_inventory_shopify_snapshots';
const LINES = 'opening_inventory_shopify_snapshot_lines';

type ColumnContract = {
  // 'either' = nullability is not part of the ratified minimum contract.
  nullable: boolean | 'either';
  udt: string[];
};

const TEXT = ['varchar', 'text'];
const INT = ['int4', 'int8'];

const SNAPSHOT_COLUMNS: Record<string, ColumnContract> = {
  snapshot_id:           { nullable: false,    udt: ['uuid'] },
  shop_id:               { nullable: false,    udt: INT },
  warehouse_id:          { nullable: false,    udt: ['uuid'] },
  shopify_location_id:   { nullable: false,    udt: TEXT },
  attempt_number:        { nullable: false,    udt: INT },
  status:                { nullable: false,    udt: TEXT },
  collection_token:      { nullable: false,    udt: ['uuid'] },
  collection_started_at: { nullable: false,    udt: ['timestamptz'] },
  lease_expires_at:      { nullable: 'either', udt: ['timestamptz'] },
  completed_at:          { nullable: true,     udt: ['timestamptz'] },
  line_count:            { nullable: true,     udt: INT },
  page_count:            { nullable: true,     udt: INT },
  shopify_api_version:   { nullable: 'either', udt: TEXT },
  failure_code:          { nullable: true,     udt: TEXT },
  created_at:            { nullable: false,    udt: ['timestamptz'] },
  updated_at:            { nullable: false,    udt: ['timestamptz'] },
};

const LINE_COLUMNS: Record<string, ColumnContract> = {
  id:                        { nullable: false,    udt: INT },
  snapshot_id:               { nullable: false,    udt: ['uuid'] },
  shop_id:                   { nullable: false,    udt: INT },
  shopify_inventory_item_id: { nullable: false,    udt: TEXT },
  shopify_variant_id:        { nullable: true,     udt: TEXT },
  lasyncro_variant_id:       { nullable: true,     udt: ['uuid'] },
  inventory_level_present:   { nullable: false,    udt: ['bool'] },
  inventory_level_active:    { nullable: 'either', udt: ['bool'] },
  tracked:                   { nullable: true,     udt: ['bool'] },
  on_hand_quantity:          { nullable: true,     udt: INT },
  created_at:                { nullable: false,    udt: ['timestamptz'] },
};

type Fixture = {
  shopId: number;
  warehouseId: string;
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
      name: `Snapshot warehouse ${unique}`,
      root_location_code: `SNAP-${unique}-ROOT`,
      is_default: true,
      active: true,
      external_location_id: `7${shopId}`,
    });

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Snapshot product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `SNAP-${unique}`,
      title: 'Snapshot variant',
      unit_cost: '1.00',
      status: 'active',
    });
  });

  return { shopId, warehouseId, variantId };
}

function headerRow(
  fixture: Fixture,
  overrides: Record<string, unknown> = {}
) {
  return {
    snapshot_id: crypto.randomUUID(),
    shop_id: fixture.shopId,
    warehouse_id: fixture.warehouseId,
    shopify_location_id: `gid://shopify/Location/7${fixture.shopId}`,
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
    ...overrides,
  };
}

function lineRow(
  fixture: Fixture,
  snapshotId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    snapshot_id: snapshotId,
    shop_id: fixture.shopId,
    shopify_inventory_item_id:
      `gid://shopify/InventoryItem/${crypto.randomInt(1_000_000, 9_999_999)}`,
    shopify_variant_id: null,
    lasyncro_variant_id: null,
    inventory_level_present: true,
    inventory_level_active: true,
    tracked: true,
    on_hand_quantity: 0,
    ...overrides,
  };
}

async function insertHeader(
  fixture: Fixture,
  overrides: Record<string, unknown> = {}
): Promise<Record<string, any>> {
  const row = headerRow(fixture, overrides);
  await withTenant(fixture.shopId, (trx) => trx(SNAPSHOTS).insert(row));
  return row;
}

async function updateHeader(
  fixture: Fixture,
  snapshotId: string,
  patch: Record<string, unknown>
) {
  return withTenant(fixture.shopId, (trx) =>
    trx(SNAPSHOTS)
      .where({ shop_id: fixture.shopId, snapshot_id: snapshotId })
      .update(patch)
  );
}

async function readHeader(fixture: Fixture, snapshotId: string) {
  return withTenant(fixture.shopId, (trx) =>
    trx(SNAPSHOTS)
      .where({ shop_id: fixture.shopId, snapshot_id: snapshotId })
      .first()
  );
}

async function insertLine(
  fixture: Fixture,
  snapshotId: string,
  overrides: Record<string, unknown> = {}
): Promise<Record<string, any>> {
  const row = lineRow(fixture, snapshotId, overrides);
  await withTenant(fixture.shopId, (trx) => trx(LINES).insert(row));
  return row;
}

async function readLines(fixture: Fixture, snapshotId: string) {
  return withTenant(fixture.shopId, (trx) =>
    trx(LINES)
      .where({ shop_id: fixture.shopId, snapshot_id: snapshotId })
      .orderBy('id', 'asc')
  );
}

const completePatch = (lineCount = 0, pageCount = 1) => ({
  status: 'complete',
  completed_at: new Date(),
  line_count: lineCount,
  page_count: pageCount,
});

describe('GH-1179 Slice B — opening inventory Shopify on_hand snapshot migration', () => {
  describe('schema surface', () => {
    it('B1.1 — header and line tables exist', async () => {
      const fixture = await createFixture('snap-tables');

      const { rows } = await withTenant(fixture.shopId, (trx) =>
        trx.raw(
          `SELECT to_regclass(?) AS header, to_regclass(?) AS lines`,
          [`public.${SNAPSHOTS}`, `public.${LINES}`]
        )
      );

      expect({
        header: rows[0].header ? String(rows[0].header) : null,
        lines: rows[0].lines ? String(rows[0].lines) : null,
      }).toEqual({ header: SNAPSHOTS, lines: LINES });
    });

    async function columnShape(shopId: number, table: string, column: string) {
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

    it.each(Object.entries(SNAPSHOT_COLUMNS))(
      'B1.2 — header.%s matches the snapshot contract',
      async (column, expected) => {
        const fixture = await createFixture('snap-cols-header');
        const rows = await columnShape(fixture.shopId, SNAPSHOTS, column);

        expect(rows).toHaveLength(1);
        expect(expected.udt).toContain(rows[0].udt_name);
        if (expected.nullable !== 'either') {
          expect(rows[0].is_nullable).toBe(expected.nullable ? 'YES' : 'NO');
        }
      }
    );

    it.each(Object.entries(LINE_COLUMNS))(
      'B1.2 — line.%s matches the snapshot contract',
      async (column, expected) => {
        const fixture = await createFixture('snap-cols-line');
        const rows = await columnShape(fixture.shopId, LINES, column);

        expect(rows).toHaveLength(1);
        expect(expected.udt).toContain(rows[0].udt_name);
        if (expected.nullable !== 'either') {
          expect(rows[0].is_nullable).toBe(expected.nullable ? 'YES' : 'NO');
        }
      }
    );
  });

  describe('attempt identity and single live snapshot', () => {
    it('B1.3 — attempt_number is unique per shop', async () => {
      const fixture = await createFixture('snap-attempt');
      const first = await insertHeader(fixture, { attempt_number: 1 });
      await updateHeader(fixture, first.snapshot_id, { status: 'failed' });

      await expect(
        insertHeader(fixture, { attempt_number: 1 })
      ).rejects.toThrow();

      const second = await insertHeader(fixture, { attempt_number: 2 });
      expect((await readHeader(fixture, second.snapshot_id))?.attempt_number).toBe(2);
    });

    it('B1.4 — at most one collecting/complete snapshot per shop; terminal failures do not block a new attempt', async () => {
      const fixture = await createFixture('snap-live');
      const first = await insertHeader(fixture, { attempt_number: 1 });

      await expect(
        insertHeader(fixture, { attempt_number: 2 })
      ).rejects.toThrow();

      await updateHeader(fixture, first.snapshot_id, completePatch());

      await expect(
        insertHeader(fixture, { attempt_number: 2 })
      ).rejects.toThrow();

      const otherFixture = await createFixture('snap-live-failed');
      const failed = await insertHeader(otherFixture, { attempt_number: 1 });
      await updateHeader(otherFixture, failed.snapshot_id, { status: 'failed' });

      const retry = await insertHeader(otherFixture, { attempt_number: 2 });
      expect((await readHeader(otherFixture, retry.snapshot_id))?.status).toBe('collecting');
    });
  });

  describe('lifecycle checks', () => {
    it('B1.5 — rejects unknown status, collecting without lease, and complete without completion evidence', async () => {
      const fixture = await createFixture('snap-lifecycle');

      await expect(
        insertHeader(fixture, { status: 'started' })
      ).rejects.toThrow();

      await expect(
        insertHeader(fixture, { lease_expires_at: null })
      ).rejects.toThrow();

      await expect(
        insertHeader(fixture, { attempt_number: 0 })
      ).rejects.toThrow();

      const header = await insertHeader(fixture);

      for (const invalidCompletion of [
        { ...completePatch(), completed_at: null },
        { ...completePatch(), line_count: null },
        { ...completePatch(), page_count: null },
        { ...completePatch(), line_count: -1 },
        { ...completePatch(), page_count: -1 },
      ]) {
        await expect(
          updateHeader(fixture, header.snapshot_id, invalidCompletion)
        ).rejects.toThrow();
      }

      expect((await readHeader(fixture, header.snapshot_id))?.status).toBe('collecting');
    });
  });

  describe('immutability', () => {
    it('B1.6 — header identity fields are immutable while collecting; the lease may be refreshed', async () => {
      const fixture = await createFixture('snap-identity');
      const otherWarehouseId = crypto.randomUUID();

      await withTenant(fixture.shopId, (trx) =>
        trx('warehouses').insert({
          warehouse_id: otherWarehouseId,
          shop_id: fixture.shopId,
          name: `Other ${otherWarehouseId.slice(0, 8)}`,
          root_location_code: `SNAP-OTHER-${otherWarehouseId.slice(0, 8)}`,
          is_default: false,
          active: true,
        })
      );

      const header = await insertHeader(fixture);

      for (const patch of [
        { warehouse_id: otherWarehouseId },
        { shopify_location_id: 'gid://shopify/Location/999999' },
        { attempt_number: 9 },
        { collection_token: crypto.randomUUID() },
        { collection_started_at: new Date(Date.now() - 60_000) },
      ]) {
        await expect(
          updateHeader(fixture, header.snapshot_id, patch)
        ).rejects.toThrow();
      }

      const refreshedLease = new Date(Date.now() + 10 * 60_000);
      await updateHeader(fixture, header.snapshot_id, {
        lease_expires_at: refreshedLease,
      });

      const persisted = await readHeader(fixture, header.snapshot_id);
      expect({
        warehouse_id: persisted?.warehouse_id,
        shopify_location_id: persisted?.shopify_location_id,
        attempt_number: persisted?.attempt_number,
        collection_token: persisted?.collection_token,
        lease_refreshed:
          new Date(persisted?.lease_expires_at).getTime() ===
          refreshedLease.getTime(),
      }).toEqual({
        warehouse_id: header.warehouse_id,
        shopify_location_id: header.shopify_location_id,
        attempt_number: header.attempt_number,
        collection_token: header.collection_token,
        lease_refreshed: true,
      });
    });

    it.each(['complete', 'failed', 'abandoned'])(
      'B1.7 — collecting → %s is allowed and the terminal row is then immutable',
      async (terminal) => {
        const fixture = await createFixture(`snap-terminal-${terminal}`);
        const header = await insertHeader(fixture);

        await updateHeader(
          fixture,
          header.snapshot_id,
          terminal === 'complete' ? completePatch() : { status: terminal }
        );

        const terminalRow = await readHeader(fixture, header.snapshot_id);
        expect(terminalRow?.status).toBe(terminal);

        for (const patch of [
          { status: 'collecting' },
          { status: terminal === 'failed' ? 'abandoned' : 'failed' },
          { failure_code: 'LATE_MUTATION' },
          { lease_expires_at: new Date(Date.now() + 60 * 60_000) },
        ]) {
          await expect(
            updateHeader(fixture, header.snapshot_id, patch)
          ).rejects.toThrow();
        }

        expect((await readHeader(fixture, header.snapshot_id))?.status).toBe(terminal);
      }
    );

    it('B1.8 — header DELETE is rejected', async () => {
      const fixture = await createFixture('snap-delete');
      const header = await insertHeader(fixture);

      await expect(
        withTenant(fixture.shopId, (trx) =>
          trx(SNAPSHOTS).where({ snapshot_id: header.snapshot_id }).del()
        )
      ).rejects.toThrow();

      expect(await readHeader(fixture, header.snapshot_id)).toBeTruthy();
    });
  });

  describe('snapshot lines', () => {
    it('B1.9 — lines may be inserted only while the parent snapshot is collecting', async () => {
      const fixture = await createFixture('snap-line-parent');
      const header = await insertHeader(fixture);

      await insertLine(fixture, header.snapshot_id);
      await updateHeader(fixture, header.snapshot_id, completePatch(1, 1));

      await expect(
        insertLine(fixture, header.snapshot_id)
      ).rejects.toThrow();

      const failedFixture = await createFixture('snap-line-failed');
      const failed = await insertHeader(failedFixture);
      await updateHeader(failedFixture, failed.snapshot_id, { status: 'failed' });

      await expect(
        insertLine(failedFixture, failed.snapshot_id)
      ).rejects.toThrow();

      expect(await readLines(fixture, header.snapshot_id)).toHaveLength(1);
      expect(await readLines(failedFixture, failed.snapshot_id)).toHaveLength(0);
    });

    it('B1.10 — line UPDATE and DELETE are rejected', async () => {
      const fixture = await createFixture('snap-line-immutable');
      const header = await insertHeader(fixture);
      const line = await insertLine(fixture, header.snapshot_id, {
        on_hand_quantity: 4,
      });

      await expect(
        withTenant(fixture.shopId, (trx) =>
          trx(LINES)
            .where({
              snapshot_id: header.snapshot_id,
              shopify_inventory_item_id: line.shopify_inventory_item_id,
            })
            .update({ on_hand_quantity: 5 })
        )
      ).rejects.toThrow();

      await expect(
        withTenant(fixture.shopId, (trx) =>
          trx(LINES).where({ snapshot_id: header.snapshot_id }).del()
        )
      ).rejects.toThrow();

      const [persisted] = await readLines(fixture, header.snapshot_id);
      expect(persisted?.on_hand_quantity).toBe(4);
    });

    it('B1.11 — duplicate Shopify inventory item or LaSyncro variant within one snapshot is rejected', async () => {
      const fixture = await createFixture('snap-line-dup');
      const header = await insertHeader(fixture);
      const itemGid = 'gid://shopify/InventoryItem/424242';

      await insertLine(fixture, header.snapshot_id, {
        shopify_inventory_item_id: itemGid,
        lasyncro_variant_id: fixture.variantId,
      });

      await expect(
        insertLine(fixture, header.snapshot_id, {
          shopify_inventory_item_id: itemGid,
        })
      ).rejects.toThrow();

      await expect(
        insertLine(fixture, header.snapshot_id, {
          lasyncro_variant_id: fixture.variantId,
        })
      ).rejects.toThrow();

      // Unknown Shopify items (no LaSyncro identity) may coexist.
      await insertLine(fixture, header.snapshot_id);
      await insertLine(fixture, header.snapshot_id);

      expect(await readLines(fixture, header.snapshot_id)).toHaveLength(3);
    });

    it('B1.13 — zero on_hand persists as exactly zero', async () => {
      const fixture = await createFixture('snap-line-zero');
      const header = await insertHeader(fixture);
      await insertLine(fixture, header.snapshot_id, { on_hand_quantity: 0 });

      const [line] = await readLines(fixture, header.snapshot_id);
      expect({
        inventory_level_present: line?.inventory_level_present,
        on_hand_quantity: line?.on_hand_quantity,
      }).toEqual({ inventory_level_present: true, on_hand_quantity: 0 });
    });

    it('B1.14 — a missing inventory level is present=false with NULL on_hand, never zero', async () => {
      const fixture = await createFixture('snap-line-missing');
      const header = await insertHeader(fixture);

      await insertLine(fixture, header.snapshot_id, {
        inventory_level_present: false,
        inventory_level_active: null,
        on_hand_quantity: null,
      });

      await expect(
        insertLine(fixture, header.snapshot_id, {
          inventory_level_present: false,
          on_hand_quantity: 0,
        })
      ).rejects.toThrow();

      await expect(
        insertLine(fixture, header.snapshot_id, {
          inventory_level_present: true,
          on_hand_quantity: null,
        })
      ).rejects.toThrow();

      const lines = await readLines(fixture, header.snapshot_id);
      expect(
        lines.map((line: any) => ({
          present: line.inventory_level_present,
          on_hand: line.on_hand_quantity,
        }))
      ).toEqual([{ present: false, on_hand: null }]);
    });

    it('B1.15 — a negative raw provider on_hand is structurally allowed', async () => {
      const fixture = await createFixture('snap-line-negative');
      const header = await insertHeader(fixture);
      await insertLine(fixture, header.snapshot_id, { on_hand_quantity: -3 });

      const [line] = await readLines(fixture, header.snapshot_id);
      expect(line?.on_hand_quantity).toBe(-3);
    });
  });

  describe('tenant-safe references', () => {
    it('B1.12 — a header cannot reference another shop warehouse and a line cannot reference another shop snapshot', async () => {
      const shopA = await createFixture('snap-fk-a');
      const shopB = await createFixture('snap-fk-b');

      await expect(
        insertHeader(shopA, { warehouse_id: shopB.warehouseId })
      ).rejects.toThrow();

      const headerA = await insertHeader(shopA);

      await expect(
        withTenant(shopB.shopId, (trx) =>
          trx(LINES).insert(lineRow(shopB, headerA.snapshot_id))
        )
      ).rejects.toThrow();

      expect(await readLines(shopA, headerA.snapshot_id)).toHaveLength(0);
    });
  });

  describe('tenant isolation', () => {
    it.each([SNAPSHOTS, LINES])(
      'B1.16 — %s has ENABLE + FORCE RLS',
      async (table) => {
        const fixture = await createFixture('snap-rls-flags');

        const { rows } = await withTenant(fixture.shopId, (trx) =>
          trx.raw(
            `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ?`,
            [table]
          )
        );

        expect(rows).toHaveLength(1);
        expect(rows[0].relrowsecurity).toBe(true);
        expect(rows[0].relforcerowsecurity).toBe(true);
      }
    );

    it('B1.16 — cross-tenant reads see nothing and cross-tenant writes are rejected', async () => {
      const shopA = await createFixture('snap-rls-a');
      const shopB = await createFixture('snap-rls-b');

      const headerA = await insertHeader(shopA);
      await insertLine(shopA, headerA.snapshot_id);

      const visibleToB = await withTenant(shopB.shopId, async (trx) => ({
        headers: (await trx(SNAPSHOTS).select('snapshot_id')).length,
        lines: (await trx(LINES).select('id')).length,
      }));

      expect(visibleToB).toEqual({ headers: 0, lines: 0 });

      await expect(
        withTenant(shopB.shopId, (trx) =>
          trx(SNAPSHOTS).insert(headerRow(shopA, { attempt_number: 2 }))
        )
      ).rejects.toThrow(/row-level security/i);
    });
  });
});
