import type { Knex } from 'knex';

import { createRecountTask }
  from './inventoryRecount.service.js';

import { createProblemCenterTask }
  from './problemCenterTask.service.js';
import type { FulfillmentPhysicalLocationConflict }
  from './fulfillmentPhysicalRemoval.service.js';

export interface CreateFulfillmentReconciliationConflictInput {
  shopId: number;
  sourceDomainEventId: number;
  lasyncroOrderId: string;
  occurredAt: Date;
  conflict: FulfillmentPhysicalLocationConflict;
}

function conflictType(
  conflict: FulfillmentPhysicalLocationConflict
): string {
  return conflict.code === 'LOCATION_AMBIGUOUS'
    ? 'fulfillment_location_ambiguous'
    : 'fulfillment_location_not_found';
}

/**
 * Persists the operator-facing reconciliation artifacts for a Shopify
 * fulfillment whose commerce truth is valid but whose physical stock movement
 * cannot be applied safely.
 *
 * All writes use the caller's projection transaction so commerce truth and the
 * unresolved physical exception commit atomically.
 */
export async function createFulfillmentReconciliationConflict(
  trx: Knex.Transaction,
  input: CreateFulfillmentReconciliationConflictInput
): Promise<{ conflictId: string }> {
  const {
    shopId,
    sourceDomainEventId,
    lasyncroOrderId,
    occurredAt,
    conflict,
  } = input;

  const type = conflictType(conflict);

  const candidateLocations =
    conflict.candidateLocations.map((candidate) => ({
      location_code: candidate.location_code,
      on_hand_quantity: Number(candidate.on_hand_quantity),
    }));

  const inserted =
    await trx('inventory_reconciliation_conflicts')
      .insert({
        shop_id: shopId,
        conflict_type: type,
        source_platform: 'shopify',
        source_domain_event_id: sourceDomainEventId,
        lasyncro_order_id: lasyncroOrderId,
        lasyncro_line_item_id:
          conflict.lasyncroLineItemId,
        lasyncro_variant_id:
          conflict.lasyncroVariantId,
        external_location_id: null,
        warehouse_id: null,
        quantity: conflict.quantity,
        occurred_at: occurredAt,
        candidate_locations: JSON.stringify(candidateLocations),
        status: 'open',
        created_at: occurredAt,
        updated_at: occurredAt,
      })
      .onConflict()
      .ignore()
      .returning(['conflict_id']);

  let conflictId: string | null =
    inserted[0]?.conflict_id ?? null;

  if (!conflictId) {
    const existing =
      await trx('inventory_reconciliation_conflicts')
        .where({
          shop_id: shopId,
          source_domain_event_id: sourceDomainEventId,
          lasyncro_line_item_id:
            conflict.lasyncroLineItemId,
          conflict_type: type,
        })
        .first('conflict_id');

    conflictId = existing?.conflict_id ?? null;
  }

  if (!conflictId) {
    throw new Error(
      'FULFILLMENT_RECONCILIATION_CONFLICT_CREATE_FAILED'
    );
  }

  await createProblemCenterTask(
    trx,
    {
      shopId,
      source: 'reconciliation',
      sourceExceptionId: conflictId,
      lasyncroVariantId:
        conflict.lasyncroVariantId,
      quantity: conflict.quantity,
      exceptionType: type,
      notes:
        `Shopify fulfillment event ${sourceDomainEventId} requires physical inventory reconciliation.`,
    }
  );

  const alertKey =
    `reconciliation:${conflictId}:inventory_reconciliation_conflict`;

  await trx('alerts')
    .insert({
      shop_id: shopId,
      alert_key: alertKey,
      source: 'reconciliation',
      alert_type:
        'inventory_reconciliation_conflict',
      severity: 'warning',
      title: 'Inventory conflict needs review',
      message:
        'Shopify fulfilled this order, but LaSyncro cannot determine one safe warehouse location for the physical stock movement.',
      entity_id: conflictId,
      entity_type:
        'inventory_reconciliation_conflict',
      revenue_impact: null,
      is_active: true,
      category: 'data_trust',
      audience: 'operator',
      created_at: occurredAt,
      updated_at: occurredAt,
    })
    .onConflict(['shop_id', 'alert_key'])
    .ignore();

  return { conflictId };
}

