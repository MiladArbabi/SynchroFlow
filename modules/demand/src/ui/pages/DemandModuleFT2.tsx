// Existing Demand computation remains the authority for Replenishment planning.
import { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { OperationalContextShell, ModuleLoadingSkeleton, ModuleErrorBoundary } from '@lasyncro/shared/ui';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';

export type DemandVelocity = {
  lasyncro_variant_id: string;
  title: string | null;
  sku: string | null;
  product_title: string | null;
  unit_cost: number | null;
  available_quantity: number;
  units_sold_30d: number;
  units_sold_prev_30d: number;
  velocity_per_day: number;
  velocity_window_days: 30 | 90 | 180;
  demand_confidence: 'high' | 'medium' | 'low' | 'none';
  velocity_trend: 'up' | 'down' | 'stable';
  days_of_stock_remaining: number | null;
  reorder_signal: boolean;
  reorder_urgency: 'critical' | 'warning' | 'healthy' | 'planning_data_required' | 'no_velocity';
  estimated_stockout_date: string | null;
  suggested_reorder_qty: number | null;
  supplier_lead_time_days: number | null;
};

export type DemandSummary = {
  total_variants_tracked: number;
  critical_reorder_count: number;
  warning_reorder_count: number;
  stockout_count: number;
  avg_days_of_stock: number | null;
  total_inventory_value: number;
};

export type DemandData = {
  summary: DemandSummary;
  variants: DemandVelocity[];
  computed_at: string;
} | null;

export type DemandModuleFT2Props = {
  data: DemandData;
  isLoading: boolean;
  isError: boolean;
  currency?: CurrencyContext;
  reorderUrgencyFilter?: 'critical';
  suppressReplenishmentState?: boolean;
  /**
   * Demand owns reorder risk and replenishment decisions.
   * Warehouse occupancy belongs to Floor Planning/WMS.
   */
};

type PlanningState = DemandVelocity['reorder_urgency'];
type PlanningFilter = PlanningState | 'at-risk' | 'planning-gaps' | 'all';

const stateLabels: Record<PlanningState, string> = {
  critical: 'Critical',
  warning: 'Reorder soon',
  planning_data_required: 'Data needed',
  no_velocity: 'No recent demand',
  healthy: 'Healthy',
};
const panel = { border: '0.5px solid var(--rule)', borderRadius: '10px', bgcolor: 'var(--surface)', minWidth: 0 };
const focus = { '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '2px' } };

function formatDemand(variant: DemandVelocity): string {
  if (variant.velocity_per_day >= 0.1) {
    return `${Number(variant.velocity_per_day.toFixed(2))} / day`;
  }
  // Display-only reconstruction of observed units in the canonical window.
  // This value never participates in planning or changes the API data.
  const observedUnits = Math.round(variant.velocity_per_day * variant.velocity_window_days);
  return `${observedUnits} ${observedUnits === 1 ? 'unit' : 'units'} / ${variant.velocity_window_days}d`;
}

function formatCover(days: number | null): string {
  return days == null ? '—' : days > 365 ? '>365d' : `${days}d`;
}

function VariantRow({ variant }: { variant: DemandVelocity }) {
  const risk = variant.reorder_urgency === 'critical' || variant.reorder_urgency === 'warning';
  const missingPlanning = variant.reorder_urgency === 'planning_data_required';
  const params = new URLSearchParams({ variantId: variant.lasyncro_variant_id });
  const title = variant.title && variant.title !== 'Default Title'
    ? variant.title : variant.product_title ?? 'Unknown item';
  return (
    <tr>
      <td>
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{title}</Typography>
        <Typography sx={{ fontSize: 10, color: 'var(--ink-3)' }}>
          {[variant.product_title !== title ? variant.product_title : null, variant.sku].filter(Boolean).join(' · ')}
        </Typography>
      </td>
      <td>{variant.available_quantity}</td>
      <td>
        {formatDemand(variant)}
        <Typography sx={{ fontSize: 10, color: 'var(--ink-3)' }}>
          {variant.velocity_per_day < 0.1
            ? `${variant.demand_confidence.charAt(0).toUpperCase()}${variant.demand_confidence.slice(1)} confidence`
            : `${variant.velocity_window_days}d · ${variant.demand_confidence} confidence`}
        </Typography>
      </td>
      <td>
        {formatCover(variant.days_of_stock_remaining)}
        {variant.supplier_lead_time_days != null && (
          <Typography sx={{ fontSize: 10, color: 'var(--ink-3)' }}>Lead time {variant.supplier_lead_time_days}d</Typography>
        )}
      </td>
      <td>{missingPlanning ? '—' : variant.suggested_reorder_qty ?? '—'}</td>
      <td>
        <Typography sx={{ fontSize: 12, color: risk ? 'var(--warning-ink)' : 'var(--ink-3)' }}>
          {stateLabels[variant.reorder_urgency]}
        </Typography>
      </td>
      <td>{risk && (
        <Box component="a" href={`/suppliers-portal/sourcing?${params.toString()}`} sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: 11, fontWeight: 500,
          color: 'var(--accent)', textDecoration: 'none', border: '0.5px solid var(--accent-border)',
          borderRadius: '6px', px: 1, py: 0.5, '&:hover': { opacity: 0.75 }, ...focus,
        }}>Review sourcing<span aria-hidden="true">→</span></Box>
      )}</td>
    </tr>
  );
}

