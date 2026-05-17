// apps/frontend/src/pages/ft2-pages/FulfillmentQueuePage.tsx
//
// FULFILLMENT QUEUE — FT2 OPERATOR SURFACE
// -----------------------------------------
// Target design: handover §2.4 + inspo screenshot
//
// Sections:
//   Header     — serif + italic accent + batch summary subline
//   Filter bar — Status · Priority · Assignee · Created · Delivery
//   Batch list — expandable rows with pick + pack progress bars
//
// Data: GET /api/v1/wms/batches + GET /api/v1/wms/batch/:id/line-items
// Actions: POST /api/v1/wms/batch/release (Merge batches)
import { useState } from 'react';
import { Box, Typography, useTheme, CircularProgress } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ChevronRight, ChevronDown, Package } from 'lucide-react';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { usePickBatches, usePickBatchLineItems } from '../wms/usePickBatches';
import type { PickBatch, PickBatchLineItem } from '../wms/usePickBatches';


// Batch sequential display number — derived from released_at sort order
const batchDisplayId = (batch: PickBatch, index: number): string =>
  `#${String(index + 1).padStart(5, '0')}`;

const formatTime = (iso: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

const pct = (n: number, total: number): number =>
  total === 0 ? 0 : Math.min(100, Math.round((n / total) * 100));

// ─── PROGRESS BAR ─────────────────────────────────────────────────────────────

function ProgressBar({ value, total, color }: { value: number; total: number; color: string }) {
  const p = pct(value, total);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: 'var(--bg-3)', overflow: 'hidden' }}>
        <Box sx={{ height: '100%', width: `${p}%`, bgcolor: color, borderRadius: 3, transition: 'width 0.3s ease' }} />
      </Box>
      <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', minWidth: 28, textAlign: 'right' }}>
        {value}/{total}
      </Typography>
    </Box>
  );
}

// ─── LINE ITEM ROW ────────────────────────────────────────────────────────────

function LineItemRow({ item }: { item: PickBatchLineItem }) {
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: '48px 1fr 160px 100px 80px',
      alignItems: 'center',
      px: 3, py: 1.25,
      borderBottom: '1px solid var(--rule)',
      '&:last-child': { borderBottom: 'none' },
      '&:hover': { bgcolor: 'var(--bg-2)' },
    }}>
      {/* Qty */}
      <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
        {item.quantity}/{item.quantity}
      </Typography>

      {/* Item name */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Package size={14} color="var(--ink-4)" />
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
          {item.title}
        </Typography>
      </Box>

      {/* Variant · SKU */}
      <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
        {item.sku ?? 'No SKU'}
      </Typography>

      {/* Location */}
      <Box sx={{
        display: 'inline-flex', alignItems: 'center',
        px: 1, py: 0.25,
        bgcolor: 'var(--bg-3)',
        border: '1px solid var(--rule)',
        borderRadius: '4px',
        width: 'fit-content',
      }}>
        <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', fontFamily: 'monospace' }}>
          {item.location_code}
        </Typography>
      </Box>

      {/* Picked fraction */}
      <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textAlign: 'right' }}>
        {item.quantity}/{item.quantity}
      </Typography>
    </Box>
  );
}

// ─── EXPANDED BATCH PANEL ─────────────────────────────────────────────────────

function BatchLineItemsPanel({ batchId }: { batchId: string }) {
  const { data, isLoading } = usePickBatchLineItems(batchId);
  const theme = useTheme();

  return (
    <Box sx={{
      borderTop: '1px solid var(--rule)',
      bgcolor: theme.palette.mode === 'dark' ? 'var(--bg)' : 'var(--bg-2)',
    }}>
      {/* Column headers */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: '48px 1fr 160px 100px 80px',
        px: 3, py: 1,
        borderBottom: '1px solid var(--rule)',
      }}>
        {['QTY', 'ITEM', 'VARIANT · SKU', 'LOCATION', 'PICKED'].map((col) => (
          <Typography key={col} sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
            {col}
          </Typography>
        ))}
      </Box>

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={20} />
        </Box>
      )}

      {data?.line_items.map((item) => (
        <LineItemRow key={item.lasyncro_line_item_id} item={item} />
      ))}

      {!isLoading && data?.line_items.length === 0 && (
        <Typography sx={{ fontSize: 13, color: 'var(--ink-4)', px: 3, py: 2 }}>
          All items picked — no remaining line items.
        </Typography>
      )}
    </Box>
  );
}

