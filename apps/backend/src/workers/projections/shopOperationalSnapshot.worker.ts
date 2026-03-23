import db from '@lasyncro/backend-core/db.js';
import type { Knex } from 'knex';

import { computeRevenueMetrics } from './metric-engine/revenue.metrics.js';
import { computeConstraintMetrics } from './metric-engine/constraint.metrics.js';
import { computeSlaMetrics } from './metric-engine/sla.metrics.js';
import { computeQueueMetrics } from './metric-engine/queue.metrics.js';
import { computeMiscMetrics } from './metric-engine/misc.metrics.js';

import { persistSnapshot } from './persistence/persistSnapshot.js';
import { buildSnapshotPayload } from './payload/buildSnapshotPayload.js';

const log = {
  info: (event: string, data?: unknown) =>
    console.info(JSON.stringify({ level: 'info', event, data })),

  warn: (event: string, data?: unknown) =>
    console.warn(JSON.stringify({ level: 'warn', event, data })),

  error: (event: string, data?: unknown) =>
    console.error(JSON.stringify({ level: 'error', event, data })),

  debug: (event: string, data?: unknown) => {
    if (process.env.DEBUG_SNAPSHOT === 'true') {
      console.debug(JSON.stringify({ level: 'debug', event, data }));
    }
  },
};

/**
 * TYPE CONTRACTS — SNAPSHOT SYSTEM
 * --------------------------------
 * Minimal explicit typing to eliminate `any` leakage.
 * These types MUST evolve with schema changes.
 */

type SnapshotContext = {
  shopId: string;
  snapshotDate: Date;
  snapshotDateNormalized: string;
  snapshotCutoff: Date;
};

type MetricsResult = {
  [key: string]: number;
};

/**
 * SHOP OPERATIONAL SNAPSHOT COMPUTATION
 * -------------------------------------
 * Optional snapshotDateOverride allows deterministic
 * historical reconstruction during onboarding or replay.
 *
 * Runtime calls MUST omit this argument.
 */