function DemandModuleFT2Inner({
  data, isLoading, isError, reorderUrgencyFilter, suppressReplenishmentState = false,
}: DemandModuleFT2Props) {
  const [selection, setFilter] = useState<PlanningFilter | null>(null);
  useEffect(() => { setFilter(null); }, [reorderUrgencyFilter]);
  const variants = data?.variants ?? [];
  const count = (state: PlanningState) => variants.filter(v => v.reorder_urgency === state).length;
  const defaultFilter: PlanningFilter = count('critical') + count('warning') > 0
    ? 'at-risk' : count('planning_data_required') > 0 ? 'planning-gaps' : 'all';
  // Explicit URL intent wins. Until the merchant chooses a filter, the normal
  // default stays derived from current canonical planning truth. A manual
  // selection then persists across ordinary data refetches.
  const filter = reorderUrgencyFilter ?? selection ?? defaultFilter;
  const visible = variants.filter(v => filter === 'all'
    || (filter === 'at-risk' && (v.reorder_urgency === 'critical' || v.reorder_urgency === 'warning'))
    || (filter === 'planning-gaps' && v.reorder_urgency === 'planning_data_required')
    || v.reorder_urgency === filter);
  const groups: { label: string; rows: { label: string; value: number; selection: PlanningFilter }[] }[] = [
    { label: 'Items', rows: [{ label: 'Tracked', value: data?.summary.total_variants_tracked ?? variants.length, selection: 'all' }] },
    { label: 'Risk', rows: [
      { label: 'Critical', value: count('critical'), selection: 'critical' },
      { label: 'Reorder soon', value: count('warning'), selection: 'warning' },
    ] },
    { label: 'Planning', rows: [
      { label: 'Data needed', value: count('planning_data_required'), selection: 'planning-gaps' },
      { label: 'No recent demand', value: count('no_velocity'), selection: 'no_velocity' },
    ] },
    { label: 'Stable', rows: [{ label: 'Healthy', value: count('healthy'), selection: 'healthy' }] },
  ];
  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Typography component="h1" sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', mb: 2 }}>Replenishment</Typography>
      <OperationalContextShell suppressRail={suppressReplenishmentState} primary={
        <Box role="region" aria-label="Replenishment ledger" sx={{
          ...panel, height: { md: 'min(680px, calc(100dvh - 220px))' }, minHeight: 360,
          display: 'flex', flexDirection: 'column',
        }}>
          <Box role="group" aria-label="Replenishment filters" sx={{ p: 1.5, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {([['at-risk', 'At risk'], ['planning-gaps', 'Planning gaps'], ['all', 'All']] as const).map(([key, label]) => (
              <Box component="button" type="button" key={key} aria-pressed={filter === key || (key === 'at-risk' && (filter === 'critical' || filter === 'warning'))}
                onClick={() => setFilter(key)} sx={{
                  px: 1.5, py: 0.625, borderRadius: '6px', cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: 'inherit',
                  bgcolor: filter === key ? 'var(--accent)' : 'var(--surface)',
                  color: filter === key ? 'var(--accent-ink)' : 'var(--ink-3)',
                  border: '1px solid', borderColor: filter === key ? 'var(--accent)' : 'var(--rule)',
                  transition: 'background-color 0.12s', '&:hover': { bgcolor: filter === key ? 'var(--accent-hover)' : 'var(--bg-3)' }, ...focus,
                }}>{label}</Box>
            ))}
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {isLoading ? <ModuleLoadingSkeleton /> : isError ? (
              <Typography role="alert" sx={{ p: 2, color: 'var(--warning-ink)' }}>Replenishment is temporarily unavailable.</Typography>
            ) : (
              <>
                <Box component="table" sx={{
                  width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 12, color: 'var(--ink)',
                  '& th, & td': { p: '10px 8px', textAlign: 'left', overflowWrap: 'anywhere', borderBottom: '0.5px solid var(--rule)' },
                  '& th': { fontSize: 10, fontWeight: 500, color: 'var(--ink-3)', bgcolor: 'var(--surface)', position: 'sticky', top: 0 },
                  '& tbody tr:hover': { bgcolor: 'var(--bg-3)' },
                }}>
                  <colgroup>{['23%', '9%', '15%', '13%', '10%', '15%', '15%'].map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
                  <thead><tr>{['Item', 'Available', 'Demand', 'Cover', 'Suggested', 'State', 'Action'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
                  <tbody>{visible.map(variant => <VariantRow key={variant.lasyncro_variant_id} variant={variant} />)}</tbody>
                </Box>
                {!visible.length && <Typography sx={{ p: 2, fontSize: 13, color: 'var(--ink-3)' }}>
                  {variants.length ? 'No items match this planning filter.' : 'No replenishment data yet.'}
                </Typography>}
              </>
            )}
          </Box>
        </Box>
      } rail={
        <Box component="aside" aria-label="Replenishment state" sx={{
          minWidth: 0, boxSizing: 'border-box', bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)',
          borderRadius: '14px', px: '18px', py: '14px', display: 'flex', flexDirection: 'column', height: { lg: '100%' },
        }}>
          <Typography component="h2" sx={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', lineHeight: 1, mb: '12px', textTransform: 'uppercase' }}>Replenishment state</Typography>
          {groups.map(group => <Box key={group.label} role="group" aria-label={group.label} sx={{
            display: 'flex', flexDirection: 'column', gap: '6px', py: '10px', borderTop: '0.5px solid var(--rule)',
            '&:first-of-type': { borderTop: 'none', pt: 0 },
          }}>
            <Typography component="span" sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: '2px' }}>{group.label}</Typography>
            {group.rows.map(row => <Box component="button" type="button" key={row.label} onClick={() => setFilter(row.selection)} aria-pressed={filter === row.selection} sx={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, p: 0, border: 'none', bgcolor: 'transparent',
              fontFamily: 'inherit', textAlign: 'left', py: 0.5, px: 1, mx: -1, borderRadius: '6px', cursor: 'pointer',
              transition: 'background-color 0.12s', '&:hover': { bgcolor: 'var(--bg-3)' }, ...focus,
            }}>
              <Typography component="span" sx={{ fontSize: 12.5, fontWeight: 400, lineHeight: 1.45, color: 'var(--ink-3)' }}>{row.label}</Typography>
              <Typography component="span" sx={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.45, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                {!isLoading && !isError && data ? row.value : '—'}
              </Typography>
            </Box>)}
          </Box>)}
        </Box>
      } />
    </Box>
  );
}

export default function DemandModuleFT2(props: DemandModuleFT2Props) {
  return <ModuleErrorBoundary moduleName="demand"><DemandModuleFT2Inner {...props} /></ModuleErrorBoundary>;
}
