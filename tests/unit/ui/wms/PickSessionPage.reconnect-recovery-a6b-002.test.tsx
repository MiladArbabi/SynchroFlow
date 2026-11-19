/**
 * SF-PICK-A6B-RECONNECT-RECOVERY-002 — a lost scan response does NOT fire the
 * browser's `online` event (the network never went offline), so the paused
 * Pick session must reconcile through its own periodic probe. In the real
 * Operations page the host re-renders far more often than the probe cadence
 * (board polling) and hands the session a fresh onRevalidateSession on every
 * render; the probe must keep its cadence regardless.
 *
 * No `online` event is dispatched anywhere in this file.
 */
import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PickSessionPage, { type LineItem } from '../../../../modules/wms/src/ui/pages/PickSessionPage';
import { PickConnectionLostError } from '../../../../modules/wms/src/ui/hooks/useOfflineScanQueue';

jest.mock('@lasyncro/shared/ui', () => {
  const actual = jest.requireActual('@lasyncro/shared/ui');
  return { ...actual, IsometricCanvas: () => <div data-testid="isometric-canvas-stub" /> };
});

const BATCH_ID = 'c4f7be77-0000-4000-8000-0000000a6b02';
function line(id: string, location: string): LineItem {
  return {
    lasyncro_line_item_id: `line-${id}`, lasyncro_variant_id: `variant-${id}`, lasyncro_order_id: 'order-a6b-002',
    reservation_allocation_id: `alloc-${id}`, sku: `SKU-${id}`, product_title: `Product ${id}`, variant_title: null,
    quantity: 1, location_code: location, image_url: null, unit_ids: null,
  };
}
const A = line('1', 'A-1');
const B = line('2', 'B-2');

const recordedA = { status: 'recorded' as const, operation_identity: `pick:${BATCH_ID}:${A.reservation_allocation_id}`,
  operation_type: 'pick' as const, pick_batch_id: BATCH_ID, reservation_allocation_id: A.reservation_allocation_id,
  lasyncro_line_item_id: A.lasyncro_line_item_id, lasyncro_variant_id: A.lasyncro_variant_id,
  location_code: A.location_code, quantity_required: A.quantity, quantity_confirmed: A.quantity,
  lasyncro_unit_ids: [], scan_id: 'confirmed-scan-a', inventory_movement_id: 'confirmed-removal-a' };

const lostAfterSend = () => new PickConnectionLostError();
/** An answered server failure that is neither a lost connection nor an ownership refusal. */
const answeredServerError = () => Object.assign(new Error('Request failed with status code 500'), {
  isAxiosError: true, request: {}, response: { status: 500, data: { error: 'boom' } },
});
const MISLEADING = /not recorded|try again|scan (it |this item )?again|re-?scan/i;

/** Re-renders every `churnMs` like the board's polling queries, with a FRESH callback identity each render. */
function ChurningHost(props: { onConfirmScan: jest.Mock; revalidate: jest.Mock }) {
  const [items, setItems] = useState([A, B]);
  const [, setTick] = useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(t);
  }, []);
  return (
    <PickSessionPage
      pickBatchId={BATCH_ID}
      lineItems={items}
      onComplete={jest.fn()}
      onResolveBarcode={async (value: string) => {
        const match = items.find((li) => `EAN-${li.lasyncro_variant_id}` === value);
        return { lasyncro_variant_id: match ? match.lasyncro_variant_id : 'variant-other' };
      }}
      onConfirmScan={props.onConfirmScan}
      onReportException={jest.fn().mockResolvedValue({ pick_exception_id: 'x' })}
      onPickComplete={jest.fn().mockResolvedValue(undefined)}
      onStartPacking={jest.fn()}
      onStartPicking={jest.fn().mockResolvedValue(undefined)}
      resumePicking
      floorZones={[]}
      isOnline
      queuedCount={0}
      onRevalidateSession={async () => { const result = await props.revalidate(); setItems(Array.isArray(result) ? result : result.lineItems); return result; }}
    />
  );
}

