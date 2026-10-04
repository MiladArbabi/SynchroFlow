// apps/frontend/src/hooks/useActivationChecklist.ts
//
// T5 — onboarding activation checklist hook.
// Assembles 6 checklist items from three endpoints:
//   1. GET /api/v1/onboarding/readiness  — items 1–4, and item 6's
//      applicability (wms.openingInventoryReconciliationRequired) and
//      completion (wms/reconcile-inventory is the ONLY source of item 6's ✓)
//   2. GET /api/v1/user-state/activation-events — item 5
//   3. GET /api/v1/wms/opening-inventory/progress — item 6's presentation only,
//      read only while item 6 is required and incomplete (GH-1156: readiness
//      cannot distinguish not-started / counting / review / cutover; the
//      progress view never establishes completion)
//
// GH-1165: alongside the six items it exposes `firstEntry` and the dedicated
// two-step first-entry projection (`firstEntryItems`) over the same sources.
//
// See docs/playbooks/onboarding-progressive-disclosure-playbook.md §2 Layer 1.

import { useContext } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from '../api/axiosConfig';
import { AuthContext } from '../contexts/AuthContext';

/**
 * GH-1156 — an item's explicit primary action, when the generic "Open"
 * navigation to `actionRoute` is not the right affordance. `command` names a
 * console-owned command; no callback is ever stored on an item.
 */
export type ChecklistItemAction =
  | { kind: 'navigate'; label: string; route: string }
  | { kind: 'command'; label: string; command: 'opening_inventory_start' };

export interface ChecklistItem {
  key: string;
  label: string;
  complete: boolean;
  /** Tier 2 ghost pill CTA route — undefined when item has no navigation */
  actionRoute?: string;
  /** GH-1156 — explicit action; takes precedence over actionRoute. */
  action?: ChecklistItemAction;
  /** GH-1156 — canonical lifecycle context (e.g. "Review required"). */
  subtitle?: string;
  /** GH-1156 — short canonical progress qualifier (e.g. "6 / 17 bins"). */
  meta?: string;
  /**
   * GH-1156 — canonical non-default lifecycle status for an incomplete item:
   * attention (review required), waiting (cutover executing), failed.
   */
  lifecycle?: 'attention' | 'waiting' | 'failed';
}

interface ReadinessResponse {
  modules: Array<{
    moduleId: string;
    tasks: Array<{ id: string; complete: boolean }>;
    /** Signals exposed by the module manifest's requiredSignals. */
    signals?: Array<{ name: string; value: unknown }>;
  }>;
}

interface ActivationEventsResponse {
  wave_released: boolean;
}

/**
 * #1164 — one bin of the canonical ShopOpeningInventoryProgress, as returned
 * by both GET /wms/opening-inventory/progress (under `progress`) and
 * POST /wms/opening-inventory/start. Server-ordered by warehouse, location.
 */
export interface OpeningInventoryBin {
  recount_task_id: string;
  warehouse_id: string;
  location_code: string;
  status: string;
  progress_state: 'not_started' | 'in_progress' | 'needs_review' | 'complete';
  assigned_to: number | null;
  claimed_by: number | null;
}

/**
 * Subset of the GET /api/v1/wms/opening-inventory/progress wire shape
 * (OpeningInventoryCutoverView) that the SETUP row reads.
 */
export interface OpeningInventoryProgressView {
  progress: {
    state:
      | 'not_required'
      | 'not_started'
      | 'counting'
      | 'needs_bin_review'
      | 'ready_for_cutover'
      | 'review_required';
    total_bins: number;
    complete_bins: number;
    bins?: OpeningInventoryBin[];
  };
  cutover: { status: 'prepared' | 'executing' | 'failed' | 'complete' } | null;
  shopify_synced_at: string | null;
}

export const OPENING_INVENTORY_SETUP_KEY = 'opening-inventory';
const OPENING_INVENTORY_LABEL = 'Establish opening inventory';
const WAREHOUSE_ROUTE = '/wms';

