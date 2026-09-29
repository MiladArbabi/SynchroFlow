// modules/products/src/ui/pages/ProductsModuleFT2.tsx
//
// INVENTORY MODULE — FT2 OPERATOR SURFACE
// Sprint 4 rebuild · May 2026
// ─────────────────────────────────────────────────────────────
// Layout (live Inventory Intelligence — mapContent supplied):
//   1. Header — title + static orientation copy + quiet Export utility
//   2. Body   — shared OperationalContextShell:
//                primary = supplied map surface (map, teaser or setup state)
//                rail    = Inventory state (status / orientation only)
//      The rail withdraws while the shared Ops Console is open; the caller
//      decides that via suppressInventoryState. Ops Console owns actionable
//      attention, so the rail carries no decisions, tasks or Console CTA.
//
// Legacy no-map body (Action queue · Inbound pipeline · Inventory pulse ·
// Return leakage) is retained only as the fallback when no mapContent is
// supplied.
//
// RULES:
// - No hardcoded hex. CSS variables or theme.palette.* only.
// - No inline style={}. MUI sx prop only.
// - No cross-module imports.
// - No fetching. All data via props.
// - fontWeight max 500. border 0.5px solid var(--rule).

import { useId } from 'react';
import type { ReactNode } from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { alpha } from '@mui/material/styles';
import { Warehouse, RefreshCw } from 'lucide-react';
import {
  formatCurrencyCompact,
  OperationalContextShell,
  PulseCard,
  type PulseCardRowData,
} from '@lasyncro/shared/ui';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';

// ─── PROPS ────────────────────────────────────────────────────

export interface ProductsModuleFT2DataProps {
  context: {
    period: { from: string; to: string };
    productsObserved: number | null;
    variantsObserved: number | null;
    productsWithSkuCount: number | null;
    productsWithoutSkuCount: number | null;
    statusCounts: { active: number | null; inactive: number | null; archived: number | null } | null;
  };
  operatorSummary?: {
    sellability: {
      sellable: number | null;
      blocked: number | null;
      blockedReasons: {
        noSku: number | null;
        noInventory: number | null;
        zeroStock: number | null;
        phantom: number | null;
      };
    };
    deadWeight: { noSalesCount: number | null };
    drift: { addedThisPeriod: number | null };
    topReturned: Array<{
      variantTitle: string | null;
      sku: string | null;
      unitsReturned: number;
      revenueLeakage: number;
      returnRatePct: number;
    }>;
    noSkuProducts: Array<{
      productTitle: string | null;
      variants: Array<{ variantTitle: string | null }>;
    }>;
    demand: {
      critical_reorder_count: number;
      warning_reorder_count: number;
      stockout_count: number;
      total_inventory_value: number;
      dead_capital_value: number;
      avg_days_of_stock: number | null;
      reorder_now: Array<{
        lasyncro_variant_id: string;
        sku: string | null;
        title: string | null;
        product_title: string | null;
        days_of_stock_remaining: number | null;
        estimated_stockout_date: string | null;
        velocity_per_day: number;
        suggested_reorder_qty: number | null;
      }>;
    } | null;
    inbound: {
      open_po_count: number;
      total_units_expected: number;
      total_committed_value_cents: number | null;
      overdue_pos: Array<{
        po_short_ref: string;
        supplier_name: string;
        status: string;
        expected_delivery_date: string | null;
        overdue_days: number | null;
        total_units_ordered: number;
        total_units_received: number;
        covers_stocked_out_skus: string[];
      }>;
      pending_pos: Array<{
        po_short_ref: string;
        supplier_name: string;
        status: string;
        expected_delivery_date: string | null;
        overdue_days: number | null;
        total_units_ordered: number;
        total_units_received: number;
        covers_stocked_out_skus: string[];
      }>;
    } | null;
    warehouse: {
      total_pick_bins: number;
      stocked_pick_bins: number;
      pick_zone_occupancy_pct: number | null;
      variants_with_stock_no_bin: number;
    } | null;
    finances: {
      total_margin_at_risk_per_week: number;
      active_sellers_no_cost: number;
      stocked_out_margin_variants: Array<{
        lasyncro_variant_id: string;
        sku: string | null;
        avg_sale_price: number;
        unit_cost: number;
        margin_per_unit: number;
        margin_pct: number;
        units_sold_30d: number;
        margin_lost_per_week: number;
      }>;
    } | null;
  } | null;
  // Legacy FT2 snapshot fields — retained for data trust bar
  dataFreshness: {
    structural: 'fresh' | 'stale' | 'unknown' | null;
    inventory: 'fresh' | 'stale' | 'unknown' | null;
    sales: 'fresh' | 'stale' | 'unknown' | null;
    fulfillment: 'fresh' | 'stale' | 'unknown' | null;
    cost: 'fresh' | 'stale' | 'unknown' | null;
  } | null;
  outcome: { status: 'positive' | 'negative' | 'unknown' } | null;
  operationalCounts: {
    productsWithInventoryCount: number | null;
    productsWithoutInventoryCount: number | null;
    skusWithSalesCount: number | null;
    totalSkusObserved: number | null;
  } | null;
  // Unused legacy fields — kept for prop-compat, not rendered
  /**
   * Module-level export CTA (EXP-CTA-INVENTORY-99).
   * Handler is owned by the app shell because ExportDrawer lives in
   * apps/frontend and modules/products' tsconfig rootDir forbids the
   * import — see modules-ux-playbook §14 module boundary.
   */
  onExport?: () => void | Promise<void>;

