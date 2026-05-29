import { Knex } from 'knex';
import crypto from 'crypto';

function sha256(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function windowSince(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export function generateDisplayToken(shopId: number): { raw: string; hash: string } {
  const raw = `${shopId}_${crypto.randomBytes(32).toString('hex')}`;
  return { raw, hash: sha256(raw) };
}

export async function validateDisplayToken(
  token: string,
  knex: Knex,
): Promise<{ shopId: number; tokenId: string } | null> {
  const underscoreIdx = token.indexOf('_');
  if (underscoreIdx <= 0) return null;
  const shopId = parseInt(token.slice(0, underscoreIdx), 10);
  if (!Number.isFinite(shopId) || shopId <= 0) return null;
  await knex.raw(`SET "app.current_tenant" = '${shopId}'`);
  const row = await knex('shop_display_tokens')
    .where('shop_id', shopId)
    .where('token_hash', sha256(token))
    .whereNull('rotated_at')
    .first('id', 'shop_id');
  if (!row) return null;
  return { shopId: row.shop_id, tokenId: row.id };
}

export async function getLiveCapacity(shopId: number, knex: Knex) {
  return knex.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    const pipelineRows = await trx('order_warehouse_status')
      .groupBy('status')
      .select('status', trx.raw('COUNT(*) as count'));
    const pipeline: Record<string, number> = {};
    for (const row of pipelineRows) pipeline[row.status] = Number(row.count);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const shippedTodayRow = await trx('order_warehouse_status')
      .where('status', 'shipped')
      .where('status_updated_at', '>=', startOfDay)
      .count('* as count')
      .first();

    const settings = await trx('shop_operational_settings')
      .where('shop_id', shopId)
      .first('daily_cpt_local');
    const cptLocal: string | null = settings?.daily_cpt_local ?? null;

    let hoursToCpt: number | null = null;
    if (cptLocal) {
      const [h, m] = cptLocal.split(':').map(Number);
      const now = new Date();
      const cptToday = new Date(now);
      cptToday.setHours(h, m, 0, 0);
      const diffMs = cptToday.getTime() - now.getTime();
      hoursToCpt = diffMs > 0 ? diffMs / 3_600_000 : null;
    }

    const now = new Date();
    const weekday = now.getDay();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const onShiftRows = await trx('operator_schedules')
      .where('shop_id', shopId)
      .where('weekday', weekday)
      .where('start_time', '<=', currentTime)
      .where('end_time', '>=', currentTime)
      .whereNull('effective_to')
      .select('user_id');
    const operatorsOnShift = onShiftRows.length;

    const activePickRows = await trx('pick_batches')
      .where('shop_id', shopId)
      .where('status', 'picking')
      .select('picked_by');
    const activePackRows = await trx('pick_batches')
      .where('shop_id', shopId)
      .where('status', 'packing')
      .select('packed_by');
    const activeOperators = new Set(
      [...activePickRows.map((r: any) => r.picked_by), ...activePackRows.map((r: any) => r.packed_by)].filter(Boolean),
    );

    const sixtyMinsAgo = new Date(Date.now() - 60 * 60 * 1000);
    const liveStats = await trx('pick_scan_log')
      .where('shop_id', shopId)
      .where('scanned_at', '>=', sixtyMinsAgo)
      .where('status', 'confirmed')
      .select(
        trx.raw('SUM(quantity_confirmed) as units'),
        trx.raw('COUNT(DISTINCT scanned_by) as operators'),
      )
      .first() as any;
    const liveUnits = Number(liveStats?.units ?? 0);
    const liveOpCount = Number(liveStats?.operators ?? 0);
    const liveUph = liveOpCount > 0 ? Math.round((liveUnits / liveOpCount) * 10) / 10 : null;

    const thirtyDaysAgo = windowSince(30);
    const stdRow = await trx('pick_batches')
      .where('shop_id', shopId)
      .where('pick_completed_at', '>=', thirtyDaysAgo)
      .whereNotNull('pick_claimed_at')
      .whereNotNull('pick_completed_at')
      .select(
        trx.raw('SUM(units_picked) as total_units'),
        trx.raw(`SUM(EXTRACT(EPOCH FROM (pick_completed_at - pick_claimed_at)) / 3600.0) as total_hours`),
      )
      .first() as any;
    const totalUnits30d = Number(stdRow?.total_units ?? 0);
    const totalHours30d = Number(stdRow?.total_hours ?? 0);
    const standardUph = totalHours30d > 0 ? Math.round((totalUnits30d / totalHours30d) * 10) / 10 : null;

    const unfulfilled =
      (pipeline['awaiting_pick'] ?? 0) +
      (pipeline['picking'] ?? 0) +
      (pipeline['packing'] ?? 0) +
      (pipeline['packed'] ?? 0);

    const avgUnitsRow = await trx('pick_batches')
      .where('shop_id', shopId)
      .where('pick_completed_at', '>=', thirtyDaysAgo)
      .whereNotNull('pick_completed_at')
      .select(trx.raw('AVG(total_units::float / NULLIF(total_line_items, 0)) as avg_units'))
      .first() as any;
    const avgUnitsPerOrder = Math.max(1, Number(avgUnitsRow?.avg_units ?? 1));

    let requiredUph: number | null = null;
    if (hoursToCpt && hoursToCpt > 0 && operatorsOnShift > 0) {
      requiredUph = Math.round(((unfulfilled * avgUnitsPerOrder) / (operatorsOnShift * hoursToCpt)) * 10) / 10;
    }

    let onTrack: 'green' | 'amber' | 'red' | null = null;
    if (liveUph !== null && requiredUph !== null && requiredUph > 0) {
      if (liveUph >= requiredUph) onTrack = 'green';
      else if (liveUph >= requiredUph * 0.9) onTrack = 'amber';
      else onTrack = 'red';
    }

    return {
      pipeline: {
        awaiting_pick: pipeline['awaiting_pick'] ?? 0,
        picking: pipeline['picking'] ?? 0,
        packing: pipeline['packing'] ?? 0,
        ship_ready: pipeline['packed'] ?? 0,
        shipped: pipeline['shipped'] ?? 0,
      },
      operators_on_shift: operatorsOnShift,
      active_operators: activeOperators.size,
      cpt_local: cptLocal,
      hours_to_cpt: hoursToCpt !== null ? Math.round(hoursToCpt * 100) / 100 : null,
      live_uph: liveUph,
      required_uph: requiredUph,
      standard_uph: standardUph,
      on_track: onTrack,
      shipped_today: Number(shippedTodayRow?.count ?? 0),
      unfulfilled_orders: unfulfilled,
    };
  });
}

