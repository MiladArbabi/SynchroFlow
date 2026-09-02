import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { OrderDetailModalBody } from 'pages/orders/OrderDetailModalBody';

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

jest.mock('pages/orders/useOrderDetail', () => ({
  useOrderDetail: () => ({
    data: null,
    isLoading: false,
  }),
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

const CUSTOMER_CONSTRAINT: Constraint = {
  constraint_type: 'customer',
  block_type: 'incomplete_address',
  target_id: null,
  target_status: null,
  started_at: '2026-09-01T12:00:00.000Z',
};

function decisionResponse(
  targetStatus: string | null,
  actionType = 'open_return_job',
  extraConstraints: Constraint[] = []
) {
  return {
    decision: {
      id: 'decision-1',
      type: 'operational',
      entity_id: 'order-1',
      status: 'pending',
      priority: 50,
      reason: `Derived from ${actionType}`,
      recommended_action: {
        type: actionType,
        payload: { block_type: 'returned_undelivered' },
        execution_mode: 'manual',
      },
      actions: [],
      lifecycle: null,
      created_at: '2026-09-01T12:00:00.000Z',
      updated_at: '2026-09-01T12:00:00.000Z',
    },
    constraints: [
      {
        constraint_type: 'operational',
        block_type: 'returned_undelivered',
        target_id: 'return-job-1',
        target_status: targetStatus,
        started_at: '2026-09-01T12:00:00.000Z',
      },
      ...extraConstraints,
    ],
  };
}

function renderModal() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OrderDetailModalBody
          orderId="order-1"
          onTitleReady={jest.fn()}
          onSubtitleReady={jest.fn()}
          onNavigateToOrder={jest.fn()}
          onFooterReady={jest.fn()}
          onClose={jest.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('OrderDetailModalBody returned-undelivered routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['pending', 'in_progress'])(
    'routes %s returned packages to the exact WMS return session',
    (status) => {
      mockUseOrderDecision.mockReturnValue({
        data: decisionResponse(status),
        isLoading: false,
        isError: false,
        error: null,
      });

      renderModal();

      expect(screen.getByText('Package returned')).toBeInTheDocument();
      expect(screen.getByText('The carrier returned this package before delivery.')).toBeInTheDocument();
      expect(screen.queryByText('Pick Exception')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Mark as resolved' })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Process return' }));

      expect(mockExecute).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/wms?returnJobId=return-job-1');
    }
  );

  it('routes awaiting-decision returned packages to the exact Returns item job', () => {
    mockUseOrderDecision.mockReturnValue({
      data: decisionResponse('awaiting_decision'),
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Review return' }));

    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/returns/items?returnJobId=return-job-1');
  });

  it('does not render an actionable returned-package CTA when the linked return is complete', () => {
    mockUseOrderDecision.mockReturnValue({
      data: decisionResponse('complete'),
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    expect(screen.getByText('Package returned')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Process return' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review return' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as resolved' })).not.toBeInTheDocument();
  });

  // RET-CTA-DECOUPLE — the returned-package CTA is driven by the active
  // returned_undelivered constraint + its target_status, NOT by whichever
  // decision the engine happened to elect. A co-active inventory/SLA
  // blocker (whose decision outranks open_return_job) must not hide it.
  it('A — shows Process return + routes to WMS when the elected decision is resolve_inventory_block', () => {
    mockUseOrderDecision.mockReturnValue({
      data: decisionResponse('pending', 'resolve_inventory_block'),
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    expect(screen.getByText('Package returned')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Process return' }));

    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/wms?returnJobId=return-job-1');
  });

  it('B — shows Review return + routes to Returns items when the elected decision is not open_return_job', () => {
    mockUseOrderDecision.mockReturnValue({
      data: decisionResponse('awaiting_decision', 'resolve_inventory_block'),
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    expect(screen.getByText('Package returned')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review return' }));

    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/returns/items?returnJobId=return-job-1');
  });

  it('C — suppresses the returned-package CTA while a customer constraint is active', () => {
    mockUseOrderDecision.mockReturnValue({
      data: decisionResponse('pending', 'resolve_inventory_block', [CUSTOMER_CONSTRAINT]),
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    expect(screen.queryByRole('button', { name: 'Process return' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review return' })).not.toBeInTheDocument();
  });

  it('D — renders no returned-package CTA when no returned_undelivered constraint is active', () => {
    mockUseOrderDecision.mockReturnValue({
      data: {
        decision: null,
        constraints: [
          {
            constraint_type: 'inventory',
            block_type: 'oversell',
            target_id: null,
            target_status: null,
            started_at: '2026-09-01T12:00:00.000Z',
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    expect(screen.queryByText('Package returned')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Process return' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review return' })).not.toBeInTheDocument();
  });

  it('E — renders no returned-package CTA when the linked return_job status is complete', () => {
    mockUseOrderDecision.mockReturnValue({
      data: decisionResponse('complete', 'resolve_inventory_block'),
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    expect(screen.queryByRole('button', { name: 'Process return' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review return' })).not.toBeInTheDocument();
  });

  it('leaves unrelated operational constraints on the generic action path', () => {
    mockUseOrderDecision.mockReturnValue({
      data: {
        ...decisionResponse(null, 'resolve_operational_block'),
        constraints: [
          {
            constraint_type: 'operational',
            block_type: 'manual_hold',
            target_id: null,
            target_status: null,
            started_at: '2026-09-01T12:00:00.000Z',
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    expect(screen.getByText('Pick Exception')).toBeInTheDocument();
    expect(screen.getByText('manual hold')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as resolved' }));
    expect(mockExecute).toHaveBeenCalledWith('order-1');
  });
});
