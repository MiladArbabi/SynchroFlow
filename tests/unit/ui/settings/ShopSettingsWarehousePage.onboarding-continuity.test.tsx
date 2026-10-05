/** RED-only continuity contract. Real router, Settings, canonical checklist,
 * Overview and ConfigContext/Ops Console; only HTTP and unrelated feeds stubbed.
 * Entry journey state defines the intended contract before production supports it;
 * continuation representation and cue copy are deliberately not prescribed. */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { axiosInstance } from 'api/axiosConfig';
import { AuthContext } from 'contexts/AuthContext';
import { ConfigProvider, ConfigContext } from 'contexts/ConfigContext';
import useConfig from 'hooks/useConfig';
import { useActivationChecklist } from 'hooks/useActivationChecklist';
import SettingsModalShell from 'pages/ft2-pages/SettingsModalShell';
import ShopSettingsWarehousePage from 'pages/ft2-pages/ShopSettingsWarehousePage';
import OverviewPageFT2 from 'pages/ft2-pages/OverviewFT2Page';
import { OpsConsoleButton } from 'components/OpsConsole/OpsConsole';

jest.mock('api/axiosConfig', () => ({ axiosInstance: { get: jest.fn(), patch: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
jest.mock('contexts/ToastContext', () => ({ useToast: () => ({ show: jest.fn() }) }));
jest.mock('@lasyncro/shared/ui', () => ({
  SpotlightCoachMark: jest.requireActual('../../../../modules/shared/src/ui/SpotlightCoachMark').SpotlightCoachMark,
  IsometricCanvas: () => null, EntityDetailModal: () => null,
}));
jest.mock('@lasyncro/overview', () => ({ OverviewModuleFT2: ({ mapContent }: any) => <div>{mapContent}</div> }), { virtual: true });
jest.mock('components/OpsConsole/useGlobalSearch', () => ({ useGlobalSearch: () => ({ results: [], isFetching: false, isError: false }) }));
jest.mock('pages/operations/useHistory', () => ({ useHistory: () => ({ data: { items: [] }, isLoading: false, isError: false }) }));
jest.mock('pages/operations/useWaiting', () => ({ useWaiting: () => ({ data: { items: [] }, isLoading: false, isError: false }) }));
jest.mock('pages/orders/OrderDetailModalBody', () => ({ OrderDetailModalBody: () => null }));
jest.mock('pages/ft2-pages/BatchDetailModalBody', () => ({ BatchDetailModalBody: () => null }));
jest.mock('pages/ft2-pages/VariantDetailModalHost', () => ({ VariantDetailModalHost: () => null }));
jest.mock('pages/wms/usePickBatches', () => ({ usePickBatches: () => ({ data: { batches: [] }, isLoading: false, isError: false }) }));
jest.mock('analytics/useUiEvents', () => ({ useUiEvents: () => ({ emit: jest.fn() }) }), { virtual: true });
jest.mock('contexts/EntitlementsContext', () => ({ useEntitlements: () => ({ displayCurrency: 'USD', tier: 'scale', hasResolved: true }) }));
jest.mock('runtime/commercialContext', () => ({ useCommercialAccess: () => ({ context: { tier: 'scale', modules: new Set(), flags: new Set() }, isResolved: true, decide: () => ({ allowed: true }) }) }));
jest.mock('pages/overview/useOverviewFt2Adapter', () => ({ mapOverviewFt2Props: () => ({ trust: {}, pulse: {} }) }));
jest.mock('pages/overview/useOverviewModulesFt2Snapshot', () => ({ useOverviewModulesFt2Snapshot: () => ({ data: {}, isPending: false, isError: false }) }));
jest.mock('pages/trust/useTrustFt2Snapshot', () => ({ useTrustFt2Snapshot: () => ({ data: null }) }));
jest.mock('pages/overview/useMorningBriefSnapshot', () => ({ useMorningBriefSnapshot: () => ({ data: { signals: [], hasUrgentIssues: false }, isPending: false, isError: false, refreshMorningBrief: jest.fn() }) }));
jest.mock('pages/floor-planning/useFloorPlanning', () => ({ useFloorPlanning: () => ({ data: { zones: [] }, isLoading: false, isError: false, refetch: jest.fn() }) }));
jest.mock('pages/floor-planning/useWarehouseGrid', () => ({ useWarehouseGridOccupancy: () => ({ data: { occupancy: {} } }) }));
jest.mock('pages/wms/useOrderPool', () => ({ useOrderPool: () => ({ data: { eligible_order_count: 0, summary: { blocked_count: 0 } }, isPending: false, isError: false }), useBulkSetPriority: () => ({ mutateAsync: jest.fn() }) }));
jest.mock('pages/wms/useWmsLiveActivity', () => ({ useWmsLiveActivity: () => ({ data: { pickerPositions: [], activeBatches: [], stowPressure: { by_location: [] }, receiveAtDock: [], awaitingPackUnits: 0, shippedToday: 0, packedNotShipped: 0 }, isLoading: false, isError: false }) }));
jest.mock('hooks/useIdleAlerts', () => ({ useIdleAlerts: () => ({ alerts: [], isLoading: false, isError: false }) }));
jest.mock('pages/problem-center/useProblemCenter', () => ({ useProblemCenter: () => ({ data: { tasks: [] }, isLoading: false, isError: false }) }));
jest.mock('pages/orders/AddressResolutionSessionModal', () => ({ AddressResolutionSessionModal: () => null }));
jest.mock('pages/orders/useAddressResolutionOrders', () => ({ useAddressResolutionOrders: () => ({ candidates: [], isLoading: false, isError: false }), useInvalidateAddressResolutionOrders: () => jest.fn() }));

const READY = ['onboarding', 'readiness'];
const FLAGS = ['user-state', 'onboarding-flags'];
const INTRO = 'ops-console:intro-seen';
const MAP_SEEN = 'ops-console:map-count-handoff-seen';
const PATCH = '/api/v1/settings/shop/warehouses/wh-one/shopify-location';
const clients: QueryClient[] = [];
const dispatches: any[] = [];
const locations: { pathname: string; state: unknown }[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function snapshot(mapped: boolean | null, physical = false, firstEntry = true) {
  return { modules: [{ moduleId: 'wms', tasks: [
    { id: 'map-zones', complete: physical }, { id: 'reconcile-inventory', complete: !firstEntry },
  ], signals: [
    ...(mapped === null ? [] : [{ name: 'wms.externalLocationMapped', value: mapped }]),
    { name: 'wms.zonesConfigured', value: physical },
    { name: 'wms.openingInventoryReconciliationRequired', value: firstEntry },
    { name: 'wms.openingInventoryReconciled', value: !firstEntry },
  ] }] };
}
function TrackDispatch({ children }: { children: React.ReactNode }) {
  const config = React.useContext(ConfigContext);
  const dispatch = React.useCallback((action: any) => { dispatches.push(action); config.dispatch(action); }, [config.dispatch]);
  return <ConfigContext.Provider value={{ ...config, dispatch }}>{children}</ConfigContext.Provider>;
}
function Observe() {
  const location = useLocation();
  const navigate = useNavigate();
  const { state, dispatch } = useConfig();
  const checklist = useActivationChecklist();
  React.useEffect(() => { locations.push({ pathname: location.pathname, state: location.state }); }, [location]);
  return <>
    <output data-testid="path">{location.pathname}</output>
    <output data-testid="open">{String(state.isOpsConsoleOpen)}</output>
    <output data-testid="canonical">{String(checklist.externalLocationMapped)}</output>
    <output data-testid="physical">{String(checklist.minimumMappingReady)}</output>
    <button onClick={() => dispatch({ type: 'SET_OPS_CONSOLE', payload: false })}>close through authority</button>
    <button onClick={() => navigate('/orders')}>leave overview</button>
    <button onClick={() => navigate('/overview')}>revisit overview</button>
  </>;
}
async function tick(ms = 50) { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); }
const open = () => screen.getByTestId('open').textContent === 'true';
const openActions = () => dispatches.filter(a => a.type === 'SET_OPS_CONSOLE' && a.payload === true);
const introPosts = () => (axiosInstance.post as jest.Mock).mock.calls.filter(([url]) => url === '/api/v1/user-state/ops-console/intro-seen');
async function mount(opts: { mapped?: boolean | null; physical?: boolean; firstEntry?: boolean; background?: string; pending?: boolean; twoWarehouses?: boolean; pendingFlags?: boolean; journeyIntent?: boolean; guide?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  clients.push(client);
  let canonical = snapshot(opts.mapped === undefined ? false : opts.mapped, opts.physical, opts.firstEntry);
  let readinessPending = opts.pending ?? false;
  const readiness = deferred<any>();
  const persistence = deferred<any>();
  let mappedOne = opts.mapped === true ? 'loc-one' : null;
  const flags = opts.pendingFlags ? {} : { [INTRO]: true, [MAP_SEEN]: true };
  (axiosInstance.get as jest.Mock).mockImplementation((url: string) => {
    if (url === '/api/v1/onboarding/readiness') return readinessPending ? readiness.promise : Promise.resolve({ data: canonical });
    if (url === '/api/v1/user-state/onboarding-flags') return opts.pendingFlags ? new Promise(() => {}) : Promise.resolve({ data: { ...flags } });
    if (url === '/api/v1/user-state/activation-events') return Promise.resolve({ data: {} });
    if (url === '/api/v1/wms/opening-inventory/progress') return Promise.resolve({ data: { progress: { state: 'not_started', total_bins: 0, complete_bins: 0, bins: [] }, cutover: null, shopify_synced_at: null } });
    if (url === '/api/v1/settings/shop/warehouse-shopify-locations') return Promise.resolve({ data: {
      warehouses: [
        { warehouse_id: 'wh-one', name: 'Warehouse one', active: true, is_default: true, shopify_location_id: mappedOne },
        ...(opts.twoWarehouses ? [{ warehouse_id: 'wh-two', name: 'Warehouse two', active: true, is_default: false, shopify_location_id: null }] : []),
      ], shopify_locations: [{ shopify_location_id: 'loc-one', name: 'Main Shopify', is_active: true }, { shopify_location_id: 'loc-two', name: 'Other Shopify', is_active: true }],
    } });
    if (url.endsWith('/printers')) return Promise.resolve({ data: { printers: [] } });
    if (url.endsWith('/display-tokens')) return Promise.resolve({ data: { tokens: [] } });
    throw new Error(`Unexpected continuity GET: ${url}`);
  });
  (axiosInstance.patch as jest.Mock).mockImplementation(() => persistence.promise.then(result => { mappedOne = result.data.shopify_location_id; return result; }));
  (axiosInstance.post as jest.Mock).mockResolvedValue({ data: {} });
  const auth = { user: { id: 7, shop_id: 1, role: 'owner', first_name: 'Test' }, isLoading: false } as React.ContextType<typeof AuthContext>;
  const background = { pathname: opts.background ?? '/orders', search: '', hash: '', state: null };
  // Ephemeral route state, independent of the coaching query and canonical readiness.
  const entryState = {
    backgroundLocation: background,
    ...(opts.journeyIntent === false ? {} : { onboardingJourney: 'first-entry-shopify-location' }),
  };
  render(<MemoryRouter initialEntries={[{ pathname: '/settings/warehouse', search: opts.guide === false ? '' : '?guide=shopify-location', state: entryState }]}>
    <AuthContext.Provider value={auth}><QueryClientProvider client={client}><ConfigProvider><TrackDispatch>
      <Observe /><OpsConsoleButton alerts={[]} />
      <Routes>
        <Route path="/settings/warehouse" element={<SettingsModalShell returnLocation={background}><ShopSettingsWarehousePage /></SettingsModalShell>} />
        <Route path="/overview" element={<OverviewPageFT2 />} />
        <Route path="/orders" element={<div>Orders</div>} />
      </Routes>
    </TrackDispatch></ConfigProvider></QueryClientProvider></AuthContext.Provider>
  </MemoryRouter>);
  await tick();
  expect(locations[0]).toEqual({ pathname: '/settings/warehouse', state: entryState });
  await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(opts.twoWarehouses ? 2 : 1));
  if (!opts.pending) await waitFor(() => expect(client.getQueryState(READY)?.status).toBe('success'));
  return {
    client,
    async select() {
      fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
      fireEvent.click(await screen.findByRole('option', { name: 'Main Shopify' }));
      await tick();
      expect(axiosInstance.patch).toHaveBeenCalledWith(PATCH, { shopify_location_id: 'loc-one' });
    },
    async persist(mapped: boolean | null = true, locationId = 'loc-one') {
      canonical = snapshot(mapped, opts.physical, opts.firstEntry);
      await act(async () => { persistence.resolve({ data: { warehouse_id: 'wh-one', shopify_location_id: locationId } }); });
      await tick();
    },
    async fail() { await act(async () => { persistence.reject(new Error('Mapping rejected')); }); await tick(); },
    async refresh(mapped: boolean | null) {
      canonical = snapshot(mapped, opts.physical, opts.firstEntry);
      await act(async () => { await client.refetchQueries({ queryKey: READY }); }); await tick();
    },
    async resolveInitial(mapped: boolean) {
      readinessPending = false; canonical = snapshot(mapped, opts.physical, opts.firstEntry);
      await act(async () => { readiness.resolve({ data: canonical }); }); await tick();
    },
  };
}
async function closeX() { fireEvent.click(screen.getByRole('button', { name: 'Close settings' })); await tick(); }
function expectOrdinaryReturn() {
  expect(screen.getByTestId('path')).toHaveTextContent('/orders');
  expect(open()).toBe(false);
  expect(openActions()).toHaveLength(0);
  expect(locations.at(-1)?.state).toBeNull();
  expect(introPosts()).toHaveLength(0);
}
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers(); dispatches.length = 0; locations.length = 0;
  jest.spyOn(window, 'WebSocket').mockImplementation(() => ({ close: jest.fn() } as unknown as WebSocket));
});
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); jest.restoreAllMocks(); jest.useRealTimers(); });

