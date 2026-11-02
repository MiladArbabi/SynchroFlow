// modules/problem-center/src/ui/pages/ProblemCenterModuleFT2.tsx
//
// PROBLEM CENTER V2 — FT2 EXCEPTION WORKSPACE (S4-5 I5)
// Queue (58) / detail (42) workspace for pick, pack, stow, receive and
// returns exceptions.
//
// DESIGN CONTRACT:
// - Approved V2 composition: header filters, three operational indicators,
//   independently scrolling queue and detail panels. At desktop widths the
//   workspace fills its AppLayout content area; the document never scrolls.
// - Tokens only (themes/tokens.ts). CTA: var(--accent) + var(--accent-ink).
// - No optimistic state. Every decision is submitted to the backend, which
//   stays authoritative for eligibility and role; the queue then refetches.
// - Only actions the backend supports are offered (problemCenterModel.ts).
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ChangeEvent, type KeyboardEvent, type ReactNode, type Ref,
} from 'react';
import { Box, useMediaQuery } from '@mui/material';
import { ArrowRight, Check, Search } from 'lucide-react';
import { ModuleErrorBoundary, ModuleLoadingSkeleton } from '@lasyncro/shared/ui';
import {
  STAGES,
  STATE_LABEL,
  actionErrorMessage,
  decisionToItem,
  filterAndSort,
  fmtAge,
  isReceiveUnitTask,
  resolutionLabel,
  taskToItem,
  type Bucket,
  type Filters,
  type ItemAction,
  type PackDecisionCopy,
  type PackDecisionItem,
  type ProblemTask,
  type QueueItem,
  type StageKey,
  type StatusFilter,
} from './problemCenterModel.js';

export type { ProblemTask, PackDecisionItem, PackDecisionCopy } from './problemCenterModel.js';

export type ProblemCenterData = {
  tasks: ProblemTask[];
  total_unresolved: number;
} | null;

export type ProblemCenterModuleFT2Props = {
  data: ProblemCenterData;
  isLoading: boolean;
  isError: boolean;
  /** A background refetch is in flight (data stays on screen). */
  isRefreshing?: boolean;
  /** Epoch ms of the last successful load — drives the stale notice. */
  updatedAt?: number;
  onResolve: (taskId: string, action: string, note: string) => Promise<unknown>;
  onRefresh: () => unknown;
  /**
   * GH-1222: advisory presentation gate for management decisions. Omitted
   * means hidden (fail closed). Not a security boundary — the backend's
   * requireAction('wms:problem:resolve') remains authoritative.
   */
  canResolve?: boolean;
  currentUserId?: number | null;
  /** Pending pack decision requests (owner/admin only — never fetched for operators). */
  packDecisions?: PackDecisionItem[];
  onPackDecision?: (requestId: string, status: 'approved' | 'rejected', note: string) => Promise<unknown>;
  /** GH-1086 contractual pack decision copy, owned by the host page. */
  packDecisionCopy?: PackDecisionCopy;
  /** Navigate to the actual Stow task (/wms?stowTaskId=<id>). */
  onOpenStowTask?: (stowTaskId: string) => void;
};

const TONE: Record<Bucket, { bg: string; fg: string; border: string }> = {
  decision: { bg: 'var(--accent-ghost)', fg: 'var(--accent-text)', border: 'var(--accent-border)' },
  awaiting: { bg: 'transparent', fg: 'var(--ink-2)', border: 'var(--rule-2)' },
  progress: { bg: 'var(--bg-2)', fg: 'var(--ink-2)', border: 'var(--rule)' },
  resolved: { bg: 'var(--confirm-ghost)', fg: 'var(--confirm-ink)', border: 'var(--confirm-border)' },
};

const INDICATORS: { key: Exclude<Bucket, 'resolved'>; label: string; dot: string }[] = [
  { key: 'decision', label: 'Needs decision', dot: 'var(--accent)' },
  { key: 'awaiting', label: 'Awaiting action', dot: 'var(--ink-2)' },
  { key: 'progress', label: 'In progress', dot: 'var(--ink-4)' },
];

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'open', label: 'All open' },
  { value: 'decision', label: 'Needs decision' },
  { value: 'awaiting', label: 'Awaiting action' },
  { value: 'progress', label: 'In progress' },
  { value: 'resolved', label: 'Completed' },
];

