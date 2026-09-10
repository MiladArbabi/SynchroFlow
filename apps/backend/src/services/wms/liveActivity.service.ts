// apps/backend/src/services/wms/liveActivity.service.ts
//
// LIVE ACTIVITY SERVICE
// ---------------------
// Derives real-time floor state from existing tables — no new writers.
// operator_positions: pickers use physical scans; packers use the active pack zone.
// active_batches: pick_batches in picking/packing status + line progress.
// stow_pressure: pending stow_tasks count anchored to RECEIVE-1.
// Closes WG-11. See overview-live-map-playbook.md §6.
//
// ORD-UX-01: this implementation was extracted VERBATIM out of
// httpGetLiveActivity so two commercially distinct surfaces can read the same
// floor state without either duplicating the query logic or sharing a handler.
//
// CONTRACT-ENT-MOUNT-02 forbids one handler symbol being mounted behind
// divergent entitlement chains — a single function reachable through two
// different commercial gates. The fix is not a second name for the same
// handler; it is this service sitting BELOW two thin, independently gated
// controllers:
//
//     httpGetLiveActivity        (overview.live_map) ─┐
//                                                     ├─ getLiveActivity()
//     httpGetOrdersLiveActivity  (orders.live_map)  ─┘
//
// Both endpoints therefore return an identical payload by construction: there
// is exactly one place that builds it.

import db from '@lasyncro/backend-core/db.js';
import { STOW_TASK_OPEN_STATUSES } from '@lasyncro/shared';

export interface LiveActivityPayload {
  pickerPositions: Array<{
    operator_id: unknown;
    location_code: unknown;
    last_scan_at: unknown;
    batch_activity_at: unknown;
    batch_id: unknown;
  }>;
  activeBatches: Array<{
    batch_id: unknown;
    status: unknown;
    picked_lines: number;
    total_lines: number;
    total_units: number;
    units_packed: number;
  }>;
  stowPressure: {
    pending_count: number;
    anchor_location: string;
    by_location: Array<{
      location_code: string;
      pending_units: number;
      pending_tasks: number;
    }>;
  };
  receiveAtDock: Array<{ location_code: string; units: number }>;
  awaitingPackUnits: number;
  shippedToday: number;
  packedNotShipped: number;
  staleThresholdMinutes: number;
}

/**
 * Reads the tenant's live floor state. Read-only: the transaction exists to
 * scope `app.current_tenant` for RLS across the parallel queries, not to write.
 */
