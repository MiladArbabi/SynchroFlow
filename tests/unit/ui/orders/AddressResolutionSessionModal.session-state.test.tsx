/**
 * OPS-RESOLVE-UI-01 — GUIDED RESOLUTION SESSION, ADDRESS PILOT: SESSION STATE.
 *
 * Product invariant under protection:
 *   A session row's state is OPEN -> RECHECKING -> FIXED, and ONLY the canonical
 *   disappearance of that order's active customer/incomplete_address constraint
 *   may move it to FIXED. A successful PATCH is never sufficient. Once FIXED, the
 *   row must REMAIN VISIBLE for the life of the session, even though the live
 *   canonical source no longer lists it.
 *
 * WHY THIS IS A NEW CONTRACT rather than a copy of an existing one:
 *   OrderDetailModalBody already implements the single-order recheck
 *   (addressRecheckPending, cleared only when hasActiveCustomerConstraint goes
 *   false) and ADDR-UI-03 already protects it. But that surface derives row
 *   VISIBILITY directly from live constraint truth, so canonical disappearance
 *   UNMOUNTS the row — ADDR-UI-03 asserts exactly that. A session needs the
 *   opposite retention behaviour, so it needs its own contract. The two surfaces
 *   legitimately differ and neither test should be relaxed to match the other.
 *
 * SCOPE: session orchestration and per-row state only. Address form validation,
 * assist pre-fill and correctionSource provenance are already covered by
 * OrderDetailModalBody.customer-address.test.tsx and are NOT re-tested here.
 *
 * MOCK BOUNDARY: the smallest set of EXISTING hooks —
 *   - pages/orders/useOrderDecision : the canonical per-order constraint oracle.
 *     Its endpoint (GET /:orderId/decision) reads order_constraints with
 *     `is_active: true`, applies NO election, and exposes block_type, so it is a
 *     legitimate per-row FIXED oracle. Keyed by orderId here so Order A and
 *     Order B move independently.
 *   - pages/orders/useShippingAddress : controlled mutation success, so the test
 *     decides when the PATCH "succeeds" — the same technique ADDR-UI-03 uses.
 *   Nothing about constraint semantics is re-implemented locally.
 *
 * NOT YET IMPLEMENTED — this suite is RED by design. Target boundary:
 *   apps/frontend/src/pages/orders/AddressResolutionSessionModal.tsx
 */
