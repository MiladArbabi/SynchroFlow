// tests/unit/ui/commercial-access/purchasing-core-shell-sourcing-fetch.test.tsx
//
// P0-A3-5 / PUR-C7 — the shared Core Purchasing shell must not eagerly fetch
// Growth-only ADVANCED SOURCING data.
// ===========================================================================
// Ratified split: purchasing.core (Core+) owns Open POs / Suppliers;
// purchasing.sourcing (Growth+) owns the worklist, recommendations,
// never-ordered, supplier-product preferences and the reorder/MOQ accumulator.
//
// useSuppliersPortal() is the SHARED data hook for the whole Purchasing page —
// SuppliersPortalPage calls it once, above the <Routes> that render Open POs,
// Suppliers and Sourcing. Anything it fetches is fetched for a Core merchant
// sitting on Open POs or Suppliers, who holds no purchasing.sourcing at all.
//
// This is a BEHAVIOURAL contract, not a comment/name check: the hook is really
// rendered with a real QueryClient and a mocked HTTP boundary, and the
// assertion is over the URLs actually requested.
//
// Scope: this file proves only that Growth-only sourcing endpoints are not
// owned/eagerly requested by the shared Core hook. WHERE sourcing data is
// fetched instead (inside the Sourcing surface, behind the capability) is the
// production implementation's decision, not this contract's.

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { axiosInstance } from 'api/axiosConfig';
import { useSuppliersPortal } from 'pages/suppliers-portal/useSuppliersPortal';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn() },
}));

const mockedGet = axiosInstance.get as jest.Mock;

/** Every endpoint owned by purchasing.sourcing (Growth+). */
const SOURCING_ENDPOINT_PATTERNS: Array<[string, RegExp]> = [
  ['/sourcing-worklist', /\/sourcing-worklist/],
  ['/sourcing-recommendations/*', /\/sourcing-recommendations(\/|$)/],
  ['/preferences', /\/preferences(\/|\?|$)/],
  ['/reorder-requests', /\/reorder-requests(\/|\?|$)/],
];

/** URLs the mocked HTTP boundary was actually asked for. */
const requestedUrls = (): string[] => mockedGet.mock.calls.map((c) => String(c[0]));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockedGet.mockReset();
  // Every endpoint answers successfully — a sourcing request must be absent
  // because the hook never makes it, not because the request would fail.
  mockedGet.mockResolvedValue({
    data: { purchase_orders: [], suppliers: [], variants: [], count: 0 },
  });
});

describe('PUR-C7 — the shared Core Purchasing hook does not eagerly fetch Growth sourcing data', () => {
  it('GREEN CONTROL: the shared hook does fetch the Core-owned purchasing data', async () => {
    renderHook(() => useSuppliersPortal(), { wrapper });
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());

    const urls = requestedUrls();
    expect(urls.some((u) => /\/purchase-orders/.test(u))).toBe(true);
    expect(urls.some((u) => /\/api\/v1\/suppliers$/.test(u))).toBe(true);
  });

  it.each(SOURCING_ENDPOINT_PATTERNS)(
    // Mixed outcome by design: /sourcing-recommendations/* is RED today (the
    // shared hook eagerly fetches never-ordered); the other three are GREEN
    // controls that must STAY green when sourcing moves behind its capability.
    'loading ordinary Core Purchasing does not request %s',
    async (_label, pattern) => {
      renderHook(() => useSuppliersPortal(), { wrapper });
      await waitFor(() => expect(mockedGet).toHaveBeenCalled());

      const matched = requestedUrls().filter((u) => pattern.test(u));
      expect(matched).toEqual([]);
    },
  );

  it('EXPECTED RED: the shared hook requests no purchasing.sourcing endpoint at all', async () => {
    renderHook(() => useSuppliersPortal(), { wrapper });
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());

    const leaked = requestedUrls().filter((u) =>
      SOURCING_ENDPOINT_PATTERNS.some(([, pattern]) => pattern.test(u)),
    );
    expect(leaked).toEqual([]);
  });

  it('EXPECTED RED: the shared hook exposes no Growth-only sourcing result to the Core shell', async () => {
    // Owning the DATA is the same commercial leak as owning the request: if the
    // Core shell still surfaces never-ordered counts, a Core merchant is being
    // served a Growth-only intelligence signal.
    const { result } = renderHook(() => useSuppliersPortal(), { wrapper });
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());

    expect(Object.keys(result.current.data).filter((k) => /never_ordered/.test(k))).toEqual([]);
  });
});
