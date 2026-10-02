/**
 * BATCH-DETAIL-HANDOFF-01 — Pick Brief owns the claim boundary.
 *
 * Batch Detail's "Continue to Pick →" / "Resume Picking →" navigate to
 * /wms?batchId=<id>, which WmsOperationsPage passes to WmsModuleFT2 as
 * pendingPickBatchId. Navigation and restoration are never workflow
 * mutations; the consequential claim belongs to the Pick Brief's
 * Start Picking action.
 *
 * PICK-BRIEF-CLAIM-01
 * - pendingPickBatchId restores the exact Pick Brief without claiming
 * - Start Picking calls the canonical onClaimBatch exactly once
 * - the session does not advance to location_scan until the claim succeeds
 * - a successful claim advances into location_scan
 * - opening a pending batch from its Operations card enters Brief first
 *
 * PICK-BRIEF-CLAIM-02
 * - an already-picking batch restored through pendingPickBatchId continues
 *   without a duplicate claim, keeping refresh/session-recovery semantics
 *
 * Pending vs picking derives from canonical WmsData batch.status.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import WmsModuleFT2 from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';

const PENDING_ID = 'pendbat1-0000-4000-8000-00000a1b2c3';
const PICKING_ID = 'pickbat1-0000-4000-8000-00000d4e5f6';

function wmsBatch(pick_batch_id: string, status: 'pending' | 'picking') {
  return {
    pick_batch_id,
    status,
    total_line_items: 1,
    total_units: 1,
    units_picked: 0,
    units_packed: 0,
    picked_by: status === 'picking' ? 3 : null,
    packed_by: null,
    released_at: '2026-09-14T10:00:00.000Z',
  };
}

const lineItems = [
  {
    lasyncro_line_item_id: 'line-pbc-1',
    lasyncro_variant_id: 'variant-pbc-1',
    lasyncro_order_id: 'order-pbc-1',
    reservation_allocation_id: 'alloc-pbc-1',
    sku: 'PBC-SKU-1',
    product_title: 'Pick Brief widget',
    variant_title: 'Default Title',
    quantity: 1,
    location_code: 'A-1-1-1',
    image_url: null,
    unit_ids: null,
  },
];

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      batches: [wmsBatch(PENDING_ID, 'pending'), wmsBatch(PICKING_ID, 'picking')],
    },
    isLoading: false,
    isError: false,
    currentUserId: 3,
    openReceiveJobs: [],
    receiveAssignedWorkSpotlight: { isDismissed: true, dismiss: jest.fn() },
    onReceiveSessionEnter: jest.fn(),
    onCreateReceiveJob: jest.fn(),
    onFetchReceiveJob: jest.fn(),
    onClaimReceiveJob: jest.fn(),
    onInspectReceiveLine: jest.fn(),
    onPersistReceiveLineProgress: jest.fn(),
    onReportReceiveException: jest.fn(),
    onCloseReceiveJob: jest.fn(),
    onPrintUnitLabels: jest.fn(),
    onConfirmUnitLabelsPrinted: jest.fn(),
    onClaimBatch: jest.fn().mockResolvedValue(undefined),
    onFetchLineItems: jest.fn().mockResolvedValue(lineItems),
    onResolveBarcode: jest.fn(),
    onConfirmScan: jest.fn(),
    onReportException: jest.fn(),
    onCreateProblemTask: jest.fn(),
    onPickComplete: jest.fn(),
    onPickSessionEnter: jest.fn(),
    onClaimPack: jest.fn(),
    onFetchPackOrders: jest.fn(),
    onPackFreeScan: jest.fn(),
    onConfirmPackScan: jest.fn(),
    onReportPackException: jest.fn(),
    onPrintLabel: jest.fn(),
    onPrintInvoice: jest.fn(),
    onPackComplete: jest.fn(),
    onConfirmShipment: jest.fn(),
    onRaisePackDecision: jest.fn(),
    onPollPackDecision: jest.fn(),
    onRefresh: jest.fn(),
    stowTasks: [],
    recountLocked: false,
    recountTasks: [],
    onFetchCountingPreview: jest.fn(),
    onFetchCountingAssignees: jest.fn(),
    onCreateCountingTask: jest.fn(),
    onFetchCountingLines: jest.fn(),
    onFetchCountingFindings: jest.fn(),
    onCreateCountingFinding: jest.fn(),
    onClaimCountingTask: jest.fn(),
    onReassignCountingTask: jest.fn(),
    onRecordCountingLine: jest.fn(),
    onSkipCountingLine: jest.fn(),
    onCloseCountingTask: jest.fn(),
    ...overrides,
  } as any;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const startPicking = () => screen.findByRole('button', { name: /start picking/i });
const locationScan = () => screen.queryByPlaceholderText(/scan bin barcode/i);

/** The Operations card for a batch: nearest ancestor of its id that holds a pick CTA. */
function batchCardAction(batchId: string): HTMLElement {
  let node: HTMLElement | null = screen.getByText(batchId.slice(0, 8).toUpperCase());

  while (node) {
    const action = Array.from(node.querySelectorAll('button')).find((button) =>
      /pick/i.test(button.textContent ?? ''),
    );
    if (action) return action as HTMLElement;
    node = node.parentElement;
  }

  throw new Error(`No pick action on the card for ${batchId}`);
}

