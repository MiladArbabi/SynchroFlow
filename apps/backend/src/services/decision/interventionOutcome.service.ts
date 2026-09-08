// apps/backend/src/services/decision/interventionOutcome.service.ts
//
// OUTCOME-ATTR-01 — decision intervention outcome READ MODEL.
//
// GOVERNING INVARIANT
//   execution success != treatment success != operational outcome
//
// decision_interventions records that a treatment was APPLIED. It says nothing
// about whether the merchant's problem went away. This module answers that
// second question, and it answers it from exactly one authority:
//
//   order_constraints.is_active  +  order_constraints.resolved_at
//
// Deliberately NOT consulted, in any form:
//   - decisions.status
//   - decisions.lifecycle.outcome
//   - decision_execution_queue.status
//   - order_fulfillment_history ('address_corrected' means an operator typed
//     something, not that the block cleared)
//   - any frontend-supplied state
//
// The derived outcome is NEVER persisted. Storing 'verified_resolved' would
// freeze a claim that canonical truth is free to contradict a second later —
// a constraint can be re-raised. Callers get the answer as of this read.
//
// This is an INTERNAL read seam, not an HTTP endpoint. Constraint evaluation
// does not and must not depend on it: nothing here writes, and nothing in the
// constraint pipeline imports it.
import { withTenant } from '@lasyncro/backend-core/db.js';

export type InterventionOutcomeStatus =
  | 'pending_verification'
  | 'verified_resolved'
  | 'unknown';

export interface InterventionOutcomeRecord {
  interventionId: string;
  constraintId: string | null;
  shopId: number;
  lasyncroOrderId: string;
  treatment: string;
  actionKey: string;
  actorType: string;
  actorUserId: number | null;
  sourceSurface: string;
  correctionSource: string | null;
  occurredAt: Date;
  metadata: Record<string, unknown> | null;
  outcome: {
    status: InterventionOutcomeStatus;
    constraintIsActive: boolean | null;
    constraintResolvedAt: Date | null;
    /** occurred_at → resolved_at, in ms. Null unless verified. */
    resolutionLatencyMs: number | null;
  };
}

const asDate = (value: unknown): Date | null => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

interface InterventionRow {
  id: string;
  shop_id: number;
  entity_id: string;
  constraint_id: string | null;
  treatment_key: string;
  action_key: string;
  actor_type: string;
  actor_user_id: number | null;
  source_surface: string;
  occurred_at: Date | string;
  metadata: Record<string, unknown> | null;
  constraint_is_active: boolean | null;
  constraint_resolved_at: Date | string | null;
  constraint_started_at: Date | string | null;
  constraint_order_id: string | null;
}

/**
 * Derives the outcome of ONE intervention from canonical constraint truth.
 *
 *   constraint still active                      -> pending_verification
 *   same constraint inactive + resolved_at set
 *     + chronologically consistent               -> verified_resolved
 *   missing / inconsistent / impossible order    -> unknown
 *
 * "Inconsistent" is not a theoretical case: an inactive constraint with no
 * resolved_at, or an active constraint that already carries one, means the
 * canonical lifecycle is in a state this read model must not interpret. It
 * says 'unknown' instead of guessing in the flattering direction.
 */
