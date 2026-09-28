import { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';
import { writeAuditLog } from '../audit/operatorAudit.service.js';
import { isActionAllowed } from '../permissions/permissionCache.service.js';
import { enqueueShopSnapshotJob } from '../shop-snapshot/enqueueShopSnapshotJob.js';
import { issueReconciledUnits } from './inventoryUnit.service.js';

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
/**
 * RECOUNT-CTA-33c: the suspect CTE, shared by the creation path and the
 * preview. Three criteria are OR-ed; a bin can match more than one.
 *   negative_on_hand  on_hand < 0            — a recorded contradiction
 *   unlocated_sale    sale with no pick      — stock left without a movement
 *   dormant           no movement in 60 days — nothing has confirmed it
 * reason ranks by severity (1 = worst) so a bin reports ONE answer to
 * "why should I walk there", not a list. Root location and non-sellable
 * zones are excluded per RECOUNT-SELLABLE-30.
 */
function suspectCte(shopId: number): string {
  return `WITH root AS (
      SELECT root_location_code FROM warehouses
      WHERE warehouse_id = ? AND shop_id = ?
    ),
      suspect AS (
      SELECT it.lasyncro_variant_id, it.location_code,
              it.on_hand_quantity,
              wl.position_x, wl.position_y,
              lane.position_y AS lane_y, lane.position_x AS lane_x,
              CASE
                WHEN it.on_hand_quantity < 0 THEN 'negative_on_hand'
                WHEN it.lasyncro_variant_id IN (
                  SELECT DISTINCT lasyncro_variant_id FROM inventory_movements
                  WHERE shop_id = ${shopId} AND triggered_by = 'reconciliation_unlocated'
                ) THEN 'unlocated_sale'
                ELSE 'dormant'
              END AS reason,
              CASE
                WHEN it.on_hand_quantity < 0 THEN 1
                WHEN it.lasyncro_variant_id IN (
                  SELECT DISTINCT lasyncro_variant_id FROM inventory_movements
                  WHERE shop_id = ${shopId} AND triggered_by = 'reconciliation_unlocated'
                ) THEN 2
                ELSE 3
              END AS reason_rank
      FROM inventory_truth it
      JOIN warehouse_locations wl
        ON wl.shop_id = it.shop_id
        AND wl.location_code = it.location_code
      LEFT JOIN warehouse_locations lane
        ON lane.shop_id = wl.shop_id
        AND lane.location_code = wl.parent_location_code
      WHERE it.shop_id = ?
        AND it.location_code <> (SELECT root_location_code FROM root)
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
    )`;
}

/**
 * Walk order: lane, then bin within lane (RECOUNT-WALKORDER-27b).
 */
const SUSPECT_WALK_ORDER = `ORDER BY COALESCE(lane_y, 9999) ASC,
              COALESCE(lane_x, 9999) ASC,
              COALESCE(position_x, 9999) ASC,
              COALESCE(position_y, 9999) ASC,
              location_code ASC`;

/**
 * Creation path. Returns one row PER LINE (variant x location).
 * Contract unchanged by RECOUNT-CTA-33c: still exactly
 * lasyncro_variant_id + location_code, same order. The consumer at the
 * inventory_recount_lines insert maps field-by-field, but this is the
 * write path that terminates in a reconciliation_correction — its output
 * is deliberately not widened.
 */
export async function selectSuggestedLines(
  trx: Knex.Transaction,
  shopId: number,
  warehouseId: string
): Promise<RecountLineInput[]> {
  const rows = await trx.raw(
    `${suspectCte(shopId)}
    SELECT lasyncro_variant_id, location_code FROM suspect
    ${SUSPECT_WALK_ORDER}`,
    [warehouseId, shopId, shopId, shopId]
  );
  return rows.rows;
}

export interface SuspectBinPreview {
  location_code: string;
  reason: 'negative_on_hand' | 'unlocated_sale' | 'dormant';
  variant_count: number;
  units: number;
  position_x: number | null;
  position_y: number | null;
}

/**
 * Preview path. Returns one row PER BIN, not per line — a bin holding four
 * suspect variants is one map marker and one report row, but four recount
 * lines. Read-only: creates nothing, writes nothing.
 * reason is the most severe matched (MIN of reason_rank).
 *
 * RECOUNT-PREVIEW-NOTENANT-123: callers must supply a tenant-framed
 * transaction. The query reads FORCE-RLS inventory/warehouse tables and must
 * never run against the shared Knex pool without SET LOCAL tenant context.
 */
export async function previewSuggestedBins(
  trx: Knex.Transaction,
  shopId: number,
  warehouseId: string
): Promise<SuspectBinPreview[]> {
  const rows = await trx.raw(
    `${suspectCte(shopId)}
    SELECT location_code,
           (ARRAY_AGG(reason ORDER BY reason_rank ASC))[1] AS reason,
           COUNT(*)::integer AS variant_count,
           COALESCE(SUM(on_hand_quantity), 0)::integer AS units,
           MIN(position_x) AS position_x,
           MIN(position_y) AS position_y,
           MIN(COALESCE(lane_y, 9999)) AS ord_lane_y,
           MIN(COALESCE(lane_x, 9999)) AS ord_lane_x,
           MIN(COALESCE(position_x, 9999)) AS ord_x,
           MIN(COALESCE(position_y, 9999)) AS ord_y
    FROM suspect
    GROUP BY location_code
    ORDER BY ord_lane_y ASC, ord_lane_x ASC, ord_x ASC, ord_y ASC, location_code ASC`,
    [warehouseId, shopId, shopId, shopId]
  );
  return rows.rows.map((r: any) => ({
    location_code: r.location_code,
    reason: r.reason,
    variant_count: Number(r.variant_count),
    units: Number(r.units),
    position_x: r.position_x === null ? null : Number(r.position_x),
    position_y: r.position_y === null ? null : Number(r.position_y),
  }));
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
    scope: 'full' | 'location' | 'locations' | 'variant_set' | 'suggested';
    createdBy: number;
    assignedTo?: number | null;
    locationCode?: string;
    locationCodes?: string[];
    variantIds?: string[];
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

    if (scope === 'locations') {
      if (!params.locationCodes?.length) {
        throw new Error(
          '[RECOUNT_CREATE] scope=locations requires locationCodes'
        );
      }

      const warehouseLocations = await trx('warehouse_locations')
        .where({
          shop_id: shopId,
          warehouse_id: warehouseId,
        })
        .whereIn('location_code', params.locationCodes)
        .pluck('location_code');

      if (warehouseLocations.length !== params.locationCodes.length) {
        throw new Error(
          '[RECOUNT_CREATE] scope=locations requires every locationCode to belong to the selected warehouse'
        );
      }

      q.whereIn('location_code', params.locationCodes);
    }

    if (scope === 'variant_set') {
      if (!params.variantIds?.length) {
        throw new Error('[RECOUNT_CREATE] scope=variant_set requires variantIds');
      }
      q.whereIn('lasyncro_variant_id', params.variantIds);
    }
    lines = await q.select('lasyncro_variant_id', 'location_code');

    if (scope === 'locations') {
      const resolvedCodes = new Set(lines.map((line) => line.location_code));
      const unresolvedCode = params.locationCodes?.find(
        (locationCode) => !resolvedCodes.has(locationCode)
      );

      if (unresolvedCode) {
        throw new Error(
          '[RECOUNT_CREATE] scope=locations requires inventory lines for every selected location'
        );
      }
    }
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
      // RECOUNT-BLIND-BYPASS-71: counting is structurally blind.
      blind: true,
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


export type OpeningInventoryProgressState =
  | 'not_started'
  | 'in_progress'
  | 'needs_review'
  | 'complete';

export interface OpeningInventoryBinProgress {
  recount_task_id: string;
  location_code: string;
  status: string;
  progress_state: OpeningInventoryProgressState;
  claimed_by: number | null;
}

export interface OpeningInventoryProgress {
  warehouse_id: string;
  total_bins: number;
  complete_bins: number;
  in_progress_bins: number;
  needs_review_bins: number;
  not_started_bins: number;
  remaining_bins: number;
  progress_pct: number;
  all_bins_settled: boolean;
  bins: OpeningInventoryBinProgress[];
}

function openingInventoryProgressState(
  status: string
): OpeningInventoryProgressState {
  if (status === 'committed') return 'complete';

  if (status === 'manual_review' || status === 'cancelled') {
    return 'needs_review';
  }

  if (status === 'claimed' || status === 'counting') {
    return 'in_progress';
  }

  return 'not_started';
}

export async function getOpeningInventoryProgress(
  trx: Knex.Transaction,
  shopId: number,
  warehouseId: string
): Promise<OpeningInventoryProgress> {
  const rows = await trx('inventory_recount_tasks')
    .where({
      shop_id: shopId,
      warehouse_id: warehouseId,
      purpose: 'opening_inventory',
    })
    .select(
      'recount_task_id',
      'scope_location_code',
      'status',
      'claimed_by'
    )
    .orderBy('scope_location_code', 'asc');

  const bins: OpeningInventoryBinProgress[] = rows.map((row: any) => ({
    recount_task_id: String(row.recount_task_id),
    location_code: String(row.scope_location_code),
    status: String(row.status),
    progress_state: openingInventoryProgressState(String(row.status)),
    claimed_by:
      row.claimed_by === null || row.claimed_by === undefined
        ? null
        : Number(row.claimed_by),
  }));

  const completeBins = bins.filter(
    (bin) => bin.progress_state === 'complete'
  ).length;

  const inProgressBins = bins.filter(
    (bin) => bin.progress_state === 'in_progress'
  ).length;

  const needsReviewBins = bins.filter(
    (bin) => bin.progress_state === 'needs_review'
  ).length;

  const notStartedBins = bins.filter(
    (bin) => bin.progress_state === 'not_started'
  ).length;

  const totalBins = bins.length;

  return {
    warehouse_id: warehouseId,
    total_bins: totalBins,
    complete_bins: completeBins,
    in_progress_bins: inProgressBins,
    needs_review_bins: needsReviewBins,
    not_started_bins: notStartedBins,
    remaining_bins: totalBins - completeBins,
    progress_pct:
      totalBins === 0
        ? 0
        : Math.floor((completeBins * 100) / totalBins),
    all_bins_settled: totalBins > 0 && completeBins === totalBins,
    bins,
  };
}


export type ShopOpeningInventoryState =
  | 'not_required'
  | 'not_started'
  | 'counting'
  | 'needs_bin_review'
  | 'ready_for_cutover'
  | 'review_required';

export interface ShopOpeningInventoryDifference {
  lasyncro_variant_id: string;
  expected_quantity: number;
  observed_quantity: number;
  delta: number;
}

export interface ShopOpeningInventoryBinProgress {
  recount_task_id: string;
  warehouse_id: string;
  location_code: string;
  status: string;
  progress_state: OpeningInventoryProgressState;
  claimed_by: number | null;
}

export interface ShopOpeningInventoryProgress {
  bootstrap_model:
    | 'legacy_opening_balance_v1'
    | 'reconcile_opening_expectation_v2';
  reconciliation_required: boolean;
  started_at: Date | null;
  state: ShopOpeningInventoryState;
  total_bins: number;
  complete_bins: number;
  in_progress_bins: number;
  needs_review_bins: number;
  not_started_bins: number;
  remaining_bins: number;
  progress_pct: number;
  all_bins_settled: boolean;
  difference_count: number;
  differences: ShopOpeningInventoryDifference[];
  bins: ShopOpeningInventoryBinProgress[];
}

/**
 * Shop-wide opening reconciliation authority.
 *
 * Important distinction:
 *
 *   all_bins_settled
 *     = every frozen physical observation task is committed
 *
 *   ready_for_cutover
 *     = every task is committed AND immutable Shopify expectation matches the
 *       immutable opening physical observation
 *
 * A mismatch never mutates physical truth here.
 */
export async function getShopOpeningInventoryProgress(
  dbOrTrx: Knex | Knex.Transaction,
  shopId: number
): Promise<ShopOpeningInventoryProgress> {
  const settings = await dbOrTrx('shop_wms_settings')
    .where({ shop_id: shopId })
    .select(
      'bootstrap_model',
      'opening_inventory_reconciliation_started_at'
    )
    .first();

  if (!settings) {
    throw new Error(
      `[OPENING_RECOUNT_SHOP_PROGRESS] shop_wms_settings missing for shop ${shopId}`
    );
  }

  const bootstrapModel = String(settings.bootstrap_model);

  if (
    bootstrapModel !== 'legacy_opening_balance_v1' &&
    bootstrapModel !== 'reconcile_opening_expectation_v2'
  ) {
    throw new Error(
      `[OPENING_RECOUNT_SHOP_PROGRESS] Unsupported bootstrap_model: ${JSON.stringify(
        settings.bootstrap_model
      )}`
    );
  }

  if (bootstrapModel === 'legacy_opening_balance_v1') {
    return {
      bootstrap_model: 'legacy_opening_balance_v1',
      reconciliation_required: false,
      started_at: null,
      state: 'not_required',
      total_bins: 0,
      complete_bins: 0,
      in_progress_bins: 0,
      needs_review_bins: 0,
      not_started_bins: 0,
      remaining_bins: 0,
      progress_pct: 100,
      all_bins_settled: true,
      difference_count: 0,
      differences: [],
      bins: [],
    };
  }

  const rows = await dbOrTrx('inventory_recount_tasks')
    .where({
      shop_id: shopId,
      purpose: 'opening_inventory',
    })
    .select(
      'recount_task_id',
      'warehouse_id',
      'scope_location_code',
      'status',
      'claimed_by'
    )
    .orderBy([
      { column: 'warehouse_id', order: 'asc' },
      { column: 'scope_location_code', order: 'asc' },
    ]);

  const bins: ShopOpeningInventoryBinProgress[] = rows.map(
    (row: any) => ({
      recount_task_id: String(row.recount_task_id),
      warehouse_id: String(row.warehouse_id),
      location_code: String(row.scope_location_code),
      status: String(row.status),
      progress_state: openingInventoryProgressState(
        String(row.status)
      ),
      claimed_by:
        row.claimed_by === null ||
        row.claimed_by === undefined
          ? null
          : Number(row.claimed_by),
    })
  );

  const totalBins = bins.length;

  const completeBins = bins.filter(
    (bin) => bin.progress_state === 'complete'
  ).length;

  const inProgressBins = bins.filter(
    (bin) => bin.progress_state === 'in_progress'
  ).length;

  const needsReviewBins = bins.filter(
    (bin) => bin.progress_state === 'needs_review'
  ).length;

  const notStartedBins = bins.filter(
    (bin) => bin.progress_state === 'not_started'
  ).length;

  const allBinsSettled =
    totalBins > 0 && completeBins === totalBins;

  let differences: ShopOpeningInventoryDifference[] = [];

  if (allBinsSettled) {
    const expectationRows = await dbOrTrx(
      'shopify_opening_inventory_expectations'
    )
      .where({ shop_id: shopId })
      .select(
        'lasyncro_variant_id',
        'expected_quantity'
      );

    const observedRows = await dbOrTrx(
      'inventory_movements'
    )
      .where({
        shop_id: shopId,
        movement_type: 'opening_inventory_reconcile',
      })
      .groupBy('lasyncro_variant_id')
      .select('lasyncro_variant_id')
      .sum<{ lasyncro_variant_id: string; observed_quantity: string }[]>(
        'quantity_delta as observed_quantity'
      );

    const expectedByVariant = new Map<string, number>(
      expectationRows.map((row: any) => [
        String(row.lasyncro_variant_id),
        Number(row.expected_quantity),
      ])
    );

    const observedByVariant = new Map<string, number>(
      observedRows.map((row: any) => [
        String(row.lasyncro_variant_id),
        Number(row.observed_quantity ?? 0),
      ])
    );

    const variantIds = Array.from(
      new Set([
        ...expectedByVariant.keys(),
        ...observedByVariant.keys(),
      ])
    ).sort();

    differences = variantIds
      .map((lasyncroVariantId) => {
        const expected =
          expectedByVariant.get(lasyncroVariantId) ?? 0;

        const observed =
          observedByVariant.get(lasyncroVariantId) ?? 0;

        return {
          lasyncro_variant_id: lasyncroVariantId,
          expected_quantity: expected,
          observed_quantity: observed,
          delta: observed - expected,
        };
      })
      .filter((row) => row.delta !== 0);
  }

  let state: ShopOpeningInventoryState;

  if (totalBins === 0) {
    state = 'not_started';
  } else if (needsReviewBins > 0) {
    state = 'needs_bin_review';
  } else if (!allBinsSettled) {
    state = 'counting';
  } else if (differences.length > 0) {
    state = 'review_required';
  } else {
    state = 'ready_for_cutover';
  }

  return {
    bootstrap_model: 'reconcile_opening_expectation_v2',
    reconciliation_required: true,
    started_at:
      settings.opening_inventory_reconciliation_started_at ??
      null,
    state,
    total_bins: totalBins,
    complete_bins: completeBins,
    in_progress_bins: inProgressBins,
    needs_review_bins: needsReviewBins,
    not_started_bins: notStartedBins,
    remaining_bins: totalBins - completeBins,
    progress_pct:
      totalBins === 0
        ? 0
        : Math.floor((completeBins * 100) / totalBins),
    all_bins_settled: allBinsSettled,
    difference_count: differences.length,
    differences,
    bins,
  };
}

/**
 * Freeze the initial physical reconciliation cohort across every active
 * warehouse in the shop.
 *
 * The first successful call snapshots all ACTIVE BIN locations. Later
 * warehouses/bins never change this initial denominator.
 */
export async function startShopOpeningInventoryReconciliation(
  trx: Knex.Transaction,
  params: {
    shopId: number;
    createdBy: number;
    assignedTo?: number | null;
  }
): Promise<ShopOpeningInventoryProgress> {
  const { shopId, createdBy } = params;

  const settings = await trx('shop_wms_settings')
    .where({ shop_id: shopId })
    .select(
      'bootstrap_model',
      'opening_inventory_reconciliation_started_at'
    )
    .forUpdate()
    .first();

  if (!settings) {
    throw new Error(
      `[OPENING_RECOUNT_SHOP_START] shop_wms_settings missing for shop ${shopId}`
    );
  }

  if (
    settings.bootstrap_model !==
    'reconcile_opening_expectation_v2'
  ) {
    throw new Error(
      `[OPENING_RECOUNT_SHOP_START] bootstrap_model must be reconcile_opening_expectation_v2, got ${JSON.stringify(
        settings.bootstrap_model
      )}`
    );
  }

  const existingTask = await trx(
    'inventory_recount_tasks'
  )
    .where({
      shop_id: shopId,
      purpose: 'opening_inventory',
    })
    .first('recount_task_id');

  if (existingTask) {
    if (
      !settings.opening_inventory_reconciliation_started_at
    ) {
      throw new Error(
        '[OPENING_RECOUNT_SHOP_START] Existing opening tasks have no shop-wide snapshot anchor'
      );
    }

    return getShopOpeningInventoryProgress(trx, shopId);
  }

  if (
    settings.opening_inventory_reconciliation_started_at
  ) {
    throw new Error(
      '[OPENING_RECOUNT_SHOP_START] Snapshot anchor exists but opening tasks are missing'
    );
  }

  const bins = await trx(
    'warehouse_locations as wl'
  )
    .join('warehouses as w', function () {
      this.on(
        'w.warehouse_id',
        '=',
        'wl.warehouse_id'
      ).andOn(
        'w.shop_id',
        '=',
        'wl.shop_id'
      );
    })
    .where({
      'wl.shop_id': shopId,
      'wl.type': 'bin',
      'wl.active': true,
      'w.active': true,
    })
    .select(
      'wl.warehouse_id',
      'wl.location_code'
    )
    .orderBy([
      { column: 'wl.warehouse_id', order: 'asc' },
      { column: 'wl.location_code', order: 'asc' },
    ]);

  if (bins.length === 0) {
    throw new Error(
      '[OPENING_RECOUNT_SHOP_START] Initial inventory reconciliation requires at least one active bin'
    );
  }

  const startedAt = new Date();

  for (const bin of bins) {
    const warehouseId = String(bin.warehouse_id);
    const locationCode = String(bin.location_code);
    const label = await nextRecountLabel(trx, shopId);

    await trx('inventory_recount_tasks').insert({
      shop_id: shopId,
      warehouse_id: warehouseId,
      label,
      scope: 'location',
      purpose: 'opening_inventory',
      scope_location_code: locationCode,
      status: 'dispatched',
      blind: true,
      assigned_to: params.assignedTo ?? null,
      created_by: createdBy,
      notes:
        `Initial inventory reconciliation: ${locationCode}`,
    });
  }

  await trx('shop_wms_settings')
    .where({ shop_id: shopId })
    .update({
      opening_inventory_reconciliation_started_at:
        startedAt,
      updated_at: trx.fn.now(),
    });

  console.info('[OPENING_RECOUNT_SHOP_STARTED]', {
    shopId,
    binCount: bins.length,
    createdBy,
  });

  return getShopOpeningInventoryProgress(trx, shopId);
}

export async function startOpeningInventoryReconciliation(
  trx: Knex.Transaction,
  params: {
    shopId: number;
    warehouseId?: string;
    createdBy: number;
    assignedTo?: number | null;
  }
): Promise<OpeningInventoryProgress> {
  const { shopId, createdBy } = params;

  const settings = await trx('shop_wms_settings')
    .where({ shop_id: shopId })
    .select(
      'bootstrap_model',
      'opening_inventory_reconciliation_started_at'
    )
    .forUpdate()
    .first();

  if (!settings) {
    throw new Error(
      `[OPENING_RECOUNT_START] shop_wms_settings missing for shop ${shopId}`
    );
  }

  if (settings.bootstrap_model !== 'reconcile_opening_expectation_v2') {
    throw new Error(
      `[OPENING_RECOUNT_START] bootstrap_model must be reconcile_opening_expectation_v2, got ${JSON.stringify(
        settings.bootstrap_model
      )}`
    );
  }

  const warehouseId =
    params.warehouseId ?? (await resolveDefaultWarehouseId(trx, shopId));

  const warehouse = await trx('warehouses')
    .where({
      shop_id: shopId,
      warehouse_id: warehouseId,
      active: true,
    })
    .select('warehouse_id')
    .first();

  if (!warehouse) {
    throw new Error(
      `[OPENING_RECOUNT_START] Warehouse not found or inactive: ${warehouseId}`
    );
  }

  const existingTask = await trx('inventory_recount_tasks')
    .where({
      shop_id: shopId,
      warehouse_id: warehouseId,
      purpose: 'opening_inventory',
    })
    .first('recount_task_id');

  if (existingTask) {
    return getOpeningInventoryProgress(trx, shopId, warehouseId);
  }

  /**
   * Once the shop-wide initial cohort is frozen, this legacy
   * warehouse-level entry point may read an existing warehouse task set
   * but must never add a newly-created warehouse/bin to that cohort.
   */
  if (
    settings.opening_inventory_reconciliation_started_at
  ) {
    throw new Error(
      '[OPENING_RECOUNT_START] Shop-wide opening reconciliation cohort already frozen'
    );
  }

  const bins = await trx('warehouse_locations')
    .where({
      shop_id: shopId,
      warehouse_id: warehouseId,
      type: 'bin',
      active: true,
    })
    .select('location_code')
    .orderBy('location_code', 'asc');

  if (bins.length === 0) {
    throw new Error(
      '[OPENING_RECOUNT_START] Initial inventory reconciliation requires at least one active bin'
    );
  }

  for (const bin of bins) {
    const locationCode = String(bin.location_code);
    const label = await nextRecountLabel(trx, shopId);

    await trx('inventory_recount_tasks').insert({
      shop_id: shopId,
      warehouse_id: warehouseId,
      label,
      scope: 'location',
      purpose: 'opening_inventory',
      scope_location_code: locationCode,
      status: 'dispatched',
      blind: true,
      assigned_to: params.assignedTo ?? null,
      created_by: createdBy,
      notes: `Initial inventory reconciliation: ${locationCode}`,
    });
  }

  console.info('[OPENING_RECOUNT_STARTED]', {
    shopId,
    warehouseId,
    binCount: bins.length,
    createdBy,
  });

  return getOpeningInventoryProgress(trx, shopId, warehouseId);
}

export async function addOpeningInventoryRecountLine(
  trx: Knex.Transaction,
  params: {
    shopId: number;
    recountTaskId: string;
    lasyncroVariantId: string;
    addedBy: number;
  }
): Promise<{
  recount_line_id: string;
  lasyncro_variant_id: string;
  location_code: string;
  expected_quantity: number;
}> {
  const {
    shopId,
    recountTaskId,
    lasyncroVariantId,
    addedBy,
  } = params;

  const task = await trx('inventory_recount_tasks')
    .where({
      shop_id: shopId,
      recount_task_id: recountTaskId,
    })
    .select(
      'purpose',
      'status',
      'claimed_by',
      'scope_location_code'
    )
    .forUpdate()
    .first();

  if (!task) {
    throw new Error(
      `[OPENING_RECOUNT_LINE] Task not found: ${recountTaskId}`
    );
  }

  if (task.purpose !== 'opening_inventory') {
    throw new Error(
      '[OPENING_RECOUNT_LINE] Task is not an opening_inventory task'
    );
  }

  if (!['claimed', 'counting'].includes(task.status)) {
    throw new Error(
      `[OPENING_RECOUNT_LINE] Task not countable in status: ${task.status}`
    );
  }

  if (task.claimed_by !== addedBy) {
    throw new Error(
      '[OPENING_RECOUNT_LINE] Task owned by a different operator'
    );
  }

  const locationCode = String(task.scope_location_code ?? '').trim();

  if (!locationCode) {
    throw new Error(
      '[OPENING_RECOUNT_LINE] Opening inventory task has no physical location anchor'
    );
  }

  const variant = await trx('variants')
    .where({
      shop_id: shopId,
      lasyncro_variant_id: lasyncroVariantId,
    })
    .select('lasyncro_variant_id')
    .first();

  if (!variant) {
    throw new Error(
      `[OPENING_RECOUNT_LINE] Variant not found: ${lasyncroVariantId}`
    );
  }

  const existing = await trx('inventory_recount_lines')
    .where({
      shop_id: shopId,
      recount_task_id: recountTaskId,
      lasyncro_variant_id: lasyncroVariantId,
      location_code: locationCode,
    })
    .whereNull('recount_of_line_id')
    .select(
      'recount_line_id',
      'lasyncro_variant_id',
      'location_code',
      'expected_quantity'
    )
    .first();

  if (existing) {
    return {
      recount_line_id: String(existing.recount_line_id),
      lasyncro_variant_id: String(existing.lasyncro_variant_id),
      location_code: String(existing.location_code),
      expected_quantity: Number(existing.expected_quantity),
    };
  }

  const [created] = await trx('inventory_recount_lines')
    .insert({
      recount_task_id: recountTaskId,
      shop_id: shopId,
      lasyncro_variant_id: lasyncroVariantId,
      location_code: locationCode,
      expected_quantity: 0,
    })
    .returning([
      'recount_line_id',
      'lasyncro_variant_id',
      'location_code',
      'expected_quantity',
    ]);

  console.info('[OPENING_RECOUNT_LINE_ADDED]', {
    shopId,
    recountTaskId,
    recountLineId: created.recount_line_id,
    lasyncroVariantId,
    locationCode,
    addedBy,
  });

  return {
    recount_line_id: String(created.recount_line_id),
    lasyncro_variant_id: String(created.lasyncro_variant_id),
    location_code: String(created.location_code),
    expected_quantity: Number(created.expected_quantity),
  };
}


export interface CompleteOpeningInventoryBinResult {
  status: 'committed' | 'manual_review';
  movements: number;
  units: number;
  unresolved: number;
  skipped: number;
  contested: number;
  findings: number;
  preexisting_canonical_signals: number;
}

/**
 * Canonical settlement boundary for one initial-inventory bin.
 *
 * The operator's count remains immutable observation evidence. A clean bin
 * establishes BOTH sides of physical truth atomically:
 *
 *   inventory_movements -> economic/location quantity
 *   inventory_units     -> exact LSU identities
 *
 * Shopify opening expectation is deliberately absent from this function.
 * Warehouse-wide expectation comparison happens only after the initial bin
 * snapshot has been fully worked.
 */
export async function completeOpeningInventoryBin(
  trx: Knex.Transaction,
  shopId: number,
  recountTaskId: string,
  userId: number
): Promise<CompleteOpeningInventoryBinResult> {
  const task = await trx('inventory_recount_tasks')
    .where({
      shop_id: shopId,
      recount_task_id: recountTaskId,
    })
    .select(
      'purpose',
      'status',
      'claimed_by',
      'scope_location_code'
    )
    .forUpdate()
    .first();

  if (!task) {
    throw new Error(
      `[OPENING_RECOUNT_COMPLETE] Task not found: ${recountTaskId}`
    );
  }

  if (task.purpose !== 'opening_inventory') {
    throw new Error(
      '[OPENING_RECOUNT_COMPLETE] Task is not an opening_inventory task'
    );
  }

  if (task.claimed_by !== userId) {
    throw new Error(
      '[OPENING_RECOUNT_COMPLETE] Task owned by a different operator'
    );
  }

  const allLines = await trx('inventory_recount_lines')
    .where({
      shop_id: shopId,
      recount_task_id: recountTaskId,
    })
    .select(
      'recount_line_id',
      'recount_of_line_id',
      'lasyncro_variant_id',
      'location_code',
      'counted_quantity',
      'skip_reason',
      'window_delta'
    );

  const allLineIds = allLines.map((line: any) =>
    String(line.recount_line_id)
  );

  if (task.status === 'committed') {
    let movements = 0;
    let units = 0;

    if (allLineIds.length > 0) {
      const movementCount = await trx('inventory_movements')
        .where({
          shop_id: shopId,
          movement_type: 'opening_inventory_reconcile',
          reference_type: 'recount_line',
        })
        .whereIn('reference_id', allLineIds)
        .count<{ count: string }>('* as count')
        .first();

      const unitCount = await trx('inventory_units')
        .where({ shop_id: shopId })
        .whereIn('recount_line_id', allLineIds)
        .count<{ count: string }>('* as count')
        .first();

      movements = Number(movementCount?.count ?? 0);
      units = Number(unitCount?.count ?? 0);
    }

    return {
      status: 'committed',
      movements,
      units,
      unresolved: 0,
      skipped: 0,
      contested: 0,
      findings: 0,
      preexisting_canonical_signals: 0,
    };
  }

  if (!['claimed', 'counting'].includes(task.status)) {
    throw new Error(
      `[OPENING_RECOUNT_COMPLETE] Task not completable in status: ${task.status}`
    );
  }

  const locationCode = String(task.scope_location_code ?? '').trim();

  if (!locationCode) {
    throw new Error(
      '[OPENING_RECOUNT_COMPLETE] Opening inventory task has no physical location anchor'
    );
  }

  const supersededIds = new Set(
    allLines
      .filter((line: any) => line.recount_of_line_id !== null)
      .map((line: any) => String(line.recount_of_line_id))
  );

  const activeLines = allLines.filter(
    (line: any) => !supersededIds.has(String(line.recount_line_id))
  );

  for (const line of activeLines) {
    if (String(line.location_code) !== locationCode) {
      throw new Error(
        `[OPENING_RECOUNT_COMPLETE] Recount line ${line.recount_line_id} is anchored to ${line.location_code}, not task bin ${locationCode}`
      );
    }
  }

  const unresolved = activeLines.filter(
    (line: any) =>
      line.counted_quantity === null &&
      line.skip_reason === null
  ).length;

  if (unresolved > 0) {
    throw new Error(
      `[OPENING_RECOUNT_COMPLETE] ${unresolved} line(s) not yet resolved`
    );
  }

  const skipped = activeLines.filter(
    (line: any) => line.skip_reason !== null
  ).length;

  const contested = activeLines.filter(
    (line: any) =>
      line.window_delta !== null &&
      Number(line.window_delta) !== 0
  ).length;

  const findingCount = await trx('inventory_recount_findings')
    .where({
      shop_id: shopId,
      recount_task_id: recountTaskId,
    })
    .count<{ count: string }>('* as count')
    .first();

  const findings = Number(findingCount?.count ?? 0);

  const activeVariantIds = [
    ...new Set(
      activeLines.map((line: any) =>
        String(line.lasyncro_variant_id)
      )
    ),
  ];

  let preexistingCanonicalSignals = 0;

  if (activeVariantIds.length > 0) {
    const existingTruth = await trx('inventory_truth')
      .where({
        shop_id: shopId,
        location_code: locationCode,
      })
      .whereIn('lasyncro_variant_id', activeVariantIds)
      .whereNot('on_hand_quantity', 0)
      .select('lasyncro_variant_id');

    const existingUnitCount = await trx('inventory_units')
      .where({
        shop_id: shopId,
        current_location_code: locationCode,
      })
      .whereIn('lasyncro_variant_id', activeVariantIds)
      .count<{ count: string }>('* as count')
      .first();

    preexistingCanonicalSignals =
      existingTruth.length +
      Number(existingUnitCount?.count ?? 0);
  }

  if (
    skipped > 0 ||
    contested > 0 ||
    findings > 0 ||
    preexistingCanonicalSignals > 0
  ) {
    await trx('inventory_recount_tasks')
      .where({
        shop_id: shopId,
        recount_task_id: recountTaskId,
      })
      .update({
        status: 'manual_review',
        counted_at: trx.fn.now(),
        committed_at: null,
        updated_at: trx.fn.now(),
      });

    console.info('[OPENING_RECOUNT_REVIEW_REQUIRED]', {
      shopId,
      recountTaskId,
      locationCode,
      skipped,
      contested,
      findings,
      preexistingCanonicalSignals,
    });

    return {
      status: 'manual_review',
      movements: 0,
      units: 0,
      unresolved: 0,
      skipped,
      contested,
      findings,
      preexisting_canonical_signals: preexistingCanonicalSignals,
    };
  }

  const settledAt = new Date();
  const affectedVariantIds = new Set<string>();

  let movements = 0;
  let units = 0;

  for (const line of activeLines) {
    const quantity = Number(line.counted_quantity ?? 0);

    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      throw new Error(
        `[OPENING_RECOUNT_COMPLETE] Invalid counted quantity on line ${line.recount_line_id}: ${line.counted_quantity}`
      );
    }

    if (quantity === 0) {
      continue;
    }

    const recountLineId = String(line.recount_line_id);
    const lasyncroVariantId = String(line.lasyncro_variant_id);

    const movementId = uuidv5(
      `${recountLineId}:opening_inventory_reconcile`,
      RECOUNT_NAMESPACE
    );

    const deviceEventId = uuidv5(
      `${recountLineId}:device:opening_inventory_reconcile`,
      RECOUNT_NAMESPACE
    );

    await trx('inventory_movements')
      .insert({
        lasyncro_inventory_movement_id: movementId,
        device_event_id: deviceEventId,
        shop_id: shopId,
        lasyncro_variant_id: lasyncroVariantId,
        movement_type: 'opening_inventory_reconcile',
        quantity_delta: quantity,
        reference_type: 'recount_line',
        reference_id: recountLineId,
        location_code: locationCode,
        platform: 'wms',
        occurred_at: settledAt,
        operator_id: userId,
        triggered_by: 'inventory_recount',
      })
      .onConflict(['device_event_id'])
      .ignore();

    await trx('inventory_recount_lines')
      .where({
        shop_id: shopId,
        recount_line_id: recountLineId,
      })
      .update({
        inventory_movement_id: movementId,
        updated_at: trx.fn.now(),
      });

    const issued = await issueReconciledUnits(trx, {
      shopId,
      recountLineId,
      lasyncroVariantId,
      quantity,
      currentLocationCode: locationCode,
      canonicalizedAt: settledAt,
    });

    affectedVariantIds.add(lasyncroVariantId);
    movements += 1;
    units += issued.length;
  }

  if (affectedVariantIds.size > 0) {
    const { rebuildInventoryProjectionForVariants } = await import(
      '../inventory/rebuildInventoryProjection.js'
    );

    await rebuildInventoryProjectionForVariants(
      shopId,
      [...affectedVariantIds],
      trx,
      settledAt
    );
  }

  await enqueueShopSnapshotJob(trx, shopId);

  await trx('inventory_recount_tasks')
    .where({
      shop_id: shopId,
      recount_task_id: recountTaskId,
    })
    .update({
      status: 'committed',
      counted_at: settledAt,
      committed_at: settledAt,
      updated_at: settledAt,
    });

  await writeAuditLog(trx, {
    shopId,
    operatorId: userId,
    actionType: 'recount_commit',
    entityType: 'recount_task',
    entityId: recountTaskId,
    metadata: {
      purpose: 'opening_inventory',
      locationCode,
      movements,
      units,
    },
  });

  console.info('[OPENING_RECOUNT_BIN_COMMITTED]', {
    shopId,
    recountTaskId,
    locationCode,
    movements,
    units,
  });

  return {
    status: 'committed',
    movements,
    units,
    unresolved: 0,
    skipped: 0,
    contested: 0,
    findings: 0,
    preexisting_canonical_signals: 0,
  };
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
    .update({
      status: 'claimed',
      claimed_by: userId,
      claimed_at: trx.fn.now(),
      // RECOUNT-CLAIM-ABANDONED-131: a fresh, opaque generation id per claim —
      // see migration 0163. Isolates browser-local provisional state so a
      // future reassignment's new claimant never inherits stale local scans.
      claim_generation: trx.raw('gen_random_uuid()'),
      updated_at: trx.fn.now(),
    });

  console.info('[RECOUNT_TASK_CLAIMED]', { recountTaskId, userId, shopId });
}

export interface ReassignRecountTaskResult {
  recount_task_id: string;
  status: string;
  previous_claimed_by: number | null;
  new_claimed_by: number;
  previous_claim_generation: string | null;
  new_claim_generation: string;
  claimed_at: Date;
}

/**
 * RECOUNT-CLAIM-ABANDONED-131: explicit owner/admin recovery for an abandoned
 * active claim (claimed/counting only — see the status guard below).
 *
 * This is deliberately ONE atomic ownership transfer, not a release-then-claim
 * two-step: a two-step version would create a window where the task is
 * unclaimed and any operator could grab it before the intended target does.
 *
 * Caller authorization (only an owner/admin may call this at all) is enforced
 * by the wms:recount:reassign route permission, not here — this function's
 * own job is validating the TARGET, which route-level requireAction cannot
 * express (it only ever checks the requesting user).
 */
export async function reassignRecountTask(
  trx: Knex.Transaction,
  shopId: number,
  recountTaskId: string,
  actingUserId: number,
  targetUserId: number
): Promise<ReassignRecountTaskResult> {
  // Same row-lock boundary as claim/count/skip/close/finding — see
  // recordCount's comment for why: without this lock, a concurrent count
  // could read the pre-reassignment claimed_by and commit after this
  // transaction, violating "once reassignment commits, no later write by the
  // old claimant can commit."
  const task = await trx('inventory_recount_tasks')
    .where({ shop_id: shopId, recount_task_id: recountTaskId })
    .select('status', 'claimed_by', 'claim_generation')
    .forUpdate()
    .first();

  if (!task) throw new Error(`[RECOUNT_REASSIGN] Task not found: ${recountTaskId}`);
  if (!['claimed', 'counting'].includes(task.status)) {
    throw new Error(`[RECOUNT_REASSIGN] Task not reassignable in status: ${task.status}`);
  }

  // Target must be an active member of THIS shop — same predicate already
  // used by GET /operators/team and every other active-membership check in
  // this codebase (shop_memberships.revoked_at IS NULL). Deliberately not a
  // new activity flag.
  const membership = await trx('shop_memberships')
    .where({ shop_id: shopId, user_id: targetUserId })
    .whereNull('revoked_at')
    .select('role')
    .first();

  if (!membership) {
    throw new Error('[RECOUNT_REASSIGN] Target is not an active member of this shop');
  }

  // Target must actually be permitted to count — reuses the same
  // shop-configurable permission check requireAction uses for the requesting
  // user (isActionAllowed), applied here to the TARGET's role instead. No
  // parallel permission model.
  const targetCanCount = await isActionAllowed(shopId, 'wms:recount:count', membership.role);
  if (!targetCanCount) {
    throw new Error('[RECOUNT_REASSIGN] Target does not have recount counting permission');
  }

  const [updated] = await trx('inventory_recount_tasks')
    .where({ shop_id: shopId, recount_task_id: recountTaskId })
    .update({
      claimed_by: targetUserId,
      assigned_to: targetUserId,
      claimed_at: trx.fn.now(),
      claim_generation: trx.raw('gen_random_uuid()'),
      updated_at: trx.fn.now(),
      // status, lines, findings intentionally untouched — see file header
      // guard above and requirement 6.
    })
    .returning(['status', 'claimed_at', 'claim_generation']);

  await writeAuditLog(trx, {
    shopId,
    operatorId: actingUserId,
    actionType: 'recount_reassign',
    entityType: 'recount_task',
    entityId: recountTaskId,
    metadata: {
      previous_claimant: task.claimed_by,
      new_claimant: targetUserId,
      previous_claim_generation: task.claim_generation,
      new_claim_generation: updated.claim_generation,
    },
  });

  console.info('[RECOUNT_TASK_REASSIGNED]', {
    recountTaskId, shopId, actingUserId,
    previousClaimant: task.claimed_by, newClaimant: targetUserId,
  });

  return {
    recount_task_id: recountTaskId,
    status: updated.status,
    previous_claimed_by: task.claimed_by,
    new_claimed_by: targetUserId,
    previous_claim_generation: task.claim_generation,
    new_claim_generation: updated.claim_generation,
    claimed_at: updated.claimed_at,
  };
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
    .select('recount_task_id')
    .first();
  if (!task) throw new Error(`[RECOUNT_LINES] Task not found: ${recountTaskId}`);

  // RECOUNT-COUNTZERO-34: skip fields are safe on a blind task — they carry
  // no information about expected_quantity.
  const cols = ['recount_line_id', 'lasyncro_variant_id', 'location_code',
                'counted_quantity', 'count_method', 'scan_count', 'counted_at',
                'skip_reason', 'skipped_at'];
  // RECOUNT-BLIND-BYPASS-71: never expose system quantity during operator counting.

    /**
   * RECOUNT-WALKORDER-27: the operator walks THIS order, so it matters more
   * than the scope query's. Same coordinate sort as the pick path
   * (wms.controller.ts:232) — one set of muscle memory across both workflows.
   * Lexicographic location_code put A-10 before A-2 once a lane exceeded
   * nine bins.
   */
  return trx('inventory_recount_lines as l')
    .leftJoin('variants as v', 'v.lasyncro_variant_id', 'l.lasyncro_variant_id')
    .leftJoin('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
    .leftJoin('warehouse_locations as wl', function () {
      this.on('wl.shop_id', '=', 'l.shop_id')
        .andOn('wl.location_code', '=', 'l.location_code');
    })
    .leftJoin('warehouse_locations as lane', function () {
      this.on('lane.shop_id', '=', 'wl.shop_id')
        .andOn('lane.location_code', '=', 'wl.parent_location_code');
    })
    .where({ 'l.shop_id': shopId, 'l.recount_task_id': recountTaskId })
    .select(
      ...cols.map((c) => `l.${c}`),
      'v.title as variant_title',
      'v.sku',
      'v.image_url',
      'p.title as product_title',
    )
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
): Promise<{ variance: number; windowDelta: number; contested: boolean }> {
  const { shopId, recountTaskId, recountLineId, countedQuantity, countedBy } = params;
  if (!Number.isInteger(countedQuantity) || countedQuantity < 0) {
    throw new Error(`[RECOUNT_COUNT] Counted quantity must be a non-negative integer, got ${countedQuantity}`);
  }

  // RECOUNT-CLAIM-ABANDONED-131: locked so a concurrent reassignment cannot
  // commit claimed_by=B between this read and this transaction's commit —
  // same row-lock boundary claimRecountTask already uses.
  const task = await trx('inventory_recount_tasks')
    .where({ shop_id: shopId, recount_task_id: recountTaskId })
    .select('status', 'claimed_by')
    .forUpdate()
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
    .select(
      'expected_quantity',
      'lasyncro_variant_id',
      'location_code',
      'window_from',
      'created_at',
      'counted_at',
      'skip_reason'
    )
    .forUpdate()
    .first();
  if (!line) throw new Error(`[RECOUNT_COUNT] Line not found: ${recountLineId}`);

  // RECOUNT-RECOUNT-OVERWRITE-74: normal counting is write-once.
  // Corrections must use an explicit recount/review path, never overwrite history.
  if (line.counted_at || line.skip_reason) {
    throw new Error('[RECOUNT_COUNT] Line already resolved');
  }

  /**
   * RECOUNT-FRESH-37: expected_quantity was snapshotted at task creation and
   * is never re-read. Anything that moved this bin since then — a pick, a
   * sale, a stow — would otherwise surface as variance and be written to the
   * ledger by commitRecount as shrinkage, debiting units a second time.
   *
   * window_from falls back to created_at for lines predating 0159. It is a
   * separate column because reviewLine('recount') opens the replacement
   * line's window at the ORIGINAL line's creation, not the replacement's.
   *
   * quantity_delta is PRE-SIGNED at the ledger layer
   * (rebuildInventoryProjection.ts:113), so a plain SUM is correct — no CASE
   * on movement_type.
   */
  const windowFrom: Date = line.window_from ?? line.created_at;
  const windowRow = await trx('inventory_movements')
    .where({
      shop_id: shopId,
      lasyncro_variant_id: line.lasyncro_variant_id,
      location_code: line.location_code,
    })
    .where('occurred_at', '>=', windowFrom)
    .sum({ delta: 'quantity_delta' })
    .first();
  const windowDelta = Number(windowRow?.delta ?? 0);

  const expectedAtCount = Number(line.expected_quantity) + windowDelta;
  const variance = countedQuantity - expectedAtCount;

  await trx('inventory_recount_lines')
    .where({ shop_id: shopId, recount_line_id: recountLineId })
    .update({
      counted_quantity: countedQuantity,
      variance,
      // RECOUNT-FRESH-37: frozen at count time, not recomputed on read. A value
      // that shifts on every page load cannot be the basis for authorising a
      // ledger write. 0 means "checked, nothing moved"; NULL means never checked.
      window_delta: windowDelta,
      window_from: windowFrom,
      window_computed_at: trx.fn.now(),
      count_method: params.countMethod,
      scan_count: params.scanCount ?? null,
      counted_by: countedBy,
      counted_at: trx.fn.now(),
      // RECOUNT-COUNTZERO-34: counting a previously-skipped line clears the skip.
      // Left set, it would force manual_review forever on a line that was resolved.
      skip_reason: null,
      skipped_by: null,
      skipped_at: null,
      updated_at: trx.fn.now(),
    });

  if (task.status === 'claimed') {
    await trx('inventory_recount_tasks')
      .where({ shop_id: shopId, recount_task_id: recountTaskId })
      .update({ status: 'counting', updated_at: trx.fn.now() });
  }

  /**
   * RECOUNT-FRESH-37: a non-zero window means the bin moved under the
   * operator. The count is not wrong, but it is not unambiguous either —
   * closeCount routes any contested line to manual_review.
   *
   * RECOUNT-BLIND-39: the caller must not put variance on the operator
   * response. expected = counted - variance is one subtraction, and blind
   * counting is server-enforced everywhere else on this surface.
   */
  return { variance, windowDelta, contested: windowDelta !== 0 };
}

/**
 * RECOUNT-COUNTZERO-34: record that a line could not be counted.
 * Deliberately never writes counted_quantity or variance — commitRecount
 * filters on counted_quantity NOT NULL, so a skipped line can never become
 * a reconciliation_correction.
 */
export async function skipLine(
  trx: Knex.Transaction,
  params: {
    shopId: number;
    recountTaskId: string;
    recountLineId: string;
    skipReason: 'bin_inaccessible' | 'stock_in_motion' | 'bin_not_found' | 'other';
    notes?: string;
    skippedBy: number;
  }
): Promise<void> {
  const { shopId, recountTaskId, recountLineId, skipReason, skippedBy } = params;

  if (skipReason === 'other' && !params.notes?.trim()) {
    throw new Error('[RECOUNT_SKIP] skip_reason "other" requires notes — an unexplained skip is not actionable');
  }

  // RECOUNT-CLAIM-ABANDONED-131: same row-lock boundary as claim/count/close.
  const task = await trx('inventory_recount_tasks')
    .where({ shop_id: shopId, recount_task_id: recountTaskId })
    .select('status', 'claimed_by')
    .forUpdate()
    .first();
  if (!task) throw new Error(`[RECOUNT_SKIP] Task not found: ${recountTaskId}`);
  if (task.claimed_by !== skippedBy) {
    throw new Error('[RECOUNT_SKIP] Task owned by a different operator');
  }
  if (!['claimed', 'counting'].includes(task.status)) {
    throw new Error(`[RECOUNT_SKIP] Task not countable in status: ${task.status}`);
  }

  const line = await trx('inventory_recount_lines')
    .where({ shop_id: shopId, recount_line_id: recountLineId, recount_task_id: recountTaskId })
    .select('recount_line_id', 'counted_at', 'skip_reason')
    .forUpdate()
    .first();
  if (!line) throw new Error(`[RECOUNT_SKIP] Line not found: ${recountLineId}`);

  // RECOUNT-RECOUNT-OVERWRITE-74: resolution is write-once.
  if (line.counted_at || line.skip_reason) {
    throw new Error('[RECOUNT_SKIP] Line already resolved');
  }

  await trx('inventory_recount_lines')
    .where({ shop_id: shopId, recount_line_id: recountLineId })
    .update({
      skip_reason: skipReason,
      skipped_by: skippedBy,
      skipped_at: trx.fn.now(),
      notes: params.notes ?? null,
      updated_at: trx.fn.now(),
    });

  if (task.status === 'claimed') {
    await trx('inventory_recount_tasks')
      .where({ shop_id: shopId, recount_task_id: recountTaskId })
      .update({ status: 'counting', updated_at: trx.fn.now() });
  }
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
): Promise<{ status: 'committed' | 'manual_review'; unresolved: number; skipped: number; variances: number; contested: number }> {
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
    .select('counted_quantity', 'variance', 'skip_reason', 'window_delta');

  // RECOUNT-COUNTZERO-34: a line is resolved by a count OR an explicit skip.
  const unresolved = lines.filter(
    (l: any) => l.counted_quantity === null && l.skip_reason === null
  ).length;
  if (unresolved > 0) {
    throw new Error(
      `[RECOUNT_CLOSE] ${unresolved} line(s) not yet resolved — count or skip them before closing`
    );
  }
  const skipped = lines.filter((l: any) => l.skip_reason !== null).length;
  const variances = lines.filter((l: any) => Number(l.variance) !== 0).length;
  /**
   * RECOUNT-FRESH-37: a line whose bin moved during the count window is
   * contested — the variance nets out arithmetically, but nothing proves the
   * movement and the count did not overlap on the same physical units. The
   * owner sees it before it reaches the ledger.
   *
   * NULL window_delta is NOT contested: it means counted before 0159, or
   * skipped. Only a computed non-zero value counts.
   */
  const contested = lines.filter(
    (l: any) => l.window_delta !== null && Number(l.window_delta) !== 0
  ).length;
  // WHY: any skip means the sweep was incomplete. The owner must see the
  // obstruction before this becomes a correction, even if every counted line matched.
  const next =
    variances === 0 && skipped === 0 && contested === 0 ? 'committed' : 'manual_review';

  await trx('inventory_recount_tasks')
    .where({ shop_id: shopId, recount_task_id: recountTaskId })
    .update({
      status: next,
      counted_at: trx.fn.now(),
      committed_at: next === 'committed' ? trx.fn.now() : null,
      updated_at: trx.fn.now(),
    });

  console.info('[RECOUNT_CLOSED]', { recountTaskId, shopId, userId, unresolved, skipped, variances, contested, next });
  return { status: next, unresolved, skipped, variances, contested };
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
    // RECOUNT-FRESH-37: window_from/created_at feed the replacement line's
    // window origin in the 'recount' branch below. Omitting them makes that
    // insert write NULL and silently reopens the count window.
    .select('lasyncro_variant_id', 'location_code', 'expected_quantity', 'counted_quantity', 'variance', 'window_from', 'created_at')
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
    /**
     * RECOUNT-FRESH-37: expected_quantity is copied from the original line, so
     * the replacement's window must open where that snapshot was taken — not
     * at the replacement's own created_at. Otherwise every movement between
     * the original count and the owner's review falls outside the window and
     * silently becomes shrinkage on the recount.
     */
    await trx('inventory_recount_lines').insert({
      recount_task_id: recountTaskId,
      shop_id: shopId,
      lasyncro_variant_id: line.lasyncro_variant_id,
      location_code: line.location_code,
      expected_quantity: line.expected_quantity,
      window_from: line.window_from ?? line.created_at,
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
      exception_type: 'recount_variance',
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
    // RECOUNT-EXCEPTIONS-80: escalation transfers correction ownership to
    // Problem Center. Never also write a recount reconciliation correction.
    .whereNotExists(function () {
      this.select(trx.raw('1'))
        .from('problem_center_tasks as pct')
        .whereRaw('pct.shop_id = inventory_recount_lines.shop_id')
        .whereRaw('pct.source_exception_id = inventory_recount_lines.recount_line_id')
        .where('pct.source', 'count');
    })
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
  await enqueueShopSnapshotJob(trx, shopId);

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
      // RECOUNT-CLAIM-ABANDONED-131: exposed so the frontend can scope
      // browser-local provisional state to this specific claim instance.
      't.claim_generation',
      // #1164: lets the counting session branch on opening_inventory and
      // anchor a zero-line task to its frozen bin. Carries no quantity.
      't.purpose',
      't.scope_location_code',
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

export type RecountFindingType =
  | 'unexpected_item'
  | 'product_defect'
  | 'packaging_defect';

export interface RecountFindingInput {
  clientEventId: string;
  recountLineId?: string | null;
  lasyncroVariantId: string;
  locationCode: string;
  findingType: RecountFindingType;
  quantity: number;
  notes?: string;
}

/**
 * RECOUNT-EXCEPTIONS-80
 *
 * Persist a physical observation without changing inventory truth.
 * Findings are evidence only; correction remains downstream of review/commit.
 */
export async function createRecountFinding(
  trx: Knex.Transaction,
  params: {
    shopId: number;
    recountTaskId: string;
    reportedBy: number;
    finding: RecountFindingInput;
  }
): Promise<Record<string, unknown>> {
  const { shopId, recountTaskId, reportedBy, finding } = params;
  const normalizedNotes = finding.notes?.trim() || null;

  const existingByEvent = await trx('inventory_recount_findings')
    .where({
      shop_id: shopId,
      client_event_id: finding.clientEventId,
    })
    .select(
      'recount_finding_id',
      'recount_task_id',
      'recount_line_id',
      'lasyncro_variant_id',
      'location_code',
      'finding_type',
      'quantity',
      'notes',
      'reported_by',
      'reported_at'
    )
    .first();

  if (existingByEvent) {
    const samePayload =
      existingByEvent.recount_task_id === recountTaskId &&
      (existingByEvent.recount_line_id ?? null) === (finding.recountLineId ?? null) &&
      existingByEvent.lasyncro_variant_id === finding.lasyncroVariantId &&
      existingByEvent.location_code === finding.locationCode &&
      existingByEvent.finding_type === finding.findingType &&
      Number(existingByEvent.quantity) === finding.quantity &&
      (existingByEvent.notes ?? null) === normalizedNotes &&
      existingByEvent.reported_by === reportedBy;

    if (!samePayload) {
      throw new Error(
        '[RECOUNT_FINDING] client_event_id already used for a different finding'
      );
    }

    console.info('[RECOUNT_FINDING_REPLAYED]', {
      recountTaskId,
      recountFindingId: existingByEvent.recount_finding_id,
      clientEventId: finding.clientEventId,
      shopId,
      reportedBy,
    });

    return existingByEvent;
  }

  if (!Number.isSafeInteger(finding.quantity) || finding.quantity <= 0) {
    throw new Error('[RECOUNT_FINDING] quantity must be a positive whole number');
  }

  // RECOUNT-CLAIM-ABANDONED-131: findings enforce claimed_by exactly like
  // recordCount/skipLine, so they share the same reassignment race and the
  // same row-lock fix.
  const task = await trx('inventory_recount_tasks')
    .where({
      shop_id: shopId,
      recount_task_id: recountTaskId,
    })
    .select('status', 'claimed_by')
    .forUpdate()
    .first();

  if (!task) {
    throw new Error(`[RECOUNT_FINDING] Task not found: ${recountTaskId}`);
  }

  if (!['claimed', 'counting'].includes(task.status)) {
    throw new Error(
      `[RECOUNT_FINDING] Task not countable, status: ${task.status}`
    );
  }

  if (task.claimed_by !== reportedBy) {
    throw new Error('[RECOUNT_FINDING] Task claimed by different operator');
  }

  const variant = await trx('variants')
    .where({
      shop_id: shopId,
      lasyncro_variant_id: finding.lasyncroVariantId,
    })
    .select('lasyncro_variant_id')
    .first();

  if (!variant) {
    throw new Error(
      `[RECOUNT_FINDING] Variant not found: ${finding.lasyncroVariantId}`
    );
  }

  const taskLocation = await trx('inventory_recount_lines')
    .where({
      shop_id: shopId,
      recount_task_id: recountTaskId,
      location_code: finding.locationCode,
    })
    .select('recount_line_id')
    .first();

  if (!taskLocation) {
    throw new Error(
      '[RECOUNT_FINDING] location_code must be part of the recount task'
    );
  }

  if (finding.findingType === 'unexpected_item') {
    if (finding.recountLineId) {
      throw new Error(
        '[RECOUNT_FINDING] unexpected_item recount_line_id must be omitted'
      );
    }
  } else {
    if (!finding.recountLineId) {
      throw new Error(
        '[RECOUNT_FINDING] defect finding requires a recount line'
      );
    }

    const line = await trx('inventory_recount_lines')
      .where({
        shop_id: shopId,
        recount_task_id: recountTaskId,
        recount_line_id: finding.recountLineId,
      })
      .select(
        'lasyncro_variant_id',
        'location_code'
      )
      .first();

    if (!line) {
      throw new Error(
        `[RECOUNT_FINDING] Recount line not found: ${finding.recountLineId}`
      );
    }

    if (
      line.lasyncro_variant_id !== finding.lasyncroVariantId ||
      line.location_code !== finding.locationCode
    ) {
      throw new Error(
        '[RECOUNT_FINDING] defect finding variant and location must be identical to its recount line'
      );
    }
  }

  const inserted = await trx('inventory_recount_findings')
    .insert({
      recount_task_id: recountTaskId,
      recount_line_id: finding.recountLineId ?? null,
      shop_id: shopId,
      client_event_id: finding.clientEventId,
      lasyncro_variant_id: finding.lasyncroVariantId,
      location_code: finding.locationCode,
      finding_type: finding.findingType,
      quantity: finding.quantity,
      notes: normalizedNotes,
      reported_by: reportedBy,
    })
    .onConflict(
      trx.raw(
        '(shop_id, client_event_id) WHERE client_event_id IS NOT NULL'
      )
    )
    .ignore()
    .returning([
      'recount_finding_id',
      'recount_task_id',
      'recount_line_id',
      'lasyncro_variant_id',
      'location_code',
      'finding_type',
      'quantity',
      'notes',
      'reported_by',
      'reported_at',
    ]);

  let created = inserted[0];

  if (!created) {
    created = await trx('inventory_recount_findings')
      .where({
        shop_id: shopId,
        client_event_id: finding.clientEventId,
      })
      .select(
        'recount_finding_id',
        'recount_task_id',
        'recount_line_id',
        'lasyncro_variant_id',
        'location_code',
        'finding_type',
        'quantity',
        'notes',
        'reported_by',
        'reported_at'
      )
      .first();

    if (!created) {
      throw new Error(
        '[RECOUNT_FINDING] idempotent replay could not load persisted finding'
      );
    }

    const samePayload =
      created.recount_task_id === recountTaskId &&
      (created.recount_line_id ?? null) === (finding.recountLineId ?? null) &&
      created.lasyncro_variant_id === finding.lasyncroVariantId &&
      created.location_code === finding.locationCode &&
      created.finding_type === finding.findingType &&
      Number(created.quantity) === finding.quantity &&
      (created.notes ?? null) === normalizedNotes &&
      created.reported_by === reportedBy;

    if (!samePayload) {
      throw new Error(
        '[RECOUNT_FINDING] client_event_id already used for a different finding'
      );
    }

    console.info('[RECOUNT_FINDING_REPLAYED]', {
      recountTaskId,
      recountFindingId: created.recount_finding_id,
      clientEventId: finding.clientEventId,
      shopId,
      reportedBy,
    });

    return created;
  }

  console.info('[RECOUNT_FINDING_RECORDED]', {
    recountTaskId,
    recountFindingId: created.recount_finding_id,
    findingType: created.finding_type,
    shopId,
    reportedBy,
  });

  return created;
}

export async function listRecountFindings(
  trx: Knex.Transaction,
  shopId: number,
  recountTaskId: string
): Promise<Array<Record<string, unknown>>> {
  const task = await trx('inventory_recount_tasks')
    .where({
      shop_id: shopId,
      recount_task_id: recountTaskId,
    })
    .select('recount_task_id')
    .first();

  if (!task) {
    throw new Error(`[RECOUNT_FINDING] Task not found: ${recountTaskId}`);
  }

  return trx('inventory_recount_findings')
    .where({
      shop_id: shopId,
      recount_task_id: recountTaskId,
    })
    .select(
      'recount_finding_id',
      'recount_task_id',
      'recount_line_id',
      'lasyncro_variant_id',
      'location_code',
      'finding_type',
      'quantity',
      'notes',
      'reported_by',
      'reported_at'
    )
    .orderBy('reported_at', 'asc');
}
