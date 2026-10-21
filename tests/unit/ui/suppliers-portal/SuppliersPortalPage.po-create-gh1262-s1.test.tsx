import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';

import SuppliersPortalPage from 'pages/ft2-pages/SuppliersPortalPage';
import { axiosInstance } from 'api/axiosConfig';

/**
 * GH-1262 S1 R10-C — Create PO HTTP transport
 * -------------------------------------------
 * The REAL axiosInstance (interceptors included) is exercised; only its
 * network adapter is replaced, so these cases observe the exact request the
 * page would put on the wire.
 *
 *   S1-R10-08  the page sends the operation key as the Idempotency-Key header,
 *              keeps the { …CreatePoInput } body free of key fields, refreshes
 *              on success, and fails closed without a key
 *   S1-R10-09  an inline-supplier PO is one POST /purchase-orders — the page
 *              never performs a separate POST /suppliers
 */

const PO_INPUT = {
  new_supplier: { name: 'Inline Supplier Co' },
  line_items: [
    { description: 'S1 line', quantity_ordered: 3, lasyncro_variant_id: 'variant-gh1262-s1' },
  ],
};

const mockRefetch = jest.fn();
const captured: Array<{ status: 'resolved' | 'rejected'; value: unknown }> = [];

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 7, role: 'owner' } }),
}));

jest.mock('pages/suppliers-portal/useSuppliersPortal', () => ({
  useSuppliersPortal: () => ({
    data: { purchase_orders: [], suppliers: [], never_ordered: [], never_ordered_count: 0 },
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
  }),
}));

jest.mock('hooks/useSpotlight', () => ({
  useSpotlight: () => ({ isDismissed: false, dismiss: jest.fn() }),
}));

jest.mock('components/ModuleTabBar', () => ({ ModuleTabBar: () => null }));

jest.mock('components/CommercialGate', () => ({
  CommercialGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// The module is replaced by two triggers that call the page's real
// onCreatePo exactly as CreatePoDialog does — with and without a key.
jest.mock('@lasyncro/suppliers-portal', () => ({
  SuppliersPortalModuleFT2: (props: {
    onCreatePo: (input: unknown, options: { idempotencyKey: string }) => Promise<void>;
  }) => {
    const run = async (options: { idempotencyKey: string }) => {
      try {
        captured.push({ status: 'resolved', value: await props.onCreatePo(PO_INPUT, options) });
      } catch (error) {
        captured.push({ status: 'rejected', value: error });
      }
    };
    return (
      <>
        <button type="button" onClick={() => void run({ idempotencyKey: 'op-key-gh1262-s1' })}>
          create with key
        </button>
        <button type="button" onClick={() => void run({ idempotencyKey: '' })}>
          create without key
        </button>
      </>
    );
  },
}));

type SentRequest = { method: string; url: string; idempotencyKey: unknown; body: unknown };
const sent: SentRequest[] = [];
const originalAdapter = axiosInstance.defaults.adapter;

const recordingAdapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
  const headers: any = config.headers;
  sent.push({
    method: (config.method ?? 'get').toLowerCase(),
    url: config.url ?? '',
    idempotencyKey: typeof headers?.get === 'function' ? headers.get('Idempotency-Key') : headers?.['Idempotency-Key'],
    body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
  });

  const isPoCreate = config.method === 'post' && config.url === '/api/v1/suppliers/purchase-orders';
  return {
    data: isPoCreate ? { purchase_order: { id: 'po-gh1262-s1' } } : {},
    status: isPoCreate ? 201 : 200,
    statusText: isPoCreate ? 'Created' : 'OK',
    headers: {},
    config,
  };
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <SuppliersPortalPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function writes() {
  return sent.filter((r) => r.method !== 'get');
}

beforeEach(() => {
  sent.length = 0;
  captured.length = 0;
  mockRefetch.mockReset();
  axiosInstance.defaults.adapter = recordingAdapter;
});

afterAll(() => {
  axiosInstance.defaults.adapter = originalAdapter;
});

describe('GH-1262 S1 R10-C — Create PO HTTP transport', () => {
  it('S1-R10-08: the operation key travels only as the Idempotency-Key header; no key fails closed', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'create with key' }));
    await waitFor(() => expect(captured).toHaveLength(1));

    expect(captured[0].status).toBe('resolved');
    expect(writes()).toEqual([
      {
        method: 'post',
        url: '/api/v1/suppliers/purchase-orders',
        idempotencyKey: 'op-key-gh1262-s1',
        body: PO_INPUT,
      },
    ]);
    expect(JSON.stringify(writes()[0].body)).not.toMatch(/idempotency/i);
    expect(mockRefetch).toHaveBeenCalledTimes(1);

    sent.length = 0;
    fireEvent.click(screen.getByRole('button', { name: 'create without key' }));
    await waitFor(() => expect(captured).toHaveLength(2));

    expect(captured[1].status).toBe('rejected');
    expect(writes()).toEqual([]);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('S1-R10-09: an inline-supplier PO never triggers a separate POST /suppliers', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'create with key' }));
    await waitFor(() => expect(captured).toHaveLength(1));

    expect(writes().filter((r) => r.url === '/api/v1/suppliers')).toEqual([]);
    expect(writes().map((r) => `${r.method} ${r.url}`)).toEqual([
      'post /api/v1/suppliers/purchase-orders',
    ]);
  });
});
