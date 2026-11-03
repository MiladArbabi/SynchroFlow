// modules/problem-center/src/ui/pages/problemCenterModel.ts
//
// PROBLEM CENTER V2 (S4-5 I5) — pure queue model.
//
// Derives each exception's operational state, urgency bucket and offered
// actions from the persisted projection (GET /wms/problem-center). Nothing
// here is authoritative: the resolve endpoint re-checks eligibility under its
// own locks and answers 409. The model only refuses to OFFER what the backend
// is known not to support, and never invents a state the rows do not prove.

export type ProblemTaskStatus = 'open' | 'investigating' | 'resolved' | 'discarded' | 'returned_to_supplier';
export type ProblemSource = 'pick' | 'pack' | 'stow' | 'receive' | 'returns' | 'reconciliation' | 'count';

export type ProblemTask = {
  problem_task_id: string;
  lasyncro_variant_id: string;
  exception_type: string;
  source: ProblemSource;
  quantity: number;
  prob_label: string | null;
  problem_bin_location: string | null;
  status: ProblemTaskStatus;
  created_at: string;
  variant_title?: string | null;
  sku?: string | null;
  // ── V2 projection (optional: older responses omit them) ──
  product_title?: string | null;
  lasyncro_unit_id?: string | null;
  assigned_operator_id?: number | null;
  resolution_action?: string | null;
  resolution_notes?: string | null;
  resolved_at?: string | null;
  unit_status?: string | null;
  unit_location_code?: string | null;
  receive_custody_verified?: boolean | null;
  /** The held unit's originating Receive job (unit → line → job). */
  receive_job_id?: string | null;
  receive_job_status?: string | null;
  recovery_stow_task_id?: string | null;
  recovery_stow_status?: 'pending' | 'in_progress' | 'completed' | null;
  recovery_stow_location_code?: string | null;
  recovery_stow_created_at?: string | null;
  // ── SAFETY-015 (optional: older responses omit them) ──
  /** The variant has a Shopify inventory item (variant half of recovery eligibility). */
  variant_sync_mapped?: boolean | null;
  /** The recovered credit's I4 Shopify sync row status, if one exists. */
  recovery_sync_status?: string | null;
};

/**
 * SAFETY-015 shop-scoped recovery eligibility (GET /wms/problem-center
 * `recovery_sync`). Display only: the resolve endpoint re-checks under locks.
 */
export type RecoverySync = {
  available: boolean;
  reason: string | null;
};

/** Operator copy per refusal reason (receiveRecoverySyncEligibility.service). */
export function recoveryUnavailableText(reason: string | null | undefined): string {
  switch (reason) {
    case 'SHOPIFY_NOT_CONNECTED':
    case 'SHOPIFY_DISCONNECTED':
      return 'Reconnect Shopify to return this item to stock. It stays in the problem bin; you can still discard or write it off.';
    case 'VARIANT_NOT_MAPPED':
      return "This product isn't linked to a Shopify inventory item, so it can't be returned to stock yet. It stays in the problem bin.";
    default:
      return 'Return to stock is unavailable until Shopify inventory sync for recovered items is active. The item stays in the problem bin; you can keep investigating, or discard or write it off.';
  }
}

/** Why a held unit cannot be recovered right now, or null when it can. */
export function recoveryUnavailableReason(t: ProblemTask, sync: RecoverySync | null | undefined): string | null {
  if (!sync) return null;
  if (!sync.available) return sync.reason ?? 'SYNC_DISABLED';
  if (t.variant_sync_mapped === false) return 'VARIANT_NOT_MAPPED';
  return null;
}

/** I4 states in which Shopify has (or by cutover already had) the recovered unit. */
const SHOPIFY_SETTLED = ['succeeded', 'skipped_included'];

/** An existing pack decision request (GET /wms/pack/decision-requests). */
export type PackDecisionItem = {
  id: string;
  exception_type: string;
  order_ref: string;
  item_label: string;
  sku: string | null;
  batch_ref: string;
  raised_at: string;
};