/**
 * #1164 — the single opening-task selection policy, shared by the Ops Console
 * start flow and the counting-state Continue action:
 *   1. the current user's own claimed/counting bin (resume);
 *   2. otherwise the first dispatched, not-started bin explicitly assigned
 *      to the current user, in server order;
 *   3. otherwise null — nothing this user can enter.
 * Server order is canonical; bins are never re-sorted here. It mirrors the
 * entry rule WmsModuleFT2 applies to a `countTaskId` deep link.
 */
export function selectNextOpeningInventoryTask(
  bins: readonly OpeningInventoryBin[] | null | undefined,
  currentUserId: number | null,
): OpeningInventoryBin | null {
  const list = bins ?? [];
  const own = currentUserId === null
    ? undefined
    : list.find((bin) =>
        (bin.status === 'claimed' || bin.status === 'counting') && bin.claimed_by === currentUserId);
  const assignedDispatched = currentUserId === null
    ? undefined
    : list.find(
        (bin) =>
          bin.status === 'dispatched' &&
          bin.progress_state === 'not_started' &&
          bin.assigned_to === currentUserId
      );

  return own ?? assignedDispatched ?? null;
}

/**
 * #1164 / WAREHOUSE-FOCUS-SHELL — entering an Opening Inventory task starts
 * the protected task session at its Brief. Claim/start changes ownership and
 * execution phase; it does not establish shell ownership.
 */
export function openingInventoryCountRoute(recountTaskId: string): string {
  return (
    `${WAREHOUSE_ROUTE}?countTaskId=${encodeURIComponent(recountTaskId)}` +
    '&warehouseFocus=count'
  );
}

function findTask(modules: ReadinessResponse['modules'], moduleId: string, taskId: string): boolean {
  return modules
    .find(m => m.moduleId === moduleId)
    ?.tasks.find(t => t.id === taskId)
    ?.complete ?? false;
}

/**
 * GH-1156 — canonical wms.openingInventoryReconciliationRequired.
 * Returns null when the signal is missing or not a boolean (unknown).
 */
function openingReconciliationRequired(modules: ReadinessResponse['modules']): boolean | null {
  const value = modules
    .find(m => m.moduleId === 'wms')
    ?.signals?.find(s => s.name === 'wms.openingInventoryReconciliationRequired')
    ?.value;
  return typeof value === 'boolean' ? value : null;
}

/**
 * GH-1179 — canonical wms.externalLocationMapped.
 * Returns null when the signal is missing or not a boolean (unknown).
 */
function externalLocationMapped(modules: ReadinessResponse['modules']): boolean | null {
  const value = modules
    .find(m => m.moduleId === 'wms')
    ?.signals?.find(s => s.name === 'wms.externalLocationMapped')
    ?.value;
  return typeof value === 'boolean' ? value : null;
}

/**
 * GH-1179 — starting opening inventory requires canonical external location
 * mapping; missing, unknown or false fails closed. Only the Start command is
 * withheld: every already-started lifecycle action is left untouched.
 */
function gateOpeningStartOnMapping(item: ChecklistItem, mapped: boolean | null): ChecklistItem {
  if (
    mapped === true ||
    item.action?.kind !== 'command' ||
    item.action.command !== 'opening_inventory_start'
  ) {
    return item;
  }
  const gated: ChecklistItem = { ...item };
  delete gated.action;
  return gated;
}

function isProgressView(value: unknown): value is OpeningInventoryProgressView {
  const state = (value as OpeningInventoryProgressView | null | undefined)?.progress?.state;
  return typeof state === 'string';
}

/**
 * GH-1156 — pure lifecycle mapping for the "Establish opening inventory" row.
 *
 * Completion is readiness-owned: only the backend wms/reconcile-inventory task
 * (canonical wms.openingInventoryReconciled — the persisted Shopify-sync
 * marker for v2) can make the row verified. The progress view supplies
 * presentation states only. A click is never an input. Returns null when
 * opening inventory is not required, so no setup work is added for that
 * tenant.
 *
 * `canStart` is an advisory UI gate only (owner/admin, mirroring the default
 * wms:recount:create grant); requireAction('wms:recount:create') on the start
 * endpoint remains the authority.
 *
 * #1164: while counting, Continue deep-links into the next actionable count
 * task for `currentUserId`; with none, no Continue is offered.
 */
