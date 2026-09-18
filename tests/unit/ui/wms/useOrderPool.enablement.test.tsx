// tests/unit/ui/wms/useOrderPool.enablement.test.tsx
//
// GH-1130 — ORDER POOL POLLING RED REGRESSION ONLY
// ==================================================
// Locks the intended useOrderPool(enabled) acquisition contract before
// useOrderPool() is changed:
//   - useOrderPool(enabled=false) must issue no initial GET and no 30s poll.
//   - useOrderPool(enabled=true) must retain the existing fetch/poll behavior.
//
// Pattern mirrored from
// tests/unit/ui/lifecycle/TopnavbarContent.alerts-ft2-gate.test.tsx.
//
// Production apps/frontend/src/pages/wms/useOrderPool.ts is NOT modified by
// this brief — useOrderPool() currently takes zero arguments, so a TEST-ONLY
// signature alias is used to call the future API without editing production.

import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { axiosInstance } from 'api/axiosConfig';
import { useOrderPool } from 'pages/wms/useOrderPool';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockedGet = axiosInstance.get as jest.Mock;

const STABLE_ORDER_POOL_RESPONSE = {
  data: {
    eligible_order_count: 0,
    max_batch_line_items: 0,
    orders: [],
    summary: {
      ready_for_release_count: 0,
      in_batch_order_count: 0,
      active_batch_count: 0,
      blocked_count: 0,
      fulfilled_count: 0,
      not_ready_count: 0,
    },
  },
};

// TEST-ONLY intended-signature alias: production useOrderPool() currently
// takes no arguments. This proves the future call shape without editing
// apps/frontend/src/pages/wms/useOrderPool.ts.
const useOrderPoolWithEnabled =
  useOrderPool as unknown as (
    enabled?: boolean
  ) => ReturnType<typeof useOrderPool>;

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

beforeEach(() => {
  jest.clearAllMocks();
  mockedGet.mockResolvedValue(STABLE_ORDER_POOL_RESPONSE);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useOrderPool — enablement gate', () => {
  it('enabled=false issues no initial GET and no 30s polling', async () => {
    jest.useFakeTimers();
    const client = makeClient();

    renderHook(() => useOrderPoolWithEnabled(false), { wrapper: wrapperFor(client) });

    await act(async () => { await jest.advanceTimersByTimeAsync(0); });
    expect(mockedGet).not.toHaveBeenCalled();

    // Well past 3x the 30s poll cadence — a disabled query must not poll.
    await act(async () => { await jest.advanceTimersByTimeAsync(90_000); });
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('GREEN CONTROL: enabled=true fetches immediately and retains the existing 30s poll', async () => {
    jest.useFakeTimers();
    const client = makeClient();

    renderHook(() => useOrderPoolWithEnabled(true), { wrapper: wrapperFor(client) });

    await act(async () => { await jest.advanceTimersByTimeAsync(0); });
    expect(mockedGet).toHaveBeenCalledWith('/api/v1/wms/order-pool');
    expect(mockedGet).toHaveBeenCalledTimes(1);

    await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
    expect(mockedGet).toHaveBeenCalledTimes(2);

    await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
    expect(mockedGet).toHaveBeenCalledTimes(3);
  });
});
