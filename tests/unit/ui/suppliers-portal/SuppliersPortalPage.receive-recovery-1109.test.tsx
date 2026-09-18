import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import SuppliersPortalPage from 'pages/ft2-pages/SuppliersPortalPage';
import { axiosInstance } from 'api/axiosConfig';

const capturedCreateResults: Array<{
  status: 'resolved' | 'rejected';
  value: unknown;
}> = [];

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
  },
}));

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 7,
      role: 'owner',
    },
  }),
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
  useSpotlight: () => ({
    isDismissed: false,
    dismiss: jest.fn(),
  }),
}));

jest.mock('components/ModuleTabBar', () => ({
  ModuleTabBar: () => null,
}));

jest.mock('components/CommercialGate', () => ({
  CommercialGate: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

jest.mock('@lasyncro/suppliers-portal', () => ({
  SuppliersPortalModuleFT2: (props: {
    onCreateReceiveJob: (
      poId: string,
      input: { assigned_operator_id: number }
    ) => Promise<{ receive_job_id: string }>;
  }) => (
    <button
      type="button"
      onClick={async () => {
        try {
          const value = await props.onCreateReceiveJob(
            'po-1109',
            { assigned_operator_id: 8 }
          );

          capturedCreateResults.push({
            status: 'resolved',
            value,
          });
        } catch (error) {
          capturedCreateResults.push({
            status: 'rejected',
            value: error,
          });
        }
      }}
    >
      trigger receive
    </button>
  ),
}));

const mockedAxios = axiosInstance as jest.Mocked<typeof axiosInstance>;

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <SuppliersPortalPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function receiveConflict() {
  return {
    isAxiosError: true,
    response: {
      status: 409,
      data: {
        error: 'An active receive job already exists for this PO',
        receive_job_id: 'receive-existing',
      },
    },
  };
}

beforeEach(() => {
  capturedCreateResults.length = 0;

  mockedAxios.get.mockReset();
  mockedAxios.post.mockReset();
  mockedAxios.patch.mockReset();

  mockedAxios.post.mockRejectedValue(receiveConflict());

  mockedAxios.get.mockImplementation(async (url: string) => {
    if (url === '/api/v1/operators/receive-assignees') {
      return {
        data: {
          operators: [
            {
              user_id: 7,
              first_name: 'Owner',
              last_name: null,
              role: 'owner',
            },
            {
              user_id: 8,
              first_name: 'Worker',
              last_name: null,
              role: 'operator',
            },
          ],
        },
      } as any;
    }

    throw new Error(`UNEXPECTED_GET:${url}`);
  });

  mockedAxios.patch.mockResolvedValue({
    data: {
      receive_job: {
        receive_job_id: 'receive-existing',
      },
    },
  } as any);
});

describe('GH-1109 — SuppliersPortalPage Receive 409 recovery', () => {
  it('recovers legacy unassigned pending work through assignment', async () => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/operators/receive-assignees') {
        return { data: { operators: [] } } as any;
      }

      if (
        url ===
        '/api/v1/suppliers/receive-jobs/receive-existing'
      ) {
        return {
          data: {
            job: {
              receive_job_id: 'receive-existing',
              status: 'pending',
              assigned_operator_id: null,
              started_at: null,
            },
          },
        } as any;
      }

      throw new Error(`UNEXPECTED_GET:${url}`);
    });

    renderPage();

    fireEvent.click(
      await screen.findByRole('button', {
        name: /trigger receive/i,
      })
    );

    await waitFor(() => {
      expect(capturedCreateResults).toHaveLength(1);
    });

    expect(mockedAxios.patch).toHaveBeenCalledWith(
      '/api/v1/suppliers/receive-jobs/receive-existing/assignment',
      { assigned_operator_id: 8 }
    );

    expect(capturedCreateResults[0]).toEqual({
      status: 'resolved',
      value: {
        receive_job_id: 'receive-existing',
      },
    });
  });

  it('reuses pending work already assigned to the selected operator without PATCH', async () => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/operators/receive-assignees') {
        return { data: { operators: [] } } as any;
      }

      if (
        url ===
        '/api/v1/suppliers/receive-jobs/receive-existing'
      ) {
        return {
          data: {
            job: {
              receive_job_id: 'receive-existing',
              status: 'pending',
              assigned_operator_id: 8,
              started_at: null,
            },
          },
        } as any;
      }

      throw new Error(`UNEXPECTED_GET:${url}`);
    });

    renderPage();

    fireEvent.click(
      await screen.findByRole('button', {
        name: /trigger receive/i,
      })
    );

    await waitFor(() => {
      expect(capturedCreateResults).toHaveLength(1);
    });

    expect(mockedAxios.patch).not.toHaveBeenCalled();

    expect(capturedCreateResults[0]).toEqual({
      status: 'resolved',
      value: {
        receive_job_id: 'receive-existing',
      },
    });
  });

  it('does not silently reassign pending work owned by another operator', async () => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/operators/receive-assignees') {
        return { data: { operators: [] } } as any;
      }

      if (
        url ===
        '/api/v1/suppliers/receive-jobs/receive-existing'
      ) {
        return {
          data: {
            job: {
              receive_job_id: 'receive-existing',
              status: 'pending',
              assigned_operator_id: 9,
              started_at: null,
            },
          },
        } as any;
      }

      throw new Error(`UNEXPECTED_GET:${url}`);
    });

    renderPage();

    fireEvent.click(
      await screen.findByRole('button', {
        name: /trigger receive/i,
      })
    );

    await waitFor(() => {
      expect(capturedCreateResults).toHaveLength(1);
    });

    expect(mockedAxios.patch).not.toHaveBeenCalled();

    expect(capturedCreateResults[0]?.status).toBe(
      'rejected'
    );

    expect(
      (capturedCreateResults[0]?.value as Error).message
    ).toMatch(/already assigned/i);
  });
});
