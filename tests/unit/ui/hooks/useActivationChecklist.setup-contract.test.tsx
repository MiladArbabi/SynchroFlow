// tests/unit/ui/hooks/useActivationChecklist.setup-contract.test.tsx
//
// Architectural contract: Ops Console SETUP contains only the six
// in-app setup tasks. Shopify connection (connect-store) and initial
// sync (complete-sync) belong to PRE-APP onboarding and must never be
// emitted by useActivationChecklist.
//
// GH-1156: the sixth task, "Establish opening inventory", is the WMS
// reconcile-inventory readiness task. Its completion is readiness-owned;
// GET /api/v1/wms/opening-inventory/progress supplies presentation states
// only. The Start command is gated (advisory) on an owner/admin role.

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { axiosInstance } from 'api/axiosConfig';
import { AuthContext } from 'contexts/AuthContext';
import {
  useActivationChecklist,
  FIRST_ENTRY_COUNT_LOCKED_SUBTITLE,
  type ChecklistItem,
} from 'hooks/useActivationChecklist';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn() },
}));

const mockedGet = axiosInstance.get as jest.Mock;

const READINESS_URL = '/api/v1/onboarding/readiness';
const PROGRESS_URL = '/api/v1/wms/opening-inventory/progress';

function makeWrapper(role: string = 'owner') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const auth = { user: { role } } as unknown as React.ContextType<typeof AuthContext>;
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <AuthContext.Provider value={auth}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </AuthContext.Provider>
    );
  };
}

function progressView(over: {
  state: string;
  total_bins?: number;
  complete_bins?: number;
  cutover?: { status: string } | null;
  shopify_synced_at?: string | null;
}) {
  return {
    progress: {
      state: over.state,
      total_bins: over.total_bins ?? 0,
      complete_bins: over.complete_bins ?? 0,
    },
    cutover: over.cutover ?? null,
    shopify_synced_at: over.shopify_synced_at ?? null,
  };
}

function mockReadiness(opts: {
  reconcileComplete?: boolean;
  /** wms.openingInventoryReconciliationRequired; 'missing' omits the signal. */
  reconciliationRequired?: boolean | 'missing';
  progress?: unknown;
  progressError?: boolean;
  /** Readiness never resolves (stays loading). */
  readinessPending?: boolean;
  /** GH-1165 — wms.zonesConfigured and its map-zones task; default false. */
  zonesConfigured?: boolean;
} = {}) {
  const required = opts.reconciliationRequired ?? true;
  const zones = opts.zonesConfigured ?? false;
  const wmsSignals = required === 'missing'
    ? [{ name: 'wms.zonesConfigured', value: zones }]
    : [
        { name: 'wms.zonesConfigured', value: zones },
        { name: 'wms.openingInventoryReconciliationRequired', value: required },
        { name: 'wms.openingInventoryReconciled', value: opts.reconcileComplete ?? false },
      ];
  mockedGet.mockImplementation((url: string) => {
    if (url === READINESS_URL) {
      if (opts.readinessPending) return new Promise(() => undefined);
      return Promise.resolve({
        data: {
          modules: [
            {
              moduleId: 'platform',
              tasks: [
                { id: 'connect-store', complete: true },
                { id: 'complete-sync', complete: true },
              ],
            },
            {
              moduleId: 'order-nexus',
              tasks: [
                { id: 'orderNexus.resolveMissingCosts', complete: false },
              ],
            },
            {
              moduleId: 'wms',
              tasks: [
                { id: 'map-zones', complete: zones },
                { id: 'print-barcodes', complete: false },
                { id: 'connect-carrier', complete: false },
                { id: 'reconcile-inventory', complete: opts.reconcileComplete ?? false },
              ],
              signals: wmsSignals,
            },
          ],
        },
      });
    }

    if (url === '/api/v1/user-state/activation-events') {
      return Promise.resolve({ data: { wave_released: false } });
    }

    if (url === PROGRESS_URL) {
      if (opts.progressError) {
        return Promise.reject({ response: { status: 403, data: { error: 'Forbidden' } } });
      }
      return Promise.resolve({ data: opts.progress ?? progressView({ state: 'not_started' }) });
    }

    return Promise.resolve({ data: {} });
  });
}

