// apps/backend/src/services/operations/operationalEpisodeRead.service.ts
//
// SLICE D0 — canonical operational-episode read seam.
// SLICE D3A — policy-capable JUST_RESOLVED derivation (opt-in only).
//
// This module COMPOSES existing canonical truths — it invents neither:
//
//   order_constraints                 = the canonical problem truth (active
//                                        AND, when opted in, recently
//                                        resolved)
//   readCurrentWaitingV1Records()      = the canonical "merchant already
//                                        acted; verification pending" truth
//                                        (interventionOutcome.service.ts)
//
// It must never become a second lifecycle/state machine. Lifecycle is
// exactly what those truths already answer:
//   ACTIVE constraint matched by readCurrentWaitingV1Records()  -> verifying
//   ACTIVE constraint not matched                                -> attention
//   INACTIVE constraint, resolved recently enough (opt-in only,
//     see readCurrentOperationalEpisodesV1's `justResolved` input) -> just_resolved
// Matching for verifying is by constraintId against
// readCurrentWaitingV1Records()'s OWN result only; this module never
// inspects decision_interventions directly, and never repeats that
// function's own pairing/pending-verification/episode-anchor/winner-
// selection checks. WAITING is NEVER consulted to decide just_resolved
// eligibility — that is order_constraints.resolved_at + the caller-supplied
// policy alone.
//
// V1 ONLY: customer/incomplete_address, inventory/oversell — via the single
// pairing authority getWaitingV1TreatmentForConstraint() exported by
// interventionOutcome.service.ts. No other constraint_type/block_type is
// exposed by this seam, and no second copy of that pairing table exists
// here.
//
// D3A SCOPE: this module becomes CAPABLE of producing just_resolved only
// when an internal caller explicitly supplies a `justResolved` clock +
// recovery-window policy. There is no default/hidden recovery duration, and
// this module never calls Date.now()/`new Date()` for lifecycle
// classification — "now" is always the caller's own supplied value.
// operations.controller.ts (GET /api/v1/operations/episodes) is untouched
// in D3A and never supplies this policy, so production HTTP behavior is
// byte-for-byte unchanged: the no-policy code path below is the exact same
// query and processing D0 shipped.
//
// NO UI/map/presentation concerns here: no copy, no severity colors, no
// routes, no spatial inference. Semantic truth only.
import { withTenant } from '@lasyncro/backend-core/db.js';
import type { Knex } from 'knex';
import {
  getWaitingV1TreatmentForConstraint,
  readCurrentWaitingV1Records,
  type InterventionOutcomeRecord,
  type WaitingV1Treatment,
} from '../decision/interventionOutcome.service.js';

export type OperationalEpisodeV1Lifecycle = 'attention' | 'verifying' | 'just_resolved';

export interface OperationalEpisodeV1Record {
  /** Deterministic identity for THIS episode instance — see buildEpisodeId(). */
  episodeId: string;
  constraintId: string;
  /** Canonical order_constraints.started_at for the CURRENT episode (active or resolved). */
  constraintStartedAt: Date;
  lasyncroOrderId: string;
  constraintType: string;
  blockType: string;
  /** customer/incomplete_address: always null. inventory/oversell: the exact variant id, never inferred. */
  targetId: string | null;
  lifecycle: OperationalEpisodeV1Lifecycle;
  /**
   * verifying:     the matching intervention's occurredAt.
   * attention:     constraintStartedAt.
   * just_resolved: the canonical order_constraints.resolved_at. D3A is a
   *                canonical RESOLUTION projection, not an attribution
   *                claim — HISTORY remains the sole owner of winning-
   *                intervention provenance and causal treatment evidence.
   */
  occurredAt: Date;
  treatment: WaitingV1Treatment;
  /** verifying: the matching intervention's id. attention/just_resolved: always null — a canonical resolution never requires a recorded treatment. */
  interventionId: string | null;
}

/**
 * D3A opt-in policy for deriving just_resolved. Supplying it does NOT
 * choose a product recovery duration on this module's behalf — the caller
 * (an internal, non-HTTP consumer in D3A) supplies both the clock and the
 * window explicitly every time. No default is baked in here.
 */