export interface RequestFulfillmentReconciliationRecountInput {
  shopId: number;
  conflictId: string;
  requestedBy: number;
}

export interface RequestFulfillmentReconciliationRecountResult {
  recountTaskId: string;
}

/**
 * Converts one unresolved reconciliation incident into targeted physical
 * verification work.
 *
 * The reconciliation conflict remains the parent incident. Creating the
 * recount gathers evidence only; it does not resolve the conflict, Problem
 * Center task, or alert.
 */
export async function requestFulfillmentReconciliationRecount(
  trx: Knex.Transaction,
  input: RequestFulfillmentReconciliationRecountInput
): Promise<RequestFulfillmentReconciliationRecountResult> {
  const {
    shopId,
    conflictId,
    requestedBy,
  } = input;

  /**
   * Serialize competing/retried requests against this conflict.
   *
   * Once recount_task_id exists, every later request returns that same task
   * instead of dispatching duplicate warehouse work.
   */
  const conflict = await trx('inventory_reconciliation_conflicts')
    .where({
      shop_id: shopId,
      conflict_id: conflictId,
    })
    .forUpdate()
    .first(
      'conflict_id',
      'status',
      'candidate_locations',
      'recount_task_id'
    );

  if (!conflict) {
    throw new Error(
      `[FULFILLMENT_RECONCILIATION_RECOUNT] Conflict not found: ${conflictId}`
    );
  }

  if (conflict.recount_task_id) {
    return {
      recountTaskId: String(conflict.recount_task_id),
    };
  }

  if (conflict.status !== 'open') {
    throw new Error(
      `[FULFILLMENT_RECONCILIATION_RECOUNT] Conflict is not open: ${conflict.status}`
    );
  }

  const rawCandidates =
    typeof conflict.candidate_locations === 'string'
      ? JSON.parse(conflict.candidate_locations)
      : conflict.candidate_locations;

  if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
    throw new Error(
      '[FULFILLMENT_RECONCILIATION_RECOUNT] Conflict has no candidate locations'
    );
  }

  const locationCodes = Array.from(
    new Set(
      rawCandidates
        .map((candidate: any) =>
          String(candidate?.location_code ?? '').trim()
        )
        .filter(Boolean)
    )
  );

  if (locationCodes.length === 0) {
    throw new Error(
      '[FULFILLMENT_RECONCILIATION_RECOUNT] Conflict has no valid candidate location codes'
    );
  }

  /**
   * Physical reconciliation may only dispatch operators to real, active,
   * countable bins. Warehouse roots/unlocated stock are evidence states, not
   * shelves an operator can verify.
   */
  const candidateBins = await trx('warehouse_locations')
    .where({
      shop_id: shopId,
      active: true,
      type: 'bin',
    })
    .whereIn('location_code', locationCodes)
    .select(
      'warehouse_id',
      'location_code'
    );

  const resolvedCodes = new Set(
    candidateBins.map((row: any) =>
      String(row.location_code)
    )
  );

  const unresolvedLocation = locationCodes.find(
    (locationCode) => !resolvedCodes.has(locationCode)
  );

  if (unresolvedLocation) {
    throw new Error(
      `[FULFILLMENT_RECONCILIATION_RECOUNT] Candidate is not an active countable bin: ${unresolvedLocation}`
    );
  }

  const warehouseIds = Array.from(
    new Set(
      candidateBins.map((row: any) =>
        String(row.warehouse_id)
      )
    )
  );

  if (warehouseIds.length !== 1) {
    throw new Error(
      '[FULFILLMENT_RECONCILIATION_RECOUNT] Candidate bins must belong to exactly one warehouse'
    );
  }

  const warehouseId = warehouseIds[0];

  const recount = await createRecountTask(
    trx,
    {
      shopId,
      warehouseId,
      scope: 'locations',
      createdBy: requestedBy,
      locationCodes,
      notes:
        `Physical verification for reconciliation conflict ${conflictId}`,
    }
  );

  const requestedAt = trx.fn.now();

  await trx('inventory_reconciliation_conflicts')
    .where({
      shop_id: shopId,
      conflict_id: conflictId,
    })
    .update({
      recount_task_id: recount.recount_task_id,
      recount_requested_at: requestedAt,
      recount_requested_by: requestedBy,
      updated_at: requestedAt,
    });

  return {
    recountTaskId: recount.recount_task_id,
  };
}