function deriveOutcome(
  row: InterventionRow,
  occurredAt: Date
): InterventionOutcomeRecord['outcome'] {
  const isActive = row.constraint_is_active;
  const resolvedAt = asDate(row.constraint_resolved_at);

  // No constraint correlated (never attributed, or the row is gone).
  if (isActive === null || isActive === undefined) {
    return {
      status: 'unknown',
      constraintIsActive: null,
      constraintResolvedAt: null,
      resolutionLatencyMs: null,
    };
  }

  /**
   * EPISODE GUARD (OUTCOME-INV-01).
   *
   * constraint_id is DETERMINISTIC — uuidv5(order + type + target) — and the
   * row is REUSED across resolve → re-raise cycles: orderConstraintProjection
   * updates the same row, clearing resolved_at and re-stamping started_at.
   * Inventory oversell flips this way routinely (stock lands, a competing order
   * consumes it, a reservation changes).
   *
   * Chronology alone cannot catch that. An intervention from episode A, then a
   * re-raise, then a resolution of episode B, leaves resolved_at legitimately
   * LATER than occurred_at — so a chronology check would happily credit the
   * earlier intervention with a resolution it had nothing to do with.
   *
   * Only episode IDENTITY separates them. An intervention that recorded the
   * constraint's started_at at write time is checked against the row's current
   * started_at, at the same JavaScript-millisecond precision used everywhere
   * else here. Any mismatch, absence or unparseable value means this read model
   * cannot say what happened, so it says 'unknown' rather than guessing in the
   * flattering direction.
   *
   * Interventions with NO recorded episode anchor are unaffected. The Address
   * pilot predates this field, and customer/incomplete_address does not exhibit
   * the reactivation pattern — this is deliberately not applied retroactively.
   */
  const recordedEpisode = (row.metadata ?? {}).constraint_started_at;

  if (recordedEpisode !== undefined && recordedEpisode !== null) {
    const recordedEpisodeAt = asDate(recordedEpisode);
    const currentEpisodeAt = asDate(row.constraint_started_at);

    const episodeMatches =
      recordedEpisodeAt !== null &&
      currentEpisodeAt !== null &&
      recordedEpisodeAt.getTime() === currentEpisodeAt.getTime();

    if (!episodeMatches) {
      return {
        status: 'unknown',
        constraintIsActive: isActive,
        constraintResolvedAt: resolvedAt,
        resolutionLatencyMs: null,
      };
    }
  }

  if (isActive === true) {
    // An active constraint carrying a resolution timestamp is incoherent.
    const status: InterventionOutcomeStatus = resolvedAt ? 'unknown' : 'pending_verification';
    return {
      status,
      constraintIsActive: true,
      constraintResolvedAt: resolvedAt,
      resolutionLatencyMs: null,
    };
  }

  // Inactive, but nothing says when it resolved — not verifiable.
  if (!resolvedAt) {
    return {
      status: 'unknown',
      constraintIsActive: false,
      constraintResolvedAt: null,
      resolutionLatencyMs: null,
    };
  }

  /**
   * CHRONOLOGY, EVALUATED AT JAVASCRIPT MILLISECOND PRECISION.
   *
   * Both timestamps are converted to JS Date, which is millisecond-resolution,
   * so the rule this model actually enforces is:
   *
   *   resolved_at >= occurred_at, at whole-millisecond precision
   *
   * PostgreSQL stores microseconds. A production intervention (2026-09-08)
   * recorded occurred_at 16:24:38.318964+00 against resolved_at
   * 16:24:38.318+00 — a raw delta of -0.964ms that collapses to the SAME JS
   * millisecond, and is therefore equal here, and legitimately verified. That
   * is a precision fact, not a tolerance: sub-millisecond differences are
   * invisible to this comparison because the comparison has no finer units.
   *
   * There is deliberately NO tolerance window. Any negative millisecond
   * latency is a genuine inversion — the constraint resolved before the
   * treatment was recorded — and cannot have been caused by it. A tolerance
   * would let a late, duplicate or replayed intervention inherit a resolution
   * it played no part in, which is precisely the false credit this whole
   * module exists to prevent.
   */
  const latencyMs = resolvedAt.getTime() - occurredAt.getTime();

  if (latencyMs < 0) {
    return {
      status: 'unknown',
      constraintIsActive: false,
      constraintResolvedAt: resolvedAt,
      resolutionLatencyMs: null,
    };
  }

  return {
    status: 'verified_resolved',
    constraintIsActive: false,
    constraintResolvedAt: resolvedAt,
    // Non-negative by construction — the inversion guard above returned.
    resolutionLatencyMs: latencyMs,
  };
}

/**
 * Reads every durable intervention recorded against one order, with its
 * outcome derived from canonical constraint truth at read time.
 *
 * Tenant-safe: the whole read runs inside withTenant, so RLS scopes
 * decision_interventions by shop_id and order_constraints relationally via
 * orders. The shop_id predicate is stated explicitly as well — RLS is the
 * boundary, not the query's only defence.
 *
 * Correlation is by EXACT constraint_id. A correction that cleared the customer
 * blocker must never be able to claim credit for a coexisting inventory
 * blocker, and joining on anything looser (order + type, or "the active one
 * now") would let it.
 */
export async function readOrderInterventionOutcomes(input: {
  shopId: number;
  lasyncroOrderId: string;
}): Promise<InterventionOutcomeRecord[]> {
  const { shopId, lasyncroOrderId } = input;

  const rows: InterventionRow[] = await withTenant(shopId, (trx) =>
    trx('decision_interventions as i')
      .leftJoin('order_constraints as c', 'c.constraint_id', 'i.constraint_id')
      .where({
        'i.shop_id': shopId,
        'i.entity_type': 'order',
        'i.entity_id': lasyncroOrderId,
      })
      .orderBy('i.occurred_at', 'asc')
      .orderBy('i.id', 'asc')
      .select(
        'i.id',
        'i.shop_id',
        'i.entity_id',
        'i.constraint_id',
        'i.treatment_key',
        'i.action_key',
        'i.actor_type',
        'i.actor_user_id',
        'i.source_surface',
        'i.occurred_at',
        'i.metadata',
        'c.is_active as constraint_is_active',
        'c.resolved_at as constraint_resolved_at',
        'c.started_at as constraint_started_at',
        'c.lasyncro_order_id as constraint_order_id'
      )
  );

  return rows.map((row) => {
    const occurredAt = asDate(row.occurred_at) as Date;
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const correctionSource = metadata.correction_source;

    return {
      interventionId: row.id,
      constraintId: row.constraint_id,
      shopId: Number(row.shop_id),
      lasyncroOrderId: row.entity_id,
      treatment: row.treatment_key,
      actionKey: row.action_key,
      actorType: row.actor_type,
      actorUserId: row.actor_user_id === null ? null : Number(row.actor_user_id),
      sourceSurface: row.source_surface,
      correctionSource: typeof correctionSource === 'string' ? correctionSource : null,
      occurredAt,
      metadata: row.metadata ?? {},
      outcome: deriveOutcome(row, occurredAt),
    };
  });
}
