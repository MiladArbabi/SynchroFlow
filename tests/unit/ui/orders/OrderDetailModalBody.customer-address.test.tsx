/**
 * ORD-DECISION-01 / Slice 4 — CUSTOMER ADDRESS UI CONTRACT.
 *
 * Order Detail's customer/incomplete_address surface, protected at the
 * component boundary:
 *
 *   ADDR-UI-01  constraints are truth, decisions are enrichment — the modal
 *               renders the customer problem and routes to "Correct shipping
 *               address" from the constraint alone, with decision === null.
 *               The generic resolve_customer_block execute mutation is never
 *               called, and "Flag for customer review" is never the operative
 *               CTA (resolve_customer_block.handler.ts is a documented manual
 *               no-op, so routing there would be a dead end).
 *   ADDR-UI-02  the dialog submits trimmed required fields plus the orderId
 *               through the real save action.
 *   ADDR-UI-03  PATCH success does NOT optimistically claim resolution: while
 *               the customer constraint is still present the UI shows the
 *               recheck state instead of the CTA, and only server-confirmed
 *               constraint truth (the constraint disappearing) clears it.
 *   ADDR-UI-04  even when a real resolve_customer_block decision co-exists with
 *               the active constraint, the UI still routes to the address
 *               correction and never executes the decision.
 *
 * Harness mirrors tests/unit/ui/orders/OrderDetailModalBody.returned-undelivered.test.tsx.
 * Queries are role/label based; no CSS, Collapse internals, private state, or
 * backend wording is asserted. The mutation's onSuccess callback is captured
 * from the mock and fired under explicit test control — no timers, no sleeps.
 */
import React, { ReactNode, useCallback, useState } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { OrderDetailModalBody } from 'pages/orders/OrderDetailModalBody';

const mockNavigate = jest.fn();
const mockExecute = jest.fn();
const mockUseOrderDecision = jest.fn();
const mockUpdateAddress = jest.fn();

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

