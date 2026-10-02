/** GH-1183 RED: real checklist, QueryClient and ConfigContext; only HTTP and
 * unrelated operational feeds are stubbed. No preconstructed checklist model. */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate, useSearchParams: () => [new URLSearchParams('tab=setup&view=canvas'), jest.fn()] }));
jest.mock('api/axiosConfig', () => ({ axiosInstance: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
jest.mock('@lasyncro/shared/ui', () => ({
  EntityDetailModal: ({ entityId, title, children, footerActions }: any) => entityId ? <section role="dialog" aria-label={title}>{children}{footerActions}</section> : null,
  ModuleErrorBoundary: ({ children }: any) => children,
  ModuleLoadingSkeleton: () => null,
  WarehouseGrid: () => null,
  DecisionConfirmationModal: () => null,
  SpotlightCoachMark: jest.requireActual('../../../../modules/shared/src/ui/SpotlightCoachMark').SpotlightCoachMark,
}));
jest.mock('components/OpsConsole/useGlobalSearch', () => ({ useGlobalSearch: () => ({ results: [], isFetching: false, isError: false }) }));
jest.mock('pages/operations/useHistory', () => ({ useHistory: () => ({ data: { items: [] }, isLoading: false, isError: false }) }));
jest.mock('pages/operations/useWaiting', () => ({ useWaiting: () => ({ data: { items: [] }, isLoading: false, isError: false }) }));
jest.mock('pages/orders/OrderDetailModalBody', () => ({ OrderDetailModalBody: () => null }));
jest.mock('pages/ft2-pages/BatchDetailModalBody', () => ({ BatchDetailModalBody: () => null }));
jest.mock('pages/ft2-pages/VariantDetailModalHost', () => ({ VariantDetailModalHost: () => null }));
jest.mock('pages/wms/usePickBatches', () => ({ usePickBatches: () => ({ data: { batches: [] }, isLoading: false, isError: false }) }));
jest.mock('pages/wms/useOrderPool', () => ({ useBulkSetPriority: () => ({ mutateAsync: jest.fn() }) }));
// Resolve the worktree source rather than a sibling package's generated dist.
jest.mock('@lasyncro/floor-planning', () => ({ FloorPlanningModuleFT2: jest.requireActual('../../../../modules/floor-planning/src/ui/pages/FloorPlanningModuleFT2').default }), { virtual: true });
jest.mock('components/CommercialGate', () => ({ CommercialGate: ({ children }: any) => children }));
jest.mock('components/ModuleTabBar', () => ({ ModuleTabBar: () => null }));
jest.mock('contexts/ToastContext', () => ({ useToast: () => ({ show: jest.fn() }) }));
import FloorPlanningPage from 'pages/ft2-pages/FloorPlanningPage';
import { axiosInstance } from 'api/axiosConfig';
import { AuthContext } from 'contexts/AuthContext';
import { ConfigProvider } from 'contexts/ConfigContext';
import useConfig from 'hooks/useConfig';
import { OpsConsoleButton, OPS_CONSOLE_AUTO_OPEN_DELAY_MS } from 'components/OpsConsole/OpsConsole';

const READY = ['onboarding', 'readiness'];
const FLAGS = ['user-state', 'onboarding-flags'];
const READINESS_URL = '/api/v1/onboarding/readiness';
const FLAGS_URL = '/api/v1/user-state/onboarding-flags';
const PROGRESS_URL = '/api/v1/wms/opening-inventory/progress';
const SEEN = 'ops-console:map-count-handoff-seen';
const INTRO = 'ops-console:intro-seen';
// Desired endpoint follows the existing intro-seen convention; no new system.
const SEEN_URL = '/api/v1/user-state/ops-console/map-count-handoff-seen';
const TITLE = 'Ready to count opening stock';
const clients: QueryClient[] = [];
let opens: boolean[];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function snapshot(
  ready: boolean | null,
  firstEntry = true,
  externalLocationMapped = true,
) {
  return { modules: [{ moduleId: 'wms', tasks: [
    ...(ready === null ? [] : [{ id: 'map-zones', complete: ready }]),
    { id: 'reconcile-inventory', complete: !firstEntry },
  ], signals: [
    ...(ready === null ? [] : [{ name: 'wms.zonesConfigured', value: ready }]),
    // GH-1179: this GH-1183 suite starts after Shopify Location mapping.
    // It isolates the later physical map → opening-count handoff.
    { name: 'wms.externalLocationMapped', value: externalLocationMapped },
    { name: 'wms.openingInventoryReconciliationRequired', value: firstEntry },
    { name: 'wms.openingInventoryReconciled', value: !firstEntry },
  ] }] };
}
const progress = { progress: { state: 'not_started', total_bins: 0, complete_bins: 0, bins: [] }, cutover: null, shopify_synced_at: null };
function ObserveOpen() {
  const { state } = useConfig();
  React.useEffect(() => { opens.push(state.isOpsConsoleOpen); }, [state.isOpsConsoleOpen]);
  return <output data-testid="open-state">{String(state.isOpsConsoleOpen)}</output>;
}
async function tick(ms = 50) { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); }
const isOpen = () => screen.getByTestId('open-state').textContent === 'true';
function noHandoff() { expect(screen.queryByText(TITLE)).not.toBeInTheDocument(); }
function noExecution() {
  expect((axiosInstance.post as jest.Mock).mock.calls.filter(([url]) => url === '/api/v1/wms/opening-inventory/start')).toHaveLength(0);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mockNavigate).not.toHaveBeenCalled();
}
async function expectCoach() {
  await waitFor(() => expect(screen.getAllByText(TITLE).length).toBeGreaterThan(0));
  expect(isOpen()).toBe(true);
  expect(screen.getByRole('tab', { name: 'OPEN' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByTestId('ops-first-entry-setup-toggle')).toHaveAttribute('aria-expanded', 'true');
  expect(within(screen.getByTestId('ops-row-setup:first-entry-count')).getByRole('button', { name: 'Start opening count' })).toBeVisible();
  const body = /first stock location is mapped.*start counting now.*keep mapping your warehouse first/i;
  expect(screen.getAllByText(body).length).toBeGreaterThan(0);
  noExecution();
}
async function mount(opts: { initial?: boolean | null; firstEntry?: boolean; externalLocationMapped?: boolean; flags?: Record<string, boolean>; pendingReadiness?: boolean; pendingFlags?: boolean; pendingProgress?: boolean; persistFails?: boolean; floor?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  clients.push(client);
  const readinessGate = deferred<{ data: ReturnType<typeof snapshot> }>();
  const flagsGate = deferred<{ data: Record<string, boolean> }>();
  const progressGate = deferred<{ data: typeof progress }>();
  let locationMapped = opts.externalLocationMapped ?? true;
  let server = snapshot(opts.initial === undefined ? false : opts.initial, opts.firstEntry ?? true, locationMapped);
  const flags = opts.flags ?? { [INTRO]: true };
  let readyPending = opts.pendingReadiness ?? false;
  (axiosInstance.get as jest.Mock).mockImplementation((url: string) => {
    if (url === READINESS_URL) return readyPending ? readinessGate.promise : Promise.resolve({ data: server });
    if (url === FLAGS_URL) return opts.pendingFlags ? flagsGate.promise : Promise.resolve({ data: { ...flags } });
    if (url === PROGRESS_URL) return opts.pendingProgress ? progressGate.promise : Promise.resolve({ data: progress });
    if (url === '/api/v1/user-state/activation-events') return Promise.resolve({ data: { wave_released: false } });
    if (url === '/api/v1/floor-planning/layout') return Promise.resolve({ data: { zones: [{
      location_code: 'ROOT', type: 'warehouse', active: true, zone_type: null,
      parent_location_code: null, barcode: null, children_count: 0,
      position_x: 0, position_y: 0, width: 20, depth: 15, orientation: 0,
      rack_levels: null, last_printed_at: null, warehouse_name: 'Test warehouse',
    }], product_barcodes: [] } });
    if (url === '/api/v1/floor-planning/grid') return Promise.resolve({ data: { locations: [] } });
    if (url === '/api/v1/floor-planning/grid/occupancy') return Promise.resolve({ data: { occupancy: {} } });
    throw new Error(`Unexpected GH1183 GET: ${url}`);
  });
  (axiosInstance.post as jest.Mock).mockImplementation((url: string) => {
    if (url === SEEN_URL) {
      if (opts.persistFails) return Promise.reject(new Error('GH1183 persistence unavailable'));
      flags[SEEN] = true;
    }
    return Promise.resolve({ data: { seen: true } });
  });
  const auth = { user: { id: 7, shop_id: 1, role: 'owner' } } as unknown as React.ContextType<typeof AuthContext>;
  const view = render(<AuthContext.Provider value={auth}><QueryClientProvider client={client}><ConfigProvider><ObserveOpen /><OpsConsoleButton alerts={[]} />{opts.floor && <FloorPlanningPage />}</ConfigProvider></QueryClientProvider></AuthContext.Provider>);
  await tick();
  if (!opts.pendingReadiness) await waitFor(() => expect(client.getQueryState(READY)?.status).toBe('success'));
  return {
    ...view, client, flags,
    async transition(ready: boolean | null) {
      server = snapshot(ready, opts.firstEntry ?? true, locationMapped);
      await act(async () => { await client.refetchQueries({ queryKey: READY }); });
      await tick();
    },
    async transitionLocationMapped(mapped: boolean) {
      locationMapped = mapped;
      server = snapshot(
        opts.initial === undefined ? false : opts.initial,
        opts.firstEntry ?? true,
        locationMapped,
      );
      await act(async () => {
        await client.refetchQueries({ queryKey: READY });
      });
      await tick();
    },
    async resolveInitial(ready: boolean) {
      readyPending = false; server = snapshot(ready, opts.firstEntry ?? true, locationMapped);
      await act(async () => { readinessGate.resolve({ data: server }); }); await tick();
    },
    async resolveFlags() { await act(async () => { flagsGate.resolve({ data: { ...flags } }); }); await tick(); },
    async resolveProgress() { await act(async () => { progressGate.resolve({ data: progress }); }); await tick(); },
    async refetchThroughLoading(ready: boolean) {
      const gate = deferred<{ data: ReturnType<typeof snapshot> }>();
      (axiosInstance.get as jest.Mock).mockImplementationOnce(() => gate.promise);
      let request!: Promise<void>;
      act(() => { request = client.refetchQueries({ queryKey: READY }); });
      await tick();
      expect(client.getQueryState(READY)?.fetchStatus).toBe('fetching');
      await act(async () => { gate.resolve({ data: snapshot(ready, opts.firstEntry ?? true, locationMapped) }); await request; }); await tick();
    },
  };
}
beforeEach(() => { jest.resetAllMocks(); jest.useFakeTimers(); opens = []; Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Linux' }); });
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); jest.useRealTimers(); });


// GH-1179 ratified location-first navigation, retaining the real readiness hook.
describe('GH-1179 guided Shopify Location journey', () => {
  const LOCATION_TITLE = 'Choose your Shopify location';
  it('Start here closes Ops and navigates to Settings, without a second coach', async () => {
    await mount({ initial: false, externalLocationMapped: false, flags: {} });
    await tick(OPS_CONSOLE_AUTO_OPEN_DELAY_MS);
    const coach = screen.getByTestId('ops-first-contact-spotlight');
    expect(coach).toHaveTextContent('Ops Console shows what needs your attention and what to do next. First, tell LaSyncro which Shopify Location this warehouse represents.');
    expect(within(coach).queryByRole('button', { name: 'Got it' })).toBeNull();
    fireEvent.click(within(coach).getByRole('button', { name: 'Choose Shopify location' }));
    expect(isOpen()).toBe(false);
    expect(mockNavigate).toHaveBeenCalledWith('/settings/warehouse?guide=shopify-location');
    await tick(OPS_CONSOLE_AUTO_OPEN_DELAY_MS);
    expect(screen.queryAllByText(LOCATION_TITLE)).toHaveLength(0);
  });
  it('X dismisses only the intro and never raises a second location coach', async () => {
    await mount({ initial: false, externalLocationMapped: false, flags: {} });
    await tick(OPS_CONSOLE_AUTO_OPEN_DELAY_MS);
    fireEvent.click(within(screen.getByTestId('ops-first-contact-spotlight')).getByRole('button', { name: 'Dismiss' }));
    await tick(OPS_CONSOLE_AUTO_OPEN_DELAY_MS);
    expect(isOpen()).toBe(true);
    expect(screen.queryAllByText(LOCATION_TITLE)).toHaveLength(0);
    expect(within(screen.getByTestId('ops-row-setup:first-entry-map')).queryByRole('button', { name: /Map warehouse/ })).toBeNull();
    noExecution();
  });
  it('seen intro never auto-opens an Ops-local location coach', async () => {
    await mount({ initial: false, externalLocationMapped: false });
    await tick(OPS_CONSOLE_AUTO_OPEN_DELAY_MS);
    expect(isOpen()).toBe(false);
    expect(screen.queryAllByText(LOCATION_TITLE)).toHaveLength(0);
    expect((axiosInstance.post as jest.Mock).mock.calls.some(([url]) => url.includes('shopify-location-seen'))).toBe(false);
  });

  it('already mapped state skips prerequisite guidance and shows the verified row when the merchant opens Ops Console', async () => {
    await mount({
      initial: false,
      externalLocationMapped: true,
      flags: { [INTRO]: true },
    });

    await tick(OPS_CONSOLE_AUTO_OPEN_DELAY_MS);

    // Already mapped + intro already seen must not auto-open or fabricate
    // Shopify Location coaching.
    expect(isOpen()).toBe(false);
    expect(screen.queryAllByText(LOCATION_TITLE)).toHaveLength(0);

    // The rail is mountOnEnter/unmountOnExit, so inspect its setup rows only
    // after the merchant explicitly opens Ops Console.
    fireEvent.click(
      screen.getByRole('button', { name: /Ops Console —/ })
    );

    await waitFor(() => expect(isOpen()).toBe(true));

    expect(screen.queryAllByText(LOCATION_TITLE)).toHaveLength(0);

    expect(
      screen.getByTestId('ops-row-setup:first-entry-shopify-location')
    ).toHaveAttribute('data-status', 'verified');

    expect(
      within(
        screen.getByTestId('ops-row-setup:first-entry-map')
      ).getByRole('button', { name: /Map warehouse/ })
    ).toBeVisible();

    noExecution();
  });

  it('mapping completion retires location guidance and exposes Map warehouse as the next CTA', async () => {
    const h = await mount({
      initial: false,
      externalLocationMapped: false,
      flags: { [INTRO]: true },
    });

    await tick(OPS_CONSOLE_AUTO_OPEN_DELAY_MS);
    fireEvent.click(screen.getByRole('button', { name: /Ops Console —/ }));
    expect(screen.queryAllByText(LOCATION_TITLE)).toHaveLength(0);

    await h.transitionLocationMapped(true);

    await waitFor(() =>
      expect(screen.queryAllByText(LOCATION_TITLE)).toHaveLength(0)
    );

    expect(
      screen.getByTestId('ops-row-setup:first-entry-shopify-location')
    ).toHaveAttribute('data-status', 'verified');

    expect(
      within(
        screen.getByTestId('ops-row-setup:first-entry-map')
      ).getByRole('button', { name: /Map warehouse/ })
    ).toBeVisible();

    expect(
      within(
        screen.getByTestId('ops-row-setup:first-entry-count')
      ).queryByRole('button', { name: 'Start opening count' })
    ).not.toBeInTheDocument();

    noExecution();
  });

  it('zones already ready + Shopify Location false→true raises Ready to count exactly once', async () => {
    const h = await mount({
      initial: true,
      externalLocationMapped: false,
      flags: {
        [INTRO]: true,
      },
    });

    // Physical mapping is already sufficient, but the combined prerequisite
    // is still false because this warehouse is not mapped to Shopify yet.
    await tick(OPS_CONSOLE_AUTO_OPEN_DELAY_MS);

    expect(isOpen()).toBe(false);
    noHandoff();
    noExecution();

    expect(
      (axiosInstance.post as jest.Mock).mock.calls.filter(
        ([url]) => url === SEEN_URL,
      ),
    ).toHaveLength(0);

    // Shopify Location completes last. Combined readiness now moves
    // false → true even though zonesConfigured itself never changed.
    await h.transitionLocationMapped(true);

    await expectCoach();

    expect(opens.filter(Boolean)).toHaveLength(1);

    await waitFor(() =>
      expect(h.client.getQueryData(FLAGS)).toMatchObject({
        [SEEN]: true,
      }),
    );

    expect(
      (axiosInstance.post as jest.Mock).mock.calls.filter(
        ([url]) => url === SEEN_URL,
      ),
    ).toHaveLength(1);

    // Dismissal retires only the coach; it performs no opening-count work.
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Got it' })[0],
    );
    await tick();

    noHandoff();
    expect(isOpen()).toBe(true);
    noExecution();

    // A later false → true replay in the same mount must not raise or
    // persist the handoff a second time.
    fireEvent.click(
      screen.getByRole('button', { name: 'Close Ops Console' }),
    );
    await tick(800);

    await h.transitionLocationMapped(false);
    await h.transitionLocationMapped(true);
    await tick(800);

    expect(isOpen()).toBe(false);
    noHandoff();

    expect(opens.filter(Boolean)).toHaveLength(1);

    expect(
      (axiosInstance.post as jest.Mock).mock.calls.filter(
        ([url]) => url === SEEN_URL,
      ),
    ).toHaveLength(1);

    noExecution();
  });
});

describe('GH-1183 one-time canonical map→count handoff', () => {
  it('opens once on false→true, coaches Count, dismisses without execution, and preserves manual trigger', async () => {
    const h = await mount(); expect(isOpen()).toBe(false);
    await h.transition(true); await expectCoach();
    expect(opens.filter(Boolean)).toHaveLength(1);
    await waitFor(() => expect(h.client.getQueryData(FLAGS)).toMatchObject({ [SEEN]: true }));
    expect((axiosInstance.post as jest.Mock).mock.calls.filter(([url]) => url === SEEN_URL)).toHaveLength(1);
    const readyBefore = h.client.getQueryData(READY);
    // Both responsive renderings share dismissal; choose the first coach control.
    fireEvent.click(screen.getAllByRole('button', { name: 'Got it' })[0]); await tick();
    noHandoff(); expect(isOpen()).toBe(true); noExecution();
    expect(h.client.getQueryData(READY)).toEqual(readyBefore);
    expect(within(screen.getByTestId('ops-row-setup:first-entry-count')).getByRole('button', { name: 'Start opening count' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close Ops Console' })); await tick(800);
    await h.transition(true); await h.transition(false); await h.transition(true); await tick(800);
    expect(isOpen()).toBe(false); noHandoff(); expect(opens.filter(Boolean)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Ops Console/ })); await tick();
    expect(isOpen()).toBe(true); noHandoff(); noExecution();
  });
  it('initial true is only a baseline, not a handoff', async () => {
    await mount({ initial: true }); await tick(800); expect(isOpen()).toBe(false); noHandoff(); noExecution();
  });
  it('loading→true does not fabricate a false baseline', async () => {
    const h = await mount({ pendingReadiness: true }); noHandoff();
    await h.resolveInitial(true); await tick(800); expect(isOpen()).toBe(false); noHandoff();
  });
  it('missing readiness signal→true does not fabricate a false baseline', async () => {
    const h = await mount({ initial: null }); await h.transition(true); await tick(800); expect(isOpen()).toBe(false); noHandoff();
  });
  it('false→refetch loading→true preserves the valid edge', async () => {
    const h = await mount(); await h.refetchThroughLoading(true); await expectCoach();
    expect(opens.filter(Boolean)).toHaveLength(1);
  });
  it('preserves an edge while server flags are pending, without presenting early', async () => {
    const h = await mount({ pendingFlags: true }); await h.transition(true); await tick(800);
    expect(isOpen()).toBe(false); noHandoff();
    await h.resolveFlags(); await expectCoach();
  });
  it('preserves an edge while Count progress is pending, then coaches the actionable row', async () => {
    const h = await mount({ pendingProgress: true }); await h.transition(true); noHandoff();
    await h.resolveProgress(); await expectCoach();
  });
  it('server seen flag suppresses edges across fresh remounts', async () => {
    const h = await mount({ flags: { [INTRO]: true, [SEEN]: true } });
    await h.transition(true); await tick(800); noHandoff(); expect(isOpen()).toBe(false);
    h.unmount();
    const remount = await mount({ flags: { [INTRO]: true, [SEEN]: true } });
    await remount.transition(true); await tick(800); noHandoff(); expect(isOpen()).toBe(false);
  });
  it('already-open HISTORY/collapsed SETUP is brought to visible Count without a close/reopen', async () => {
    const h = await mount(); fireEvent.click(screen.getByRole('button', { name: /Ops Console/ })); await tick();
    fireEvent.click(screen.getByTestId('ops-first-entry-setup-toggle'));
    fireEvent.click(screen.getByRole('tab', { name: 'HISTORY' }));
    await h.transition(true); await expectCoach();
    expect(opens).toEqual([false, true]);
  });
  it('Ctrl+K search intent wins and the pending handoff becomes eligible after search exits', async () => {
    const h = await mount(); fireEvent.keyDown(window, { key: 'k', ctrlKey: true }); await tick();
    const input = screen.getByTestId('ops-global-search-input'); expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'merchant query' } });
    await h.transition(true); await tick(800); noHandoff(); expect(input).toHaveFocus(); expect(input).toHaveValue('merchant query');
    fireEvent.keyDown(input, { key: 'Escape' }); // clear query
    fireEvent.keyDown(input, { key: 'Escape' }); // leave search intent
    await expectCoach();
  });
  it('pending first-contact intro gets its own moment before Count coaching', async () => {
    const h = await mount({ flags: {} }); await h.transition(true); noHandoff();
    await tick(OPS_CONSOLE_AUTO_OPEN_DELAY_MS);
    expect(screen.getByTestId('ops-first-contact-spotlight')).toBeInTheDocument(); noHandoff();
    fireEvent.click(within(screen.getByTestId('ops-first-contact-spotlight')).getByRole('button', { name: 'Dismiss' }));
    await expectCoach();
  });
  it('mature mode never arms a handoff', async () => {
    const h = await mount({ firstEntry: false }); await h.transition(true); await tick(800);
    noHandoff(); expect(isOpen()).toBe(false); noExecution();
  });
  it('failed persistence does not claim durable seen state, while local consumption prevents repetition', async () => {
    const h = await mount({ persistFails: true }); await h.transition(true); await expectCoach(); await tick();
    expect(h.client.getQueryData<Record<string, boolean>>(FLAGS)?.[SEEN]).not.toBe(true);
    expect(h.flags[SEEN]).not.toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close Ops Console' })); await tick(800);
    await h.transition(false); await h.transition(true); await tick(800); noHandoff(); expect(isOpen()).toBe(false);
  });
});


