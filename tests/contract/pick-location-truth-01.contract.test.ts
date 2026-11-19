/**
 * SF-PICK-LOCATION-TRUTH-01 — Pick destination rule and server verification.
 * DB-free: the real service runs against a scripted query fake that answers
 * by table + filters. Real-Postgres proof lives in
 * tests/integration/wms/pick-location-truth-01.test.ts.
 */
// CI-CORRECTION-003 (F1) — keep this contract DB-free: the audit and alert
// services reach backend-core/db (via notificationDispatch), which refuses to
// load without PG env. Neither is asserted here.
jest.mock('../../apps/backend/src/services/audit/operatorAudit.service', () => ({ writeAuditLog: jest.fn() }));
jest.mock('../../apps/backend/src/services/wms/wmsAlerts.service', () => ({ fireStowTaskAlert: jest.fn() }));
import {
  PICK_DESTINATION_SQL,
  PickLocationMismatchError,
  PickLocationNotPickableError,
  PickLocationTargetNotFoundError,
  PickUnitIdentityError,
  BIN_ELIGIBLE_UNIT_SQL,
  ROOT_ELIGIBLE_UNIT_SQL,
  assertPickScanDestination,
  resolvePickUnits,
  settlePickedUnits,
  pickDestinationProblem,
  pickDestinationProblemMessage,
  verifyPickLocationScan,
} from '../../apps/backend/src/services/wms/pickLocationTruth.service';

const SHOP = 1;
const BATCH = 'b4ee6e63-0000-4000-8000-000000000001';

type Row = Record<string, unknown>;
interface World {
  batches: Row[];
  allocations: Row[];
  batchLines: Row[];
  locations: Row[];
}

const ROOT = { shop_id: SHOP, location_code: 'WH-1-ROOT', barcode: null, type: 'warehouse', zone_type: null, active: true };
const PICK_0A = { shop_id: SHOP, location_code: 'PICK-0A', barcode: 'BC-0A', type: 'bin', zone_type: 'pick', active: true };
const PICK_0B = { shop_id: SHOP, location_code: 'PICK-0B', barcode: null, type: 'bin', zone_type: 'pick', active: true };
const RECEIVE = { shop_id: SHOP, location_code: 'RCV-1', barcode: null, type: 'bin', zone_type: 'receive', active: true };
const INACTIVE = { shop_id: SHOP, location_code: 'PICK-OLD', barcode: null, type: 'bin', zone_type: 'pick', active: false };

/** Minimal knex-shaped fake: where({..}) filters, where(fn) supports location/barcode OR. */
function fakeTrx(world: World) {
  const tables: Record<string, Row[]> = {
    pick_batches: world.batches,
    pick_reservation_allocations: world.allocations,
    'order_line_items as oli': world.batchLines,
    warehouse_locations: world.locations,
  };
  const trx = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const builder: any = {
      join: () => builder,
      where(arg: any) {
        if (typeof arg === 'function') {
          const ors: [string, unknown][] = [];
          const qb: any = {
            where: (c: string, v: unknown) => { ors.push([c, v]); return qb; },
            orWhere: (c: string, v: unknown) => { ors.push([c, v]); return qb; },
          };
          arg(qb);
          rows = rows.filter((r) => ors.some(([c, v]) => r[c] === v));
        } else {
          rows = rows.filter((r) =>
            Object.entries(arg).every(([k, v]) => r[k.replace(/^\w+\./, '')] === v));
        }
        return builder;
      },
      first: async () => rows[0],
      limit: (n: number) => Promise.resolve(rows.slice(0, n)),
    };
    return builder;
  };
  return trx as any;
}

function world(overrides: Partial<World> = {}): World {
  return {
    batches: [{ shop_id: SHOP, pick_batch_id: BATCH }],
    allocations: [
      { shop_id: SHOP, pick_batch_id: BATCH, lasyncro_line_item_id: 'line-bin', allocation_id: 'alloc-bin', location_code: 'PICK-0A' },
      { shop_id: SHOP, pick_batch_id: BATCH, lasyncro_line_item_id: 'line-root', allocation_id: 'alloc-root', location_code: 'WH-1-ROOT' },
    ],
    batchLines: [],
    locations: [ROOT, PICK_0A, PICK_0B, RECEIVE, INACTIVE],
    ...overrides,
  };
}