const EMPTY_FILTERS: Filters = { q: '', stage: 'all', status: 'open', mine: false };
const FOCUS_RING = { outline: '2px solid var(--accent)', outlineOffset: '2px' };
const EYEBROW = { fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' } as const;
const CONTROL = {
  height: 36, borderRadius: '8px', border: '1px solid var(--rule-2)', bgcolor: 'var(--surface)',
  color: 'var(--ink-2)', fontFamily: 'inherit', fontSize: 13, fontWeight: 500, outline: 'none',
  boxSizing: 'border-box', '&:focus-visible': FOCUS_RING,
} as const;
const VISUALLY_HIDDEN = {
  position: 'absolute', width: 1, height: 1, p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const;
const STALE_AGE_MS = 8 * 3_600_000;

const shortId = (id: string) => id.slice(0, 8).toUpperCase();
const sameAction = (a: ItemAction, b: ItemAction) => {
  if (a.kind === 'resolve' && b.kind === 'resolve') return a.action === b.action;
  if (a.kind === 'pack_decision' && b.kind === 'pack_decision') return a.status === b.status;
  if (a.kind === 'open_stow' && b.kind === 'open_stow') return a.stowTaskId === b.stowTaskId;
  return false;
};

type ActionButtonProps = {
  tone: 'primary' | 'secondary' | 'destructive';
  size?: 'md' | 'lg';
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  grow?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

function ActionButton({ ref, tone, size = 'md', disabled, onClick, children, grow }: ActionButtonProps) {
  return (
    <Box
      component="button"
      type="button"
      ref={ref}
      disabled={disabled}
      onClick={onClick}
      sx={{
        flex: grow ? 1 : undefined, height: size === 'lg' ? 44 : 36, px: 1.5, borderRadius: '6px',
        fontFamily: 'inherit', cursor: 'pointer', fontSize: size === 'lg' ? 15 : 13,
        fontWeight: tone === 'primary' ? 600 : 500, whiteSpace: 'nowrap',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 1,
        ...(tone === 'primary'
          ? { border: 'none', bgcolor: 'var(--accent)', color: 'var(--accent-ink)', '&:hover:not(:disabled)': { bgcolor: 'var(--accent-hover)' } }
          : tone === 'destructive'
            ? { border: '1px solid var(--critical-border)', bgcolor: 'transparent', color: 'var(--critical-text)', '&:hover:not(:disabled)': { bgcolor: 'var(--critical-ghost)' } }
            : { border: '1px solid var(--rule-2)', bgcolor: 'transparent', color: 'var(--ink-2)', '&:hover:not(:disabled)': { bgcolor: 'var(--tile-hover)' } }),
        '&:disabled': { cursor: 'not-allowed', opacity: 0.55 },
        '&:focus-visible': FOCUS_RING,
      }}
    >
      {children}
    </Box>
  );
}

function StateChip({ item }: { item: QueueItem }) {
  const tone = TONE[item.bucket];
  return (
    <Box component="span" sx={{
      flex: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px', px: '9px', py: '2px',
      borderRadius: '100px', border: `1px solid ${tone.border}`, bgcolor: tone.bg, color: tone.fg,
      fontSize: 11, fontWeight: 500, lineHeight: 1.5, whiteSpace: 'nowrap',
    }}>
      <Box component="span" aria-hidden sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: 'currentColor' }} />
      {STATE_LABEL[item.state]}
    </Box>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={EYEBROW}>{label}</Box>
      {children}
    </Box>
  );
}

function whatHappened(item: QueueItem): string {
  if (item.decision) {
    const d = item.decision;
    return `The packer raised a ${item.type.toLowerCase()} decision on order ${d.order_ref} (batch ${d.batch_ref}) and is waiting for an owner or admin.`;
  }
  const t = item.task!;
  if (isReceiveUnitTask(t)) {
    return `${item.type} reported at Receive. One unit was held and placed in ${t.problem_bin_location ?? 'a problem bin'}. A held unit is not sellable inventory until a confirmed recovery Stow.`;
  }
  const units = `${t.quantity} unit${t.quantity === 1 ? '' : 's'}`;
  return `${units} reported at ${item.stageLabel}: ${item.type.toLowerCase()}.${t.prob_label ? ` Labelled ${t.prob_label}.` : ''}`;
}

/** Why a held Receive unit has no recovery decision, from projected facts only. */
function receiveBlockReason(t: ProblemTask): string | null {
  if (!isReceiveUnitTask(t)) return null;
  if (t.unit_status && t.unit_status !== 'held') return `The unit is ${t.unit_status.replace(/_/g, ' ')}, not held — recovery is not available.`;
  if (t.receive_custody_verified !== true) return 'The unit\'s problem-bin placement is not verified, so recovery cannot be approved yet.';
  return 'This classification is not recoverable. Investigate on the floor.';
}

function facts(item: QueueItem): { k: string; v: string }[] {
  if (item.decision) {
    return [
      { k: 'Order', v: item.decision.order_ref },
      { k: 'Batch', v: item.decision.batch_ref },
      { k: 'Stage', v: 'Pack' },
      { k: 'SKU', v: item.sku ?? '—' },
    ];
  }
  const t = item.task!;
  if (isReceiveUnitTask(t)) {
    const destination = t.recovery_stow_location_code
      ?? (item.state === 'awaiting_stow' || item.state === 'stow_in_progress' ? 'Chosen at Stow scan' : '—');
    return [
      { k: 'Now at', v: item.location ?? '—' },
      { k: 'Destination', v: destination },
      { k: 'Unit (LSU)', v: t.lasyncro_unit_id! },
      { k: 'Stow task', v: t.recovery_stow_task_id ? shortId(t.recovery_stow_task_id) : '—' },
    ];
  }
  return [
    { k: 'Now at', v: item.location ?? '—' },
    { k: 'Stage', v: item.stageLabel },
    { k: 'Problem label', v: t.prob_label ?? '—' },
    { k: 'Qty', v: String(t.quantity) },
  ];
}

function timeline(item: QueueItem, now: number): { text: string; t: string }[] {
  if (item.decision) return [{ text: `Decision requested · ${item.type}`, t: `${fmtAge(item.createdAt, now)} ago` }];
  const t = item.task!;
  const events: { text: string; at: string }[] = [{ text: `Reported at ${item.stageLabel} · ${item.type}`, at: t.created_at }];
  if (t.recovery_stow_created_at) events.push({ text: 'Recovery approved · Stow task created', at: t.recovery_stow_created_at });
  if (t.resolved_at) {
    events.push({
      text: item.state === 'recovered'
        ? `Stow confirmed · +1 credited at ${t.recovery_stow_location_code ?? 'storage'}`
        : resolutionLabel(t.resolution_action),
      at: t.resolved_at,
    });
  }
  return events
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .map((e) => ({ text: e.text, t: `${fmtAge(e.at, now)} ago` }));
}

function ProblemCenterModuleFT2Inner({
  data, isLoading, isError, isRefreshing = false, updatedAt, onResolve, onRefresh, canResolve = false,
  currentUserId = null, packDecisions, onPackDecision, packDecisionCopy, onOpenStowTask,
}: ProblemCenterModuleFT2Props) {
  const split = useMediaQuery('(min-width:900px)', { noSsr: true });
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ key: string; action: ItemAction } | null>(null);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const now = Date.now();

  const allItems = useMemo(() => {
    const opts = { canResolve, currentUserId };
    return [
      ...(data?.tasks ?? []).map((t) => taskToItem(t, opts)),
      ...(packDecisions ?? []).map((d) => decisionToItem(d, opts, packDecisionCopy)),
    ];
  }, [data, packDecisions, packDecisionCopy, canResolve, currentUserId]);
  const itemsRef = useRef(allItems);
  itemsRef.current = allItems;

  const visible = useMemo(() => filterAndSort(allItems, filters), [allItems, filters]);
  const hasData = data != null;

  // Select the most urgent exception once data arrives; never silently
  // replace a selection that disappeared (that is the stale notice below).
  useEffect(() => {
    if (selectedKey === null && visible.length > 0) setSelectedKey(visible[0].key);
  }, [selectedKey, visible]);

  const selected = selectedKey ? allItems.find((i) => i.key === selectedKey) ?? null : null;
  const selectedVisible = selected && visible.some((i) => i.key === selected.key) ? selected : null;
  const selectionGone = hasData && selectedKey !== null && selected === null;

  const select = useCallback((key: string) => {
    setSelectedKey(key);
    setConfirm((c) => (c && c.key !== key ? null : c));
    setNote('');
  }, []);

  const execute = useCallback(async (item: QueueItem, action: ItemAction) => {
    // Never submit an action that is not offered on the CURRENT projection.
    const live = itemsRef.current.find((i) => i.key === item.key);
    if (!live || !live.actions.some((a) => sameAction(a, action))) return;
    if (action.kind === 'open_stow') { onOpenStowTask?.(action.stowTaskId); return; }
    if (!canResolve) return;
    setPending(item.key);
    setErrors(({ [item.key]: _cleared, ...rest }) => rest);
    try {
      if (action.kind === 'resolve') await onResolve(item.task!.problem_task_id, action.action, note.trim());
      else await onPackDecision?.(item.decision!.id, action.status, note.trim());
      if (mounted.current) { setConfirm(null); setNote(''); }
    } catch (err) {
      if (mounted.current) setErrors((e) => ({ ...e, [item.key]: actionErrorMessage(err) }));
    } finally {
      try { await onRefresh(); } catch { /* the stale notice reports a failed refresh */ }
      if (mounted.current) setPending(null);
    }
  }, [canResolve, note, onOpenStowTask, onPackDecision, onRefresh, onResolve]);

  const run = useCallback((item: QueueItem, action: ItemAction) => {
    if (pending) return;
    if (action.kind !== 'open_stow' && action.confirm && confirm?.key !== item.key) {
      setConfirm({ key: item.key, action });
      setNote('');
      return;
    }
    void execute(item, action);
  }, [confirm, execute, pending]);

  // ── Queue keyboard navigation (listbox, roving focus) ─────────────────────
  const optionRefs = useRef(new Map<string, HTMLDivElement>());
  const onQueueKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (visible.length === 0) return;
    const idx = Math.max(0, visible.findIndex((i) => i.key === selectedKey));
    let next = idx;
    if (e.key === 'ArrowDown') next = Math.min(visible.length - 1, idx + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, idx - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = visible.length - 1;
    else return;
    e.preventDefault();
    const key = visible[next].key;
    select(key);
    optionRefs.current.get(key)?.focus();
  };

  const counts = useMemo(() => {
    const result = {} as Record<Exclude<Bucket, 'resolved'>, { count: number; sub: string }>;
    for (const { key } of INDICATORS) {
      const arr = allItems.filter((i) => i.bucket === key);
      const oldest = arr.reduce<string | null>((o, i) => (!o || new Date(i.createdAt) < new Date(o) ? i.createdAt : o), null);
      result[key] = { count: arr.length, sub: oldest ? `oldest ${fmtAge(oldest, now)}` : 'clear' };
    }
    return result;
  }, [allItems, now]);

  const filtersActive = filters.q.trim() !== '' || filters.stage !== 'all' || filters.status !== 'open' || filters.mine;
  const stale = isError && hasData;

  const keepOpenRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirm) keepOpenRef.current?.focus(); }, [confirm]);
  // A refetch that no longer offers the action under confirmation closes it.
  useEffect(() => {
    if (!confirm || pending) return;
    const live = allItems.find((i) => i.key === confirm.key);
    if (!live || !live.actions.some((a) => sameAction(a, confirm.action))) setConfirm(null);
  }, [allItems, confirm, pending]);

  // ── Detail panel ──────────────────────────────────────────────────────────
  const renderDetail = (item: QueueItem) => {
    const inv = item.inventory;
    const isPending = pending === item.key;
    const error = errors[item.key];
    const confirming = confirm?.key === item.key ? confirm.action : null;
    const primary = item.actions.find((a) => a.tone === 'primary');
    const others = item.actions.filter((a) => a !== primary);
    const t = item.task;
    const wait =
      (item.state === 'awaiting_stow' || item.state === 'stow_in_progress') && t
        ? `Waiting on an operator to scan ${t.lasyncro_unit_id} into an eligible storage bin. Inventory credits on the confirmed scan, not before.`
        : item.awaitingManager
          ? 'An owner or admin decides how this exception is resolved.'
          : item.state === 'investigating'
            ? 'Replacement search is underway. The exception stays open until it is resolved.'
            : item.state === 'needs_investigation'
              ? (t && receiveBlockReason(t)) ?? 'No verified safe resolution exists for this exception type. Investigate on the floor; it stays open until resolved.'
              : null;
    const notes = t?.resolution_notes ? [t.resolution_notes] : [];

    return (
      <Box sx={{ minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Box data-testid="pc-detail-scroll" sx={{ flex: 1, minHeight: split ? 180 : 0, overflowY: split ? 'auto' : 'visible', px: 2.5, py: 2.25, display: 'flex', flexDirection: 'column', gap: 2.25, '& > *': { flexShrink: 0 } }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <StateChip item={item} />
              <Box component="span" sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {fmtAge(item.createdAt, now)} · {item.mine ? 'Assigned to you' : item.task?.assigned_operator_id ? 'Assigned' : 'Unassigned'}
              </Box>
            </Box>
            <Box component="h2" sx={{ m: 0, fontSize: 20, fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.01em', color: 'var(--ink)' }}>{item.name}</Box>
            <Box sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
              {[item.sku, item.task ? shortId(item.task.problem_task_id) : null, item.type].filter(Boolean).join(' · ')}
            </Box>
          </Box>

          <Section label="What happened">
            <Box sx={{ fontSize: 14, fontWeight: 300, lineHeight: 1.6, color: 'var(--ink-2)' }}>{whatHappened(item)}</Box>
          </Section>

          <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', bgcolor: 'var(--rule)', border: '1px solid var(--rule)', borderRadius: '8px', overflow: 'hidden' }}>
            {facts(item).map((f) => (
              <Box key={f.k} sx={{ bgcolor: 'var(--surface)', px: 1.5, py: 1.25, display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                <Box component="dt" sx={{ ...EYEBROW, letterSpacing: '0.06em' }}>{f.k}</Box>
                <Box component="dd" sx={{ m: 0, fontSize: 13, fontWeight: 500, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{f.v}</Box>
              </Box>
            ))}
          </Box>

          {inv && (
            <Box data-testid="pc-inventory" sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, px: 1.75, py: 1.5, borderRadius: '8px', border: `1px solid ${inv.tone === 'pending' ? 'var(--accent-border)' : inv.tone === 'credited' ? 'var(--confirm-border)' : 'var(--rule)'}` }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                <Box component="span" sx={EYEBROW}>Inventory</Box>
                <Box component="span" sx={{ fontSize: 12, fontWeight: 500, textAlign: 'right', color: inv.tone === 'pending' ? 'var(--accent-text)' : inv.tone === 'credited' ? 'var(--confirm-ink)' : 'var(--ink-2)' }}>{inv.text}</Box>
              </Box>
              {inv.track && (
                <Box component="ol" aria-label="Recovery progress" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '6px' }}>
                  {inv.track.map((s) => (
                    <Box component="li" key={s.label} sx={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <Box aria-hidden sx={{ height: 3, borderRadius: '3px', bgcolor: s.done ? (inv.tone === 'credited' ? 'var(--confirm-ink)' : 'var(--accent)') : 'var(--rule)' }} />
                      <Box component="span" sx={{ fontSize: 11, lineHeight: 1.35, color: s.done ? 'var(--ink)' : 'var(--ink-3)' }}>
                        {s.label}<Box component="span" sx={VISUALLY_HIDDEN}>{s.done ? ' — done' : ' — not yet'}</Box>
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          )}

          <Section label="Timeline">
            <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
              {timeline(item, now).map((e, i) => (
                <Box component="li" key={`${e.text}-${i}`} sx={{ display: 'grid', gridTemplateColumns: '14px minmax(0,1fr) auto', gap: 1.25, py: 0.75, alignItems: 'start' }}>
                  <Box aria-hidden sx={{ width: 7, height: 7, mt: '6px', borderRadius: '50%', bgcolor: i === 0 ? 'var(--accent)' : 'var(--ink-4)' }} />
                  <Box component="span" sx={{ fontSize: 13, fontWeight: 300, lineHeight: 1.5, color: 'var(--ink-2)' }}>{e.text}</Box>
                  <Box component="span" sx={{ fontSize: 12, lineHeight: 1.6, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>{e.t}</Box>
                </Box>
              ))}
            </Box>
          </Section>

          {notes.length > 0 && (
            <Section label="Notes">
              {notes.map((n) => (
                <Box key={n} sx={{ fontSize: 13, fontWeight: 300, lineHeight: 1.55, color: 'var(--ink-2)', px: 1.25, py: 1, borderRadius: '8px', bgcolor: 'var(--bg-2)' }}>{n}</Box>
              ))}
            </Section>
          )}
        </Box>

        <Box sx={{ flex: 'none', borderTop: '1px solid var(--rule)', px: 2.5, py: 2, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {error && (
            <Box role="alert" sx={{ fontSize: 13, lineHeight: 1.5, color: 'var(--critical-text)', px: 1.5, py: 1.25, borderRadius: '8px', border: '1px solid var(--critical-border)', bgcolor: 'var(--critical-ghost)' }}>{error}</Box>
          )}
          {isPending && <Box role="status" sx={{ fontSize: 12, color: 'var(--ink-3)' }}>Saving and refreshing…</Box>}

          {confirming && confirming.kind !== 'open_stow' ? (
            <Box
              role="group"
              aria-label="Confirm action"
              onKeyDown={(e) => { if (e.key === 'Escape' && !isPending) { e.stopPropagation(); setConfirm(null); } }}
              sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}
            >
              <Box sx={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ink)' }}>{confirming.confirm}</Box>
              <Box
                component="input"
                aria-label="Note (optional)"
                placeholder="Note (optional)"
                value={note}
                disabled={isPending}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setNote(e.target.value)}
                sx={{ ...CONTROL, height: 34, px: 1.25, fontWeight: 400, color: 'var(--ink)' }}
              />
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                <ActionButton ref={keepOpenRef} tone="secondary" disabled={isPending} onClick={() => setConfirm(null)}>Keep open</ActionButton>
                <ActionButton tone={confirming.tone === 'primary' ? 'primary' : 'destructive'} disabled={isPending} onClick={() => run(item, confirming)}>
                  {confirming.label}
                </ActionButton>
              </Box>
            </Box>
          ) : (
            <>
              {wait && (
                <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', px: 1.5, py: 1.25, borderRadius: '8px', bgcolor: 'var(--bg-2)' }}>
                  <Box aria-hidden sx={{
                    width: 7, height: 7, mt: '6px', flex: 'none', borderRadius: '50%', bgcolor: 'var(--accent)',
                    '@keyframes pcBlink': { '0%,100%': { transform: 'scale(1)', opacity: 1 }, '50%': { transform: 'scale(.75)', opacity: 0.4 } },
                    '@media (prefers-reduced-motion: no-preference)': { animation: 'pcBlink 2.4s ease-in-out infinite' },
                  }} />
                  <Box component="span" sx={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ink-2)', overflowWrap: 'anywhere' }}>{wait}</Box>
                </Box>
              )}
              {primary && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  <ActionButton tone="primary" size="lg" disabled={!!pending} onClick={() => run(item, primary)}>
                    {primary.label}<ArrowRight size={14} aria-hidden />
                  </ActionButton>
                  {primary.hint && <Box component="span" sx={{ fontSize: 12, fontWeight: 300, lineHeight: 1.45, color: 'var(--ink-3)' }}>{primary.hint}</Box>}
                </Box>
              )}
              {others.length > 0 && (
                <Box sx={{ display: 'flex', gap: 1 }}>
                  {others.map((a) => (
                    <ActionButton key={a.label} grow tone={a.tone === 'destructive' ? 'destructive' : 'secondary'} disabled={!!pending} onClick={() => run(item, a)}>
                      {a.label}
                    </ActionButton>
                  ))}
                </Box>
              )}
              {item.bucket === 'resolved' && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 1.25, borderRadius: '8px', border: '1px solid var(--confirm-border)', bgcolor: 'var(--confirm-ghost)' }}>
                  <Check size={16} color="var(--confirm-ink)" aria-hidden />
                  <Box component="span" sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{item.next}</Box>
                </Box>
              )}
            </>
          )}
        </Box>
      </Box>
    );
  };

  // ── Layout ────────────────────────────────────────────────────────────────
  const panel = {
    minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid var(--rule)',
    borderRadius: '12px', bgcolor: 'var(--surface)', overflow: 'hidden',
  } as const;

  return (
    <Box
      data-testid="problem-center-v2"
      data-layout={split ? 'split' : 'stacked'}
      sx={{
        flex: split ? 1 : 'none', height: split ? '100%' : 'auto', minHeight: split ? 0 : '100%', display: 'flex', flexDirection: 'column',
        gap: 1.75, px: { xs: 2, md: 3 }, pt: 2.25, pb: 2.5, bgcolor: 'var(--bg)', color: 'var(--ink)',
        overflow: split ? 'hidden' : 'visible', boxSizing: 'border-box',
      }}
    >
      {/* ── HEADER + FILTERS ─────────────────────────────────────── */}
      <Box sx={{ flex: 'none', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px 16px' }}>
        <Box component="h1" sx={{ flex: 1, minWidth: 180, m: 0, fontSize: 24, fontWeight: 600, lineHeight: 1.1, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
          Problem Center
        </Box>
        <Box role="search" sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={14} aria-hidden style={{ position: 'absolute', left: 11, color: 'var(--ink-4)' }} />
            <Box
              component="input"
              type="search"
              aria-label="Search exceptions"
              placeholder="Search SKU, unit, bin"
              value={filters.q}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setFilters((f) => ({ ...f, q: e.target.value }))}
              sx={{ ...CONTROL, width: 200, pl: '32px', pr: 1.5, fontWeight: 400, color: 'var(--ink)' }}
            />
          </Box>
          <Box
            component="select"
            aria-label="Stage"
            value={filters.stage}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFilters((f) => ({ ...f, stage: e.target.value as 'all' | StageKey }))}
            sx={{ ...CONTROL, px: 1.25 }}
          >
            <option value="all">All stages</option>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </Box>
          <Box
            component="select"
            aria-label="Status"
            value={filters.status}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFilters((f) => ({ ...f, status: e.target.value as StatusFilter }))}
            sx={{ ...CONTROL, px: 1.25 }}
          >
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Box>
          <Box
            component="button"
            type="button"
            role="switch"
            aria-checked={filters.mine}
            onClick={() => setFilters((f) => ({ ...f, mine: !f.mine }))}
            sx={{ ...CONTROL, bgcolor: 'transparent', display: 'flex', alignItems: 'center', gap: 1, px: 1.5, cursor: 'pointer' }}
          >
            <Box component="span" aria-hidden sx={{ width: 28, height: 16, borderRadius: '100px', position: 'relative', bgcolor: filters.mine ? 'var(--accent)' : 'var(--rule-2)', transition: 'background-color .15s' }}>
              <Box component="span" sx={{ position: 'absolute', top: 2, left: filters.mine ? 14 : 2, width: 12, height: 12, borderRadius: '50%', bgcolor: 'var(--surface)', transition: 'left .15s' }} />
            </Box>
            Assigned to me
          </Box>
        </Box>
      </Box>

      {stale && (
        <Box role="status" sx={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, px: 1.75, py: 1, borderRadius: '8px', border: '1px solid var(--warning-border)', bgcolor: 'var(--warning-ghost)', fontSize: 13, color: 'var(--warning-text)' }}>
          <span>
            Couldn&apos;t refresh. Showing the queue as of {updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'the last update'} — it may be out of date.
          </span>
          <ActionButton tone="secondary" disabled={isRefreshing} onClick={() => void onRefresh()}>{isRefreshing ? 'Retrying…' : 'Retry'}</ActionButton>
        </Box>
      )}

      {/* ── OPERATIONAL INDICATORS ───────────────────────────────── */}
      <Box sx={{ flex: 'none', display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1.25 }}>
        {INDICATORS.map(({ key, label, dot }) => {
          const active = filters.status === key;
          const c = counts[key];
          return (
            <Box
              key={key}
              component="button"
              type="button"
              aria-pressed={active}
              aria-label={`${label}: ${hasData ? c.count : 'loading'}`}
              onClick={() => setFilters((f) => ({ ...f, status: active ? 'open' : key }))}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, height: 44, px: 1.75, borderRadius: '8px',
                border: `1px solid ${active ? 'var(--accent-border)' : 'var(--rule)'}`, bgcolor: active ? 'var(--accent-ghost)' : 'var(--surface)',
                color: 'var(--ink)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', '&:focus-visible': FOCUS_RING,
              }}
            >
              <Box component="span" aria-hidden sx={{ flex: 'none', width: 7, height: 7, borderRadius: '50%', bgcolor: dot }} />
              <Box component="span" sx={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</Box>
              <Box component="span" sx={{ flex: 'none', fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{hasData ? c.sub : ''}</Box>
              <Box component="span" sx={{ flex: 'none', fontSize: 20, fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{hasData ? c.count : '–'}</Box>
            </Box>
          );
        })}
      </Box>

      {/* ── WORKSPACE 58 / 42 ────────────────────────────────────── */}
      <Box sx={{
        flex: split ? 1 : 'none', minHeight: 0, display: 'grid', gap: 2,
        gridTemplateColumns: split ? 'minmax(0, 58fr) minmax(0, 42fr)' : 'minmax(0, 1fr)',
      }}>
        <Box component="section" aria-label="Exception queue" sx={{ ...panel, maxHeight: split ? 'none' : '60vh' }}>
          <Box sx={{ ...EYEBROW, flex: 'none', display: 'flex', justifyContent: 'space-between', px: 2.25, py: 1.25, borderBottom: '1px solid var(--rule)', whiteSpace: 'nowrap' }}>
            <span>Exception queue</span><span>State · next action</span>
          </Box>
          <Box data-testid="pc-queue-scroll" sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {isLoading && !hasData ? (
              <Box sx={{ p: 2 }}><ModuleLoadingSkeleton /></Box>
            ) : isError && !hasData ? (
              <Box role="alert" sx={{ px: 3, py: 8, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 1.5, alignItems: 'center' }}>
                <Box sx={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>Problem Center could not load.</Box>
                <ActionButton tone="secondary" onClick={() => void onRefresh()}>Retry</ActionButton>
              </Box>
            ) : visible.length === 0 ? (
              <Box sx={{ px: 3, py: 8, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 0.75, alignItems: 'center' }}>
                <Box sx={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>
                  Nothing <Box component="em" sx={{ color: 'var(--accent-text)' }}>stuck here.</Box>
                </Box>
                <Box sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
                  {allItems.length === 0 ? 'No open exceptions.' : 'No exceptions match these filters.'}
                </Box>
                {filtersActive && allItems.length > 0 && (
                  <ActionButton tone="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</ActionButton>
                )}
              </Box>
            ) : (
              <Box role="listbox" aria-label="Exceptions" onKeyDown={onQueueKey}>
                {visible.map((it, index) => {
                  const isSel = it.key === selectedKey;
                  const focusable = isSel || (selectedVisible === null && index === 0);
                  const aged = it.bucket !== 'resolved' && now - new Date(it.createdAt).getTime() > STALE_AGE_MS;
                  return (
                    <Box
                      key={it.key}
                      ref={(el: HTMLDivElement | null) => { if (el) optionRefs.current.set(it.key, el); else optionRefs.current.delete(it.key); }}
                      role="option"
                      aria-selected={isSel}
                      tabIndex={focusable ? 0 : -1}
                      onClick={() => select(it.key)}
                      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(it.key); } }}
                      sx={{
                        display: 'flex', flexDirection: 'column', gap: '5px', px: 2.25, py: 1.5, cursor: 'pointer',
                        borderBottom: '1px solid var(--rule)', bgcolor: isSel ? 'var(--accent-selected)' : 'transparent',
                        opacity: it.bucket === 'resolved' ? 0.75 : 1, outline: 'none',
                        '&:hover': { bgcolor: isSel ? 'var(--accent-selected)' : 'var(--row-hover)' },
                        '&:focus-visible': { boxShadow: 'inset 0 0 0 2px var(--accent)' },
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                        <Box component="span" sx={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, lineHeight: 1.3, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {it.name}
                          {it.sku && <Box component="span" sx={{ fontWeight: 400, fontSize: 12, color: 'var(--ink-4)', ml: 1 }}>{it.sku}</Box>}
                        </Box>
                        <StateChip item={it} />
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, fontSize: 12, lineHeight: 1.4, color: 'var(--ink-3)' }}>
                        <Box component="span" sx={{ flex: 1, minWidth: 0, display: 'flex', gap: 1, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                          <Box component="span" sx={{ flex: 'none', color: 'var(--ink-2)', fontWeight: 500 }}>{it.stageLabel}</Box>
                          <Box component="span" sx={{ flex: 'none', fontVariantNumeric: 'tabular-nums', color: aged ? 'var(--accent-text)' : 'var(--ink-3)' }}>{fmtAge(it.createdAt, now)}</Box>
                          <Box component="span" sx={{ flex: 'none', fontVariantNumeric: 'tabular-nums' }}>Qty {it.qty}</Box>
                          {it.location && <Box component="span" sx={{ flex: 'none', color: 'var(--ink-2)' }}>{it.location}</Box>}
                          <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.type}</Box>
                        </Box>
                        <Box component="span" sx={{ flex: '0 1 auto', minWidth: 0, maxWidth: '38%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.next}</Box>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>
          <Box sx={{ flex: 'none', px: 2.25, py: 1, borderTop: '1px solid var(--rule)', fontSize: 12, fontWeight: 300, color: 'var(--ink-4)', display: 'flex', justifyContent: 'space-between', gap: 1 }}>
            <span>{hasData ? `${visible.length} of ${allItems.length} exceptions` : ''}</span>
            <span>{isRefreshing ? 'Refreshing…' : 'Sorted by urgency, then age'}</span>
          </Box>
        </Box>

        <Box component="section" aria-label="Exception detail" sx={{ ...panel, borderRadius: '14px', minHeight: split ? 0 : 320 }}>
          {selectedVisible ? renderDetail(selectedVisible) : (
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5, alignItems: 'center', justifyContent: 'center', p: 3, textAlign: 'center', fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
              {selectionGone ? (
                <>
                  <span role="status">This exception is no longer in your queue — it was closed or reassigned.</span>
                  <ActionButton tone="secondary" onClick={() => { setSelectedKey(null); setConfirm(null); }}>Show next exception</ActionButton>
                </>
              ) : 'Select an exception to see what to do next.'}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

export default function ProblemCenterModuleFT2(props: ProblemCenterModuleFT2Props) {
  return <ModuleErrorBoundary moduleName="problem-center"><ProblemCenterModuleFT2Inner {...props} /></ModuleErrorBoundary>;
}
