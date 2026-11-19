/**
 * SF-PICK-ASSIGN-01 C008 — online-only web Pick (PickSessionPage).
 *
 * A scan is confirmed only when onConfirmScan resolves (the host resolves only
 * on the server's acceptance). A PICK_CONNECTION_LOST rejection pauses Picking
 * on the same step; recovery is automatic (online event / retry), goes through
 * onRevalidateSession (ownership + authoritative remaining work), and resumes
 * at a fresh location scan. Ownership loss during the outage is shown as
 * "Batch reassigned".
 */
import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PickSessionPage, {
  type LineItem,
} from '../../../../modules/wms/src/ui/pages/PickSessionPage';

jest.mock('@lasyncro/shared/ui', () => {
  const actual = jest.requireActual('@lasyncro/shared/ui');
  return { ...actual, IsometricCanvas: () => <div data-testid="isometric-canvas-stub" /> };
});

const BATCH_ID = 'c4f7be77-0000-4000-8000-00000000c008';

function line(id: string, quantity: number, location: string): LineItem {
  return {
    lasyncro_line_item_id: `line-${id}`,
    lasyncro_variant_id: `variant-${id}`,
    lasyncro_order_id: 'order-c008',
    reservation_allocation_id: `alloc-${id}`,
    sku: `SKU-${id}`,
    product_title: `Product ${id}`,
    variant_title: null,
    quantity,
    location_code: location,
    image_url: null,
    unit_ids: null,
  };
}

const A = line('1', 1, 'A-1');
const B = line('2', 1, 'B-2');

const recordedA = { status: 'recorded' as const, operation_identity: `pick:${BATCH_ID}:${A.reservation_allocation_id}`,
  operation_type: 'pick' as const, pick_batch_id: BATCH_ID, reservation_allocation_id: A.reservation_allocation_id,
  lasyncro_line_item_id: A.lasyncro_line_item_id, lasyncro_variant_id: A.lasyncro_variant_id,
  location_code: A.location_code, quantity_required: A.quantity, quantity_confirmed: A.quantity,
  lasyncro_unit_ids: [], scan_id: 'confirmed-scan-a', inventory_movement_id: 'confirmed-removal-a' };
const MULTI = line('3', 2, 'C-3');

/** Host contract (useOfflineScanQueue.submitScan / revalidation): no HTTP answer → code PICK_CONNECTION_LOST. */
const lost = () => Object.assign(new Error('No connection — this scan was not recorded.'), { code: 'PICK_CONNECTION_LOST' });
const lostErr = lost;

