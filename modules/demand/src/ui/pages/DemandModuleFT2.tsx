// modules/demand/src/ui/pages/DemandModuleFT2.tsx
import { useState } from 'react';
import {
  Box, Typography, Chip, Button, Collapse,
  useTheme,
} from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import {
  TrendingDown, TrendingUp, Package,
  CheckCircle, ChevronDown, ShoppingCart, Minus,
} from 'lucide-react';
import { 
  BinOccupancy, 
  formatCurrencyCompact, 
  ModuleLoadingSkeleton, 
  WarehouseLocation 
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
  gridLocations?: WarehouseLocation[];
  gridOccupancy?: Record<string, BinOccupancy>;
};

// ─────────────────────────────────────────────
// THEME HOOK
// ─────────────────────────────────────────────
function useDemandTheme() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  return {
    isDark,
    cardBg:      isDark ? '#1C2740' : '#FFFFFF',
    border:      isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)',
    rowHover:    isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
    textPrimary: isDark ? '#F0EEE8' : '#0F0E0D',
    textSecond:  isDark ? '#8B8F9A' : '#6B7280',
    tileBg:      isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
  };
}

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
// ORDER CTA — navigates to suppliers portal
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
    <Button
      size="small"
      variant="outlined"
      startIcon={<ShoppingCart size={12} />}
      href={href}
      sx={{ fontSize: 10, py: 0.25, px: 1, minWidth: 0, borderRadius: '6px', whiteSpace: 'nowrap' }}
    >
      {variant.suggested_reorder_qty ? `Order ${variant.suggested_reorder_qty}` : 'Order'}
    </Button>
  );
}

