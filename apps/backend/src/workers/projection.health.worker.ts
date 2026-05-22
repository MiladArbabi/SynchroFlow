// apps/backend/src/workers/projection.health.worker.ts

import db, { systemQuery } from '@lasyncro/backend-core/db.js';

/**
 * PROJECTION HEALTH WORKER (C-07)
 * --------------------------------
 * Monitors projection cursor lag and emits structured health signals.
 *
 * Metrics emitted:
 * - lag_events: number of domain events not yet projected
 * - lag_seconds: seconds since last cursor advancement
 * - status: 'healthy' | 'warning' | 'critical' | 'stalled'
 *
 * Thresholds:
 * - warning:  lag_events > 50  OR lag_seconds > 60
 * - critical: lag_events > 200 OR lag_seconds > 300
 * - stalled:  lag_seconds > 900 (15 min — projection is frozen)
 *
 * WHY:
 * - Stalled projection cursor silently freezes the UI
 * - Operators see stale data with no indication of the problem
 * - This worker provides automated detection before support tickets
 *
 * Runs every 30s — low overhead, high observability value.
 */

const POLL_INTERVAL_MS = 30_000;

const THRESHOLDS = {
  WARNING_EVENTS: 50,
  CRITICAL_EVENTS: 200,
  WARNING_SECONDS: 60,
  CRITICAL_SECONDS: 300,
  STALLED_SECONDS: 900,
};

type ProjectionHealth = 'healthy' | 'warning' | 'critical' | 'stalled';

async function checkProjectionHealth(): Promise<void> {
  const cursors = await systemQuery(
    db('projection_cursors').select(
      'projection_name',
      'last_processed_event_id',
      'updated_at'
    )
  );

  if (!cursors || cursors.length === 0) {
    // Silenced in dev — expected after fresh reset, no events yet
    if (process.env.NODE_ENV !== 'development') {
      console.warn('[PROJECTION_HEALTH] No projection cursors found');
    }
    return;
  }

  const latestEventRow = await systemQuery(
    db('domain_events').max('id as latest_id').first()
  );

  const latestEventId = Number(latestEventRow?.latest_id ?? 0);

  for (const cursor of cursors) {
    const lagEvents = latestEventId - Number(cursor.last_processed_event_id ?? 0);

    const lagSeconds = cursor.updated_at
      ? Math.floor(
          (Date.now() - new Date(cursor.updated_at).getTime()) / 1000
        )
      : null;

    let status: ProjectionHealth = 'healthy';

    /**
     * IDLE GUARD
     * ----------
     * lag_seconds only signals a problem when there are unprocessed events.
     * An idle system with lag_events = 0 is healthy — nothing to process.
     */
    if (lagEvents === 0) {
      status = 'healthy';
    } else if (lagSeconds !== null && lagSeconds >= THRESHOLDS.STALLED_SECONDS) {
      status = 'stalled';
    } else if (
      lagEvents >= THRESHOLDS.CRITICAL_EVENTS ||
      (lagSeconds !== null && lagSeconds >= THRESHOLDS.CRITICAL_SECONDS)
    ) {
      status = 'critical';
    } else if (
      lagEvents >= THRESHOLDS.WARNING_EVENTS ||
      (lagSeconds !== null && lagSeconds >= THRESHOLDS.WARNING_SECONDS)
    ) {
      status = 'warning';
    }

    const metric = {
      projection_name: cursor.projection_name,
      last_processed_event_id: cursor.last_processed_event_id,
      latest_event_id: latestEventId,
      lag_events: lagEvents,
      lag_seconds: lagSeconds,
      status,
    };

    if (status === 'stalled') {
      console.error('[PROJECTION_HEALTH_STALLED]', metric);
    } else if (status === 'critical') {
      console.error('[PROJECTION_HEALTH_CRITICAL]', metric);
    } else if (status === 'warning') {
      console.warn('[PROJECTION_HEALTH_WARNING]', metric);
    } else {
      console.info('[PROJECTION_HEALTH_OK]', metric);
    }
  }
}

export async function startProjectionHealthWorker(): Promise<void> {
  console.info('[PROJECTION_HEALTH_WORKER_STARTED]', {
    poll_interval_ms: POLL_INTERVAL_MS,
    thresholds: THRESHOLDS,
  });

  /**
   * Run immediately on startup then poll every 30s.
   */
  await checkProjectionHealth();

  setInterval(async () => {
    try {
      await checkProjectionHealth();
    } catch (err) {
      console.error('[PROJECTION_HEALTH_WORKER_ERROR]', {
        error: (err as Error).message,
      });
    }
  }, POLL_INTERVAL_MS);
}