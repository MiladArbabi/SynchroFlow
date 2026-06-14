// apps/frontend/src/pages/ft2-pages/ReturnsOverviewPage.tsx
//
// Returns — Overview tab
// ----------------------
// Owner-facing daily pulse. Answers: "What is my return problem costing me?"
//
// Zones:
//   1. Pulse        — 6 shop-level stats (refunds, revenue, margin, units, restock rate)
//   2. By Product   — per-variant breakdown ranked by revenue leakage
//   3. By Supplier  — batch correlation (only when WMS receive flow is active)
//
// Data:
//   useReturns()            → /api/v1/modules/returns
//   useReturnsCorrelation() → /api/v1/modules/returns/correlation
//
// Theme: useReturnsTheme() — mirrors Overview/Finances/Orders module pattern.
// Do NOT use raw useTheme() in this file — always go through pal.

import { Box, Typography, CircularProgress, Alert, Chip } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import { RotateCcw, TrendingDown, Package } from 'lucide-react';
import { useReturns, type ReturnsByVariant } from '../finances/useReturns';
import { useReturnsCorrelation } from '../returns/useReturnsCorrelation';
import { PlanGate } from '../../components/PlanGate';

// ─── Theme ───────────────────────────────────────────────────────────────────

function useReturnsTheme() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  return {
    isDark,
    pageBg:      isDark ? '#151D29' : '#F8F9FA',
    cardBg:      isDark ? '#1C2740' : '#FFFFFF',
    border:      isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)',
    textPrimary: isDark ? '#F0EEE8' : '#0F0E0D',
    textSecond:  isDark ? '#8B8F9A' : '#6B7280',
    tileBg:      isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    errorBg:     isDark ? 'rgba(220,38,38,0.08)'   : 'rgba(220,38,38,0.04)',
    errorBorder: '#EF4444',
    rateHigh:    '#EF4444',
    rateMid:     '#F59E0B',
    rateOk:      '#22C55E',
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatBox({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  const pal = useReturnsTheme();
  return (
    <Box sx={{
      flex: 1,
      p: 2.5,
      background: pal.cardBg,
      border: `1px solid ${pal.border}`,
      borderRadius: 2,
      display: 'flex',
      flexDirection: 'column',
      gap: 1,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: pal.textSecond }}>
        {icon}
        <Typography sx={{ fontSize: 11, fontWeight: 600, color: pal.textSecond, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: 22, fontWeight: 700, color: pal.textPrimary, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
        {value}
      </Typography>
    </Box>
  );
}

function VariantRow({ row }: { row: ReturnsByVariant }) {
  const pal = useReturnsTheme();

  const returnRateColor =
    row.return_rate_pct > 20 ? pal.rateHigh :
    row.return_rate_pct > 10 ? pal.rateMid  :
    pal.rateOk;

  const fmt = (n: number) =>
    `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr',
      px: 2,
      py: 1.5,
      borderBottom: `1px solid ${pal.border}`,
      '&:hover': { bgcolor: pal.tileBg },
      alignItems: 'center',
    }}>
      <Box>
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: pal.textPrimary }}>
          {row.variant_title ?? 'Unknown product'}
        </Typography>
        {row.sku && (
          <Typography sx={{ fontSize: 11, color: pal.textSecond, fontFamily: 'monospace' }}>
            {row.sku}
          </Typography>
        )}
      </Box>
      <Typography sx={{ fontSize: 13, color: pal.textPrimary }}>{row.total_refunds}</Typography>
      <Typography sx={{ fontSize: 13, color: pal.textPrimary }}>{row.total_units_returned}</Typography>
      <Typography sx={{ fontSize: 13, color: pal.textPrimary }}>{fmt(row.revenue_leakage)}</Typography>
      <Typography sx={{ fontSize: 13, color: pal.textPrimary }}>
        {row.margin_leakage != null ? fmt(row.margin_leakage) : '—'}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Chip
          label={`${row.return_rate_pct}%`}
          size="small"
          sx={{ bgcolor: returnRateColor, color: '#fff', fontWeight: 600, fontSize: 11 }}
        />
        <Typography sx={{ fontSize: 11, color: pal.textSecond }}>
          {row.restock_rate_pct}% restocked
        </Typography>
      </Box>
    </Box>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ReturnsOverviewPage() {
  const pal = useReturnsTheme();
  const { data, isLoading, isError } = useReturns();
  const correlationQuery = useReturnsCorrelation();
  const correlationRows = correlationQuery.data?.data ?? [];
  const hasCorrelation = correlationRows.length > 0;

  const summary = data?.summary;
  const byVariant = (data?.by_variant ?? []).sort(
    (a, b) => b.revenue_leakage - a.revenue_leakage
  );

  const fmt = (n: number) =>
    `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  return (
    <Box sx={{ background: pal.pageBg, minHeight: '100%', p: 3 }}>

      {/* HEADER */}
      <Box sx={{ mb: 3 }}>
         <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2 }}>
          Returns
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
            {isLoading ? '—' : `${summary.total_units_returned ?? 0} Total refunds, resulting in ${fmt(summary.total_margin_leakage ?? 0)} Total Margin Loss`}
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
        <Box sx={{ p: 4, textAlign: 'center', background: pal.cardBg, border: `1px solid ${pal.border}`, borderRadius: 2 }}>
          <RotateCcw size={32} style={{ marginBottom: 12, opacity: 0.3, color: pal.textSecond }} />
          <Typography sx={{ fontSize: 15, fontWeight: 600, color: pal.textPrimary }}>
            No returns recorded yet
          </Typography>
          <Typography sx={{ fontSize: 13, color: pal.textSecond, mt: 0.5 }}>
            Returns intelligence will appear here as refunds are processed in Shopify.
          </Typography>
        </Box>
      )}

      {summary && summary.total_refunds > 0 && (
        <>
          {/* ZONE 1 — PULSE */}
          <Box sx={{ mb: 1.5 }}>
            <Typography sx={{ fontSize: 11, fontWeight: 700, color: pal.textSecond, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1.5 }}>
              Returns Pulse
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <StatBox label="Total Refunds"     value={String(summary.total_refunds)}          icon={<RotateCcw size={14} />} />
              <StatBox label="Revenue Refunded"  value={fmt(summary.total_revenue_refunded)}    icon={<TrendingDown size={14} />} />
              <StatBox label="Margin Leakage"    value={fmt(summary.total_margin_leakage)}      icon={<TrendingDown size={14} />} />
              <StatBox label="Units Returned"    value={String(summary.total_units_returned)}   icon={<Package size={14} />} />
              <StatBox label="Units Restocked"   value={String(summary.total_units_restocked)}  icon={<Package size={14} />} />
              <StatBox label="Restock Rate"      value={`${summary.restock_rate_pct}%`}         icon={<Package size={14} />} />
            </Box>
          </Box>

          {/* ZONE 2 — BY PRODUCT */}
          {byVariant.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: pal.textSecond, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1.5 }}>
                By Product — ranked by revenue leakage
              </Typography>

              <Box sx={{ background: pal.cardBg, border: `1px solid ${pal.border}`, borderRadius: 2, overflow: 'hidden' }}>
                {/* TABLE HEADER */}
                <Box sx={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr',
                  px: 2, py: 1,
                  borderBottom: `1px solid ${pal.border}`,
                  bgcolor: pal.tileBg,
                }}>
                  {['Product', 'Refunds', 'Units', 'Revenue Lost', 'Margin Lost', 'Return Rate'].map(h => (
                    <Typography key={h} sx={{ fontSize: 11, fontWeight: 600, color: pal.textSecond }}>
                      {h}
                    </Typography>
                  ))}
                </Box>
                {byVariant.map(row => (
                  <VariantRow key={row.lasyncro_variant_id} row={row} />
                ))}
              </Box>
            </Box>
          )}

          {/* ZONE 3 — SUPPLIER BATCH CORRELATION */}
          <PlanGate feature="returns.analysis" mode="teased">
          {hasCorrelation && (
            <Box sx={{ mt: 3 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: pal.textSecond, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1.5 }}>
                By Supplier — return rate per batch
              </Typography>

              <Box sx={{ background: pal.cardBg, border: `1px solid ${pal.border}`, borderRadius: 2, overflow: 'hidden' }}>
                {/* TABLE HEADER */}
                <Box sx={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr 1fr',
                  px: 2, py: 1,
                  borderBottom: `1px solid ${pal.border}`,
                  bgcolor: pal.tileBg,
                }}>
                  {['Product', 'Supplier', 'Batch Received', 'Returned', 'Received', 'Return Rate'].map(h => (
                    <Typography key={h} sx={{ fontSize: 11, fontWeight: 600, color: pal.textSecond }}>{h}</Typography>
                  ))}
                </Box>

                {correlationRows.map((row, i) => {
                  const rateColor =
                    row.return_rate_pct == null  ? undefined :
                    row.return_rate_pct >= 20    ? pal.rateHigh :
                    row.return_rate_pct >= 10    ? pal.rateMid  :
                    pal.rateOk;

                  const batchLabel = row.batch_received_at
                    ? new Date(row.batch_received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
                    : row.receive_job_id ? 'Unknown date' : 'No batch data';

                  return (
                    <Box key={i} sx={{
                      display: 'grid',
                      gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr 1fr',
                      px: 2, py: 1.5,
                      borderBottom: `1px solid ${pal.border}`,
                      '&:last-child': { borderBottom: 'none' },
                      '&:hover': { bgcolor: pal.tileBg },
                      alignItems: 'center',
                      // Left accent on high-risk batches
                      borderLeft: row.return_rate_pct != null && row.return_rate_pct >= 20
                        ? `3px solid ${pal.rateHigh}`
                        : '3px solid transparent',
                    }}>
                      <Box>
                        <Typography sx={{ fontSize: 13, fontWeight: 500, color: pal.textPrimary }}>
                          {row.variant_title ?? '—'}
                        </Typography>
                        {row.sku && (
                          <Typography sx={{ fontSize: 11, color: pal.textSecond, fontFamily: 'monospace' }}>
                            {row.sku}
                          </Typography>
                        )}
                      </Box>
                      <Typography sx={{ fontSize: 13, color: pal.textPrimary }}>{row.supplier_name ?? 'Unknown supplier'}</Typography>
                      <Typography sx={{ fontSize: 11, color: pal.textSecond }}>{batchLabel}</Typography>
                      <Typography sx={{ fontSize: 13, color: pal.textPrimary }}>{row.units_returned}</Typography>
                      <Typography sx={{ fontSize: 13, color: pal.textPrimary }}>{row.units_received}</Typography>
                      <Typography sx={{ fontSize: 13, fontWeight: 600, color: rateColor }}>
                        {row.return_rate_pct != null ? `${row.return_rate_pct}%` : '—'}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>

              {/* HIGH RETURN RATE CALLOUT */}
              {correlationRows.some(r => r.return_rate_pct != null && r.return_rate_pct >= 20) && (
                <Box sx={{
                  mt: 1.5, p: 1.5,
                  bgcolor: pal.errorBg,
                  border: `1px solid ${pal.errorBorder}`,
                  borderRadius: 1.5,
                }}>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: pal.errorBorder }}>
                    ⚠ One or more batches have a return rate ≥20% — contact the supplier for credit or a quality review.
                  </Typography>
                </Box>
              )}
            </Box>
          )}
          </PlanGate>
        </>
      )}
    </Box>
  );
}