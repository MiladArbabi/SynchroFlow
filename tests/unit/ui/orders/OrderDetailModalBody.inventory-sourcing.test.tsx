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

function inventoryConstraint(targetId: string): Constraint {
  return {
    constraint_type: 'inventory',
    block_type: 'oversell',
    target_id: targetId,
    target_status: null,
    started_at: '2026-09-02T12:00:00.000Z',
  };
}

function decisionResponse(constraints: Constraint[]) {
  return {
    decision: {
      id: 'decision-inventory',
      type: 'inventory',
      entity_id: 'order-1',
      status: 'pending',
      priority: 80,
      reason: 'Inventory shortage',
      recommended_action: {
        // INV-ACTION-ARCH-01: new inventory decisions are workflow navigation.
        type: 'open_sourcing',
        payload: {},
        execution_mode: 'manual',
      },
      actions: [],
      lifecycle: null,
      created_at: '2026-09-02T12:00:00.000Z',
      updated_at: '2026-09-02T12:00:00.000Z',
    },
    constraints,
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

/**
 * SRC-L3-11A (SOURCING-UX-COGNITIVE-01 Slice 1A)
 * ----------------------------------------------
 * Every inventory-sourcing CTA must carry BOTH the canonical variant and the
 * canonical order the merchant came from. `order-1` is the internal
 * orders.lasyncro_order_id already supplied to this component — never an
 * external Shopify id or a display order number.
 */
describe('OrderDetailModalBody inventory sourcing contract — ORD-DECISION-01 Slice 2', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('INV-RED-06 routes an active stockout to Sourcing instead of executing the decision', () => {
    mockUseOrderDecision.mockReturnValue({
      data: decisionResponse([inventoryConstraint('variant-a')]),
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    expect(screen.getByText(/Out of stock/i)).toBeInTheDocument();

    const sourceButton = screen.getByRole('button', {
      name: 'Source this item',
    });

    fireEvent.click(sourceButton);

    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(
      '/suppliers-portal/sourcing?variantId=variant-a&orderId=order-1'
    );
  });

  it('INV-RED-07 derives the Sourcing variant from active constraint target_id, not the stored decision payload', () => {
    mockUseOrderDecision.mockReturnValue({
      data: decisionResponse([inventoryConstraint('exact-blocked-variant')]),
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Source this item',
      })
    );

    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(
      '/suppliers-portal/sourcing?variantId=exact-blocked-variant&orderId=order-1'
    );
  });

  /**
   * INV-ACTION-ARCH-01 — the generic execute fallback previously labelled
   * `resolve_inventory_block` as "Go to sourcing" while running
   * execute(orderId), which reached a machine handler that could not resolve a
   * real stockout. `open_sourcing` must never reach that fallback.
   */
  it('INV-ACTION-07 never renders a generic execute CTA for open_sourcing', () => {
    mockUseOrderDecision.mockReturnValue({
      data: decisionResponse([inventoryConstraint('variant-1')]),
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    // The misleading generic label is gone entirely.
    expect(screen.queryByRole('button', { name: 'Go to sourcing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take action' })).not.toBeInTheDocument();

    // Constraint-driven routing remains the only inventory CTA.
    fireEvent.click(screen.getByRole('button', { name: 'Source this item' }));
    expect(mockExecute).not.toHaveBeenCalled();
  });

  /**
   * The real fall-through: an inventory constraint with no usable target_id
   * yields no sourcing target, so the elected `open_sourcing` decision reaches
   * the GENERIC execute branch — a "Take action" button wired to
   * execute(orderId). `open_sourcing` is workflow navigation with no execution
   * handler, so that button would POST an action the backend must refuse.
   * It must not be offered at all.
   */
  it('INV-ACTION-07 never offers generic execution for open_sourcing when no sourcing target exists', () => {
    const untargetedInventoryConstraint: Constraint = {
      constraint_type: 'inventory',
      block_type: 'oversell',
      target_id: null,
      target_status: null,
      started_at: '2026-09-02T12:00:00.000Z',
    };

    mockUseOrderDecision.mockReturnValue({
      data: decisionResponse([untargetedInventoryConstraint]),
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    expect(screen.queryByRole('button', { name: 'Take action' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go to sourcing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Source this item' })).not.toBeInTheDocument();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('INV-RED-08 keeps multiple blocked variants independently actionable', () => {
    mockUseOrderDecision.mockReturnValue({
      data: decisionResponse([
        inventoryConstraint('variant-a'),
        inventoryConstraint('variant-b'),
      ]),
      isLoading: false,
      isError: false,
      error: null,
    });

    renderModal();

    const sourceButtons = screen.getAllByRole('button', {
      name: /Source (this )?item/i,
    });

    expect(sourceButtons).toHaveLength(2);

    fireEvent.click(sourceButtons[0]);
    expect(mockNavigate).toHaveBeenLastCalledWith(
      '/suppliers-portal/sourcing?variantId=variant-a&orderId=order-1'
    );

    fireEvent.click(sourceButtons[1]);
    expect(mockNavigate).toHaveBeenLastCalledWith(
      '/suppliers-portal/sourcing?variantId=variant-b&orderId=order-1'
    );

    expect(mockExecute).not.toHaveBeenCalled();
  });
});