function progressCalls() {
  return mockedGet.mock.calls.filter(([url]) => url === PROGRESS_URL).length;
}

function openingItem(items: ChecklistItem[]) {
  return items.find((i) => i.key === 'opening-inventory');
}

/** Records the Opening Inventory item as seen on EVERY render, to catch flashes. */
function renderRecording(role?: string) {
  const seen: Array<ChecklistItem | undefined> = [];
  const hook = renderHook(() => {
    const value = useActivationChecklist();
    seen.push(openingItem(value.items));
    return value;
  }, { wrapper: makeWrapper(role) });
  return { result: hook.result, seen };
}

async function renderChecklist(role?: string) {
  const hook = renderHook(() => useActivationChecklist(), { wrapper: makeWrapper(role) });
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook.result;
}

/** Resolves once the canonical progress read has been applied to the row. */
async function renderWithProgressApplied(role?: string) {
  const result = await renderChecklist(role);
  await waitFor(() => {
    const item = openingItem(result.current.items);
    expect(Boolean(item?.action) || Boolean(item?.subtitle) || item?.complete === true).toBe(true);
  });
  return result;
}

describe('useActivationChecklist — SETUP contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits exactly the six in-app Ops Console SETUP tasks and excludes pre-app onboarding', async () => {
    mockReadiness();
    const result = await renderWithProgressApplied();

    const keys = result.current.items.map((item) => item.key);

    expect(keys).toEqual([
      'fix-costs',
      'map-zones',
      'print-barcodes',
      'connect-carrier',
      'wave-released',
      'opening-inventory',
    ]);

    expect(result.current.items).toHaveLength(6);
    expect(keys).not.toContain('connect-store');
    expect(keys).not.toContain('complete-sync');

    const routeByKey = Object.fromEntries(
      result.current.items.map((item) => [item.key, item.actionRoute])
    );

    expect(routeByKey['fix-costs']).toBe('/inventory/catalog');
    // GH1176: supersedes the bare /floor-planning route.
    expect(routeByKey['map-zones']).toBe('/floor-planning?tab=setup&view=canvas');
    expect(routeByKey['print-barcodes']).toBe('/floor-planning?tab=barcodes');
    expect(routeByKey['connect-carrier']).toBe('/settings/carriers');
    expect(routeByKey['wave-released']).toBe('/orders/flow');
  });

  it('surfaces the reconcile-inventory task as "Establish opening inventory", never the internal wording', async () => {
    mockReadiness();
    const result = await renderWithProgressApplied();

    expect(openingItem(result.current.items)?.label).toBe('Establish opening inventory');
    for (const item of result.current.items) {
      expect(`${item.label} ${item.subtitle ?? ''}`).not.toMatch(/reconcile/i);
    }
  });
});

