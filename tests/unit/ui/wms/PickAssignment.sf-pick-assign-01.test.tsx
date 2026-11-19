/**
 * SF-PICK-ASSIGN-01 — Pick assignment / recovery UX.
 *
 * Board: assignment status, no entry into another operator's session, an
 * explicit idle-gated Take over, owner/admin Assign / Reassign / first-to-claim.
 * Session: owner-only resume, custody acknowledgement before any write after a
 * takeover (then a fresh location scan), and a terminal state on ownership loss.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import WmsModuleFT2 from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';
import PickSessionPage, { type LineItem } from '../../../../modules/wms/src/ui/pages/PickSessionPage';

jest.mock('@lasyncro/shared/ui', () => {
  const actual = jest.requireActual('@lasyncro/shared/ui');
  return { ...actual, IsometricCanvas: () => <div data-testid="isometric-canvas-stub" /> };
});

const ME = 3;
const OTHER = 7;
const OPEN_ID = 'open0001-0000-4000-8000-000000000001';
const RESERVED_ID = 'resv0001-0000-4000-8000-000000000002';
const MINE_ID = 'mine0001-0000-4000-8000-000000000003';
const BUSY_ID = 'busy0001-0000-4000-8000-000000000004';
const IDLE_ID = 'idle0001-0000-4000-8000-000000000005';

function batch(id: string, status: 'pending' | 'picking', extra: Record<string, unknown> = {}) {
  return {
    pick_batch_id: id, status, total_line_items: 1, total_units: 2, units_picked: status === 'picking' ? 1 : 0,
    units_packed: 0, picked_by: null, packed_by: null, released_at: '2026-11-12T08:00:00.000Z',
    assigned_operator_id: null, assigned_operator_name: null, recovery_eligible: false,
    recovery_threshold_minutes: 30, idle_minutes: null, ...extra,
  };
}

const BATCHES = [
  batch(OPEN_ID, 'pending'),
  batch(RESERVED_ID, 'pending', { assigned_operator_id: OTHER, assigned_operator_name: 'Elin Vargas' }),
  batch(MINE_ID, 'picking', { picked_by: ME, picker_name: 'Me', assigned_operator_id: ME }),
  batch(BUSY_ID, 'picking', { picked_by: OTHER, picker_name: 'Elin Vargas', assigned_operator_id: OTHER, idle_minutes: 4 }),
  batch(IDLE_ID, 'picking', {
    picked_by: OTHER, picker_name: 'Elin Vargas', assigned_operator_id: OTHER, idle_minutes: 41, recovery_eligible: true,
  }),
];

const lineItems: LineItem[] = [{
  lasyncro_line_item_id: 'line-1', lasyncro_variant_id: 'variant-1', lasyncro_order_id: 'order-1',
  reservation_allocation_id: 'alloc-1', sku: 'SKU-1', product_title: 'Widget', variant_title: null,
  quantity: 1, location_code: 'A-1', image_url: null, unit_ids: null,
} as LineItem];

function moduleProps(overrides: Record<string, unknown> = {}) {
  return {
    data: { batches: BATCHES },
    isLoading: false, isError: false, currentUserId: ME, openReceiveJobs: [],
    receiveAssignedWorkSpotlight: { isDismissed: true, dismiss: jest.fn() },
    onReceiveSessionEnter: jest.fn(), onCreateReceiveJob: jest.fn(), onFetchReceiveJob: jest.fn(),
    onClaimReceiveJob: jest.fn(), onInspectReceiveLine: jest.fn(), onPersistReceiveLineProgress: jest.fn(),
    onReportReceiveException: jest.fn(), onCloseReceiveJob: jest.fn(), onPrintUnitLabels: jest.fn(),
    onConfirmUnitLabelsPrinted: jest.fn(),
    onClaimBatch: jest.fn().mockResolvedValue({
      pick_batch_id: IDLE_ID, status: 'picking', pick_claim_generation: 'gen-2',
      custody_ack_required: true, units_picked: 1, takeover: { previous_picked_by: OTHER, idle_minutes: 41, threshold_minutes: 30 },
    }),
    onFetchLineItems: jest.fn().mockResolvedValue(lineItems),
    onResolveBarcode: jest.fn(), onConfirmScan: jest.fn(), onReportException: jest.fn(),
    onCreateProblemTask: jest.fn(), onPickComplete: jest.fn(), onPickSessionEnter: jest.fn(),
    onClaimPack: jest.fn(), onFetchPackOrders: jest.fn(), onPackFreeScan: jest.fn(), onConfirmPackScan: jest.fn(),
    onReportPackException: jest.fn(), onPrintLabel: jest.fn(), onPrintInvoice: jest.fn(), onPackComplete: jest.fn(),
    onConfirmShipment: jest.fn(), onRaisePackDecision: jest.fn(), onPollPackDecision: jest.fn(), onRefresh: jest.fn(),
    stowTasks: [], recountLocked: false, recountTasks: [],
    onFetchCountingPreview: jest.fn(), onFetchCountingAssignees: jest.fn(), onCreateCountingTask: jest.fn(),
    onFetchCountingLines: jest.fn(), onFetchCountingFindings: jest.fn(), onCreateCountingFinding: jest.fn(),
    onClaimCountingTask: jest.fn(), onReassignCountingTask: jest.fn(), onRecordCountingLine: jest.fn(),
    onSkipCountingLine: jest.fn(), onCloseCountingTask: jest.fn(),
    ...overrides,
  } as any;
}

/** The article for a batch card (aria-label "Batch XXXXXXXX"). */
const card = (id: string) => screen.queryByRole('article', { name: `Batch ${id.slice(0, 8).toUpperCase()}` });
/** Buttons on a card that MUST be rendered — never vacuous on a missing card. */
const cardButtons = (id: string) => {
  const article = card(id);
  expect(article).not.toBeNull();
  return Array.from(article!.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim()).filter(Boolean);
};
// The Operations stage previews 3 cards; each board case passes ≤ 3 batches.
const only = (...ids: string[]) => ({ batches: BATCHES.filter((b) => ids.includes(b.pick_batch_id)) });