import React from 'react';
import { render, screen, act, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockNavigate = jest.fn();
const mockUseOrderDecision = jest.fn();
const mockUpdateAddress = jest.fn();

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

jest.mock('pages/orders/useOrderDecision', () => ({
  useOrderDecision: (...args: unknown[]) => mockUseOrderDecision(...args),
  useExecuteOrderDecision: () => ({
    mutate: jest.fn(), isPending: false, isSuccess: false, isError: false, error: null,
  }),
}));

jest.mock('pages/orders/useShippingAddress', () => ({
  useUpdateShippingAddress: () => ({
    mutate: mockUpdateAddress,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
  }),
}));

jest.mock('pages/orders/useOrderDetail', () => ({
  useOrderDetail: () => ({
    data: {
      shipping: {
        name: 'Ada Lovelace', address1: '', address2: null,
        city: '', zip: '', province: null, countryCode: '', phone: null,
      },
      addressAssist: null,
    },
    isLoading: false,
    isError: false,
  }),
}));

import AddressResolutionSessionModal from 'pages/orders/AddressResolutionSessionModal';

const ORDER_A = 'order-a-00000000-0000-0000-0000-00000000000a';
const ORDER_B = 'order-b-00000000-0000-0000-0000-00000000000b';

const ADDRESS_CONSTRAINT = {
  constraint_type: 'customer',
  block_type: 'incomplete_address',
  is_active: true,
};

/** Per-order canonical truth. Absent entry => no active address constraint. */
let canonical: Record<string, { constraints: unknown[] }> = {};

function setCanonical(next: Record<string, { constraints: unknown[] }>) {
  canonical = next;
  mockUseOrderDecision.mockImplementation((orderId: string) => ({
    data: { decision: null, constraints: canonical[orderId]?.constraints ?? [] },
    isLoading: false,
    isError: false,
    error: null,
  }));
}

const SESSION_ORDERS = [
  { lasyncroOrderId: ORDER_A, orderNumber: '#1001' },
  { lasyncroOrderId: ORDER_B, orderNumber: '#1002' },
];

function SessionHost({ queryClient }: { queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AddressResolutionSessionModal open orders={SESSION_ORDERS} onClose={jest.fn()} />
    </QueryClientProvider>
  );
}

function renderSession() {
  return render(<SessionHost queryClient={new QueryClient()} />);
}

const row = (orderId: string) => screen.getByTestId(`address-session-row-${orderId}`);
const rowState = (orderId: string) => row(orderId).getAttribute('data-state');

/** Fires the mutation's own onSuccess under test control (ADDR-UI-03 technique). */
function completePatch(callIndex = 0) {
  const call = mockUpdateAddress.mock.calls[callIndex];
  expect(call).toBeDefined();
  const onSuccess = call[1]?.onSuccess;
  expect(typeof onSuccess).toBe('function');
  act(() => {
    onSuccess({ message: 'Shipping address updated' }, call[0], undefined);
  });
}

/**
 * Valid required-field values. ShippingAddressResolver preserves the existing
 * required-field rule (address1 && city && zip && countryCode, all trimmed), so
 * Save stays disabled until these are present — exactly as it does in Order
 * Detail. This is fixture mechanics only; the rule itself is production
 * behaviour and is not under test here.
 */
const VALID_ADDRESS = {
  address1: '123 Test Street',
  city: 'Stockholm',
  zip: '11122',
  countryCode: 'SE',
};

/**
 * Open a row's correction treatment, complete the required fields, save.
 *
 * Field queries mirror openDialogAndFill() in
 * OrderDetailModalBody.customer-address.test.tsx — same labels, same
 * fireEvent.change mechanics — because both surfaces render the same
 * ShippingAddressResolver. Only one row's resolver is open at a time, so the
 * document-level label queries are unambiguous.
 */
function fixOrder(orderId: string) {
  fireEvent.click(within(row(orderId)).getByRole('button', { name: /fix/i }));

  fireEvent.change(screen.getByLabelText(/Address line 1/), {
    target: { value: VALID_ADDRESS.address1 },
  });
  fireEvent.change(screen.getByLabelText(/^City/), {
    target: { value: VALID_ADDRESS.city },
  });
  fireEvent.change(screen.getByLabelText(/ZIP \/ Postal code/), {
    target: { value: VALID_ADDRESS.zip },
  });
  fireEvent.change(screen.getByLabelText(/Country code/), {
    target: { value: VALID_ADDRESS.countryCode },
  });

  fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
}

beforeEach(() => {
  jest.clearAllMocks();
  // Both orders start genuinely blocked.
  setCanonical({
    [ORDER_A]: { constraints: [ADDRESS_CONSTRAINT] },
    [ORDER_B]: { constraints: [ADDRESS_CONSTRAINT] },
  });
});

describe('OPS-RESOLVE-UI-01 — OPEN -> RECHECKING -> FIXED, and session retention', () => {
  it('captures both rows OPEN, rechecks A on PATCH success without claiming FIXED, then FIXES A only on canonical disappearance while B stays OPEN', async () => {
    const { rerender } = renderSession();

    // Captured rows both start OPEN.
    expect(rowState(ORDER_A)).toBe('OPEN');
    expect(rowState(ORDER_B)).toBe('OPEN');
    expect(screen.getByTestId('address-session-progress')).toHaveTextContent('0 of 2');

    expect(screen.queryByTestId('address-session-rechecking-indicator')).not.toBeInTheDocument();

    // 1/2. Fix A, and the PATCH succeeds under test control.
    fixOrder(ORDER_A);
    expect(mockUpdateAddress).toHaveBeenCalledTimes(1);
    expect(mockUpdateAddress.mock.calls[0][0]).toMatchObject({ orderId: ORDER_A });
    completePatch();

    // 3/4/5. Canonical truth STILL reports the address block, so A is
    // RECHECKING and must NOT claim FIXED. The PATCH response proves nothing.
    await waitFor(() => expect(rowState(ORDER_A)).toBe('RECHECKING'));
    expect(rowState(ORDER_A)).not.toBe('FIXED');

    // 6/7. B is untouched and independently OPEN; nothing counted as resolved.
    expect(rowState(ORDER_B)).toBe('OPEN');
    expect(screen.getByTestId('address-session-progress')).toHaveTextContent('0 of 2');

    // Canonical count stays truthful while verification is pending, but the
    // session must visibly communicate that work is still in progress.
    expect(screen.getByTestId('address-session-rechecking-indicator')).toBeInTheDocument();

    // 8. Canonical truth for A now reports the constraint gone. B unchanged.
    setCanonical({
      [ORDER_A]: { constraints: [] },
      [ORDER_B]: { constraints: [ADDRESS_CONSTRAINT] },
    });
    rerender(<SessionHost queryClient={new QueryClient()} />);

    // 9. Only now is A FIXED.
    await waitFor(() => expect(rowState(ORDER_A)).toBe('FIXED'));
    expect(screen.queryByTestId('address-session-rechecking-indicator')).not.toBeInTheDocument();

    // 10. A REMAINS VISIBLE despite canonical disappearance.
    expect(row(ORDER_A)).toBeInTheDocument();
    // toHaveTextContent, not getByText('#1001'): the row legitimately renders
    // "Order #1001" as one label, and getByText's default exact matcher would
    // require the bare number to be an element of its own — an incidental DOM
    // shape constraint. This still asserts the same contract: row A is present
    // and identifiable by its order number.
    expect(row(ORDER_A)).toHaveTextContent('#1001');

    // 11/12. B is still open work; progress reflects exactly one of two.
    expect(rowState(ORDER_B)).toBe('OPEN');
    expect(screen.getByTestId('address-session-progress')).toHaveTextContent('1 of 2');
    expect(screen.getAllByTestId(/^address-session-row-/)).toHaveLength(2);
  });

  it('retains a FIXED row even when the live canonical source lists no address-blocked orders at all', async () => {
    const { rerender } = renderSession();

    fixOrder(ORDER_A);
    completePatch();
    await waitFor(() => expect(rowState(ORDER_A)).toBe('RECHECKING'));

    // Every order clears canonically — a live session source would now be
    // empty. Session membership was CAPTURED, so nothing may be dropped.
    setCanonical({ [ORDER_A]: { constraints: [] }, [ORDER_B]: { constraints: [] } });
    rerender(<SessionHost queryClient={new QueryClient()} />);

    await waitFor(() => expect(rowState(ORDER_A)).toBe('FIXED'));
    expect(screen.getAllByTestId(/^address-session-row-/)).toHaveLength(2);
    expect(row(ORDER_A)).toBeInTheDocument();
    expect(row(ORDER_B)).toBeInTheDocument();

    // B was never worked on in this session: canonical clearance alone must not
    // credit it as a resolution the merchant performed here.
    expect(rowState(ORDER_B)).not.toBe('RECHECKING');
    expect(screen.getByTestId('address-session-progress')).toHaveTextContent('1 of 2');
  });

  it('never marks a row FIXED from the mutation response alone', async () => {
    renderSession();

    fixOrder(ORDER_A);
    completePatch();

    // Canonical truth never changes here. Whatever the PATCH returned, the row
    // is not FIXED and progress records nothing.
    await waitFor(() => expect(rowState(ORDER_A)).toBe('RECHECKING'));
    expect(rowState(ORDER_A)).not.toBe('FIXED');
    expect(screen.getByTestId('address-session-progress')).toHaveTextContent('0 of 2');
  });
});

describe('OPS-RESOLVE-UI-02 — rechecking transition feedback', () => {
  it('keeps verification feedback subtle and disables motion for reduced-motion users', () => {
    const fs = require('fs');
    const path = require('path');

    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        'apps/frontend/src/pages/orders/AddressResolutionSessionModal.tsx'
      ),
      'utf8'
    );

    // Header: a small spinner communicates pending canonical verification.
    expect(source).toMatch(/data-testid="address-session-rechecking-indicator"/);
    expect(source).toMatch(/width: 12/);
    expect(source).toMatch(/height: 12/);
    expect(source).toMatch(/addressSessionSpin 700ms linear infinite/);

    // Row: only the RECHECKING status copy receives the subtle pulse.
    expect(source).toMatch(/state === 'RECHECKING'/);
    expect(source).toMatch(/addressSessionRecheckPulse 1400ms ease-in-out infinite/);
    expect(source).toMatch(/'50%': \{ opacity: 0\.68 \}/);

    // Accessibility: motion is removed while the pending state remains visible.
    expect(source).toMatch(/'@media \(prefers-reduced-motion: reduce\)'/);
    expect(source).toMatch(/animation: 'none'/);
  });
});