/**
 * GH-1086: the pack decision copy is a protected product contract owned by the
 * host page (tests/contract/pack-decision-hold-semantics-1086). The module
 * renders it verbatim and never substitutes its own wording.
 */
export type PackDecisionCopy = {
  approveLabel: string;
  approveConfirm: (orderRef: string) => string;
  holdLabel: string;
  holdConfirm: (orderRef: string) => string;
};

export type OperationalState =
  | 'needs_decision'
  | 'awaiting_pack_decision'
  | 'awaiting_stow'
  | 'awaiting_receive_close'
  | 'stow_in_progress'
  | 'needs_investigation'
  | 'investigating'
  | 'recovered'
  | 'resolved';

export type Bucket = 'decision' | 'awaiting' | 'progress' | 'resolved';

export const BUCKET_OF: Record<OperationalState, Bucket> = {
  needs_decision: 'decision',
  awaiting_pack_decision: 'decision',
  awaiting_stow: 'awaiting',
  awaiting_receive_close: 'awaiting',
  needs_investigation: 'awaiting',
  stow_in_progress: 'progress',
  investigating: 'progress',
  recovered: 'resolved',
  resolved: 'resolved',
};

export const STATE_LABEL: Record<OperationalState, string> = {
  needs_decision: 'Needs decision',
  awaiting_pack_decision: 'Awaiting pack decision',
  awaiting_stow: 'Awaiting Stow',
  awaiting_receive_close: 'Awaiting Receive close',
  stow_in_progress: 'Stow in progress',
  needs_investigation: 'Needs investigation',
  investigating: 'Investigating',
  recovered: 'Recovered',
  resolved: 'Completed',
};

const BUCKET_ORDER: Record<Bucket, number> = { decision: 0, awaiting: 1, progress: 2, resolved: 3 };

export type StageKey = 'receive' | 'stow' | 'pick' | 'pack' | 'returns' | 'inventory';

export const STAGES: { key: StageKey; label: string }[] = [
  { key: 'receive', label: 'Receive' },
  { key: 'stow', label: 'Stow' },
  { key: 'pick', label: 'Pick' },
  { key: 'pack', label: 'Pack' },
  { key: 'returns', label: 'Returns' },
  { key: 'inventory', label: 'Inventory' },
];

const STAGE_OF_SOURCE: Record<string, StageKey> = {
  receive: 'receive',
  stow: 'stow',
  pick: 'pick',
  pack: 'pack',
  returns: 'returns',
  count: 'inventory',
  reconciliation: 'inventory',
};

export const EXCEPTION_TYPE_LABELS: Record<string, string> = {
  item_missing: 'Item missing',
  missing_item: 'Item missing',
  short_pick: 'Short pick',
  product_defect: 'Product defect',
  packaging_defect: 'Packaging defect',
  order_cancelled: 'Order cancelled',
  wrong_item: 'Wrong item',
  stow_failure: 'Stow failure',
  receive_rejection: 'Receive rejection',
  defect: 'Defect',
  packaging_damage: 'Packaging damage',
  bin_over_capacity: 'Bin over capacity',
  repackaging_required: 'Repackaging required',
  return_shortfall: 'Return shortfall',
  recount_variance: 'Recount variance',
};

export const typeLabel = (t: string): string =>
  EXCEPTION_TYPE_LABELS[t] ?? t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// ── Actions ─────────────────────────────────────────────────────────────────

export type ResolutionAction = 're_stow' | 'find_replacement' | 'discard' | 'write_off' | 'quarantine';

export type ItemAction =
  | {
      kind: 'resolve';
      action: ResolutionAction;
      label: string;
      tone: 'primary' | 'secondary' | 'destructive';
      hint?: string;
      /** Destructive or irreversible: requires an explicit second confirmation. */
      confirm?: string;
      /** SAFETY-015: shown disabled with this reason; never submitted. */
      unavailable?: string;
    }
  | {
      kind: 'pack_decision';
      status: 'approved' | 'rejected';
      label: string;
      tone: 'primary' | 'secondary' | 'destructive';
      hint?: string;
      confirm: string;
    }
  | { kind: 'open_stow'; stowTaskId: string; label: string; tone: 'primary'; hint?: string };

