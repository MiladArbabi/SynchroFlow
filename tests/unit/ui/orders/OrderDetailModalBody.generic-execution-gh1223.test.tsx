import React, { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { OrderDetailModalBody } from 'pages/orders/OrderDetailModalBody';

/**
 * GH-1223 / TIER-08 — generic execution parity with the backend boundary.
 *
 * The backend admits only USER-executable actions through generic
 * POST /orders/:orderId/execute (today: resolve_operational_block). The Order
 * Detail footer must therefore never offer the generic execute(orderId) CTA
 * for any other recommended action — including unknown ones, which must not
 * fall back to "Take action".
 *
 * Harness reused from OrderDetailModalBody.inventory-sourcing.test.tsx
 * (mocked useOrderDecision / useExecuteOrderDecision, footer captured through
 * onFooterReady). No role logic: GH-1222 already excludes operators from the
 * Orders frontend routes.
 */

const mockNavigate = jest.fn();
const mockExecute = jest.fn();
const mockUseOrderDecision = jest.fn();

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
    mutate: jest.fn(),
    isPending: false,
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

function constraint(constraint_type: string, block_type: string | null): Constraint {
  return {
    constraint_type,
    block_type,
    target_id: null,
    target_status: null,
    started_at: '2026-10-07T12:00:00.000Z',
  };
}

function decisionResponse(actionType: string, constraints: Constraint[]) {
  return {
    decision: {
      id: `decision-${actionType}`,
      type: 'operational',
      entity_id: 'order-1',
      status: 'pending',
      priority: 10,
      reason: 'GH-1223 fixture',
      recommended_action: {
        type: actionType,
        payload: {},
        execution_mode: 'manual',
      },
      actions: [],
      lifecycle: null,
      created_at: '2026-10-07T12:00:00.000Z',
      updated_at: '2026-10-07T12:00:00.000Z',
    },
    constraints,
  };
}

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

function renderWithDecision(actionType: string, constraints: Constraint[]) {
  mockUseOrderDecision.mockReturnValue({
    data: decisionResponse(actionType, constraints),
    isLoading: false,
    isError: false,
    error: null,
  });

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(<ModalHost queryClient={queryClient} />);
}

/**
 * Exercises every footer action (the only place execute(orderId) is wired):
 * execute() must not be reachable through this decision by ANY CTA, not
 * merely by one expected label.
 */
function expectNoGenericExecution() {
  within(screen.getByTestId('modal-footer'))
    .queryAllByRole('button')
    .forEach((button) => fireEvent.click(button));
  expect(mockExecute).not.toHaveBeenCalled();
}

describe('OrderDetailModalBody generic execution parity — GH-1223', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseOrderDetail.mockReturnValue({ data: null, isLoading: false });
  });

  it('F1 GREEN CONTROL: resolve_operational_block keeps "Mark as resolved" wired to execute(orderId)', () => {
    renderWithDecision('resolve_operational_block', [constraint('operational', 'manual_hold')]);

    fireEvent.click(
      within(screen.getByTestId('modal-footer')).getByRole('button', { name: 'Mark as resolved' })
    );

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith('order-1');
  });

  it('F2 EXPECTED RED: resolve_customer_block without incomplete_address exposes no generic "Flag for customer review" execute CTA', () => {
    renderWithDecision('resolve_customer_block', [
      constraint('customer', 'awaiting_customer_response'),
    ]);

    expect(screen.queryByRole('button', { name: 'Flag for customer review' })).not.toBeInTheDocument();
    expectNoGenericExecution();
  });

  it('F3 EXPECTED RED: unknown recommended action gets no fallback "Take action" execute CTA', () => {
    renderWithDecision('gh1223_unknown_action', [constraint('operational', 'manual_hold')]);

    expect(screen.queryByRole('button', { name: 'Take action' })).not.toBeInTheDocument();
    expectNoGenericExecution();
  });

  it('F4 GREEN CONTROL: proceed_fulfillment exposes no generic execution CTA', () => {
    renderWithDecision('proceed_fulfillment', []);

    expect(screen.queryByRole('button', { name: 'Take action' })).not.toBeInTheDocument();
    expectNoGenericExecution();
  });

  it('F5 GREEN CONTROL: open_sourcing exposes no generic execution CTA', () => {
    renderWithDecision('open_sourcing', [constraint('inventory', 'oversell')]);

    expect(screen.queryByRole('button', { name: 'Take action' })).not.toBeInTheDocument();
    expectNoGenericExecution();
  });

  it('F6 GREEN CONTROL: open_return_job exposes no generic execution CTA', () => {
    renderWithDecision('open_return_job', [constraint('operational', 'returned_undelivered')]);

    expect(screen.queryByRole('button', { name: 'Take action' })).not.toBeInTheDocument();
    expectNoGenericExecution();
  });
});
