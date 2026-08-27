// RECOUNT-FRESH-NOBINS-40
//
// Regression coverage for the page-level navigation wiring that failed
// live: "Set up bins" in the zero-bin Reconcile Inventory dialog must
// navigate the app to /floor-planning?tab=setup&view=canvas.
//
// RecountFreshNoBins.test.tsx (same directory) only proves the
// presentational RecountEmptyState invokes whatever onSetupBinsClick
// callback it is given — it never proves the page-level callback actually
// changes the rendered route. That is the gap this test closes.
//
// Distinguishing evidence required: a raw `window.history.pushState` call
// (the pre-fix `runtime.navigate` implementation) changes
// `window.location` but never notifies the React Router tree, so the
// rendered route never swaps. Asserting on rendered content — not
// `window.location.pathname` — is the only assertion shape that can tell
// the two implementations apart. See WmsOperationsPage.tsx's
// handleSetupBinsClick and apps/frontend/src/runtime/registerRoute.ts's
// `navigate` (fallback-only, raw history mutation).
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router-dom';
import WmsOperationsPage from 'pages/ft2-pages/WmsOperationsPage';
import { axiosInstance } from 'api/axiosConfig';

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

// WmsOperationsPage renders <UpgradePrompt> unconditionally (recount-tier
// upsell modal, closed by default). Its UpgradeModal reads useEntitlements(),
// which throws outside an EntitlementsProvider. Unrelated to the navigation
// seam under test — stubbed to a no-op.
jest.mock('components/UpgradePrompt', () => ({
  UpgradePrompt: () => null,
}));

jest.mock('pages/wms/useWms', () => ({
  useWms: () => ({
    data: { batches: [] },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    stowTasks: [],
    settings: null,
    openReceiveJobs: [],
    recountTasks: [],
    recountLocked: false,
  }),
}));

jest.mock('pages/wms/useReadyToPack', () => ({
  useReadyToPack: () => ({ data: { orders: [], orderCount: 0 } }),
}));

// RECOUNT-FRESH-NOBINS-40: real reviewer-tenant shape — one warehouse root,
// zero type='bin' locations. classifyRecountBinAvailability() (recountSelection.ts)
// resolves this exact combination (defined gridLocations, no bin-type rows,
// empty preview) to 'no_bins_configured' — the state under test.
jest.mock('pages/floor-planning/useWarehouseGrid', () => ({
  useWarehouseGrid: () => ({
    data: {
      locations: [
        { location_code: 'WH-2-ROOT', type: 'warehouse', parent_location_code: null, active: true },
      ],
    },
  }),
}));

// DEVIATION (see report DEVIATIONS): jest.requireActual('@lasyncro/wms')
// cannot load here — modules/shared/src/ui/index.ts (pulled in transitively
// by the real WmsModuleFT2) uses NodeNext-style relative imports ending in
// `.js` (e.g. './activation/index.js'), and the frontend Jest project's
// moduleNameMapper has no rule stripping that suffix to resolve the
// sibling .ts file (that regex exists only in the root/backend
// NODE_MODULE_NAME_MAPPER — jest.config.js:68-69 — not in the frontend
// project block). Confirmed structural, not a one-off: 13+ such imports in
// modules/shared/src/ui/index.ts alone. Fixing it requires a
// jest.config.js moduleNameMapper change, which is test configuration and
// out of this brief's authorized scope.
//
// Stand-in below renders the REAL RecountEmptyState (its own import
// surface — CountingSessionPage, recountSelection — has no `.js`-suffixed
// relative imports and is already proven resolvable: the existing
// RecountFreshNoBins.test.tsx imports it directly) behind a minimal
// "Reconcile inventory" trigger, preserving the exact seam this test must
// prove: RecountEmptyState's real button → real onClick →
// WmsOperationsPage's real handleSetupBinsClick → real navigate() → real
// route swap. Only WmsModuleFT2Inner's own dialog/data-fetch orchestration
// (unrelated to the navigation defect) is not exercised.
jest.mock('@lasyncro/wms', () => {
  const React = require('react');
  const { RecountEmptyState } = require('../../../../modules/wms/src/ui/components/RecountEmptyState');

  function WmsModuleFT2Stub({ onSetupBinsClick }: { onSetupBinsClick: () => void }) {
    const [dialogOpen, setDialogOpen] = React.useState(false);
    return React.createElement(
      React.Fragment,
      null,
      React.createElement('div', null, 'Warehouse'),
      React.createElement(
        'button',
        { onClick: () => setDialogOpen(true) },
        'Reconcile inventory'
      ),
      dialogOpen &&
        React.createElement(RecountEmptyState, {
          availability: 'no_bins_configured',
          onSetupBinsClick,
        })
    );
  }

  return {
    WmsModuleFT2: WmsModuleFT2Stub,
    useOfflineScanQueue: () => ({ isOnline: true, queuedCount: 0, submitScan: jest.fn() }),
    useWebPush: jest.fn(),
    WmsConnectionBadge: () => null,
  };
});

/** Sentinel for the /floor-planning route — exposes the query string the
 *  page actually navigated with, so the test can assert exact params
 *  rather than merely "some navigation happened". */
function FloorPlanningSentinel() {
  const [params] = useSearchParams();
  return (
    <div data-testid="floor-planning-sentinel">
      tab={params.get('tab') ?? ''} view={params.get('view') ?? ''}
    </div>
  );
}

function renderAtWms() {
  return render(
    <MemoryRouter initialEntries={['/wms']}>
      <Routes>
        <Route path="/wms" element={<WmsOperationsPage />} />
        <Route path="/floor-planning" element={<FloorPlanningSentinel />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('WmsOperationsPage — RECOUNT-FRESH-NOBINS-40 Set up bins navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (axiosInstance.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/v1/wms/recount-tasks/preview') {
        return Promise.resolve({ data: { bins: [] } });
      }
      if (url === '/api/v1/operators/team') {
        return Promise.resolve({ data: { operators: [] } });
      }
      return Promise.resolve({ data: {} });
    });
  });

  test('clicking "Set up bins" swaps the rendered route to /floor-planning?tab=setup&view=canvas', async () => {
    renderAtWms();

    // Sanity: we are on the WMS page.
    expect(screen.getByText('Warehouse')).toBeInTheDocument();
    expect(screen.queryByTestId('floor-planning-sentinel')).not.toBeInTheDocument();

    // Open Reconcile inventory — triggers handleFetchCountingPreview +
    // handleFetchCountingAssignees (mocked above to resolve empty).
    fireEvent.click(screen.getByRole('button', { name: 'Reconcile inventory' }));

    // Zero-bin onboarding state renders once the preview resolves.
    const setupBinsButton = await screen.findByRole('button', { name: 'Set up bins' });
    expect(
      screen.getByText('Set up your warehouse bins before creating an inventory count.')
    ).toBeInTheDocument();

    fireEvent.click(setupBinsButton);

    // BROKEN (runtime.navigate): raw pushState changes window.location but
    // never notifies <Routes> — the WMS page never unmounts and the
    // sentinel never mounts, so this assertion times out / fails.
    // CORRECT (useNavigate): React Router swaps the matched route.
    const sentinel = await waitFor(() => screen.getByTestId('floor-planning-sentinel'));
    expect(sentinel).toHaveTextContent('tab=setup');
    expect(sentinel).toHaveTextContent('view=canvas');

    // The WMS page's own rendered content is gone — a real route swap,
    // not an overlay/second render alongside the old page.
    expect(screen.queryByText('Warehouse')).not.toBeInTheDocument();
  });
});