  /**
   * INV-UX-01 2B — live map surface supplied by the app shell.
   *
   * The module never decides map eligibility or acquires floor data; it only
   * leases the primary slot. When present, the canonical live-intelligence
   * layout renders (map + Inventory state rail). When absent, the legacy
   * layout is preserved so existing consumers keep working.
   */
  mapContent?: ReactNode;

  /**
   * Inventory state rail facts. null (or an absent object) means
   * unknown / unavailable and renders as an em dash — never as 0.
   */
  inventoryState?: InventoryStateFacts | null;

  /**
   * Withdraws the Inventory state rail while the map stays mounted. The app
   * shell passes its shared Ops Console state; the module reads none itself.
   */
  suppressInventoryState?: boolean;

  /**
   * Data status of the Inventory state rail, separate from the fact values.
   * 'loading' → busy, no value shown as 0; 'error' → "Inventory state
   * unavailable"; 'ready' (default) → the facts. Callers own the source.
   */
  inventoryStateStatus?: InventoryStateStatus;

  /** Scoped technical retry for the Inventory state source (not an action queue). */
  onRetryInventoryState?: () => void;

  trend?: unknown;
  signals?: unknown;
  productDataIntegrity?: unknown;
  operational?: unknown;
  supply?: unknown;
  alignment?: unknown;
  dependency?: unknown;
  supplyCounts?: unknown;
  currency?: CurrencyContext;
}

export type ProductsModuleFT2Props = ProductsModuleFT2DataProps;

/**
 * Inventory state rail facts. Unit quantities (onHand / available / reserved)
 * and SKU counts are kept distinct; every field is nullable and null means
 * unknown / unavailable, never zero.
 */
export interface InventoryStateFacts {
  onHandUnits: number | null;
  availableUnits: number | null;
  reservedUnits: number | null;
  notReceivedCount: number | null;
  phantomCount: number | null;
  noValidPickLocationCount: number | null;
  /**
   * true  — canonical inventory truth exists (a 0 trio is a confirmed physical zero)
   * false — no canonical truth yet (a 0 trio is not a physical fact)
   * null  — unknown
   */
  hasInventoryTruth: boolean | null;
}

export type InventoryStateStatus = 'loading' | 'ready' | 'error';

// ─── HELPERS ──────────────────────────────────────────────────
const fmtN = (n: number | null | undefined): string =>
  n == null ? '—' : Math.round(n).toLocaleString();

