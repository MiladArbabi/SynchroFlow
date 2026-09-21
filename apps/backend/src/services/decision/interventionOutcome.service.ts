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
import type { Knex } from 'knex';

export type InterventionOutcomeStatus =
  | 'pending_verification'
  | 'verified_resolved'
  | 'unknown';

/**
 * OPS-CONSOLE-WAITING-01 — WAITING V1 ratified treatment allowlist.
 * The single source of truth for which treatments the shop-wide WAITING
 * surface (and its NOW anti-join, see alerts.aggregator.ts) considers.
 * Exported so callers never hand-roll their own duplicate list.
 */
export const WAITING_V1_TREATMENTS = ['address_correction', 'inventory_reorder_intent'] as const;

/**
 * OPS-CONSOLE-WAITING-01 CORRECTION 2 — WAITING V1 ratified treatment/
 * constraint pairings. A treatment appearing in WAITING_V1_TREATMENTS is
 * necessary but NOT sufficient: it must also be paired with the EXACT
 * constraintType/blockType it was built to treat. Any other pairing
 * (including either V1 treatment against an operational constraint, or a
 * treatment crossed with the other's constraint type) fails closed — never
 * WAITING, and never excluded from NOW. Single source of truth: this table
 * is never read directly by any consumer — it is reached only through the
 * pure lookup getWaitingV1TreatmentForConstraint() below, which is in turn
 * the ONLY thing readCurrentWaitingV1Records()/readCurrentHistoryV1Records()
 * (via isWaitingV1EligiblePairing()) and D0's
 * operationalEpisodeRead.service.ts consume. No caller may hand-roll a
 * second copy of this table.
 */
const WAITING_V1_PAIRINGS: Record<
  (typeof WAITING_V1_TREATMENTS)[number],
  { constraintType: string; blockType: string }
> = {
  address_correction: { constraintType: 'customer', blockType: 'incomplete_address' },
  inventory_reorder_intent: { constraintType: 'inventory', blockType: 'oversell' },
};

export type WaitingV1Treatment = (typeof WAITING_V1_TREATMENTS)[number];

/**
 * D0 — the SAME single pairing authority WAITING_V1_PAIRINGS backs, exposed
 * as a pure lookup: "which approved V1 treatment, if any, corresponds to
 * this exact constraint_type/block_type?" Every caller that needs a
 * constraint->treatment answer (WAITING eligibility below, and D0's
 * operationalEpisodeRead.service.ts) MUST go through this function rather
 * than hand-rolling a second copy of WAITING_V1_PAIRINGS.
 */
export function getWaitingV1TreatmentForConstraint(
  constraintType: string | null,
  blockType: string | null
): WaitingV1Treatment | null {
  for (const treatment of WAITING_V1_TREATMENTS) {
    const pairing = WAITING_V1_PAIRINGS[treatment];
    if (constraintType === pairing.constraintType && blockType === pairing.blockType) {
      return treatment;
    }
  }
  return null;
}

function isWaitingV1EligiblePairing(
  treatment: string,
  constraintType: string | null,
  blockType: string | null
): boolean {
  return getWaitingV1TreatmentForConstraint(constraintType, blockType) === treatment;
}

export interface InterventionOutcomeRecord {
  interventionId: string;
  constraintId: string | null;
  /** order_constraints.constraint_type for the correlated episode, if any. */
  constraintType: string | null;
  /** order_constraints.block_type for the correlated episode, if any. */
  blockType: string | null;
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
  constraint_type: string | null;
  block_type: string | null;
}

/**
 * Exact column set both readers select. A single list so the shop-wide
 * WAITING reader (readShopInterventionOutcomes) can never drift into a
 * second, approximate interpretation of the same join.
 */
const INTERVENTION_OUTCOME_COLUMNS = [
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
  'c.lasyncro_order_id as constraint_order_id',
  'c.constraint_type as constraint_type',
  'c.block_type as block_type',
] as const;

/** Shared row -> canonical outcome record mapping. Used by every reader. */
function toOutcomeRecord(row: InterventionRow): InterventionOutcomeRecord {
  const occurredAt = asDate(row.occurred_at) as Date;
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const correctionSource = metadata.correction_source;

  return {
    interventionId: row.id,
    constraintId: row.constraint_id,
    constraintType: row.constraint_type,
    blockType: row.block_type,
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
      .select(...INTERVENTION_OUTCOME_COLUMNS)
  );

  return rows.map(toOutcomeRecord);
}