/** I2 (receiveHeldResolution.service RECOVERABLE_HELD_EXCEPTION_TYPES). */
export const RECOVERABLE_HELD_TYPES = ['defect', 'packaging_damage'];

const OPEN_STATUSES: ProblemTaskStatus[] = ['open', 'investigating'];
const isOpen = (t: ProblemTask) => OPEN_STATUSES.includes(t.status);

/** A held Receive unit task — resolved only by the dedicated I2 service. */
export const isReceiveUnitTask = (t: ProblemTask) => t.source === 'receive' && !!t.lasyncro_unit_id;

const LIVE_STOW = ['pending', 'in_progress'];

/**
 * M1-CORRECT-006: the I2 service refuses every held-unit decision until the
 * unit's Receive job is closed (receive_not_closed). These are the job's
 * not-yet-closed states; 'closed' is the only state that allows a decision,
 * and anything else — absent, cancelled, unknown — fails closed.
 */
export const RECEIVE_JOB_OPEN_STATUSES = ['pending', 'in_progress', 'inspection', 'barcode_assignment', 'stow_ready'];
const receiveJobClosed = (t: ProblemTask) => t.receive_job_status === 'closed';
export const receiveJobOpen = (t: ProblemTask) => RECEIVE_JOB_OPEN_STATUSES.includes(t.receive_job_status ?? '');
const hasLiveRecoveryStow = (t: ProblemTask) =>
  !!t.recovery_stow_task_id && LIVE_STOW.includes(t.recovery_stow_status ?? '');

/**
 * GH-1238: generic (non-Receive-unit) resolution choices mirror the backend's
 * default-deny policy (apps/backend/src/services/wms/problemCenterResolutionPolicy.ts).
 * Ordered: the first is the primary action.
 */
export function genericResolutionActions(source: string, exceptionType: string): ResolutionAction[] {
  if (
    (source === 'pick' && exceptionType === 'order_cancelled') ||
    (source === 'returns' && exceptionType === 'repackaging_required')
  ) {
    return ['re_stow', 'quarantine', 'discard', 'write_off'];
  }
  // Ordinary Pick incidents: investigation only. Their units stay reserved at
  // the allocation location and no path settles that reservation yet
  // (GH-1240), so Write Off / Discard are not offered.
  if (
    (source === 'pick' && (exceptionType === 'item_missing' || exceptionType === 'short_pick')) ||
    ((source === 'pick' || source === 'pack') && (exceptionType === 'wrong_item' || exceptionType === 'missing_item'))
  ) {
    return ['find_replacement'];
  }
  return [];
}

/**
 * Receive held-unit decisions offered only when the persisted facts the I2
 * service re-checks are all visible: unit still held, custody verified in the
 * problem bin, a recoverable classification and no live recovery Stow.
 */
export function receiveUnitActions(t: ProblemTask): ResolutionAction[] {
  if (!isReceiveUnitTask(t) || !isOpen(t) || hasLiveRecoveryStow(t)) return [];
  if (t.recovery_stow_status === 'completed') return [];
  if (!receiveJobClosed(t)) return [];
  if (t.unit_status !== 'held' || t.receive_custody_verified !== true) return [];
  if (!RECOVERABLE_HELD_TYPES.includes(t.exception_type)) return [];
  return ['re_stow', 'discard', 'write_off'];
}

