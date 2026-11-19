import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import PickSessionPage, { type ConfirmScanParams, type LineItem } from '../../../../modules/wms/src/ui/pages/PickSessionPage';
import { useOfflineScanQueue } from '../../../../modules/wms/src/ui/hooks/useOfflineScanQueue';

jest.mock('@lasyncro/shared/ui', () => ({ ...jest.requireActual('@lasyncro/shared/ui'), IsometricCanvas: () => <div /> }));
const A: LineItem = {
  lasyncro_line_item_id: 'line-a', lasyncro_variant_id: 'variant-a', lasyncro_order_id: 'order',
  reservation_allocation_id: 'allocation-a', sku: 'SKU-A', product_title: 'Tracked A', variant_title: null,
  quantity: 1, location_code: 'WH-1-ROOT', location_pickable: true, location_scan_required: false,
  unit_scan_required: 1, image_url: null, barcode: 'EAN-A', unit_ids: null,
};
const B: LineItem = { ...A, lasyncro_line_item_id: 'line-b', reservation_allocation_id: 'allocation-b',
  lasyncro_variant_id: 'variant-b', product_title: 'Product B', location_code: 'BIN-B',
  location_scan_required: true, unit_scan_required: 0,
};
const recordedA = { status: 'recorded' as const, operation_identity: 'pick:batch:allocation-a', operation_type: 'pick' as const,
  pick_batch_id: 'batch', reservation_allocation_id: A.reservation_allocation_id, lasyncro_line_item_id: A.lasyncro_line_item_id,
  lasyncro_variant_id: A.lasyncro_variant_id, location_code: A.location_code, quantity_required: 1, quantity_confirmed: 1,
  lasyncro_unit_ids: ['LSU-A'], scan_id: 'confirmed-scan', inventory_movement_id: 'confirmed-removal' };
const answered = (status: number, data: Record<string, unknown> = { error: 'Upstream did not confirm the outcome' }) =>
  Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, request: {}, response: { status, data } });
const originalDb = globalThis.indexedDB;
beforeEach(() => {
  jest.useFakeTimers();
  // This test exercises the real online submitScan path. No offline DB is used.
  (globalThis as any).indexedDB = { open: () => {
    const request: any = {}; Promise.resolve().then(() => request.onerror?.()); return request;
  } };
});
afterEach(() => { jest.useRealTimers(); (globalThis as any).indexedDB = originalDb; });

function Host({ httpPost, readSession, onReportException, first = A }: {
  httpPost: jest.Mock; readSession: jest.Mock; onReportException: jest.Mock; first?: LineItem;
}) {
  const [items, setItems] = useState([first, B]);
  const { submitScan } = useOfflineScanQueue({ httpPost });
  return <PickSessionPage
    pickBatchId="batch" lineItems={items} resumePicking floorZones={[]}
    onComplete={jest.fn()} onPickComplete={jest.fn()}
    onResolveBarcode={async value => ({ lasyncro_variant_id: 'variant-a', resolution_method: 'unit_barcode', lasyncro_unit_id: value })}
    onConfirmScan={(params: ConfirmScanParams) => submitScan({ deviceEventId: 'event-a', requireExactOutcome: true, url: '/api/v1/wms/pick/scan', body: { pick_batch_id: 'batch', ...params } })}
    onReportException={onReportException}
    onRevalidateSession={async () => { const result = await readSession(); setItems(Array.isArray(result) ? result : result.lineItems); return result; }}
  />;
}
async function setup(httpPost: jest.Mock, readSession: jest.Mock, first = A) {
  const onReportException = jest.fn().mockResolvedValue({ pick_exception_id: 'exception' });
  await act(async () => { render(<Host {...{ httpPost, readSession, onReportException, first }} />); });
  return { onReportException };
}
async function scan(value: string) {
  await act(async () => {
    const input = screen.getByRole('textbox'); fireEvent.change(input, { target: { value } }); fireEvent.keyDown(input, { key: 'Enter' });
  });
}
async function probe() { await act(async () => { jest.advanceTimersByTime(5_000); }); }
function expectPending(labels = ['LSU-A']) {
  // Scanner (scan step) or quantity field (count step, scanner hidden) — whichever is shown is locked.
  const scanInput = screen.queryByRole('textbox');
  if (scanInput) expect(scanInput).toBeDisabled();
  else expect(screen.getByRole('spinbutton', { name: /quantity picked/i })).toBeDisabled();
  // QUANTITY-CUSTODY-001: no progress counter; the retained labels are the evidence.
  expect(screen.queryByTestId('scan-product-progress')).not.toBeInTheDocument();
  for (const label of labels) expect(screen.getByTestId('scan-product-scanned-lsus')).toHaveTextContent(label);
  expect(screen.getByRole('alert')).toHaveTextContent(/may already have been recorded/i);
  expect(screen.getByRole('button', { name: /report problem/i })).toBeDisabled();
  expect(screen.queryByText('All items')).not.toBeInTheDocument();
}

test.each([502, 504])('server commits, proxy returns %s: preserve identity, probe recorded state, advance without a second Pick', async status => {
  let committed = false;
  const httpPost = jest.fn(async () => { committed = true; throw answered(status); });
  const readSession = jest.fn(async () => committed ? { lineItems: [B], outcome: recordedA } : { lineItems: [A, B] });
  const { onReportException } = await setup(httpPost, readSession);
  await scan('LSU-A');
  expect(committed).toBe(true); expectPending(); expect(readSession).not.toHaveBeenCalled();
  expect(httpPost).toHaveBeenCalledTimes(1);
  await probe(); // proxy failures do not emit the browser online event
  expect(readSession).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('pick-target-location')).toHaveTextContent('BIN-B');
  expect(screen.getByRole('textbox')).toBeEnabled();
  expect(screen.getByText(/Tracked A was recorded/)).toBeInTheDocument();
  expect(httpPost).toHaveBeenCalledTimes(1); expect(onReportException).not.toHaveBeenCalled();
});

