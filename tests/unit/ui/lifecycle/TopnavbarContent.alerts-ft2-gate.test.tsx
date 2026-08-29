// tests/unit/ui/lifecycle/TopnavbarContent.alerts-ft2-gate.test.tsx
//
// SHOP-REVIEW-FT1-ALERTS-01  — Alerts inbox querying from the always-mounted
//   shell is active iff phase === 'FT2_READY'. Pre-FT2: no request / retry /
//   30s poll / focus refetch; the backend 403 stays authoritative.
//
// SHOP-REVIEW-FT2-ALERT-POLL-02 — after FT2 confirmation the shell must issue
//   ONE logical 30s inbox poll, not one per consumer. Two mechanisms are
//   proven fixed here:
//     * key canonicalization — useAlerts() and useAlerts({ status: 'inbox' })
//       collapse to a single Query ['alerts', { status: 'inbox' }];
//     * explicit poll ownership — refetchInterval is opt-in (`poll: true`),
//       owned only by the topnav; every other caller is a passive reader.
//
// Nothing here weakens requireFt2, promotes FT1 -> FT2, or swallows the 403.

import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from '@tanstack/react-query';

import { axiosInstance } from 'api/axiosConfig';
import { useAlerts, useAlertCount } from 'pages/alerts/useAlerts';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn() },
}));

const mockedGet = axiosInstance.get as jest.Mock;

const EMPTY_INBOX = { data: { data: [], meta: { total: 0, status: 'inbox' } } };

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

function makeWrapper() {
  return wrapperFor(makeClient());
}

function alertQueries(client: QueryClient) {
  return client
    .getQueryCache()
    .getAll()
    .filter((q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'alerts');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGet.mockResolvedValue(EMPTY_INBOX);
  // Deterministic focus state so refetchInterval ticks are not env-dependent.
  focusManager.setFocused(true);
});

afterEach(() => {
  jest.useRealTimers();
});

// ─── FT1 GATE (SHOP-REVIEW-FT1-ALERTS-01) ────────────────────────────────────

describe('useAlerts — FT1 enablement gate', () => {
  it('enabled=false (even with poll:true) issues no request, no retry, no poll and no focus refetch', async () => {
    jest.useFakeTimers();

    renderHook(
      () => useAlerts({ status: 'inbox' }, { enabled: false, poll: true }),
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

  it('flipping enabled false -> true (poll:true) issues exactly the inbox request once', async () => {
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useAlerts({ status: 'inbox' }, { enabled, poll: true }),
      { wrapper: makeWrapper(), initialProps: { enabled: false } },
    );

    expect(mockedGet).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/alerts?status=inbox');
    });
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });
});

// ─── FT2 POLL AMPLIFICATION (SHOP-REVIEW-FT2-ALERT-POLL-02) ──────────────────

describe('useAlerts — canonical inbox key', () => {
  it('collapses useAlerts() and useAlerts({status:"inbox"}) to one Query ["alerts",{status:"inbox"}]', async () => {
    const client = makeClient();

    renderHook(
      () => {
        useAlerts();
        useAlerts({ status: 'inbox' });
        return null;
      },
      { wrapper: wrapperFor(client) },
    );

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith('/api/v1/alerts?status=inbox');
    });

    const queries = alertQueries(client);
    expect(queries).toHaveLength(1);
    expect(queries[0].queryKey).toEqual(['alerts', { status: 'inbox' }]);

    // the legacy empty-filter cache entry must not exist
    expect(
      client.getQueryCache().find({ queryKey: ['alerts', {}], exact: true }),
    ).toBeUndefined();

    // one canonical Query → one deduped request, not one per call site
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });
});