// ─────────────────────────────────────────────
// VARIANT ROW
// ─────────────────────────────────────────────
function VariantRow({ variant, currency, pal }: {
  variant: DemandVelocity;
  currency?: CurrencyContext;
  pal: ReturnType<typeof useDemandTheme>;
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
      borderBottom: `0.5px solid ${pal.border}`,
      alignItems: 'center',
      gap: 1,
      borderLeft: `3px solid ${isCritical ? theme.palette.error.main : isWarning ? theme.palette.warning.main : 'transparent'}`,
      '&:hover': { background: pal.rowHover },
    }}>
      {/* Product */}
      <Box>
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: pal.textPrimary, lineHeight: 1.3 }}>
          {variant.title ?? 'Unknown'}
        </Typography>
        <Typography sx={{ fontSize: 10, color: pal.textSecond, fontFamily: 'monospace' }}>
          {variant.sku ?? '—'}
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

      {/* Status chip */}
      <Box>
        {isCritical && <Chip label="Critical" size="small" color="error" sx={{ fontSize: 10, height: 20, fontWeight: 700 }} />}
        {isWarning && <Chip label="Reorder Soon" size="small" color="warning" sx={{ fontSize: 10, height: 20 }} />}
        {variant.reorder_urgency === 'healthy' && <Chip label="Healthy" size="small" color="success" sx={{ fontSize: 10, height: 20 }} />}
        {variant.reorder_urgency === 'overstocked' && <Chip label="Overstocked" size="small" color="info" sx={{ fontSize: 10, height: 20 }} />}
        {variant.reorder_urgency === 'no_velocity' && <Chip label="No Sales" size="small" sx={{ fontSize: 10, height: 20 }} />}
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
  gridLocations, 
  gridOccupancy 
}: DemandModuleFT2Props) {
  const theme = useTheme();
  const pal = useDemandTheme();
  const [showRest, setShowRest] = useState(false);

  const summary = data?.summary;
  const allVariants = data?.variants ?? [];
  const actionVariants = allVariants.filter(v => v.reorder_urgency === 'critical' || v.reorder_urgency === 'warning');
  const restVariants = allVariants.filter(v => v.reorder_urgency !== 'critical' && v.reorder_urgency !== 'warning');

  const fmt = (n: number) => formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);

  // Command header framing
  const criticalCount = summary?.critical_reorder_count ?? 0;
  const warningCount = summary?.warning_reorder_count ?? 0;
  const headerStatus = criticalCount > 0 ? 'critical' : warningCount > 0 ? 'warning' : 'healthy';

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>

      {/* ── ZONE 1: COMMAND HEADER ── */}
      <Box sx={{
        background: pal.cardBg,
        border: `0.5px solid ${pal.border}`,
        borderRadius: '12px',
        overflow: 'hidden',
        mb: 2,
      }}>
        <Box sx={{
          p: '1rem 1.25rem',
          borderBottom: `0.5px solid ${pal.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2,
        }}>
          <Box>
            <Typography sx={{ fontSize: 10, fontWeight: 500, color: pal.textSecond, textTransform: 'uppercase', letterSpacing: '0.08em', mb: '4px' }}>
              Demand Intelligence
            </Typography>
            {isLoading ? (
              <Typography sx={{ fontSize: 16, color: pal.textPrimary }}>Computing...</Typography>
            ) : summary ? (
              <Typography sx={{ fontSize: 16, fontWeight: 500, color: headerStatus === 'critical' ? theme.palette.error.main : headerStatus === 'warning' ? theme.palette.warning.main : theme.palette.success.main }}>
                {criticalCount > 0
                  ? `${criticalCount} product${criticalCount > 1 ? 's' : ''} at critical stockout risk`
                  : warningCount > 0
                  ? `${warningCount} product${warningCount > 1 ? 's' : ''} need reordering soon`
                  : 'All products have healthy stock levels'}
              </Typography>
            ) : null}
          </Box>

          {/* Metric tiles */}
          {summary && (
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              {[
                { label: 'Critical', value: summary.critical_reorder_count, color: theme.palette.error.main },
                { label: 'Reorder Soon', value: summary.warning_reorder_count, color: theme.palette.warning.main },
                { label: 'Avg Days Stock', value: summary.avg_days_of_stock != null ? `${summary.avg_days_of_stock}d` : '—', color: pal.textPrimary },
                { label: 'Inventory Value', value: fmt(summary.total_inventory_value), color: pal.textPrimary },
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

       {/* Warehouse occupancy summary — links to full isometric map in Floor Planning */}
          {gridLocations && gridLocations.length > 0 && (() => {
            const bins        = gridLocations.filter(l => l.type === 'bin');
            const stockedBins = gridOccupancy ? Object.values(gridOccupancy).filter(o => o.on_hand_quantity > 0).length : 0;
            const totalBins   = bins.length;
            const pct         = totalBins > 0 ? Math.round((stockedBins / totalBins) * 100) : 0;
            const pickBins    = bins.filter(l => l.zone_type === 'pick');
            const pickStocked = gridOccupancy ? pickBins.filter(l => (gridOccupancy[l.location_code]?.on_hand_quantity ?? 0) > 0).length : 0;
            const packBins    = bins.filter(l => l.zone_type === 'pack');
            const packStocked = gridOccupancy ? packBins.filter(l => (gridOccupancy[l.location_code]?.on_hand_quantity ?? 0) > 0).length : 0;
            return (
              <Box sx={{ mb: 3, p: 2, border: '1px solid var(--rule)', borderRadius: 2, bgcolor: 'var(--bg-2)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                    Warehouse Occupancy
                  </Typography>
                  <Typography
                    component="a"
                    href="/floor-planning?tab=map"
                    sx={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', fontWeight: 500, '&:hover': { textDecoration: 'underline' } }}
                  >
                    View in Warehouse →
                  </Typography>
                </Box>
                {/* Occupancy bar */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                  <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: 'var(--bg-3)', overflow: 'hidden' }}>
                    <Box sx={{ height: '100%', width: `${pct}%`, bgcolor: pct > 80 ? 'rgba(239,68,68,0.8)' : pct > 40 ? 'rgba(245,158,11,0.8)' : 'rgba(34,197,94,0.8)', borderRadius: 3, transition: 'width 0.3s' }} />
                  </Box>
                  <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', minWidth: 32 }}>{pct}%</Typography>
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-3)' }}>{stockedBins} of {totalBins} bins stocked</Typography>
                </Box>
                {/* Zone breakdown */}
                <Box sx={{ display: 'flex', gap: 3 }}>
                  {pickBins.length > 0 && (
                    <Typography sx={{ fontSize: 11, color: 'var(--ink-3)' }}>
                      Pick zones: <Typography component="span" sx={{ fontWeight: 600, color: 'var(--ink)' }}>{pickStocked}/{pickBins.length}</Typography> stocked
                    </Typography>
                  )}
                  {packBins.length > 0 && (
                    <Typography sx={{ fontSize: 11, color: 'var(--ink-3)' }}>
                      Pack zones: <Typography component="span" sx={{ fontWeight: 600, color: 'var(--ink)' }}>{packStocked}/{packBins.length}</Typography> stocked
                    </Typography>
                  )}
                </Box>
              </Box>
            );
          })()}

      {/* ── ZONE 2: PRIORITY ACTION LIST ── */}
      {!isLoading && allVariants.length > 0 && (
        <Box sx={{
          background: pal.cardBg,
          border: `0.5px solid ${pal.border}`,
          borderRadius: '12px',
          overflow: 'hidden',
          mb: 2,
        }}>
          {/* Table header */}
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: '2fr 80px 80px 80px 100px 120px',
            px: 2, py: 1,
            borderBottom: `0.5px solid ${pal.border}`,
            gap: 1,
          }}>
            {['Product', 'In Stock', 'Sold 30d', 'Days Left', 'Status', 'Action'].map(h => (
              <Typography key={h} sx={{ fontSize: 10, fontWeight: 600, color: pal.textSecond, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {h}
              </Typography>
            ))}
          </Box>

          {/* Action items (critical + warning) */}
          {actionVariants.length === 0 ? (
            <Box sx={{ py: 4, textAlign: 'center' }}>
              <CheckCircle size={24} color={theme.palette.success.main} />
              <Typography sx={{ fontSize: 13, color: pal.textSecond, mt: 1 }}>
                No reorder signals — all products are healthy.
              </Typography>
            </Box>
          ) : (
            actionVariants.map(v => (
              <VariantRow key={v.lasyncro_variant_id} variant={v} currency={currency} pal={pal} />
            ))
          )}

          {/* Collapsed: healthy + overstocked + no_velocity */}
          {restVariants.length > 0 && (
            <>
              <Box
                onClick={() => setShowRest(v => !v)}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1,
                  px: 2, py: 1, cursor: 'pointer',
                  borderTop: `0.5px solid ${pal.border}`,
                  '&:hover': { background: pal.rowHover },
                }}
              >
                <ChevronDown size={14} color={pal.textSecond} style={{ transform: showRest ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
                <Typography sx={{ fontSize: 12, color: pal.textSecond }}>
                  {restVariants.length} healthy / overstocked / no-sales product{restVariants.length > 1 ? 's' : ''}
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
          <Typography sx={{ mt: 2, fontSize: 14 }}>No inventory data yet.</Typography>
        </Box>
      )}
    </Box>
  );
}

export default function DemandModuleFT2(props: DemandModuleFT2Props) {
  return <ModuleErrorBoundary moduleName="demand"><DemandModuleFT2Inner {...props} /></ModuleErrorBoundary>;
}