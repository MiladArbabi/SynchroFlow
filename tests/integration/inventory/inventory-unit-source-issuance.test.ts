import crypto from 'crypto';

import {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import {
  generateLsuId,
  issueReconciledUnits,
} from 'api-src/services/wms/inventoryUnit.service';

jest.setTimeout(30000);

type Fixture = {
  shopId: number;
  variantId: string;
  recountLineId: string;
};

async function createFixture(): Promise<Fixture> {
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(
      trx,
      `inventory-unit-issuance-${crypto.randomUUID().slice(0, 8)}`
    );
    await setTenantContext(trx, id);
    return id;
  });

  return withTenant(shopId, async (trx) => {
    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    const warehouseId = crypto.randomUUID();
    const rootCode = `WH-${shopId}-ROOT`;

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Inventory unit issuance product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `IUI-${crypto.randomUUID().slice(0, 8)}`,
      title: 'Inventory unit issuance variant',
      unit_cost: '1.00',
      status: 'active',
    });

    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'Inventory unit issuance warehouse',
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });

    await trx('warehouse_locations').insert([
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: rootCode,
        type: 'warehouse',
        parent_location_code: null,
        active: true,
        zone_type: null,
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: 'A-1',
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
    ]);

    const taskRow = await trx('inventory_recount_tasks')
      .insert({
        shop_id: shopId,
        warehouse_id: warehouseId,
        label: `RC-IUI-${crypto.randomUUID().slice(0, 8)}`,
        scope: 'location',
        status: 'manual_review',
        blind: true,
      })
      .returning('recount_task_id')
      .then((rows) => rows[0]);

    const recountTaskId = String(
      (taskRow as any).recount_task_id ?? taskRow
    );

    const lineRow = await trx('inventory_recount_lines')
      .insert({
        recount_task_id: recountTaskId,
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        location_code: 'A-1',
        expected_quantity: 0,
      })
      .returning('recount_line_id')
      .then((rows) => rows[0]);

    return {
      shopId,
      variantId,
      recountLineId: String(
        (lineRow as any).recount_line_id ?? lineRow
      ),
    };
  });
}

describe('canonical LSU issuance from Reconcile lineage', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture();
  });

  it('creates deterministic stowed LSUs at the observed bin without Receive lineage', async () => {
    const canonicalizedAt = new Date('2026-09-22T18:30:00.000Z');

    const units = await withTenant(fixture.shopId, (trx) =>
      issueReconciledUnits(trx, {
        shopId: fixture.shopId,
        recountLineId: fixture.recountLineId,
        lasyncroVariantId: fixture.variantId,
        quantity: 2,
        currentLocationCode: 'A-1',
        canonicalizedAt,
      })
    );

    expect(units).toHaveLength(2);
    expect(units.map((row) => row.receive_sequence)).toEqual([1, 2]);
    expect(units.map((row) => row.lasyncro_unit_id)).toEqual([
      generateLsuId(fixture.shopId, fixture.recountLineId, 1),
      generateLsuId(fixture.shopId, fixture.recountLineId, 2),
    ]);

    const persisted = await withTenant(fixture.shopId, (trx) =>
      trx('inventory_units')
        .where({
          shop_id: fixture.shopId,
          recount_line_id: fixture.recountLineId,
        })
        .orderBy('receive_sequence')
        .select(
          'lasyncro_unit_id',
          'receive_job_line_id',
          'recount_line_id',
          'receive_sequence',
          'source',
          'status',
          'current_location_code',
          'received_at',
          'label_printed_at'
        )
    );

    expect(persisted).toHaveLength(2);

    for (const row of persisted) {
      expect(row.receive_job_line_id).toBeNull();
      expect(row.recount_line_id).toBe(fixture.recountLineId);
      expect(row.source).toBe('opening_inventory_reconcile');
      expect(row.status).toBe('stowed');
      expect(row.current_location_code).toBe('A-1');
      expect(new Date(row.received_at).toISOString()).toBe(
        canonicalizedAt.toISOString()
      );
      expect(row.label_printed_at).toBeNull();
    }
  });

  it('is idempotent for the same settled recount line', async () => {
    const retry = await withTenant(fixture.shopId, (trx) =>
      issueReconciledUnits(trx, {
        shopId: fixture.shopId,
        recountLineId: fixture.recountLineId,
        lasyncroVariantId: fixture.variantId,
        quantity: 2,
        currentLocationCode: 'A-1',
        canonicalizedAt: new Date('2026-09-22T19:00:00.000Z'),
      })
    );

    expect(retry.map((row) => row.lasyncro_unit_id)).toEqual([
      generateLsuId(fixture.shopId, fixture.recountLineId, 1),
      generateLsuId(fixture.shopId, fixture.recountLineId, 2),
    ]);

    const count = await withTenant(fixture.shopId, (trx) =>
      trx('inventory_units')
        .where({
          shop_id: fixture.shopId,
          recount_line_id: fixture.recountLineId,
        })
        .count<{ count: string }>('* as count')
        .first()
    );

    expect(Number(count?.count ?? 0)).toBe(2);
  });

  it('fails closed if a settled recount line is retried with a different quantity', async () => {
    await expect(
      withTenant(fixture.shopId, (trx) =>
        issueReconciledUnits(trx, {
          shopId: fixture.shopId,
          recountLineId: fixture.recountLineId,
          lasyncroVariantId: fixture.variantId,
          quantity: 3,
          currentLocationCode: 'A-1',
          canonicalizedAt: new Date(),
        })
      )
    ).rejects.toThrow(/RECOUNT_ISSUANCE_MISMATCH/);

    const count = await withTenant(fixture.shopId, (trx) =>
      trx('inventory_units')
        .where({
          shop_id: fixture.shopId,
          recount_line_id: fixture.recountLineId,
        })
        .count<{ count: string }>('* as count')
        .first()
    );

    expect(Number(count?.count ?? 0)).toBe(2);
  });

  it('fails closed if existing canonical lineage is retried against a different bin', async () => {
    await expect(
      withTenant(fixture.shopId, (trx) =>
        issueReconciledUnits(trx, {
          shopId: fixture.shopId,
          recountLineId: fixture.recountLineId,
          lasyncroVariantId: fixture.variantId,
          quantity: 2,
          currentLocationCode: 'B-99',
          canonicalizedAt: new Date(),
        })
      )
    ).rejects.toThrow(/RECOUNT_LOCATION_MISMATCH/);
  });

  it('fails closed when the recount line belongs to a different variant', async () => {
    await expect(
      withTenant(fixture.shopId, (trx) =>
        issueReconciledUnits(trx, {
          shopId: fixture.shopId,
          recountLineId: fixture.recountLineId,
          lasyncroVariantId: crypto.randomUUID(),
          quantity: 2,
          currentLocationCode: 'A-1',
          canonicalizedAt: new Date(),
        })
      )
    ).rejects.toThrow(/RECOUNT_VARIANT_MISMATCH/);
  });

  it('fails closed when the recount lineage anchor does not exist', async () => {
    await expect(
      withTenant(fixture.shopId, (trx) =>
        issueReconciledUnits(trx, {
          shopId: fixture.shopId,
          recountLineId: crypto.randomUUID(),
          lasyncroVariantId: fixture.variantId,
          quantity: 1,
          currentLocationCode: 'A-1',
          canonicalizedAt: new Date(),
        })
      )
    ).rejects.toThrow(/RECOUNT_LINE_NOT_FOUND/);
  });
});
