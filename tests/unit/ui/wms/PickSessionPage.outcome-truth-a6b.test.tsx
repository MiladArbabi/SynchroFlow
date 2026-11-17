/**
 * SF-PICK-A6B-OUTCOME-TRUTH-001 — an online Pick scan whose HTTP answer is lost
 * has an UNKNOWN outcome (the server may have committed it). The web Pick
 * session must never call it "not recorded", never invite a re-scan while the
 * outcome is unresolved, keep scanning paused until the server answers, and
 * then report the outcome from the server's authoritative remaining work.
 * A connection loss BEFORE the scan was sent (barcode lookup failed) is a
 * confirmed "nothing recorded".
 */
import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import PickSessionPage, { type LineItem } from '../../../../modules/wms/src/ui/pages/PickSessionPage';
import { useOfflineScanQueue, PickConnectionLostError } from '../../../../modules/wms/src/ui/hooks/useOfflineScanQueue';

jest.mock('@lasyncro/shared/ui', () => {
  const actual = jest.requireActual('@lasyncro/shared/ui');
  return { ...actual, IsometricCanvas: () => <div data-testid="isometric-canvas-stub" /> };
});

const BATCH_ID = 'c4f7be77-0000-4000-8000-0000000a6b01';
function line(id: string, quantity: number, location: string): LineItem {
  return {
    lasyncro_line_item_id: `line-${id}`, lasyncro_variant_id: `variant-${id}`, lasyncro_order_id: 'order-a6b',
    reservation_allocation_id: `alloc-${id}`, sku: `SKU-${id}`, product_title: `Product ${id}`, variant_title: null,
    quantity, location_code: location, image_url: null, unit_ids: null,
  };
}
const A = line('1', 1, 'A-1');
const B = line('2', 1, 'B-2');

/** The real host error for "request sent, no HTTP answer". */
const lostAfterSend = () => new PickConnectionLostError();
/** Barcode lookup failed with no answer (axios shape): the scan was never sent. */
const lookupNetworkError = () => Object.assign(new Error('Network Error'), { isAxiosError: true, request: {}, response: undefined });

const MISLEADING = /not recorded|try again|scan (it |this item )?again|re-?scan/i;

function Host(props: { initial: LineItem[]; onConfirmScan: jest.Mock; revalidate: jest.Mock; resolve?: jest.Mock }) {
  const [items, setItems] = useState(props.initial);
  return (
    <PickSessionPage
      pickBatchId={BATCH_ID}
      lineItems={items}
      onComplete={jest.fn()}
      onResolveBarcode={props.resolve ?? (async (value: string) => {
        const match = items.find((li) => `EAN-${li.lasyncro_variant_id}` === value);
        return { lasyncro_variant_id: match ? match.lasyncro_variant_id : 'variant-other' };
      })}
      onConfirmScan={props.onConfirmScan}
      onReportException={jest.fn().mockResolvedValue({ pick_exception_id: 'x' })}
      onPickComplete={jest.fn().mockResolvedValue(undefined)}
      onStartPacking={jest.fn()}
      onStartPicking={jest.fn().mockResolvedValue(undefined)}
      resumePicking
      floorZones={[]}
      isOnline
      queuedCount={0}
      onRevalidateSession={async () => { const fresh = await props.revalidate(); setItems(fresh); return fresh; }}
    />
  );
}

const locationInput = () => screen.queryByPlaceholderText(/scan bin barcode/i) as HTMLInputElement | null;
const productInput = () => screen.queryByPlaceholderText(/scan product barcode/i) as HTMLInputElement | null;
function scan(input: HTMLInputElement | null, value: string) {
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { value } });
  fireEvent.keyDown(input!, { key: 'Enter', code: 'Enter' });
}
async function reachProduct(li: LineItem) {
  await waitFor(() => expect(locationInput()).not.toBeNull());
  scan(locationInput(), li.location_code);
  await waitFor(() => expect(productInput()).not.toBeNull());
}
const goOnline = () => act(async () => { window.dispatchEvent(new Event('online')); });
const goToHeading = (code: string) => screen.queryByText(`${code}.`);
const pageText = () => document.body.textContent ?? '';

test('A6B-H1 the host error for a sent scan with no answer is truthful: may already be recorded, do not re-scan', () => {
  const err = new PickConnectionLostError();
  expect(err.code).toBe('PICK_CONNECTION_LOST');
  expect(err.message).not.toMatch(/not recorded/i);
  expect(err.message).toMatch(/may already have been recorded/i);
  expect(err.message).toMatch(/do not scan/i);
});