const verify = (w: World, input: Partial<Parameters<typeof verifyPickLocationScan>[1]>) =>
  verifyPickLocationScan(fakeTrx(w), {
    shopId: SHOP,
    pickBatchId: BATCH,
    lasyncroLineItemId: 'line-bin',
    reservationAllocationId: 'alloc-bin',
    scannedValue: 'PICK-0A',
    ...input,
  });

describe('pickDestinationProblem — the one Pick destination rule', () => {
  it.each([
    ['active pick bin', PICK_0A, null],
    ['warehouse root', ROOT, 'structural_location'],
    ['receive bin', RECEIVE, 'not_a_pick_bin'],
    ['inactive pick bin', INACTIVE, 'inactive_location'],
    ['unknown code', undefined, 'unknown_location'],
  ])('%s → %s', (_label, loc, expected) => {
    expect(pickDestinationProblem(loc as any)).toBe(expected);
  });

  it('the SQL twin admits exactly active pick bins (no warehouse-root branch)', () => {
    expect(PICK_DESTINATION_SQL).toBe(`(wl.type = 'bin' AND wl.zone_type = 'pick' AND wl.active IS TRUE)`);
    expect(PICK_DESTINATION_SQL).not.toMatch(/warehouse/);
  });

  it('operator copy is short and names the correction', () => {
    expect(pickDestinationProblemMessage('WH-1-ROOT', 'structural_location'))
      .toBe('WH-1-ROOT is the warehouse, not a bin. Scan the product.');
    expect(pickDestinationProblemMessage('RCV-1', 'not_a_pick_bin'))
      .toBe('RCV-1 is not a pick bin. Stow this stock into a pick bin first.');
  });
});

describe('assertPickScanDestination — the /pick/scan gate', () => {
  it('accepts the warehouse root as a product-scan Pick destination (A18)', async () => {
    await expect(assertPickScanDestination(fakeTrx(world()), SHOP, 'WH-1-ROOT')).resolves.toBeUndefined();
  });

  it.each([
    ['receive bin', 'RCV-1', 'not_a_pick_bin'],
    ['inactive pick bin', 'PICK-OLD', 'inactive_location'],
    ['unknown code', 'NOPE-1', 'unknown_location'],
  ])('rejects a %s', async (_l, code, problem) => {
    await expect(assertPickScanDestination(fakeTrx(world()), SHOP, code))
      .rejects.toMatchObject({ code: 'PICK_LOCATION_NOT_PICKABLE', locationCode: code, problem });
  });

  it('accepts an active pick bin', async () => {
    await expect(assertPickScanDestination(fakeTrx(world()), SHOP, 'PICK-0A')).resolves.toBeUndefined();
  });
});