export async function getOperatorPerformance(shopId: number, windowDays: number, knex: Knex) {
  return knex.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
    const since = windowSince(windowDays);

    const members = await trx('shop_memberships as sm')
      .join('users as u', 'u.id', 'sm.user_id')
      .where('sm.shop_id', shopId)
      .whereNull('sm.revoked_at')
      .select('u.id as user_id', 'u.first_name', 'u.last_name', 'sm.role');

    const [pickStats, packStats, scanStats, excStats, sourceStats] = await Promise.all([
      trx('pick_batches')
        .where('shop_id', shopId)
        .where('pick_completed_at', '>=', since)
        .whereNotNull('picked_by')
        .whereNotNull('pick_claimed_at')
        .whereNotNull('pick_completed_at')
        .groupBy('picked_by')
        .select(
          'picked_by as user_id',
          trx.raw('SUM(units_picked) as units_picked'),
          trx.raw('COUNT(*) as batches_picked'),
          trx.raw(`SUM(EXTRACT(EPOCH FROM (pick_completed_at - pick_claimed_at)) / 3600.0) as pick_hours`),
          trx.raw(`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (pick_completed_at - pick_claimed_at))) as median_batch_seconds`),
        ),
      trx('pack_scan_log')
        .where('shop_id', shopId)
        .where('scanned_at', '>=', since)
        .where('status', 'confirmed')
        .groupBy('scanned_by')
        .select('scanned_by as user_id', trx.raw('SUM(quantity_confirmed) as units_packed')),
      trx('pick_scan_log')
        .where('shop_id', shopId)
        .where('scanned_at', '>=', since)
        .where('status', 'confirmed')
        .groupBy('scanned_by')
        .select('scanned_by as user_id', trx.raw('COUNT(*) as confirmed_scans')),
      trx('pick_exceptions')
        .where('shop_id', shopId)
        .where('raised_at', '>=', since)
        .groupBy('raised_by')
        .select('raised_by as user_id', trx.raw('COUNT(*) as exception_count')),
      trx('inventory_movements')
        .where('shop_id', shopId)
        .where('occurred_at', '>=', since)
        .where('movement_type', 'sale')
        .whereNotNull('operator_id')
        .whereNotNull('scan_source')
        .groupBy('operator_id', 'scan_source')
        .select('operator_id as user_id', 'scan_source', trx.raw('COUNT(*) as count')),
    ]);

    const pickMap = new Map(pickStats.map((r: any) => [r.user_id, r]));
    const scanMap = new Map(scanStats.map((r: any) => [r.user_id, Number(r.confirmed_scans)]));
    const excMap = new Map(excStats.map((r: any) => [r.user_id, Number(r.exception_count)]));
    const sourceMap = new Map<number, Record<string, number>>();
    for (const row of sourceStats) {
      if (!sourceMap.has(row.user_id)) sourceMap.set(row.user_id, {});
      sourceMap.get(row.user_id)![row.scan_source] = Number(row.count);
    }

    const packMap = new Map<number, number>();
    for (const row of packStats) packMap.set(row.user_id, Number(row.units_packed));

    return members
      .map((m: any) => {
        const pick = pickMap.get(m.user_id) as any;
        const confirmed = scanMap.get(m.user_id) ?? 0;
        const exceptions = excMap.get(m.user_id) ?? 0;
        const total = confirmed + exceptions;
        const pickHours = Number(pick?.pick_hours ?? 0);
        const unitsPicked = Number(pick?.units_picked ?? 0);
        return {
          user_id: m.user_id,
          first_name: m.first_name,
          last_name: m.last_name,
          role: m.role,
          picks: unitsPicked,
          packs: packMap.get(m.user_id) ?? 0,
          batches_picked: Number(pick?.batches_picked ?? 0),
          uph: pickHours > 0 ? Math.round((unitsPicked / pickHours) * 10) / 10 : null,
          accuracy_pct: total > 0 ? Math.round((confirmed / total) * 1000) / 10 : null,
          exception_count: exceptions,
          avg_batch_seconds: pick?.median_batch_seconds ? Math.round(Number(pick.median_batch_seconds)) : null,
          scan_source_mix: sourceMap.get(m.user_id) ?? {},
        };
      })
      .filter((op: any) => op.picks > 0 || op.packs > 0 || op.exception_count > 0);
  });
}