export async function getLiveActivity(shopId: number): Promise<LiveActivityPayload> {
  return db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    const [
      pickerRows,
      packerRows,
      packZoneRow,
      pickZoneRow,
      batchRows,
      stowRow,
      stowByBinRows,
      receiveByBinRows,
      awaitingPackRow,
      wmsSettingsRow,
      outboundRow,
    ] = await Promise.all([
      // Pickers retain physical precision from their latest confirmed bin scan.
      // OV-132: liveness is a property of the BATCH, not of scan recency.
      // The old 4-hour filter on psl.scanned_at made an operator vanish
      // mid-batch whenever a walk between bins outran the window, and no
      // single value can satisfy both "picker crossing a long aisle" and
      // "batch genuinely abandoned". The batch decides presence; the scan
      // only supplies position, unbounded. Staleness is returned to the
      // client as last_scan_at and graded there (amber), never hidden.
      trx('pick_batches as pb')
        .select(
          'pb.picked_by as operator_id',
          'psl.location_code',
          'psl.scanned_at as last_scan_at',
          'pb.pick_batch_id',
          'pb.pick_last_activity_at as batch_activity_at'
        )
        .joinRaw(`
          LEFT JOIN LATERAL (
            SELECT s.location_code, s.scanned_at
            FROM pick_scan_log s
            WHERE s.pick_batch_id = pb.pick_batch_id
              AND s.scanned_by = pb.picked_by
              AND s.status = 'confirmed'
              AND s.location_code IS NOT NULL
            ORDER BY s.scanned_at DESC
            LIMIT 1
          ) psl ON TRUE
        `)
        .where('pb.shop_id', shopId)
        .where('pb.status', 'picking')
        .whereNotNull('pb.picked_by')
        .orderBy('pb.picked_by')
        .orderBy('pb.pick_last_activity_at', 'desc')
        .distinctOn('pb.picked_by'),

      // OV-132: pack_scan_log contributed nothing this query needed. It has no
      // location column (OV-139), so position already came from the pack zone,
      // and identity + recency both live on pick_batches. Joining it only added
      // a failure mode — OV-147 found prod has zero pack scans, so the packer
      // could never render there regardless of the time window. Assignment is
      // the authority; the scan log was a proxy for it.
      //
      // pack_last_activity_at falls back to pick_last_activity_at: a batch in
      // 'packing' has necessarily been picked, so the pick clock is a valid
      // floor when the pack clock was never written (OV-149).
      trx('pick_batches as pb')
        .select(
          trx.raw('COALESCE(pb.packed_by, pb.assigned_packer_id) AS operator_id'),
          'pb.pick_batch_id',
          trx.raw(
            'COALESCE(pb.pack_last_activity_at, pb.pick_last_activity_at) AS batch_activity_at'
          )
        )
        .where('pb.shop_id', shopId)
        .where('pb.status', 'packing')
        .whereRaw('COALESCE(pb.packed_by, pb.assigned_packer_id) IS NOT NULL')
        .orderByRaw(
          'COALESCE(pb.pack_last_activity_at, pb.pick_last_activity_at) DESC'
        ),

      // Pack scans currently have no station field. Anchor phase-level activity to
      // the first active pack zone rather than falsely leaving the packer in picking.
      trx('warehouse_locations as wl')
        .select('wl.location_code')
        .where({
          'wl.shop_id': shopId,
          'wl.zone_type': 'pack',
          'wl.active': true,
        })
        .orderBy('wl.location_code', 'asc')
        .first(),
      // OV-132: a picker whose batch is live but who has not scanned yet has
      // no bin. Same treatment as packers — anchor to the pick zone rather
      // than dropping them from the floor. Presence is the batch's fact.
      trx('warehouse_locations as wl')
        .select('wl.location_code')
        .where({
          'wl.shop_id': shopId,
          'wl.zone_type': 'pick',
          'wl.active': true,
        })
        .orderBy('wl.location_code', 'asc')
        .first(),
      // Active batches with line-level progress.
      trx('pick_batches as pb')
        .select(
          'pb.pick_batch_id',
          'pb.status',
          trx.raw('COALESCE(pb.units_picked, 0) AS picked_lines'),
          'pb.total_line_items',
          'pb.total_units',
          trx.raw('COALESCE(pb.units_packed, 0) AS units_packed')
        )
        .where('pb.shop_id', shopId)
        .whereIn('pb.status', ['picking', 'packing']),

      // WMS-STOWCOUNT-43: open tasks, not pending-only. This scalar answers
      // "how much stow work exists", and a task an operator has claimed is
      // still work on the floor. httpScanResolve already counted both states;
      // this one didn't, so the same concept reported two different numbers.
      // The per-bin aggregate below deliberately stays pending-only — see its
      // own note.
      trx('stow_tasks')
        .where('shop_id', shopId)
        .whereIn('status', STOW_TASK_OPEN_STATUSES as readonly string[])
        .count('stow_task_id as pending_count')
        .first(),

      // OV-129: per-bin pending stow, so the map can badge the bins that
      // actually hold work. The scalar above collapses every task to one
      // number anchored at a hardcoded 'RECEIVE-1' — a location that
      // frequently has no stow tasks at all. Kept alongside it rather than
      // replacing it, since stowPressure is part of the existing contract.
      //
      // WMS-STOWCOUNT-43: deliberately still pending-only, unlike the scalar
      // above. This badges what is physically waiting AT a bin; a claimed task
      // is mid-move and counting it here would badge a bin for stock that may
      // already have left it. Divergence is intentional, not an oversight.
      trx('stow_tasks')
        .where('shop_id', shopId)
        .where('status', 'pending')
        .whereNotNull('location_code')
        .groupBy('location_code')
        .select('location_code')
        .sum('quantity as pending_units')
        .count('stow_task_id as pending_tasks'),

      // OV-131: units physically sitting at a dock, keyed by their actual
      // recorded location. Deliberately NOT derived from receive_jobs —
      // that table has no location column at all, and its total_units is an
      // EXPECTED quantity from the PO, not an observation. The map reports
      // physical truth; job-level progress lives in the Warehouse module.
      trx('inventory_units')
        .where('shop_id', shopId)
        .where('status', 'received')
        .whereNotNull('current_location_code')
        .groupBy('current_location_code')
        .select('current_location_code as location_code')
        .count('lasyncro_unit_id as units'),

      trx('pick_batches')
        .where('shop_id', shopId)
        .where('status', 'pick_complete')
        .sum('total_units as total')
        .first(),
      // OV-132: staleness threshold, shared with the idle alert.
      trx('shop_wms_settings')
        .where('shop_id', shopId)
        .select('idle_alert_threshold_minutes')
        .first(),
      /**
       * OV-157: outbound apron. Playbook §5 reserved 'Shipped today' in the
       * layout from the start; §208 recorded that packed-not-shipped lived in
       * order_warehouse_status but was never exposed. Both ship here.
       *
       * order_warehouse_status has NO shop_id column — tenancy joins through
       * orders. Every other query here filters shopId directly; this one
       * cannot, and a missing join would leak across tenants.
       *
       * shipped_at is monotonic (migration 0088 trigger), so a row that
       * reports shipped today cannot silently revert.
       */
      trx('order_warehouse_status as ows')
        .join('orders as o', 'o.lasyncro_order_id', 'ows.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .select(
          trx.raw(
            "COUNT(*) FILTER (WHERE ows.shipped_at::date = CURRENT_DATE) AS shipped_today"
          ),
          trx.raw(
            "COUNT(*) FILTER (WHERE ows.packed_at IS NOT NULL AND ows.shipped_at IS NULL) AS packed_not_shipped"
          )
        )
        .first(),
    ]);

    // OV-132: presence comes from the batch; position and freshness are
    // reported separately so the client can grade staleness instead of the
    // server hiding it. last_scan_at is null for packers by design — pack
    // scans carry no location (OV-139), so there is no bin to be stale about.
    const pickerPositionRows = pickerRows
      .map(r => ({
        operator_id: String(r.operator_id),
        location_code: (r.location_code ?? pickZoneRow?.location_code) as
          | string
          | undefined,
        last_scan_at: r.last_scan_at ?? null,
        batch_activity_at: r.batch_activity_at,
        batch_id: r.pick_batch_id,
      }))
      .filter(r => Boolean(r.location_code));

    const packerPositionRows = packZoneRow?.location_code
      ? packerRows.map(r => ({
          operator_id: String(r.operator_id),
          location_code: packZoneRow.location_code as string,
          last_scan_at: null,
          batch_activity_at: r.batch_activity_at,
          batch_id: r.pick_batch_id,
        }))
      : [];

    // The packer query dropped DISTINCT ON — Postgres requires its expressions
    // to lead ORDER BY, and a COALESCE there is fragile in knex. Both queries
    // already order most-recent-first, so keeping the first row per operator
    // is equivalent. Pickers precede packers: an operator holding both roles
    // on different batches belongs at their physical bin, not the pack zone.
    const seenOperators = new Set<string>();
    const operatorPositions = [
      ...pickerPositionRows,
      ...packerPositionRows,
    ].filter(r => {
      if (seenOperators.has(r.operator_id)) return false;
      seenOperators.add(r.operator_id);
      return true;
    });

    return {
    // OV-142: field name retained for compatibility — it carries packers too.
    // OV-132: each entry now reports last_scan_at (null for packers, and for
    // pickers who have not scanned yet) alongside batch_activity_at, which is
    // never null on a live batch. The client grades freshness from these; the
    // server no longer withholds a marker for being stale.
    pickerPositions: operatorPositions,
    activeBatches: batchRows.map(r => ({
        batch_id: r.pick_batch_id,
        status: r.status,
        picked_lines: Number(r.picked_lines),
        total_lines: Number(r.total_line_items),
        total_units: Number(r.total_units),
        units_packed: Number(r.units_packed),
      })),
      stowPressure: {
        pending_count: Number(stowRow?.pending_count ?? 0),
        anchor_location: 'RECEIVE-1',
        by_location: stowByBinRows.map(r => ({
          location_code: r.location_code as string,
          pending_units: Number(r.pending_units),
          pending_tasks: Number(r.pending_tasks),
        })),
      },
      receiveAtDock: receiveByBinRows.map(r => ({
        location_code: r.location_code as string,
        units: Number(r.units),
      })),
      awaitingPackUnits: Number(awaitingPackRow?.total ?? 0),
      // OV-157: outbound apron counts. shippedToday is the only completion
      // signal on the Overview — every other number is a problem. packedNotShipped
      // is the urgent sub-stack: staged but not collected by the carrier.
      shippedToday: Number(outboundRow?.shipped_today ?? 0),
      packedNotShipped: Number(outboundRow?.packed_not_shipped ?? 0),
      // OV-132: the client grades marker staleness against this. Sourced from
      // shop_wms_settings so one tenant-configurable definition drives both the
      // idle alert and the map. idleAlert.service.ts bails when the row is
      // missing (:52) — the map cannot, since that would mean nothing is ever
      // stale, so it falls back to 15 minutes.
      staleThresholdMinutes: Number(
        wmsSettingsRow?.idle_alert_threshold_minutes ?? 15
      ),
    };
  });
}