// ─── STAT CARD ────────────────────────────────────────────────
// Matches Orders FT2 StatCard exactly.
function StatCard({ label, value, valueColor, sub, cta, ctaHref }: {
  label: string;
  value: string;
  valueColor?: string;
  sub?: string;
  cta?: string;
  ctaHref?: string;
}) {
  const navigate = useNavigate();
  return (
    <Box sx={{
      bgcolor: 'var(--surface)',
      border: '0.5px solid var(--rule)',
      borderRadius: '8px',
      p: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 0.5,
      flex: 1,
      minWidth: 0,
    }}>
      <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: value.length > 6 ? 20 : 24, fontWeight: 500, color: valueColor ?? 'var(--ink)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
      {sub && (
        <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.25 }}>
          {sub}
        </Typography>
      )}
      {cta && ctaHref && (
        <Box
          onClick={() => navigate(ctaHref)}
          sx={{ display: 'inline-flex', alignItems: 'center', px: 1, py: 0.375, fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', mt: 0.5, cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
        >
          {cta} →
        </Box>
      )}
    </Box>
  );
}

// ─── SECTION HEADER ───────────────────────────────────────────

function SectionHeader({ label, meta }: { label: string; meta?: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
      <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
        {label}
      </Typography>
      {meta && (
        <Typography sx={{ fontSize: 10, color: 'var(--ink-4)' }}>
          {meta}
        </Typography>
      )}
    </Box>
  );
}

// ─── ACTION ROW ───────────────────────────────────────────────

type ActionRowProps = {
  dot: 'critical' | 'warning' | 'optimize';
  label: string;
  meta?: string;
  impact?: string;
  cta: string;
  ctaHref: string;
};

// Repeated operational row actions share one width for a stable right edge.
// Header and section-level CTAs intentionally remain content-sized.
const ROW_ACTION_CTA_WIDTH = 120;

function ActionRow({ dot, label, meta, impact, cta, ctaHref }: ActionRowProps) {
  const theme = useTheme();
  const navigate = useNavigate();

  const dotColor =
    dot === 'critical' ? theme.palette.error.main :
    dot === 'warning'  ? theme.palette.warning.main :
                         'var(--ink-4)';

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      px: 2, py: 1.25,
      borderBottom: '0.5px solid var(--rule)',
      '&:last-child': { borderBottom: 'none' },
      '&:hover': { bgcolor: dot === 'optimize' ? 'action.hover' : alpha(dotColor, 0.04) },
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: dotColor, flexShrink: 0 }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
            {label}
          </Typography>
          {meta && (
            <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.125 }}>
              {meta}
            </Typography>
          )}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, ml: 2 }}>
        {impact && (
          <Typography sx={{ fontSize: 12, fontWeight: 500, color: dot === 'critical' ? theme.palette.error.main : dot === 'warning' ? theme.palette.warning.main : 'var(--ink-4)', fontVariantNumeric: 'tabular-nums' }}>
            {impact}
          </Typography>
        )}
        {/* Filled row action — width is shared across operational lists. */}
        <Box
          onClick={() => navigate(ctaHref)}
          sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: ROW_ACTION_CTA_WIDTH, boxSizing: 'border-box', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 600, bgcolor: 'var(--accent)', color: theme.palette.common.white, borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, '&:hover': { opacity: 0.88 } }}
        >
          {cta} →
        </Box>
      </Box>
    </Box>
  );
}

// ─── INBOUND ROW ──────────────────────────────────────────────