describe('RED: Shopify-location Settings X → Overview continuity', () => {
  it('armed real X bypasses the background route and carries ephemeral continuation intent to Overview', async () => {
    const h = await mount();
    expect(screen.getByTestId('canonical')).toHaveTextContent('false');
    await h.select(); await h.persist();
    expect(screen.getByTestId('canonical')).toHaveTextContent('true');
    expect(open()).toBe(false);
    await closeX();
    expect(screen.getByTestId('path')).toHaveTextContent('/overview');
    // Assert a one-shot transport exists without freezing its property name.
    expect(locations.find(l => l.pathname === '/overview')?.state).toEqual(expect.any(Object));
  });
  it('Overview consumes once via SET_OPS_CONSOLE without intro-seen dependence, search focus or Map/Count truth changes', async () => {
    const h = await mount({ background: '/overview', pendingFlags: true });
    await h.select(); await h.persist();
    const readyBefore = h.client.getQueryData(READY);
    await closeX();
    expect(screen.getByTestId('path')).toHaveTextContent('/overview');
    expect(openActions()).toEqual([{ type: 'SET_OPS_CONSOLE', payload: true }]);
    expect(open()).toBe(true);
    expect(screen.getByTestId('ops-global-search-input')).not.toHaveFocus();
    expect(within(screen.getByTestId('ops-row-setup:first-entry-map')).getByRole('button', { name: /^Map warehouse/ })).toBeVisible();
    expect(within(screen.getByTestId('ops-row-setup:first-entry-count')).queryByRole('button', { name: 'Start opening count' })).toBeNull();
    expect(h.client.getQueryData(READY)).toEqual(readyBefore);
    expect(h.client.getQueryData(FLAGS)).toBeUndefined();
    expect(introPosts()).toHaveLength(0);
    const initialIntent = locations.find(l => l.pathname === '/overview')?.state;
    expect(initialIntent).toEqual(expect.any(Object));
    const consumedState = locations.at(-1)?.state;
    expect(consumedState).not.toEqual(initialIntent);
    fireEvent.click(screen.getByText('close through authority')); await tick();
    fireEvent.click(screen.getByText('leave overview')); await tick();
    fireEvent.click(screen.getByText('revisit overview')); await tick();
    expect(open()).toBe(false); expect(openActions()).toHaveLength(1);
    expect(locations.at(-1)?.state).toEqual(consumedState);
  });
  it('already physically mapped completion retains actionable Count during continuation', async () => {
    const h = await mount({ physical: true, background: '/overview' });
    await h.select(); await h.persist(); await closeX();
    expect(openActions()).toEqual([{ type: 'SET_OPS_CONSOLE', payload: true }]);
    expect(within(screen.getByTestId('ops-row-setup:first-entry-count')).getByRole('button', { name: 'Start opening count' })).toBeEnabled();
    expect(screen.getByTestId('physical')).toHaveTextContent('true');
    expect(introPosts()).toHaveLength(0);
  });
  it('successful relevant PATCH arms only after the refreshed canonical false→true edge', async () => {
    const h = await mount(); await h.select(); await h.persist(false);
    expect(screen.getByTestId('canonical')).toHaveTextContent('false'); expect(open()).toBe(false);
    await h.refresh(true); expect(screen.getByTestId('canonical')).toHaveTextContent('true');
    await closeX(); expect(screen.getByTestId('path')).toHaveTextContent('/overview');
  });
  it('Escape after eligible completion restores the background without continuation', async () => {
    const h = await mount(); await h.select(); await h.persist();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    await tick(); expectOrdinaryReturn();
  });
  it('backdrop after eligible completion restores the background without continuation', async () => {
    const h = await mount(); await h.select(); await h.persist();
    // MUI Dialog reports backdrop clicks from its dialog container; use its
    // actual event path rather than invoking the close callback directly.
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    await tick(); expectOrdinaryReturn();
  });
  it('one mapped warehouse with another still unmapped remains canonical false and cannot cue', async () => {
    const h = await mount({ twoWarehouses: true }); await h.select(); await h.persist(false);
    expect(screen.getByTestId('canonical')).toHaveTextContent('false');
    expect(screen.getAllByRole('combobox')[1].parentElement?.querySelector('input')).toHaveValue('');
    await closeX(); expectOrdinaryReturn();
  });
  it('failed relevant PATCH cannot cue even if a later readiness read becomes true', async () => {
    const h = await mount(); await h.select(); await h.fail(); await h.refresh(true);
    await closeX(); expectOrdinaryReturn();
  });
  it('canonical false→true without relevant persistence cannot cue', async () => {
    const h = await mount(); await h.refresh(true);
    expect(axiosInstance.patch).not.toHaveBeenCalled(); await closeX(); expectOrdinaryReturn();
  });
  it('late successful PATCH after ordinary X close cannot resurrect the abandoned Settings visit', async () => {
    const h = await mount();
    expect(screen.getByTestId('canonical')).toHaveTextContent('false');
    await h.select();
    expect(screen.getByTestId('canonical')).toHaveTextContent('false');
    await closeX();
    expectOrdinaryReturn();
    const returnedVisitIndex = locations.length - 1;
    expect(screen.queryByRole('dialog', { name: 'Shop settings' })).toBeNull();

    await h.persist();
    await waitFor(() => expect(screen.getByTestId('canonical')).toHaveTextContent('true'));
    await tick();

    expectOrdinaryReturn();
    expect(screen.queryByRole('dialog', { name: 'Shop settings' })).toBeNull();
    expect(locations.slice(returnedVisitIndex)).toEqual([
      { pathname: '/orders', state: null },
    ]);
    expect(openActions()).toHaveLength(0);
  });
  it('pending PATCH cannot cue even if refreshed canonical readiness becomes true', async () => {
    const h = await mount(); await h.select(); await h.refresh(true);
    await closeX(); expectOrdinaryReturn();
  });
  it('successful PATCH while refreshed canonical readiness is unresolved cannot cue', async () => {
    const h = await mount(); await h.select(); await h.persist(null);
    expect(screen.getByTestId('canonical')).toHaveTextContent('null'); await closeX(); expectOrdinaryReturn();
  });
  it('loading→true cannot invent the required observed false baseline', async () => {
    const h = await mount({ pending: true }); await h.select(); await h.persist(); await h.resolveInitial(true);
    await closeX(); expectOrdinaryReturn();
  });
  it('missing signal→true cannot invent the required observed false baseline', async () => {
    const h = await mount({ mapped: null }); await h.select(); await h.persist();
    await closeX(); expectOrdinaryReturn();
  });
  it('guide query plus backgroundLocation without first-entry journey intent cannot cue', async () => {
    const h = await mount({ journeyIntent: false });
    expect(screen.getByTestId('canonical')).toHaveTextContent('false');
    await h.select(); await h.persist();
    expect(screen.getByTestId('canonical')).toHaveTextContent('true');
    await closeX(); expectOrdinaryReturn();
  });
  it('ordinary Warehouse Settings without guide or first-entry journey intent cannot cue', async () => {
    const h = await mount({ journeyIntent: false, guide: false });
    expect(screen.getByTestId('canonical')).toHaveTextContent('false');
    await h.select(); await h.persist();
    expect(screen.getByTestId('canonical')).toHaveTextContent('true');
    await closeX(); expectOrdinaryReturn();
  });
  it('already-complete Settings entry does not cue after another successful location save', async () => {
    const h = await mount({ mapped: true });
    // Save another actual location: entry baseline was already true.
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'Other Shopify' })); await tick();
    expect(axiosInstance.patch).toHaveBeenCalledWith(PATCH, { shopify_location_id: 'loc-two' });
    await h.persist(true, 'loc-two'); await closeX(); expectOrdinaryReturn();
  });
  it('mature Settings entry cannot cue despite successful false→true mapping', async () => {
    const h = await mount({ firstEntry: false }); await h.select(); await h.persist();
    await closeX(); expectOrdinaryReturn();
  });
  it('opening Settings never automatically focuses its search', async () => {
    await mount(); expect(screen.getByRole('textbox', { name: 'Search settings' })).not.toHaveFocus();
  });
});
