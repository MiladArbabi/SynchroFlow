// WS-UX-01 S2 — refetchPurchaseOrders is the awaitable, authoritative PO
// re-read used to reconcile Receive assignment. It must resolve only with a
// completed, usable response and reject otherwise, while the generic refetch
// keeps its fire-and-forget contract.
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useSuppliersPortal } from 'pages/suppliers-portal/useSuppliersPortal';

const mockGet = jest.fn();
jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: (...args: unknown[]) => mockGet(...args) },
}));

function respond(purchaseOrdersBody: unknown) {
  mockGet.mockImplementation((url: string) =>
    Promise.resolve({
      data: url === '/api/v1/suppliers/purchase-orders' ? purchaseOrdersBody : { suppliers: [] },
    })
  );
}

function renderPortal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSuppliersPortal(), { wrapper });
}

beforeEach(() => mockGet.mockReset());

describe('useSuppliersPortal.refetchPurchaseOrders (WS-UX-01 S2)', () => {
  it('resolves with the freshly re-read canonical purchase orders', async () => {
    respond({ purchase_orders: [{ id: 'po-1', receive_job_id: null }] });
    const { result } = renderPortal();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    respond({ purchase_orders: [{ id: 'po-1', receive_job_id: 'receive-new' }] });
    const fresh = await result.current.refetchPurchaseOrders();

    expect(fresh).toEqual([{ id: 'po-1', receive_job_id: 'receive-new' }]);
    expect(mockGet).toHaveBeenLastCalledWith('/api/v1/suppliers/purchase-orders');
  });

  it('rejects when the re-read fails', async () => {
    respond({ purchase_orders: [] });
    const { result } = renderPortal();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockGet.mockImplementation(() => Promise.reject(new Error('Network Error')));

    await expect(result.current.refetchPurchaseOrders()).rejects.toThrow('Network Error');
  });

  it.each([
    ['missing purchase_orders', {}],
    ['non-array purchase_orders', { purchase_orders: 'nope' }],
    ['a row without an id', { purchase_orders: [{ receive_job_id: null }] }],
  ])('rejects an unusable response: %s', async (_label, body) => {
    respond({ purchase_orders: [] });
    const { result } = renderPortal();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    respond(body);

    await expect(result.current.refetchPurchaseOrders()).rejects.toThrow(
      'Purchase order response was unusable.'
    );
  });

  it('leaves the generic refetch fire-and-forget (returns undefined)', async () => {
    respond({ purchase_orders: [] });
    const { result } = renderPortal();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.refetch()).toBeUndefined();
  });
});
