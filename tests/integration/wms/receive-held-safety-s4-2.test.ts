import crypto from 'crypto';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { evaluateReceiveJobBarcodeReadiness } from 'api-src/services/wms/receiveBarcodeReadiness.service';
import { confirmStow } from 'api-src/services/wms/stow.service';
import { computeCoverage } from 'api-src/services/wms/inventoryUnit.service';

/**
 * S8-C5 / S4-2 — safety gates for held Receive units (contract
 * SF-RECEIVE-S8C5-S4-CONTRACT-026, invariants I5 / I6, matrix R5 / R10).
 *
 * Held units (status held / discarded) are outside inventory_truth and are
 * never accepted stock. Nothing in production creates them yet (S4-3), so
 * every held unit here is a seeded fixture.
 *
 *   H1–H4  barcode readiness counts held units apart from accepted units,
 *          stays fail-closed for accepted stock (R5), and neither the
 *          no-accepted nor the external-barcode shortcut bypasses held identity.
 *   S1–S4  ordinary Stow never places a held unit — explicit scan, sibling
 *          sweep or FIFO; a malformed recovery Stow is refused at creation (0227)
 *          — and a refusal has no side effects (R10).
 *   S7     a valid, custody-backed recovery Stow still reaches confirmStow and is
 *          refused (recovery Stow not enabled until S4-5 I2), with no side effects.
 *   C1     label coverage is not inflated by held / discarded units.
 */

const BIN = 'A-1';

async function createFixtureShop(): Promise<number> {
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `s4-2-held-${crypto.randomUUID().slice(0, 8)}`);
    await setTenantContext(trx, id);
    return id;
  });
}

type LineSpec = {
  barcode?: string | null;
  quantityAccepted: number;
  quantityHeld: number;
};

type UnitSpec = {
  status: 'received' | 'stowed' | 'held' | 'discarded';
  labelled: boolean;
  receivedAt?: Date;
  locationCode?: string | null;
};

async function seedFixture(shopId: number, line: LineSpec, units: UnitSpec[]) {
  return withTenant(shopId, async (trx) => {
    const userRow = await trx('users')
      .insert({
        shop_id: shopId,
        email: `s4-2-held-${crypto.randomUUID().slice(0, 8)}@example.com`,
        password_hash: 'test-hash',
        role: 'operator',
      })
      .returning('id')
      .then((rows) => rows[0]);
    const claimedBy = Number((userRow as any).id ?? userRow);

    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    const warehouseId = crypto.randomUUID();
    const rootCode = `WH-${shopId}-ROOT`;

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'S4-2 held product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `S42-${variantId.slice(0, 8)}`,
      title: 'S4-2 held variant',
      unit_cost: '5.00',
      status: 'active',
      barcode: line.barcode ?? null,
    });
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'S4-2 warehouse',
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });
    await trx('warehouse_locations').insert([
      { shop_id: shopId, warehouse_id: warehouseId, location_code: rootCode, type: 'warehouse', parent_location_code: null, active: true, zone_type: null },
      { shop_id: shopId, warehouse_id: warehouseId, location_code: BIN, type: 'bin', parent_location_code: rootCode, active: true, zone_type: 'pick' },
    ]);

    const supplierRow = await trx('suppliers')
      .insert({ shop_id: shopId, name: 'S4-2 supplier', active: true })
      .returning('id')
      .then((rows) => rows[0]);
    const poRow = await trx('purchase_orders')
      .insert({ shop_id: shopId, supplier_id: Number((supplierRow as any).id ?? supplierRow), status: 'shipped' })
      .returning('id')
      .then((rows) => rows[0]);
    const poId = String((poRow as any).id ?? poRow);
    const expected = line.quantityAccepted + line.quantityHeld;
    const poLineRow = await trx('purchase_order_line_items')
      .insert({
        po_id: poId,
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        description: 'S4-2 held line',
        quantity_ordered: expected,
        quantity_received: 0,
      })
      .returning('id')
      .then((rows) => rows[0]);
    const jobRow = await trx('receive_jobs')
      .insert({ shop_id: shopId, po_id: poId, status: 'inspection', total_variants: 1, total_units: expected })
      .returning('receive_job_id')
      .then((rows) => rows[0]);
    const receiveJobId = String((jobRow as any).receive_job_id ?? jobRow);
    const lineRow = await trx('receive_job_lines')
      .insert({
        shop_id: shopId,
        receive_job_id: receiveJobId,
        po_line_item_id: (poLineRow as any).id ?? poLineRow,
        lasyncro_variant_id: variantId,
        quantity_expected: expected,
        quantity_accepted: line.quantityAccepted,
        quantity_held_recoverable: line.quantityHeld,
        inspection_complete: true,
      })
      .returning('receive_job_line_id')
      .then((rows) => rows[0]);
    const receiveJobLineId = String((lineRow as any).receive_job_line_id ?? lineRow);

    const unitIds: string[] = [];
    for (const [index, unit] of units.entries()) {
      const lasyncroUnitId = `LSU-${crypto.randomUUID().slice(0, 12)}`;
      await trx('inventory_units').insert({
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        receive_job_line_id: receiveJobLineId,
        receive_sequence: index + 1,
        status: unit.status,
        current_location_code: unit.locationCode ?? null,
        label_printed_at: unit.labelled ? new Date() : null,
        received_at: unit.receivedAt ?? new Date(),
        lasyncro_unit_id: lasyncroUnitId,
      });
      unitIds.push(lasyncroUnitId);
    }

    return { shopId, claimedBy, variantId, receiveJobId, receiveJobLineId, unitIds };
  });
}