export interface JustResolvedPolicy {
  /** The caller's own "now" — this module never acquires a clock itself. */
  now: Date;
  /** Recovery window in milliseconds. Must be finite and > 0. */
  windowMs: number;
}

interface ConstraintRow {
  constraint_id: string;
  lasyncro_order_id: string;
  constraint_type: string;
  block_type: string | null;
  target_id: string | null;
  started_at: Date | string | null;
}

interface ConstraintRowWithLifecycleFlags extends ConstraintRow {
  resolved_at: Date | string | null;
  is_active: boolean;
}

const asDate = (value: unknown): Date | null => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * EPISODE IDENTITY.
 *
 * constraint_id alone is not sufficient: orderConstraintProjection reuses
 * the same deterministic constraint_id (uuidv5 of order+type+target) across
 * resolve -> re-raise cycles, updating started_at (and clearing
 * resolved_at) IN PLACE on the same row. Stable episode identity is
 * constraint_id + the canonical started_at for THAT episode, encoded
 * deterministically as a single string — this is true for an active
 * episode and a just_resolved one alike; D3A never mints a separate
 * "resolved" episode identity.
 */
function buildEpisodeId(constraintId: string, startedAt: Date): string {
  return `${constraintId}:${startedAt.toISOString()}`;
}

function sortEpisodes(episodes: OperationalEpisodeV1Record[]): OperationalEpisodeV1Record[] {
  // Deterministic order, independent of DB/Map iteration order.
  return episodes.sort((a, b) => (a.episodeId < b.episodeId ? -1 : a.episodeId > b.episodeId ? 1 : 0));
}

/**
 * Shared V1-eligibility gate for an ACTIVE constraint row: ratified
 * pairing, parseable started_at, and (for inventory/oversell) a usable
 * target_id. Identical logic/telemetry to D0's original single code path —
 * extracted so the no-policy default and the opt-in just_resolved path
 * both run the EXACT same active-row rules, never two approximations.
 */
function buildActiveEpisode(
  row: ConstraintRow,
  waitingByConstraintId: Map<string, InterventionOutcomeRecord>,
  shopId: number
): OperationalEpisodeV1Record | null {
  const treatment = getWaitingV1TreatmentForConstraint(row.constraint_type, row.block_type);
  if (!treatment) return null; // not a ratified V1 pairing — fail closed

  const startedAt = asDate(row.started_at);
  if (!startedAt) {
    console.error('[OPERATIONAL_EPISODE_STARTED_AT_INVALID]', {
      shopId,
      constraintId: row.constraint_id,
    });
    return null; // cannot mint a valid episode identity — fail closed
  }

  if (treatment === 'inventory_reorder_intent' && !row.target_id) {
    console.error('[OPERATIONAL_EPISODE_TARGET_MISSING]', {
      shopId,
      constraintId: row.constraint_id,
    });
    return null; // inventory/oversell without a usable variant target — fail closed
  }

  const waitingMatch = waitingByConstraintId.get(row.constraint_id);

  return {
    episodeId: buildEpisodeId(row.constraint_id, startedAt),
    constraintId: row.constraint_id,
    constraintStartedAt: startedAt,
    lasyncroOrderId: row.lasyncro_order_id,
    constraintType: row.constraint_type,
    blockType: row.block_type as string,
    targetId: row.target_id,
    lifecycle: waitingMatch ? 'verifying' : 'attention',
    occurredAt: waitingMatch ? waitingMatch.occurredAt : startedAt,
    treatment,
    interventionId: waitingMatch ? waitingMatch.interventionId : null,
  };
}

/**
 * D3A — derives just_resolved for one INACTIVE row, or returns null
 * (omitted) when any condition fails to hold. Every boundary is inclusive
 * exactly as specified:
 *   resolved_at valid, started_at valid, resolved_at >= started_at,
 *   resolved_at <= policy.now, policy.now - resolved_at <= policy.windowMs.
 * WAITING is never consulted here — a canonical resolution needs no
 * recorded intervention.
 */