// The real page owns network/query wiring; the real Canvas owns local coaching.
// A deliberately lagging layout read proves it cannot substitute for readiness.
describe('GH-1183 Floor coaching uses canonical readiness', () => {
  beforeEach(() => {
    jest.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, width: 1000, height: 500, toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => jest.restoreAllMocks());
  it('canonical true ends stock coaching even while the floor layout still contains only a bounded root', async () => {
    await mount({ initial: true, floor: true }); await tick();
    expect(screen.getByRole('button', { name: 'Add Stock location' })).toBeInTheDocument();
    expect(screen.queryByText('Add where you keep your stock')).not.toBeInTheDocument();
    noHandoff(); noExecution();
  });
  it('successful canvas creation cannot end stock coaching while canonical readiness remains false', async () => {
    await mount({ floor: true }); await tick();
    expect(screen.getByText('Add where you keep your stock')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Stock location' }));
    fireEvent.keyDown(screen.getByLabelText('Location code'), { key: 'Enter' }); await tick();
    expect(axiosInstance.post).toHaveBeenCalledWith('/api/v1/floor-planning/zones', expect.objectContaining({ type: 'bin', zone_type: 'pick' }));
    expect(screen.getByText('Add where you keep your stock')).toBeInTheDocument();
    expect(isOpen()).toBe(false); noHandoff(); noExecution();
  });
});