/**
 * Reads every durable V1-treatment intervention recorded shop-wide, with
 * outcome derived from the SAME canonical order_constraints truth and the
 * SAME deriveOutcome() branch as readOrderInterventionOutcomes() above —
 * this is the one and only outcome derivation in the codebase; nothing here
 * re-implements or approximates it.
 *
 * Backs both the shop-wide WAITING read (GET /api/v1/operations/waiting)
 * and the NOW aggregate's per-episode exclusion
 * (alerts.aggregator.ts#aggregateConstraintAlerts) — one shared query shape,
 * two consumers.
 *
 * `trx`, when supplied, runs the read against that already-tenant-scoped
 * transaction instead of opening a second one (alerts.aggregator.ts already
 * holds a `SET LOCAL app.current_tenant` transaction for the shop). Omitting
 * it opens its own withTenant transaction, matching every other reader here.
 */
export async function readShopInterventionOutcomes(
  input: { shopId: number; treatments?: readonly string[] },
  trx?: Knex.Transaction
): Promise<InterventionOutcomeRecord[]> {
  const { shopId, treatments } = input;

  const run = (t: Knex.Transaction) => {
    let query = t('decision_interventions as i')
      .leftJoin('order_constraints as c', 'c.constraint_id', 'i.constraint_id')
      .where({ 'i.shop_id': shopId, 'i.entity_type': 'order' })
      .orderBy('i.occurred_at', 'asc')
      .orderBy('i.id', 'asc');

    if (treatments && treatments.length > 0) {
      query = query.whereIn('i.treatment_key', treatments as string[]);
    }

    return query.select(...INTERVENTION_OUTCOME_COLUMNS);
  };

  const rows: InterventionRow[] = trx ? await run(trx) : await withTenant(shopId, run);

  return rows.map(toOutcomeRecord);
}

/**
 * True iff `candidate` should replace `current` as the winning intervention
 * for one constraint episode: strictly later occurredAt, or — on an exact
 * tie — the lexicographically greater interventionId (deterministic,
 * ordering-independent of insertion order).
 *
 * Shared verbatim by both readCurrentWaitingV1Records() (below) and
 * readCurrentHistoryV1Records() (OPS-CONSOLE-HISTORY-01, further below) —
 * one deterministic winner rule for "latest intervention against this
 * episode", regardless of which outcome status the caller is collapsing for.
 */
function isLaterWaitingV1Intervention(
  candidate: InterventionOutcomeRecord,
  current: InterventionOutcomeRecord
): boolean {
  const candidateTime = candidate.occurredAt.getTime();
  const currentTime = current.occurredAt.getTime();
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  return candidate.interventionId > current.interventionId;
}

/**
 * OPS-CONSOLE-WAITING-01 CORRECTION 1 & 2 — the ONE shared shop-wide
 * "current WAITING V1" projection. decision_interventions stays append-only
 * provenance (readOrderInterventionOutcomes()/readShopInterventionOutcomes()
 * above are untouched and never deduplicate); this is a separate CURRENT
 * STATE view built on top of them:
 *
 *   1. treatment allowlist            — WAITING_V1_TREATMENTS
 *   2. outcome === pending_verification (deriveOutcome(), unmodified)
 *   3. treatment/constraint pairing   — WAITING_V1_PAIRINGS (correction 2):
 *      an eligible outcome's constraintType/blockType must exactly match
 *      the pairing its own treatment declares. Anything else — either V1
 *      treatment against operational, or crossed with the other's
 *      constraint type — fails closed and is dropped entirely, both from
 *      this projection AND (by construction, since callers derive NOW
 *      exclusion from this same result) from NOW suppression.
 *   4. latest-per-current-episode     — (correction 1): pending_verification
 *      already proves an outcome belongs to the CURRENT episode (an
 *      old/re-raised-episode intervention derives 'unknown' in deriveOutcome
 *      and is filtered out at step 2, before it ever reaches this grouping),
 *      so grouping the survivors by constraintId and keeping only the one
 *      with the latest occurredAt (interventionId tie-break) is sufficient —
 *      no second episode-identity check is needed here.
 *
 * The single shared result both WAITING consumers must read from:
 *   - GET /api/v1/operations/waiting (operations.controller.ts) maps this
 *     directly to presentation/API items.
 *   - aggregateConstraintAlerts() (alerts.aggregator.ts) derives its NOW
 *     exclusion set from this same result's constraintIds.
 * Neither consumer may re-filter, re-derive pairing eligibility, or
 * re-deduplicate independently.
 *
 * Returned in occurredAt ASC, interventionId ASC order — the same order
 * readShopInterventionOutcomes() already establishes and the existing
 * WAITING endpoint already relies on — so grouping never lets Map insertion
 * order leak into the result.
 */