function buildJustResolvedEpisode(
  row: ConstraintRowWithLifecycleFlags,
  policy: JustResolvedPolicy,
  shopId: number
): OperationalEpisodeV1Record | null {
  const treatment = getWaitingV1TreatmentForConstraint(row.constraint_type, row.block_type);
  if (!treatment) return null; // not a ratified V1 pairing — fail closed

  const startedAt = asDate(row.started_at);
  if (!startedAt) {
    console.error('[OPERATIONAL_EPISODE_STARTED_AT_INVALID]', {
      shopId,
      constraintId: row.constraint_id,
    });
    return null;
  }

  if (treatment === 'inventory_reorder_intent' && !row.target_id) {
    console.error('[OPERATIONAL_EPISODE_TARGET_MISSING]', {
      shopId,
      constraintId: row.constraint_id,
    });
    return null; // inventory/oversell without a usable variant target — fail closed
  }

  const resolvedAt = asDate(row.resolved_at);
  if (!resolvedAt) return null; // inactive with no/unparseable resolved_at — omitted

  if (resolvedAt.getTime() < startedAt.getTime()) {
    console.error('[OPERATIONAL_EPISODE_RESOLVED_BEFORE_STARTED]', {
      shopId,
      constraintId: row.constraint_id,
    });
    return null; // impossible chronology — fail closed
  }

  if (resolvedAt.getTime() > policy.now.getTime()) return null; // future resolution — omitted

  const ageMs = policy.now.getTime() - resolvedAt.getTime();
  if (ageMs > policy.windowMs) return null; // outside the supplied recovery window — omitted

  return {
    episodeId: buildEpisodeId(row.constraint_id, startedAt),
    constraintId: row.constraint_id,
    constraintStartedAt: startedAt,
    lasyncroOrderId: row.lasyncro_order_id,
    constraintType: row.constraint_type,
    blockType: row.block_type as string,
    targetId: row.target_id,
    lifecycle: 'just_resolved',
    occurredAt: resolvedAt,
    treatment,
    // D3A is a canonical resolution projection, not an attribution claim —
    // HISTORY remains the owner of winning-intervention provenance.
    interventionId: null,
  };
}

/**
 * Validates a caller-supplied JustResolvedPolicy. A programmer-invalid
 * policy fails explicitly and immediately rather than silently inventing
 * semantics (e.g. treating a NaN window as "no window").
 */
function assertValidJustResolvedPolicy(policy: JustResolvedPolicy): void {
  if (!(policy.now instanceof Date) || Number.isNaN(policy.now.getTime())) {
    throw new Error('[OPERATIONAL_EPISODE_JUST_RESOLVED_POLICY_INVALID] justResolved.now must be a valid Date');
  }
  if (!Number.isFinite(policy.windowMs) || policy.windowMs <= 0) {
    throw new Error(
      '[OPERATIONAL_EPISODE_JUST_RESOLVED_POLICY_INVALID] justResolved.windowMs must be a finite number > 0'
    );
  }
}

/**
 * Reads every CURRENTLY ELIGIBLE, V1-eligible canonical constraint row for
 * a shop and composes it with readCurrentWaitingV1Records() to derive
 * lifecycle. Deliberately NOT `DISTINCT ON` order: one order may carry
 * several simultaneously active constraints (one customer/incomplete_address
 * row plus multiple inventory/oversell rows, one per over-committed variant)
 * and each is its own episode.
 *
 * `input.justResolved` (D3A, OPT-IN ONLY):
 *   ABSENT — byte-for-byte the original D0 behavior: only active eligible
 *     constraints are read; only attention/verifying are ever produced;
 *     resolved constraints are omitted entirely. This is the path
 *     operations.controller.ts (GET /api/v1/operations/episodes) uses —
 *     untouched in D3A, so production behavior does not change.
 *   PRESENT — validated immediately (assertValidJustResolvedPolicy).
 *     Active eligible constraints still produce attention/verifying exactly
 *     as above. An INACTIVE eligible constraint may additionally produce
 *     just_resolved, subject to buildJustResolvedEpisode()'s fail-closed
 *     window/chronology checks. An ACTIVE row that also carries a
 *     resolved_at is canonically incoherent (order_constraints never
 *     legitimately holds both) and is dropped entirely — never projected as
 *     attention/verifying.
 *
 * Fails closed (drops the row, does not throw, does not invent identity)
 * when:
 *   - the constraint_type/block_type pairing is not one of the two ratified
 *     V1 pairings (covers non-V1 and operational constraints);
 *   - started_at cannot be parsed into a valid instant;
 *   - the pairing is inventory/oversell and target_id is null/missing —
 *     this module never infers a variant from order lines, decision
 *     payloads, SKU, or occupancy;
 *   - (justResolved only) resolved_at is missing/unparseable, precedes
 *     started_at, lies in the future relative to policy.now, or falls
 *     outside policy.windowMs;
 *   - (justResolved only) an active row also carries resolved_at.
 *
 * Tenant-safe: order_constraints carries no shop_id column of its own (see
 * its RLS policy, which scopes relationally via orders), so shop_id is
 * enforced both by RLS (withTenant) and by an explicit join predicate here,
 * matching the established pattern in blocker.aggregates.ts.
 *
 * `trx`, when supplied, runs against that already-tenant-scoped transaction
 * instead of opening a second one — same optional-trx shape as
 * readShopInterventionOutcomes()/readCurrentWaitingV1Records().
 */