export async function getPipelineVelocity(shopId: number, windowDays: number, knex: Knex) {
  return knex.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
    const since = windowSince(windowDays);

    const batchStages = await trx('pick_batches')
      .where('shop_id', shopId)
      .where('released_at', '>=', since)
      .select(
        trx.raw(`AVG(EXTRACT(EPOCH FROM (pick_claimed_at - released_at))) FILTER (WHERE pick_claimed_at IS NOT NULL) as released_to_picking_s`),
        trx.raw(`AVG(EXTRACT(EPOCH FROM (pick_completed_at - pick_claimed_at))) FILTER (WHERE pick_completed_at IS NOT NULL AND pick_claimed_at IS NOT NULL) as picking_s`),
        trx.raw(`AVG(EXTRACT(EPOCH FROM (pack_completed_at - pack_claimed_at))) FILTER (WHERE pack_completed_at IS NOT NULL AND pack_claimed_at IS NOT NULL) as packing_s`),
      )
      .first() as any;

    const shipStage = await trx('order_warehouse_status')
      .whereNotNull('packed_at')
      .whereNotNull('shipped_at')
      .where('status_updated_at', '>=', since)
      .select(trx.raw(`AVG(EXTRACT(EPOCH FROM (shipped_at - packed_at))) as packed_to_shipped_s`))
      .first() as any;

    const receiveRow = await trx.raw(`
      SELECT
        AVG(EXTRACT(EPOCH FROM (im_first.first_sale_at - po.actual_delivery_date::timestamptz)) / 3600.0) as avg_hours,
        COUNT(*) as sample_count
      FROM purchase_orders po
      JOIN purchase_order_line_items poli ON poli.po_id = po.id AND poli.shop_id = po.shop_id
      JOIN (
        SELECT lasyncro_variant_id, MIN(occurred_at) as first_sale_at
        FROM inventory_movements
        WHERE shop_id = :shopId AND movement_type = 'sale' AND occurred_at >= :since
        GROUP BY lasyncro_variant_id
      ) im_first ON im_first.lasyncro_variant_id = poli.lasyncro_variant_id
        AND im_first.first_sale_at > po.actual_delivery_date::timestamptz
      WHERE po.shop_id = :shopId
        AND po.actual_delivery_date IS NOT NULL
        AND po.actual_delivery_date >= (:since::date - interval '30 days')
    `, { shopId, since });

    const returnRow = await trx('return_jobs as rj')
      .join('refund_executions as re', 're.lasyncro_refund_execution_id', 'rj.lasyncro_refund_execution_id')
      .where('rj.shop_id', shopId)
      .whereNotNull('rj.completed_at')
      .where('rj.completed_at', '>=', since)
      .select(trx.raw(`AVG(EXTRACT(EPOCH FROM (rj.completed_at - re.executed_at)) / 3600.0) as avg_hours`))
      .first() as any;

    const r = receiveRow.rows[0];
    return {
      stages: {
        released_to_picking_s: batchStages?.released_to_picking_s ? Math.round(Number(batchStages.released_to_picking_s)) : null,
        picking_s: batchStages?.picking_s ? Math.round(Number(batchStages.picking_s)) : null,
        packing_s: batchStages?.packing_s ? Math.round(Number(batchStages.packing_s)) : null,
        packed_to_shipped_s: shipStage?.packed_to_shipped_s ? Math.round(Number(shipStage.packed_to_shipped_s)) : null,
      },
      latencies: {
        receive_to_pickable_hours: r?.avg_hours ? Math.round(Number(r.avg_hours) * 10) / 10 : null,
        receive_to_pickable_samples: Number(r?.sample_count ?? 0),
        return_to_restock_hours: returnRow?.avg_hours ? Math.round(Number(returnRow.avg_hours) * 10) / 10 : null,
      },
    };
  });
}