export async function readCurrentWaitingV1Records(
  input: { shopId: number },
  trx?: Knex.Transaction
): Promise<InterventionOutcomeRecord[]> {
  const records = await readShopInterventionOutcomes(
    { shopId: input.shopId, treatments: WAITING_V1_TREATMENTS },
    trx
  );

  const winnerByConstraintId = new Map<string, InterventionOutcomeRecord>();

  for (const record of records) {
    if (record.outcome.status !== 'pending_verification' || record.constraintId === null) continue;
    if (!isWaitingV1EligiblePairing(record.treatment, record.constraintType, record.blockType)) continue;

    const constraintId = record.constraintId;
    const current = winnerByConstraintId.get(constraintId);
    if (!current || isLaterWaitingV1Intervention(record, current)) {
      winnerByConstraintId.set(constraintId, record);
    }
  }

  return Array.from(winnerByConstraintId.values()).sort(
    (a, b) =>
      a.occurredAt.getTime() - b.occurredAt.getTime() ||
      (a.interventionId < b.interventionId ? -1 : a.interventionId > b.interventionId ? 1 : 0)
  );
}

/**
 * OPS-CONSOLE-HISTORY-01 — HISTORY V1 eligible-outcome retention window, in
 * days. Enforced inside readCurrentHistoryV1Records() so every caller gets
 * the same window for free; not a controller-level filter.
 */
export const HISTORY_V1_RETENTION_DAYS = 30;

/**
 * OPS-CONSOLE-HISTORY-01 — the ONE shared shop-wide "resolved HISTORY V1"
 * projection, built on the EXACT SAME seam readCurrentWaitingV1Records()
 * above uses:
 *   1. treatment allowlist            — WAITING_V1_TREATMENTS
 *   2. treatment/constraint pairing   — WAITING_V1_PAIRINGS /
 *      isWaitingV1EligiblePairing(), unmodified
 *   3. canonical outcome derivation   — deriveOutcome(), unmodified
 *   4. deterministic winner selection — isLaterWaitingV1Intervention(),
 *      the SAME function readCurrentWaitingV1Records() uses
 *
 * The only branch point from the WAITING projection is which outcome status
 * this one selects for: outcome.status === 'verified_resolved', never
 * 'pending_verification'. Nothing here re-implements or approximates
 * deriveOutcome() — this file remains the one and only outcome derivation.
 *
 * COLLAPSE: decision_interventions is append-only provenance and may
 * legitimately carry N interventions against the SAME now-resolved
 * constraint episode (a repeated correction before canonical resolution
 * landed). This projection keeps exactly one row per constraintId — the
 * winning (latest occurredAt, greatest interventionId tie-break)
 * verified_resolved intervention — so exactly one merchant-facing HISTORY
 * item is produced per resolved constraint episode, never per intervention
 * attempt.
 *
 * RETENTION: an episode whose canonical constraintResolvedAt falls outside
 * HISTORY_V1_RETENTION_DAYS of `now` is dropped from the result entirely.
 *
 * Returned in constraintResolvedAt DESC (newest first), with interventionId
 * DESC as a deterministic tie-break — the exact ordering
 * GET /api/v1/operations/history exposes.
 */
export async function readCurrentHistoryV1Records(
  input: { shopId: number; now?: Date },
  trx?: Knex.Transaction
): Promise<InterventionOutcomeRecord[]> {
  const records = await readShopInterventionOutcomes(
    { shopId: input.shopId, treatments: WAITING_V1_TREATMENTS },
    trx
  );

  const winnerByConstraintId = new Map<string, InterventionOutcomeRecord>();

  for (const record of records) {
    if (record.outcome.status !== 'verified_resolved' || record.constraintId === null) continue;
    if (!isWaitingV1EligiblePairing(record.treatment, record.constraintType, record.blockType)) continue;

    const constraintId = record.constraintId;
    const current = winnerByConstraintId.get(constraintId);
    if (!current || isLaterWaitingV1Intervention(record, current)) {
      winnerByConstraintId.set(constraintId, record);
    }
  }

  const now = input.now ?? new Date();
  const retentionCutoffMs = now.getTime() - HISTORY_V1_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  return Array.from(winnerByConstraintId.values())
    .filter((record) => {
      const resolvedAt = record.outcome.constraintResolvedAt;
      return resolvedAt !== null && resolvedAt.getTime() >= retentionCutoffMs;
    })
    .sort((a, b) => {
      const aResolvedAt = (a.outcome.constraintResolvedAt as Date).getTime();
      const bResolvedAt = (b.outcome.constraintResolvedAt as Date).getTime();
      if (aResolvedAt !== bResolvedAt) return bResolvedAt - aResolvedAt;
      return a.interventionId < b.interventionId ? 1 : a.interventionId > b.interventionId ? -1 : 0;
    });
}
