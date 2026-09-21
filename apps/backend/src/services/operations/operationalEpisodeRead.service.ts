// apps/backend/src/services/operations/operationalEpisodeRead.service.ts
//
// SLICE D0 — canonical operational-episode read seam.
//
// This module COMPOSES two existing canonical truths — it invents neither:
//
//   order_constraints                = the active canonical problem truth
//   readCurrentWaitingV1Records()     = the canonical "merchant already
//                                        acted; verification pending" truth
//                                        (interventionOutcome.service.ts)
//
// It must never become a second lifecycle/state machine: lifecycle here is
// exactly the two-way split those two truths already answer —
//   matched by readCurrentWaitingV1Records()  -> verifying
//   not matched                                -> attention
// Matching is by constraintId against that function's OWN result only; this
// module never inspects decision_interventions directly, and never repeats
// readCurrentWaitingV1Records()'s own pairing/pending-verification/episode-
// anchor/winner-selection checks.
//
// V1 ONLY: customer/incomplete_address, inventory/oversell — via the single
// pairing authority getWaitingV1TreatmentForConstraint() exported by
// interventionOutcome.service.ts. No other constraint_type/block_type is
// exposed by this seam.
//
// NO UI/map/presentation concerns here: no copy, no severity colors, no
// routes, no spatial inference. Semantic truth only.
import { withTenant } from '@lasyncro/backend-core/db.js';
import type { Knex } from 'knex';
import {
  getWaitingV1TreatmentForConstraint,
  readCurrentWaitingV1Records,
  type WaitingV1Treatment,
} from '../decision/interventionOutcome.service.js';

export type OperationalEpisodeV1Lifecycle = 'attention' | 'verifying';

export interface OperationalEpisodeV1Record {
  /** Deterministic identity for THIS episode instance — see buildEpisodeId(). */
  episodeId: string;
  constraintId: string;
  /** Canonical order_constraints.started_at for the CURRENT active episode. */
  constraintStartedAt: Date;
  lasyncroOrderId: string;
  constraintType: string;
  blockType: string;
  /** customer/incomplete_address: always null. inventory/oversell: the exact variant id, never inferred. */
  targetId: string | null;
  lifecycle: OperationalEpisodeV1Lifecycle;
  /** verifying: the matching intervention's occurredAt. attention: constraintStartedAt. */
  occurredAt: Date;
  treatment: WaitingV1Treatment;
  /** verifying: the matching intervention's id. attention: null. */
  interventionId: string | null;
}

interface ActiveConstraintRow {
  constraint_id: string;
  lasyncro_order_id: string;
  constraint_type: string;
  block_type: string | null;
  target_id: string | null;
  started_at: Date | string | null;
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
 * resolve -> re-raise cycles, updating started_at in place. Stable CURRENT
 * episode identity is constraint_id + the canonical started_at for that
 * active row, encoded deterministically as a single string.
 */
function buildEpisodeId(constraintId: string, startedAt: Date): string {
  return `${constraintId}:${startedAt.toISOString()}`;
}

/**
 * Reads every CURRENTLY ACTIVE, V1-eligible canonical constraint row for a
 * shop and composes it with readCurrentWaitingV1Records() to derive
 * lifecycle. Deliberately NOT `DISTINCT ON` order: one order may carry
 * several simultaneously active constraints (one customer/incomplete_address
 * row plus multiple inventory/oversell rows, one per over-committed variant)
 * and each is its own episode.
 *
 * Fails closed (drops the row, does not throw, does not invent identity)
 * when:
 *   - the constraint_type/block_type pairing is not one of the two ratified
 *     V1 pairings (covers non-V1 and operational constraints);
 *   - started_at cannot be parsed into a valid instant;
 *   - the pairing is inventory/oversell and target_id is null/missing —
 *     this module never infers a variant from order lines, decision
 *     payloads, SKU, or occupancy.
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
  input: { shopId: number },
  trx?: Knex.Transaction
): Promise<OperationalEpisodeV1Record[]> {
  const { shopId } = input;

  const run = async (t: Knex.Transaction): Promise<OperationalEpisodeV1Record[]> => {
    const constraintRows: ActiveConstraintRow[] = await t('order_constraints as oc')
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

    // Canonical "merchant already acted; verification pending" truth. Every
    // check it already performs (allowlist, pairing, pending_verification,
    // episode-anchor match, deterministic winner) is trusted as-is.
    const waitingRecords = await readCurrentWaitingV1Records({ shopId }, t);
    const waitingByConstraintId = new Map(
      waitingRecords
        .filter((record) => record.constraintId !== null)
        .map((record) => [record.constraintId as string, record])
    );

    const episodes: OperationalEpisodeV1Record[] = [];

    for (const row of constraintRows) {
      const treatment = getWaitingV1TreatmentForConstraint(row.constraint_type, row.block_type);
      if (!treatment) continue; // not a ratified V1 pairing — fail closed

      const startedAt = asDate(row.started_at);
      if (!startedAt) {
        console.error('[OPERATIONAL_EPISODE_STARTED_AT_INVALID]', {
          shopId,
          constraintId: row.constraint_id,
        });
        continue; // cannot mint a valid episode identity — fail closed
      }

      if (treatment === 'inventory_reorder_intent' && !row.target_id) {
        console.error('[OPERATIONAL_EPISODE_TARGET_MISSING]', {
          shopId,
          constraintId: row.constraint_id,
        });
        continue; // inventory/oversell without a usable variant target — fail closed
      }

      const waitingMatch = waitingByConstraintId.get(row.constraint_id);

      episodes.push({
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
      });
    }

    // Deterministic order, independent of DB/Map iteration order.
    return episodes.sort((a, b) => (a.episodeId < b.episodeId ? -1 : a.episodeId > b.episodeId ? 1 : 0));
  };

  return trx ? run(trx) : withTenant(shopId, run);
}