function InboundRow({ po, isOverdue }: {
  po: {
    po_short_ref: string;
    supplier_name: string;
    status: string;
    expected_delivery_date: string | null;
    overdue_days: number | null;
    total_units_ordered: number;
    total_units_received: number;
    covers_stocked_out_skus: string[];
  };
  isOverdue: boolean;
}) {
  const theme = useTheme();
  const navigate = useNavigate();

  const dateLabel = po.expected_delivery_date
    ? new Date(po.expected_delivery_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : '—';

  const statusLabel = po.status.replace(/_/g, ' ');

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      px: 2, py: 1.25,
      borderBottom: '0.5px solid var(--rule)',
      '&:last-child': { borderBottom: 'none' },
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box>
          <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
            {po.supplier_name}
          </Typography>
          <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'monospace' }}>
            {po.po_short_ref} · {statusLabel}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ textAlign: 'right' }}>
          <Typography sx={{ fontSize: 12, fontWeight: 500, color: isOverdue ? theme.palette.error.main : 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
            {isOverdue ? `${po.overdue_days}d overdue` : `Due ${dateLabel}`}
          </Typography>
          <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
            {po.total_units_ordered} units
            {po.covers_stocked_out_skus.length > 0 && ` · covers ${po.covers_stocked_out_skus.length} stocked out`}
          </Typography>
        </Box>
        {isOverdue && (
          <Box
            onClick={() => navigate('/orders/inbound')}
            sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: ROW_ACTION_CTA_WIDTH, boxSizing: 'border-box', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 600, bgcolor: 'var(--accent)', color: theme.palette.common.white, borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, '&:hover': { opacity: 0.88 } }}
          >
            Chase →
          </Box>
        )}
        {!isOverdue && po.status === 'shipped' && (
          <Box
            onClick={() => navigate('/orders/inbound')}
            sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: ROW_ACTION_CTA_WIDTH, boxSizing: 'border-box', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 600, bgcolor: 'var(--accent)', color: theme.palette.common.white, borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, '&:hover': { opacity: 0.88 } }}
          >
            Receive →
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ─── INVENTORY STATE RAIL ─────────────────────────────────────
// Status / orientation only: permanent physical-state labels with their
// current value. No tasks, no remediation, no Console entry point — Ops
// Console owns actionable attention. Unknown values render as an em dash.

const INVENTORY_STATE_ROWS: Array<{
  key: keyof InventoryStateFacts;
  label: string;
  unit: 'units' | 'SKUs';
}> = [
  { key: 'onHandUnits',              label: 'On hand',                unit: 'units' },
  { key: 'availableUnits',           label: 'Available',              unit: 'units' },
  { key: 'reservedUnits',            label: 'Reserved',               unit: 'units' },
  { key: 'notReceivedCount',         label: 'Not received',           unit: 'SKUs' },
  { key: 'phantomCount',             label: 'Phantom',                unit: 'SKUs' },
  { key: 'noValidPickLocationCount', label: 'No valid pick location', unit: 'SKUs' },
];

const QUANTITY_KEYS: ReadonlySet<keyof InventoryStateFacts> = new Set([
  'onHandUnits', 'availableUnits', 'reservedUnits',
]);

