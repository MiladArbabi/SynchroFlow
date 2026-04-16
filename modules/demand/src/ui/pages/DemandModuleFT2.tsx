// modules/demand/src/ui/pages/DemandModuleFT2.tsx

import { Box, Typography, CircularProgress, Chip, useTheme } from '@mui/material';
import { AlertTriangle, TrendingDown, Package, CheckCircle } from 'lucide-react';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';

export type DemandVelocity = {
  lasyncro_variant_id: string;
  title: string | null;
  sku: string | null;
  unit_cost: number | null;
  available_quantity: number;
  units_sold_30d: number;
  velocity_per_day: number;
  days_of_stock_remaining: number | null;
  reorder_signal: boolean;
  reorder_urgency: 'critical' | 'warning' | 'healthy' | 'overstocked' | 'no_velocity';
  estimated_stockout_date: string | null;
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
  /** CURRENCY LAYER 3 — pass from EntitlementsContext, never hardcode */
  currency?: CurrencyContext;
};

const URGENCY_CONFIG = {
  critical: { label: 'Critical', color: '#DC2626', icon: <AlertTriangle size={12} /> },
  warning: { label: 'Reorder Soon', color: '#CA8A04', icon: <TrendingDown size={12} /> },
  healthy: { label: 'Healthy', color: '#16A34A', icon: <CheckCircle size={12} /> },
  overstocked: { label: 'Overstocked', color: '#2563EB', icon: <Package size={12} /> },
  no_velocity: { label: 'No Sales', color: '#6B7280', icon: <Package size={12} /> },
};

function StatBox({ label, value, color, icon }: { label: string; value: string; color?: string; icon: React.ReactNode }) {
  return (
    <Box sx={{ flex: 1, p: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, minWidth: 140 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, color: color ?? 'text.secondary' }}>
        {icon}
        <Typography variant="caption" color="inherit">{label}</Typography>
      </Box>
      <Typography variant="h5" fontWeight={700} sx={{ color: color ?? 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  );
}

function VariantRow({ variant, currency }: { variant: DemandVelocity; currency?: CurrencyContext }) {
  const theme = useTheme();
  const config = URGENCY_CONFIG[variant.reorder_urgency];

  const fmt = (n: number) => formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);

  const stockoutDate = variant.estimated_stockout_date
    ? new Date(variant.estimated_stockout_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—';

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr',
        px: 2,
        py: 1.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
        alignItems: 'center',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box>
        <Typography variant="body2" fontWeight={500}>{variant.title ?? 'Unknown'}</Typography>
        {variant.sku && <Typography variant="caption" color="text.secondary">{variant.sku}</Typography>}
      </Box>
      <Typography variant="body2">{variant.available_quantity}</Typography>
      <Typography variant="body2">{variant.units_sold_30d}</Typography>
      <Typography variant="body2">{variant.velocity_per_day}/day</Typography>
      <Typography variant="body2">
        {variant.days_of_stock_remaining != null ? `${variant.days_of_stock_remaining}d` : '—'}
      </Typography>
      <Chip
        label={config.label}
        size="small"
        sx={{
          bgcolor: config.color,
          color: '#fff',
          fontWeight: 600,
          fontSize: 10,
          height: 20,
          width: 'fit-content',
        }}
      />
    </Box>
  );
}

export default function DemandModuleFT2({ data, isLoading, isError, currency }: DemandModuleFT2Props) {
  const theme = useTheme();
  const summary = data?.summary;
  const variants = data?.variants ?? [];

  const fmt = (n: number) => formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>Demand & Inventory</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Sales velocity, days-of-stock remaining, and reorder signals per product variant.
        </Typography>
      </Box>

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {summary && (
        <>
          {/* ZONE 1 — PULSE */}
          <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
            <StatBox label="Variants Tracked" value={String(summary.total_variants_tracked)} icon={<Package size={14} />} />
            <StatBox label="Critical Reorder" value={String(summary.critical_reorder_count)} icon={<AlertTriangle size={14} />} color={theme.palette.error.main} />
            <StatBox label="Reorder Soon" value={String(summary.warning_reorder_count)} icon={<TrendingDown size={14} />} color={theme.palette.warning.main} />
            <StatBox label="Stockouts" value={String(summary.stockout_count)} icon={<AlertTriangle size={14} />} color={theme.palette.error.main} />
            <StatBox label="Inventory Value" value={fmt(summary.total_inventory_value)} icon={<Package size={14} />} color={theme.palette.primary.main} />
          </Box>

          {/* ZONE 2 — VARIANT TABLE */}
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
              Variants — ranked by urgency
            </Typography>

            <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
              {['Product', 'In Stock', 'Sold (30d)', 'Velocity', 'Days Left', 'Status'].map(h => (
                <Typography key={h} variant="caption" color="text.secondary" fontWeight={600}>{h}</Typography>
              ))}
            </Box>

            {variants.map(v => <VariantRow key={v.lasyncro_variant_id} variant={v} currency={currency} />)}

            {variants.length === 0 && (
              <Box sx={{ py: 4, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">No variant data available.</Typography>
              </Box>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}