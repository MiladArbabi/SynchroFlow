import type { LineItem } from './pages/PickSessionPage.js';
export interface PickReceipt {
  status: 'recorded' | 'unresolved'; operation_identity: string; operation_type?: 'pick' | 'exception';
  pick_batch_id?: string; reservation_allocation_id?: string | null; lasyncro_line_item_id?: string;
  lasyncro_variant_id?: string; location_code?: string | null; operator_id?: number;
  quantity_required?: number; quantity_confirmed?: number; quantity_found?: number;
  lasyncro_unit_ids?: string[]; scan_id?: string | null; inventory_movement_id?: string | null;
  pick_exception_id?: string | null; exception_type?: string | null; device_event_id?: string | null;
}
export interface PickPendingDraft {
  kind: 'pick' | 'exception'; body: Record<string, any>; item: LineItem;
}
export interface PendingPickOperation extends PickPendingDraft {
  version: 1; shopId: number; userId: number; batchId: string; generation: string; requestId: string;
}
const prefix = 'sf:pick-pending:v1:';
const key = (shopId: number, userId: number, batchId: string) => `${prefix}${shopId}:${userId}:${batchId}`;
const storageError = () => Object.assign(new Error('Pick cannot continue until its pending confirmation can be saved or read on this browser.'), { code: 'PICK_PENDING_STORAGE_FAILED' });
export function readPendingPick(shopId: number, userId: number, batchId: string): PendingPickOperation | null {
  try {
    if (!Number.isSafeInteger(shopId) || shopId <= 0 || !Number.isSafeInteger(userId) || userId <= 0 || !batchId) throw storageError();
    const raw = window.localStorage.getItem(key(shopId, userId, batchId));
    if (raw === null) return null;
    const p = JSON.parse(raw) as PendingPickOperation;
    if (p.version !== 1 || p.shopId !== shopId || p.userId !== userId || p.batchId !== batchId
      || !p.generation || !p.requestId || !['pick', 'exception'].includes(p.kind)
      || !p.body || !p.item || !p.body.lasyncro_line_item_id || !p.body.lasyncro_variant_id
      || p.item.lasyncro_line_item_id !== p.body.lasyncro_line_item_id
      || (p.item.reservation_allocation_id ?? null) !== (p.body.reservation_allocation_id ?? null)) throw storageError();
    const b = p.body;
    const ids = b.lasyncro_unit_ids ?? (b.lasyncro_unit_id ? [b.lasyncro_unit_id] : []);
    if (b.pick_claim_generation !== p.generation || b.device_event_id !== p.requestId
      || p.item.lasyncro_variant_id !== b.lasyncro_variant_id || typeof p.item.product_title !== 'string'
      || !Number.isInteger(p.item.quantity) || p.item.quantity <= 0 || !Array.isArray(ids)
      || ids.some((id: unknown) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length
      || (p.kind === 'pick' ? b.quantity_confirmed !== p.item.quantity :
        b.quantity_required !== p.item.quantity || !Number.isInteger(b.quantity_found) || b.quantity_found < 0 || b.quantity_found > p.item.quantity || typeof b.exception_type !== 'string')) throw storageError();
    return p;
  } catch { throw storageError(); }
}
/** Write-ahead safety fence only: never replayed, never an offline queue. */
export function savePendingPick(p: PendingPickOperation): void {
  try {
    const old = readPendingPick(p.shopId, p.userId, p.batchId);
    if (old) throw storageError(); // no new submission may replace unresolved work
    const encoded = JSON.stringify(p);
    window.localStorage.setItem(key(p.shopId, p.userId, p.batchId), encoded);
    if (window.localStorage.getItem(key(p.shopId, p.userId, p.batchId)) !== encoded || !readPendingPick(p.shopId, p.userId, p.batchId)) throw storageError();
  } catch { throw storageError(); }
}
export function clearPendingPick(p: PendingPickOperation): void {
  try {
    const old = readPendingPick(p.shopId, p.userId, p.batchId);
    if (!old || old.requestId !== p.requestId) throw storageError();
    window.localStorage.removeItem(key(p.shopId, p.userId, p.batchId));
    if (window.localStorage.getItem(key(p.shopId, p.userId, p.batchId)) !== null) throw storageError();
  } catch { throw storageError(); }
}
export function pickOutcomeSelector(p: PendingPickOperation): Record<string, string> {
  return { operation_type: p.kind, lasyncro_line_item_id: p.body.lasyncro_line_item_id,
    ...(p.body.reservation_allocation_id ? { reservation_allocation_id: p.body.reservation_allocation_id } : {}),
    ...(p.kind === 'exception' ? { device_event_id: p.requestId } : {}) };
}
export function matchesPickReceipt(p: PickPendingDraft, receipt: PickReceipt, batchId: string, operatorId?: number): boolean {
  const b = p.body;
  const identity = p.kind === 'pick' ? `pick:${batchId}:${b.reservation_allocation_id ?? b.lasyncro_line_item_id}` : `exception:${b.device_event_id}`;
  const ids = b.lasyncro_unit_ids ?? (b.lasyncro_unit_id ? [b.lasyncro_unit_id] : []);
  const actual = receipt.lasyncro_unit_ids;
  return receipt.status === 'recorded' && receipt.operation_identity === identity && receipt.operation_type === p.kind
    && receipt.pick_batch_id === batchId && receipt.lasyncro_line_item_id === b.lasyncro_line_item_id
    && (receipt.reservation_allocation_id ?? null) === (b.reservation_allocation_id ?? null)
    && receipt.lasyncro_variant_id === b.lasyncro_variant_id
    && (receipt.location_code === (b.location_code ?? p.item.location_code) || (!b.reservation_allocation_id && receipt.location_code === null))
    && (operatorId === undefined || receipt.operator_id === operatorId)
    && receipt.quantity_required === p.item.quantity
    && receipt.quantity_confirmed === (p.kind === 'pick' ? b.quantity_confirmed : b.quantity_found)
    && Array.isArray(actual) && new Set(actual).size === actual.length && actual.length === ids.length
    && [...actual].sort().every((v, i) => v === [...ids].sort()[i])
    && (p.kind === 'pick' ? Boolean(receipt.scan_id && receipt.inventory_movement_id) :
      Boolean(receipt.pick_exception_id) && receipt.device_event_id === b.device_event_id && receipt.exception_type === b.exception_type
        && (b.quantity_found === 0 || Boolean(receipt.scan_id && receipt.inventory_movement_id)));
}

export async function withPickPendingLock<T>(shopId: number, userId: number, batchId: string, run: () => Promise<T>): Promise<T> {
  if (!navigator.locks?.request) throw storageError();
  return navigator.locks.request(key(shopId, userId, batchId), { mode: 'exclusive', ifAvailable: true }, async lock => {
    if (!lock) throw storageError();
    return run();
  });
}
