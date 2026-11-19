// SF-PICK-UX-ADAPTIVE-01-CROSS-TAB-001 — two tabs of one operator on one batch share
// the durable pending-Pick fence. jsdom tabs share localStorage; another tab's
// `storage` notification is dispatched explicitly (or deliberately withheld).
import React, { useState } from 'react';
import { act, fireEvent, render, within } from '@testing-library/react';
import PickSessionPage, { isUncertainPickOutcome } from '../../../../modules/wms/src/ui/pages/PickSessionPage';
import { readPendingPick, savePendingPick, clearPendingPick, type PendingPickOperation } from '../../../../modules/wms/src/ui/pickPendingRecovery';
jest.mock('@lasyncro/shared/ui', () => ({ ...jest.requireActual('@lasyncro/shared/ui'), IsometricCanvas: () => <div /> }));

const A: any = { lasyncro_line_item_id: 'line-a', lasyncro_variant_id: 'variant-a', lasyncro_order_id: 'order', reservation_allocation_id: 'alloc-a',
  product_title: 'Tracked A', variant_title: null, sku: null, image_url: null, quantity: 1, location_code: 'ROOT', location_scan_required: false, location_pickable: true, unit_scan_required: 1 };
const B: any = { ...A, lasyncro_line_item_id: 'line-b', reservation_allocation_id: 'alloc-b', product_title: 'Product B', location_code: 'BIN-B', location_scan_required: true, unit_scan_required: 0 };
const KEY = 'sf:pick-pending:v1:1:3:batch';
const foreign = (): PendingPickOperation => ({
  version: 1, shopId: 1, userId: 3, batchId: 'batch', generation: 'held-generation', requestId: 'tab-a-event', kind: 'pick', item: A,
  body: { lasyncro_line_item_id: 'line-a', lasyncro_variant_id: 'variant-a', reservation_allocation_id: 'alloc-a', location_code: 'ROOT',
    quantity_confirmed: 1, lasyncro_unit_ids: ['LSU-A'], device_event_id: 'tab-a-event', pick_claim_generation: 'held-generation' },
});
const deferred = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

beforeEach(() => { localStorage.clear(); jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
const notifyOtherTabs = async () => { await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: KEY })); }); };
const probe = async () => { await act(async () => { jest.advanceTimersByTime(5_000); }); };
const scanIn = async (tab: HTMLElement, value: string) => { await act(async () => {
  const input = within(tab).getByRole('textbox'); fireEvent.change(input, { target: { value } }); fireEvent.keyDown(input, { key: 'Enter' });
}); };

/** One browser tab: a PickSessionPage whose host mirrors WmsOperationsPage's write-ahead fence. */
function Tab({ write, read, resolve }: { write: jest.Mock; read: jest.Mock; resolve?: jest.Mock }) {
  const [items, setItems] = useState([A, B]);
  return <PickSessionPage pickBatchId="batch" lineItems={items} resumePicking
    onComplete={jest.fn()} onPickComplete={jest.fn()} onReportException={jest.fn()}
    onVerifyResume={jest.fn().mockResolvedValue(undefined)}
    onResolveBarcode={resolve ?? (async value => ({ lasyncro_variant_id: 'variant-a', resolution_method: 'unit_barcode', lasyncro_unit_id: value }))}
    onConfirmScan={async params => {
      const { recovery_item, ...body } = params;
      const p: PendingPickOperation = { ...foreign(), requestId: params.device_event_id!, item: recovery_item!, body: { ...body, pick_claim_generation: 'held-generation' } };
      savePendingPick(p);
      try { await write(p); } catch (err) { if (!isUncertainPickOutcome(err)) clearPendingPick(p); throw err; }
      clearPendingPick(p);
    }}
    onCheckPendingPick={() => readPendingPick(1, 3, 'batch')}
    onRevalidateSession={async () => { const r = await read(); setItems(r.lineItems); return r; }} />;
}
async function twoTabs(tabA: { write: jest.Mock; read: jest.Mock }, tabB: { write: jest.Mock; read: jest.Mock; resolve?: jest.Mock }) {
  const a = document.body.appendChild(document.createElement('div'));
  const b = document.body.appendChild(document.createElement('div'));
  await act(async () => { render(<Tab {...tabA} />, { container: a }); });
  await act(async () => { render(<Tab {...tabB} />, { container: b }); });
  return { a, b };
}
function expectBlocked(tab: HTMLElement, reason = /waiting for server confirmation in another tab/i) {
  expect(within(tab).getByTestId('pick-other-tab-pending')).toHaveTextContent(reason);
  expect(within(tab).getByRole('textbox')).toBeDisabled();
  expect(within(tab).getByRole('button', { name: /report problem/i })).toBeDisabled();
}

test('two tabs open first: Tab A\'s unresolved Pick blocks Tab B immediately on notification; Tab B cannot pick', async () => {
  const sendA = deferred<void>();
  const tabA = { write: jest.fn(() => sendA.promise), read: jest.fn() };
  const tabB = { write: jest.fn(), read: jest.fn(), resolve: jest.fn() };
  const { a, b } = await twoTabs(tabA, tabB);
  expect(within(b).queryByTestId('pick-other-tab-pending')).toBeNull();
  await scanIn(a, 'LSU-A');                                   // write-ahead saved, request in flight
  expect(readPendingPick(1, 3, 'batch')?.body.lasyncro_unit_ids).toEqual(['LSU-A']);
  await notifyOtherTabs();
  expectBlocked(b);
  expect(within(a).queryByTestId('pick-other-tab-pending')).toBeNull(); // own entry is not foreign
  await scanIn(b, 'LSU-A');
  expect(tabB.resolve).not.toHaveBeenCalled(); expect(tabB.write).not.toHaveBeenCalled();
  await probe(); expectBlocked(b); expect(tabB.read).not.toHaveBeenCalled(); // still pending: no refresh, no resume
  expect(tabA.write).toHaveBeenCalledTimes(1);
});