/** Host double: owns lineItems like WmsModuleFT2 and refreshes them on revalidation. */
function Host(props: {
  initial: LineItem[];
  onConfirmScan: jest.Mock;
  revalidate: jest.Mock;
}) {
  const [items, setItems] = useState(props.initial);
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
      {...({
        onRevalidateSession: async () => {
          const result = await props.revalidate();
          setItems(Array.isArray(result) ? result : result.lineItems);
          return result;
        },
      } as Record<string, unknown>)}
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
async function reachProduct(li: LineItem) {
  await waitFor(() => expect(locationInput()).not.toBeNull());
  scan(locationInput(), li.location_code);
  await waitFor(() => expect(productInput()).not.toBeNull());
}
const goOnline = () => act(async () => { window.dispatchEvent(new Event('online')); });
/** SF-PICK-LOCATION-TRUTH-01: the current stop is the prominent target code. */
const goToHeading = (code: string) => {
  const el = screen.queryByTestId('pick-target-location');
  return el && el.textContent === code ? el : null;
};

test('WO-01 online: a confirmed scan advances to the next item', async () => {
  const onConfirmScan = jest.fn().mockResolvedValue(undefined);
  render(<Host initial={[A, B]} onConfirmScan={onConfirmScan} revalidate={jest.fn()} />);
  await reachProduct(A);
  scan(productInput(), 'EAN-variant-1');
  await waitFor(() => expect(goToHeading('B-2')).toBeInTheDocument());
  expect(onConfirmScan).toHaveBeenCalledWith(expect.objectContaining({ reservation_allocation_id: 'alloc-1', quantity_confirmed: 1 }));
  expect(screen.queryByText('Connection lost')).toBeNull();
});

test('WO-02 connection lost: no advance, paused state shown, further scans not sent', async () => {
  const onConfirmScan = jest.fn().mockRejectedValue(lostErr());
  render(<Host initial={[A, B]} onConfirmScan={onConfirmScan} revalidate={jest.fn().mockRejectedValue(lost())} />);
  await reachProduct(A);
  scan(productInput(), 'EAN-variant-1');
  expect(await screen.findByText('Connection lost')).toBeInTheDocument();
  expect(screen.getByText('Picking is paused. Your confirmed progress is saved.')).toBeInTheDocument();
  expect(screen.getByText('Waiting for connection…')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();                                   // no modal
  // Still on item A's product step; its input is not accepting confirmations.
  expect(productInput()).toBeDisabled();
  expect(onConfirmScan).toHaveBeenCalledTimes(1);
});

test('WO-03 multi-unit quantity confirmation never advances on a lost connection', async () => {
  const onConfirmScan = jest.fn().mockRejectedValue(lostErr());
  render(<Host initial={[MULTI, B]} onConfirmScan={onConfirmScan} revalidate={jest.fn().mockRejectedValue(lost())} />);
  await reachProduct(MULTI);
  scan(productInput(), 'EAN-variant-3');
  await waitFor(() => expect(screen.queryByLabelText(/add one unit/i)).not.toBeNull());
  fireEvent.click(screen.getByLabelText(/add one unit/i));
  fireEvent.click(screen.getByLabelText(/add one unit/i));
  fireEvent.click(screen.getByText(/confirm 2 picked/i));
  expect(await screen.findByText('Connection lost')).toBeInTheDocument();
  expect(goToHeading('B-2')).toBeNull();
  expect(screen.getByRole('spinbutton', { name: /quantity picked/i })).toHaveValue(2);               // still on MULTI's count
  expect(onConfirmScan).toHaveBeenCalledTimes(1);
});

test('WO-04 reconnect: revalidates, reloads authoritative remaining work and resumes at a fresh location scan', async () => {
  const onConfirmScan = jest.fn().mockRejectedValueOnce(lostErr()).mockResolvedValue(undefined);
  const revalidate = jest.fn()
    .mockRejectedValueOnce(lost())                       // still down
    .mockResolvedValueOnce({ lineItems: [B], outcome: recordedA });                         // the lost scan of A was committed
  render(<Host initial={[A, B]} onConfirmScan={onConfirmScan} revalidate={revalidate} />);
  await reachProduct(A);
  scan(productInput(), 'EAN-variant-1');
  expect(await screen.findByText('Connection lost')).toBeInTheDocument();
  await goOnline();
  expect(screen.getByText('Connection lost')).toBeInTheDocument();
  await goOnline();
  await waitFor(() => expect(screen.queryByText('Connection lost')).toBeNull());
  expect(revalidate).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(locationInput()).not.toBeNull());                     // fresh location verification
  expect(productInput()).toBeNull();
  expect(goToHeading('B-2')).toBeInTheDocument();
  expect(goToHeading('A-1')).toBeNull();
  expect(onConfirmScan).toHaveBeenCalledTimes(1);                                  // nothing replayed by the client
});

test('WO-05 ownership changed during the outage: reconnect shows Batch reassigned and stops', async () => {
  const onConfirmScan = jest.fn().mockRejectedValue(lostErr());
  const revalidate = jest.fn().mockRejectedValue({ response: { status: 409, data: { code: 'PICK_OWNERSHIP_REVOKED', error: 'Batch owned by different operator' } } });
  render(<Host initial={[A, B]} onConfirmScan={onConfirmScan} revalidate={revalidate} />);
  await reachProduct(A);
  scan(productInput(), 'EAN-variant-1');
  expect(await screen.findByText('Connection lost')).toBeInTheDocument();
  await goOnline();
  expect(await screen.findByText('Batch reassigned')).toBeInTheDocument();
  expect(productInput()).toBeNull();
  expect(locationInput()).toBeNull();
});

test('WO-06 rapid duplicate product scans send one confirmation', async () => {
  let release: () => void = () => {};
  const onConfirmScan = jest.fn().mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
  render(<Host initial={[A, B]} onConfirmScan={onConfirmScan} revalidate={jest.fn()} />);
  await reachProduct(A);
  scan(productInput(), 'EAN-variant-1');
  scan(productInput(), 'EAN-variant-1');
  await waitFor(() => expect(onConfirmScan).toHaveBeenCalledTimes(1));
  await act(async () => { release(); });
  await waitFor(() => expect(goToHeading('B-2')).toBeInTheDocument());
  expect(onConfirmScan).toHaveBeenCalledTimes(1);
});