describe('useActivationChecklist — Opening Inventory canonical lifecycle (GH-1156)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['owner', 'admin'])(
    'not_started + %s: incomplete, direct Start opening count command, no navigation',
    async (role) => {
      mockReadiness({ progress: progressView({ state: 'not_started' }) });
      const result = await renderWithProgressApplied(role);

      const item = openingItem(result.current.items);
      expect(item?.complete).toBe(false);
      expect(item?.action).toEqual({
        kind: 'command', label: 'Start opening count', command: 'opening_inventory_start',
      });
      expect(item?.actionRoute).toBeUndefined();
    }
  );

  it('not_started + operator: row shown with owner/admin copy and no Start command', async () => {
    mockReadiness({ progress: progressView({ state: 'not_started' }) });
    const result = await renderWithProgressApplied('operator');

    const item = openingItem(result.current.items);
    expect(item?.complete).toBe(false);
    expect(item?.subtitle).toBe('Owner or admin must start');
    expect(item?.action).toBeUndefined();
    expect(item?.actionRoute).toBeUndefined();
  });

  it.each(['owner', 'operator'])(
    'counting + %s: canonical bin progress, Continue to Warehouse Operations, no start command',
    async (role) => {
      mockReadiness({ progress: progressView({ state: 'counting', total_bins: 17, complete_bins: 6 }) });
      const result = await renderWithProgressApplied(role);

      const item = openingItem(result.current.items);
      expect(item?.complete).toBe(false);
      expect(item?.meta).toBe('6 / 17 bins');
      expect(item?.subtitle).toBe('Warehouse Operations · Inventory checks');
      expect(item?.action).toEqual({ kind: 'navigate', label: 'Continue', route: '/wms' });
    }
  );

  it.each(['needs_bin_review', 'review_required'])(
    '%s: review required, routed to the Warehouse opening inventory review surface',
    async (state) => {
      mockReadiness({ progress: progressView({ state, total_bins: 17, complete_bins: 17 }) });
      const result = await renderWithProgressApplied();

      const item = openingItem(result.current.items);
      expect(item?.complete).toBe(false);
      expect(item?.lifecycle).toBe('attention');
      expect(item?.subtitle).toBe('Review required');
      expect(item?.action).toEqual({ kind: 'navigate', label: 'Review', route: '/wms' });
    }
  );

  it.each([
    ['ready_for_cutover', progressView({ state: 'ready_for_cutover', total_bins: 3, complete_bins: 3 }), undefined, 'Review'],
    ['executing', progressView({ state: 'ready_for_cutover', cutover: { status: 'executing' } }), 'waiting', 'View'],
    ['failed', progressView({ state: 'review_required', cutover: { status: 'failed' } }), 'failed', 'Retry'],
  ])('%s: reuses the existing Warehouse cutover/retry destination', async (_label, progress, lifecycle, cta) => {
    mockReadiness({ progress });
    const result = await renderWithProgressApplied();

    const item = openingItem(result.current.items);
    expect(item?.complete).toBe(false);
    expect(item?.lifecycle).toBe(lifecycle);
    expect(item?.action).toEqual({ kind: 'navigate', label: cta, route: '/wms' });
  });

  it.each([
    ['cutover.status=complete', progressView({ state: 'ready_for_cutover', total_bins: 3, complete_bins: 3, cutover: { status: 'complete' } })],
    ['shopify_synced_at set', progressView({ state: 'ready_for_cutover', total_bins: 3, complete_bins: 3, shopify_synced_at: '2026-09-20T10:00:00.000Z' })],
  ])('%s without readiness completion is NOT verified — completion is readiness-owned', async (_label, progress) => {
    mockReadiness({ reconcileComplete: false, progress });
    const result = await renderWithProgressApplied();

    const item = openingItem(result.current.items);
    expect(item?.complete).toBe(false);
    expect(result.current.completedCount).toBe(0);
  });

  it('v2 required=true + readiness incomplete: the presentation-only progress view is requested', async () => {
    mockReadiness({ reconciliationRequired: true, reconcileComplete: false });
    await renderChecklist();
    await waitFor(() => expect(progressCalls()).toBe(1));
  });

  it('v2 required=true + readiness complete: verified row with no progress request', async () => {
    mockReadiness({
      reconciliationRequired: true, reconcileComplete: true,
      progress: progressView({ state: 'not_started' }),
    });
    const { result, seen } = renderRecording();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const item = openingItem(result.current.items);
    expect(item?.complete).toBe(true);
    expect(item?.action).toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(progressCalls()).toBe(0);
    // Never shown as unverified on the way to verified.
    expect(seen.filter(Boolean).every((i) => i?.complete === true)).toBe(true);
  });

  it('legacy required=false: no Opening Inventory row on any render, and progress is never requested', async () => {
    mockReadiness({
      reconciliationRequired: false, reconcileComplete: true,
      progress: progressView({ state: 'not_required' }),
    });
    const { result, seen } = renderRecording();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await new Promise((r) => setTimeout(r, 0));

    expect(openingItem(result.current.items)).toBeUndefined();
    expect(result.current.items).toHaveLength(5);
    expect(seen.every((i) => i === undefined)).toBe(true);
    expect(progressCalls()).toBe(0);
  });

  it('readiness loading: no Opening Inventory row and no progress request', async () => {
    mockReadiness({ readinessPending: true });
    const { result, seen } = renderRecording('owner');
    await new Promise((r) => setTimeout(r, 0));

    expect(result.current.isLoading).toBe(true);
    expect(seen.every((i) => i === undefined)).toBe(true);
    expect(progressCalls()).toBe(0);
  });

  it('required signal missing/unknown: fails closed — no row, no Start, no progress request', async () => {
    mockReadiness({ reconciliationRequired: 'missing', progress: progressView({ state: 'not_started' }) });
    const { result, seen } = renderRecording('owner');
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await new Promise((r) => setTimeout(r, 0));

    expect(seen.every((i) => i === undefined)).toBe(true);
    expect(result.current.items.some((i) => i.action?.kind === 'command')).toBe(false);
    expect(progressCalls()).toBe(0);
  });

  it('progress unavailable: row stays unverified with no action, and SETUP is not failed', async () => {
    mockReadiness({ progressError: true });
    const result = await renderChecklist();
    await waitFor(() => expect(progressCalls()).toBe(1));

    const item = openingItem(result.current.items);
    expect(item?.complete).toBe(false);
    expect(item?.action).toBeUndefined();
    expect(result.current.isError).toBe(false);
  });
});

