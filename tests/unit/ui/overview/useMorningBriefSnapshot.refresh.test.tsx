// tests/unit/ui/overview/useMorningBriefSnapshot.refresh.test.tsx
//
// OV-UX-18 — RED-first refresh contract.
//
// Locks the implemented hook seam:
// - manual refresh is an explicit force-refresh operation;
// - existing morning-brief data remains available while the force request is pending;
// - the canonical morning-brief query identity stays stable.

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { axiosInstance } from 'api/axiosConfig';
import { useMorningBriefSnapshot } from 'pages/overview/useMorningBriefSnapshot';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn() },
}));

const mockedGet = axiosInstance.get as jest.Mock;

const initialBrief = {
  signals: [
    {
      id: 'sla:shop-1:shipping_breach',
      priority: 1,
      title: '19 orders past Fulfillment SLA',
      detail: 'Fulfil them now.',
      module: 'orders',
      deepLink: '/orders/flow',
      revenueImpact: 26492.55,
    },
  ],
  hasUrgentIssues: true,
  generatedAt: '2026-08-31T20:21:25.104Z',
  trustWarning: false,
  fromCache: false,
  greeting: 'Good evening.',
  summaryLine: '1 decision pending. Review the issue below.',
};

const refreshedBrief = {
  ...initialBrief,
  generatedAt: '2026-08-31T20:30:00.000Z',
  summaryLine: '1 decision pending. Review the issue below.',
};

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('useMorningBriefSnapshot — OV-UX-18 manual refresh contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('OV-REFRESH-02 exposes an explicit manual refresh pending state and action', async () => {
    mockedGet.mockResolvedValueOnce({ data: initialBrief, status: 200 });

    const { result } = renderHook(() => useMorningBriefSnapshot(false, true), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(initialBrief);
    });

    const refreshable = result.current as typeof result.current & {
      isRefreshingBrief?: boolean;
      refreshMorningBrief?: () => unknown;
    };

    expect(refreshable.isRefreshingBrief).toBe(false);
    expect(typeof refreshable.refreshMorningBrief).toBe('function');
    expect(mockedGet).toHaveBeenCalledWith(
      '/api/v1/modules/overview/morning-brief',
      { validateStatus: expect.any(Function) },
    );
  });

  it('OV-REFRESH-04/06 keeps existing data visible and updates canonical data after force refresh', async () => {
    const pendingRefresh = deferred<{ data: typeof refreshedBrief; status: number }>();
    mockedGet
      .mockResolvedValueOnce({ data: initialBrief, status: 200 })
      .mockReturnValueOnce(pendingRefresh.promise);

    const client = makeClient();
    const { result } = renderHook(() => useMorningBriefSnapshot(true), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(initialBrief);
    });

    void act(() => {
      void result.current.refreshMorningBrief();
    });

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith(
        '/api/v1/modules/overview/morning-brief?force=true',
        { validateStatus: expect.any(Function) },
      );
    });

    expect(result.current.data).toEqual(initialBrief);
    expect(result.current.isRefreshingBrief).toBe(true);

    await act(async () => {
      pendingRefresh.resolve({ data: refreshedBrief, status: 200 });
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(refreshedBrief);
    });
    expect(result.current.isRefreshingBrief).toBe(false);
    expect(client.getQueryData(['overview', 'morning-brief'])).toEqual(refreshedBrief);
    expect(client.getQueryCache().findAll().map((query) => query.queryKey)).toEqual([
      ['overview', 'morning-brief'],
    ]);
  });

  it('OV-REFRESH-07/08 ignores concurrent duplicate refreshes and later refreshes always force', async () => {
    const firstRefresh = deferred<{ data: typeof refreshedBrief; status: number }>();
    const secondRefresh = deferred<{ data: typeof refreshedBrief; status: number }>();
    mockedGet
      .mockResolvedValueOnce({ data: initialBrief, status: 200 })
      .mockReturnValueOnce(firstRefresh.promise)
      .mockReturnValueOnce(secondRefresh.promise);

    const { result } = renderHook(() => useMorningBriefSnapshot(true), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(initialBrief);
    });

    void act(() => {
      void result.current.refreshMorningBrief();
      void result.current.refreshMorningBrief();
    });

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledTimes(2);
    });
    expect(mockedGet.mock.calls.filter(([url]) => url === '/api/v1/modules/overview/morning-brief?force=true')).toHaveLength(1);

    await act(async () => {
      firstRefresh.resolve({ data: refreshedBrief, status: 200 });
    });

    await waitFor(() => {
      expect(result.current.isRefreshingBrief).toBe(false);
    });

    void act(() => {
      void result.current.refreshMorningBrief();
    });

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledTimes(3);
    });
    expect(mockedGet.mock.calls[2][0]).toBe('/api/v1/modules/overview/morning-brief?force=true');

    await act(async () => {
      secondRefresh.resolve({ data: refreshedBrief, status: 200 });
    });
  });
});