export function buildOpeningInventoryItem(
  readinessComplete: boolean,
  view: OpeningInventoryProgressView | null,
  canStart: boolean,
  currentUserId: number | null = null,
): ChecklistItem | null {
  const base = { key: OPENING_INVENTORY_SETUP_KEY, label: OPENING_INVENTORY_LABEL };

  if (view?.progress.state === 'not_required') return null;

  if (readinessComplete) return { ...base, complete: true };

  // Progress unknown (loading, unavailable or not permitted): not verified,
  // and no action is offered without a canonical state to act on.
  if (!view) return { ...base, complete: false };

  const { progress, cutover } = view;
  const bins = progress.total_bins > 0
    ? `${progress.complete_bins} / ${progress.total_bins} bins`
    : undefined;
  const openWarehouse = (label: string): ChecklistItemAction =>
    ({ kind: 'navigate', label, route: WAREHOUSE_ROUTE });

  if (cutover?.status === 'failed') {
    return {
      ...base, complete: false, lifecycle: 'failed',
      subtitle: 'Shopify update failed',
      action: openWarehouse('Retry'),
    };
  }
  if (cutover?.status === 'executing') {
    return {
      ...base, complete: false, lifecycle: 'waiting',
      subtitle: 'Updating Shopify',
      action: openWarehouse('View'),
    };
  }

  switch (progress.state) {
    case 'not_started':
      return canStart
        ? {
            ...base, complete: false,
            action: { kind: 'command', label: 'Start opening count', command: 'opening_inventory_start' },
          }
        : { ...base, complete: false, subtitle: 'Owner or admin must start' };
    case 'counting': {
      const next = selectNextOpeningInventoryTask(progress.bins, currentUserId);
      return {
        ...base, complete: false, meta: bins,
        subtitle: 'Warehouse Operations · Inventory checks',
        ...(next && {
          action: { kind: 'navigate', label: 'Continue', route: openingInventoryCountRoute(next.recount_task_id) },
        }),
      };
    }
    case 'needs_bin_review':
    case 'review_required':
      return {
        ...base, complete: false, lifecycle: 'attention', meta: bins,
        subtitle: 'Review required',
        action: openWarehouse('Review'),
      };
    case 'ready_for_cutover':
      return {
        ...base, complete: false, meta: bins,
        subtitle: 'Count complete · ready to update Shopify',
        action: openWarehouse('Review'),
      };
    default:
      return { ...base, complete: false };
  }
}

// ─── GH-1165 — FIRST-ENTRY SETUP PROJECTION ──────────────────────────────────

/**
 * GH-1176 — the one frontend route for every "map your warehouse" entry point
 * (the six-item map-zones row and the first-entry map step). Mirrors the
 * map-zones action in the backend readiness manifest.
 */
export const MAP_WAREHOUSE_ROUTE = '/floor-planning?tab=setup&view=canvas';
export const SHOPIFY_LOCATION_ROUTE = '/settings/warehouse';

export const FIRST_ENTRY_SHOPIFY_LOCATION_KEY = 'first-entry-shopify-location';
export const FIRST_ENTRY_MAP_KEY = 'first-entry-map';
export const FIRST_ENTRY_COUNT_KEY = 'first-entry-count';

export const FIRST_ENTRY_LOCATION_LOCKED_SUBTITLE =
  'Choose your Shopify location first so LaSyncro knows where inventory updates belong.';

export const FIRST_ENTRY_COUNT_LOCKED_SUBTITLE =
  'Map your warehouse first so LaSyncro knows which locations must be counted.';