// ─── GH-1165 — FIRST-ENTRY MODE AND SETUP PROJECTION ─────────────────────────

describe('useActivationChecklist — first-entry projection (GH-1165)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const countItem = (items: ChecklistItem[]) => items.find((i) => i.key === 'first-entry-count');
  const mapItem = (items: ChecklistItem[]) => items.find((i) => i.key === 'first-entry-map');

  /** Resolves once the hook reports first-entry mode with the progress read applied. */
  async function renderFirstEntry(role?: string) {
    const result = await renderWithProgressApplied(role);
    await waitFor(() => expect(result.current.firstEntry).toBe(true));
    return result;
  }

  it('#1160 / GH1176 fresh state (required, unreconciled, unmapped) => first-entry mode with exactly map + count; map deep-links to Setup > Canvas', async () => {
    mockReadiness({ progress: progressView({ state: 'not_started' }) });
    const result = await renderFirstEntry('owner');

    expect(result.current.firstEntryItems.map((i) => i.key)).toEqual(['first-entry-map', 'first-entry-count']);

    // zonesConfigured=false: locked — no command and no navigation, even for an owner.
    const count = countItem(result.current.firstEntryItems);
    expect(count).toEqual({
      key: 'first-entry-count',
      label: 'Count opening stock',
      complete: false,
      subtitle: FIRST_ENTRY_COUNT_LOCKED_SUBTITLE,
    });
    expect(FIRST_ENTRY_COUNT_LOCKED_SUBTITLE)
      .toBe('Map your warehouse first so LaSyncro knows which locations must be counted.');

    // GH1176: serialized onboarding navigation into Floor Planning Setup > Canvas.
    expect(mapItem(result.current.firstEntryItems)).toEqual({
      key: 'first-entry-map',
      label: 'Map your warehouse',
      complete: false,
      subtitle: 'Define where stock lives and work happens.',
      action: { kind: 'navigate', label: 'Map warehouse', route: '/floor-planning?tab=setup&view=canvas' },
    });
  });

  it('keeps the mature six-item checklist unchanged beside the first-entry projection', async () => {
    mockReadiness({ progress: progressView({ state: 'not_started' }) });
    const result = await renderFirstEntry('owner');

    expect(result.current.items.map((i) => i.key)).toEqual([
      'fix-costs', 'map-zones', 'print-barcodes', 'connect-carrier', 'wave-released', 'opening-inventory',
    ]);
    // GH-1156 six-item behaviour is not gated by zones.
    expect(openingItem(result.current.items)?.action).toEqual({
      kind: 'command', label: 'Start opening count', command: 'opening_inventory_start',
    });
  });

  it.each(['owner', 'admin'])('zonesConfigured + not_started + %s => map verified, Start opening count', async (role) => {
    mockReadiness({ zonesConfigured: true, progress: progressView({ state: 'not_started' }) });
    const result = await renderFirstEntry(role);

    expect(mapItem(result.current.firstEntryItems)?.complete).toBe(true);
    const count = countItem(result.current.firstEntryItems);
    expect(count?.label).toBe('Count opening stock');
    expect(count?.complete).toBe(false);
    expect(count?.action).toEqual({
      kind: 'command', label: 'Start opening count', command: 'opening_inventory_start',
    });
  });

  it('zonesConfigured + not_started + operator => no Start command', async () => {
    mockReadiness({ zonesConfigured: true, progress: progressView({ state: 'not_started' }) });
    const result = await renderFirstEntry('operator');

    const count = countItem(result.current.firstEntryItems);
    expect(count?.action).toBeUndefined();
    expect(count?.subtitle).toBe('Owner or admin must start');
  });

  it.each([
    ['counting', progressView({ state: 'counting', total_bins: 17, complete_bins: 6 }), undefined, 'Continue'],
    ['review_required', progressView({ state: 'review_required', total_bins: 17, complete_bins: 17 }), 'attention', 'Review'],
    ['ready_for_cutover', progressView({ state: 'ready_for_cutover', total_bins: 3, complete_bins: 3 }), undefined, 'Review'],
    ['cutover executing', progressView({ state: 'ready_for_cutover', cutover: { status: 'executing' } }), 'waiting', 'View'],
    ['cutover failed', progressView({ state: 'review_required', cutover: { status: 'failed' } }), 'failed', 'Retry'],
  ])('%s: first-entry mode persists and the count row reuses the GH-1156 lifecycle', async (_label, progress, lifecycle, cta) => {
    mockReadiness({ zonesConfigured: true, progress });
    const result = await renderFirstEntry();

    const count = countItem(result.current.firstEntryItems);
    expect(count?.complete).toBe(false);
    expect(count?.lifecycle).toBe(lifecycle);
    expect(count?.action).toEqual({ kind: 'navigate', label: cta, route: '/wms' });
  });

  it('canonical reconciliation complete => first-entry mode ends, no projection', async () => {
    mockReadiness({ zonesConfigured: true, reconcileComplete: true });
    const result = await renderChecklist();

    expect(result.current.firstEntry).toBe(false);
    expect(result.current.firstEntryItems).toEqual([]);
    expect(result.current.items).toHaveLength(6);
  });

  it('fails closed: loading, missing signal and legacy required=false are not first-entry', async () => {
    mockReadiness({ readinessPending: true });
    const loading = renderHook(() => useActivationChecklist(), { wrapper: makeWrapper() });
    await new Promise((r) => setTimeout(r, 0));
    expect(loading.result.current.firstEntry).toBe(false);
    expect(loading.result.current.firstEntryItems).toEqual([]);
    loading.unmount();

    mockReadiness({ reconciliationRequired: 'missing' });
    const missing = await renderChecklist();
    expect(missing.current.firstEntry).toBe(false);

    mockReadiness({ reconciliationRequired: false, reconcileComplete: true });
    const legacy = await renderChecklist();
    expect(legacy.current.firstEntry).toBe(false);
  });
});