test('A6B-H2 submitScan with no HTTP answer rejects with the truthful connection-lost error', async () => {
  const httpPost = jest.fn().mockRejectedValue(lookupNetworkError());
  (globalThis as any).indexedDB = { open: () => { const r: any = {}; queueMicrotask(() => r.onerror?.()); return r; } };
  const { result } = renderHook(() => useOfflineScanQueue({ httpPost }));
  let caught: any;
  await act(async () => {
    await result.current.submitScan({ deviceEventId: 'e1', url: '/api/v1/wms/pick/scan', body: { pick_batch_id: 'b' } }).catch((e: unknown) => { caught = e; });
  });
  expect(caught).toBeInstanceOf(PickConnectionLostError);
  expect(caught.message).not.toMatch(/not recorded/i);
});

test('A6B-01 lost response after send: paused, never "not recorded", no re-scan instruction, scanner locked, one send', async () => {
  const onConfirmScan = jest.fn().mockRejectedValue(lostAfterSend());
  render(<Host initial={[A, B]} onConfirmScan={onConfirmScan} revalidate={jest.fn().mockRejectedValue(lostAfterSend())} />);
  await reachProduct(A);
  scan(productInput(), 'EAN-variant-1');
  expect(await screen.findByText('Connection lost')).toBeInTheDocument();
  expect(pageText()).not.toMatch(MISLEADING);
  expect(pageText()).toMatch(/may already have been recorded/i);
  expect(pageText()).toMatch(/do not scan/i);
  expect(productInput()).toBeDisabled();
  scan(productInput(), 'EAN-variant-1');                       // a second attempt while unresolved is ignored
  expect(onConfirmScan).toHaveBeenCalledTimes(1);
});

test('A6B-02 reconnect, server recorded it: outcome reported as recorded and the item is not offered again', async () => {
  const onConfirmScan = jest.fn().mockRejectedValueOnce(lostAfterSend()).mockResolvedValue(undefined);
  const revalidate = jest.fn().mockRejectedValueOnce(lostAfterSend()).mockResolvedValueOnce([B]);
  render(<Host initial={[A, B]} onConfirmScan={onConfirmScan} revalidate={revalidate} />);
  await reachProduct(A);
  scan(productInput(), 'EAN-variant-1');
  expect(await screen.findByText('Connection lost')).toBeInTheDocument();
  await goOnline();                                            // still down: stays paused, still truthful
  expect(screen.getByText('Connection lost')).toBeInTheDocument();
  expect(pageText()).not.toMatch(MISLEADING);
  await goOnline();
  await waitFor(() => expect(screen.queryByText('Connection lost')).toBeNull());
  expect(await screen.findByText(/Product 1 was recorded/i)).toBeInTheDocument();
  expect(goToHeading('A-1')).toBeNull();
  expect(goToHeading('B-2')).toBeInTheDocument();
  expect(pageText()).not.toMatch(MISLEADING);
  expect(onConfirmScan).toHaveBeenCalledTimes(1);              // the client never resent it
});

test('A6B-03 reconnect, server did not record it: outcome reported from the server and the item is offered again', async () => {
  const onConfirmScan = jest.fn().mockRejectedValueOnce(lostAfterSend()).mockResolvedValue(undefined);
  const revalidate = jest.fn().mockResolvedValueOnce([A, B]);
  render(<Host initial={[A, B]} onConfirmScan={onConfirmScan} revalidate={revalidate} />);
  await reachProduct(A);
  scan(productInput(), 'EAN-variant-1');
  expect(await screen.findByText('Connection lost')).toBeInTheDocument();
  await goOnline();
  await waitFor(() => expect(screen.queryByText('Connection lost')).toBeNull());
  expect(await screen.findByText(/Product 1 was not recorded — pick it now/i)).toBeInTheDocument();
  await waitFor(() => expect(locationInput()).not.toBeNull()); // fresh location verification first
  expect(goToHeading('A-1')).toBeInTheDocument();
  expect(onConfirmScan).toHaveBeenCalledTimes(1);
});

test('A6B-04 connection lost before send (barcode lookup failed): confirmed nothing recorded, never "may already have been recorded"', async () => {
  const onConfirmScan = jest.fn();
  const resolve = jest.fn().mockRejectedValue(lookupNetworkError());
  render(<Host initial={[A, B]} onConfirmScan={onConfirmScan} revalidate={jest.fn().mockRejectedValue(lostAfterSend())} resolve={resolve} />);
  await reachProduct(A);
  scan(productInput(), 'EAN-variant-1');
  expect(await screen.findByText('Connection lost')).toBeInTheDocument();
  expect(onConfirmScan).not.toHaveBeenCalled();
  expect(pageText()).toMatch(/not sent/i);
  expect(pageText()).not.toMatch(/may already have been recorded/i);
  // (the underlying cause stays visible per certified GH-1241 H1-P1 — not asserted against)
  expect(productInput()).toBeDisabled();
});