type Fixture = Awaited<ReturnType<typeof seedFixture>>;

async function readiness(f: Fixture) {
  const r = await withTenant(f.shopId, (trx) => evaluateReceiveJobBarcodeReadiness(trx, f.shopId, f.receiveJobId));
  const [line] = r.lines;
  return {
    ready: line.ready,
    reason: line.reason,
    acceptedUnitCount: line.acceptedUnitCount,
    heldUnitCount: line.heldUnitCount,
    jobReady: r.ready,
  };
}

async function stowTask(
  f: Fixture,
  trigger: 'return_restock' | 'receive_recovery' | 'problem_center',
  quantity: number,
  sourceTaskId: string | null = null,
): Promise<string> {
  return withTenant(f.shopId, async (trx) => {
    const row = await trx('stow_tasks')
      .insert({
        shop_id: f.shopId,
        lasyncro_variant_id: f.variantId,
        quantity,
        location_code: BIN,
        status: 'in_progress',
        trigger,
        source_task_id: sourceTaskId,
        claimed_by: f.claimedBy,
        claimed_at: new Date(),
      })
      .returning('stow_task_id')
      .then((rows) => rows[0]);
    return String((row as any).stow_task_id ?? row);
  });
}

const PROBLEM_BIN = 'PROB-1';

/**
 * A problem bin that genuinely holds truth for the variant, plus a Problem
 * Center task sourcing from it — so a problem_center re-stow can really debit
 * PROBLEM_BIN. Without the S4-2 gate a held LSU placed there would ride that
 * debit into the sellable bin.
 */
async function seedProblemBin(f: Fixture, onHand: number): Promise<string> {
  return withTenant(f.shopId, async (trx) => {
    const warehouse = await trx('warehouses').where({ shop_id: f.shopId }).first('warehouse_id');
    await trx('warehouse_locations').insert({
      shop_id: f.shopId,
      warehouse_id: warehouse.warehouse_id,
      location_code: PROBLEM_BIN,
      type: 'bin',
      parent_location_code: `WH-${f.shopId}-ROOT`,
      active: true,
      zone_type: null,
    });
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('inventory_truth').insert({
      shop_id: f.shopId,
      lasyncro_variant_id: f.variantId,
      location_code: PROBLEM_BIN,
      on_hand_quantity: onHand,
      reserved_quantity: 0,
      committed_quantity: 0,
      available_quantity: onHand,
      last_evaluated_at: new Date(),
    });
    const row = await trx('problem_center_tasks')
      .insert({
        shop_id: f.shopId,
        status: 'open',
        source: 'stow',
        lasyncro_variant_id: f.variantId,
        quantity: 1,
        exception_type: 'product_defect',
        problem_bin_location: PROBLEM_BIN,
      })
      .returning('problem_task_id')
      .then((rows) => rows[0]);
    return String((row as any).problem_task_id ?? row);
  });
}

function confirm(f: Fixture, stowTaskId: string, quantityPlaced: number, lasyncroUnitId?: string) {
  return withTenant(f.shopId, async (trx) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    return confirmStow(trx, { stowTaskId, shopId: f.shopId, claimedBy: f.claimedBy, quantityPlaced, lasyncroUnitId });
  });
}

