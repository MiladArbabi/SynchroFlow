import { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';
import { writeAuditLog } from '../audit/operatorAudit.service.js';

/**
 * INVENTORY RECOUNT SERVICE (INV-PHYSICAL-COUNT-13 / INV-RECON-WRITER-14)
 * ------------------------------------------------------------------------
 * Records what an operator physically saw on a shelf, and turns approved
 * variances into ledger corrections.
 *
 * TWO INVARIANTS THIS FILE OWNS:
 *
 * 1. BLIND — expected_quantity is NEVER returned to an operator while
 *    task.blind is true. getOperatorLines() strips it. Enforced here rather
 *    than in the UI: a client that receives the value can leak it through
 *    behaviour (Receive auto-confirms at expected — that must not be copied).
 *
 * 2. DEFERRED CORRECTION (INV-PC-01) — recordCount() writes NO stock. Only
 *    commit() writes inventory_movements, and only for lines an owner has
 *    accepted. Same rule already governing pick, stow, and receive exceptions:
 *    the resolution action drives the movement, not the report.
 *
 * Idempotency mirrors stow.service.ts: movement ids are uuidv5-derived from the
 * recount line id, with onConflict(device_event_id).ignore(), so a retried
 * commit cannot double-correct.
 */
const RECOUNT_NAMESPACE = '7f3c9d21-5b84-4a17-9e62-8d0f1a4b6c35'; // fixed constant

export interface RecountLineInput {
  lasyncro_variant_id: string;
  location_code: string;
}

/**
 * Atomically increments recount_label_sequence. Mirrors the prob_label pattern
 * at wms.controller.ts:3950 — UPDATE ... RETURNING so concurrent creates cannot
 * collide on the shop_id+label unique constraint.
 */
async function nextRecountLabel(
  trx: Knex.Transaction,
  shopId: number
): Promise<string> {
  const result = await trx.raw(
    `UPDATE shop_wms_settings
     SET recount_label_sequence = recount_label_sequence + 1, updated_at = NOW()
     WHERE shop_id = ?
     RETURNING recount_label_sequence`,
    [shopId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(
      `[RECOUNT_CREATE] shop_wms_settings row missing for shop ${shopId} — cannot allocate label`
    );
  }
  return `CNT-${shopId}-${String(row.recount_label_sequence).padStart(4, '0')}`;
}

/**
 * Suggested scope: the reason counting drops from hours to minutes. Rather than
 * asking the operator to count everything, select only what the ledger has
 * reason to distrust:
 *   - unlocated sale debt at the warehouse root (INV-SALE-LOCATION-19)
 *   - negative on_hand (phantom stock, PROJ-004)
 *   - stock held with no movement in 60 days
 * Returns bin-grain rows; root rows are excluded because there is no shelf to
 * walk to.
 */
export async function selectSuggestedLines(
  trx: Knex.Transaction,
  shopId: number,
  warehouseId: string
): Promise<RecountLineInput[]> {
  const rows = await trx.raw(
    `WITH root AS (
      SELECT root_location_code FROM warehouses
      WHERE warehouse_id = ? AND shop_id = ?
    ),
      suspect AS (
      SELECT it.lasyncro_variant_id, it.location_code,
              wl.position_x, wl.position_y,
              lane.position_y AS lane_y, lane.position_x AS lane_x
      FROM inventory_truth it
      JOIN warehouse_locations wl
        ON wl.shop_id = it.shop_id
        AND wl.location_code = it.location_code
      LEFT JOIN warehouse_locations lane
        ON lane.shop_id = wl.shop_id
        AND lane.location_code = wl.parent_location_code
      WHERE it.shop_id = ?
        AND it.location_code <> (SELECT root_location_code FROM root)
        /**
          * RECOUNT-SELLABLE-30 — sellable stock only.
          * ------------------------------------------
          * Recount exists to prevent overselling and phantom stock. Both are
          * risks against SELLABLE inventory, so the axis is "can this be sold",
          * not "does stock rest here" (the -27 reasoning, superseded).
          *
          * pick    — where sellable stock lives.
          * storage — the column DEFAULT (migration 0108:105,
          *           floor-planning.controller.ts:653). A merchant who never
          *           opens the floor planner has EVERY bin defaulted to this,
          *           so excluding it would return an empty scope for exactly
          *           the user most likely to have phantom stock.
          *
          * Everything else is deliberately held out of the sellable path:
          * pack/ship/receive/kitting are mid-workflow; returns/problem/
          * quarantine are held back pending owner disposition. Counting them
          * cannot reduce overselling risk.
          *
          * No NULL branch needed — zone_type has a DB default, so a bin
          * cannot exist without one.
          *
          * scope='suggested' only. 'full' means full.
          */
        AND wl.zone_type IN ('pick', 'storage')
        AND (
          it.on_hand_quantity < 0
          OR it.lasyncro_variant_id IN (
            SELECT DISTINCT lasyncro_variant_id FROM inventory_movements
            WHERE shop_id = ? AND triggered_by = 'reconciliation_unlocated'
          )
          OR NOT EXISTS (
            SELECT 1 FROM inventory_movements m
            WHERE m.shop_id = it.shop_id
              AND m.lasyncro_variant_id = it.lasyncro_variant_id
              AND m.location_code = it.location_code
              AND m.occurred_at > NOW() - INTERVAL '60 days'
          )
        )
    )
    /**
      * RECOUNT-WALKORDER-27b: lane-grouped, not raw coordinates.
      * (position_x, position_y) returned A-1, B-1, C-1 — the front of every
      * lane, forcing the operator to traverse each lane once per column.
      * Grouping by the bin's parent lane first sweeps A fully, then B, then C,
      * and is layout-independent (works whether lanes run along x or y).
      */
    SELECT lasyncro_variant_id, location_code FROM suspect
    ORDER BY COALESCE(lane_y, 9999) ASC,
              COALESCE(lane_x, 9999) ASC,
              COALESCE(position_x, 9999) ASC,
              COALESCE(position_y, 9999) ASC,
              location_code ASC`,
    [warehouseId, shopId, shopId, shopId]
  );
  return rows.rows;
}

/**
 * RECOUNT-WAREHOUSE-31 — resolve the shop's default warehouse.
 * Mirrors floor-planning.controller.ts:687. Throws rather than picking one
 * arbitrarily: a recount against the wrong warehouse produces variance on
 * every line, so a loud failure is far cheaper than a silent mismatch.
 */
export async function resolveDefaultWarehouseId(
  trx: Knex.Transaction,
  shopId: number
): Promise<string> {
  const row = await trx('warehouses')
    .where({ shop_id: shopId, is_default: true, active: true })
    .select('warehouse_id')
    .first();

    if (!row?.warehouse_id) {
    /**
     * Message wording is load-bearing: recountErrorStatus() maps
     * `.includes('requires')` to 400. Without that token this returns 500 —
     * a client error reported as a server fault.
     */
    throw new Error(
      '[RECOUNT_CREATE] No default warehouse for this shop — this request requires an explicit warehouse_id'
    );
  }

  return row.warehouse_id;
}

export async function createRecountTask(
  trx: Knex.Transaction,
  params: {
    shopId: number;
    warehouseId?: string;
    scope: 'full' | 'location' | 'variant_set' | 'suggested';
    createdBy: number;
    assignedTo?: number | null;
    locationCode?: string;
    variantIds?: string[];
    blind?: boolean;
    notes?: string;
  }
): Promise<{ recount_task_id: string; label: string; line_count: number }> {
  const { shopId, scope, createdBy } = params;
  // RECOUNT-WAREHOUSE-31: resolve before anything else — a label allocated
  // against an unresolvable warehouse burns a sequence number for nothing.
  const warehouseId =
    params.warehouseId ?? (await resolveDefaultWarehouseId(trx, shopId));
  const label = await nextRecountLabel(trx, shopId);

  let lines: RecountLineInput[];
  if (scope === 'suggested') {
    lines = await selectSuggestedLines(trx, shopId, warehouseId);
  } else {
    const q = trx('inventory_truth').where({ shop_id: shopId });
    if (scope === 'location') {
      if (!params.locationCode) {
        throw new Error('[RECOUNT_CREATE] scope=location requires locationCode');
      }
      q.where({ location_code: params.locationCode });
    }
    if (scope === 'variant_set') {
      if (!params.variantIds?.length) {
        throw new Error('[RECOUNT_CREATE] scope=variant_set requires variantIds');
      }
      q.whereIn('lasyncro_variant_id', params.variantIds);
    }
    lines = await q.select('lasyncro_variant_id', 'location_code');
  }

  if (lines.length === 0) {
    throw new Error(
      `[RECOUNT_CREATE] No lines match scope=${scope} — refusing to create an empty task`
    );
  }

  const [task] = await trx('inventory_recount_tasks')
    .insert({
      shop_id: shopId,
      warehouse_id: warehouseId,
      label,
      scope,
      /**
       * Always 'dispatched'. Assignment is expressed by assigned_to, not by a
       * separate status: assigned_to set = only that operator may claim,
       * assigned_to null = first claim wins. One status, two dispatch modes.
       */
      status: 'dispatched',
      blind: params.blind ?? true,
      assigned_to: params.assignedTo ?? null,
      created_by: createdBy,
      notes: params.notes ?? null,
    })
    .returning(['recount_task_id']);

  /**
   * expected_quantity is snapshotted HERE and never re-read. A sale landing
   * mid-count would otherwise shift the variance, and the operator would be
   * blamed for the system's own movement.
   */
  const truth = await trx('inventory_truth')
    .where({ shop_id: shopId })
    .select('lasyncro_variant_id', 'location_code', 'on_hand_quantity');
  const truthMap = new Map(
    truth.map((t: any) => [`${t.lasyncro_variant_id}:${t.location_code}`, t.on_hand_quantity])
  );

  await trx('inventory_recount_lines').insert(
    lines.map((l) => ({
      recount_task_id: task.recount_task_id,
      shop_id: shopId,
      lasyncro_variant_id: l.lasyncro_variant_id,
      location_code: l.location_code,
      expected_quantity:
        truthMap.get(`${l.lasyncro_variant_id}:${l.location_code}`) ?? 0,
    }))
  );

  console.info('[RECOUNT_TASK_CREATED]', {
    shopId, label, scope, lineCount: lines.length, assignedTo: params.assignedTo ?? null,
  });
  return { recount_task_id: task.recount_task_id, label, line_count: lines.length };
}

/**
 * Claim ladder mirrors stow.service.ts:113-118 — every rejection is an explicit
 * throw, never a silent return. Re-claim by the SAME operator is idempotent;
 * claim by a different operator is an error.
 */
export async function claimRecountTask(
  trx: Knex.Transaction,
  shopId: number,
  recountTaskId: string,
  userId: number
): Promise<void> {
  const task = await trx('inventory_recount_tasks')
    .where({ shop_id: shopId, recount_task_id: recountTaskId })
    .select('status', 'claimed_by', 'assigned_to')
    .forUpdate()
    .first();

  if (!task) throw new Error(`[RECOUNT_CLAIM] Task not found: ${recountTaskId}`);
  if (task.claimed_by === userId && task.status === 'claimed') return;
  if (task.claimed_by !== null) throw new Error('[RECOUNT_CLAIM] Task already claimed');
  if (task.status !== 'dispatched') {
    throw new Error(`[RECOUNT_CLAIM] Task not claimable: ${task.status}`);
  }
  if (task.assigned_to !== null && task.assigned_to !== userId) {
    throw new Error('[RECOUNT_CLAIM] Task assigned to a different operator');
  }

  await trx('inventory_recount_tasks')
    .where({ shop_id: shopId, recount_task_id: recountTaskId })
    .update({ status: 'claimed', claimed_by: userId, claimed_at: trx.fn.now(), updated_at: trx.fn.now() });

  console.info('[RECOUNT_TASK_CLAIMED]', { recountTaskId, userId, shopId });
}

/**
 * BLIND ENFORCEMENT. expected_quantity is stripped before the payload leaves
 * the server. Do not add it back for "convenience" — see file header.
 */
export async function getOperatorLines(
  trx: Knex.Transaction,
  shopId: number,
  recountTaskId: string
): Promise<any[]> {
  const task = await trx('inventory_recount_tasks')
    .where({ shop_id: shopId, recount_task_id: recountTaskId })
    .select('blind')
    .first();
  if (!task) throw new Error(`[RECOUNT_LINES] Task not found: ${recountTaskId}`);

  const cols = ['recount_line_id', 'lasyncro_variant_id', 'location_code',
                'counted_quantity', 'count_method', 'scan_count', 'counted_at'];
  if (!task.blind) cols.push('expected_quantity');

    /**
   * RECOUNT-WALKORDER-27: the operator walks THIS order, so it matters more
   * than the scope query's. Same coordinate sort as the pick path
   * (wms.controller.ts:232) — one set of muscle memory across both workflows.
   * Lexicographic location_code put A-10 before A-2 once a lane exceeded
   * nine bins.
   */
  return trx('inventory_recount_lines as l')
      .leftJoin('warehouse_locations as wl', function () {
      this.on('wl.shop_id', '=', 'l.shop_id')
          .andOn('wl.location_code', '=', 'l.location_code');
    })
    .leftJoin('warehouse_locations as lane', function () {
      this.on('lane.shop_id', '=', 'wl.shop_id')
          .andOn('lane.location_code', '=', 'wl.parent_location_code');
    })
    .where({ 'l.shop_id': shopId, 'l.recount_task_id': recountTaskId })
    .select(cols.map((c) => `l.${c}`))
    .orderByRaw(`
      COALESCE(lane.position_y, 9999) ASC,
      COALESCE(lane.position_x, 9999) ASC,
      COALESCE(wl.position_x, 9999) ASC,
      COALESCE(wl.position_y, 9999) ASC,
      l.location_code ASC
    `);
}

/**
 * Records what the operator saw. WRITES NO STOCK — see invariant 2.
 * variance is stored rather than computed on read so a committed line keeps the
 * variance it was approved against.
 */
export async function recordCount(
  trx: Knex.Transaction,
  params: {
    shopId: number;
    recountTaskId: string;
    recountLineId: string;
    countedQuantity: number;
    countMethod: 'unit_scan' | 'bin_quantity';
    scanCount?: number;
    countedBy: number;
  }
): Promise<{ variance: number }> {
  const { shopId, recountTaskId, recountLineId, countedQuantity, countedBy } = params;
  if (!Number.isInteger(countedQuantity) || countedQuantity < 0) {
    throw new Error(`[RECOUNT_COUNT] Counted quantity must be a non-negative integer, got ${countedQuantity}`);
  }

  const task = await trx('inventory_recount_tasks')
    .where({ shop_id: shopId, recount_task_id: recountTaskId })
    .select('status', 'claimed_by')
    .first();
  if (!task) throw new Error(`[RECOUNT_COUNT] Task not found: ${recountTaskId}`);
  if (task.claimed_by !== countedBy) {
    throw new Error('[RECOUNT_COUNT] Task owned by a different operator');
  }
  if (!['claimed', 'counting'].includes(task.status)) {
    throw new Error(`[RECOUNT_COUNT] Task not countable in status: ${task.status}`);
  }

  const line = await trx('inventory_recount_lines')
    .where({ shop_id: shopId, recount_line_id: recountLineId, recount_task_id: recountTaskId })
    .select('expected_quantity')
    .first();
  if (!line) throw new Error(`[RECOUNT_COUNT] Line not found: ${recountLineId}`);

  const variance = countedQuantity - line.expected_quantity;

  await trx('inventory_recount_lines')
    .where({ shop_id: shopId, recount_line_id: recountLineId })
    .update({
      counted_quantity: countedQuantity,
      variance,
      count_method: params.countMethod,
      scan_count: params.scanCount ?? null,
      counted_by: countedBy,
      counted_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });

  if (task.status === 'claimed') {
    await trx('inventory_recount_tasks')
      .where({ shop_id: shopId, recount_task_id: recountTaskId })
      .update({ status: 'counting', updated_at: trx.fn.now() });
  }

  return { variance };
}

/**
 * Operator finishes counting. Still writes no stock.
 *
 * A task where every line counted exactly as expected commits immediately with
 * no owner step — forcing review on a clean count would make the tool feel like
 * bureaucracy, and there is nothing to decide. Any non-zero variance sends the
 * whole task to manual_review.
 *
 * NOTE: 'manual_review' here is recount_task_status, NOT the orders-domain
 * constraint_type of the same name. It must never feed queue_manual_review on
 * the orders operational snapshot.
 */
export async function closeCount(
  trx: Knex.Transaction,
  shopId: number,
  recountTaskId: string,
  userId: number
): Promise<{ status: 'committed' | 'manual_review'; uncounted: number; variances: number }> {
  const task = await trx('inventory_recount_tasks')
    .where({ shop_id: shopId, recount_task_id: recountTaskId })
    .select('status', 'claimed_by')
    .forUpdate()
    .first();
  if (!task) throw new Error(`[RECOUNT_CLOSE] Task not found: ${recountTaskId}`);
  if (task.claimed_by !== userId) {
    throw new Error('[RECOUNT_CLOSE] Task owned by a different operator');
  }
  if (task.status !== 'counting') {
    throw new Error(`[RECOUNT_CLOSE] Task not closable in status: ${task.status}`);
  }

  const lines = await trx('inventory_recount_lines')
    .where({ shop_id: shopId, recount_task_id: recountTaskId })
    .select('counted_quantity', 'variance');

  const uncounted = lines.filter((l: any) => l.counted_quantity === null).length;
  if (uncounted > 0) {
    throw new Error(
      `[RECOUNT_CLOSE] ${uncounted} line(s) not yet counted — count or cancel them before closing`
    );
  }
  const variances = lines.filter((l: any) => Number(l.variance) !== 0).length;
  const next = variances === 0 ? 'committed' : 'manual_review';

  await trx('inventory_recount_tasks')
    .where({ shop_id: shopId, recount_task_id: recountTaskId })
    .update({
      status: next,
      counted_at: trx.fn.now(),
      committed_at: next === 'committed' ? trx.fn.now() : null,
      updated_at: trx.fn.now(),
    });

  console.info('[RECOUNT_CLOSED]', { recountTaskId, shopId, userId, uncounted, variances, next });
  return { status: next, uncounted, variances };
}

/**
 * Owner decision on one variance line (INV-PC-01: the resolution action drives
 * the movement, not the report).
 *
 *   accept   — variance_reason recorded; corrected at commit()
 *   recount  — a fresh line is created for the same variant/location with
 *              recount_of_line_id set, and the task returns to counting. The
 *              original line is preserved: most first-count variances are
 *              miscounts, and overwriting would destroy that evidence.
 *   escalate — problem_center_tasks row with source 'count'; NOT corrected
 */
export async function reviewLine(
  trx: Knex.Transaction,
  params: {
    shopId: number;
    recountTaskId: string;
    recountLineId: string;
    decision: 'accept' | 'recount' | 'escalate';
    varianceReason?: 'unrecorded_external_workflow' | 'shrinkage' | 'damage'
                   | 'misplaced_stock' | 'count_error' | 'unknown';
    notes?: string;
    reviewedBy: number;
  }
): Promise<void> {
  const { shopId, recountTaskId, recountLineId, decision, reviewedBy } = params;

  const task = await trx('inventory_recount_tasks')
    .where({ shop_id: shopId, recount_task_id: recountTaskId })
    .select('status')
    .first();
  if (!task) throw new Error(`[RECOUNT_REVIEW] Task not found: ${recountTaskId}`);
  if (task.status !== 'manual_review') {
    throw new Error(`[RECOUNT_REVIEW] Task not in review, status: ${task.status}`);
  }

  const line = await trx('inventory_recount_lines')
    .where({ shop_id: shopId, recount_line_id: recountLineId, recount_task_id: recountTaskId })
    .select('lasyncro_variant_id', 'location_code', 'expected_quantity', 'counted_quantity', 'variance')
    .first();
  if (!line) throw new Error(`[RECOUNT_REVIEW] Line not found: ${recountLineId}`);

  if (decision === 'accept') {
    if (!params.varianceReason) {
      throw new Error('[RECOUNT_REVIEW] accept requires a varianceReason — an unexplained correction is not auditable');
    }
    await trx('inventory_recount_lines')
      .where({ shop_id: shopId, recount_line_id: recountLineId })
      .update({ variance_reason: params.varianceReason, notes: params.notes ?? null, updated_at: trx.fn.now() });
  }

  if (decision === 'recount') {
    await trx('inventory_recount_lines').insert({
      recount_task_id: recountTaskId,
      shop_id: shopId,
      lasyncro_variant_id: line.lasyncro_variant_id,
      location_code: line.location_code,
      expected_quantity: line.expected_quantity,
      recount_of_line_id: recountLineId,
    });
    await trx('inventory_recount_tasks')
      .where({ shop_id: shopId, recount_task_id: recountTaskId })
      .update({ status: 'counting', updated_at: trx.fn.now() });
  }

  if (decision === 'escalate') {
    const seq = await trx.raw(
      `UPDATE shop_wms_settings
       SET prob_label_sequence = prob_label_sequence + 1, updated_at = NOW()
       WHERE shop_id = ?
       RETURNING prob_label_sequence, problem_bin_location`,
      [shopId]
    );
    const seqRow = seq.rows[0];
    if (!seqRow?.problem_bin_location) throw new Error('PROBLEM_BIN_NOT_CONFIGURED');
    await trx('problem_center_tasks').insert({
      shop_id: shopId,
      status: 'open',
      source: 'count',
      source_exception_id: recountLineId,
      lasyncro_variant_id: line.lasyncro_variant_id,
      quantity: Math.abs(Number(line.variance)),
      problem_bin_location: seqRow.problem_bin_location,
      notes: `PROB-${shopId}-${String(seqRow.prob_label_sequence).padStart(4, '0')} recount variance at ${line.location_code}: expected ${line.expected_quantity}, counted ${line.counted_quantity}`,
    });
    await trx('inventory_recount_lines')
      .where({ shop_id: shopId, recount_line_id: recountLineId })
      .update({ variance_reason: 'unknown', updated_at: trx.fn.now() });
  }

  await trx('inventory_recount_tasks')
    .where({ shop_id: shopId, recount_task_id: recountTaskId })
    .update({ reviewed_by: reviewedBy, updated_at: trx.fn.now() });

  console.info('[RECOUNT_LINE_REVIEWED]', { recountTaskId, recountLineId, decision, reviewedBy, shopId });
}

/**
 * THE CORRECTION WRITER (INV-RECON-WRITER-14).
 *
 * Writes one reconciliation_correction per accepted non-zero variance, in a
 * single transaction. Movement ids are uuidv5-derived from the recount line id,
 * so a retried commit conflicts on device_event_id and does nothing rather than
 * double-correcting. Superseded lines (those with a newer recount) are skipped.
 *
 * inventory_truth is NOT written here: the movement is the truth, and
 * rebuildInventoryProjectionForVariants derives the projection from it
 * (INV-LEDGER-BYPASS-16 — every truth write needs a movement that reproduces it).
 */
export async function commitRecount(
  trx: Knex.Transaction,
  shopId: number,
  recountTaskId: string,
  userId: number
): Promise<{ corrections: number; units: number }> {
  const task = await trx('inventory_recount_tasks')
    .where({ shop_id: shopId, recount_task_id: recountTaskId })
    .select('status')
    .forUpdate()
    .first();
  if (!task) throw new Error(`[RECOUNT_COMMIT] Task not found: ${recountTaskId}`);
  if (task.status !== 'manual_review') {
    throw new Error(`[RECOUNT_COMMIT] Task not committable in status: ${task.status}`);
  }

  const superseded = await trx('inventory_recount_lines')
    .where({ shop_id: shopId, recount_task_id: recountTaskId })
    .whereNotNull('recount_of_line_id')
    .pluck('recount_of_line_id');

  const lines = await trx('inventory_recount_lines')
    .where({ shop_id: shopId, recount_task_id: recountTaskId })
    .whereNotNull('variance_reason')
    .whereNot('variance', 0)
    .whereNotNull('counted_quantity')
    .select('recount_line_id', 'lasyncro_variant_id', 'location_code', 'variance');

  const pending = lines.filter((l: any) => !superseded.includes(l.recount_line_id));
  const now = new Date();
  let units = 0;

  for (const line of pending) {
    const movementId = uuidv5(`${line.recount_line_id}:reconciliation_correction`, RECOUNT_NAMESPACE);
    await trx('inventory_movements')
      .insert({
        lasyncro_inventory_movement_id: movementId,
        device_event_id: uuidv5(`${line.recount_line_id}:device:correction`, RECOUNT_NAMESPACE),
        shop_id: shopId,
        lasyncro_variant_id: line.lasyncro_variant_id,
        movement_type: 'reconciliation_correction',
        quantity_delta: Number(line.variance),
        reference_type: 'recount_line',
        reference_id: line.recount_line_id,
        location_code: line.location_code,
        platform: 'wms',
        occurred_at: now,
        operator_id: userId,
        triggered_by: 'inventory_recount',
      })
      .onConflict(['device_event_id'])
      .ignore();

    await trx('inventory_recount_lines')
      .where({ shop_id: shopId, recount_line_id: line.recount_line_id })
      .update({ inventory_movement_id: movementId, updated_at: trx.fn.now() });

    units += Math.abs(Number(line.variance));
  }

  const { rebuildInventoryProjectionForVariants } = await import(
    '../inventory/rebuildInventoryProjection.js'
  );
  const variantIds = [...new Set(pending.map((l: any) => l.lasyncro_variant_id))];
  if (variantIds.length > 0) {
    await rebuildInventoryProjectionForVariants(shopId, variantIds as string[], trx, now);
  }

  await trx('inventory_recount_tasks')
    .where({ shop_id: shopId, recount_task_id: recountTaskId })
    .update({ status: 'committed', committed_at: trx.fn.now(), reviewed_by: userId, updated_at: trx.fn.now() });

  await writeAuditLog(trx, {
    shopId,
    operatorId: userId,
    actionType: 'recount_commit',
    entityType: 'recount_task',
    entityId: recountTaskId,
    metadata: { corrections: pending.length, units },
  });

  console.info('[RECOUNT_COMMITTED]', { recountTaskId, shopId, userId, corrections: pending.length, units });
  return { corrections: pending.length, units };
}

/**
 * RECOUNT-LIST-28 — task discovery.
 *
 * VISIBILITY: owner/admin see every task. An operator sees only what they can
 * act on: unassigned tasks (first claim wins), tasks assigned to them, and
 * tasks they already claimed. Surfacing another operator's assigned task would
 * advertise a claim that claimRecountTask() is guaranteed to reject
 * (assigned_to !== userId).
 *
 * VARIANCE COUNT IS PRIVILEGED. On a blind task, "3 variances" tells the
 * counting operator their numbers disagreed with the system — the expected
 * quantity leaked through an aggregate instead of a field. Owner/admin only.
 *
 * Terminal tasks (committed, cancelled) are excluded by default so the list
 * does not grow without bound; pass statuses explicitly to include them.
 */
const ACTIVE_RECOUNT_STATUSES = [
  'draft',
  'dispatched',
  'claimed',
  'counting',
  'manual_review',
] as const;

export async function listRecountTasks(
  trx: Knex.Transaction,
  params: {
    shopId: number;
    userId: number;
    privileged: boolean;
    statuses?: string[];
  }
): Promise<Array<Record<string, unknown>>> {
  const { shopId, userId, privileged } = params;
  const statuses = params.statuses?.length
    ? params.statuses
    : [...ACTIVE_RECOUNT_STATUSES];

  const q = trx('inventory_recount_tasks as t')
    .where({ 't.shop_id': shopId })
    .whereIn('t.status', statuses)
    .select(
      't.recount_task_id',
      't.label',
      't.status',
      't.scope',
      't.blind',
      't.assigned_to',
      't.claimed_by',
      't.created_at',
      't.claimed_at',
      trx.raw(
        `(SELECT COUNT(*)::int FROM inventory_recount_lines l
          WHERE l.shop_id = t.shop_id AND l.recount_task_id = t.recount_task_id
         ) AS line_count`
      ),
      trx.raw(
        `(SELECT COUNT(*)::int FROM inventory_recount_lines l
          WHERE l.shop_id = t.shop_id AND l.recount_task_id = t.recount_task_id
            AND l.counted_at IS NOT NULL
        ) AS counted_count`
      )
    )
    .orderBy('t.created_at', 'desc');

  if (privileged) {
    q.select(
      trx.raw(
        `(SELECT COUNT(*)::int FROM inventory_recount_lines l
          WHERE l.shop_id = t.shop_id AND l.recount_task_id = t.recount_task_id
            AND l.variance IS NOT NULL AND l.variance <> 0
        ) AS variance_count`
      )
    );
  } else {
    q.where(function () {
      this.where('t.claimed_by', userId).orWhere(function () {
        this.whereNull('t.claimed_by').andWhere(function () {
          this.whereNull('t.assigned_to').orWhere('t.assigned_to', userId);
        });
      });
    });
  }

  return q;
}