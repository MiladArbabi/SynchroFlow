import React from 'react';
import {
  act,
  renderHook,
  waitFor,
} from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';

import { axiosInstance } from 'api/axiosConfig';
import { useUpdateZonePositions } from '../../../../apps/frontend/src/pages/floor-planning/useZoneManagement';

const mockShowToast = jest.fn();

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    patch: jest.fn(),
  },
}));

jest.mock('../../../../apps/frontend/src/contexts/ToastContext', () => ({
  useToast: () => ({
    show: mockShowToast,
  }),
}));

const patchMock = axiosInstance.patch as jest.MockedFunction<typeof axiosInstance.patch>;

const queryKey = ['floor-planning', 'layout'] as const;

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {children}
      </QueryClientProvider>
    );
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

const initialLayout = {
  zones: [
    {
      location_code: 'BIN-01',
      position_x: 1,
      position_y: 1,
    },
    {
      location_code: 'LANE-01',
      position_x: 4,
      position_y: 1,
    },
    {
      location_code: 'UNCHANGED-01',
      position_x: 9,
      position_y: 9,
    },
  ],
};

const movedPositions = [
  {
    location_code: 'BIN-01',
    position_x: 2,
    position_y: 2,
  },
  {
    location_code: 'LANE-01',
    position_x: 5,
    position_y: 2,
  },
];

describe('useUpdateZonePositions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends one batch PATCH and optimistically updates the whole group', async () => {
    const client = makeClient();
    client.setQueryData(queryKey, initialLayout);

    const request = deferred<{ data: { success: true; updated: number } }>();
    patchMock.mockReturnValue(request.promise as ReturnType<typeof axiosInstance.patch>);

    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(
      () => useUpdateZonePositions(),
      { wrapper: wrapperFor(client) },
    );

    let mutation!: Promise<unknown>;

    act(() => {
      mutation = result.current.mutateAsync(movedPositions);
    });

    await waitFor(() => {
      expect(patchMock).toHaveBeenCalledTimes(1);
    });

    expect(patchMock).toHaveBeenCalledWith(
      '/api/v1/floor-planning/zones/positions',
      { positions: movedPositions },
    );

    await waitFor(() => {
      expect(client.getQueryData(queryKey)).toEqual({
        zones: [
          {
            location_code: 'BIN-01',
            position_x: 2,
            position_y: 2,
          },
          {
            location_code: 'LANE-01',
            position_x: 5,
            position_y: 2,
          },
          {
            location_code: 'UNCHANGED-01',
            position_x: 9,
            position_y: 9,
          },
        ],
      });
    });

    await act(async () => {
      request.resolve({
        data: {
          success: true,
          updated: 2,
        },
      });

      await mutation;
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['floor-planning'],
    });

    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('restores the complete previous cache when the batch request fails', async () => {
    const client = makeClient();
    client.setQueryData(queryKey, initialLayout);

    const request = deferred<never>();
    patchMock.mockReturnValue(request.promise as ReturnType<typeof axiosInstance.patch>);

    const { result } = renderHook(
      () => useUpdateZonePositions(),
      { wrapper: wrapperFor(client) },
    );

    let mutation!: Promise<unknown>;

    act(() => {
      mutation = result.current.mutateAsync(movedPositions);
    });

    await waitFor(() => {
      expect(client.getQueryData(queryKey)).toEqual({
        zones: [
          {
            location_code: 'BIN-01',
            position_x: 2,
            position_y: 2,
          },
          {
            location_code: 'LANE-01',
            position_x: 5,
            position_y: 2,
          },
          {
            location_code: 'UNCHANGED-01',
            position_x: 9,
            position_y: 9,
          },
        ],
      });
    });

    await act(async () => {
      request.reject(new Error('network failed'));

      await expect(mutation).rejects.toThrow('network failed');
    });

    await waitFor(() => {
      expect(client.getQueryData(queryKey)).toEqual(initialLayout);
    });

    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith(
      'Failed to move selected components — reverted to their previous positions.',
      'error',
    );
  });
});
