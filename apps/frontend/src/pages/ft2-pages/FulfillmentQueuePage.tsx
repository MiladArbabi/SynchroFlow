// apps/frontend/src/pages/ft2-pages/FulfillmentQueuePage.tsx
//
// FULFILLMENT QUEUE — batch cards with dual progress bars
// Design: Orders / Fulfillment tab — each batch is a rich card (not a table row)
//
// RULES: No alpha(). No useTheme(). No fontFamily overrides. Picking=#FF6B2B, Packing=#5F6B85.
import { useState } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import { PlanGate } from '../../components/PlanGate';
import { ChevronRight, ChevronDown, Package } from 'lucide-react';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { usePickBatches, usePickBatchLineItems } from '../wms/usePickBatches';
import type { PickBatch, PickBatchLineItem } from '../wms/usePickBatches';

const batchDisplayId = (batch: PickBatch): string =>
  `#${batch.pick_batch_id.slice(0, 8).toUpperCase()}`;

const formatTime = (iso: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

const pct = (n: number, total: number): number =>
  total === 0 ? 0 : Math.min(100, Math.round((n / total) * 100));

// ─── FILTER CHIP ──────────────────────────────────────────────────────────────

function FilterChip({ label, value, active }: { label: string; value: string; active?: boolean }) {
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.625,
      px: 1.375, py: 0.625,
      borderRadius: '100px',
      bgcolor: active ? 'var(--accent-ghost)' : 'transparent',
      border: `1px solid ${active ? 'var(--accent-border)' : 'var(--rule)'}`,
      cursor: 'pointer',
      '&:hover': { borderColor: active ? 'var(--accent)' : 'var(--rule-2)' },
    }}>
      <Typography sx={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.10em' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 12, fontWeight: 600, color: active ? 'var(--accent)' : 'var(--ink)' }}>
        {value}
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
      <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
        {item.quantity}/{item.quantity}
      </Typography>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Package size={14} color="var(--ink-4)" />
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
          {item.title}
        </Typography>
      </Box>

      <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
        {item.sku ?? 'No SKU'}
      </Typography>

      <Box sx={{ display: 'inline-flex', alignItems: 'center', px: 1, py: 0.25, bgcolor: 'var(--bg-3)', border: '1px solid var(--rule)', borderRadius: '4px', width: 'fit-content' }}>
        <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)' }}>
          {item.location_code}
        </Typography>
      </Box>

      <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textAlign: 'right' }}>
        {item.quantity}/{item.quantity}
      </Typography>
    </Box>
  );
}

// ─── EXPANDED LINE ITEMS PANEL ────────────────────────────────────────────────

function BatchLineItemsPanel({ batchId }: { batchId: string }) {
  const { data, isLoading } = usePickBatchLineItems(batchId);

  return (
    <Box sx={{ borderTop: '1px solid var(--rule)', bgcolor: 'var(--bg-2)' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '48px 1fr 160px 100px 80px', px: 3, py: 1, borderBottom: '1px solid var(--rule)' }}>
        {['QTY', 'Item', 'Variant · SKU', 'Location', 'Picked'].map((col) => (
          <Typography key={col} sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
            {col}
          </Typography>
        ))}
      </Box>

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={20} sx={{ color: 'var(--accent)' }} />
        </Box>
      )}

      {data?.line_items.map((item) => (
        <LineItemRow key={item.lasyncro_line_item_id} item={item} />
      ))}

      {!isLoading && data?.line_items.length === 0 && (
        <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-4)', px: 3, py: 2 }}>
          All items picked — no remaining line items.
        </Typography>
      )}
    </Box>
  );
}

// ─── BATCH CARD ───────────────────────────────────────────────────────────────