function InventoryStateRail({
  facts,
  status,
  onRetry,
}: {
  facts: InventoryStateFacts | null | undefined;
  status: InventoryStateStatus;
  onRetry?: () => void;
}) {
  const headingId = useId();

  const isLoading = status === 'loading';
  const isError = status === 'error';
  const isReady = status === 'ready';
  // No canonical truth: a 0 quantity trio is not a physical fact.
  const truthNotEstablished = isReady && facts?.hasInventoryTruth === false;
  // Canonical truth exists and every physical quantity is zero.
  const physicallyEmpty =
    isReady &&
    facts?.hasInventoryTruth === true &&
    facts.onHandUnits === 0 &&
    facts.availableUnits === 0 &&
    facts.reservedUnits === 0;

  const notice =
    isError ? 'Inventory state unavailable'
    : truthNotEstablished ? 'Inventory truth not established'
    : physicallyEmpty ? 'Physically empty'
    : null;

  const displayValue = (key: keyof InventoryStateFacts): number | null => {
    if (isLoading) return null;
    if (truthNotEstablished && QUANTITY_KEYS.has(key)) return null;
    const value = facts?.[key];
    return typeof value === 'number' ? value : null;
  };

  return (
    <Box
      component="section"
      aria-labelledby={headingId}
      aria-busy={isLoading ? 'true' : undefined}
      sx={{ bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '10px', overflow: 'hidden' }}
    >
      <Box sx={{ px: 1.75, py: 1.25, borderBottom: '0.5px solid var(--rule)' }}>
        <Typography
          id={headingId}
          component="h2"
          sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}
        >
          Inventory state
        </Typography>
      </Box>

      {notice && (
        <Box
          sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5,
            px: 1.75, py: 1, borderBottom: '0.5px solid var(--rule)',
          }}
        >
          <Typography sx={{ fontSize: 12, color: isError ? 'var(--ink-2)' : 'var(--ink-3)' }}>
            {notice}
          </Typography>
          {isError && onRetry && (
            <Box
              component="button"
              type="button"
              onClick={onRetry}
              sx={{
                fontSize: 11.5, fontWeight: 500, fontFamily: 'inherit', color: 'var(--accent)',
                bgcolor: 'transparent', border: '0.5px solid var(--accent-border)', borderRadius: '6px',
                px: '10px', py: '4px', cursor: 'pointer', '&:hover': { opacity: 0.75 },
              }}
            >
              Retry
            </Box>
          )}
        </Box>
      )}

      {INVENTORY_STATE_ROWS.map(row => {
        const value = displayValue(row.key);
        return (
          <Box
            key={row.key}
            sx={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1.5,
              px: 1.75, py: 1.125,
              borderBottom: '0.5px solid var(--rule)',
              '&:last-of-type': { borderBottom: 'none' },
            }}
          >
            <Typography sx={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
              {row.label}
            </Typography>
            <Typography sx={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {fmtN(value)}
              {value != null && (
                <Box component="span" sx={{ ml: 0.5, fontSize: 11, fontWeight: 400, color: 'var(--ink-4)' }}>
                  {row.unit}
                </Box>
              )}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────

export default function ProductsModuleFT2(props: ProductsModuleFT2Props) {
  const theme = useTheme();
  const navigate = useNavigate();
  const {
    operatorSummary, dataFreshness, currency, onExport, mapContent,
    inventoryState, suppressInventoryState = false,
    inventoryStateStatus = 'ready', onRetryInventoryState,
  } = props;

  const fmt$ = (n: number | null | undefined): string =>
    formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);

  const os = operatorSummary;
  const sellable  = os?.sellability.sellable ?? 0;
  const blocked   = os?.sellability.blocked ?? 0;
  const total     = sellable + blocked;
  const noSku     = os?.sellability.blockedReasons.noSku ?? 0;
  const zeroStock = os?.sellability.blockedReasons.zeroStock ?? 0;
  const phantom   = os?.sellability.blockedReasons.phantom ?? 0;

  // PULSE-02A: PulseCard owns severity ordering and token colors.
  // This page only maps authoritative inventory facts to their operational tone.
  const inventoryPulseRows: PulseCardRowData[] = [
    {
      id: 'ready-to-sell',
      label: 'Ready to sell',
      value: `${fmtN(sellable)} of ${fmtN(total)}`,
      tone: sellable === 0 ? 'critical' : sellable < total ? 'warning' : 'good',
    },
    {
      id: 'margin-at-risk',
      label: 'Margin at risk',
      value: os?.finances
        ? `${fmt$(os.finances.total_margin_at_risk_per_week)}/wk`
        : '—',
      tone: os?.finances && os.finances.total_margin_at_risk_per_week > 0
        ? 'critical'
        : 'neutral',
    },
    {
      id: 'phantom',
      label: 'Phantom',
      value: String(phantom),
      tone: phantom > 0 ? 'critical' : 'neutral',
      subtext: 'sold without recorded receiving',
    },
    {
      id: 'stocked-out',
      label: 'Stocked out',
      value: String(zeroStock),
      tone: zeroStock > 0 ? 'warning' : 'neutral',
    },
    {
      id: 'inbound',
      label: 'Inbound',
      value: os?.inbound ? `${fmtN(os.inbound.total_units_expected)} units` : '—',
      tone: 'neutral',
      subtext: os?.inbound
        ? `${os.inbound.open_po_count} open PO${os.inbound.open_po_count === 1 ? '' : 's'}`
        : undefined,
    },
    {
      id: 'dead-capital',
      label: 'Dead capital',
      value: os?.demand ? fmt$(os.demand.dead_capital_value) : '—',
      tone: os?.demand && os.demand.dead_capital_value > 0
        ? 'warning'
        : 'neutral',
    },
  ];

  return (
    <Box sx={{ p: '24px 40px', minHeight: '100%', bgcolor: 'var(--bg)' }}>

      {/* ── 1. HEADER ─────────────────────────────────────────── */}
      {/* EXP-CTA-INVENTORY-99: title column + action row.
          Breakpoint-based wrap per modules-ux-playbook §18 — flat
          flexWrap:'wrap' squeezes the title before the action wraps. */}
      <Box sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'flex-start', sm: 'flex-start' },
        justifyContent: 'space-between',
        gap: 1.5,
        mb: 2.5,
      }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }}>
          Inventory
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
          Physical stock, availability and inventory truth by location
        </Typography>
      </Box>
        {/* Tier 2 ghost pill per modules-ux-playbook §2 and
            export_system_playbook §6 — opens a drawer, commits nothing. */}
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5, flexShrink: 0 }}>
          {onExport && (
            <Box
              onClick={onExport}
              sx={{ display: 'inline-flex', alignItems: 'center', px: '12px', py: '6px', fontSize: 12, fontWeight: 500, color: 'var(--accent)', border: '0.5px solid var(--accent-border)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
            >
              Export →
            </Box>
          )}
        </Box>
      </Box>

      {/* ── DATA TRUST BAR ────────────────────────────────────── */}
      {dataFreshness && Object.values(dataFreshness).some(v => v === 'stale') && (
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1.5,
          px: 2, py: 1, mb: 2.5,
          bgcolor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.12 : 0.06),
          border: `0.5px solid ${alpha(theme.palette.warning.main, 0.3)}`,
          borderRadius: '8px',
        }}>
          <RefreshCw size={12} color={theme.palette.warning.main} />
          <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
            Some data may be stale —{' '}
            {(['structural','inventory','sales','fulfillment','cost'] as const)
              .filter(k => dataFreshness[k] === 'stale')
              .join(', ')}{' '}
            data needs a sync.
          </Typography>
        </Box>
      )}

      {/* ── 4A. LIVE INTELLIGENCE BODY ───────────────────────── */}
      {/* Shared OperationalContextShell owns the primary + rail composition.
          Suppression withdraws only the rail content, so the supplied map
          surface is never remounted when the Ops Console opens or closes. */}
      {mapContent ? (
        <OperationalContextShell
          primary={
            <Box sx={{ height: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              {mapContent}
            </Box>
          }
          rail={
            <InventoryStateRail
              facts={inventoryState}
              status={inventoryStateStatus}
              onRetry={onRetryInventoryState}
            />
          }
          suppressRail={suppressInventoryState}
        />
      ) : (
      /* ── 4B. LEGACY TWO COLUMN BODY ─────────────────────────
         Preserved verbatim as the fallback when no map surface is supplied,
         so existing consumers of this module keep their current layout.
         LEFT: Action queue | RIGHT: Inbound pipeline + Return leakage */
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', lg: 'row' },
          flexWrap: { xs: 'nowrap', lg: 'wrap' },
          gap: 2.25,
          alignItems: 'stretch',
        }}
      >

        {/* ── LEFT COLUMN — Action queue ──────────────────────── */}
        {os && (
          <Box
            sx={{
              flex: { xs: '1 1 auto', lg: '1 1 0' },
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >

            {/* Warehouse banner — inside left column above action queue */}
            {os?.warehouse && os.warehouse.variants_with_stock_no_bin > 0 && (
              <Box sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                px: 2, py: 1.5,
                border: `0.5px solid ${alpha(theme.palette.warning.main, 0.35)}`,
                bgcolor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.08 : 0.04),
                borderRadius: '10px',
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Warehouse size={14} color={theme.palette.warning.main} />
                  <Box>
                    <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                      {os.warehouse.variants_with_stock_no_bin} SKUs have stock but no pick bin assigned
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
                      {os.warehouse.pick_zone_occupancy_pct ?? 0}% occupancy · {os.warehouse.stocked_pick_bins} of {os.warehouse.total_pick_bins} bins stocked · stow before next pick run
                    </Typography>
                  </Box>
                </Box>
                <Box
                  onClick={() => navigate('/wms/readiness')}
                  sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', ml: 2, '&:hover': { opacity: 0.75 } }}
                >
                  {/* ISS-084/DEC-02: was "Fix in WMS" — module renamed to Warehouse */}
                  Fix in Warehouse →
                </Box>
              </Box>
            )}
            <Box sx={{ bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '10px', overflow: 'hidden', flex: 1 }}>
              <Box sx={{ px: 2, py: 1.25, borderBottom: '0.5px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                  Action queue
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  {os.demand && (os.demand.critical_reorder_count > 0 || os.demand.warning_reorder_count > 0) && (
                    <Typography sx={{ fontSize: 10, color: theme.palette.error.main, fontWeight: 500 }}>
                      {os.demand.critical_reorder_count} critical · {os.demand.warning_reorder_count} warning
                    </Typography>
                  )}
                  <Box
                    onClick={() => navigate('/demand')}
                    sx={{ display: 'inline-flex', alignItems: 'center', px: 1, py: 0.375, fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
                  >
                    See all in Demand →
                  </Box>
                </Box>
              </Box>

              {/* Priority 1: stocked out with no covering PO */}
              {os.demand?.reorder_now
                .filter(v => {
                  const coveredByPO = os.inbound
                    ? [...os.inbound.overdue_pos, ...os.inbound.pending_pos].some(po =>
                        po.covers_stocked_out_skus.includes(v.lasyncro_variant_id)
                      )
                    : false;
                  return v.days_of_stock_remaining === 0 && !coveredByPO;
                })
                .slice(0, 4)
                .map(v => {
                  const fin = os.finances?.stocked_out_margin_variants.find(f => f.lasyncro_variant_id === v.lasyncro_variant_id);
                  return (
                    <ActionRow
                      key={v.lasyncro_variant_id}
                      dot="critical"
                      label={v.product_title ?? v.title ?? v.sku ?? 'Unknown product'}
                      meta={`Stocked out · no inbound PO · ${v.velocity_per_day.toFixed(2)} units/day`}
                      impact={fin ? `${fmt$(fin.margin_lost_per_week)}/wk lost` : undefined}
                      cta="Order"
                      ctaHref="/suppliers"
                    />
                  );
                })}

              {/* Priority 2: stocked out with overdue PO */}
              {os.inbound?.overdue_pos
                .filter(po => po.covers_stocked_out_skus.length > 0)
                .map(po => (
                  <ActionRow
                    key={po.po_short_ref}
                    dot="critical"
                    label={`${po.supplier_name} PO ${po.po_short_ref}`}
                    meta={`${po.overdue_days}d overdue · covers ${po.covers_stocked_out_skus.length} stocked-out SKU${po.covers_stocked_out_skus.length > 1 ? 's' : ''}`}
                    impact={po.overdue_days != null && po.overdue_days > 0 ? `${po.overdue_days}d late` : undefined}
                    cta="Chase"
                    ctaHref="/orders/inbound"
                  />
                ))}

              {/* Priority 3: no SKU */}
              {noSku > 0 && (
                <ActionRow
                  dot="warning"
                  label={`${noSku} SKUs have no product code`}
                  meta="WMS-Lite can't pick or receive these — fix in Shopify"
                  cta="Fix in Catalog"
                  ctaHref="/inventory/catalog"
                />
              )}

              {/* Priority 4: critically low stock */}
              {os.demand && os.demand.critical_reorder_count - os.demand.stockout_count > 0 && (
                <ActionRow
                  dot="warning"
                  label={`${os.demand.critical_reorder_count - os.demand.stockout_count} SKUs under 7 days stock`}
                  meta="Order before they run out"
                  cta="See Demand"
                  ctaHref="/demand"
                />
              )}

              {/* Priority 5: dead capital */}
              {os.demand && os.demand.dead_capital_value > 0 && (
                <ActionRow
                  dot="optimize"
                  label={`${fmt$(os.demand.dead_capital_value)} in non-moving stock`}
                  meta="Active SKUs with stock but zero velocity"
                  cta="Review"
                  ctaHref="/demand"
                />
              )}

              {/* Priority 6: unrestocked returns */}
              {os.topReturned.length > 0 && (
                <ActionRow
                  dot="optimize"
                  label={`${os.topReturned.length} returned product${os.topReturned.length > 1 ? 's' : ''} not restocked`}
                  meta="Every unrestocked return is double-lost — revenue refunded and inventory not recovered"
                  cta="Fix in Returns"
                  ctaHref="/returns"
                />
              )}
            </Box>

            {/* PULSE-02A: Inbound is actionable work, so it stays in the
                main column rather than the fixed 300px summary rail. */}
            {/* Inbound pipeline */}
            {os?.inbound && os.inbound.open_po_count > 0 && (
              <Box sx={{ bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '10px', overflow: 'hidden' }}>
                <Box sx={{ px: 2, py: 1.25, borderBottom: '0.5px solid var(--rule)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                    Inbound pipeline
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    {os.inbound.total_committed_value_cents != null && (
                      <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
                        {fmt$(os.inbound.total_committed_value_cents / 100)}committed
                      </Typography>
                    )}
                    {/* ISS-054/ISS-105: Cash Flow CTA removed — Finances/Cashflow module
                        deliberately unwired from nav (2026-07-08). No route path exists
                        to reach here; restore this button if/when Finances scope returns. */}
                  </Box>
                </Box>
                {os.inbound.overdue_pos.map(po => (
                  <InboundRow key={po.po_short_ref} po={po} isOverdue={true} />
                ))}
                {os.inbound.pending_pos.map(po => (
                  <InboundRow key={po.po_short_ref} po={po} isOverdue={false} />
                ))}
              </Box>
            )}
          </Box>
        )}

        {/* ── RIGHT COLUMN — Inventory pulse + Return leakage ─── */}
        <Box
          sx={{
            flex: { xs: '1 0 300px', lg: '0 0 300px' },
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {/* Inventory pulse */}
          {os && (
            <PulseCard
              title="Inventory pulse"
              rows={inventoryPulseRows}
            />
          )}

          {/* Return leakage */}
          {os?.topReturned && os.topReturned.length > 0 && (() => {
            const maxRate = Math.max(...os.topReturned.map(r => r.returnRatePct));
            const totalLeakage = os.topReturned.reduce((s, r) => s + r.revenueLeakage, 0);
            return (
              <Box sx={{ bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '10px', overflow: 'hidden' }}>
                <Box sx={{ px: 2, py: 1.25, borderBottom: '0.5px solid var(--rule)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                    Return leakage
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: theme.palette.error.main, fontWeight: 500 }}>
                    {fmt$(totalLeakage)} lost · 0% restocked
                  </Typography>
                </Box>
                {os.topReturned.map((item, idx) => {
                  const barPct = maxRate > 0 ? (item.returnRatePct / maxRate) * 100 : 0;
                  const rateColor = item.returnRatePct >= 20 ? theme.palette.error.main
                    : item.returnRatePct >= 10 ? theme.palette.warning.main
                    : theme.palette.success.main;
                  return (
                    <Box
                      key={idx}
                      sx={{
                        px: 2, py: 1.5,
                        borderBottom: '0.5px solid var(--rule)',
                        '&:last-child': { borderBottom: 'none' },
                      }}
                    >
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.75 }}>
                        <Box>
                          <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                            {item.variantTitle && item.variantTitle !== 'Default Title' ? item.variantTitle : item.sku ?? `Item ${idx + 1}`}
                          </Typography>
                          {item.sku && (
                            <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'monospace' }}>
                              {item.sku}
                            </Typography>
                          )}
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Typography sx={{ fontSize: 12, color: 'var(--ink-4)' }}>
                            {item.unitsReturned} returned
                          </Typography>
                          <Typography sx={{ fontSize: 12, fontWeight: 500, color: theme.palette.error.main }}>
                            {fmt$(item.revenueLeakage)} lost
                          </Typography>
                           <Box
                            onClick={() => navigate('/returns')}
                            sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: ROW_ACTION_CTA_WIDTH, boxSizing: 'border-box', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 600, bgcolor: 'var(--accent)', color: theme.palette.common.white, borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, '&:hover': { opacity: 0.88 } }}
                          >
                            Restock →
                          </Box>
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Box sx={{ flex: 1, height: 4, borderRadius: 1, bgcolor: 'var(--bg)', overflow: 'hidden' }}>
                          <Box sx={{ height: '100%', width: `${barPct}%`, bgcolor: rateColor, borderRadius: 1, transition: 'width 0.3s ease' }} />
                        </Box>
                        <Typography sx={{ fontSize: 11, fontWeight: 500, color: rateColor, minWidth: 70, textAlign: 'right' }}>
                          {item.returnRatePct}% returned
                        </Typography>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            );
          })()}

        </Box>{/* end RIGHT COLUMN */}
      </Box>
      /* end 4B legacy two column body */
      )}

    </Box>
  );
}