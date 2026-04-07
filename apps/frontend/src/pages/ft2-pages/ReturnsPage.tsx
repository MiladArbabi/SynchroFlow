// apps/frontend/src/pages/ft2-pages/ReturnsPage.tsx

import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  useTheme,
  Chip,
} from '@mui/material';
import { RotateCcw, TrendingDown, Package } from 'lucide-react';
import { useReturns, type ReturnsByVariant } from '../finances/useReturns';

/**
 * RETURNS INTELLIGENCE PAGE (RT-03)
 * ----------------------------------
 * Surfaces return rate, revenue leakage, and restock rate.
 *
 * Three zones:
 * 1. Returns Pulse — shop-level summary stats
 * 2. Per-variant breakdown — ranked by revenue leakage
 *
 * Design rules:
 * - Operator vocabulary: "Returns" not "refund_executions"
 * - Empty state when no refunds exist — not an error
 * - Theme-aware colors only
 */

function StatBox({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        flex: 1,
        p: 2.5,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
        {icon}
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
      </Box>
      <Typography variant="h5" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  );
}

function VariantRow({ row }: { row: ReturnsByVariant }) {
  const theme = useTheme();

  const returnRateColor =
    row.return_rate_pct > 20
      ? theme.palette.error.main
      : row.return_rate_pct > 10
      ? theme.palette.warning.main
      : theme.palette.success.main;

  const fmt = (n: number) =>
    `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr',
        px: 2,
        py: 1.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
        '&:hover': { bgcolor: 'action.hover' },
        alignItems: 'center',
      }}
    >
      <Box>
        <Typography variant="body2" fontWeight={500}>
          {row.variant_title ?? 'Unknown variant'}
        </Typography>
        {row.sku && (
          <Typography variant="caption" color="text.secondary">
            {row.sku}
          </Typography>
        )}
      </Box>
      <Typography variant="body2">{row.total_refunds}</Typography>
      <Typography variant="body2">{row.total_units_returned}</Typography>
      <Typography variant="body2">{fmt(row.revenue_leakage)}</Typography>
      <Typography variant="body2">
        {row.margin_leakage != null ? fmt(row.margin_leakage) : '—'}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Chip
          label={`${row.return_rate_pct}%`}
          size="small"
          sx={{
            bgcolor: returnRateColor,
            color: theme.palette.common.white,
            fontWeight: 600,
            fontSize: 11,
          }}
        />
        <Typography variant="caption" color="text.secondary">
          {row.restock_rate_pct}% restocked
        </Typography>
      </Box>
    </Box>
  );
}

export default function ReturnsPage() {
  const { data, isLoading, isError } = useReturns();

  const summary = data?.summary;
  const byVariant = (data?.by_variant ?? []).sort(
    (a, b) => b.revenue_leakage - a.revenue_leakage
  );

  const fmt = (n: number) =>
    `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  return (
    <Box sx={{ p: 3 }}>

      {/* HEADER */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>Returns</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Return rate, revenue leakage, and restocking intelligence across your orders.
        </Typography>
      </Box>

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {isError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load returns data. Please refresh.
        </Alert>
      )}

      {/* EMPTY STATE */}
      {!isLoading && !isError && summary?.total_refunds === 0 && (
        <Box
          sx={{
            p: 4,
            textAlign: 'center',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
          }}
        >
          <RotateCcw size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
          <Typography variant="body1" fontWeight={600}>
            No returns recorded yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Returns intelligence will appear here as refunds are processed in Shopify.
          </Typography>
        </Box>
      )}

      {summary && summary.total_refunds > 0 && (
        <>
          {/* ZONE 1 — RETURNS PULSE */}
          <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
            <StatBox
              label="Total Refunds"
              value={String(summary.total_refunds)}
              icon={<RotateCcw size={14} />}
            />
            <StatBox
              label="Revenue Refunded"
              value={fmt(summary.total_revenue_refunded)}
              icon={<TrendingDown size={14} />}
            />
            <StatBox
              label="Margin Leakage"
              value={fmt(summary.total_margin_leakage)}
              icon={<TrendingDown size={14} />}
            />
            <StatBox
              label="Units Returned"
              value={String(summary.total_units_returned)}
              icon={<Package size={14} />}
            />
            <StatBox
              label="Restock Rate"
              value={`${summary.restock_rate_pct}%`}
              icon={<Package size={14} />}
            />
          </Box>

          {/* ZONE 2 — PER-VARIANT BREAKDOWN */}
          {byVariant.length > 0 && (
            <Box>
              <Typography variant="overline" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
                By Product — ranked by revenue leakage
              </Typography>

              {/* TABLE HEADER */}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr',
                  px: 2,
                  py: 1,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                }}
              >
                {['Product', 'Refunds', 'Units', 'Revenue Lost', 'Margin Lost', 'Return Rate'].map(h => (
                  <Typography key={h} variant="caption" color="text.secondary" fontWeight={600}>
                    {h}
                  </Typography>
                ))}
              </Box>

              {byVariant.map(row => (
                <VariantRow key={row.lasyncro_variant_id} row={row} />
              ))}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}