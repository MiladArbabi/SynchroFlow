// modules/demand/src/ui/pages/DemandModuleFT2.tsx
import { useState } from 'react';
import {
  Box, Typography, Collapse,
  useTheme,
} from '@mui/material';
import {
  TrendingDown, TrendingUp, Package,
  CheckCircle, ChevronDown, Minus,
} from 'lucide-react';
import {
  formatCurrencyCompact,
  ModuleLoadingSkeleton,
} from '@lasyncro/shared/ui';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';
import { ModuleErrorBoundary } from '@lasyncro/shared/ui';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
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
  velocity_trend: 'up' | 'down' | 'stable';
  days_of_stock_remaining: number | null;
  reorder_signal: boolean;
  reorder_urgency: 'critical' | 'warning' | 'healthy' | 'overstocked' | 'no_velocity';
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
  /**
   * Demand owns reorder risk and replenishment decisions.
   * Warehouse occupancy belongs to Floor Planning/WMS.
   */
};

// ─────────────────────────────────────────────
// STYLE TOKENS
// ─────────────────────────────────────────────
// Demand inherits FT2 app tokens. Do not reintroduce local hex palettes here.
const demandPalette = {
  cardBg: 'var(--surface)',
  border: 'var(--rule)',
  rowHover: 'var(--bg-2)',
  textPrimary: 'var(--ink)',
  textSecond: 'var(--ink-3)',
  tileBg: 'var(--bg-2)',
} as const;

type DemandPalette = typeof demandPalette;

// ─────────────────────────────────────────────
// VELOCITY TREND BADGE
// ─────────────────────────────────────────────
function TrendBadge({ trend, prev, current }: { trend: 'up' | 'down' | 'stable'; prev: number; current: number }) {
  const theme = useTheme();
  if (trend === 'stable' || prev === 0) return <Minus size={12} color={theme.palette.text.secondary as string} />;

  const pct = prev > 0 ? Math.round(Math.abs((current - prev) / prev) * 100) : 0;
  const isUp = trend === 'up';

  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
      {isUp
        ? <TrendingUp size={12} color={theme.palette.success.main} />
        : <TrendingDown size={12} color={theme.palette.error.main} />
      }
      <Typography sx={{ fontSize: 10, fontWeight: 600, color: isUp ? 'success.main' : 'error.main' }}>
        {pct}%
      </Typography>
    </Box>
  );
}

// ─────────────────────────────────────────────
// CREATE PO HANDOFF
// ─────────────────────────────────────────────
function OrderCTA({ variant }: { variant: DemandVelocity }) {
  const params = new URLSearchParams();
  params.set('action', 'create-po');
  if (variant.lasyncro_variant_id) params.set('variantId', variant.lasyncro_variant_id);
  if (variant.sku) params.set('sku', variant.sku);
  if (variant.suggested_reorder_qty) params.set('qty', String(variant.suggested_reorder_qty));
  if (variant.title) params.set('description', variant.title);

  const href = `/suppliers-portal?${params.toString()}`;

  return (
    <Box
      component="a"
      href={href}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: '10px',
        py: '5px',
        borderRadius: '999px',
        bgcolor: 'var(--accent)',
        color: 'var(--surface)',
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        '&:hover': { opacity: 0.88 },
      }}
    >
      Create PO →
    </Box>
  );
}

