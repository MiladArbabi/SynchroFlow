import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

/**
 * ============================================================
 * OPERATIONAL PRESSURE CONTRACT (v1)
 * ============================================================
 *
 * This endpoint is the SINGLE SOURCE OF TRUTH for:
 * - Operational pressure series
 * - Future derived signals (severity, trend, acceleration, incidents)
 *
 * GUARANTEES:
 * - Sorted ASC by snapshot_date
 * - Minimum 2 snapshots OR explicit warning
 * - No silent gaps (logged)
 * - Freshness explicitly exposed
 *
 * NON-NEGOTIABLE RULES:
 * - NO frontend-derived logic
 * - NO hidden transformations
 * - ALL intelligence must originate here
 *
 * VIOLATIONS:
 * Any duplication of logic in frontend = system inconsistency
 *
 * ============================================================
 */

/**
 * GET /api/v1/orders/operational-pressure
 * ---------------------------------------
 * Authoritative Operational Pressure contract.
 *
 * Guarantees:
 * - Sorted ASC by snapshot_date
 * - Deterministic series
 * - No inference (yet)
 *
 * NOTE:
 * This is v0 contract (raw series only).
 * Derived metrics (severity, trend, etc.)
 * will be added in controlled iterations.
 */
export const httpGetOperationalPressure = async (
  req: Request,
  res: Response
) => {
  try {
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const rows = await db('orders_operational_control_snapshot')
      .select(
        db.raw("to_char(snapshot_date, 'YYYY-MM-DD') as snapshot_date"),
        'queue_awaiting_inventory',
        'orders_at_sla_risk',
        'revenue_blocked_inventory'
      )
      .where({ shop_id: shopId })
      .orderBy('snapshot_date', 'asc');

    /**
     * Normalize numeric fields
     * -----------------------
     * Postgres returns numeric as string → enforce number
     */
    const normalizedRows = rows.map((r: any) => ({
        ...r,
        revenue_blocked_inventory: Number(r.revenue_blocked_inventory),
    }));

    /**
     * Invariant: ensure strictly ascending order
     * ------------------------------------------
     * Defensive check — DB should guarantee this,
     * but we verify to prevent silent corruption.
     */
    for (let i = 1; i < normalizedRows.length; i++) {
        if (normalizedRows[i].snapshot_date < normalizedRows[i - 1].snapshot_date) {
            console.error('[OPERATIONAL_PRESSURE_ORDER_VIOLATION]', {
                prev: normalizedRows[i - 1].snapshot_date,
                current: normalizedRows[i].snapshot_date,
            });

            return res.status(500).json({
                error: 'SNAPSHOT_ORDER_VIOLATION',
            });
        }
    }

    /**
     * Invariant: detect gaps in daily snapshots
     * ----------------------------------------
     * Ensures continuity of operational signal.
     */
    for (let i = 1; i < normalizedRows.length; i++) {
        const prev = new Date(normalizedRows[i - 1].snapshot_date);
        const curr = new Date(normalizedRows[i].snapshot_date);

    const diffDays =
        (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays > 1) {
        console.warn('[OPERATIONAL_PRESSURE_GAP_DETECTED]', {
            from: normalizedRows[i - 1].snapshot_date,
            to: normalizedRows[i].snapshot_date,
            gapDays: diffDays,
        });
      }
    }

    /**
     * Freshness signal
     * ----------------
     * isStale = no snapshot OR last snapshot older than 24h
     */
    let isStale = true;
    let lastSnapshotDate: string | null = null;

    /**
     * Freshness derived from series (single source of truth)
     */
    if (normalizedRows.length > 0) {
        const latestDate = normalizedRows[normalizedRows.length - 1].snapshot_date;

        lastSnapshotDate = latestDate;

        /**
         * ⚠️ DAY-LEVEL FRESHNESS CHECK
         * ---------------------------
         * Snapshot is DATE (not timestamp).
         * We compare calendar days, not hours.
         */
        const now = new Date();

        const today = now.toISOString().slice(0, 10); // YYYY-MM-DD

      /**
       * SAFE DATE COMPARISON
       * --------------------
       * Avoid string comparison ambiguity.
       * Enforce explicit Date semantics.
       */
      const latest = new Date(latestDate + 'T00:00:00Z');
      const todayDate = new Date(today + 'T00:00:00Z');

      isStale = latest.getTime() < todayDate.getTime();
    }

    /**
     * Invariant: minimum 2 snapshots required
     * --------------------------------------
     * Prevents invalid trend/pressure analysis.
     */
    if (!normalizedRows || normalizedRows.length < 2) {
        return res.status(200).json({
            series: normalizedRows ?? [],
            lastSnapshotDate,
            isStale: true,
            warning: 'INSUFFICIENT_SNAPSHOT_HISTORY',
        });
    }

    /**
     * ⚠️ No transformation, no inference
     * Pure contract surface
     */
    return res.status(200).json({
        series: normalizedRows,
        lastSnapshotDate,
        isStale,
    });

  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';

    return res.status(500).json({
      error: `Failed to fetch operational pressure: ${message}`,
    });
  }
};