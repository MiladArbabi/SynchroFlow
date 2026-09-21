// GH-1143 RECEIVE-REASSIGN-UI-01
//
// Adapter contract: "reassignment callback uses the existing assignment PATCH
// and refreshes canonical state." Mirrors the established stub pattern in
// tests/unit/ui/suppliers-portal/SuppliersPortalPage.receive-recovery-1109.test.tsx.
//
// This file assumes a new `onReassignReceiveJob` prop threaded from
// SuppliersPortalPage into SuppliersPortalModuleFT2 (see DEVIATIONS in the
// reporting brief) — not yet present in apps/frontend/src/pages/ft2-pages/
// SuppliersPortalPage.tsx's sharedProps.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import SuppliersPortalPage from 'pages/ft2-pages/SuppliersPortalPage';
import { axiosInstance } from 'api/axiosConfig';

let capturedProps: any = null;
const capturedResults: Array<{ status: 'resolved' | 'rejected'; value: unknown }> = [];

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
  },
}));

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 3, role: 'owner' } }),
}));

jest.mock('pages/suppliers-portal/useSuppliersPortal', () => ({
  useSuppliersPortal: () => ({
    data: {
      purchase_orders: [],
      suppliers: [],
      never_ordered: [],
      never_ordered_count: 0,
    },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

jest.mock('hooks/useSpotlight', () => ({
  useSpotlight: () => ({ isDismissed: true, dismiss: jest.fn() }),
}));

jest.mock('components/ModuleTabBar', () => ({
  ModuleTabBar: () => null,
}));

jest.mock('components/CommercialGate', () => ({
  CommercialGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@lasyncro/suppliers-portal', () => ({
  SuppliersPortalModuleFT2: (props: any) => {
    capturedProps = props;
    return (
      <button
        type="button"
        onClick={async () => {
          try {
            const value = await props.onReassignReceiveJob('receive-job-1143', 9);
            capturedResults.push({ status: 'resolved', value });
          } catch (error) {
            capturedResults.push({ status: 'rejected', value: error });
          }
        }}
      >
        trigger reassign
      </button>
    );
  },
}));

const mockedAxios = axiosInstance as jest.Mocked<typeof axiosInstance>;

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

beforeEach(() => {
  capturedProps = null;
  capturedResults.length = 0;
  mockedAxios.get.mockReset();
  mockedAxios.post.mockReset();
  mockedAxios.patch.mockReset();
  mockedAxios.patch.mockResolvedValue({ data: {} } as any);
});

describe('GH-1143 — SuppliersPortalPage Receive reassignment adapter wiring', () => {
  it('threads a function prop for reassignment into SuppliersPortalModuleFT2', async () => {
    renderPage();
    await screen.findByRole('button', { name: /trigger reassign/i });

    expect(typeof capturedProps.onReassignReceiveJob).toBe('function');
  });

  it('submits reassignment via the existing PATCH /api/v1/suppliers/receive-jobs/:jobId/assignment', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /trigger reassign/i }));

    await waitFor(() => {
      expect(capturedResults).toHaveLength(1);
    });

    expect(mockedAxios.patch).toHaveBeenCalledWith(
      '/api/v1/suppliers/receive-jobs/receive-job-1143/assignment',
      { assigned_operator_id: 9 }
    );
    expect(capturedResults[0].status).toBe('resolved');
  });

  it('refreshes canonical suppliers-portal state after a successful reassignment', async () => {
    const refetch = jest.fn();
    jest.spyOn(
      require('pages/suppliers-portal/useSuppliersPortal'),
      'useSuppliersPortal'
    ).mockReturnValue({
      data: { purchase_orders: [], suppliers: [], never_ordered: [], never_ordered_count: 0 },
      isLoading: false,
      isError: false,
      refetch,
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /trigger reassign/i }));

    await waitFor(() => {
      expect(capturedResults).toHaveLength(1);
    });

    expect(refetch).toHaveBeenCalled();
  });
});
