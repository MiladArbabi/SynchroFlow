/**
 * GH #1057 follow-up — persisted priority hydration.
 *
 * Canonical priority truth lives in
 * order_fulfillment_status.is_priority_flagged.
 *
 * The Order Detail modal must:
 * - hydrate its initial Prioritized state from persisted order detail;
 * - preserve the existing optimistic Prioritize mutation for false state.
 */
import React, { ReactNode, useCallback, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { OrderDetailModalBody } from 'pages/orders/OrderDetailModalBody';

const mockNavigate = jest.fn();
const mockExecute = jest.fn();
const mockUseOrderDecision = jest.fn();
const mockUseOrderDetail = jest.fn();

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

jest.mock('@lasyncro/shared/ui', () => ({
  IsometricZoneView: () => <div data-testid="iso-zone-view" />,
}));

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

const noop = () => {};

function orderDetail(isPriorityFlagged: boolean) {
  return {
    id: 'order-1057',
    externalOrderId: '17041265623410',
    total: 120,
    subtotal: 100,
    tax: 20,
    currency: 'USD',
    paymentState: 'paid',
    createdAt: '2026-09-01T12:00:00.000Z',
    lineItems: [
      {
        id: 'line-1',
        sku: 'SKU-1',
        title: 'Test item',
        quantity: 1,
        unit_price: 100,
        line_total: 100,
        image_url: null,
      },
    ],
    fulfillment: {
      status: 'pending',
      inventory_block_type: null,
      customer_block_type: null,
      operational_block_type: null,
      fulfilled_at: null,
      status_updated_at: '2026-09-01T12:00:00.000Z',
      is_priority_flagged: isPriorityFlagged,
    },
    warehouseStatus: null,
    timeline: [],
    tracking: null,
    shipping: {
      name: 'Jane Doe',
      address1: '1 Test Way',
      address2: null,
      city: 'Stockholm',
      zip: '111 22',
      phone: null,
      province: null,
      countryCode: 'SE',
    },
    addressAssist: null,
    inventoryAssist: null,
  };
}

function setHealthyOrder(isPriorityFlagged: boolean) {
  mockUseOrderDecision.mockReturnValue({
    data: {
      decision: null,
      constraints: [],
    },
    isLoading: false,
    isError: false,
    error: null,
  });

  mockUseOrderDetail.mockReturnValue({
    data: orderDetail(isPriorityFlagged),
    isLoading: false,
    isError: false,
  });
}

function ModalHost({
  onPriorityFlag,
}: {
  onPriorityFlag: (orderIds: string[], flagged: boolean) => Promise<void>;
}) {
  const [footer, setFooter] = useState<ReactNode>(null);
  const onFooterReady = useCallback(
    (node: ReactNode) => setFooter(node),
    []
  );

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OrderDetailModalBody
          orderId="order-1057"
          onTitleReady={noop}
          onSubtitleReady={noop}
          onNavigateToOrder={noop}
          onFooterReady={onFooterReady}
          onPriorityFlag={onPriorityFlag}
          onClose={noop}
        />
        <div data-testid="modal-footer">{footer}</div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('GH-1057 — Order Detail priority hydration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hydrates persisted priority=true as Prioritized without re-running the mutation', async () => {
    setHealthyOrder(true);
    const onPriorityFlag = jest.fn().mockResolvedValue(undefined);

    render(<ModalHost onPriorityFlag={onPriorityFlag} />);

    const button = await screen.findByRole('button', {
      name: 'Prioritized ✓',
    });

    expect(button).toBeDisabled();
    expect(onPriorityFlag).not.toHaveBeenCalled();
  });

  it('preserves optimistic prioritization when persisted priority=false', async () => {
    setHealthyOrder(false);
    const onPriorityFlag = jest.fn().mockResolvedValue(undefined);

    render(<ModalHost onPriorityFlag={onPriorityFlag} />);

    const button = await screen.findByRole('button', {
      name: 'Prioritize',
    });

    fireEvent.click(button);

    await waitFor(() => {
      expect(onPriorityFlag).toHaveBeenCalledWith(
        ['order-1057'],
        true
      );
    });

    expect(
      await screen.findByRole('button', {
        name: 'Prioritized ✓',
      })
    ).toBeDisabled();
  });
});