function resolveActionSpec(
  t: ProblemTask,
  action: ResolutionAction,
  index: number,
  recoverySync?: RecoverySync | null
): ItemAction {
  const qty = t.quantity;
  const units = `${qty} unit${qty === 1 ? '' : 's'}`;
  if (isReceiveUnitTask(t)) {
    if (action === 're_stow') {
      const blocked = recoveryUnavailableReason(t, recoverySync);
      return {
        kind: 'resolve', action, tone: 'primary', label: 'Approve recovery',
        hint: 'Creates one recovery Stow task. Inventory is not credited until an operator scans this exact unit into a storage bin.',
        ...(blocked ? { unavailable: recoveryUnavailableText(blocked) } : {}),
      };
    }
    if (action === 'discard') {
      return {
        kind: 'resolve', action, tone: 'secondary', label: 'Discard',
        confirm: 'Discard this unit? It leaves the problem bin and is never added to inventory.',
      };
    }
    return {
      kind: 'resolve', action: 'write_off', tone: 'destructive', label: 'Write off',
      confirm: 'Write off this unit? It is recorded as a loss and is never added to inventory.',
    };
  }
  const tone: ItemAction['tone'] = index === 0 ? 'primary' : action === 'write_off' ? 'destructive' : 'secondary';
  switch (action) {
    case 're_stow':
      return { kind: 'resolve', action, tone, label: 'Re-stow', hint: 'The unit is sellable — creates a recovery Stow task to place it in a bin.' };
    case 'find_replacement':
      return { kind: 'resolve', action, tone, label: 'Find replacement', hint: 'Look for the same SKU at another bin. The exception stays open for investigation.' };
    case 'quarantine':
      return { kind: 'resolve', action, tone, label: 'Quarantine', confirm: `Quarantine ${units}? They are held in the problem bin as problem-bin stock.` };
    case 'discard':
      return { kind: 'resolve', action, tone, label: 'Discard', confirm: `Discard ${units}? They are damaged beyond use and disposed of.` };
    case 'write_off':
      return { kind: 'resolve', action, tone, label: 'Write off', confirm: `Write off ${units}? They are unaccounted for and recorded as a loss.` };
  }
}

// ── Queue items ─────────────────────────────────────────────────────────────

export type InventoryNote = {
  text: string;
  tone: 'muted' | 'pending' | 'credited';
  /** Recovery track: approved → Stow scanned → inventory credited. */
  track?: { label: string; done: boolean }[];
};

export type QueueItem = {
  key: string;
  kind: 'task' | 'pack_decision';
  task?: ProblemTask;
  decision?: PackDecisionItem;
  name: string;
  sku: string | null;
  stage: StageKey;
  stageLabel: string;
  type: string;
  qty: number;
  location: string | null;
  createdAt: string;
  state: OperationalState;
  bucket: Bucket;
  /** Management decisions (role-filtered) plus allowed navigation. */
  actions: ItemAction[];
  /** Management decisions exist but this role may not make them. */
  awaitingManager: boolean;
  next: string;
  mine: boolean;
  inventory: InventoryNote | null;
  searchText: string;
};

function taskName(t: ProblemTask): string {
  const variant = t.variant_title && t.variant_title !== 'Default Title' ? t.variant_title : null;
  if (t.product_title && variant) return `${t.product_title} — ${variant}`;
  return t.product_title ?? variant ?? t.sku ?? `Variant ${t.lasyncro_variant_id.slice(0, 8).toUpperCase()}`;
}

function taskState(t: ProblemTask, offered: ResolutionAction[]): OperationalState {
  if (!isOpen(t)) {
    return isReceiveUnitTask(t) && t.resolution_action === 're_stow' && t.recovery_stow_status === 'completed'
      ? 'recovered'
      : 'resolved';
  }
  if (isReceiveUnitTask(t) && hasLiveRecoveryStow(t)) {
    return t.recovery_stow_status === 'in_progress' ? 'stow_in_progress' : 'awaiting_stow';
  }
  if (isReceiveUnitTask(t) && receiveJobOpen(t)) return 'awaiting_receive_close';
  if (t.status === 'investigating') return 'investigating';
  return offered.length > 0 ? 'needs_decision' : 'needs_investigation';
}