describe('verifyPickLocationScan — server-confirmed location scan', () => {
  it('accepts the allocation pick bin by code, barcode and LOC- label', async () => {
    await expect(verify(world(), { scannedValue: 'PICK-0A' })).resolves.toEqual({ location_code: 'PICK-0A' });
    await expect(verify(world(), { scannedValue: 'BC-0A' })).resolves.toEqual({ location_code: 'PICK-0A' });
    await expect(verify(world(), { scannedValue: 'LOC-PICK-0A' })).resolves.toEqual({ location_code: 'PICK-0A' });
  });

  it('rejects a different real bin with a mismatch naming the target', async () => {
    await expect(verify(world(), { scannedValue: 'PICK-0B' }))
      .rejects.toMatchObject({ code: 'PICK_LOCATION_MISMATCH', expectedLocationCode: 'PICK-0A' });
  });

  it('a root allocation has no location scan: verify refuses even the root label', async () => {
    const err = await verify(world(), {
      lasyncroLineItemId: 'line-root', reservationAllocationId: 'alloc-root', scannedValue: 'WH-1-ROOT',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PickLocationNotPickableError);
    expect(err.problem).toBe('structural_location');
  });

  it('a root allocation is never "corrected" to a nearby bin', async () => {
    const err = await verify(world(), {
      lasyncroLineItemId: 'line-root', reservationAllocationId: 'alloc-root', scannedValue: 'PICK-0A',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PickLocationNotPickableError);
  });

  it('the target is the persisted allocation, never the client-supplied location_code', async () => {
    const err = await verify(world(), {
      lasyncroLineItemId: 'line-root', reservationAllocationId: 'alloc-root',
      expectedLocationCode: 'PICK-0A', scannedValue: 'PICK-0A',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PickLocationNotPickableError);
  });

  it('an allocation-backed line without its allocation id, or another batch, is not found', async () => {
    await expect(verify(world(), { reservationAllocationId: undefined }))
      .rejects.toBeInstanceOf(PickLocationTargetNotFoundError);
    await expect(verify(world({ batches: [] }), {}))
      .rejects.toBeInstanceOf(PickLocationTargetNotFoundError);
  });

  it('a mismatch is a typed error (no write path exists in this service)', async () => {
    await expect(verify(world(), { scannedValue: 'NOPE' })).rejects.toBeInstanceOf(PickLocationMismatchError);
  });
});

describe('resolvePickUnits — unit identity at root and bins (owner decision B)', () => {
  type Unit = { lasyncro_unit_id: string; status: string; receive_job_line_id: string };
  /**
   * trx.raw answers with the locked eligible units; table reads answer the
   * scanned units' Receive lines and their open inbound Stow tasks.
   * CI-CORRECTION-003: `lateStowTasks` exist only for the unlocked safety
   * re-read (an inbound Stow task created after the lock). Writes are recorded
   * so a refusal can prove that nothing was written.
   */
  const trxWith = (eligible: Unit[], stowTasks: Record<string, unknown>[] = [], lateStowTasks: Record<string, unknown>[] = []) => {
    const raws: { sql: string; bindings: unknown[] }[] = [];
    const reads: { table: string; forUpdate: boolean }[] = [];
    const writes: { table: string; op: string }[] = [];
    const trx: any = (table: string) => {
      const read = { table, forUpdate: false };
      reads.push(read);
      const excluded: { column: string; values: unknown[] }[] = [];
      const rows = () => {
        const base = table === 'inventory_units' ? eligible.filter((u) => u.status === 'received')
          : read.forUpdate ? stowTasks : [...stowTasks, ...lateStowTasks];
        return (base as Record<string, unknown>[]).filter((r) => excluded.every((x) => !x.values.includes(r[x.column])));
      };
      const b: any = {
        where: () => b, whereIn: () => b, orderBy: () => b,
        // F1 — custody-era builder calls, same non-filtering pass-through shape…
        whereNull: () => b, whereNotNull: () => b,
        modify: (fn: (q: any) => void) => { fn(b); return b; },
        // …except whereNotIn, which really excludes (the locked Stow task ids).
        whereNotIn: (column: string, values: unknown[]) => { excluded.push({ column, values }); return b; },
        forUpdate: () => { read.forUpdate = true; return b; },
        select: async () => rows(),
        first: async () => rows()[0],
        update: async () => { writes.push({ table, op: 'update' }); return 0; },
        insert: async () => { writes.push({ table, op: 'insert' }); },
      };
      return b;
    };
    trx.raw = async (sql: string, bindings: unknown[]) => { raws.push({ sql, bindings }); return { rows: eligible }; };
    return { trx, raws, reads, writes };
  };
  const u = (id: string, status = 'stowed', line = 'line-1'): Unit => ({ lasyncro_unit_id: id, status, receive_job_line_id: line });
  const resolve = (eligible: Unit[], quantity: number, unitIds: string[], locationCode = 'PICK-0A') =>
    resolvePickUnits(trxWith(eligible).trx, { shopId: SHOP, locationCode, lasyncroVariantId: 'v-1', quantity, unitIds });
  const refusal = (p: Promise<unknown>) => p.catch((e) => e as PickUnitIdentityError);

  it('a bin locks its stowed units at that bin; the root locks closed-receive received units or units stowed at the root', async () => {
    const bin = trxWith([]);
    await resolvePickUnits(bin.trx, { shopId: SHOP, locationCode: 'PICK-0A', lasyncroVariantId: 'v-1', quantity: 1, unitIds: [] });
    expect(bin.raws[0].sql).toContain('FOR UPDATE OF iu');
    expect(bin.raws[0].sql).toContain(BIN_ELIGIBLE_UNIT_SQL);
    expect(bin.raws[0].bindings).toEqual([SHOP, 'v-1', 'PICK-0A']);
    expect(bin.reads).toEqual([]);

    const root = trxWith([]);
    await resolvePickUnits(root.trx, { shopId: SHOP, locationCode: 'WH-1-ROOT', lasyncroVariantId: 'v-1', quantity: 1, unitIds: [] });
    expect(root.raws[0].sql).toContain(ROOT_ELIGIBLE_UNIT_SQL);
    expect(ROOT_ELIGIBLE_UNIT_SQL).toMatch(/rj\.status = 'closed'/);
    expect(root.raws[0].bindings).toEqual([SHOP, 'v-1', 'WH-1-ROOT']);
  });

  it('no eligible labelled units: product-only picking, and any LSU sent is refused', async () => {
    await expect(resolve([], 2, [])).resolves.toMatchObject({ unitIds: [] });
    expect(await refusal(resolve([], 1, ['LSU-X']))).toMatchObject({ code: 'PICK_UNIT_IDENTITY_MISMATCH', unitsRequired: 0 });
  });

  // CI-CORRECTION-003 — replaces the pre-custody "exactly min(quantity, eligible)
  // scanned identities" rule with the ratified custody rule
  // (SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-001): one verified LSU scan, the rest
  // settled by count, never written as verified lineage.
  it('labelled units: one verified LSU scan; the rest are settled by quantity, never verified lineage', async () => {
    const shelf = [u('LSU-A'), u('LSU-B'), u('LSU-C')];
    // Scanned identities are kept exactly as scanned (never reordered or inferred).
    await expect(resolve(shelf, 2, ['LSU-C', 'LSU-A'])).resolves.toMatchObject({ unitIds: ['LSU-C', 'LSU-A'], settledUnits: [] });
    // At least one scan is still required while labelled units are eligible.
    expect(await refusal(resolve(shelf, 2, []))).toMatchObject({ code: 'PICK_UNIT_IDENTITY_REQUIRED', unitsRequired: 1 });

    const resolved = await resolve(shelf, 3, ['LSU-A']);
    expect(resolved.unitIds).toEqual(['LSU-A']);
    expect(resolved.settledUnits.map((x) => x.lasyncro_unit_id)).toEqual(['LSU-B', 'LSU-C']);
    expect(resolved.uncertainUnitIds).toEqual([]);

    // Drive the real settlement and record what it writes.
    const inserts: { table: string; rows: Record<string, unknown>[] }[] = [];
    const trx: any = (table: string) => {
      const b: any = {
        where: () => b, whereIn: () => b, whereNull: () => b,
        update: () => (table === 'inventory_units'
          ? { returning: async () => ['LSU-A', 'LSU-B', 'LSU-C'].map((id) => ({ lasyncro_unit_id: id })) }
          : Promise.resolve(0)),
        insert: async (rows: Record<string, unknown>[]) => { inserts.push({ table, rows }); },
      };
      return b;
    };
    await settlePickedUnits(trx, { shopId: SHOP, scanId: 'scan-1', resolved, at: new Date(0), operatorId: 7, pickBatchId: BATCH });
    const ids = (t: string) => inserts.filter((i) => i.table === t).flatMap((i) => i.rows.map((r) => r.lasyncro_unit_id));
    expect(ids('pick_scan_unit_lineage')).toEqual(['LSU-A']);
    expect(ids('pick_scan_unit_settlement')).toEqual(['LSU-B', 'LSU-C']);
    expect(ids('pick_scan_unit_lineage')).not.toEqual(expect.arrayContaining(['LSU-B']));
    expect(ids('pick_scan_unit_lineage')).not.toEqual(expect.arrayContaining(['LSU-C']));
  });

  it('a wrong, duplicate or surplus identity is refused — never substituted', async () => {
    const shelf = [u('LSU-A'), u('LSU-B')];
    expect(await refusal(resolve(shelf, 2, ['LSU-A', 'LSU-Z']))).toMatchObject({ code: 'PICK_UNIT_IDENTITY_MISMATCH' });
    expect(await refusal(resolve(shelf, 2, ['LSU-A', 'LSU-A']))).toMatchObject({ code: 'PICK_UNIT_IDENTITY_MISMATCH' });
    expect(await refusal(resolve(shelf, 1, ['LSU-A', 'LSU-B']))).toMatchObject({ code: 'PICK_UNIT_IDENTITY_MISMATCH' });
  });

  it('mixed stock: labelled units identified, the unlabelled remainder is product-only', async () => {
    await expect(resolve([u('LSU-A')], 3, ['LSU-A'])).resolves.toMatchObject({ unitIds: ['LSU-A'] });
    expect(await refusal(resolve([u('LSU-A')], 3, []))).toMatchObject({ code: 'PICK_UNIT_IDENTITY_REQUIRED', unitsRequired: 1 });
  });

  it('root: received units are grouped by Receive line and their open Stow tasks are locked before the units', async () => {
    const units = [u('LSU-A', 'received', 'line-1'), u('LSU-B', 'received', 'line-2'), u('LSU-S', 'stowed', 'line-3')];
    const task = { stow_task_id: 't-1', receive_job_line_id: 'line-1', quantity: '3', quantity_placed: '1', quantity_excepted: '0', status: 'in_progress' };
    const w = trxWith(units, [task]);
    const r = await resolvePickUnits(w.trx, {
      shopId: SHOP, locationCode: 'WH-1-ROOT', lasyncroVariantId: 'v-1', quantity: 3, unitIds: ['LSU-A', 'LSU-B', 'LSU-S'],
    });
    expect([...r.receivedByLine.entries()]).toEqual([['line-1', ['LSU-A']], ['line-2', ['LSU-B']]]);
    expect(r.stowTasks).toEqual([{ ...task, quantity: 3, quantity_placed: 1, quantity_excepted: 0 }]);
    // CI-CORRECTION-003 — the Stow-task lock still precedes the unit lock; the
    // custody code adds an unlocked safety re-read for tasks created after it.
    expect(w.reads).toEqual([
      { table: 'inventory_units', forUpdate: false },
      { table: 'stow_tasks', forUpdate: true },
      { table: 'stow_tasks', forUpdate: false },
    ]);
    expect(w.raws).toHaveLength(1); // the unit lock follows the Stow-task lock
    expect(w.writes).toEqual([]);
  });

  it('root: an inbound Stow task that appears after the lock refuses with UNIT_SET_CHANGED and writes nothing', async () => {
    const units = [u('LSU-A', 'received', 'line-1'), u('LSU-B', 'received', 'line-1')];
    const locked = { stow_task_id: 't-1', receive_job_line_id: 'line-1', quantity: '2', quantity_placed: '0', quantity_excepted: '0', status: 'pending' };
    const late = { stow_task_id: 't-2', receive_job_line_id: 'line-1', quantity: '1', quantity_placed: '0', quantity_excepted: '0', status: 'pending' };
    const w = trxWith(units, [locked], [late]);
    await expect(resolvePickUnits(w.trx, {
      shopId: SHOP, locationCode: 'WH-1-ROOT', lasyncroVariantId: 'v-1', quantity: 2, unitIds: ['LSU-A'],
    })).rejects.toThrow('[PICK_SCAN] UNIT_SET_CHANGED');
    expect(w.writes).toEqual([]);
    // Control: without the late task the same pick resolves (the locked task is excluded by id).
    const ok = trxWith(units, [locked]);
    await expect(resolvePickUnits(ok.trx, {
      shopId: SHOP, locationCode: 'WH-1-ROOT', lasyncroVariantId: 'v-1', quantity: 2, unitIds: ['LSU-A'],
    })).resolves.toMatchObject({ unitIds: ['LSU-A'] });
  });
});
