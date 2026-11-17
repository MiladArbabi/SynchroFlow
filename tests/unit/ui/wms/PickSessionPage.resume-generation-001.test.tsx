/**
 * SF-PICK-RESUME-GENERATION-001 — PickSessionPage resume verification gate.
 * A resumed (already-started) session renders no scanner until the host's
 * server verification succeeds; refusals are shown truthfully, never as an
 * inferred reassignment, and never retried automatically.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PickSessionPage, { type LineItem } from '../../../../modules/wms/src/ui/pages/PickSessionPage';

jest.mock('@lasyncro/shared/ui', () => {
  const actual = jest.requireActual('@lasyncro/shared/ui');
  return { ...actual, IsometricCanvas: () => <div data-testid="isometric-canvas-stub" /> };
});

const BATCH_ID = 'c4f7be77-0000-4000-8000-00000000r001';
const A: LineItem = {
  lasyncro_line_item_id: 'line-1', lasyncro_variant_id: 'variant-1', lasyncro_order_id: 'order-r',
  reservation_allocation_id: 'alloc-1', sku: 'SKU-1', product_title: 'Product 1', variant_title: null,
  quantity: 1, location_code: 'A-1', image_url: null, unit_ids: null,
};
const refusal = (code: string) => Object.assign(new Error(code), { response: { status: 409, data: { code, error: code } } });
const noAnswer = () => Object.assign(new Error('Network Error'), { request: {}, isAxiosError: true });

function renderPage(over: { resumePicking?: boolean; onVerifyResume?: jest.Mock; onConfirmScan?: jest.Mock; onStartPicking?: jest.Mock }) {
  const onConfirmScan = over.onConfirmScan ?? jest.fn().mockResolvedValue(undefined);
  render(
    <PickSessionPage
      pickBatchId={BATCH_ID}
      lineItems={[A]}
      onComplete={jest.fn()}
      onResolveBarcode={async () => ({ lasyncro_variant_id: 'variant-1' })}
      onConfirmScan={onConfirmScan}
      onReportException={jest.fn().mockResolvedValue({ pick_exception_id: 'x' })}
      onPickComplete={jest.fn().mockResolvedValue(undefined)}
      onStartPicking={over.onStartPicking ?? jest.fn().mockResolvedValue(undefined)}
      resumePicking={over.resumePicking ?? true}
      floorZones={[]}
      isOnline
      queuedCount={0}
      onVerifyResume={over.onVerifyResume}
    />,
  );
  return { onConfirmScan };
}

const locationInput = () => screen.queryByPlaceholderText(/scan bin barcode/i) as HTMLInputElement | null;
const productInput = () => screen.queryByPlaceholderText(/scan product barcode/i) as HTMLInputElement | null;
function scan(input: HTMLInputElement | null, value: string) {
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { value } });
  fireEvent.keyDown(input!, { key: 'Enter', code: 'Enter' });
}

test('RP-01 resumed session: scanner stays locked while verifying, unlocks on success and the next scan goes through', async () => {
  let resolve!: () => void;
  const onVerifyResume = jest.fn(() => new Promise<void>((r) => { resolve = r; }));
  const { onConfirmScan } = renderPage({ onVerifyResume });
  expect(await screen.findByText('Checking your Pick session')).toBeInTheDocument();
  expect(locationInput()).toBeNull();
  expect(productInput()).toBeNull();
  resolve();
  await waitFor(() => expect(locationInput()).not.toBeNull());
  scan(locationInput(), 'A-1');
  await waitFor(() => expect(productInput()).not.toBeNull());
  scan(productInput(), 'EAN-variant-1');
  await waitFor(() => expect(onConfirmScan).toHaveBeenCalledTimes(1));
  expect(onVerifyResume).toHaveBeenCalledTimes(1);
});

test.each([
  ['PICK_OWNERSHIP_REVOKED', 'Batch held by another picker'],
  ['PICK_BATCH_NOT_PICKING', 'Batch is no longer being picked'],
])('RP-02 server refusal %s is shown truthfully, final, no scanner, no automatic retry', async (code, title) => {
  const onVerifyResume = jest.fn().mockRejectedValue(refusal(code));
  const { onConfirmScan } = renderPage({ onVerifyResume });
  expect(await screen.findByText(title)).toBeInTheDocument();
  expect(screen.queryByText('Batch reassigned')).toBeNull();
  expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  expect(locationInput()).toBeNull();
  await new Promise((r) => setTimeout(r, 50));
  expect(onVerifyResume).toHaveBeenCalledTimes(1);
  expect(onConfirmScan).not.toHaveBeenCalled();
});

test('RP-03 no answer from the server: stays locked; only an explicit Retry verifies again', async () => {
  const onVerifyResume = jest.fn().mockRejectedValueOnce(noAnswer()).mockResolvedValueOnce(undefined);
  renderPage({ onVerifyResume });
  expect(await screen.findByText('Could not verify your Pick session')).toBeInTheDocument();
  expect(locationInput()).toBeNull();
  expect(onVerifyResume).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  await waitFor(() => expect(locationInput()).not.toBeNull());
  expect(onVerifyResume).toHaveBeenCalledTimes(2);
});

test('RP-04 a session started through Start Picking (explicit claim) never runs resume verification', async () => {
  const onVerifyResume = jest.fn().mockResolvedValue(undefined);
  const onStartPicking = jest.fn().mockResolvedValue(undefined);
  renderPage({ resumePicking: false, onVerifyResume, onStartPicking });
  fireEvent.click(await screen.findByRole('button', { name: /start picking/i }));
  await waitFor(() => expect(locationInput()).not.toBeNull());
  expect(onStartPicking).toHaveBeenCalledTimes(1);
  expect(onVerifyResume).not.toHaveBeenCalled();
});