function receiveInventory(t: ProblemTask, state: OperationalState): InventoryNote | null {
  if (!isReceiveUnitTask(t)) return null;
  const track = (approved: boolean, scanned: boolean) => [
    { label: 'Recovery approved', done: approved },
    { label: 'Stow scanned', done: scanned },
    { label: 'Inventory credited', done: scanned },
  ];
  if (state === 'recovered') {
    // SAFETY-015 / D1: the LaSyncro credit is final; Shopify is claimed only
    // when its I4 row proves it. No row = not yet discovered by I4.
    const where = t.recovery_stow_location_code ?? 'the Stow destination';
    const shopify = t.recovery_sync_status && SHOPIFY_SETTLED.includes(t.recovery_sync_status)
      ? ' · Shopify updated'
      : ' · Shopify update pending';
    return {
      text: `+1 credited at ${where}${shopify}`,
      tone: 'credited',
      track: track(true, true),
    };
  }
  if (state === 'awaiting_stow' || state === 'stow_in_progress') {
    return { text: 'Not credited — credits on the confirmed Stow scan', tone: 'pending', track: track(true, false) };
  }
  if (state === 'resolved') {
    if (t.resolution_action === 'discard') return { text: 'Discarded · never added to inventory', tone: 'muted' };
    if (t.resolution_action === 'write_off') return { text: 'Written off · never added to inventory', tone: 'muted' };
    return { text: 'Closed · no inventory credit recorded here', tone: 'muted' };
  }
  return { text: 'Held · not in inventory', tone: 'muted', track: track(false, false) };
}

export type BuildOptions = { canResolve: boolean; currentUserId?: number | null; recoverySync?: RecoverySync | null };

export function taskToItem(t: ProblemTask, opts: BuildOptions): QueueItem {
  const offered = isReceiveUnitTask(t)
    ? receiveUnitActions(t)
    : isOpen(t)
      ? genericResolutionActions(t.source, t.exception_type)
      : [];
  const state = taskState(t, offered);
  const stage = STAGE_OF_SOURCE[t.source] ?? 'inventory';
  const decisionActions = opts.canResolve ? offered.map((a, i) => resolveActionSpec(t, a, i, opts.recoverySync)) : [];
  const actions: ItemAction[] = [...decisionActions];
  if ((state === 'awaiting_stow' || state === 'stow_in_progress') && t.recovery_stow_task_id) {
    actions.unshift({
      kind: 'open_stow',
      stowTaskId: t.recovery_stow_task_id,
      label: 'Open Stow task',
      tone: 'primary',
      hint: 'Scan an eligible storage bin, then this exact unit. A generic product barcode is not accepted.',
    });
  }
  const awaitingManager = !opts.canResolve && offered.length > 0;
  const first = actions.find((a) => !(a.kind === 'resolve' && a.unavailable));
  const next =
    state === 'recovered' ? `Recovered at ${t.recovery_stow_location_code ?? 'storage'}`
      : state === 'resolved' ? resolutionLabel(t.resolution_action)
        : state === 'awaiting_stow' ? 'Next: scan the exact unit into a storage bin'
          : state === 'stow_in_progress' ? 'Stow claimed by an operator'
            : state === 'awaiting_receive_close' ? 'Waiting for the Receive to close'
            : awaitingManager ? 'Waiting on owner/admin decision'
              : actions[0]?.kind === 'resolve' && actions[0].unavailable ? 'Return to stock unavailable · item stays held'
              : first ? `Next: ${first.label}`
                : state === 'investigating' ? 'Replacement search underway'
                  : 'No safe automatic resolution';
  const name = taskName(t);
  return {
    key: `task:${t.problem_task_id}`,
    kind: 'task',
    task: t,
    name,
    sku: t.sku ?? null,
    stage,
    stageLabel: STAGES.find((s) => s.key === stage)?.label ?? t.source,
    type: typeLabel(t.exception_type),
    qty: t.quantity,
    location: t.unit_location_code ?? t.problem_bin_location ?? null,
    createdAt: t.created_at,
    state,
    bucket: BUCKET_OF[state],
    actions,
    awaitingManager,
    next,
    mine: opts.currentUserId != null && t.assigned_operator_id === opts.currentUserId,
    inventory: receiveInventory(t, state),
    searchText: [
      name, t.sku, t.prob_label, t.problem_bin_location, t.unit_location_code, t.lasyncro_unit_id,
      t.recovery_stow_task_id, t.problem_task_id, typeLabel(t.exception_type), t.source,
    ].filter(Boolean).join(' ').toLowerCase(),
  };
}