// ─────────────────────────────────────────────
// VARIANT ROW
// ─────────────────────────────────────────────
function VariantRow({ variant, currency, pal }: {
  variant: DemandVelocity;
  currency?: CurrencyContext;
  pal: DemandPalette;
}) {
  const theme = useTheme();
  const isCritical = variant.reorder_urgency === 'critical';
  const isWarning = variant.reorder_urgency === 'warning';

  const accentColor = isCritical
    ? theme.palette.error.main
    : isWarning
    ? theme.palette.warning.main
    : theme.palette.text.secondary;

  const stockoutLabel = variant.estimated_stockout_date
    ? new Date(variant.estimated_stockout_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;

  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: '2fr 80px 80px 80px 100px 120px',
      px: 2, py: 1.25,
      borderBottom: `1px solid ${pal.border}`,
      alignItems: 'center',
      gap: 1,
      borderLeft: `3px solid ${isCritical ? theme.palette.error.main : isWarning ? theme.palette.warning.main : 'transparent'}`,
      '&:hover': { background: pal.rowHover },
    }}>
      {/* Product */}
      <Box>
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: pal.textPrimary, lineHeight: 1.3 }}>
          {/* ISS-229: prefer product_title; fall back to title only if meaningfully different */}
          {variant.product_title ?? variant.title ?? 'Unknown product'}
        </Typography>
        <Typography sx={{ fontSize: 10, color: pal.textSecond }}>
          {variant.sku
            ? variant.sku
            : <span style={{ color: 'var(--ink-4)' }}>No SKU</span>}
        </Typography>
      </Box>

      {/* In stock */}
      <Typography sx={{ fontSize: 13, color: variant.available_quantity <= 0 ? 'error.main' : pal.textPrimary }}>
        {variant.available_quantity}
      </Typography>

      {/* Sold 30d + trend */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography sx={{ fontSize: 13, color: pal.textPrimary }}>{variant.units_sold_30d}</Typography>
        <TrendBadge trend={variant.velocity_trend} prev={variant.units_sold_prev_30d} current={variant.units_sold_30d} />
      </Box>

      {/* Days left */}
      <Typography sx={{ fontSize: 13, fontWeight: isCritical || isWarning ? 600 : 400, color: accentColor }}>
        {variant.days_of_stock_remaining != null ? `${variant.days_of_stock_remaining}d` : '—'}
        {stockoutLabel && isCritical && (
          <Typography component="span" sx={{ fontSize: 10, color: 'error.main', display: 'block' }}>
            ~{stockoutLabel}
          </Typography>
        )}
      </Typography>

            {/* Plain status badge keeps dense demand rows aligned with FT2 row styling. */}
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          width: 'fit-content',
          px: '7px',
          py: '4px',
          borderRadius: '999px',
          bgcolor: 'var(--bg-2)',
          border: '1px solid var(--rule)',
        }}
      >
        <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: accentColor }} />
        <Typography sx={{ fontSize: 10, fontWeight: 600, color: accentColor, lineHeight: 1 }}>
          {isCritical
            ? 'Critical'
            : isWarning
            ? 'Reorder soon'
            : variant.reorder_urgency === 'overstocked'
            ? 'Excess stock'
            : variant.reorder_urgency === 'no_velocity'
            ? 'No recent sales'
            : 'Healthy'}
        </Typography>
      </Box>

      {/* CTA */}
      {(isCritical || isWarning) ? (
        <OrderCTA variant={variant} />
      ) : (
        <Box />
      )}
    </Box>
  );
}