afterEach(() => jest.clearAllMocks());

describe('BATCH-DETAIL-HANDOFF-01 — Pick Brief claim boundary', () => {
  it('PICK-BRIEF-CLAIM-01 — pendingPickBatchId restores the exact pending Pick Brief without claiming', async () => {
    const props = baseProps({ pendingPickBatchId: PENDING_ID });

    render(<WmsModuleFT2 {...props} />);

    await startPicking();
    expect(props.onFetchLineItems).toHaveBeenCalledWith(PENDING_ID);
    expect(screen.getByText(/A1B2C3/)).toBeInTheDocument();
    expect(locationScan()).not.toBeInTheDocument();
    expect(props.onClaimBatch).not.toHaveBeenCalled();
  });

  it('PICK-BRIEF-CLAIM-01 — Start Picking claims exactly once and advances only after the claim succeeds', async () => {
    const claim = deferred();
    const props = baseProps({
      pendingPickBatchId: PENDING_ID,
      onClaimBatch: jest.fn(() => claim.promise),
    });

    render(<WmsModuleFT2 {...props} />);

    fireEvent.click(await startPicking());

    expect(props.onClaimBatch).toHaveBeenCalledTimes(1);
    expect(props.onClaimBatch).toHaveBeenCalledWith(PENDING_ID);
    expect(locationScan()).not.toBeInTheDocument();

    await act(async () => {
      claim.resolve();
      await claim.promise;
    });

    await waitFor(() => expect(locationScan()).toBeInTheDocument());
    expect(props.onClaimBatch).toHaveBeenCalledTimes(1);
  });

  it('PICK-BRIEF-CLAIM-01 — a failed claim keeps the operator on the Pick Brief', async () => {
    const claim = deferred();
    const props = baseProps({
      pendingPickBatchId: PENDING_ID,
      onClaimBatch: jest.fn(() => claim.promise),
    });

    render(<WmsModuleFT2 {...props} />);

    fireEvent.click(await startPicking());

    expect(props.onClaimBatch).toHaveBeenCalledTimes(1);

    await act(async () => {
      claim.reject(new Error('Batch already claimed'));
      await claim.promise.catch(() => undefined);
    });

    expect(locationScan()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start picking/i })).toBeInTheDocument();
  });

  it('PICK-BRIEF-CLAIM-01 — opening a pending batch from its Operations card enters the Brief before any claim', async () => {
    const props = baseProps();

    render(<WmsModuleFT2 {...props} />);

    fireEvent.click(batchCardAction(PENDING_ID));

    await startPicking();
    expect(props.onFetchLineItems).toHaveBeenCalledWith(PENDING_ID);
    expect(props.onClaimBatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /start picking/i }));

    await waitFor(() => expect(locationScan()).toBeInTheDocument());
    expect(props.onClaimBatch).toHaveBeenCalledTimes(1);
    expect(props.onClaimBatch).toHaveBeenCalledWith(PENDING_ID);
  });

  it('PICK-BRIEF-CLAIM-02 — an already-picking batch restored from pendingPickBatchId continues without a duplicate claim', async () => {
    const props = baseProps({ pendingPickBatchId: PICKING_ID });

    render(<WmsModuleFT2 {...props} />);

    // Refresh/session recovery: the exact batch session is re-entered and
    // re-reported for URL recovery.
    await startPicking();
    expect(props.onFetchLineItems).toHaveBeenCalledWith(PICKING_ID);
    expect(props.onPickSessionEnter).toHaveBeenCalledWith(PICKING_ID);

    fireEvent.click(screen.getByRole('button', { name: /start picking/i }));

    await waitFor(() => expect(locationScan()).toBeInTheDocument());
    expect(props.onClaimBatch).not.toHaveBeenCalled();
  });
});
