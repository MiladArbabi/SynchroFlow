/**
 * SF-PICK-A6B-OWNERSHIP-TRUTH-003 — truthful copy when (F1) ownership is
 * revoked while a sent scan's outcome is still unknown, and (F2) the
 * connection drops again after an inconclusive reconciliation answer.
 * No `online` event is dispatched; recovery runs through the 5 s probe.
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
async function lostResponseOnA(onConfirmScan: jest.Mock, revalidate: jest.Mock) {
  render(<ChurningHost onConfirmScan={onConfirmScan} revalidate={revalidate} />);
  await waitFor(() => expect(locationInput()).not.toBeNull());
  scan(locationInput(), A.location_code);
  await waitFor(() => expect(productInput()).not.toBeNull());
  scan(productInput(), 'EAN-variant-1');
  expect(await screen.findByText('Connection lost')).toBeInTheDocument();
}
const goToHeading = (code: string) => screen.queryByText(`${code}.`);
const pageText = () => document.body.textContent ?? '';
const PROBE_WINDOW = { timeout: 9_000 };
const revoked = () => ({ isAxiosError: true, request: {}, response: { status: 409, data: { code: 'PICK_OWNERSHIP_REVOKED', error: 'Batch owned by different operator' } } });

test('OT-01 ownership revoked while the last scan is uncertain: no "nothing else was recorded", may already be recorded, supervisor, no re-scan, no scanner', async () => {
  const onConfirmScan = jest.fn().mockRejectedValueOnce(lostAfterSend()).mockResolvedValue(undefined);
  const revalidate = jest.fn().mockRejectedValue(revoked());
  await lostResponseOnA(onConfirmScan, revalidate);

  expect(await screen.findByText('Batch reassigned', undefined, PROBE_WINDOW)).toBeInTheDocument();
  const text = pageText();
  expect(text).not.toMatch(/nothing else was recorded/i);
  expect(text).toMatch(/Product 1 may already have been recorded/i);
  expect(text).toMatch(/supervisor/i);
  expect(text).not.toMatch(MISLEADING);
  // Confirmed picks and the uncertain scan are reported separately.
  expect(text).toMatch(/Confirmed picks this session\s*0/i);
  expect(text).toMatch(/Last scan\s*Outcome unknown/i);
  expect(locationInput()).toBeNull();
  expect(productInput()).toBeNull();
  expect(onConfirmScan).toHaveBeenCalledTimes(1);
}, 15_000);

test('OT-02 inconclusive answer, then the connection fails again: waiting-for-connection guidance, uncertain outcome kept, locked, then resolves', async () => {
  const onConfirmScan = jest.fn().mockRejectedValueOnce(lostAfterSend()).mockResolvedValue(undefined);
  const revalidate = jest.fn()
    .mockRejectedValueOnce(answeredServerError())
    .mockRejectedValueOnce(lostAfterSend())
    .mockResolvedValue([B]);
  await lostResponseOnA(onConfirmScan, revalidate);

  await waitFor(() => expect(pageText()).toMatch(/could not confirm/i), PROBE_WINDOW);
  await waitFor(() => expect(revalidate).toHaveBeenCalledTimes(2), PROBE_WINDOW);
  await waitFor(() => expect(pageText()).toMatch(/Waiting for connection/i));
  expect(pageText()).not.toMatch(/could not confirm/i);
  expect(screen.getByText('Connection lost')).toBeInTheDocument();
  expect(pageText()).toMatch(/may already have been recorded/i);
  expect(productInput()).toBeDisabled();
  expect(pageText()).not.toMatch(MISLEADING);

  await waitFor(() => expect(screen.queryByText('Connection lost')).toBeNull(), PROBE_WINDOW);
  expect(screen.getByText(/Product 1 was recorded/i)).toBeInTheDocument();
  expect(onConfirmScan).toHaveBeenCalledTimes(1);
}, 30_000);