afterEach(() => jest.clearAllMocks());

describe('SF-PICK-ASSIGN-01 — board', () => {
  it('UI-01 shows assignment status and never offers entry into another operator\'s active session', () => {
    const { unmount } = render(<WmsModuleFT2 {...moduleProps({ data: only(OPEN_ID, RESERVED_ID, BUSY_ID) })} />);
    expect(within(card(OPEN_ID)!).getByText('First one to claim')).toBeInTheDocument();
    expect(within(card(RESERVED_ID)!).getByText('Assigned to Elin Vargas')).toBeInTheDocument();
    expect(cardButtons(OPEN_ID)).toContain('Start picking →');
    expect(cardButtons(RESERVED_ID)).not.toContain('Start picking →');
    expect(cardButtons(BUSY_ID)).not.toContain('Continue picking →');
    expect(cardButtons(BUSY_ID)).not.toContain('Take over →');
    unmount();
    render(<WmsModuleFT2 {...moduleProps({ data: only(MINE_ID) })} />);
    expect(cardButtons(MINE_ID)).toContain('Continue picking →');
  });

  it('UI-02 an idle batch is offered as an explicit Take over that goes through the claim and custody step', async () => {
    const props = moduleProps({ data: only(IDLE_ID) });
    render(<WmsModuleFT2 {...props} />);
    expect(within(card(IDLE_ID)!).getByText(/Idle 41 min — open to take over/)).toBeInTheDocument();
    fireEvent.click(within(card(IDLE_ID)!).getByText('Take over →'));
    const start = await screen.findByRole('button', { name: /start picking/i });
    expect(props.onClaimBatch).not.toHaveBeenCalled();
    fireEvent.click(start);
    await waitFor(() => expect(props.onClaimBatch).toHaveBeenCalledWith(IDLE_ID));
    expect(await screen.findByText('Confirm picked items')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/^scan location$/i)).not.toBeInTheDocument();
  });

  it('UI-03 owner/admin assign, reassign and first-to-claim through the assignment route', async () => {
    const props = moduleProps({
      data: only(OPEN_ID, BUSY_ID, IDLE_ID),
      canAssignPick: true,
      onAssignPickBatch: jest.fn().mockResolvedValue(undefined),
      onFetchPickAssignees: jest.fn().mockResolvedValue([
        { user_id: OTHER, first_name: 'Elin', last_name: 'Vargas', role: 'operator' },
        { user_id: 9, first_name: 'Marcus', last_name: 'Boateng', role: 'operator' },
      ]),
    });
    render(<WmsModuleFT2 {...props} />);
    expect(screen.queryByTestId(`pick-batch-menu-${BUSY_ID}`)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`pick-batch-menu-${OPEN_ID}`));
    fireEvent.click(await screen.findByText('Assign to…'));
    expect(await screen.findByText('Assign Pick batch')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByLabelText('Assign to'));
    fireEvent.click(await screen.findByText(/Marcus Boateng/));
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(props.onAssignPickBatch).toHaveBeenCalledWith(OPEN_ID, 9));

    fireEvent.click(screen.getByTestId(`pick-batch-menu-${IDLE_ID}`));
    fireEvent.click(await screen.findByText('Make first one to claim'));
    await waitFor(() => expect(props.onAssignPickBatch).toHaveBeenCalledWith(IDLE_ID, null));
  });

  it('UI-04 the operator floor hides Pick work the operator cannot act on', () => {
    // Five batches in, at most three visible: exactly the actionable three.
    render(<WmsModuleFT2 {...moduleProps({ operationsShell: 'operator' })} />);
    expect(card(OPEN_ID)).toBeInTheDocument();
    expect(card(MINE_ID)).toBeInTheDocument();
    expect(card(IDLE_ID)).toBeInTheDocument();
    expect(card(RESERVED_ID)).not.toBeInTheDocument();
    expect(card(BUSY_ID)).not.toBeInTheDocument();
  });

  it('UI-05 restoring another operator\'s picking batch shows the Brief, not their execution', async () => {
    render(<WmsModuleFT2 {...moduleProps({ pendingPickBatchId: BUSY_ID })} />);
    expect(await screen.findByRole('button', { name: /start picking/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/^scan location$/i)).not.toBeInTheDocument();
  });
});