// ─── BATCH ROW ────────────────────────────────────────────────────────────────

function BatchRow({ batch, index }: { batch: PickBatch; index: number }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const pickPct  = pct(batch.units_picked, batch.total_units);
  const packPct  = pct(batch.units_packed, batch.total_units);

  const pickColor  = pickPct === 100 ? theme.palette.success.main : theme.palette.warning.main;
  const packColor  = packPct === 100 ? theme.palette.success.main : 'var(--ink-4)';

  return (
    <Box sx={{ borderBottom: '1px solid var(--rule)', '&:last-child': { borderBottom: 'none' } }}>
      {/* BATCH ROW */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: '32px 100px 140px 80px 90px 120px 1fr 1fr 120px',
        alignItems: 'center',
        px: 2, py: 1.5,
        cursor: 'pointer',
        '&:hover': { bgcolor: 'var(--bg-2)' },
        bgcolor: expanded
          ? theme.palette.mode === 'dark'
            ? alpha(theme.palette.warning.main, 0.06)
            : alpha(theme.palette.warning.main, 0.03)
          : 'transparent',
      }}
        onClick={() => setExpanded(prev => !prev)}
      >
        {/* Expand chevron */}
        <Box sx={{ color: 'var(--ink-4)', display: 'flex' }}>
          {expanded
            ? <ChevronDown size={14} />
            : <ChevronRight size={14} />}
        </Box>

        {/* Batch ID */}
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', fontFamily: 'monospace' }}>
          {batchDisplayId(batch, index)}
        </Typography>

        {/* Assignee */}
        <Typography sx={{ fontSize: 12, color: batch.picker_name ? 'var(--ink)' : 'var(--ink-4)' }}>
          {batch.picker_name ?? 'Unassigned'}
        </Typography>

        {/* Tote — not in schema yet, placeholder */}
        <Typography sx={{ fontSize: 12, color: 'var(--ink-4)' }}>—</Typography>

        {/* Created */}
        <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {formatTime(batch.released_at)}
        </Typography>

        {/* Deliver by — not in schema yet */}
        <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>—</Typography>

        {/* Pick progress */}
        <ProgressBar value={batch.units_picked} total={batch.total_units} color={pickColor} />

        {/* Pack progress */}
        <ProgressBar value={batch.units_packed} total={batch.total_units} color={packColor} />

        {/* Action */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Typography
            component="a"
            href={`/wms/batch/${batch.pick_batch_id}`}
            onClick={(e) => e.stopPropagation()}
            sx={{
              fontSize: 12, fontWeight: 600,
              color: 'var(--accent)',
              bgcolor: alpha(theme.palette.warning.main, 0.1),
              border: `1px solid ${alpha(theme.palette.warning.main, 0.3)}`,
              borderRadius: '6px',
              px: 1.5, py: 0.5,
              textDecoration: 'none',
              '&:hover': { bgcolor: alpha(theme.palette.warning.main, 0.18) },
            }}
          >
            Continue →
          </Typography>
        </Box>
      </Box>

      {/* EXPANDED LINE ITEMS */}
      {expanded && <BatchLineItemsPanel batchId={batch.pick_batch_id} />}
    </Box>
  );
}

// ─── FILTER CHIP ──────────────────────────────────────────────────────────────

