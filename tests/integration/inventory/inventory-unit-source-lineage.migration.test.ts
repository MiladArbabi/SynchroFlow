import crypto from 'crypto';

import {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

jest.setTimeout(30000);

type Fixture = {
  shopId: number;
  variantId: string;
  receiveLineA: string;
  receiveLineB: string;
  recountLineA: string;
  recountLineB: string;
};

async function createFixture(): Promise<Fixture> {
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(
      trx,
      `inventory-unit-lineage-${crypto.randomUUID().slice(0, 8)}`
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
      title: 'Inventory unit lineage product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `IUL-${crypto.randomUUID().slice(0, 8)}`,
      title: 'Inventory unit lineage variant',
      unit_cost: '1.00',
      status: 'active',
    });

    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'Inventory unit lineage warehouse',
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

    const supplierRow = await trx('suppliers')
      .insert({
        shop_id: shopId,
        name: 'Inventory unit lineage supplier',
        active: true,
      })
      .returning('id')
      .then((rows) => rows[0]);

    const supplierId = Number((supplierRow as any).id ?? supplierRow);

    async function createReceiveLine(): Promise<string> {
      const poRow = await trx('purchase_orders')
        .insert({
          shop_id: shopId,
          supplier_id: supplierId,
          status: 'shipped',
        })
        .returning('id')
        .then((rows) => rows[0]);

      const poId = String((poRow as any).id ?? poRow);

      const poLineRow = await trx('purchase_order_line_items')
        .insert({
          po_id: poId,
          shop_id: shopId,
          lasyncro_variant_id: variantId,
          description: 'Inventory unit lineage line',
          quantity_ordered: 1,
          quantity_received: 1,
        })
        .returning('id')
        .then((rows) => rows[0]);

      const receiveJobRow = await trx('receive_jobs')
        .insert({
          shop_id: shopId,
          po_id: poId,
          status: 'closed',
          total_variants: 1,
          total_units: 1,
        })
        .returning('receive_job_id')
        .then((rows) => rows[0]);

      const receiveJobId = String(
        (receiveJobRow as any).receive_job_id ?? receiveJobRow
      );

      const receiveLineRow = await trx('receive_job_lines')
        .insert({
          shop_id: shopId,
          receive_job_id: receiveJobId,
          po_line_item_id: (poLineRow as any).id ?? poLineRow,
          lasyncro_variant_id: variantId,
          quantity_expected: 1,
          quantity_accepted: 1,
          inspection_complete: true,
        })
        .returning('receive_job_line_id')
        .then((rows) => rows[0]);

      return String(
        (receiveLineRow as any).receive_job_line_id ?? receiveLineRow
      );
    }

    async function createRecountLine(): Promise<string> {
      const taskRow = await trx('inventory_recount_tasks')
        .insert({
          shop_id: shopId,
          warehouse_id: warehouseId,
          label: `RC-IUL-${crypto.randomUUID().slice(0, 8)}`,
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

      return String((lineRow as any).recount_line_id ?? lineRow);
    }

    return {
      shopId,
      variantId,
      receiveLineA: await createReceiveLine(),
      receiveLineB: await createReceiveLine(),
      recountLineA: await createRecountLine(),
      recountLineB: await createRecountLine(),
    };
  });
}