export async function getExceptionIntelligence(shopId: number, windowDays: number, knex: Knex) {
  return knex.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
    const since = windowSince(windowDays);

    const topSkus = await trx('pick_exceptions as pe')
      .join('variants as v', 'v.lasyncro_variant_id', 'pe.lasyncro_variant_id')
      .where('pe.shop_id', shopId)
      .where('pe.raised_at', '>=', since)
      .groupBy('pe.lasyncro_variant_id', 'v.title', 'v.sku')
      .select('pe.lasyncro_variant_id', 'v.title', 'v.sku', trx.raw('COUNT(*) as exception_count'))
      .orderBy('exception_count', 'desc')
      .limit(5);

    const topIds = topSkus.map((r: any) => r.lasyncro_variant_id);
    let typeBreakdowns: any[] = [];
    if (topIds.length > 0) {
      typeBreakdowns = await trx('pick_exceptions')
        .where('shop_id', shopId)
        .where('raised_at', '>=', since)
        .whereIn('lasyncro_variant_id', topIds)
        .groupBy('lasyncro_variant_id', 'exception_type')
        .select('lasyncro_variant_id', 'exception_type', trx.raw('COUNT(*) as count'));
    }

    const breakdownMap = new Map<string, Record<string, number>>();
    for (const row of typeBreakdowns) {
      if (!breakdownMap.has(row.lasyncro_variant_id)) breakdownMap.set(row.lasyncro_variant_id, {});
      breakdownMap.get(row.lasyncro_variant_id)![row.exception_type] = Number(row.count);
    }

    const topOperators = await trx('pick_scan_log')
      .where('shop_id', shopId)
      .where('scanned_at', '>=', since)
      .where('status', 'confirmed')
      .groupBy('scanned_by')
      .select('scanned_by as user_id', trx.raw('COUNT(*) as scan_count'))
      .orderBy('scan_count', 'desc')
      .limit(8);

    const operatorIds = topOperators.map((r: any) => r.user_id);
    let heatGrid: any[] = [];

    if (operatorIds.length > 0) {
      const [operatorNames, excGrid, confirmedGrid] = await Promise.all([
        trx('users').whereIn('id', operatorIds).select('id', 'first_name', 'last_name'),
        trx('pick_exceptions')
          .where('shop_id', shopId)
          .where('raised_at', '>=', since)
          .whereIn('raised_by', operatorIds)
          .groupBy('raised_by', 'stage')
          .select('raised_by as user_id', 'stage', trx.raw('COUNT(*) as count')),
        trx('pick_scan_log')
          .where('shop_id', shopId)
          .where('scanned_at', '>=', since)
          .where('status', 'confirmed')
          .whereIn('scanned_by', operatorIds)
          .groupBy('scanned_by')
          .select('scanned_by as user_id', trx.raw('COUNT(*) as confirmed')),
      ]);

      const nameMap = new Map(operatorNames.map((u: any) => [u.id, `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim()]));
      const excStageMap = new Map<string, number>();
      for (const row of excGrid) excStageMap.set(`${row.user_id}_${row.stage}`, Number(row.count));
      const confirmedMap = new Map(confirmedGrid.map((r: any) => [r.user_id, Number(r.confirmed)]));

      heatGrid = operatorIds.map((uid: number) => {
        const pickExc = excStageMap.get(`${uid}_pick`) ?? 0;
        const packExc = excStageMap.get(`${uid}_pack`) ?? 0;
        const confirmed = confirmedMap.get(uid) ?? 0;
        const pickTotal = confirmed + pickExc;
        return {
          user_id: uid,
          name: nameMap.get(uid) ?? 'Unknown',
          pick_exception_rate_pct: pickTotal > 0 ? Math.round((pickExc / pickTotal) * 1000) / 10 : 0,
          pack_exception_rate_pct: (confirmed + packExc) > 0 ? Math.round((packExc / (confirmed + packExc)) * 1000) / 10 : 0,
        };
      });
    }

    return {
      top_skus: topSkus.map((r: any) => ({
        lasyncro_variant_id: r.lasyncro_variant_id,
        title: r.title,
        sku: r.sku,
        exception_count: Number(r.exception_count),
        type_breakdown: breakdownMap.get(r.lasyncro_variant_id) ?? {},
      })),
      heat_grid: heatGrid,
    };
  });
}

export async function getCostStory(shopId: number, windowDays: number, knex: Knex) {
  return knex.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
    const since = windowSince(windowDays);
    const priorSince = windowSince(windowDays * 2);

    const costCheck = await trx('shop_memberships')
      .where('shop_id', shopId)
      .whereNotNull('hourly_cost')
      .whereNull('revoked_at')
      .first('id');

    if (!costCheck) {
      return { unlocked: false, cost_per_order: null, cost_per_unit: null, exception_cost: null, editorial: null };
    }

    const pickCostRow = await trx('pick_batches as pb')
      .join('shop_memberships as sm', 'sm.user_id', 'pb.picked_by')
      .where('pb.shop_id', shopId)
      .where('sm.shop_id', shopId)
      .where('pb.pick_completed_at', '>=', since)
      .whereNotNull('sm.hourly_cost')
      .whereNull('sm.revoked_at')
      .select(
        trx.raw(`SUM(EXTRACT(EPOCH FROM (pb.pick_completed_at - pb.pick_claimed_at)) / 3600.0 * sm.hourly_cost) as cost`),
        trx.raw('SUM(pb.units_picked) as units_picked'),
      )
      .first() as any;

    const packCostRow = await trx('pick_batches as pb')
      .join('shop_memberships as sm', 'sm.user_id', 'pb.packed_by')
      .where('pb.shop_id', shopId)
      .where('sm.shop_id', shopId)
      .where('pb.pack_completed_at', '>=', since)
      .whereNotNull('sm.hourly_cost')
      .whereNull('sm.revoked_at')
      .select(trx.raw(`SUM(EXTRACT(EPOCH FROM (pb.pack_completed_at - pb.pack_claimed_at)) / 3600.0 * sm.hourly_cost) as cost`))
      .first() as any;

    const totalCost = Number(pickCostRow?.cost ?? 0) + Number(packCostRow?.cost ?? 0);
    const totalUnitsPicked = Number(pickCostRow?.units_picked ?? 0);

    const shippedRow = await trx('order_warehouse_status')
      .where('status', 'shipped')
      .where('status_updated_at', '>=', since)
      .count('* as count')
      .first();
    const ordersShipped = Number(shippedRow?.count ?? 0);

    const costPerOrder = ordersShipped > 0 ? Math.round((totalCost / ordersShipped) * 100) / 100 : null;
    const costPerUnit = totalUnitsPicked > 0 ? Math.round((totalCost / totalUnitsPicked) * 100) / 100 : null;

    const priorPickCostRow = await trx('pick_batches as pb')
      .join('shop_memberships as sm', 'sm.user_id', 'pb.picked_by')
      .where('pb.shop_id', shopId)
      .where('sm.shop_id', shopId)
      .where('pb.pick_completed_at', '>=', priorSince)
      .where('pb.pick_completed_at', '<', since)
      .whereNotNull('sm.hourly_cost')
      .whereNull('sm.revoked_at')
      .select(trx.raw(`SUM(EXTRACT(EPOCH FROM (pb.pick_completed_at - pb.pick_claimed_at)) / 3600.0 * sm.hourly_cost) as cost`))
      .first() as any;

    const priorShippedRow = await trx('order_warehouse_status')
      .where('status', 'shipped')
      .where('status_updated_at', '>=', priorSince)
      .where('status_updated_at', '<', since)
      .count('* as count')
      .first();
    const priorOrders = Number(priorShippedRow?.count ?? 0);
    const priorCost = Number(priorPickCostRow?.cost ?? 0);
    const priorCostPerOrder = priorOrders > 0 ? Math.round((priorCost / priorOrders) * 100) / 100 : null;

    const excCountRow = await trx('pick_exceptions')
      .where('shop_id', shopId)
      .where('raised_at', '>=', since)
      .count('* as count')
      .first();
    const exceptions = Number(excCountRow?.count ?? 0);
    const avgCostRow = await trx('shop_memberships')
      .where('shop_id', shopId)
      .whereNotNull('hourly_cost')
      .whereNull('revoked_at')
      .select(trx.raw('AVG(hourly_cost) as avg_cost'))
      .first() as any;
    const avgHourlyCost = Number(avgCostRow?.avg_cost ?? 0);
    const exceptionCost = exceptions > 0 && avgHourlyCost > 0
      ? Math.round(exceptions * (5 / 60) * avgHourlyCost * 100) / 100
      : null;

    let editorial: string | null = null;
    if (costPerOrder !== null && ordersShipped > 0) {
      const trend = priorCostPerOrder !== null
        ? costPerOrder < priorCostPerOrder
          ? `, down from ${priorCostPerOrder} last period`
          : costPerOrder > priorCostPerOrder
            ? `, up from ${priorCostPerOrder} last period`
            : ', unchanged from last period'
        : '';
      editorial = `You shipped ${ordersShipped} orders at ${costPerOrder} cost-per-order${trend}.`;
    }

    return {
      unlocked: true,
      total_cost: Math.round(totalCost * 100) / 100,
      cost_per_order: costPerOrder,
      cost_per_unit: costPerUnit,
      exception_cost: exceptionCost,
      orders_shipped: ordersShipped,
      editorial,
    };
  });
}

export async function getActivityStream(shopId: number, sinceMs: number, knex: Knex) {
  await knex.raw(`SET "app.current_tenant" = '${shopId}'`);
  const since = new Date(sinceMs);
  const pulses = await knex('inventory_movements')
    .where('shop_id', shopId)
    .where('occurred_at', '>=', since)
    .where('movement_type', 'sale')
    .select('location_code', 'lasyncro_variant_id', 'occurred_at')
    .orderBy('occurred_at', 'desc')
    .limit(50);
  return {
    pulses: pulses.map((r: any) => ({
      location_code: r.location_code,
      lasyncro_variant_id: r.lasyncro_variant_id,
      occurred_at: r.occurred_at,
    })),
  };
}