export async function readCurrentOperationalEpisodesV1(
  input: { shopId: number; justResolved?: JustResolvedPolicy },
  trx?: Knex.Transaction
): Promise<OperationalEpisodeV1Record[]> {
  const { shopId, justResolved } = input;

  if (justResolved) {
    assertValidJustResolvedPolicy(justResolved);
  }

  const run = async (t: Knex.Transaction): Promise<OperationalEpisodeV1Record[]> => {
    // Canonical "merchant already acted; verification pending" truth. Every
    // check it already performs (allowlist, pairing, pending_verification,
    // episode-anchor match, deterministic winner) is trusted as-is, and is
    // NEVER consulted to decide just_resolved eligibility.
    const waitingRecords = await readCurrentWaitingV1Records({ shopId }, t);
    const waitingByConstraintId = new Map(
      waitingRecords
        .filter((record) => record.constraintId !== null)
        .map((record) => [record.constraintId as string, record])
    );

    if (!justResolved) {
      // EXACT D0 query and processing — unchanged.
      const constraintRows: ConstraintRow[] = await t('order_constraints as oc')
        .join('orders as o', 'o.lasyncro_order_id', 'oc.lasyncro_order_id')
        .where({ 'o.shop_id': shopId, 'oc.is_active': true })
        .select(
          'oc.constraint_id',
          'oc.lasyncro_order_id',
          'oc.constraint_type',
          'oc.block_type',
          'oc.target_id',
          'oc.started_at'
        );

      const episodes: OperationalEpisodeV1Record[] = [];
      for (const row of constraintRows) {
        const episode = buildActiveEpisode(row, waitingByConstraintId, shopId);
        if (episode) episodes.push(episode);
      }
      return sortEpisodes(episodes);
    }

    // D3A — widened read: active rows, plus any row currently carrying a
    // resolved_at (inactive, or — the incoherent case — still active).
    const constraintRows: ConstraintRowWithLifecycleFlags[] = await t('order_constraints as oc')
      .join('orders as o', 'o.lasyncro_order_id', 'oc.lasyncro_order_id')
      .where('o.shop_id', shopId)
      .andWhere((qb) => {
        qb.where('oc.is_active', true).orWhereNotNull('oc.resolved_at');
      })
      .select(
        'oc.constraint_id',
        'oc.lasyncro_order_id',
        'oc.constraint_type',
        'oc.block_type',
        'oc.target_id',
        'oc.started_at',
        'oc.resolved_at',
        'oc.is_active'
      );

    const episodes: OperationalEpisodeV1Record[] = [];

    for (const row of constraintRows) {
      if (row.is_active) {
        if (row.resolved_at != null) {
          console.error('[OPERATIONAL_EPISODE_ACTIVE_INCOHERENT]', {
            shopId,
            constraintId: row.constraint_id,
          });
          continue; // active + resolved_at is canonically incoherent — fail closed
        }
        const episode = buildActiveEpisode(row, waitingByConstraintId, shopId);
        if (episode) episodes.push(episode);
        continue;
      }

      const episode = buildJustResolvedEpisode(row, justResolved, shopId);
      if (episode) episodes.push(episode);
    }

    return sortEpisodes(episodes);
  };

  return trx ? run(trx) : withTenant(shopId, run);
}