describe('useAlerts — passive by default', () => {
  it('an inbox observer without poll:true fetches once on mount and then never polls', async () => {
    jest.useFakeTimers();
    const client = makeClient();

    renderHook(() => useAlerts({ status: 'inbox' }), { wrapper: wrapperFor(client) });

    await act(async () => { await jest.advanceTimersByTimeAsync(0); });
    expect(mockedGet).toHaveBeenCalledWith('/api/v1/alerts?status=inbox');
    expect(mockedGet).toHaveBeenCalledTimes(1);

    // > 3x the 30s cadence — a non-poll observer schedules no recurring timer
    await act(async () => { await jest.advanceTimersByTimeAsync(95_000); });
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('no options argument stays enabled but is a passive non-polling observer', async () => {
    jest.useFakeTimers();
    const client = makeClient();

    renderHook(() => useAlerts(), { wrapper: wrapperFor(client) });

    await act(async () => { await jest.advanceTimersByTimeAsync(0); });
    expect(mockedGet).toHaveBeenCalledWith('/api/v1/alerts?status=inbox');
    expect(mockedGet).toHaveBeenCalledTimes(1);

    await act(async () => { await jest.advanceTimersByTimeAsync(95_000); });
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });
});

describe('useAlerts — single 30s poll owner across the FT2 shell', () => {
  it('one poll owner + two passive readers => one canonical Query and exactly one poll per 30s', async () => {
    jest.useFakeTimers();
    const client = makeClient();

    // Topnav (owner) + Sidenav badge (passive) + module-health count (passive).
    renderHook(
      () => {
        useAlerts({ status: 'inbox' }, { enabled: true, poll: true });
        useAlerts();
        useAlertCount();
        return null;
      },
      { wrapper: wrapperFor(client) },
    );

    // one canonical Query; the initial fetch is deduped, not amplified x3
    await act(async () => { await jest.advanceTimersByTimeAsync(0); });
    const queries = alertQueries(client);
    expect(queries).toHaveLength(1);
    expect(queries[0].queryKey).toEqual(['alerts', { status: 'inbox' }]);
    expect(mockedGet).toHaveBeenCalledTimes(1);

    // first 30s window → exactly one additional request (single interval owner)
    await act(async () => { await jest.advanceTimersByTimeAsync(31_000); });
    expect(mockedGet).toHaveBeenCalledTimes(2);

    // next 30s window → exactly one more
    await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
    expect(mockedGet).toHaveBeenCalledTimes(3);
  });

  it('poll:true on a historical tab (resolved) still schedules no interval', async () => {
    jest.useFakeTimers();
    const client = makeClient();

    renderHook(
      () => useAlerts({ status: 'resolved' }, { enabled: true, poll: true }),
      { wrapper: wrapperFor(client) },
    );

    await act(async () => { await jest.advanceTimersByTimeAsync(0); });
    expect(mockedGet).toHaveBeenCalledWith('/api/v1/alerts?status=resolved');
    expect(mockedGet).toHaveBeenCalledTimes(1);

    await act(async () => { await jest.advanceTimersByTimeAsync(95_000); });
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });
});

// ─── SOURCE CONTRACTS ───────────────────────────────────────────────────────

describe('useAlerts.ts — wiring', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../../../apps/frontend/src/pages/alerts/useAlerts.ts'),
    'utf8',
  );

  it('defaults enabled to true and poll to false', () => {
    expect(src).toMatch(/const\s+enabled\s*=\s*options\.enabled\s*\?\?\s*true/);
    expect(src).toMatch(/const\s+poll\s*=\s*options\.poll\s*\?\?\s*false/);
  });

  it('keys the query off the normalized filters, not the raw argument', () => {
    expect(src).toMatch(/function\s+normalizeAlertFilters/);
    expect(src).toMatch(/const\s+normalized\s*=\s*normalizeAlertFilters\(/);
    expect(src).toMatch(/queryKey:\s*\['alerts',\s*normalized\]/);
  });

  it('only polls when enabled AND poll AND the live inbox is selected', () => {
    expect(src).toMatch(
      /refetchInterval:\s*enabled\s*&&\s*poll\s*&&\s*status\s*===\s*'inbox'\s*\?\s*30_000\s*:\s*false/,
    );
  });
});

describe('TopnavbarContent.tsx — sole shell poll owner, FT2-gated', () => {
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

  it('passes { enabled: isFt2, poll: true } into the inbox useAlerts call', () => {
    expect(src).toMatch(
      /useAlerts\(\s*\{\s*status:\s*'inbox'\s*\}\s*,\s*\{\s*enabled:\s*isFt2\s*,\s*poll:\s*true\s*\}\s*,?\s*\)/,
    );
  });

  it('leaves no unconditional / non-polling inbox useAlerts call behind', () => {
    expect(src).not.toMatch(/useAlerts\(\s*\{\s*status:\s*'inbox'\s*\}\s*\)/);
    expect(src).not.toMatch(/useAlerts\(\s*\{\s*status:\s*'inbox'\s*\}\s*,\s*\{\s*enabled:\s*isFt2\s*\}\s*\)/);
  });
});
