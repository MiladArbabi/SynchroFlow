import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import ReturnsItemsPage from 'pages/ft2-pages/ReturnsItemsPage';
import { axiosInstance } from 'api/axiosConfig';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: jest.fn(),
    patch: jest.fn(),
  },
}));

jest.mock('@lasyncro/shared/ui', () => ({
  EntityDetailModal: ({ entityId, title, onClose, children }: any) =>
    entityId ? (
      <section data-testid="return-modal">
        <h2>{title}</h2>
        <button type="button" onClick={onClose}>Close</button>
        {children}
      </section>
    ) : null,
}));

const returnItemsResponse = {
  data: [
    {
      return_job_id: 'return-job-1',
      external_order_id: '1001',
      created_at: '2026-09-01T12:00:00.000Z',
      total_refund_amount: 100,
      lines: [
        {
          id: 'line-1',
          variant_title: 'Black tee',
          sku: 'TEE-BLK',
          quantity: 1,
          item_condition: 'damaged',
          condition_notes: null,
          owner_decision: null,
          decision_notes: null,
          decided_at: null,
        },
      ],
    },
  ],
};

function renderPage(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/returns/items" element={<ReturnsItemsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ReturnsItemsPage return-job deep link', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (axiosInstance.get as jest.Mock).mockResolvedValue({ data: returnItemsResponse });
  });

  it('auto-opens the existing owner-decision modal for a matching returnJobId', async () => {
    renderPage('/returns/items?returnJobId=return-job-1');

    expect(await screen.findByTestId('return-modal')).toHaveTextContent('Order #1001');
    expect(screen.getByText('Black tee')).toBeInTheDocument();
  });

  it('preserves normal card-open behavior when returnJobId is absent', async () => {
    renderPage('/returns/items');

    expect(await screen.findByText('Order #1001')).toBeInTheDocument();
    expect(screen.queryByTestId('return-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Order #1001'));

    expect(screen.getByTestId('return-modal')).toHaveTextContent('Order #1001');
  });
});
