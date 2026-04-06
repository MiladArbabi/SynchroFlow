// apps/backend/src/api/system/system.health.controller.ts

import { Request, Response } from 'express';
import db, { systemQuery } from '@lasyncro/backend-core/db.js';

/**
 * GET /api/v1/system/health
 * -------------------------
 * Returns projection cursor lag, snapshot age, and worker status.
 *
 * Purpose:
 * - Support staff can check system health without reading raw logs
 * - UI degraded state banner consumes projection_lag_seconds
 * - Engineering can monitor health during deployments
 *
 * RULES:
 * - Authenticated (requires valid JWT)
 * - No tenant scoping — system-level read
 * - Read-only — no mutations
 * - Graceful degradation — never throws, always returns a shape
 */
export const httpGetSystemHealth = async (
  req: Request,
  res: Response
) => {
  try {

    /**
     * PROJECTION CURSOR LAG
     * ---------------------
     * Compare last processed event against latest domain event.
     * lag_events = how many events haven't been projected yet.
     * lag_seconds = how long since the cursor last advanced.
     */
    const cursors = await systemQuery(
      db('projection_cursors').select(
        'projection_name',
        'last_processed_event_id',
        'updated_at'
      )
    );

    const latestEventRow = await systemQuery(
      db('domain_events').max('id as latest_id').first()
    );

    const latestEventId = Number(latestEventRow?.latest_id ?? 0);

    const projectionHealth = (cursors ?? []).map((cursor: any) => {
      const lagEvents = latestEventId - Number(cursor.last_processed_event_id ?? 0);
      const lagSeconds = cursor.updated_at
        ? Math.floor(
            (Date.now() - new Date(cursor.updated_at).getTime()) / 1000
          )
        : null;

      let status: 'healthy' | 'warning' | 'critical' | 'stalled' = 'healthy';
      /**
       * IDLE GUARD
       * ----------
       * lag_seconds only signals a problem when there are
       * unprocessed events. An idle system with lag_events = 0
       * is healthy regardless of how long since last advancement.
       */
      if (lagEvents === 0) {
        status = 'healthy';
      } else if (lagSeconds !== null && lagSeconds >= 900) {
        status = 'stalled';
      } else if (lagEvents >= 200 || (lagSeconds !== null && lagSeconds >= 300)) {
        status = 'critical';
      } else if (lagEvents >= 50 || (lagSeconds !== null && lagSeconds >= 60)) {
        status = 'warning';
      }

      return {
        projection_name: cursor.projection_name,
        last_processed_event_id: Number(cursor.last_processed_event_id),
        latest_event_id: latestEventId,
        lag_events: lagEvents,
        lag_seconds: lagSeconds,
        status,
      };
    });

    /**
     * SNAPSHOT HEALTH
     * ---------------
     * Age of the most recent operational control snapshot.
     * Sourced from orders_operational_control_snapshot.updated_at.
     */
    const snapshotRow = await systemQuery(
      db('orders_operational_control_snapshot')
        .max('updated_at as last_snapshot_at')
        .first()
    );

    const lastSnapshotAt = snapshotRow?.last_snapshot_at
      ? new Date(snapshotRow.last_snapshot_at).toISOString()
      : null;

    const snapshotLagSeconds = snapshotRow?.last_snapshot_at
      ? Math.floor(
          (Date.now() - new Date(snapshotRow.last_snapshot_at).getTime()) / 1000
        )
      : null;

    /**
     * SNAPSHOT STALENESS — IDLE GUARD
     * --------------------------------
     * If projection is fully caught up (lag_events = 0 on all cursors),
     * snapshot staleness is expected — nothing new to recompute.
     * Only flag stale when there are unprocessed events that should
     * have triggered a snapshot recomputation but didn't.
     */
    const projectionIsIdle = projectionHealth.every(
      (p: any) => p.lag_events === 0
    );

    const snapshotStatus =
      snapshotLagSeconds === null
        ? 'unknown'
        : projectionIsIdle
        ? 'fresh'
        : snapshotLagSeconds >= 300
        ? 'stale'
        : 'fresh';

    /**
     * OVERALL SYSTEM STATUS
     * ---------------------
     * Worst status across all projection cursors + snapshot.
     */
    const allStatuses = [
      ...projectionHealth.map((p: any) => p.status),
      snapshotStatus === 'stale' ? 'warning' : 'healthy',
    ];

    const overallStatus =
      allStatuses.includes('stalled')
        ? 'stalled'
        : allStatuses.includes('critical')
        ? 'critical'
        : allStatuses.includes('warning')
        ? 'warning'
        : 'healthy';

    return res.status(200).json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      projection: projectionHealth,
      snapshot: {
        last_snapshot_at: lastSnapshotAt,
        lag_seconds: snapshotLagSeconds,
        status: snapshotStatus,
      },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[SYSTEM_HEALTH_FETCH_FAILED]', { error: message });

    /**
     * GRACEFUL DEGRADATION
     * --------------------
     * Health endpoint must never crash.
     * Return a degraded response so the UI can still render a banner.
     */
    return res.status(200).json({
      status: 'unknown',
      timestamp: new Date().toISOString(),
      projection: [],
      snapshot: {
        last_snapshot_at: null,
        lag_seconds: null,
        status: 'unknown',
      },
      error: message,
    });
  }
};