test('a scan that arrives before the cross-tab notification is refused by the synchronous durable re-check', async () => {
  const tabA = { write: jest.fn(), read: jest.fn() };
  const tabB = { write: jest.fn(), read: jest.fn(), resolve: jest.fn() };
  const { b } = await twoTabs(tabA, tabB);
  localStorage.setItem(KEY, JSON.stringify(foreign()));        // Tab A's write; its `storage` event has not arrived
  await scanIn(b, 'LSU-A');
  expectBlocked(b);
  expect(tabB.resolve).not.toHaveBeenCalled(); expect(tabB.write).not.toHaveBeenCalled();
  expect(readPendingPick(1, 3, 'batch')?.requestId).toBe('tab-a-event'); // the other tab's fence is untouched
});

test('a pending Pick created during Tab B\'s barcode lookup still stops Tab B before transmission', async () => {
  const lookup = deferred<any>();
  const tabA = { write: jest.fn(), read: jest.fn() };
  const tabB = { write: jest.fn(), read: jest.fn(), resolve: jest.fn(() => lookup.promise) };
  const { b } = await twoTabs(tabA, tabB);
  await scanIn(b, 'LSU-B');                                     // lookup awaiting
  localStorage.setItem(KEY, JSON.stringify(foreign()));         // no notification yet
  await act(async () => { lookup.resolve({ lasyncro_variant_id: 'variant-a', resolution_method: 'unit_barcode', lasyncro_unit_id: 'LSU-B' }); });
  expect(tabB.write).not.toHaveBeenCalled();
  expectBlocked(b);
  expect(readPendingPick(1, 3, 'batch')?.requestId).toBe('tab-a-event');
});

test.each([
  // B is the next stop (location step); A is a root item scanned directly, identified by its title.
  ['server-confirmed', () => Promise.resolve(), [B], (tab: HTMLElement) => expect(within(tab).getByTestId('pick-target-location')).toHaveTextContent('BIN-B')],
  ['definitively refused', () => Promise.reject({ response: { status: 409, data: { error: 'Label belongs to another allocation' } } }), [A, B],
    (tab: HTMLElement) => { expect(within(tab).queryByTestId('pick-target-location')).toBeNull(); expect(tab).toHaveTextContent('Tracked A'); }],
] as const)('Tab A\'s Pick %s: both tabs reconcile; Tab B refreshes server state and resumes unfinished work only', async (_label, outcome, serverRemaining, target) => {
  const sendA = deferred<void>();
  const tabA = { write: jest.fn(() => sendA.promise), read: jest.fn() };
  const tabB = { write: jest.fn(), read: jest.fn().mockResolvedValue({ lineItems: serverRemaining }) };
  const { a, b } = await twoTabs(tabA, tabB);
  await scanIn(a, 'LSU-A'); await notifyOtherTabs(); expectBlocked(b);
  await act(async () => { outcome().then(sendA.resolve, sendA.reject); });
  expect(readPendingPick(1, 3, 'batch')).toBeNull();
  expect(tabB.read).not.toHaveBeenCalled();                   // nothing reused before the fresh read
  await notifyOtherTabs();
  expect(tabB.read).toHaveBeenCalledTimes(1);
  expect(within(b).queryByTestId('pick-other-tab-pending')).toBeNull();
  target(b);
  expect(within(b).getByRole('textbox')).toBeEnabled();
  expect(tabA.write).toHaveBeenCalledTimes(1); expect(tabB.write).not.toHaveBeenCalled();
  if (_label === 'server-confirmed') expect(within(a).getByTestId('pick-target-location')).toHaveTextContent('BIN-B');
});

test('a missed notification is covered by the probe; an unanswered refresh keeps Tab B blocked', async () => {
  const lost = Object.assign(new Error('No connection — Picking is paused.'), { code: 'PICK_CONNECTION_LOST' });
  const tabA = { write: jest.fn(), read: jest.fn() };
  const tabB = { write: jest.fn(), read: jest.fn().mockRejectedValueOnce(lost).mockResolvedValue({ lineItems: [B] }) };
  const { b } = await twoTabs(tabA, tabB);
  savePendingPick(foreign()); await notifyOtherTabs(); expectBlocked(b);
  clearPendingPick(foreign());                                  // resolved elsewhere; event missed
  await probe(); expect(tabB.read).toHaveBeenCalledTimes(1); expectBlocked(b);
  await probe(); expect(tabB.read).toHaveBeenCalledTimes(2);
  expect(within(b).getByTestId('pick-target-location')).toHaveTextContent('BIN-B');
  expect(within(b).getByRole('textbox')).toBeEnabled();
});

test('unreadable durable state blocks every tab without reading or writing', async () => {
  const tabA = { write: jest.fn(), read: jest.fn() };
  const tabB = { write: jest.fn(), read: jest.fn(), resolve: jest.fn() };
  const { b } = await twoTabs(tabA, tabB);
  localStorage.setItem(KEY, '{corrupt');
  await scanIn(b, 'LSU-A');
  expectBlocked(b, /could not read the pending Pick confirmation/i);
  await probe(); expectBlocked(b, /could not read/i);
  expect(tabB.resolve).not.toHaveBeenCalled(); expect(tabB.write).not.toHaveBeenCalled(); expect(tabB.read).not.toHaveBeenCalled();
});