/**
 * GH-1179 — the dedicated first-entry setup: Shopify Location, map, then count. A
 * projection over the same canonical sources as the six-item checklist, which
 * stays unchanged beside it.
 *
 * Shopify Location mapping is the first prerequisite. Map basics remains minimum
 * physical readiness (wms.zonesConfigured). Count completion is
 * wms/reconcile-inventory only. Until zones are configured the count row is
 * locked: no command, no navigation, so no start POST is reachable from it.
 * Once zones exist it reuses the GH-1156 lifecycle mapping verbatim.
 */
export function buildFirstEntrySetupItems(
  zonesConfigured: boolean | null,
  externalLocationMapped: boolean | null,
  openingReadinessComplete: boolean,
  view: OpeningInventoryProgressView | null,
  canStart: boolean,
  currentUserId: number | null = null,
): ChecklistItem[] {
  const shopifyLocation: ChecklistItem = {
    key: FIRST_ENTRY_SHOPIFY_LOCATION_KEY,
    label: 'Choose Shopify location',
    complete: externalLocationMapped === true,
    subtitle: 'Tell LaSyncro which Shopify Location this warehouse represents.',
    action: externalLocationMapped !== true && canStart
      ? { kind: 'navigate', label: 'Choose location', route: SHOPIFY_LOCATION_ROUTE }
      : undefined,
  };

  const map: ChecklistItem = {
    key: FIRST_ENTRY_MAP_KEY,
    label: 'Map warehouse basics',
    complete: zonesConfigured === true,
    subtitle: 'Define where stock lives and work happens.',
    action: externalLocationMapped === true
      ? { kind: 'navigate', label: 'Map warehouse', route: MAP_WAREHOUSE_ROUTE }
      : undefined,
  };

  const countBase = { key: FIRST_ENTRY_COUNT_KEY, label: 'Count opening stock' };
  let count: ChecklistItem;
  if (openingReadinessComplete) {
    count = { ...countBase, complete: true };
  } else if (zonesConfigured !== true) {
    count = {
      ...countBase,
      complete: false,
      subtitle: externalLocationMapped === true
        ? FIRST_ENTRY_COUNT_LOCKED_SUBTITLE
        : FIRST_ENTRY_LOCATION_LOCKED_SUBTITLE,
    };
  } else {
    const lifecycle = buildOpeningInventoryItem(false, view, canStart, currentUserId);
    count = lifecycle ? { ...lifecycle, ...countBase } : { ...countBase, complete: false };
  }

  return [shopifyLocation, map, count];
}

/** Canonical completion of one readiness task; null when it is absent (unknown). */
function taskComplete(modules: ReadinessResponse['modules'], moduleId: string, taskId: string): boolean | null {
  const task = modules.find(m => m.moduleId === moduleId)?.tasks.find(t => t.id === taskId);
  return typeof task?.complete === 'boolean' ? task.complete : null;
}