describe('SF-PICK-ASSIGN-01 — session', () => {
  function session(overrides: Record<string, unknown> = {}) {
    const props = {
      pickBatchId: IDLE_ID, lineItems, onComplete: jest.fn(),
      onResolveBarcode: jest.fn().mockResolvedValue({ lasyncro_variant_id: 'variant-1' }),
      onConfirmScan: jest.fn().mockResolvedValue(undefined),
      onReportException: jest.fn(), onPickComplete: jest.fn(),
      resumePicking: true, floorZones: [], ...overrides,
    };
    render(<PickSessionPage {...(props as any)} />);
    return props;
  }
  const scan = (input: HTMLElement | null, value: string) => {
    fireEvent.change(input!, { target: { value } });
    fireEvent.keyDown(input!, { key: 'Enter', code: 'Enter' });
  };

  it('UI-06 custody must be acknowledged before scanning; then a fresh location scan', async () => {
    const props = session({
      custodyAckRequired: true, unitsPickedBeforeTakeover: 1,
      onAcknowledgeCustody: jest.fn().mockResolvedValue(undefined),
    });
    expect(screen.getByText('Confirm picked items')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/^scan location$/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'I have the picked items' }));
    await waitFor(() => expect(props.onAcknowledgeCustody).toHaveBeenCalledTimes(1));
    expect(await screen.findByPlaceholderText(/^scan location$/i)).toBeInTheDocument();
    expect(props.onConfirmScan).not.toHaveBeenCalled();
  });

  it('UI-07 a revoked session stops: no scanner, no further writes, a clear way back', async () => {
    const revoked = Object.assign(new Error('Request failed with status code 409'), {
      response: { status: 409, data: { code: 'PICK_OWNERSHIP_REVOKED', error: 'Batch owned by different operator' } },
    });
    const props = session({ onConfirmScan: jest.fn().mockRejectedValue(revoked) });
    scan(screen.getByPlaceholderText(/^scan location$/i), 'A-1');
    scan(await screen.findByPlaceholderText(/scan product barcode/i), 'EAN-1');
    expect(await screen.findByText('Batch reassigned')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/scan product barcode/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/^scan location$/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Warehouse' }));
    expect(props.onComplete).toHaveBeenCalled();
    expect(props.onConfirmScan).toHaveBeenCalledTimes(1);
  });

  it('UI-08 a server-side custody refusal routes to the acknowledgement step', async () => {
    const needsAck = Object.assign(new Error('409'), {
      response: { status: 409, data: { code: 'PICK_CUSTODY_ACK_REQUIRED', error: 'Confirm you have the picked items' } },
    });
    session({ onConfirmScan: jest.fn().mockRejectedValue(needsAck), onAcknowledgeCustody: jest.fn() });
    scan(screen.getByPlaceholderText(/^scan location$/i), 'A-1');
    scan(await screen.findByPlaceholderText(/scan product barcode/i), 'EAN-1');
    expect(await screen.findByText('Confirm picked items')).toBeInTheDocument();
  });
});
