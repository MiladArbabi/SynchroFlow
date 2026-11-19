import React, { useState } from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import PickSessionPage from '../../../../modules/wms/src/ui/pages/PickSessionPage';
import { readPendingPick, savePendingPick, clearPendingPick, matchesPickReceipt, type PendingPickOperation, type PickReceipt } from '../../../../modules/wms/src/ui/pickPendingRecovery';
import { useOfflineScanQueue } from '../../../../modules/wms/src/ui/hooks/useOfflineScanQueue';
jest.mock('@lasyncro/shared/ui', () => ({ ...jest.requireActual('@lasyncro/shared/ui'), IsometricCanvas: () => <div /> }));
const A: any = { lasyncro_line_item_id: 'line-a', lasyncro_variant_id: 'variant-a', lasyncro_order_id: 'order', reservation_allocation_id: 'alloc-a',
  product_title: 'Tracked A', variant_title: null, sku: null, image_url: null, quantity: 1, location_code: 'ROOT', location_scan_required: false, location_pickable: true, unit_scan_required: 1 };
const B: any = { ...A, lasyncro_line_item_id: 'line-b', reservation_allocation_id: 'alloc-b', product_title: 'Product B', location_code: 'BIN-B', location_scan_required: true, unit_scan_required: 0 };
const failure = { response: { status: 504, data: { error: 'Upstream timeout' } } };
const operation = (kind: 'pick' | 'exception' = 'pick', found = 1): PendingPickOperation => ({
  version: 1, shopId: 1, userId: 3, batchId: 'batch', generation: 'held-generation', requestId: 'original-event', kind, item: A,
  body: { lasyncro_line_item_id: 'line-a', lasyncro_variant_id: 'variant-a', reservation_allocation_id: 'alloc-a', location_code: 'ROOT',
    device_event_id: 'original-event', pick_claim_generation: 'held-generation',
    ...(kind === 'pick' ? { quantity_confirmed: 1 } : { quantity_required: 1, quantity_found: found, exception_type: found ? 'short_pick' : 'item_missing' }),
    ...(found ? { lasyncro_unit_ids: ['LSU-A'] } : {}) },
});
const receipt = (p = operation()): PickReceipt => ({ status: 'recorded', operation_identity: p.kind === 'pick' ? 'pick:batch:alloc-a' : 'exception:original-event',
  operation_type: p.kind, pick_batch_id: 'batch', reservation_allocation_id: 'alloc-a', lasyncro_line_item_id: 'line-a', lasyncro_variant_id: 'variant-a',
  location_code: 'ROOT', operator_id: 3, quantity_required: 1, quantity_confirmed: p.body.quantity_found ?? 1,
  lasyncro_unit_ids: p.body.lasyncro_unit_ids ?? [], scan_id: 'scan', inventory_movement_id: 'movement',
  ...(p.kind === 'exception' ? { pick_exception_id: 'exception', exception_type: p.body.exception_type, device_event_id: 'original-event' } : {}) });
