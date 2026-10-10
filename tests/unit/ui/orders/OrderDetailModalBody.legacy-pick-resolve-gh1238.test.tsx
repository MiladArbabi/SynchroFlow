import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { OrderDetailModalBody } from 'pages/orders/OrderDetailModalBody';

/**
 * GH-1238 / PC-SAFE-01 W4 — the legacy direct Pick-exception resolution
 * shortcut is retired. Order Detail may still SHOW an open Pick exception,
 * but no control on it may call the legacy
 * POST /wms/problem-center/pick-exceptions/:id/resolve closure
 * (useResolvePickException) without canonical recovery evidence.
 *
 * Harness reused from OrderDetailModalBody.generic-execution-gh1223.test.tsx.
 */

const mockLegacyResolve = jest.fn();

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return { ...actual, useNavigate: () => jest.fn() };
});

jest.mock('pages/orders/useOrderDecision', () => ({
  useOrderDecision: () => ({ data: null, isLoading: false, isError: false, error: null }),
  useExecuteOrderDecision: () => ({
    mutate: jest.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
}));

jest.mock('pages/orders/useOrderDetail', () => ({
  useOrderDetail: () => ({ data: null, isLoading: false }),
}));

jest.mock('pages/orders/usePickExceptionsForOrder', () => ({
  usePickExceptionsForOrder: () => ({
    isLoading: false,
    data: {
      exceptions: [
        {
          pick_exception_id: 'pe-gh1238-1',
          pick_batch_id: 'batch-gh1238',
          lasyncro_line_item_id: 'line-gh1238',
          lasyncro_variant_id: 'variant-gh1238',
          exception_type: 'item_missing',
          stage: 'pick',
          quantity_required: 1,
          quantity_found: 0,
          raised_by: 7,
          raised_at: '2026-10-10T08:00:00.000Z',
          resolved: false,
          resolved_by: null,
          resolved_at: null,
          resolution_note: null,
          variant_title: 'GH1238 Widget',
          sku: 'SKU-GH1238',
          lasyncro_order_id: 'order-1',
          batch_short_id: 'GH1238',
        },
      ],
      total_unresolved: 1,
    },
  }),
  useResolvePickException: () => ({ mutate: mockLegacyResolve, isPending: false }),
}));

jest.mock('pages/problem-center/usePackDecisions', () => ({
  useOrderPackDecisions: () => ({ data: { requests: [] }, isLoading: false }),
}));

jest.mock('pages/orders/useShippingAddress', () => ({
  useUpdateShippingAddress: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock('hooks/useCurrency', () => ({
  useCurrency: () => ({
    format: (value: number | null | undefined) =>
      value == null ? '—' : `$${Number(value).toLocaleString('en-US')}`,
  }),
}));

const noop = () => {};

/**
 * The footer is not under test (the Pick-exception control lives in the
 * body), so onFooterReady is a stable no-op: no host state, no re-render
 * cycle from the per-render mocked hook results.
 */
function ModalHost({ queryClient }: { queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OrderDetailModalBody
          orderId="order-1"
          onTitleReady={noop}
          onSubtitleReady={noop}
          onNavigateToOrder={noop}
          onFooterReady={noop}
          onClose={noop}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderHost() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<ModalHost queryClient={queryClient} />);
}

describe('GH-1238 C-UI — Order Detail Pick-exception shortcut', () => {
  beforeEach(() => jest.clearAllMocks());

  it('C-UI GREEN CONTROL: the open Pick exception stays visible on Order Detail', () => {
    renderHost();

    expect(screen.getByText(/item missing — GH1238 Widget/)).toBeInTheDocument();
  });

  it('C-UI EXPECTED RED: no control on the open Pick exception calls the legacy direct resolve', () => {
    renderHost();

    screen.queryAllByRole('button', { name: /resolve/i }).forEach((button) => fireEvent.click(button));

    expect(mockLegacyResolve).not.toHaveBeenCalled();
  });
});
