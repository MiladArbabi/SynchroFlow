// apps/backend/src/services/suppliers/supplierRating.service.ts
//
// Supplier Rating Service
// -----------------------
// Recomputes on_time_rate, fill_rate, avg_delivery_days for a supplier.
//
// Called after every receive action:
//   - httpUpdatePoStatus (status → received / partially_received / shipped+date)
//   - httpReceiveShipment (legacy direct-receive path)
//   - closeReceiveJob (WMS receive job close — FEAT-004)
//
// defect_rate is intentionally NOT recomputed here.
// It is sourced from receive_exceptions and recomputed separately
// after closeReceiveJob via recomputeSupplierDefectRate (Issue 004).
//
// avg_delivery_days: mean of (actual - expected) in days across received POs.
//   Negative = early. Positive = late.

import { Knex } from 'knex';

/**
 * Recomputes on_time_rate, fill_rate, and avg_delivery_days for a supplier.
 * Must be called within an active transaction that has SET LOCAL app.current_tenant.
 */
export async function recomputeSupplierRating(
  trx: Knex | Knex.Transaction,
  shopId: number,
  supplierId: number
): Promise<void> {
  const pos = await (trx as any)('purchase_orders as po')
    .leftJoin('purchase_order_line_items as li', function (this: any) {
      this.on('li.po_id', 'po.id').andOn('li.shop_id', (trx as any).raw('?', [shopId]));
    })
    .where({ 'po.supplier_id': supplierId, 'po.shop_id': shopId })
    .whereIn('po.status', ['received', 'partially_received'])
    .groupBy('po.id', 'po.expected_delivery_date', 'po.actual_delivery_date')
    .select(
      'po.id',
      'po.expected_delivery_date',
      'po.actual_delivery_date',
      (trx as any).raw('COALESCE(SUM(li.quantity_ordered), 0) as total_ordered'),
      (trx as any).raw('COALESCE(SUM(li.quantity_received), 0) as total_received')
    );

  if (pos.length === 0) return;

  const onTimeCount = pos.filter((p: any) =>
    p.actual_delivery_date &&
    p.expected_delivery_date &&
    new Date(p.actual_delivery_date) <= new Date(p.expected_delivery_date)
  ).length;

  const totalOrdered = pos.reduce((sum: number, p: any) => sum + Number(p.total_ordered), 0);
  const totalReceived = pos.reduce((sum: number, p: any) => sum + Number(p.total_received), 0);

  const on_time_rate = (onTimeCount / pos.length) * 100;
  const fill_rate = totalOrdered > 0 ? (totalReceived / totalOrdered) * 100 : null;

  const posWithDates = pos.filter((p: any) => p.actual_delivery_date && p.expected_delivery_date);
  const avg_delivery_days =
    posWithDates.length > 0
      ? posWithDates.reduce((sum: number, p: any) => {
          const diff =
            (new Date(p.actual_delivery_date).getTime() -
              new Date(p.expected_delivery_date).getTime()) /
            (1000 * 60 * 60 * 24);
          return sum + diff;
        }, 0) / posWithDates.length
      : null;

  await (trx as any)('suppliers')
    .where({ id: supplierId, shop_id: shopId })
    .update({
      on_time_rate: on_time_rate.toFixed(2),
      fill_rate: fill_rate !== null ? fill_rate.toFixed(2) : null,
      avg_delivery_days: avg_delivery_days !== null ? avg_delivery_days.toFixed(2) : null,
      updated_at: new Date(),
    });
}

/**
 * Recomputes defect_rate for a supplier from receive_exceptions.
 * Called after closeReceiveJob — receive exceptions reflect supplier quality,
 * not fulfilment errors (those live in pick exceptions).
 *
 * defect_rate = (total defective units / total accepted units across received POs) * 100
 * Only counts unresolved 'defect' exceptions — packaging_damage etc. excluded.
 */
export async function recomputeSupplierDefectRate(
  trx: Knex | Knex.Transaction,
  shopId: number,
  supplierId: number
): Promise<void> {
  // Total accepted units across all received POs for this supplier
  const acceptedResult = await (trx as any)('receive_job_lines as rjl')
    .join('receive_jobs as rj', 'rjl.receive_job_id', 'rj.receive_job_id')
    .join('purchase_orders as po', 'rj.po_id', 'po.id')
    .where({ 'po.supplier_id': supplierId, 'po.shop_id': shopId })
    .whereIn('po.status', ['received', 'partially_received'])
    .sum('rjl.quantity_accepted as total_accepted')
    .first();

  const totalAccepted = Number(acceptedResult?.total_accepted ?? 0);
  if (totalAccepted === 0) return;

  // Total defective units from receive_exceptions (defect type only, unresolved)
  const defectResult = await (trx as any)('receive_exceptions as re')
    .join('receive_jobs as rj', 're.receive_job_id', 'rj.receive_job_id')
    .join('purchase_orders as po', 'rj.po_id', 'po.id')
    .where({
      'po.supplier_id': supplierId,
      'po.shop_id': shopId,
      're.exception_type': 'defect',
      're.resolved': false,
    })
    .sum('re.quantity_affected as total_defective')
    .first();

  const totalDefective = Number(defectResult?.total_defective ?? 0);
  const defect_rate = (totalDefective / totalAccepted) * 100;

  await (trx as any)('suppliers')
    .where({ id: supplierId, shop_id: shopId })
    .update({
      defect_rate: defect_rate.toFixed(2),
      updated_at: new Date(),
    });
}