function insertUnit(
  fixture: Fixture,
  input: {
    receiveJobLineId?: string | null;
    recountLineId?: string | null;
    sequence: number;
    source: 'lasyncro_receive' | 'opening_inventory_reconcile';
    status?: 'received' | 'stowed';
    locationCode?: string | null;
  }
) {
  return withTenant(fixture.shopId, (trx) =>
    trx('inventory_units').insert({
      lasyncro_unit_id: `LSU-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      shop_id: fixture.shopId,
      lasyncro_variant_id: fixture.variantId,
      receive_job_line_id: input.receiveJobLineId ?? null,
      recount_line_id: input.recountLineId ?? null,
      receive_sequence: input.sequence,
      source: input.source,
      status: input.status ?? 'received',
      current_location_code: input.locationCode ?? null,
      received_at: new Date(),
    })
  );
}

describe('0189 inventory-unit source lineage', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture();
  });

  it('allows Receive and Reconcile units with independent per-anchor sequence namespaces', async () => {
    await insertUnit(fixture, {
      receiveJobLineId: fixture.receiveLineA,
      sequence: 1,
      source: 'lasyncro_receive',
    });

    await insertUnit(fixture, {
      receiveJobLineId: fixture.receiveLineB,
      sequence: 1,
      source: 'lasyncro_receive',
    });

    await insertUnit(fixture, {
      recountLineId: fixture.recountLineA,
      sequence: 1,
      source: 'opening_inventory_reconcile',
      status: 'stowed',
      locationCode: 'A-1',
    });

    await insertUnit(fixture, {
      recountLineId: fixture.recountLineB,
      sequence: 1,
      source: 'opening_inventory_reconcile',
      status: 'stowed',
      locationCode: 'A-1',
    });

    const reconcileUnit = await withTenant(fixture.shopId, (trx) =>
      trx('inventory_units')
        .where({
          shop_id: fixture.shopId,
          recount_line_id: fixture.recountLineA,
          receive_sequence: 1,
        })
        .first(
          'receive_job_line_id',
          'recount_line_id',
          'receive_sequence',
          'source',
          'status',
          'current_location_code',
          'received_at'
        )
    );

    expect(reconcileUnit).toBeTruthy();
    expect(reconcileUnit.receive_job_line_id).toBeNull();
    expect(reconcileUnit.recount_line_id).toBe(fixture.recountLineA);
    expect(reconcileUnit.receive_sequence).toBe(1);
    expect(reconcileUnit.source).toBe('opening_inventory_reconcile');
    expect(reconcileUnit.status).toBe('stowed');
    expect(reconcileUnit.current_location_code).toBe('A-1');
    expect(reconcileUnit.received_at).toBeTruthy();
  });

  it('rejects both source anchors and rejects neither source anchor', async () => {
    await expect(
      insertUnit(fixture, {
        receiveJobLineId: fixture.receiveLineA,
        recountLineId: fixture.recountLineA,
        sequence: 10,
        source: 'opening_inventory_reconcile',
        status: 'stowed',
        locationCode: 'A-1',
      })
    ).rejects.toThrow(/source_anchor_xor|check constraint/i);

    await expect(
      insertUnit(fixture, {
        sequence: 11,
        source: 'lasyncro_receive',
      })
    ).rejects.toThrow(/source_anchor_xor|check constraint/i);
  });

  it('rejects provenance/anchor contradictions', async () => {
    await expect(
      insertUnit(fixture, {
        recountLineId: fixture.recountLineA,
        sequence: 12,
        source: 'lasyncro_receive',
        status: 'stowed',
        locationCode: 'A-1',
      })
    ).rejects.toThrow(/reconcile_provenance|check constraint/i);

    await expect(
      insertUnit(fixture, {
        receiveJobLineId: fixture.receiveLineA,
        sequence: 13,
        source: 'opening_inventory_reconcile',
      })
    ).rejects.toThrow(/reconcile_provenance|check constraint/i);
  });

  it('enforces sequence uniqueness independently for Receive and Reconcile anchors', async () => {
    await insertUnit(fixture, {
      receiveJobLineId: fixture.receiveLineA,
      sequence: 20,
      source: 'lasyncro_receive',
    });

    await expect(
      insertUnit(fixture, {
        receiveJobLineId: fixture.receiveLineA,
        sequence: 20,
        source: 'lasyncro_receive',
      })
    ).rejects.toThrow(/inventory_units_receive_unique|unique constraint/i);

    await insertUnit(fixture, {
      recountLineId: fixture.recountLineA,
      sequence: 21,
      source: 'opening_inventory_reconcile',
      status: 'stowed',
      locationCode: 'A-1',
    });

    await expect(
      insertUnit(fixture, {
        recountLineId: fixture.recountLineA,
        sequence: 21,
        source: 'opening_inventory_reconcile',
        status: 'stowed',
        locationCode: 'A-1',
      })
    ).rejects.toThrow(/inventory_units_recount_unique|unique constraint/i);
  });

  it('rejects unknown Receive and Recount anchors through their foreign keys', async () => {
    await expect(
      insertUnit(fixture, {
        receiveJobLineId: crypto.randomUUID(),
        sequence: 30,
        source: 'lasyncro_receive',
      })
    ).rejects.toThrow(/foreign key constraint/i);

    await expect(
      insertUnit(fixture, {
        recountLineId: crypto.randomUUID(),
        sequence: 31,
        source: 'opening_inventory_reconcile',
        status: 'stowed',
        locationCode: 'A-1',
      })
    ).rejects.toThrow(/foreign key constraint/i);
  });
});
