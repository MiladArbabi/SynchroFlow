// tests/unit/ui/lifecycle/TopnavbarContent.alerts-ft2-gate.test.tsx
//
// SHOP-REVIEW-FT1-ALERTS-01 regression.
//
// Defect: the always-mounted topnav called useAlerts({ status: 'inbox' })
// unconditionally, so a reviewer-fresh FT1 shop immediately hit — and then
// polled — the FT2-protected GET /api/v1/alerts endpoint (backend correctly
// answers HTTP 403 {"error":"FT2 access requires confirmed FT2 lifecycle"}).
//
// Contract: Alerts inbox querying from the application shell is active iff
// phase === 'FT2_READY'. This file proves BOTH layers of that contract:
//
//   Layer 1 — useAlerts with enabled=false performs no fetch / retry / 30s
//             poll / focus refetch, and flipping enabled true issues exactly
//             the inbox request (behavioural).
//   Layer 2 — TopnavbarContent derives that enablement from the single
//             existing `isFt2 = phase === 'FT2_READY'` value and passes it to
//             useAlerts, with no unconditional inbox call left behind.
//
// The backend 403 is correct and is out of scope here — nothing in this file
// weakens requireFt2, promotes FT1 -> FT2, or swallows the 403.

import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { axiosInstance } from 'api/axiosConfig';
import { useAlerts } from 'pages/alerts/useAlerts';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn() },
}));

const mockedGet = axiosInstance.get as jest.Mock;

const EMPTY_INBOX = { data: { data: [], meta: { total: 0, status: 'inbox' } } };

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGet.mockResolvedValue(EMPTY_INBOX);
});

afterEach(() => {
  jest.useRealTimers();
});

// ─── LAYER 1 — useAlerts enablement gate (behavioural) ────────────────────────

describe('useAlerts — enabled gate (SHOP-REVIEW-FT1-ALERTS-01)', () => {
  it('enabled=false issues no request, no retry, no 30s poll and no focus refetch', async () => {
    jest.useFakeTimers();

    renderHook(
      () => useAlerts({ status: 'inbox' }, { enabled: false }),
      { wrapper: makeWrapper() },
    );

    await act(async () => { await Promise.resolve(); });
    expect(mockedGet).not.toHaveBeenCalled();

    // Well past the 30s inbox interval — a disabled query must not poll.
    await act(async () => {
      jest.advanceTimersByTime(90_000);
      await Promise.resolve();
    });
    expect(mockedGet).not.toHaveBeenCalled();

    // A window focus / visibility change must not wake a disabled query.
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('flipping enabled false -> true issues exactly the /api/v1/alerts?status=inbox request', async () => {
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useAlerts({ status: 'inbox' }, { enabled }),
      { wrapper: makeWrapper(), initialProps: { enabled: false } },
    );

    expect(mockedGet).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/alerts?status=inbox');
    });
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('no options argument leaves the query enabled — existing callers are unchanged', async () => {
    renderHook(
      () => useAlerts({ status: 'inbox' }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/alerts?status=inbox');
    });
  });
});

// ─── LAYER 1 — useAlerts source contract ─────────────────────────────────────

describe('useAlerts.ts — enablement wiring', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../../../apps/frontend/src/pages/alerts/useAlerts.ts'),
    'utf8',
  );

  it('defaults enabled to true so unspecified callers keep current behaviour', () => {
    expect(src).toMatch(/const\s+enabled\s*=\s*options\.enabled\s*\?\?\s*true/);
  });

  it('drops the 30s inbox poll to false whenever the query is disabled', () => {
    expect(src).toMatch(
      /refetchInterval:\s*enabled\s*&&\s*status\s*===\s*'inbox'\s*\?\s*30_000\s*:\s*false/,
    );
  });
});

// ─── LAYER 2 — TopnavbarContent derives enablement from FT2_READY ─────────────

describe('TopnavbarContent.tsx — Alerts query is FT2-gated', () => {
  const src = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../../apps/frontend/src/layouts/AppLayout/TopnavbarContent.tsx',
    ),
    'utf8',
  );

  it('keeps a single lifecycle interpretation: isFt2 = phase === \'FT2_READY\'', () => {
    expect(src).toMatch(/const\s+isFt2\s*=\s*phase\s*===\s*'FT2_READY'/);
  });

  it('passes { enabled: isFt2 } into the inbox useAlerts call', () => {
    expect(src).toMatch(
      /useAlerts\(\s*\{\s*status:\s*'inbox'\s*\}\s*,\s*\{\s*enabled:\s*isFt2\s*\}\s*,?\s*\)/,
    );
  });

  it('leaves no unconditional inbox useAlerts call behind', () => {
    // i.e. no `useAlerts({ status: 'inbox' })` that is NOT immediately followed
    // by a second (options) argument.
    expect(src).not.toMatch(/useAlerts\(\s*\{\s*status:\s*'inbox'\s*\}\s*\)/);
  });
});