export function useActivationChecklist() {
  const queryClient = useQueryClient();
  const readiness = useQuery<ReadinessResponse>({
    queryKey: ['onboarding', 'readiness'],
    queryFn: async () => (await axiosInstance.get('/api/v1/onboarding/readiness')).data,
    staleTime: 60_000,
  });

  const events = useQuery<ActivationEventsResponse>({
    queryKey: ['user-state', 'activation-events'],
    queryFn: async () => (await axiosInstance.get('/api/v1/user-state/activation-events')).data,
    staleTime: 30_000,
  });

  const modules = readiness.data?.modules ?? [];
  // Minimum readiness is a server signal, never a missing-task fallback or a
  // claim that the merchant has finished the entire floor plan.
  const mappingSignal = modules.find(m => m.moduleId === 'wms')?.signals
    ?.find(s => s.name === 'wms.zonesConfigured')?.value;
  const minimumMappingReady: boolean | null = readiness.isSuccess && typeof mappingSignal === 'boolean'
    ? mappingSignal : null;
  const openingReadinessComplete = findTask(modules, 'wms', 'reconcile-inventory');
  // null while readiness is loading or when the signal is missing/unknown.
  const reconciliationRequired = readiness.isSuccess
    ? openingReconciliationRequired(modules)
    : null;

  // Advisory role gate for the Start command. Read without throwing so the
  // hook stays usable outside an AuthProvider; no role → no Start (fail
  // closed). The backend requireAction remains the authority.
  const authUser = useContext(AuthContext)?.user as { id?: unknown; role?: string } | null | undefined;
  const role = authUser?.role;
  const canStartOpeningInventory = role === 'owner' || role === 'admin';
  // #1164: AuthContext canonicalizes user.id to the access token's user_id.
  const currentUserId = typeof authUser?.id === 'number' ? authUser.id : null;

  // Presentation only — never completion. Read only when readiness says
  // opening inventory applies and is not yet reconciled. A failure here is NOT
  // a SETUP failure: an incomplete row simply offers no action.
  const openingProgress = useQuery<OpeningInventoryProgressView>({
    queryKey: ['wms', 'opening-inventory', 'progress'],
    queryFn: async () => (await axiosInstance.get('/api/v1/wms/opening-inventory/progress')).data,
    enabled: reconciliationRequired === true && !openingReadinessComplete,
    staleTime: 30_000,
    retry: false,
  });

  // No row at all unless readiness canonically says opening inventory is
  // required: loading, not required (legacy) and unknown all build nothing,
  // so a legacy tenant never sees a row appear and then disappear.
  const openingItem = reconciliationRequired === true
    ? buildOpeningInventoryItem(
        openingReadinessComplete,
        isProgressView(openingProgress.data) ? openingProgress.data : null,
        canStartOpeningInventory,
        currentUserId,
      )
    : null;

  const items: ChecklistItem[] = [
    {
      key:          'map-zones',
      label:        'Map your warehouse zones',
      complete:     findTask(modules, 'wms', 'map-zones'),
      actionRoute:  MAP_WAREHOUSE_ROUTE,
    },
    ...(openingItem ? [openingItem] : []),
  ];

  const completedCount = items.filter(i => i.complete).length;
  const allComplete    = completedCount === items.length;

  // GH-1165 — first-entry mode: opening reconciliation is canonically required
  // and the readiness reconcile task canonically reports incomplete. Loading,
  // a missing signal or a missing task all read as NOT first-entry (fail
  // closed). Completion is never inferred locally, so the mode persists
  // through map → count → review/cutover until readiness says reconciled.
  const reconcileTask = readiness.isSuccess ? taskComplete(modules, 'wms', 'reconcile-inventory') : null;
  const firstEntry = reconciliationRequired === true && reconcileTask === false;
  const locationMapped = readiness.isSuccess ? externalLocationMapped(modules) : null;
  const firstEntryItems: ChecklistItem[] = firstEntry
    ? buildFirstEntrySetupItems(
        minimumMappingReady,
        locationMapped,
        false,
        isProgressView(openingProgress.data) ? openingProgress.data : null,
        canStartOpeningInventory,
        currentUserId,
      ).map(item => (item.key === FIRST_ENTRY_COUNT_KEY
        ? gateOpeningStartOnMapping(item, locationMapped)
        : item))
    : [];

  // GH-1156 — after an Opening Inventory command the canonical sources are
  // re-read; the row's next state comes only from what they return.
  // GH-1164: the progress key is shared with the WMS page (useWms), and the
  // WMS recount list is invalidated so a new cohort's countTaskId deep link
  // resolves at once instead of on the next poll.
  const refreshOpeningInventory = async () => {
    await Promise.all([
      readiness.refetch(),
      openingProgress.refetch(),
      queryClient.invalidateQueries({ queryKey: ['wms', 'recount-tasks'] }),
    ]);
  };

  return {
    items,
    completedCount,
    allComplete,
    isLoading: readiness.isLoading || events.isLoading,
    // OPS-CONSOLE-01: surfaced so the Ops Console can render a deliberate
    // failed-fetch state instead of an empty SETUP section that would read as
    // "nothing left to do". Completion logic above is untouched.
    isError: readiness.isError || events.isError,
    refreshOpeningInventory,
    currentUserId,
    firstEntry,
    firstEntryItems,
    minimumMappingReady,
    externalLocationMapped: locationMapped,
  };
}