export interface FinalizeFulfillmentReconciliationRecountInput {
  shopId: number;
  recountTaskId: string;
  resolvedBy: number;
}

export type FulfillmentReconciliationResolutionAction =
  | 'physical_recount_verified'
  | 'physical_recount_corrected';

export interface FinalizeFulfillmentReconciliationRecountResult {
  finalized: boolean;
  conflictId: string | null;
  resolutionAction:
    | FulfillmentReconciliationResolutionAction
    | null;
  reason?: string;
}

/**
 * Finalizes a fulfillment reconciliation incident only when its linked
 * physical recount contains complete terminal evidence.
 *
 * This function deliberately does NOT write inventory. Inventory correction
 * belongs exclusively to the existing recount commit path.
 *
 * It is safe to call for ordinary recount tasks: an unlinked recount is a
 * no-op rather than an error.
 */
export async function finalizeFulfillmentReconciliationRecount(
  trx: Knex.Transaction,
  input: FinalizeFulfillmentReconciliationRecountInput
): Promise<FinalizeFulfillmentReconciliationRecountResult> {
  const {
    shopId,
    recountTaskId,
    resolvedBy,
  } = input;

  const conflict =
    await trx('inventory_reconciliation_conflicts')
      .where({
        shop_id: shopId,
        recount_task_id: recountTaskId,
      })
      .forUpdate()
      .first(
        'conflict_id',
        'status',
        'resolution_action'
      );

  /**
   * Ordinary inventory recounts are unrelated to Shopify fulfillment
   * reconciliation. This must remain a safe no-op so the finalizer can later
   * be wired into the canonical recount terminal paths.
   */
  if (!conflict) {
    return {
      finalized: false,
      conflictId: null,
      resolutionAction: null,
      reason: 'not_reconciliation_recount',
    };
  }

  const conflictId = String(conflict.conflict_id);

  /**
   * Retry/idempotency contract.
   */
  if (conflict.status === 'resolved') {
    return {
      finalized: true,
      conflictId,
      resolutionAction:
        conflict.resolution_action ??
        'physical_recount_verified',
    };
  }

  if (conflict.status !== 'open') {
    return {
      finalized: false,
      conflictId,
      resolutionAction: null,
      reason: 'conflict_not_open',
    };
  }

  const task = await trx('inventory_recount_tasks')
    .where({
      shop_id: shopId,
      recount_task_id: recountTaskId,
    })
    .first(
      'status',
      'committed_at'
    );

  if (
    !task ||
    task.status !== 'committed' ||
    !task.committed_at
  ) {
    return {
      finalized: false,
      conflictId,
      resolutionAction: null,
      reason: 'recount_not_committed',
    };
  }

  const lines = await trx('inventory_recount_lines')
    .where({
      shop_id: shopId,
      recount_task_id: recountTaskId,
    })
    .select(
      'recount_line_id',
      'recount_of_line_id',
      'counted_quantity',
      'variance',
      'variance_reason',
      'skip_reason',
      'inventory_movement_id'
    );

  if (lines.length === 0) {
    return {
      finalized: false,
      conflictId,
      resolutionAction: null,
      reason: 'no_recount_evidence',
    };
  }

  /**
   * A recount may preserve an original line and create a replacement line.
   * Only the latest unsuperseded evidence participates in finalization.
   */
  const supersededIds = new Set(
    lines
      .map((line: any) => line.recount_of_line_id)
      .filter(Boolean)
      .map(String)
  );

  const activeLines = lines.filter(
    (line: any) =>
      !supersededIds.has(String(line.recount_line_id))
  );

  if (
    activeLines.length === 0 ||
    activeLines.some(
      (line: any) =>
        line.counted_quantity === null ||
        line.skip_reason !== null
    )
  ) {
    return {
      finalized: false,
      conflictId,
      resolutionAction: null,
      reason: 'incomplete_physical_evidence',
    };
  }

  const activeLineIds = activeLines.map(
    (line: any) => String(line.recount_line_id)
  );

  /**
   * Escalation transfers ownership to a separate Problem Center incident.
   * Do not silently close the parent reconciliation while that alternate
   * resolution path exists.
   */
  const escalation = await trx('problem_center_tasks')
    .where({
      shop_id: shopId,
      source: 'count',
    })
    .whereIn(
      'source_exception_id',
      activeLineIds
    )
    .first('problem_task_id');

  if (escalation) {
    return {
      finalized: false,
      conflictId,
      resolutionAction: null,
      reason: 'recount_evidence_escalated',
    };
  }

  const varianceLines = activeLines.filter(
    (line: any) => Number(line.variance) !== 0
  );

  /**
   * Every accepted non-zero variance must already own the canonical
   * reconciliation_correction written by commitRecount().
   *
   * The fulfillment reconciliation layer never writes a second
   * fulfillment_removal or stock correction.
   */
  if (
    varianceLines.some(
      (line: any) =>
        !line.variance_reason ||
        !line.inventory_movement_id
    )
  ) {
    return {
      finalized: false,
      conflictId,
      resolutionAction: null,
      reason: 'variance_not_fully_resolved',
    };
  }

  if (varianceLines.length > 0) {
    const movementIds = varianceLines.map(
      (line: any) => String(line.inventory_movement_id)
    );

    const correctionMovements =
      await trx('inventory_movements')
        .where({
          shop_id: shopId,
          movement_type: 'reconciliation_correction',
          reference_type: 'recount_line',
        })
        .whereIn(
          'lasyncro_inventory_movement_id',
          movementIds
        )
        .select(
          'lasyncro_inventory_movement_id',
          'reference_id'
        );

    const validCorrectionByLine = new Map(
      correctionMovements.map((movement: any) => [
        String(movement.reference_id),
        String(
          movement.lasyncro_inventory_movement_id
        ),
      ])
    );

    const correctionMismatch =
      varianceLines.some(
        (line: any) =>
          validCorrectionByLine.get(
            String(line.recount_line_id)
          ) !== String(line.inventory_movement_id)
      );

    if (correctionMismatch) {
      return {
        finalized: false,
        conflictId,
        resolutionAction: null,
        reason: 'correction_evidence_invalid',
      };
    }
  }

  const resolutionAction:
    FulfillmentReconciliationResolutionAction =
      varianceLines.length > 0
        ? 'physical_recount_corrected'
        : 'physical_recount_verified';

  const resolutionNotes =
    resolutionAction === 'physical_recount_corrected'
      ? (
          'Resolved through complete physical reconciliation. ' +
          'Current inventory truth was corrected through the canonical ' +
          'recount ledger path; the original Shopify source location ' +
          'remains historically indeterminate.'
        )
      : (
          'Resolved through complete physical reconciliation. ' +
          'Current inventory truth was physically verified; the original ' +
          'Shopify source location remains historically indeterminate.'
        );

  const resolvedAt = trx.fn.now();

  await trx('inventory_reconciliation_conflicts')
    .where({
      shop_id: shopId,
      conflict_id: conflictId,
    })
    .update({
      status: 'resolved',
      resolution_action: resolutionAction,
      resolution_location_code: null,
      resolution_notes: resolutionNotes,
      resolved_by: resolvedBy,
      resolved_at: resolvedAt,
      updated_at: resolvedAt,
    });

  await trx('problem_center_tasks')
    .where({
      shop_id: shopId,
      source: 'reconciliation',
      source_exception_id: conflictId,
    })
    .update({
      status: 'resolved',
      resolution_action: resolutionAction,
      resolution_notes: resolutionNotes,
      resolved_by: resolvedBy,
      resolved_at: resolvedAt,
      updated_at: resolvedAt,
    });

  await trx('alerts')
    .where({
      shop_id: shopId,
      source: 'reconciliation',
      alert_type:
        'inventory_reconciliation_conflict',
      entity_id: conflictId,
      is_active: true,
    })
    .update({
      is_active: false,
      updated_at: resolvedAt,
    });

  return {
    finalized: true,
    conflictId,
    resolutionAction,
  };
}