jest.mock('pages/orders/useOrderDecision', () => ({
  useOrderDecision: (...args: unknown[]) => mockUseOrderDecision(...args),
  useExecuteOrderDecision: () => ({
    mutate: mockExecute,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
}));

const mockUseOrderDetail = jest.fn();

jest.mock('pages/orders/useOrderDetail', () => ({
  useOrderDetail: (...args: unknown[]) => mockUseOrderDetail(...args),
}));

jest.mock('pages/orders/usePickExceptionsForOrder', () => ({
  usePickExceptionsForOrder: () => ({
    data: { exceptions: [] },
  }),
  useResolvePickException: () => ({}),
}));

jest.mock('pages/problem-center/usePackDecisions', () => ({
  useOrderPackDecisions: () => ({
    data: { requests: [] },
    isLoading: false,
  }),
}));

jest.mock('pages/orders/useShippingAddress', () => ({
  useUpdateShippingAddress: () => ({
    mutate: mockUpdateAddress,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

jest.mock('hooks/useCurrency', () => ({
  useCurrency: () => ({
    format: (value: number | null | undefined) =>
      value == null ? '—' : `$${Number(value).toLocaleString('en-US')}`,
  }),
}));

type Constraint = {
  constraint_type: string;
  block_type: string | null;
  target_id: string | null;
  target_status: string | null;
  started_at: string;
};

const CUSTOMER_CONSTRAINT: Constraint = {
  constraint_type: 'customer',
  block_type: 'incomplete_address',
  target_id: null,
  target_status: null,
  started_at: '2026-09-01T12:00:00.000Z',
};

/** A real resolve_customer_block decision, as the Decision Engine emits it. */
const CUSTOMER_DECISION = {
  id: 'decision-1',
  type: 'customer',
  entity_id: 'order-1',
  status: 'pending',
  priority: 50,
  reason: 'Derived from resolve_customer_block',
  recommended_action: {
    type: 'resolve_customer_block',
    payload: {},
    execution_mode: 'manual',
  },
  actions: [],
  lifecycle: null,
  created_at: '2026-09-01T12:00:00.000Z',
  updated_at: '2026-09-01T12:00:00.000Z',
};

function setDecisionResponse(body: {
  decision: unknown;
  constraints: Constraint[];
}) {
  mockUseOrderDecision.mockReturnValue({
    data: body,
    isLoading: false,
    isError: false,
    error: null,
  });
}

/**
 * GH-1053 HARNESS MIGRATION
 * --------------------------
 * EntityDetailModal renders this component as `children` and the ReactNode it
 * hands back through onFooterReady into the `footerActions` slot. Blocker
 * remediation now lives in that slot, so a harness that drops the footer node
 * on the floor can no longer see the CTA it is asserting on.
 *
 * This host renders both regions — same pattern as
 * tests/unit/ui/orders/OrderDetailModal.redesign-1053.test.tsx — so every
 * behavioural contract below is asserted against the COMPLETE modal surface.
 * No assertion, route, or execute/non-execute expectation changed with it.
 */
const noop = () => {};

function ModalHost({ queryClient }: { queryClient: QueryClient }) {
  const [footer, setFooter] = useState<ReactNode>(null);
  const handleFooterReady = useCallback((node: ReactNode) => setFooter(node), []);

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <div data-testid="modal-body">
          <OrderDetailModalBody
            orderId="order-1"
            onTitleReady={noop}
            onSubtitleReady={noop}
            onNavigateToOrder={noop}
            onFooterReady={handleFooterReady}
            onClose={noop}
          />
        </div>
        <div data-testid="modal-footer">{footer}</div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderModal() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(<ModalHost queryClient={queryClient} />);
}

const correctAddressButton = () =>
  screen.queryByRole('button', { name: 'Correct shipping address' });

/** Opens the dialog and fills every required field. */
function openDialogAndFill(values: {
  address1: string;
  city: string;
  zip: string;
  countryCode: string;
}) {
  fireEvent.click(screen.getByRole('button', { name: 'Correct shipping address' }));

  const dialog = screen.getByRole('dialog');
  fireEvent.change(screen.getByLabelText(/Address line 1/), { target: { value: values.address1 } });
  fireEvent.change(screen.getByLabelText(/^City/), { target: { value: values.city } });
  fireEvent.change(screen.getByLabelText(/ZIP \/ Postal code/), { target: { value: values.zip } });
  fireEvent.change(screen.getByLabelText(/Country code/), { target: { value: values.countryCode } });
  return dialog;
}

describe('OrderDetailModalBody customer/incomplete_address surface', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Existing ADDR-UI-* contracts assume no order-detail payload.
    mockUseOrderDetail.mockReturnValue({ data: null, isLoading: false });
  });

  it('ADDR-UI-01 renders the address correction from constraint truth when decision enrichment is absent', () => {
    setDecisionResponse({ decision: null, constraints: [CUSTOMER_CONSTRAINT] });

    renderModal();

    // The customer problem is surfaced from the constraint alone.
    expect(screen.getByText('Address Issue')).toBeInTheDocument();

    // …and routes to the real in-app resolution path.
    const cta = correctAddressButton();
    expect(cta).toBeInTheDocument();

    // The generic manual-no-op action is never offered as the operative CTA.
    expect(
      screen.queryByRole('button', { name: 'Flag for customer review' })
    ).not.toBeInTheDocument();

    fireEvent.click(cta!);

    // Clicking opens the focused shipping-address dialog…
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Correct shipping address' })
    ).toBeInTheDocument();

    // …and never fires the generic decision execution mutation.
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('ADDR-UI-02 submits the orderId and trimmed required fields through the dialog save action', () => {
    setDecisionResponse({ decision: null, constraints: [CUSTOMER_CONSTRAINT] });

    renderModal();

    // Deliberately padded input — trimming is the contract, not cosmetics.
    openDialogAndFill({
      address1: '  221B Baker Street  ',
      city: '  London  ',
      zip: '  NW1 6XE  ',
      countryCode: '  gb  ',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    expect(mockUpdateAddress).toHaveBeenCalledTimes(1);
    expect(mockUpdateAddress.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        orderId: 'order-1',
        address1: '221B Baker Street',
        city: 'London',
        zip: 'NW1 6XE',
        countryCode: 'GB',
      })
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('ADDR-UI-03 shows recheck on PATCH success and only clears on server-confirmed constraint truth', async () => {
    setDecisionResponse({ decision: null, constraints: [CUSTOMER_CONSTRAINT] });

    const { rerender } = renderModal();

    openDialogAndFill({
      address1: '221B Baker Street',
      city: 'London',
      zip: 'NW1 6XE',
      countryCode: 'GB',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    // Capture the mutation's onSuccess and fire it under test control.
    const onSuccess = mockUpdateAddress.mock.calls[0][1]?.onSuccess;
    expect(typeof onSuccess).toBe('function');
    act(() => {
      onSuccess({ message: 'Shipping address updated' }, mockUpdateAddress.mock.calls[0][0], undefined);
    });

    // Constraint is STILL present — the UI must not claim resolution.
    expect(screen.getByText('Address updated — rechecking order…')).toBeInTheDocument();
    await waitFor(() => expect(correctAddressButton()).not.toBeInTheDocument());
    expect(mockExecute).not.toHaveBeenCalled();

    // Server confirms resolution: the customer constraint is gone.
    setDecisionResponse({ decision: null, constraints: [] });
    rerender(<ModalHost queryClient={new QueryClient()} />);

    await waitFor(() =>
      expect(screen.queryByText('Address updated — rechecking order…')).not.toBeInTheDocument()
    );
    expect(correctAddressButton()).not.toBeInTheDocument();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('ADDR-UI-04 still routes to the address correction when a real resolve_customer_block decision co-exists', () => {
    setDecisionResponse({
      decision: CUSTOMER_DECISION,
      constraints: [CUSTOMER_CONSTRAINT],
    });

    renderModal();

    const cta = correctAddressButton();
    expect(cta).toBeInTheDocument();

    // The decision's own label must never become the operative CTA — its
    // backend handler is a documented manual no-op.
    expect(
      screen.queryByRole('button', { name: 'Flag for customer review' })
    ).not.toBeInTheDocument();

    fireEvent.click(cta!);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});


// ── ADDR-ASSIST-07..09 — Address Assist UI (RED: feature not implemented) ────
//
// Order Detail will expose addressAssist alongside the existing customer
// blocker. The assist is EVIDENCE the merchant reviews — it pre-fills the
// existing dialog and nothing more. It never writes on its own, and it never
// routes through the generic decision execution mutation.

const ADDRESS_ASSIST = {
  source: 'historical_fulfilled_orders',
  candidate: {
    address1: '221B Baker Street',
    address2: 'Flat 2',
    city: 'London',
    zip: 'NW1 6XE',
    province: 'Greater London',
    countryCode: 'GB',
  },
  usageCount: 3,
  lastUsedAt: '2026-08-09T10:00:00.000Z',
};

/** Current-order shipping: recipient identity present, destination missing. */
const CURRENT_SHIPPING = {
  name: 'Jane Doe',
  address1: null,
  address2: null,
  city: null,
  zip: null,
  phone: '+44 7700 900123',
  province: null,
  countryCode: null,
};

function setOrderDetail(addressAssist: unknown) {
  mockUseOrderDetail.mockReturnValue({
    data: {
      id: 'order-1',
      externalOrderId: '1001',
      total: 100,
      subtotal: 90,
      tax: 10,
      currency: 'GBP',
      paymentState: 'paid',
      createdAt: '2026-09-01T12:00:00.000Z',
      lineItems: [],
      fulfillment: null,
      warehouseStatus: null,
      timeline: [],
      tracking: null,
      shipping: CURRENT_SHIPPING,
      addressAssist,
    },
    isLoading: false,
  });
}

const useThisAddressButton = () =>
  screen.queryByRole('button', { name: /Use this address/i });

describe('ADDR-ASSIST — Address Assist v1 in the existing correction dialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ADDR-ASSIST-07 offers the previously used address with provenance inside the existing dialog', () => {
    setDecisionResponse({ decision: null, constraints: [CUSTOMER_CONSTRAINT] });
    setOrderDetail(ADDRESS_ASSIST);

    renderModal();

    // The existing CTA stays operative — assist does not replace it.
    const cta = correctAddressButton();
    expect(cta).toBeInTheDocument();
    fireEvent.click(cta!);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Evidence, provenance and the apply affordance.
    expect(screen.getByText(/Previously used address/i)).toBeInTheDocument();
    expect(screen.getByText(/3/)).toBeInTheDocument();           // usage count
    expect(screen.getByText(/last used/i)).toBeInTheDocument();  // recency provenance
    expect(useThisAddressButton()).toBeInTheDocument();

    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('ADDR-ASSIST-08 pre-fills the existing form only, and Save remains the sole write', () => {
    setDecisionResponse({ decision: null, constraints: [CUSTOMER_CONSTRAINT] });
    setOrderDetail(ADDRESS_ASSIST);

    renderModal();
    fireEvent.click(correctAddressButton()!);
    fireEvent.click(useThisAddressButton()!);

    // Pre-fill only — no write of any kind yet.
    expect(mockUpdateAddress).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();

    expect(screen.getByLabelText(/Address line 1/)).toHaveValue('221B Baker Street');
    expect(screen.getByLabelText(/Address line 2/)).toHaveValue('Flat 2');
    expect(screen.getByLabelText(/^City/)).toHaveValue('London');
    expect(screen.getByLabelText(/ZIP \/ Postal code/)).toHaveValue('NW1 6XE');
    expect(screen.getByLabelText(/State \/ Province/)).toHaveValue('Greater London');
    expect(screen.getByLabelText(/Country code/)).toHaveValue('GB');

    // Current-order recipient identity is preserved, never overwritten by evidence.
    expect(screen.getByLabelText(/Recipient name/)).toHaveValue('Jane Doe');
    expect(screen.getByLabelText(/Phone/)).toHaveValue('+44 7700 900123');

    // The merchant reviews and edits before committing.
    fireEvent.change(screen.getByLabelText(/Address line 2/), { target: { value: 'Flat 5' } });
    expect(mockUpdateAddress).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    expect(mockUpdateAddress).toHaveBeenCalledTimes(1);
    expect(mockUpdateAddress.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        orderId: 'order-1',
        address1: '221B Baker Street',
        address2: 'Flat 5', // the reviewed/edited value, not the raw evidence
        city: 'London',
        zip: 'NW1 6XE',
        countryCode: 'GB',
      })
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('ADDR-ASSIST-09 leaves manual correction untouched when there is no assist', () => {
    setDecisionResponse({ decision: null, constraints: [CUSTOMER_CONSTRAINT] });
    setOrderDetail(null);

    renderModal();
    fireEvent.click(correctAddressButton()!);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText(/Previously used address/i)).not.toBeInTheDocument();
    expect(useThisAddressButton()).not.toBeInTheDocument();

    // Manual completion still works, and PATCH is still the only write path.
    fireEvent.change(screen.getByLabelText(/Address line 1/), { target: { value: '1 Manual Way' } });
    fireEvent.change(screen.getByLabelText(/^City/), { target: { value: 'Bristol' } });
    fireEvent.change(screen.getByLabelText(/ZIP \/ Postal code/), { target: { value: 'BS1 1AA' } });
    fireEvent.change(screen.getByLabelText(/Country code/), { target: { value: 'GB' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    expect(mockUpdateAddress).toHaveBeenCalledTimes(1);
    expect(mockUpdateAddress.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        orderId: 'order-1',
        address1: '1 Manual Way',
        city: 'Bristol',
        zip: 'BS1 1AA',
        countryCode: 'GB',
      })
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });
});


// ── OUTCOME-ADDR-06 — correction provenance (RED: correctionSource absent) ──
//
// OUTCOME-ATTR-01 pilot. The intervention record needs to know HOW the operator
// arrived at the address they saved, because "typed it themselves" and "accepted
// a previously used address after reviewing it" are different operator actions
// with different follow-up value.
//
// This is PROVENANCE ONLY. Selecting the candidate pre-fills a form that the
// operator still reviews and still submits by hand. These contracts deliberately
// assert nothing about AI resolution, automatic correction, prevented revenue,
// or reduced operator review — no such claim is being made, and none may be
// inferred from the value of this field.
//
// The write path is unchanged: the same dialog, the same PATCH, the same single
// mutation. Only the payload gains one field.

describe('OUTCOME-ADDR-06 — address correction provenance on the save payload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('submits correctionSource "manual" when the operator types the address themselves', () => {
    setDecisionResponse({ decision: null, constraints: [CUSTOMER_CONSTRAINT] });
    // Assist evidence is present but deliberately NOT used — availability of a
    // candidate must not by itself change the recorded provenance.
    setOrderDetail(ADDRESS_ASSIST);

    renderModal();

    openDialogAndFill({
      address1: '9 Typed Lane',
      city: 'Bristol',
      zip: 'BS1 1AA',
      countryCode: 'GB',
    });

    // The candidate was offered and left alone.
    expect(useThisAddressButton()).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    expect(mockUpdateAddress).toHaveBeenCalledTimes(1);
    expect(mockUpdateAddress.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        orderId: 'order-1',
        address1: '9 Typed Lane',
        city: 'Bristol',
        zip: 'BS1 1AA',
        countryCode: 'GB',
        correctionSource: 'manual',
      })
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('submits correctionSource "historical_address_assist" when the operator applies the candidate and then saves', () => {
    setDecisionResponse({ decision: null, constraints: [CUSTOMER_CONSTRAINT] });
    setOrderDetail(ADDRESS_ASSIST);

    renderModal();
    fireEvent.click(correctAddressButton()!);

    // Applying the candidate is a pre-fill. It writes nothing on its own.
    fireEvent.click(useThisAddressButton()!);
    expect(mockUpdateAddress).not.toHaveBeenCalled();

    // The operator still performs the save, as always.
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    expect(mockUpdateAddress).toHaveBeenCalledTimes(1);
    expect(mockUpdateAddress.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        orderId: 'order-1',
        address1: '221B Baker Street',
        city: 'London',
        zip: 'NW1 6XE',
        countryCode: 'GB',
        correctionSource: 'historical_address_assist',
      })
    );

    // Still one write, still the same PATCH mutation, still no decision execution.
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('records manual provenance when the operator edits the applied candidate before saving', () => {
    setDecisionResponse({ decision: null, constraints: [CUSTOMER_CONSTRAINT] });
    setOrderDetail(ADDRESS_ASSIST);

    renderModal();
    fireEvent.click(correctAddressButton()!);
    fireEvent.click(useThisAddressButton()!);

    // The operator reviews the candidate and changes it — what is saved is no
    // longer the historical address, so it must not be attributed to the assist.
    fireEvent.change(screen.getByLabelText(/Address line 1/), {
      target: { value: '19 Corrected Street' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    expect(mockUpdateAddress).toHaveBeenCalledTimes(1);
    expect(mockUpdateAddress.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        address1: '19 Corrected Street',
        correctionSource: 'manual',
      })
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