test.each([500, 501, 503, 408, 425, 429])('ambiguous HTTP %s with an inconclusive server read stays paused and preserves the label', async status => {
  const httpPost = jest.fn().mockRejectedValue(answered(status));
  const readSession = jest.fn().mockRejectedValue(answered(503));
  const { onReportException } = await setup(httpPost, readSession); await scan('LSU-A');
  expectPending(); await probe(); await probe(); expectPending();
  expect(readSession).toHaveBeenCalledTimes(2); expect(httpPost).toHaveBeenCalledTimes(1);
  expect(onReportException).not.toHaveBeenCalled();
});

test('no HTTP answer stays paused through failed recovery and never resubmits', async () => {
  const httpPost = jest.fn().mockRejectedValue(Object.assign(new Error('Network Error'), { isAxiosError: true, request: {} }));
  const readSession = jest.fn().mockRejectedValue(new Error('Outcome unknown'));
  await setup(httpPost, readSession); await scan('LSU-A'); expectPending(); await probe(); expectPending();
  expect(httpPost).toHaveBeenCalledTimes(1);
});

test('an untyped local/server failure after sending is uncertain', async () => {
  const httpPost = jest.fn().mockRejectedValue(new Error('Response could not be processed'));
  const readSession = jest.fn().mockRejectedValue(new Error('Outcome unknown'));
  await setup(httpPost, readSession); await scan('LSU-A'); expectPending();
});

test('a 409 explicitly marked outcome-uncertain never grants permission to rescan', async () => {
  const httpPost = jest.fn().mockRejectedValue(answered(409, { code: 'PICK_SCAN_OUTCOME_UNCERTAIN', error: 'Pick may already be recorded' }));
  const readSession = jest.fn().mockRejectedValue(answered(503));
  await setup(httpPost, readSession); await scan('LSU-A'); expectPending(); await probe(); expectPending();
  expect(httpPost).toHaveBeenCalledTimes(1);
});

test('definitive identity 409 clears the refused label and permits correction and rescan', async () => {
  const httpPost = jest.fn().mockRejectedValueOnce(answered(409, {
    code: 'PICK_UNIT_IDENTITY_MISMATCH', units_required: 1, error: 'Scan another unit label',
  })).mockResolvedValue(undefined);
  const readSession = jest.fn(); await setup(httpPost, readSession); await scan('LSU-A');
  expect(screen.getByRole('alert')).toHaveTextContent('Scan another unit label');
  expect(screen.queryByTestId('scan-product-scanned-lsus')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox')).toBeEnabled(); await scan('LSU-CORRECTED');
  expect(httpPost).toHaveBeenCalledTimes(2);
  expect(httpPost.mock.calls[1][1]).toMatchObject({ lasyncro_unit_ids: ['LSU-CORRECTED'] });
  expect(screen.getByTestId('pick-target-location')).toHaveTextContent('BIN-B');
  expect(readSession).not.toHaveBeenCalled();
});

test('ALREADY_RECORDED for this requester reconciles the exact receipt, with no physical repick', async () => {
  const httpPost = jest.fn().mockRejectedValue(answered(409, {
    code: 'PICK_SCAN_ALREADY_RECORDED', recorded_by_requester: true, error: 'Already recorded',
  }));
  const readSession = jest.fn().mockResolvedValue({ lineItems: [B], outcome: recordedA });
  await setup(httpPost, readSession); await scan('LSU-A'); expectPending();
  await probe();
  expect(screen.getByTestId('pick-target-location')).toHaveTextContent('BIN-B');
  expect(httpPost).toHaveBeenCalledTimes(1); expect(readSession).toHaveBeenCalledTimes(1);
});

test.each([false, undefined])('ALREADY_RECORDED without requester attribution (%s) requires reconciliation, never rescan', async recordedByRequester => {
  const httpPost = jest.fn().mockRejectedValue(answered(409, {
    code: 'PICK_SCAN_ALREADY_RECORDED', recorded_by_requester: recordedByRequester, error: 'Already recorded',
  }));
  const readSession = jest.fn().mockRejectedValue(answered(503));
  await setup(httpPost, readSession); await scan('LSU-A'); expectPending(); await probe(); expectPending();
  expect(httpPost).toHaveBeenCalledTimes(1);
});

test('quantity Confirm (one LSU + counted 2) receiving 503 retains the identity and remains locked', async () => {
  const httpPost = jest.fn().mockRejectedValue(answered(503));
  const readSession = jest.fn().mockRejectedValue(answered(503));
  await setup(httpPost, readSession, { ...A, quantity: 2, unit_scan_required: 1 });
  await scan('LSU-A');
  expect(httpPost).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /add one unit/i })); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /confirm 2 picked/i })); });
  expectPending(['LSU-A']); await probe(); expectPending(['LSU-A']);
  expect(httpPost).toHaveBeenCalledTimes(1);
  expect(httpPost.mock.calls[0][1]).toMatchObject({ quantity_confirmed: 2, lasyncro_unit_ids: ['LSU-A'] });
});

test('successful quantity-one Pick still advances automatically after its acknowledgement', async () => {
  const httpPost = jest.fn().mockResolvedValue(undefined); const readSession = jest.fn();
  await setup(httpPost, readSession); await scan('LSU-A');
  expect(screen.getByTestId('pick-target-location')).toHaveTextContent('BIN-B');
  expect(httpPost).toHaveBeenCalledTimes(1); expect(readSession).not.toHaveBeenCalled();
});