/** Everything a Stow confirmation could touch for this fixture. */
async function stowEffects(f: Fixture, stowTaskId: string) {
  return withTenant(f.shopId, async (trx) => ({
    movements: await trx('inventory_movements')
      .where({ shop_id: f.shopId, lasyncro_variant_id: f.variantId })
      .orderBy('location_code')
      .select('movement_type', 'quantity_delta', 'location_code'),
    truth: await trx('inventory_truth')
      .where({ shop_id: f.shopId, lasyncro_variant_id: f.variantId })
      .orderBy('location_code')
      .select('location_code', 'on_hand_quantity', 'available_quantity'),
    units: await trx('inventory_units')
      .where({ shop_id: f.shopId, lasyncro_variant_id: f.variantId })
      .orderBy('receive_sequence')
      .select('lasyncro_unit_id', 'status', 'current_location_code'),
    task: await trx('stow_tasks').where({ shop_id: f.shopId, stow_task_id: stowTaskId }).first('status', 'quantity_placed'),
  }));
}

describe('S4-2 — barcode readiness counts held units apart from accepted stock', () => {
  it('H1 — labelled held units beside fully labelled accepted units do not create an accepted-stock mismatch', async () => {
    const f = await seedFixture(await createFixtureShop(), { quantityAccepted: 2, quantityHeld: 1 }, [
      { status: 'received', labelled: true },
      { status: 'received', labelled: true },
      { status: 'held', labelled: true },
    ]);
    expect(await readiness(f)).toEqual({
      ready: true, reason: 'labels_acknowledged', acceptedUnitCount: 2, heldUnitCount: 1, jobReady: true,
    });
  });

  it('H2 — R5: accepted stock stays fail-closed; a held unit never fills an accepted-unit gap or label gap', async () => {
    const gap = await seedFixture(await createFixtureShop(), { quantityAccepted: 2, quantityHeld: 1 }, [
      { status: 'received', labelled: true },
      { status: 'held', labelled: true },
    ]);
    const unlabelled = await seedFixture(await createFixtureShop(), { quantityAccepted: 1, quantityHeld: 1 }, [
      { status: 'received', labelled: false },
      { status: 'held', labelled: true },
    ]);
    expect({ gap: await readiness(gap), unlabelled: await readiness(unlabelled) }).toEqual({
      gap: { ready: false, reason: 'unit_evidence_mismatch', acceptedUnitCount: 1, heldUnitCount: 1, jobReady: false },
      unlabelled: { ready: false, reason: 'labels_outstanding', acceptedUnitCount: 1, heldUnitCount: 1, jobReady: false },
    });
  });

  it('H3 — an external barcode cannot stand in for held-unit identity or held labels', async () => {
    const missing = await seedFixture(await createFixtureShop(), { barcode: '4006381333931', quantityAccepted: 1, quantityHeld: 1 }, [
      { status: 'received', labelled: false },
    ]);
    const unlabelled = await seedFixture(await createFixtureShop(), { barcode: '4006381333931', quantityAccepted: 1, quantityHeld: 1 }, [
      { status: 'received', labelled: false },
      { status: 'held', labelled: false },
    ]);
    const control = await seedFixture(await createFixtureShop(), { barcode: '4006381333931', quantityAccepted: 1, quantityHeld: 0 }, [
      { status: 'received', labelled: false },
    ]);
    expect({
      missing: await readiness(missing),
      unlabelled: await readiness(unlabelled),
      control: await readiness(control),
    }).toEqual({
      missing: { ready: false, reason: 'held_unit_evidence_mismatch', acceptedUnitCount: 1, heldUnitCount: 0, jobReady: false },
      unlabelled: { ready: false, reason: 'held_labels_outstanding', acceptedUnitCount: 1, heldUnitCount: 1, jobReady: false },
      control: { ready: true, reason: 'external_barcode', acceptedUnitCount: 1, heldUnitCount: 0, jobReady: true },
    });
  });

  it('H4 — with no accepted units, held identity is still required before the line is ready', async () => {
    const missing = await seedFixture(await createFixtureShop(), { quantityAccepted: 0, quantityHeld: 2 }, [
      { status: 'held', labelled: true },
    ]);
    const complete = await seedFixture(await createFixtureShop(), { quantityAccepted: 0, quantityHeld: 2 }, [
      { status: 'held', labelled: true },
      { status: 'discarded', labelled: true },
    ]);
    expect({ missing: await readiness(missing), complete: await readiness(complete) }).toEqual({
      missing: { ready: false, reason: 'held_unit_evidence_mismatch', acceptedUnitCount: 0, heldUnitCount: 1, jobReady: false },
      complete: { ready: true, reason: 'no_accepted_units', acceptedUnitCount: 0, heldUnitCount: 2, jobReady: true },
    });
  });
});

