// tests/unit/ui/orders/useOperationalEpisodes.query-options.test.ts
//
// D2B-RED — CONTRACT 8: LIVE REFRESH CONTRACT.
//
// D2B owns operational-episode refresh cadence on the Orders surface:
//   refetchInterval = 15_000
//   staleTime = 0
// This aligns with the existing Orders live-activity surface
// (useWmsLiveActivity's polling convention). No clock/lifecycle inference
// is added to the frontend — this test locks the query OPTIONS only.
//
// Exercises the REAL useOperationalEpisodes() hook (apps/frontend/src/
// pages/orders/useOperationalEpisodes.ts) — @tanstack/react-query's
// useQuery is stubbed so the options object passed to it can be inspected
// directly, without needing a live QueryClient/network layer. This is not
// an invented seam: useOperationalEpisodes already exists (SLICE D1/D3A)
// and already calls useQuery with a fixed options object today (currently
// staleTime: 30_000, no refetchInterval) — this test proves that object
// does not yet match the D2B-ratified cadence.
const mockUseQuery = jest.fn(() => ({ data: undefined }));

jest.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn() },
}));

import { useOperationalEpisodes } from 'pages/orders/useOperationalEpisodes';

describe('useOperationalEpisodes — D2B live refresh contract (item 8)', () => {
  beforeEach(() => {
    mockUseQuery.mockClear();
  });

  it('locks refetchInterval=15_000 and staleTime=0', () => {
    useOperationalEpisodes();

    expect(mockUseQuery).toHaveBeenCalledTimes(1);
    const options = mockUseQuery.mock.calls[0][0] as Record<string, unknown>;

    expect(options.refetchInterval).toBe(15_000);
    expect(options.staleTime).toBe(0);
  });
});
