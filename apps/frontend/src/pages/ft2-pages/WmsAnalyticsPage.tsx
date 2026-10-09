// GH-1231 — Concept A owner screen. Independent historical and live truth.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Box, Typography, ToggleButtonGroup, ToggleButton, Skeleton,
  Popper, Paper, ClickAwayListener, Tooltip,
} from '@mui/material';
import { Cast, ExternalLink, Copy, X } from 'lucide-react';
import { visuallyHidden } from '@mui/utils';
import { CommercialGate } from '../../components/CommercialGate';
import { UpgradePrompt } from '../../components/UpgradePrompt';
import { getCapabilityPresentation } from '../../commercial/capabilityPresentation';
import { useWmsAnalytics, useLiveCapacity } from '../wms/useWmsAnalytics';
import {
  resolveV1HistoricalBlocks, resolveV1LiveBlocks, resolveAnalyticsDenial,
  type AnalyticsAvailability, type V1HistoricalBlocks, type V1LiveBlocks,
  type V1PacePoint,
} from '../wms/analyticsAvailability';
import {
  FLOW_STAGES, formatCount, formatStatusAge, partialPeriodLabel,
  problemTypeLabel, sortTeamAlphabetically, teamOverflowLabel, costsStripCopy,
  carrierCutoffCopy, activeBatchAssignmentCopy,
} from '../wms/analyticsV1Model';
import { useEntitlements } from '../../contexts/EntitlementsContext';
import useConfig from '../../hooks/useConfig';
import { useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from '../../api/axiosConfig';
import { useToast } from '../../contexts/ToastContext';

const text = { fontSize: 12, lineHeight: 1.4, color: 'var(--ink-3)' };
const value = { fontSize: 22, lineHeight: 1.15, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' };
const button = {
  font: 'inherit', color: 'var(--ink)', bgcolor: 'transparent', border: 0,
  textAlign: 'left', cursor: 'pointer', borderRadius: '6px', minWidth: 0,
  '&:hover': { bgcolor: 'var(--bg-2)' },
  '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 },
};
// Actions only (links and text buttons): accent mixed toward ink keeps ≥4.5:1
// text contrast in both themes (raw --accent on white is ~2.8:1).
const actionInk = 'color-mix(in srgb, var(--accent) 65%, var(--ink))';
const action = { color: actionInk, fontWeight: 500 };
// Tier 2 ghost pill (modules-ux-playbook §2) at the screen's 12px minimum.
const link = {
  ...text, ...action, display: 'inline-flex', alignItems: 'center', alignSelf: 'flex-start', px: 1, py: 0.25,
  bgcolor: 'var(--accent-ghost)', border: '0.5px solid var(--accent-border)', borderRadius: '6px', textDecoration: 'none',
  '&:hover': { opacity: 0.75 }, '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 },
};
// Card footer link: stays inside the card, below its content.
const footerLink = { ...link, mt: 'auto', flexShrink: 0 };

function UpdatedAt({ at, locale, live = false }: { at: number; locale: string; live?: boolean }) {
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  return <Typography sx={{ ...text, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{live ? 'Now · updated' : 'Updated at'} {time}</Typography>;
}

function RequestState({ state, compact = false }: { state: AnalyticsAvailability<unknown>; compact?: boolean }) {
  if (state.status === 'ready') return null;
  return state.status === 'loading'
    ? <Box role="status" aria-label="Loading analytics" sx={{ py: compact ? 0 : 1, minWidth: compact ? 64 : undefined }}><Skeleton height={compact ? 18 : 24} />{!compact && <Skeleton height={40} />}</Box>
    : <Typography sx={text}>Couldn't load this right now.</Typography>;
}

function Region({ area, question, children, stamp }: { area: string; question: string; children: ReactNode; stamp?: ReactNode }) {
  return (
    <Box component="section" role="region" aria-label={area} data-analytics-region={area.toLowerCase()}
      sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '12px', p: 1.5, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Typography sx={{ ...text, fontWeight: 600 }}>{area}</Typography>
        {stamp}
      </Box>
      <Typography component="h2" sx={{ fontSize: 16, fontWeight: 600, lineHeight: 1.25, color: 'var(--ink)', m: 0 }}>{question}</Typography>
      {children}
    </Box>
  );
}

// Local measurement keeps the existing AppLayout scroll owner and WMS tabs intact.
// Observe siblings too: wrapped tabs / shell banners change the available height.
// Width is the workspace content box, so the Ops Console and side nav count.
function useWorkspaceSize(ref: { current: HTMLDivElement | null }) {
  const [size, setSize] = useState<{ height: number | null; width: number } | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    let scrollport = root.parentElement;
    while (scrollport && !['auto', 'scroll'].includes(getComputedStyle(scrollport).overflowY)) scrollport = scrollport.parentElement;
    const measure = () => {
      const style = getComputedStyle(root);
      const width = Math.floor(root.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0));
      let height: number | null = null;
      if (scrollport) {
        const top = root.getBoundingClientRect().top - scrollport.getBoundingClientRect().top - scrollport.clientTop + scrollport.scrollTop;
        const padding = parseFloat(getComputedStyle(scrollport).paddingBottom) || 0;
        height = Math.max(0, Math.floor(scrollport.clientHeight - top - padding)) || null;
      }
      if (width > 0) setSize((prev) => prev?.height === height && prev.width === width ? prev : { height, width });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(root);
    if (scrollport) {
      observer?.observe(scrollport);
      for (const child of scrollport.children) if (child !== root) observer?.observe(child);
    }
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [ref]);
  return size;
}

// Two cards side by side only while each keeps a readable width; otherwise one
// column with natural AppLayout scrolling (GH-1231 R2).
const MIN_CARD_WIDTH = 320;
const CARD_GAP = 10;
const fitsTwoColumns = (width: number | undefined) => width === undefined || width >= 2 * MIN_CARD_WIDTH + CARD_GAP;

type Selection =
  | { kind: 'stage'; key: string }
  | { kind: 'product'; key: string }
  | { kind: 'person'; key: number }
  | { kind: 'period'; key: string }
  | { kind: 'products' }
  | { kind: 'people' };
type Select = (selection: Selection, anchor: HTMLElement) => void;

function dateLabel(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

function PaceChart({ points, bucket, timezone, locale, select, stacked }: { points: V1PacePoint[]; bucket: 'day' | 'week'; timezone: string; locale: string; select: Select; stacked: boolean }) {
  // The scale is the largest real bucket. A zero bucket draws no bar at all:
  // no minimum height and no partial-period stripe that could read as activity.
  const max = Math.max(0, ...points.map((p) => p.items_picked));
  const labels = points.length <= 7 ? points.map((_, i) => i) : [0, Math.floor((points.length - 1) / 2), points.length - 1];
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: 0.75, flex: 1, minHeight: 72, ...(stacked ? { height: 140, flex: 'none' } : {}) }}>
      {/* Baseline only: the largest bucket is not repeated above the headline total. */}
      <Box aria-hidden="true" sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', pb: 2.5 }}>
        <Typography sx={{ ...text, fontSize: 11 }}>0</Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Box role="group" aria-label={`Confirmed items picked per ${bucket}, ${timezone}. Striped bars are partial periods.`}
          sx={{ display: 'grid', gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))`, gap: '2px', flex: 1, minHeight: 0, borderBottom: '1px solid var(--rule)' }}>
          {points.map((p) => {
            const period = `${p.start_date} to ${p.end_date}`;
            const partial = p.is_current || p.is_clipped;
            // A zero bucket is inert: described, but nothing to open.
            const inert = p.items_picked === 0;
            return <Box component={inert ? 'div' : 'button'} type={inert ? undefined : 'button'} role={inert ? 'img' : undefined}
              key={p.start_date} data-pace-point={p.start_date} data-items-picked={p.items_picked}
              aria-label={`${period}: ${formatCount(p.items_picked)} confirmed items picked${p.is_current ? ', partial current period' : ''}${p.is_clipped ? ', partial first week' : ''}`}
              title={`${period} · ${formatCount(p.items_picked)} items picked`}
              onClick={inert ? undefined : (e: { currentTarget: HTMLElement }) => select({ kind: 'period', key: p.start_date }, e.currentTarget)}
              sx={inert ? { p: 0, minWidth: 0, height: '100%' } : { ...button, p: 0, display: 'flex', alignItems: 'flex-end', height: '100%' }}>
              {/* Inline style, not sx: MUI sizing turns numbers ≤1 into percentages. */}
              {p.items_picked > 0 && <Box aria-hidden="true" data-pace-bar=""
                style={{ height: `${p.items_picked / max * 100}%` }}
                sx={{ width: '100%', bgcolor: 'var(--accent)', borderRadius: '3px 3px 0 0', ...(partial ? { backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 3px, var(--surface) 3px, var(--surface) 4px)' } : {}) }} />}
            </Box>;
          })}
        </Box>
        <Box aria-hidden="true" sx={{ display: 'flex', justifyContent: 'space-between', gap: 0.5, pt: 0.5 }}>
          {labels.map((i) => <Typography key={i} sx={{ ...text, fontSize: 11, whiteSpace: 'nowrap' }}>{dateLabel(points[i].start_date, locale)}</Typography>)}
        </Box>
      </Box>
    </Box>
  );
}

function Pace({ historical, summary, flowUpdatedAt, days, locale, select, stacked }: { historical: V1HistoricalBlocks['pace']; summary: V1LiveBlocks['summary']; flowUpdatedAt: number | null; days: number; locale: string; select: Select; stacked: boolean }) {
  const data = historical.status === 'ready' ? historical.data : null;
  const current = data?.pace.points.find((p) => p.is_current);
  const cutoff = summary.status === 'ready' ? carrierCutoffCopy(summary.data.cpt_local, summary.data.hours_to_cpt) : null;
  return <Region area="Pace" question="Are we keeping up?">
    {data ? <>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1 }}>
        <Box><Typography sx={value}>{formatCount(data.pace.items_picked_total)}</Typography><Typography sx={text}>Items picked · last {days} days</Typography></Box>
        <Box sx={{ textAlign: 'right' }}><Typography sx={{ ...value, fontSize: 18 }}>{formatCount(current?.items_picked)}</Typography><Typography sx={text}>{partialPeriodLabel(data.window.bucket)}</Typography></Box>
      </Box>
      <PaceChart points={data.pace.points} bucket={data.window.bucket} timezone={data.window.timezone} locale={locale} select={select} stacked={stacked} />
    </> : <RequestState state={historical} />}
    <Box sx={{ mt: 'auto', pt: 0.5, borderTop: '1px solid var(--rule)' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
        <Typography sx={text}>Orders fulfilled today (all sales channels)</Typography>
        {summary.status === 'ready' ? <Typography sx={{ ...value, fontSize: 18 }}>{formatCount(summary.data.shipped_today)}</Typography> : <RequestState state={summary} compact />}
      </Box>
      {/* Same live response as Flow: its visible stamp already shows this time.
          Shown here only when Flow has no stamp of its own (independent truth). */}
      {summary.status === 'ready' && (flowUpdatedAt === summary.updatedAt
        ? <Box sx={visuallyHidden}><UpdatedAt at={summary.updatedAt} locale={locale} live /></Box>
        : <UpdatedAt at={summary.updatedAt} locale={locale} live />)}
      {cutoff && <Typography sx={text}>{cutoff}</Typography>}
    </Box>
  </Region>;
}

function Flow({ state, locale, select }: { state: V1LiveBlocks['flow']; locale: string; select: Select }) {
  return <Region area="Flow" question="Where is work slowing down?" stamp={state.status === 'ready' ? <UpdatedAt at={state.updatedAt} locale={locale} live /> : undefined}>
    {state.status === 'ready' ? <>
      <Typography sx={text}>Orders waiting the longest in each step</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-evenly' }}>
        {FLOW_STAGES.map((s, i) => {
          const stage = state.data.stages[s.status];
          // Rows 1/3/5 carry a faint accent tint; ages use --ink-2 so they keep
          // ≥4.5:1 on the tint in dark mode. Horizontal inset only: no new height.
          return <Box component="button" type="button" key={s.status} onClick={(e) => select({ kind: 'stage', key: s.status }, e.currentTarget)}
            sx={{ ...button, display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr) auto auto', alignItems: 'center', gap: 0.75, p: '3px 4px', position: 'relative', ...(i % 2 === 0 ? { bgcolor: 'color-mix(in srgb, var(--accent-ghost) 60%, transparent)' } : {}) }}>
            <Box aria-hidden="true" sx={{ alignSelf: 'start', textAlign: 'center', fontSize: 12, border: '1px solid var(--rule)', borderRadius: '50%', bgcolor: 'var(--bg-2)', position: 'relative', '&::after': i < 4 ? { content: '""', position: 'absolute', width: '1px', height: '10px', bgcolor: 'var(--rule)', top: '100%', left: '50%' } : {} }}>{i + 1}</Box>
            <Typography sx={{ ...text, color: 'var(--ink)' }}>{s.label}</Typography>
            {/* Exact elapsed time since the recorded status (the API reports no
                lower-bound ages); provenance is spelled out in Details. */}
            <Typography sx={{ ...text, color: 'var(--ink-2)', textAlign: 'right' }}>{formatStatusAge(stage.oldest_age_s)}</Typography>
            <Typography sx={{ ...value, fontSize: 18 }}>{formatCount(stage.count)}</Typography>
          </Box>;
        })}
      </Box>
    </> : <RequestState state={state} />}
    <Typography component={Link} to="/orders/flow" sx={footerLink}>Open Order Flow →</Typography>
  </Region>;
}

const problemPattern = (index: number) => [
  'repeating-linear-gradient(45deg, var(--ink-3), var(--ink-3) 1px, transparent 1px, transparent 5px)',
  'repeating-linear-gradient(-45deg, var(--ink-3), var(--ink-3) 1px, transparent 1px, transparent 5px)',
  'repeating-linear-gradient(0deg, var(--ink-3), var(--ink-3) 1px, transparent 1px, transparent 4px)',
  'radial-gradient(var(--ink-3) 1px, transparent 1px)',
  'repeating-linear-gradient(90deg, var(--ink-3), var(--ink-3) 1px, transparent 1px, transparent 4px)',
][index % 5];

function Problems({ state, days, select }: { state: V1HistoricalBlocks['problems']; days: number; select: Select }) {
  const data = state.status === 'ready' ? state.data.problems : null;
  const types = data ? Object.entries(data.by_type).filter(([, count]) => count > 0) : [];
  return <Region area="Problems" question="Where are problems happening?">
    {data ? data.total === 0 ? <Typography sx={text}>No problems recorded in the last {days} days</Typography> : <>
      <Typography sx={text}><Box component="span" sx={{ ...value, fontSize: 18 }}>{formatCount(data.total)}</Box> problems recorded · {formatCount(data.open_total)} still open</Typography>
      <Box aria-hidden="true" sx={{ display: 'flex', height: 12, flexShrink: 0, borderRadius: '3px', border: '1px solid var(--rule)' }}>
        {types.map(([code, count], i) => <Box key={code} sx={{ width: `${count / data.total * 100}%`, bgcolor: 'var(--bg-2)', backgroundImage: problemPattern(i), backgroundSize: i % 5 === 3 ? '5px 5px' : undefined, borderRight: '1px solid var(--surface)' }} />)}
      </Box>
      <Box sx={{ display: 'flex', gap: '3px 10px', flexWrap: 'wrap' }}>
        {types.map(([code, count], i) => <Box key={code} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box aria-hidden="true" sx={{ width: 10, height: 10, border: '1px solid var(--rule)', backgroundImage: problemPattern(i), backgroundSize: i % 5 === 3 ? '5px 5px' : undefined }} />
          <Typography sx={text}>{problemTypeLabel(code)} · {formatCount(count)}</Typography>
        </Box>)}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        {data.products.slice(0, 2).map((p) => <Box component="button" type="button" key={p.lasyncro_variant_id} data-analytics-product=""
          onClick={(e) => select({ kind: 'product', key: p.lasyncro_variant_id }, e.currentTarget)}
          sx={{ ...button, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1, p: '5px 0', borderBottom: '1px solid var(--rule)' }}>
          <Typography sx={{ ...text, color: 'var(--ink)', overflowWrap: 'anywhere' }}>{p.display_label}</Typography><Typography sx={{ ...text, fontWeight: 600 }}>{formatCount(p.count)}</Typography>
        </Box>)}
      </Box>
      {data.products_total > 2 && <Box component="button" type="button" onClick={(e) => select({ kind: 'products' }, e.currentTarget)} sx={{ ...button, ...action, p: 0, fontSize: 12, alignSelf: 'flex-start' }}>+{formatCount(data.products_total - 2)} more products</Box>}
    </> : <RequestState state={state} />}
    <Typography component={Link} to="/problem-center" sx={footerLink}>Open Problem Center →</Typography>
  </Region>;
}

const teamColumns = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 0.75 };

function Team({ state, summary, rowLimit, select }: { state: V1HistoricalBlocks['team']; summary: V1LiveBlocks['summary']; rowLimit: number; select: Select }) {
  const rows = state.status === 'ready' ? sortTeamAlphabetically(state.data.team_activity) : [];
  const max = Math.max(1, ...rows.flatMap((r) => [r.items_picked, r.items_packed]));
  const overflow = teamOverflowLabel(Math.min(rowLimit, rows.length), rows.length);
  const assignment = summary.status === 'ready' ? activeBatchAssignmentCopy(summary.data.active_operators) : null;
  return <Region area="Team" question="How is the team doing?">
    {state.status === 'ready' ? <>
      {/* Static column headers on the rows' own grid, coloured like their bars
          (solid accent / ink-3 outline); not links, so no arrows. */}
      <Box sx={teamColumns}>
        <Typography data-analytics-team-column="picked" sx={{ ...text, fontWeight: 600, color: actionInk, textAlign: 'right' }}>Items picked</Typography>
        <Typography data-analytics-team-column="packed" sx={{ ...text, fontWeight: 600, color: 'var(--ink-3)', borderLeft: '1px solid transparent', pl: 0.75 }}>Items packed</Typography>
      </Box>
      {rows.length === 0 && <Typography sx={text}>No confirmed item activity in the last {state.data.window.days} days</Typography>}
      {rows.slice(0, rowLimit).map((r) => <Box component="button" type="button" key={r.user_id} data-analytics-person=""
        onClick={(e) => select({ kind: 'person', key: r.user_id }, e.currentTarget)} sx={{ ...button, p: '3px 0' }}>
        <Typography sx={{ ...text, color: 'var(--ink)' }}>{r.display_name}{!r.is_current_member && <Box component="span" sx={{ ...text, ml: 0.75 }}>Former member</Box>}</Typography>
        <Box sx={teamColumns}>
          <Box data-analytics-team-column="picked" sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 0.5 }}>
            <Typography sx={text}>{formatCount(r.items_picked)}<Box component="span" sx={visuallyHidden}> items picked </Box></Typography><Box aria-hidden="true" sx={{ width: `${r.items_picked / max * 65}%`, height: 5, bgcolor: 'var(--accent)', borderRadius: '3px' }} />
          </Box>
          <Box data-analytics-team-column="packed" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, borderLeft: '1px solid var(--rule)', pl: 0.75 }}>
            <Box aria-hidden="true" sx={{ width: `${r.items_packed / max * 65}%`, height: 5, border: '1px solid var(--ink-3)', borderRadius: '3px' }} /><Typography sx={text}>{formatCount(r.items_packed)}<Box component="span" sx={visuallyHidden}> items packed </Box></Typography>
          </Box>
        </Box>
      </Box>)}
      {overflow && <Box component="button" type="button" onClick={(e) => select({ kind: 'people' }, e.currentTarget)} sx={{ ...button, ...action, p: 0, fontSize: 12, alignSelf: 'flex-start' }}>{overflow} · Details</Box>}
    </> : <RequestState state={state} />}
    <Box sx={{ mt: 'auto', pt: 0.5, borderTop: '1px solid var(--rule)' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={text}>Assigned to active batches</Typography>
        {assignment ? <Typography sx={{ ...text, fontWeight: 600 }}>{assignment.value}</Typography> : <RequestState state={summary} compact />}
      </Box>
      {assignment && <Typography sx={text}>Includes unfinished batches; not live staffing</Typography>}
    </Box>
  </Region>;
}

function Costs({ state }: { state: V1HistoricalBlocks['costs'] }) {
  const copy = state.status === 'ready' ? costsStripCopy(state.data.unlocked) : null;
  return <Box component="section" role="region" aria-label="Costs" sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px 12px', p: '8px 12px', border: '1px solid var(--rule)', borderRadius: '8px', bgcolor: 'var(--surface)' }}>
    <Typography component="h2" sx={{ ...text, fontWeight: 600, m: 0 }}>Costs</Typography>
    {copy ? <Typography sx={text}>{copy.text}{copy.href && <> · <Box component={Link} to={copy.href} sx={link}>Open Team →</Box></>}</Typography> : <RequestState state={state} compact />}
  </Box>;
}

function DetailsContent({ selection, historical, live, locale }: { selection: Selection | null; historical: V1HistoricalBlocks; live: V1LiveBlocks; locale: string }) {
  if (!selection) return null;
  if (selection.kind === 'stage') {
    const stage = FLOW_STAGES.find((s) => s.status === selection.key)!;
    return <><Typography component="h3" sx={{ ...text, color: 'var(--ink)', fontWeight: 600 }}>{stage.label}</Typography>
      {live.flow.status === 'ready' ? <>
        <Typography sx={value}>{formatCount(live.flow.data.stages[stage.status].count)} orders</Typography>
        <Typography sx={text}>Longest time in recorded status: {formatStatusAge(live.flow.data.stages[stage.status].oldest_age_s)}</Typography>
        <Typography sx={text}>Elapsed time since the order status was recorded; not continuous time spent by a person.</Typography>
        <UpdatedAt at={live.flow.updatedAt} locale={locale} live />
      </> : <RequestState state={live.flow} />}
      <Typography component={Link} to="/orders/flow" sx={link}>Open Order Flow →</Typography>
    </>;
  }
  if (selection.kind === 'period') {
    const p = historical.pace.status === 'ready' ? historical.pace.data.pace.points.find((p) => p.start_date === selection.key) : null;
    return p ? <>
      <Typography component="h3" sx={{ ...text, color: 'var(--ink)', fontWeight: 600 }}>{dateLabel(p.start_date, locale)} – {dateLabel(p.end_date, locale)}</Typography>
      <Typography sx={value}>{formatCount(p.items_picked)} items picked</Typography>
      <Typography sx={text}>Confirmed quantities · {historical.pace.status === 'ready' && historical.pace.data.window.timezone}</Typography>
      {p.is_current && <Typography sx={text}>{historical.pace.status === 'ready' && partialPeriodLabel(historical.pace.data.window.bucket)}</Typography>}
      {p.is_clipped && <Typography sx={text}>Partial first week in the selected period</Typography>}
    </> : historical.pace.status === 'ready' ? <Typography sx={text}>Select a period in this window.</Typography> : <RequestState state={historical.pace} />;
  }
  if (selection.kind === 'product' || selection.kind === 'products') {
    if (historical.problems.status !== 'ready') return <RequestState state={historical.problems} />;
    const { problems: all, window } = historical.problems.data;
    const rows = selection.kind === 'product' ? all.products.filter((p) => p.lasyncro_variant_id === selection.key) : all.products;
    return <>
      {rows.map((p) => <Box key={p.lasyncro_variant_id} sx={{ pb: 1, borderBottom: '1px solid var(--rule)' }}>
        <Typography component="h3" sx={{ ...text, color: 'var(--ink)', fontWeight: 600 }}>{p.display_label}</Typography>
        {p.sku && <Typography sx={text}>SKU: {p.sku}</Typography>}
        <Typography sx={text}>{formatCount(p.count)} problems recorded · last {window.days} days</Typography>
      </Box>)}
      {selection.kind === 'products' && all.products_total > rows.length && <Typography sx={text}>Showing {rows.length} of {formatCount(all.products_total)} products</Typography>}
      <Typography component={Link} to="/problem-center" sx={link}>Open Problem Center →</Typography>
    </>;
  }
  if (historical.team.status !== 'ready') return <RequestState state={historical.team} />;
  const { team_activity, window } = historical.team.data;
  const rows = sortTeamAlphabetically(team_activity).filter((r) => selection.kind === 'people' || r.user_id === selection.key);
  return <>
    {rows.map((r) => <Box key={r.user_id} sx={{ pb: 1, borderBottom: '1px solid var(--rule)' }}>
      <Typography component="h3" sx={{ ...text, color: 'var(--ink)', fontWeight: 600 }}>{r.display_name}</Typography>
      {!r.is_current_member && <Typography sx={text}>Former member · historical activity retained</Typography>}
      <Typography sx={text}>{formatCount(r.items_picked)} items picked · {formatCount(r.items_packed)} items packed</Typography>
      <Typography sx={text}>Confirmed quantities · last {window.days} days</Typography>
    </Box>)}
  </>;
}

export default function WmsAnalyticsPage() {
  const [days, setDays] = useState(30);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const size = useWorkspaceSize(root);
  const twoColumns = fitsTwoColumns(size?.width);
  const { state: { isOpsConsoleOpen } } = useConfig();
  const { locale } = useEntitlements();
  const historicalQuery = useWmsAnalytics(days);
  const liveQuery = useLiveCapacity();
  const historical = resolveV1HistoricalBlocks(historicalQuery, days);
  const live = resolveV1LiveBlocks(liveQuery);
  const denial = resolveAnalyticsDenial(...Object.values(historical), ...Object.values(live));
  const select: Select = (next, element) => { setSelection(next); setAnchor(element); };
  const closeDetails = () => { setSelection(null); anchor?.focus(); };
  useEffect(() => {
    if (!selection || isOpsConsoleOpen) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setSelection(null); anchor?.focus(); } };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [selection, anchor, isOpsConsoleOpen]);

  if (denial?.kind === 'commercial') {
    const presentation = getCapabilityPresentation('warehouse.analytics');
    return <UpgradePrompt decision={denial.decision} mode="locked" featureName={presentation?.featureName} benefits={presentation?.benefits} open />;
  }

  // Two columns fill the measured workspace (no primary scroll at the certified
  // viewports); rows never shrink below their content, so a short workspace
  // scrolls naturally instead of overlapping cards. One column always scrolls.
  const workspaceHeight = twoColumns && size?.height ? size.height : undefined;
  return <CommercialGate capabilityId="warehouse.analytics">
    <Box ref={root} data-analytics-workspace="" data-analytics-columns={twoColumns ? 2 : 1}
      sx={{ minHeight: workspaceHeight, boxSizing: 'border-box', minWidth: 0, bgcolor: 'var(--bg)', px: { xs: 1.5, lg: 2 }, pt: 1, pb: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'auto minmax(min-content, 1fr) auto', alignContent: 'start', gap: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography component="h1" sx={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2, color: 'var(--ink)', letterSpacing: '-0.02em', m: 0 }}>Warehouse Analytics</Typography>
        {denial?.kind !== 'role' && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {historical.costs.status === 'ready' && <UpdatedAt at={historical.costs.updatedAt} locale={locale} />}
          <CastButton />
          <ToggleButtonGroup value={days} exclusive size="small" aria-label="Reporting period" onChange={(_e, next) => { if (next) setDays(next); }} sx={{ '& button': { fontSize: 12, px: 1, py: 0.5, color: 'var(--ink)', borderColor: 'var(--rule)' } }}>
            {[7, 30, 90].map((n) => <ToggleButton key={n} value={n}>{n}d</ToggleButton>)}
          </ToggleButtonGroup>
        </Box>}
      </Box>
      {denial?.kind === 'role' ? <Typography sx={{ ...text, color: 'var(--ink)' }}>You don't have access to Analytics.</Typography> : <>
        <Box data-analytics-cards="" sx={{ display: 'grid', gap: `${CARD_GAP}px`, gridTemplateColumns: twoColumns ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)', gridTemplateRows: twoColumns ? 'repeat(2, auto)' : 'none', alignContent: 'stretch' }}>
          <Pace historical={historical.pace} summary={live.summary} flowUpdatedAt={live.flow.status === 'ready' ? live.flow.updatedAt : null} days={days} locale={locale} select={select} stacked={!twoColumns} />
          <Flow state={live.flow} locale={locale} select={select} />
          <Problems state={historical.problems} days={days} select={select} />
          <Team state={historical.team} summary={live.summary} rowLimit={workspaceHeight ? Math.max(1, Math.min(3, Math.floor(((workspaceHeight - 120) / 2 - 160) / 44))) : 3} select={select} />
        </Box>
        <Costs state={historical.costs} />
        {/* Contextual Details: nonmodal and anchored to its trigger, so the
            answers and period controls stay accessible (no aria-hidden). It
            withdraws while the Ops Console is open and returns with the same
            selection when it closes. */}
        <Popper open={!!selection && !isOpsConsoleOpen} anchorEl={anchor?.isConnected ? anchor : root.current}
          placement="bottom-start" modifiers={[{ name: 'preventOverflow', options: { padding: 16, altAxis: true } }]}
          sx={{ zIndex: 1200 }}>
          <Paper role="dialog" aria-label="Details"
            sx={{ width: 340, maxWidth: 'calc(100vw - 32px)', maxHeight: 'min(440px, calc(100dvh - 32px))', overflow: 'auto', boxSizing: 'border-box', p: 2, display: 'flex', flexDirection: 'column', gap: 1.25, bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '12px' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography component="h2" sx={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', m: 0 }}>Details</Typography>
              <Box component="button" type="button" aria-label="Close Details" autoFocus onClick={closeDetails} sx={{ ...button, p: 0.5, display: 'flex' }}><X size={16} /></Box>
            </Box>
            <DetailsContent selection={selection} historical={historical} live={live} locale={locale} />
          </Paper>
        </Popper>
      </>}
    </Box>
  </CommercialGate>;
}

function CastButton() {
  const queryClient  = useQueryClient();
  const { show }     = useToast();
  const anchorRef    = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen]   = useState(false);
  const [busy, setBusy]   = useState(false);

  const buildUrl = (raw: string) =>
    `${window.location.origin}/wms/analytics/display?token=${encodeURIComponent(raw)}`;

  const provisionToken = async (): Promise<string> => {
    const { data } = await axiosInstance.post('/api/v1/wms/analytics/display-tokens', { label: 'Cast display' });
    queryClient.invalidateQueries({ queryKey: ['display-tokens'] });
    return data.raw_token as string;
  };

  const handleCopyLink = async () => {
    setBusy(true);
    try {
      const raw = await provisionToken();
      await navigator.clipboard.writeText(buildUrl(raw));
      show('Display link copied to clipboard', 'success');
      setOpen(false);
    } catch (err) {
      console.error('[Cast] copy link failed', err);
      show('Could not create display link', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleOpenDisplay = async () => {
    setBusy(true);
    const tab = window.open('', '_blank');
    try {
      const raw = await provisionToken();
      if (tab) tab.location.href = buildUrl(raw);
      setOpen(false);
    } catch (err) {
      console.error('[Cast] open display failed', err);
      if (tab) tab.close();
      show('Could not open display', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleClose = (e: MouseEvent | TouchEvent) => {
    if (anchorRef.current?.contains(e.target as Node)) return;
    setOpen(false);
  };

  return (
    <>
      <Tooltip title="Cast to display">
        <Box
          component="button"
          type="button"
          aria-expanded={open}
          aria-label="Cast to display"
          ref={anchorRef}
          onClick={() => setOpen(prev => !prev)}
          sx={{
            display: 'flex', alignItems: 'center', gap: 0.75,
            px: 1.25, py: 0.5, borderRadius: '8px',
            border: `1px solid ${open ? 'var(--accent)' : 'var(--rule)'}`,
            bgcolor: open ? 'var(--accent-ghost)' : 'transparent',
            cursor: 'pointer', flexShrink: 0,
            '&:hover': { bgcolor: 'var(--bg-2)', borderColor: 'var(--accent)' },
            transition: 'all 0.15s',
          }}
        >
          <Cast size={14} strokeWidth={1.75} color={open ? 'var(--accent)' : 'var(--ink-3)'} />
          <Typography sx={{ fontSize: 12, fontWeight: 500, color: open ? 'var(--accent)' : 'var(--ink-3)' }}>
            Cast
          </Typography>
        </Box>
      </Tooltip>

      <Popper
        open={open}
        anchorEl={anchorRef.current}
        placement="bottom-end"
        disablePortal={false}
        popperOptions={{ modifiers: [{ name: 'offset', options: { offset: [0, 6] } }] }}
        sx={{ zIndex: 1300 }}
      >
        <ClickAwayListener onClickAway={handleClose}>
          <Paper sx={{
            bgcolor: 'var(--surface)',
            border: '1px solid var(--rule)',
            borderRadius: '12px',
            boxShadow: '0 8px 28px rgba(15,14,13,0.08)',
            minWidth: 240, overflow: 'hidden',
          }}>
            <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid var(--rule)' }}>
              <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                Cast to Floor Display
              </Typography>
            </Box>

            <Box sx={{ py: 0.5 }}>
              <Box
                component="button" type="button" disabled={busy}
                onClick={handleCopyLink}
                sx={{ width: '100%', textAlign: 'left', border: 0, bgcolor: 'transparent', font: 'inherit', color: 'inherit', display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 0.875, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1, '&:hover': { bgcolor: busy ? 'transparent' : 'var(--bg-2)' } }}
              >
                <Copy size={14} color="var(--ink-3)" strokeWidth={1.75} />
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3 }}>Copy display link</Typography>
                  <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>Paste into any TV browser</Typography>
                </Box>
              </Box>

              <Box
                component="button" type="button" disabled={busy}
                onClick={handleOpenDisplay}
                sx={{ width: '100%', textAlign: 'left', border: 0, bgcolor: 'transparent', font: 'inherit', color: 'inherit', display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 0.875, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1, '&:hover': { bgcolor: busy ? 'transparent' : 'var(--bg-2)' } }}
              >
                <ExternalLink size={14} color="var(--ink-3)" strokeWidth={1.75} />
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3 }}>Open display now</Typography>
                  <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>Launch in a new tab</Typography>
                </Box>
              </Box>

              <Box sx={{ px: 2, py: 0.875, borderTop: '1px solid var(--rule)' }}>
                <Typography
                  component={Link} to="/settings/warehouse" onClick={() => setOpen(false)}
                  sx={link}
                >
                  Manage displays in Settings →
                </Typography>
              </Box>
            </Box>
          </Paper>
        </ClickAwayListener>
      </Popper>
    </>
  );
}