describe('S4-2 — R10: ordinary Stow never places a held unit', () => {
  it('S1 — an explicitly scanned held LSU is refused before any truth, ledger or unit write', async () => {
    const f = await seedFixture(await createFixtureShop(), { quantityAccepted: 1, quantityHeld: 1 }, [
      { status: 'received', labelled: true },
      { status: 'held', labelled: true },
    ]);
    const taskId = await stowTask(f, 'return_restock', 1);
    const before = await stowEffects(f, taskId);

    await expect(confirm(f, taskId, 1, f.unitIds[1])).rejects.toThrow('[STOW_CONFIRM] HELD_UNIT_NOT_STOWABLE');

    expect(await stowEffects(f, taskId)).toEqual(before);
  });

  it('S2 — the sibling sweep after an accepted LSU scan never selects a held unit from the same Receive line', async () => {
    const f = await seedFixture(await createFixtureShop(), { quantityAccepted: 2, quantityHeld: 1 }, [
      { status: 'received', labelled: true },
      { status: 'held', labelled: true },
      { status: 'received', labelled: true },
    ]);
    const taskId = await stowTask(f, 'return_restock', 2);

    await confirm(f, taskId, 2, f.unitIds[0]);

    const after = await stowEffects(f, taskId);
    expect(after.units).toEqual([
      { lasyncro_unit_id: f.unitIds[0], status: 'stowed', current_location_code: BIN },
      { lasyncro_unit_id: f.unitIds[1], status: 'held', current_location_code: null },
      { lasyncro_unit_id: f.unitIds[2], status: 'stowed', current_location_code: BIN },
    ]);
  });

  it('S3 — FIFO without a scan skips an older held unit and places the received one', async () => {
    const f = await seedFixture(await createFixtureShop(), { quantityAccepted: 1, quantityHeld: 1 }, [
      { status: 'held', labelled: true, receivedAt: new Date('2026-01-01T00:00:00Z') },
      { status: 'received', labelled: true, receivedAt: new Date('2026-02-01T00:00:00Z') },
    ]);
    const taskId = await stowTask(f, 'return_restock', 1);

    await confirm(f, taskId, 1);

    const after = await stowEffects(f, taskId);
    expect(after.units).toEqual([
      { lasyncro_unit_id: f.unitIds[0], status: 'held', current_location_code: null },
      { lasyncro_unit_id: f.unitIds[1], status: 'stowed', current_location_code: BIN },
    ]);
  });

  it('S4 — a malformed receive_recovery Stow is refused at creation with zero inventory, ledger or unit change', async () => {
    const f = await seedFixture(await createFixtureShop(), { quantityAccepted: 0, quantityHeld: 1 }, [
      { status: 'held', labelled: true },
    ]);
    const noTask = crypto.randomUUID();
    const snapshot = async () => ({
      effects: await stowEffects(f, noTask),
      recoveryTasks: await withTenant(f.shopId, (trx) =>
        trx('stow_tasks').where({ shop_id: f.shopId, trigger: 'receive_recovery' }).count('* as count').first()),
    });
    const before = await snapshot();
    expect(before.recoveryTasks).toEqual({ count: '0' });
    expect(before.effects.units).toEqual([{ lasyncro_unit_id: f.unitIds[0], status: 'held', current_location_code: null }]);

    // In progress, claimed and with no Receive source: never a valid recovery Stow.
    await expect(stowTask(f, 'receive_recovery', 1)).rejects.toThrow('RECEIVE_RECOVERY_STOW_SOURCE_INVALID');

    expect(await snapshot()).toEqual(before);
  });

  it('S7 — a valid, custody-backed recovery Stow is still refused by confirmStow with zero side effects', async () => {
    const f = await seedFixture(await createFixtureShop(), { quantityAccepted: 0, quantityHeld: 1 }, [
      { status: 'held', labelled: true },
    ]);
    const lsu = f.unitIds[0];
    const rollback = new Error('__s7_rollback__');

    // Custody, closure and the recovery Stow are never committed: no 0224/0226/0227
    // evidence outlives this case, so no migration suite's DOWN depends on it.
    await withTenant(f.shopId, async (trx) => {
      const warehouse = await trx('warehouses').where({ shop_id: f.shopId }).first('warehouse_id');
      await trx('warehouse_locations').insert({
        shop_id: f.shopId, warehouse_id: warehouse.warehouse_id, location_code: PROBLEM_BIN,
        type: 'bin', parent_location_code: `WH-${f.shopId}-ROOT`, active: true, zone_type: null,
      });
      const [task] = await trx('problem_center_tasks').insert({
        shop_id: f.shopId, status: 'open', source: 'receive', source_exception_id: crypto.randomUUID(),
        lasyncro_unit_id: lsu, lasyncro_variant_id: f.variantId, quantity: 1, exception_type: 'defect',
      }).returning('problem_task_id');
      const problemTaskId = task.problem_task_id as string;
      // The S4-4 placement write set, then the Receive closes.
      await trx('receive_held_custody_events').insert({
        shop_id: f.shopId, device_event_id: crypto.randomUUID(), lasyncro_unit_id: lsu,
        problem_task_id: problemTaskId, location_code: PROBLEM_BIN, placed_by: null,
      });
      await trx('inventory_units').where({ shop_id: f.shopId, lasyncro_unit_id: lsu })
        .update({ held_placed_at: new Date(), current_location_code: PROBLEM_BIN, updated_at: new Date() });
      await trx('problem_center_tasks').where({ shop_id: f.shopId, problem_task_id: problemTaskId })
        .update({ problem_bin_location: PROBLEM_BIN });
      await trx('receive_jobs').where({ shop_id: f.shopId, receive_job_id: f.receiveJobId })
        .update({ status: 'closed', closed_at: new Date() });

      // Born pending through the 0227 guard, then claimed: the shape confirmStow receives.
      const [stow] = await trx('stow_tasks').insert({
        shop_id: f.shopId, lasyncro_variant_id: f.variantId, quantity: 1, location_code: BIN,
        status: 'pending', trigger: 'receive_recovery', source_task_id: problemTaskId,
      }).returning('stow_task_id');
      const stowTaskId = stow.stow_task_id as string;
      await trx('stow_tasks').where({ shop_id: f.shopId, stow_task_id: stowTaskId })
        .update({ status: 'in_progress', claimed_by: f.claimedBy, claimed_at: new Date() });

      const effects = async () => ({
        movements: await trx('inventory_movements').where({ shop_id: f.shopId, lasyncro_variant_id: f.variantId })
          .orderBy('location_code').select('movement_type', 'quantity_delta', 'location_code'),
        truth: await trx('inventory_truth').where({ shop_id: f.shopId, lasyncro_variant_id: f.variantId })
          .orderBy('location_code').select('location_code', 'on_hand_quantity', 'available_quantity'),
        unit: await trx('inventory_units').where({ shop_id: f.shopId, lasyncro_unit_id: lsu })
          .first('status', 'current_location_code', trx.raw('held_placed_at IS NOT NULL AS placed')),
        stow: await trx('stow_tasks').where({ shop_id: f.shopId, stow_task_id: stowTaskId })
          .first('status', 'quantity_placed', 'location_code', 'completed_at'),
        task: await trx('problem_center_tasks').where({ shop_id: f.shopId, problem_task_id: problemTaskId })
          .first('status', 'problem_bin_location'),
        recoveryEvents: await trx('receive_held_recovery_events').where({ shop_id: f.shopId }).count('* as count').first(),
      });
      const before = await effects();
      expect(before).toEqual({
        movements: [],
        truth: [],
        unit: { status: 'held', current_location_code: PROBLEM_BIN, placed: true },
        stow: { status: 'in_progress', quantity_placed: 0, location_code: BIN, completed_at: null },
        task: { status: 'open', problem_bin_location: PROBLEM_BIN },
        recoveryEvents: { count: '0' },
      });

      const attempt = (lasyncroUnitId?: string) => trx.transaction(async (sp) => {
        await sp.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
        return confirmStow(sp, { stowTaskId, shopId: f.shopId, claimedBy: f.claimedBy, quantityPlaced: 1, lasyncroUnitId });
      });
      await expect(attempt(lsu)).rejects.toThrow('[STOW_CONFIRM] RECEIVE_RECOVERY_STOW_NOT_ENABLED');
      await expect(attempt()).rejects.toThrow('[STOW_CONFIRM] RECEIVE_RECOVERY_STOW_NOT_ENABLED');

      expect(await effects()).toEqual(before);
      throw rollback;
    }).catch((err) => { if (err !== rollback) throw err; });
  });

  it('S5 — an explicitly scanned discarded LSU is refused with no credit, debit or unit transition', async () => {
    const f = await seedFixture(await createFixtureShop(), { quantityAccepted: 1, quantityHeld: 1 }, [
      { status: 'received', labelled: true },
      { status: 'discarded', labelled: true },
    ]);
    const taskId = await stowTask(f, 'return_restock', 1);
    const before = await stowEffects(f, taskId);
    expect(before.units[1]).toEqual({ lasyncro_unit_id: f.unitIds[1], status: 'discarded', current_location_code: null });

    await expect(confirm(f, taskId, 1, f.unitIds[1])).rejects.toThrow('[STOW_CONFIRM] HELD_UNIT_NOT_STOWABLE');

    expect(await stowEffects(f, taskId)).toEqual(before);
  });

  it('S6 — a held LSU in a problem bin that holds truth cannot ride a problem_center re-stow debit into a sellable bin', async () => {
    const f = await seedFixture(await createFixtureShop(), { quantityAccepted: 1, quantityHeld: 1 }, [
      { status: 'stowed', labelled: true, locationCode: PROBLEM_BIN },
      { status: 'held', labelled: true, locationCode: PROBLEM_BIN },
    ]);
    const problemTaskId = await seedProblemBin(f, 2);
    const heldTaskId = await stowTask(f, 'problem_center', 1, problemTaskId);
    const controlTaskId = await stowTask(f, 'problem_center', 1, problemTaskId);

    // Adverse precondition: the debit source really has stock the held unit could consume.
    const before = await stowEffects(f, heldTaskId);
    expect(before.truth).toEqual([{ location_code: PROBLEM_BIN, on_hand_quantity: 2, available_quantity: 2 }]);
    expect(before.units[1]).toEqual({ lasyncro_unit_id: f.unitIds[1], status: 'held', current_location_code: PROBLEM_BIN });

    await expect(confirm(f, heldTaskId, 1, f.unitIds[1])).rejects.toThrow('[STOW_CONFIRM] HELD_UNIT_NOT_STOWABLE');
    expect(await stowEffects(f, heldTaskId)).toEqual(before);

    // Positive control on the same fixture: a non-held unit does take the debit
    // path, so the refusal above is the gate and not an unreachable fixture.
    await confirm(f, controlTaskId, 1, f.unitIds[0]);
    const control = await stowEffects(f, heldTaskId);
    expect({ truth: control.truth, units: control.units }).toEqual({
      truth: [
        { location_code: BIN, on_hand_quantity: 1, available_quantity: 1 },
        { location_code: PROBLEM_BIN, on_hand_quantity: 1, available_quantity: 1 },
      ],
      units: [
        { lasyncro_unit_id: f.unitIds[0], status: 'stowed', current_location_code: BIN },
        { lasyncro_unit_id: f.unitIds[1], status: 'held', current_location_code: PROBLEM_BIN },
      ],
    });
    expect(control.task).toEqual(before.task);
  });
});

describe('S4-2 — label coverage', () => {
  it('C1 — held and discarded units do not inflate coverage of truth-tracked stock', async () => {
    const shopId = await createFixtureShop();
    await seedFixture(shopId, { quantityAccepted: 2, quantityHeld: 2 }, [
      { status: 'stowed', labelled: true, locationCode: BIN },
      { status: 'stowed', labelled: true, locationCode: BIN },
      { status: 'held', labelled: true },
      { status: 'discarded', labelled: true },
    ]);
    await withTenant(shopId, async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      const variant = await trx('inventory_units').where({ shop_id: shopId }).first('lasyncro_variant_id');
      await trx('inventory_truth').insert({
        shop_id: shopId,
        lasyncro_variant_id: variant.lasyncro_variant_id,
        location_code: BIN,
        on_hand_quantity: 4,
        reserved_quantity: 0,
        committed_quantity: 0,
        available_quantity: 4,
        last_evaluated_at: new Date(),
      });
    });

    const coverage = await withTenant(shopId, (trx) => computeCoverage(trx, shopId));

    expect(coverage).toEqual({
      labelled_units: 2,
      total_active_units: 4,
      unlabelled_in_circulation: 2,
      coverage_pct: 50,
    });
  });
});
