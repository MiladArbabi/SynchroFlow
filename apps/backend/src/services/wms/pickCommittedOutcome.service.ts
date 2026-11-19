import type { Knex } from 'knex';

export class PickOutcomeReadError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Read committed evidence only. Absence is unresolved, never proof of failure.
 * Full Picks are uniquely identified by the persisted allocation/legacy task;
 * exception operations additionally have their persisted device event identity.
 * No locks or writes: an in-flight transaction is deliberately unresolved.
 */
export async function readPickCommittedOutcome(trx: Knex.Transaction, input: {
  shopId: number; userId: number; batchId: string; query: Record<string, unknown>;
}) {
  const { shopId, userId, batchId, query } = input;
  if (query.operation_type === undefined) return undefined;
  const kind = query.operation_type;
  const allocationId = query.reservation_allocation_id;
  const lineId = query.lasyncro_line_item_id;
  const eventId = query.device_event_id;
  if ((kind !== 'pick' && kind !== 'exception') || typeof lineId !== 'string' || !uuid.test(lineId)
    || (allocationId !== undefined && (typeof allocationId !== 'string' || !uuid.test(allocationId)))
    || (kind === 'exception' && (typeof eventId !== 'string' || !uuid.test(eventId)))) {
    throw new PickOutcomeReadError(400, 'Invalid Pick outcome selector');
  }
  let task: any;
  if (allocationId) {
    task = await trx('pick_reservation_allocations').where({ shop_id: shopId, pick_batch_id: batchId,
      allocation_id: allocationId, lasyncro_line_item_id: lineId }).first('lasyncro_variant_id', 'location_code', 'quantity');
  } else {
    task = await trx('order_line_items as oli').join('pick_batch_orders as pbo', 'pbo.lasyncro_order_id', 'oli.lasyncro_order_id')
      .join('orders as o', 'o.lasyncro_order_id', 'oli.lasyncro_order_id')
      .where({ 'pbo.pick_batch_id': batchId, 'o.shop_id': shopId, 'oli.lasyncro_line_item_id': lineId })
      .first('oli.lasyncro_variant_id', 'oli.quantity');
    // An allocation-backed line must always use its exact allocation.
    if (task && await trx('pick_reservation_allocations').where({ shop_id: shopId, pick_batch_id: batchId, lasyncro_line_item_id: lineId }).first('allocation_id')) task = null;
  }
  if (!task) throw new PickOutcomeReadError(404, 'Pick task not found');
  const operationIdentity = kind === 'pick' ? `pick:${batchId}:${allocationId ?? lineId}` : `exception:${eventId}`;
  const unresolved = { status: 'unresolved' as const, operation_identity: operationIdentity };
  const scans = trx('pick_scan_log').where({ shop_id: shopId, pick_batch_id: batchId, lasyncro_line_item_id: lineId, status: 'confirmed' });
  const exceptions = trx('pick_exceptions').where({ shop_id: shopId, pick_batch_id: batchId, lasyncro_line_item_id: lineId, stage: 'pick' });
  if (allocationId) { scans.where('reservation_allocation_id', allocationId); exceptions.where('reservation_allocation_id', allocationId); }
  else { scans.whereNull('reservation_allocation_id'); exceptions.whereNull('reservation_allocation_id'); }
  const exception = await exceptions.first('*');
  if (kind === 'pick' && exception) return unresolved;
  if (kind === 'exception' && (!exception || exception.device_event_id !== eventId || exception.raised_by !== userId)) return unresolved;
  const scan = await scans.first('*');
  if (kind === 'pick' && (!scan || scan.scanned_by !== userId)) return unresolved;
  const found = kind === 'exception' ? Number(exception.quantity_found) : Number(scan.quantity_confirmed);
  // Found units must have their atomic physical record; a zero-found exception
  // is itself a complete committed result and legitimately has no scan row.
  if (kind === 'exception' && found > 0 && (!scan || scan.scanned_by !== userId || Number(scan.quantity_confirmed) !== found)) return unresolved;
  const ids = scan ? (await trx('pick_scan_unit_lineage').where({ shop_id: shopId, scan_id: scan.scan_id }).orderBy('lasyncro_unit_id').select('lasyncro_unit_id')).map(r => r.lasyncro_unit_id) : [];
  return {
    status: 'recorded' as const, operation_identity: operationIdentity, operation_type: kind,
    pick_batch_id: batchId, reservation_allocation_id: allocationId ?? null, lasyncro_line_item_id: lineId,
    lasyncro_variant_id: task.lasyncro_variant_id, location_code: task.location_code ?? scan?.location_code ?? null,
    operator_id: userId, quantity_required: kind === 'exception' ? Number(exception.quantity_required) : Number(task.quantity),
    quantity_confirmed: found, quantity_found: found, lasyncro_unit_ids: ids,
    scan_id: scan?.scan_id ?? null, inventory_movement_id: scan?.inventory_movement_id ?? null,
    pick_exception_id: kind === 'exception' ? exception.pick_exception_id : null,
    exception_type: kind === 'exception' ? exception.exception_type : null,
    // Full Pick transport event IDs were never persisted. Its operation key
    // above is the existing unique task identity; do not invent a client ID.
    device_event_id: kind === 'exception' ? exception.device_event_id : null,
  };
}