export function resolutionLabel(action: string | null | undefined): string {
  switch (action) {
    case 'discard': return 'Discarded';
    case 'write_off': return 'Written off';
    case 'quarantine': return 'Quarantined';
    case 're_stow': return 'Re-stowed';
    default: return 'Completed';
  }
}

export function decisionToItem(d: PackDecisionItem, opts: BuildOptions, copy?: PackDecisionCopy): QueueItem {
  // Without the host's contractual copy no decision is offered (fail closed).
  const actions: ItemAction[] = opts.canResolve && copy
    ? [
        {
          kind: 'pack_decision', status: 'approved', tone: 'primary', label: copy.approveLabel,
          confirm: copy.approveConfirm(d.order_ref),
        },
        {
          kind: 'pack_decision', status: 'rejected', tone: 'destructive', label: copy.holdLabel,
          confirm: copy.holdConfirm(d.order_ref),
        },
      ]
    : [];
  return {
    key: `pack:${d.id}`,
    kind: 'pack_decision',
    decision: d,
    name: d.item_label,
    sku: d.sku,
    stage: 'pack',
    stageLabel: 'Pack',
    type: typeLabel(d.exception_type),
    qty: 1,
    location: null,
    createdAt: d.raised_at,
    state: 'awaiting_pack_decision',
    bucket: 'decision',
    actions,
    awaitingManager: !opts.canResolve,
    next: actions.length > 0 ? `Next: ${copy!.approveLabel} or ${copy!.holdLabel.toLowerCase()}` : 'Waiting on owner/admin decision',
    mine: false,
    inventory: null,
    searchText: [d.item_label, d.sku, d.order_ref, d.batch_ref, typeLabel(d.exception_type)]
      .filter(Boolean).join(' ').toLowerCase(),
  };
}

// ── Filtering / sorting ─────────────────────────────────────────────────────

export type StatusFilter = 'open' | Bucket;
export type Filters = { q: string; stage: 'all' | StageKey; status: StatusFilter; mine: boolean };

export function filterAndSort(items: QueueItem[], f: Filters): QueueItem[] {
  const q = f.q.trim().toLowerCase();
  return items
    .filter((it) => (f.status === 'open' ? it.bucket !== 'resolved' : it.bucket === f.status))
    .filter((it) => f.stage === 'all' || it.stage === f.stage)
    .filter((it) => !f.mine || it.mine)
    .filter((it) => !q || it.searchText.includes(q))
    .sort((a, b) =>
      BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
      a.key.localeCompare(b.key));
}

export function fmtAge(iso: string, now = Date.now()): string {
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
}

/** Map a resolve failure to operator copy. The server's own message wins when present. */
export function actionErrorMessage(err: unknown): string {
  const data = (err as { response?: { status?: number; data?: { error?: unknown; code?: unknown; reason?: unknown } } })?.response;
  const reason = typeof data?.data?.reason === 'string' ? data.data.reason : null;
  // SAFETY-015: the server refused a new recovery; nothing was approved.
  if (data?.data?.code === 'RECEIVE_RECOVERY_SYNC_UNAVAILABLE') {
    return `${recoveryUnavailableText(reason)} Nothing was approved. The queue has been refreshed.`;
  }
  const REASONS: Record<string, string> = {
    receive_not_closed: 'The Receive job must be closed before this unit can be recovered.',
    custody_not_verified: 'The unit\'s problem-bin placement is not verified.',
    unit_not_held: 'This unit is no longer held — the queue has been refreshed.',
    live_recovery_stow: 'A recovery Stow task is already open for this unit.',
    classification_not_recoverable: 'This classification cannot be recovered.',
  };
  if (reason && REASONS[reason]) return REASONS[reason];
  if (data?.status === 409 && typeof data.data?.error === 'string') {
    return `${data.data.error}. The queue has been refreshed.`;
  }
  if (typeof data?.data?.error === 'string') return data.data.error;
  return 'The action could not be confirmed. The queue has been refreshed — check its state before retrying.';
}