const locationInput = () => screen.queryByPlaceholderText(/^scan location$/i) as HTMLInputElement | null;
const productInput = () => screen.queryByPlaceholderText(/scan product barcode/i) as HTMLInputElement | null;
function scan(input: HTMLInputElement | null, value: string) {
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { value } });
  fireEvent.keyDown(input!, { key: 'Enter', code: 'Enter' });
}
async function lostResponseOnA(onConfirmScan: jest.Mock, revalidate: jest.Mock) {
  render(<ChurningHost onConfirmScan={onConfirmScan} revalidate={revalidate} />);
  await waitFor(() => expect(locationInput()).not.toBeNull());
  scan(locationInput(), A.location_code);
  await waitFor(() => expect(productInput()).not.toBeNull());
  scan(productInput(), 'EAN-variant-1');
  expect(await screen.findByText('Connection lost')).toBeInTheDocument();
}
/** SF-PICK-LOCATION-TRUTH-01: the current stop is the prominent target code. */
const goToHeading = (code: string) => {
  const el = screen.queryByTestId('pick-target-location');
  return el && el.textContent === code ? el : null;
};
const pageText = () => document.body.textContent ?? '';
const PROBE_WINDOW = { timeout: 9_000 };

test('RR-01 server recorded it: the probe reconciles without an online event despite host re-renders; recorded, next item, scanner unlocked, never resent', async () => {
  const onConfirmScan = jest.fn().mockRejectedValueOnce(lostAfterSend()).mockResolvedValue(undefined);
  const revalidate = jest.fn().mockResolvedValue({ lineItems: [B], outcome: recordedA });
  await lostResponseOnA(onConfirmScan, revalidate);

  await waitFor(() => expect(screen.queryByText('Connection lost')).toBeNull(), PROBE_WINDOW);
  expect(revalidate).toHaveBeenCalled();
  expect(screen.getByText(/Product 1 was recorded/i)).toBeInTheDocument();
  expect(goToHeading('A-1')).toBeNull();
  expect(goToHeading('B-2')).toBeInTheDocument();
  expect(locationInput()).not.toBeNull();
  expect(locationInput()).not.toBeDisabled();
  expect(pageText()).not.toMatch(MISLEADING);
  expect(onConfirmScan).toHaveBeenCalledTimes(1);
}, 15_000);

test('RR-02 a successful stale remaining-work read stays paused: it cannot establish that the original write failed', async () => {
  const onConfirmScan = jest.fn().mockRejectedValueOnce(lostAfterSend()).mockResolvedValue(undefined);
  const revalidate = jest.fn().mockResolvedValue([A, B]);
  await lostResponseOnA(onConfirmScan, revalidate);
  await waitFor(() => expect(revalidate).toHaveBeenCalledTimes(1), PROBE_WINDOW);
  expect(screen.getByText('Connection lost')).toBeInTheDocument();
  expect(productInput()).toBeDisabled();
  expect(pageText()).not.toMatch(/was not recorded|pick it now/i);
  expect(onConfirmScan).toHaveBeenCalledTimes(1);
}, 15_000);

test('RR-03 server answers but cannot confirm: stays locked, says so truthfully, keeps checking, then resolves', async () => {
  const onConfirmScan = jest.fn().mockRejectedValueOnce(lostAfterSend()).mockResolvedValue(undefined);
  const revalidate = jest.fn().mockRejectedValueOnce(answeredServerError()).mockResolvedValue({ lineItems: [B], outcome: recordedA });
  await lostResponseOnA(onConfirmScan, revalidate);

  await waitFor(() => expect(revalidate).toHaveBeenCalledTimes(1), PROBE_WINDOW);
  await waitFor(() => expect(pageText()).toMatch(/could not confirm/i));
  expect(screen.getByText('Connection lost')).toBeInTheDocument();
  expect(productInput()).toBeDisabled();
  expect(pageText()).toMatch(/do not scan/i);
  expect(pageText()).not.toMatch(/Waiting for connection/i);
  expect(pageText()).not.toMatch(MISLEADING);

  await waitFor(() => expect(screen.queryByText('Connection lost')).toBeNull(), PROBE_WINDOW);
  expect(screen.getByText(/Product 1 was recorded/i)).toBeInTheDocument();
  expect(onConfirmScan).toHaveBeenCalledTimes(1);
}, 25_000);