// ─────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────
function DemandModuleFT2Inner({
  data,
  isLoading,
  isError,
  currency,
}: DemandModuleFT2Props) {
  const theme = useTheme();
  const pal = demandPalette;
  const [showRest, setShowRest] = useState(false);

  const summary = data?.summary;
  const allVariants = data?.variants ?? [];
  const actionVariants = allVariants.filter(v => v.reorder_urgency === 'critical' || v.reorder_urgency === 'warning');
  const restVariants = allVariants.filter(v => v.reorder_urgency !== 'critical' && v.reorder_urgency !== 'warning');

  const fmt = (n: number) => formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);

  // Reorder-risk header framing.
  // Keep copy operator-friendly: Demand is about what to buy, when, and why.
  const criticalCount = summary?.critical_reorder_count ?? 0;
  const warningCount = summary?.warning_reorder_count ?? 0;
  const headerStatus = criticalCount > 0 ? 'critical' : warningCount > 0 ? 'warning' : 'healthy';

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>

      {/* ── SUMMARY HEADER ── */}
      <Box sx={{
        background: pal.cardBg,
        border: `1px solid ${pal.border}`,
        borderRadius: '12px',
        overflow: 'hidden',
        mb: 2,
      }}>
        <Box sx={{
          p: '1rem 1.25rem',
          borderBottom: `1px solid ${pal.border}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2,
        }}>
          <Box>
            <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2 }}>
              Demand
            </Typography>
            {isLoading ? (
              <Typography sx={{ fontSize: 16, color: pal.textPrimary }}>Checking reorder risk...</Typography>
            ) : summary ? (
              <Typography sx={{ fontSize: 16, fontWeight: 500, color: headerStatus === 'critical' ? theme.palette.error.main : headerStatus === 'warning' ? theme.palette.warning.main : theme.palette.success.main }}>
                {criticalCount > 0
                  ? `${criticalCount} product${criticalCount > 1 ? 's' : ''} at stockout risk`
                  : warningCount > 0
                  ? `${warningCount} product${warningCount > 1 ? 's' : ''} should be reordered soon`
                  : 'No products need reordering right now'}
              </Typography>
            ) : null}
          </Box>

          {/* Current-contract metrics only. Incoming coverage lands in the backend enrichment pass. */}
          {summary && (
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              {[
                { label: 'Critical', value: summary.critical_reorder_count, color: theme.palette.error.main },
                { label: 'Reorder soon', value: summary.warning_reorder_count, color: theme.palette.warning.main },
                { label: 'Avg cover', value: summary.avg_days_of_stock != null ? `${summary.avg_days_of_stock}d` : '—', color: pal.textPrimary },
                { label: 'Stock value', value: fmt(summary.total_inventory_value), color: pal.textPrimary },
              ].map(({ label, value, color }) => (
                <Box key={label} sx={{ background: pal.tileBg, borderRadius: '6px', px: 1.5, py: 0.75, minWidth: 80 }}>
                  <Typography sx={{ fontSize: 16, fontWeight: 600, color, lineHeight: 1.2 }}>{value}</Typography>
                  <Typography sx={{ fontSize: 10, color: pal.textSecond }}>{label}</Typography>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Box>

      {isLoading && <ModuleLoadingSkeleton />}

      {isError && (
        <Typography color="error" sx={{ p: 2 }}>Failed to load demand data.</Typography>
      )}

      {/* Warehouse occupancy intentionally excluded: Floor Planning/WMS own storage utilization. */}

              {/* ── REORDER LIST ── */}
        {!isLoading && allVariants.length > 0 && (
          <Box sx={{
            background: pal.cardBg,
            border: `1px solid ${pal.border}`,
            borderRadius: '12px',
            overflow: 'hidden',
            mb: 2,
          }}>
            {/* Table header */}
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: '2fr 80px 80px 80px 100px 120px',
              px: 2,
              py: 1,
              borderBottom: `1px solid ${pal.border}`,
              gap: 1,
            }}>
              {['Product', 'In stock', 'Sold 30d', 'Cover', 'Status', 'Action'].map(h => (
                <Typography key={h} sx={{ fontSize: 10, fontWeight: 600, color: pal.textSecond, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {h}
                </Typography>
              ))}
            </Box>

            {/* Action items: critical + warning only. Full decision grouping comes next pass. */}
            {actionVariants.length === 0 ? (
              <Box sx={{ py: 4, textAlign: 'center' }}>
                <CheckCircle size={24} color={theme.palette.success.main} />
                <Typography sx={{ fontSize: 13, color: pal.textSecond, mt: 1 }}>
                  No products need reordering right now.
                </Typography>
              </Box>
            ) : (
              actionVariants.map(v => (
                <VariantRow key={v.lasyncro_variant_id} variant={v} currency={currency} pal={pal} />
              ))
            )}

            {/* Non-action rows stay collapsed until Demand gets full FT2 decision groups. */}
            {restVariants.length > 0 && (
              <>
                <Box
                  onClick={() => setShowRest(v => !v)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 2,
                    py: 1,
                    cursor: 'pointer',
                    borderTop: `1px solid ${pal.border}`,
                    '&:hover': { background: pal.rowHover },
                  }}
                >
                  <ChevronDown size={14} color={pal.textSecond} style={{ transform: showRest ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
                  <Typography sx={{ fontSize: 12, color: pal.textSecond }}>
                    {restVariants.length} healthy / excess / no-sales product{restVariants.length > 1 ? 's' : ''}
                  </Typography>
                </Box>
                <Collapse in={showRest}>
                  {restVariants.map(v => (
                    <VariantRow key={v.lasyncro_variant_id} variant={v} currency={currency} pal={pal} />
                  ))}
                </Collapse>
              </>
            )}
          </Box>
        )}

      {!isLoading && !isError && allVariants.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8, color: pal.textSecond }}>
          <Package size={36} style={{ opacity: 0.3 }} />
          <Typography sx={{ mt: 2, fontSize: 14 }}>No demand data yet.</Typography>
        </Box>
      )}
    </Box>
  );
}

export default function DemandModuleFT2(props: DemandModuleFT2Props) {
  return <ModuleErrorBoundary moduleName="demand"><DemandModuleFT2Inner {...props} /></ModuleErrorBoundary>;
}