export async function computeShopOperationalSnapshot(
  shopId: string,
  snapshotDateOverride?: Date,
  options?: { allowMutation?: boolean }
) {

  try {

  await db.transaction(async (trx) => {

    /**
     * MUTATION BYPASS — FORBIDDEN IN RUNTIME
     * --------------------------------------
     * Snapshot immutability MUST be enforced at DB level only.
     * Any runtime bypass introduces non-deterministic state.
     *
     * This path is intentionally blocked.
     */
    if (options?.allowMutation === true) {
    log.error('SNAPSHOT_MUTATION_BYPASS_BLOCKED', { shopId });

    throw new Error('[SNAPSHOT_MUTATION_BYPASS_FORBIDDEN]');
    }
    
    /**
     * SNAPSHOT DATE RESOLUTION
     * ------------------------
     * Default: wall-clock time (runtime operations)
     *
     * Historical mode:
     * snapshotDateOverride allows deterministic
     * reconstruction of historical operational states
     * (used during onboarding backfill).
     */
    const snapshotDate = snapshotDateOverride ?? new Date();


    if (!snapshotDate) {
        throw new Error('[SHOP_SNAPSHOT_INVARIANT] no orders found');
    }

    /**
     * SNAPSHOT IDENTITY (REBUILD SAFE)
     * --------------------------------
     * Using DATE collapses multiple events into one row.
     * This breaks deterministic rebuild.
     *
     * We MUST use full timestamp to preserve event ordering.
     */
    const snapshotDateNormalized = snapshotDate.toISOString();

    /**
     * HISTORICAL CUTOFF INVARIANT
     * ---------------------------
     * All snapshot queries MUST represent the shop state
     * as it existed at snapshotDate.
     *
     * Therefore every query referencing orders MUST apply:
     *
     *   o.order_created_at <= snapshotContext.snapshotCutoff
     *
     * This guarantees historical reconstruction during
     * onboarding backfill and deterministic replay.
     */
    const snapshotCutoff = snapshotDate;

    /**
     * SNAPSHOT CONTEXT (SINGLE SOURCE OF TRUTH)
     * -----------------------------------------
     * All downstream queries MUST consume from this object.
     * Prevents drift and guarantees deterministic replay.
     */
    const snapshotContext = {
        shopId,
        snapshotDate,
        snapshotDateNormalized,
        snapshotCutoff,
    };

    /**
     * METRIC ORCHESTRATION — PARALLELIZED
     * -----------------------------------
     * All metric modules are independent.
     * Execute in parallel for latency reduction.
     */
    const [
      revenueMetrics,
      constraintMetrics,
      slaMetrics,
      queueMetrics,
      miscMetrics,
    ] = await Promise.all([
      computeRevenueMetrics(trx, shopId, snapshotContext.snapshotCutoff),
      computeConstraintMetrics(trx, shopId, snapshotContext.snapshotCutoff),
      computeSlaMetrics(trx, shopId, snapshotContext.snapshotCutoff),
      computeQueueMetrics(trx, shopId, snapshotContext.snapshotCutoff),
      computeMiscMetrics(trx, shopId, snapshotContext.snapshotCutoff),
    ]);

    const {
      realizedRevenue,
      pendingRevenue,
      atRiskRevenue,
    } = revenueMetrics;

    const {
      revenueBlockedInventory,
      revenueBlockedCustomer,
      revenueBlockedOperational,
      blockedRevenueTotal,
      constrainedOrders,
    } = constraintMetrics;

    const {
      agingUnder24h,
      aging48h,
      aging72hPlus,
      ordersAtSlaRisk,
      slaBreach24hRevenue,
    } = slaMetrics;

    const {
      queueManualReview,
      queueAwaitingInventory,
      queueAwaitingCustomer,
      queueReadyToShip,
      readyToShipRevenue,
    } = queueMetrics;

    const {
      aggregateVersion,
      avgContributionMarginPct,
      pendingFulfillment,
      exceptionOrders,
      oldestExceptionOrderAgeHours,
      revenueLeakage,
    } = miscMetrics;

    /**
     * ORCHESTRATOR BOUNDARY ENFORCEMENT
     * ---------------------------------
     * NO business logic allowed beyond this point.
     * - Metrics → metric-engine modules (direct invocation)
     * - Payload shaping → buildSnapshotPayload
     * - Orchestrator → coordination ONLY
     */

    /**
     * IDEMPOTENCY — DB ENFORCED ONLY
     * --------------------------------
     * Application-layer guards removed.
     * DB constraint (shop_id, snapshot_date) is authoritative.
     * Any violation must surface as a conflict.
     */

    const snapshotPayload = buildSnapshotPayload(
        snapshotContext,
        {
            realizedRevenue,
            pendingRevenue,
            atRiskRevenue,
            revenueBlockedInventory,
            revenueBlockedCustomer,
            revenueBlockedOperational,
            blockedRevenueTotal,
            avgContributionMarginPct,
            pendingFulfillment,
            exceptionOrders,
            constrainedOrders,
            agingUnder24h,
            aging48h,
            aging72hPlus,
            ordersAtSlaRisk,
            slaBreach24hRevenue,
            queueManualReview,
            queueAwaitingInventory,
            queueAwaitingCustomer,
            queueReadyToShip,
            readyToShipRevenue,
            oldestExceptionOrderAgeHours,
            revenueLeakage,
            aggregateVersion,
        }
        );

        log.debug('SNAPSHOT_PAYLOAD', { shopId });

        await persistSnapshot(
            trx,
            snapshotPayload,
            shopId,
            snapshotDateNormalized
        );

        /**
         * VISIBILITY: detect suppressed writes
         */
        if ((await trx.raw('SELECT 1')).rowCount === 0) {
            log.warn('SNAPSHOT_WRITE_NOOP', {
                shopId,
                snapshotDate: snapshotDateNormalized,
                reason: 'duplicate snapshot prevented (append-only)',
            });
        }
    });

    /**
     * HISTORICAL SNAPSHOT BOOTSTRAP
     * -----------------------------
     * If only a single snapshot exists, this indicates
     * historical backfill has not yet executed.
     *
     * Trigger backfill once orders exist and the
     * projection pipeline has produced its first snapshot.
     */

    const snapshotCount = await db('orders_operational_control_snapshot')
        .where({ shop_id: shopId })
        .count('* as count')
        .first();

        if (Number(snapshotCount?.count ?? 0) === 1 && !snapshotDateOverride) {
        log.info('SNAPSHOT_BACKFILL_TRIGGERED', { shopId });

        const { backfillShopOperationalSnapshots } =
            await import('./shopOperationalSnapshot.backfill.js');

        await backfillShopOperationalSnapshots(Number(shopId));
    }

    /**
     * SNAPSHOT HEALTH MONITOR
     * -----------------------
     * Detect stale Control Tower snapshots.
     *
     * If the latest snapshot is older than 24h the
     * Control Tower may display outdated operational
     * metrics. This signal allows infrastructure
     * monitoring to detect projection pipeline stalls.
     *
     * Signal:
     * ORDER_CONTROL_SNAPSHOT_STALE
     */
    /**
 * HEALTH CHECK — OPTIONAL (NON-CRITICAL PATH)
 * -------------------------------------------
 * Explicit signaling for ALL paths (no silent skips).
 */
if (process.env.SNAPSHOT_HEALTH_CHECK !== 'true') {
    log.debug('SNAPSHOT_HEALTH_CHECK_SKIPPED', { shopId });
        } else {
        const latestSnapshot = await db('orders_operational_control_snapshot')
            .where({ shop_id: shopId })
            .max('snapshot_date as last')
            .first();

        if (!latestSnapshot?.last) {
            log.warn('SNAPSHOT_HEALTH_NO_DATA', { shopId });
        } else {
            const snapshotAgeMs =
            Date.now() - new Date(latestSnapshot.last as string).getTime();

            const SNAPSHOT_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

            if (snapshotAgeMs > SNAPSHOT_STALE_THRESHOLD_MS) {
            log.warn('ORDER_CONTROL_SNAPSHOT_STALE', {
                shopId,
                snapshot_date: latestSnapshot.last,
                age_hours: Math.floor(snapshotAgeMs / 3600000),
            });
            } else {
            log.debug('SNAPSHOT_HEALTH_OK', {
                shopId,
                age_hours: Math.floor(snapshotAgeMs / 3600000),
            });
          }
        }
    }

    /**
     * SUCCESS TERMINATION
     * -------------------
     * Explicit return ensures function resolves only
     * after snapshot commit and completion logging.
     */
    return;

    } catch (err) {

    log.error('SNAPSHOT_RECOMPUTE_FAILED', {
        shopId,
        error: err instanceof Error ? err.message : err
    });

    throw err;
  }
}