beforeEach(() => { localStorage.clear(); jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
const probe = async () => { await act(async () => { jest.advanceTimersByTime(5_000); }); };
const scan = async (value: string) => { await act(async () => {
  const input = screen.getByRole('textbox'); fireEvent.change(input, { target: { value } }); fireEvent.keyDown(input, { key: 'Enter' });
}); };
function Host({ write, read, restore = false }: { write: jest.Mock; read: jest.Mock; restore?: boolean }) {
  const [items, setItems] = useState([A, B]);
  const pending = restore ? readPendingPick(1, 3, 'batch') : null;
  return <PickSessionPage pickBatchId="batch" lineItems={items} resumePicking pendingOperation={pending}
    onComplete={jest.fn()} onPickComplete={jest.fn()} onReportException={jest.fn()}
    onVerifyResume={jest.fn().mockResolvedValue(undefined)}
    onResolveBarcode={async value => ({ lasyncro_variant_id: 'variant-a', resolution_method: 'unit_barcode', lasyncro_unit_id: value })}
    onConfirmScan={async params => {
      const p = { ...operation(), requestId: params.device_event_id!, body: { ...params, recovery_item: undefined, pick_claim_generation: 'held-generation' } };
      savePendingPick(p); await write(p); clearPendingPick(p);
    }}
    onRecoveryConfirmed={r => { const p = readPendingPick(1, 3, 'batch')!; if (!matchesPickReceipt(p, r, 'batch', 3)) throw new Error('Mismatch'); clearPendingPick(p); }}
    onRevalidateSession={async () => { const r = await read(); setItems(r.lineItems); return r; }} />;
}
function expectPaused() {
  expect(screen.getByRole('textbox')).toBeDisabled();
  expect(screen.getByTestId('scan-product-scanned-lsus')).toHaveTextContent('LSU-A');
  expect(screen.getByRole('button', { name: /report problem/i })).toBeDisabled();
  expect(readPendingPick(1, 3, 'batch')).not.toBeNull();
}
test('late commit: a successful old-allocation read stays locked; positive exact receipt advances with one submission', async () => {
  let committed = false;
  const write = jest.fn().mockRejectedValue(failure);
  const read = jest.fn(async () => ({ lineItems: committed ? [B] : [A, B], outcome: committed ? receipt(readPendingPick(1, 3, 'batch')!) : { status: 'unresolved', operation_identity: 'pick:batch:alloc-a' } }));
  await act(async () => { render(<Host {...{ write, read }} />); }); await scan('LSU-A'); expectPaused();
  await probe(); expectPaused(); expect(read).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).not.toMatch(/was not recorded|pick it now/i);
  committed = true; await probe();
  expect(screen.getByTestId('pick-target-location')).toHaveTextContent('BIN-B');
  expect(screen.getByRole('textbox')).toBeEnabled(); expect(readPendingPick(1, 3, 'batch')).toBeNull();
  expect(write).toHaveBeenCalledTimes(1);
});
test('refresh/remount/resume restores original LSU and generation before any scanner can accept another physical Pick', async () => {
  savePendingPick(operation()); const write = jest.fn();
  const read = jest.fn().mockResolvedValue({ lineItems: [A, B], outcome: { status: 'unresolved', operation_identity: 'pick:batch:alloc-a' } });
  const first = render(<Host {...{ write, read }} restore />); expectPaused(); first.unmount();
  render(<Host {...{ write, read }} restore />); expectPaused(); await probe(); expectPaused();
  expect(readPendingPick(1, 3, 'batch')?.generation).toBe('held-generation'); expect(write).not.toHaveBeenCalled();
});
test('an absent receipt or a mismatched receipt cannot clear uncertainty even if the allocation disappears', async () => {
  savePendingPick(operation()); const write = jest.fn();
  const read = jest.fn().mockResolvedValueOnce({ lineItems: [B] }).mockResolvedValue({ lineItems: [B], outcome: { ...receipt(), lasyncro_unit_ids: ['LSU-SIBLING'] } });
  render(<Host {...{ write, read }} restore />); await probe(); expectPaused(); await probe(); expectPaused(); expect(write).not.toHaveBeenCalled();
});
test.each([0, 1])('exception receipt for found=%s restores and resolves exactly that operation', async found => {
  const p = operation('exception', found); savePendingPick(p);
  const read = jest.fn().mockResolvedValue({ lineItems: [B], outcome: receipt(p) });
  const write = jest.fn(); render(<Host {...{ write, read }} restore />); await probe();
  expect(screen.getByTestId('pick-target-location')).toHaveTextContent('BIN-B'); expect(readPendingPick(1, 3, 'batch')).toBeNull(); expect(write).not.toHaveBeenCalled();
});
test('pending storage is isolated by tenant/user; corrupt or unavailable storage fails closed', () => {
  savePendingPick(operation()); expect(readPendingPick(2, 3, 'batch')).toBeNull(); expect(readPendingPick(1, 4, 'batch')).toBeNull();
  expect(() => savePendingPick({ ...operation(), requestId: 'other-event' })).toThrow();
  const setter = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
  expect(() => savePendingPick({ ...operation(), batchId: 'another' })).toThrow(); setter.mockRestore();
  localStorage.setItem('sf:pick-pending:v1:1:3:batch', '{broken'); expect(() => readPendingPick(1, 3, 'batch')).toThrow();
});

test('exact-outcome online transport never converts ALREADY_RECORDED into an unchecked success', async () => {
  const refused = { response: { status: 409, data: { code: 'PICK_SCAN_ALREADY_RECORDED', recorded_by_requester: true } } };
  const httpPost = jest.fn().mockRejectedValue(refused);
  const { result } = renderHook(() => useOfflineScanQueue({ httpPost }));
  await act(async () => {
    await expect(result.current.submitScan({ deviceEventId: 'event', requireExactOutcome: true, url: '/api/v1/wms/pick/scan', body: {} })).rejects.toBe(refused);
  });
  expect(httpPost).toHaveBeenCalledTimes(1);
});