function FilterChip({ label, value, active }: { label: string; value: string; active?: boolean }) {
  const theme = useTheme();
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.5,
      px: 1.5, py: 0.75,
      borderRadius: '6px',
      bgcolor: active ? alpha(theme.palette.warning.main, 0.1) : 'var(--surface)',
      border: `1px solid ${active ? alpha(theme.palette.warning.main, 0.4) : 'var(--rule)'}`,
      cursor: 'pointer',
      '&:hover': { borderColor: 'var(--accent)' },
    }}>
      <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 11, fontWeight: 700, color: active ? 'var(--accent)' : 'var(--ink)' }}>
        {value}
      </Typography>
    </Box>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function FulfillmentQueuePage() {
  const { data, isLoading } = usePickBatches();
  const batches = data?.batches ?? [];

  // Summary counts for subline
  const openCount   = batches.length;
  const readyCount  = batches.filter(b => b.status === 'pending').length;
  const pickingCount = batches.filter(b => b.status === 'picking').length;

  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%' }}>
      <ModuleTabBar tabs={ORDERS_MODULE_TABS} />

      <Box sx={{ p: '32px 40px' }}>

        {/* ── HEADER ─────────────────────────────────────────────────────── */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3 }}>
          <Box>
            <Box sx={{ mb: 0.5 }}>
              <Typography sx={{ fontFamily: '"DM Serif Display", serif', fontSize: 36, fontWeight: 400, color: 'var(--ink)', display: 'inline' }}>
                Fulfillment queue.{' '}
              </Typography>
              <Typography sx={{ fontFamily: '"DM Serif Display", serif', fontSize: 36, fontWeight: 400, fontStyle: 'italic', color: 'var(--accent)', display: 'inline' }}>
                Pick, pack, ship.
              </Typography>
            </Box>
            <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
              {openCount} batch{openCount !== 1 ? 'es' : ''} open
              {readyCount > 0 && ` · ${readyCount} ready to pick`}
              {pickingCount > 0 && ` · ${pickingCount} in progress`}
            </Typography>
          </Box>

          {/* Page actions */}
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
            <Box sx={{
              px: 2, py: 1,
              border: '1px solid var(--rule)',
              borderRadius: '8px',
              cursor: 'pointer',
              '&:hover': { borderColor: 'var(--ink-3)' },
            }}>
              <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>View manifests</Typography>
            </Box>
            <Box sx={{
              px: 2, py: 1,
              bgcolor: 'var(--accent)',
              borderRadius: '8px',
              cursor: 'pointer',
              '&:hover': { opacity: 0.9 },
            }}>
              <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>Merge batches</Typography>
            </Box>
          </Box>
        </Box>

        {/* ── FILTER BAR ─────────────────────────────────────────────────── */}
        <Box sx={{ display: 'flex', gap: 1, mb: 3, flexWrap: 'wrap' }}>
          <FilterChip label="STATUS" value="Any" />
          <FilterChip label="PRIORITY" value="Any" />
          <FilterChip label="ASSIGNEE" value="Anyone" />
          <FilterChip label="CREATED" value="Last 7d" active />
          <FilterChip label="DELIVERY" value="Today" />
        </Box>

        {/* ── BATCH TABLE ────────────────────────────────────────────────── */}
        <Box sx={{
          bgcolor: 'var(--surface)',
          border: '1px solid var(--rule)',
          borderRadius: '10px',
          overflow: 'hidden',
        }}>
          {/* Table header */}
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: '32px 100px 140px 80px 90px 120px 1fr 1fr 120px',
            px: 2, py: 1.25,
            bgcolor: 'var(--bg-2)',
            borderBottom: '1px solid var(--rule)',
          }}>
            {['', 'BATCH ID', 'ASSIGNEE', 'TOTE', 'CREATED', 'DELIVER BY', 'PICK PROGRESS', 'PACK PROGRESS', 'ACTION'].map((col) => (
              <Typography key={col} sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                {col}
              </Typography>
            ))}
          </Box>

          {/* Loading */}
          {isLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress size={24} />
            </Box>
          )}

          {/* Empty */}
          {!isLoading && batches.length === 0 && (
            <Box sx={{ px: 3, py: 6, textAlign: 'center' }}>
              <Typography sx={{ fontSize: 13, color: 'var(--ink-4)' }}>
                No active batches — release a batch from the order pool to get started.
              </Typography>
            </Box>
          )}

          {/* Batch rows */}
          {batches.map((batch, i) => (
            <BatchRow key={batch.pick_batch_id} batch={batch} index={i} />
          ))}
        </Box>

      </Box>
    </Box>
  );
}