function BatchCard({ batch }: { batch: PickBatch }) {
  const [expanded, setExpanded] = useState(false);
  const pickPct = pct(batch.units_picked, batch.total_units);
  const packPct = pct(batch.units_packed, batch.total_units);

  const initials = batch.picker_name
    ? batch.picker_name.split(' ').map(n => n[0]).slice(0, 2).join('')
    : '?';

  const isComplete =
    batch.units_picked === batch.total_units && batch.units_packed === batch.total_units;

  const statusText = isComplete
    ? 'All items picked and packed — ready to ship'
    : batch.units_picked < batch.total_units
    ? 'Picking in progress — packing starts when picks complete'
    : 'Packing in progress';

  return (
    <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden', mb: 2 }}>
      <Box sx={{ p: '20px 22px' }}>

        {/* Card header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.25 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            {batchDisplayId(batch)}
          </Typography>
          <Box sx={{ fontSize: 9.5, fontWeight: 500, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--ink-4)', bgcolor: 'var(--bg-2)', px: 1.125, py: 0.375, borderRadius: '100px', border: '1px solid var(--rule)' }}>
            Standard
          </Box>
          <Box sx={{ flex: 1 }} />
          <Box
            onClick={() => setExpanded(p => !p)}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: 'var(--ink-4)', '&:hover': { color: 'var(--ink-2)' } }}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'inherit' }}>
              {expanded ? 'Hide items' : 'Show items'}
            </Typography>
          </Box>
        </Box>

        {/* Meta row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, mb: 2.5, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: 'var(--bg-2)', border: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Typography sx={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-2)' }}>{initials}</Typography>
            </Box>
            <Typography sx={{ fontSize: 12.5, fontWeight: 500, color: batch.picker_name ? 'var(--ink-2)' : 'var(--ink-4)' }}>
              {batch.picker_name ?? 'Unassigned'}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.875 }}>
            <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Created</Typography>
            <Typography sx={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-2)' }}>{formatTime(batch.released_at)}</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.875 }}>
            <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Units</Typography>
            <Typography sx={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-2)' }}>{batch.total_units}</Typography>
          </Box>
        </Box>

        {/* Dual progress bars */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.875 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>Picking</Typography>
              <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
                {batch.units_picked}/{batch.total_units}
              </Typography>
            </Box>
            <Box sx={{ height: 7, borderRadius: '4px', bgcolor: 'var(--bg)', overflow: 'hidden' }}>
              <Box sx={{ width: `${pickPct}%`, height: '100%', bgcolor: '#FF6B2B', borderRadius: '4px', transition: 'width 0.3s ease' }} />
            </Box>
          </Box>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.875 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>Packing</Typography>
              <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
                {batch.units_packed}/{batch.total_units}
              </Typography>
            </Box>
            <Box sx={{ height: 7, borderRadius: '4px', bgcolor: 'var(--bg)', overflow: 'hidden' }}>
              <Box sx={{ width: `${packPct}%`, height: '100%', bgcolor: '#5F6B85', borderRadius: '4px', transition: 'width 0.3s ease' }} />
            </Box>
          </Box>
        </Box>

        {/* Card footer */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2.5, pt: 2, borderTop: '1px solid var(--rule)' }}>
          <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)', flex: 1 }}>
            {statusText}
          </Typography>
          <Box
            component="a"
            href={`/wms/batch/${batch.pick_batch_id}`}
            sx={{ fontSize: 12.5, fontWeight: 600, color: '#10151E', bgcolor: 'var(--accent)', borderRadius: '8px', px: 2.5, py: 1.125, cursor: 'pointer', textDecoration: 'none', flexShrink: 0, '&:hover': { opacity: 0.88 } }}
          >
            Continue →
          </Box>
        </Box>
      </Box>

      {/* Expandable line items */}
      {expanded && <BatchLineItemsPanel batchId={batch.pick_batch_id} />}
    </Box>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function FulfillmentQueuePage() {
  const { data, isLoading } = usePickBatches();
  const batches = data?.batches ?? [];

  const openCount    = batches.length;
  const pickingCount = batches.filter(b => b.status === 'picking').length;
  const readyCount   = batches.filter(b => b.status === 'pending').length;

  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%' }}>
      <ModuleTabBar tabs={ORDERS_MODULE_TABS} />

      <Box sx={{ p: '32px 40px' }}>

        {/* HEADER */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3 }}>
          <Box>
            <Typography sx={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }}>
              Fulfillment queue
            </Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
              {openCount} batch{openCount !== 1 ? 'es' : ''} open
              {readyCount > 0 && ` · ${readyCount} ready to pick`}
              {pickingCount > 0 && ` · ${pickingCount} in progress`}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
            <Box sx={{ px: 2, py: 1, border: '1px solid var(--rule)', borderRadius: '8px', cursor: 'pointer', '&:hover': { borderColor: 'var(--rule-2)' } }}>
              <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>View manifests</Typography>
            </Box>
            <PlanGate feature="wms.pick_batches" mode="locked">
              <Box sx={{ px: 2, py: 1, bgcolor: 'var(--accent)', borderRadius: '8px', cursor: 'pointer', '&:hover': { opacity: 0.9 } }}>
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#10151E' }}>Merge batches</Typography>
              </Box>
            </PlanGate>
          </Box>
        </Box>

        {/* FILTER BAR */}
        <Box sx={{ display: 'flex', gap: 1, mb: 3, flexWrap: 'wrap' }}>
          <FilterChip label="Status" value="Any" />
          <FilterChip label="Priority" value="Any" />
          <FilterChip label="Assignee" value="Anyone" />
          <FilterChip label="Created" value="Last 7d" active />
          <FilterChip label="Delivery" value="Today" />
        </Box>

        {/* LOADING */}
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress size={24} sx={{ color: 'var(--accent)' }} />
          </Box>
        )}

        {/* EMPTY */}
        {!isLoading && batches.length === 0 && (
          <Box sx={{ py: 8, textAlign: 'center', border: '1px solid var(--rule)', borderRadius: '14px', bgcolor: 'var(--surface)' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-4)', mb: 2 }}>
              No active batches — release a batch from the order pool to get started.
            </Typography>
            <PlanGate feature="wms.pick_batches" mode="locked">
              <Box
                component="a"
                href="/orders/pool"
                sx={{ display: 'inline-flex', alignItems: 'center', px: 2, py: 1, borderRadius: '8px', bgcolor: 'var(--accent)', color: '#10151E', fontSize: 13, fontWeight: 600, textDecoration: 'none', '&:hover': { opacity: 0.9 } }}
              >
                Go to Release Queue →
              </Box>
            </PlanGate>
          </Box>
        )}

        {/* BATCH CARDS */}
        {batches.map(batch => (
          <BatchCard key={batch.pick_batch_id} batch={batch} />
        ))}
      </Box>
    </Box>
  );
}
