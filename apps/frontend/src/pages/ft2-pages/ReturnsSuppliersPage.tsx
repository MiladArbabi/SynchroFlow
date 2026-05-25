// apps/frontend/src/pages/ft2-pages/ReturnsSuppliersPage.tsx
//
// Returns — Suppliers tab (Growth tier)
// --------------------------------------
// Supplier return rate scorecard + suspect batch detection.
// Answers: which suppliers are sending stock that comes back?
//
// Data: GET /api/v1/modules/returns/correlation
//
// RULES:
// - No hardcoded hex — CSS variables or theme.palette.* only
// - No inline style={} — MUI sx only
// - No cross-module imports

import { useMemo } from 'react';
import {
  Box, Typography, CircularProgress, Alert, useTheme,
} from '@mui/material';
import { alpha, Theme } from '@mui/material/styles';
import { AlertTriangle, Package, TrendingDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import type { CorrelationRow } from '../returns/useReturnsCorrelation';

// ─── HOOK ─────────────────────────────────────────────

function useReturnsCorrelation() {
  return useQuery<{ data: CorrelationRow[] }>({
    queryKey: ['returns', 'correlation'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/modules/returns/correlation');
      return data;
    },
    refetchInterval: 300_000,
    placeholderData: (prev) => prev,
  });
}

// ─── HELPERS ──────────────────────────────────────────

const rateColor = (rate: number | null, theme: Theme) => {
  if (rate == null) return 'var(--ink-4)';
  if (rate >= 20) return theme.palette.error.main;
  if (rate >= 10) return theme.palette.warning.main;
  return theme.palette.success.main;
};

const fmtDate = (iso: string | null) => {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: '2-digit',
  });
};

// ─── SUPPLIER SCORECARD ───────────────────────────────

interface SupplierScore {
  name: string;
  returned: number;
  received: number;
  rate: number;
  skuCount: number;
}

// ─── MAIN ─────────────────────────────────────────────

export default function ReturnsSuppliersPage() {
  const theme = useTheme();
  const { data, isLoading, isError } = useReturnsCorrelation();
  const rows = useMemo(() => data?.data ?? [], [data?.data]);

  // ── Supplier rollup ────────────────────────────────
  const suppliers = useMemo<SupplierScore[]>(() => {
    const map = new Map<string, SupplierScore>();
    for (const row of rows) {
      const name = row.supplier_name ?? 'Unknown supplier';
      const entry = map.get(name) ?? {
        name,
        returned: 0,
        received: 0,
        rate: 0,
        skuCount: 0,
      };
      entry.returned += Number(row.units_returned);
      entry.received += Number(row.units_received);
      entry.skuCount += 1;
      map.set(name, entry);
    }
    return Array.from(map.values())
      .map(s => ({
        ...s,
        rate: s.received > 0 ? Math.round((s.returned / s.received) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.rate - a.rate);
  }, [rows]);

  // ── Suspect batches (≥15% or 1.5× avg) ────────────
  const avgRate = rows.length > 0
    ? rows.reduce((s, r) => s + Number(r.return_rate_pct ?? 0), 0) / rows.length
    : 0;

  const suspectBatches = rows.filter(
    r => Number(r.return_rate_pct ?? 0) >= Math.max(15, avgRate * 1.5)
  );

  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%', p: '24px 40px' }}>

      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', mb: 0.25 }}>
          Suppliers
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
          {isLoading ? '—' : `${suppliers.length} supplier${suppliers.length !== 1 ? 's' : ''} · return rate by batch`}
        </Typography>
      </Box>

      {isError && (
        <Alert severity="error" sx={{ mb: 3 }}>Failed to load supplier correlation data.</Alert>
      )}

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {!isLoading && rows.length === 0 && (
        <Box sx={{
          py: 8, textAlign: 'center',
          border: '0.5px solid var(--rule)',
          borderRadius: '10px', bgcolor: 'var(--surface)',
        }}>
          <Package size={32} style={{ opacity: 0.2, marginBottom: 8 }} />
          <Typography sx={{ fontSize: 13, color: 'var(--ink-4)', mb: 0.5 }}>
            No supplier correlation data yet.
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--ink-4)' }}>
            Appears once receive jobs are completed and returns are processed.
          </Typography>
        </Box>
      )}

      {rows.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>

          {/* ── Suspect batches alert ────────────────── */}
          {suspectBatches.length > 0 && (
            <Box sx={{
              display: 'flex', alignItems: 'flex-start', gap: 1.5,
              px: 2, py: 1.5,
              bgcolor: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.15 : 0.06),
              border: `0.5px solid ${alpha(theme.palette.error.main, 0.3)}`,
              borderRadius: '10px',
            }}>
              <AlertTriangle size={15} color={theme.palette.error.main} style={{ marginTop: 2, flexShrink: 0 }} />
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', mb: 0.25 }}>
                  {suspectBatches.length} suspect batch{suspectBatches.length !== 1 ? 'es' : ''} detected
                </Typography>
                <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  Return rate ≥15% or 1.5× your average. Contact the supplier for a credit or quality review.
                </Typography>
              </Box>
            </Box>
          )}

          {/* ── Supplier scorecard ───────────────────── */}
          <Box>
            <Typography sx={{
              fontSize: 10, fontWeight: 500, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1.5,
            }}>
              Supplier scorecard
            </Typography>
            <Box sx={{
              bgcolor: 'var(--surface)',
              border: '0.5px solid var(--rule)',
              borderRadius: '10px',
              overflow: 'hidden',
            }}>
              {/* Header */}
              <Box sx={{
                display: 'grid',
                gridTemplateColumns: '1fr 80px 80px 80px 100px',
                px: 2, py: 1.25,
                bgcolor: 'var(--bg-2)',
                borderBottom: '0.5px solid var(--rule)',
              }}>
                {['Supplier', 'Returned', 'Received', 'SKUs', 'Return rate'].map(col => (
                  <Typography key={col} sx={{
                    fontSize: 10, fontWeight: 500,
                    letterSpacing: '0.08em', textTransform: 'uppercase',
                    color: 'var(--ink-4)',
                  }}>
                    {col}
                  </Typography>
                ))}
              </Box>
              {suppliers.map(s => (
                <Box key={s.name} sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 80px 80px 80px 100px',
                  alignItems: 'center',
                  px: 2, py: 1.5,
                  borderBottom: '0.5px solid var(--rule)',
                  '&:last-child': { borderBottom: 'none' },
                  '&:hover': { bgcolor: 'var(--bg-2)' },
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {s.rate >= 20 && (
                      <TrendingDown size={13} color={theme.palette.error.main} />
                    )}
                    <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                      {s.name}
                    </Typography>
                  </Box>
                  <Typography sx={{ fontSize: 13, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
                    {s.returned}
                  </Typography>
                  <Typography sx={{ fontSize: 13, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
                    {s.received}
                  </Typography>
                  <Typography sx={{ fontSize: 13, color: 'var(--ink-4)' }}>
                    {s.skuCount}
                  </Typography>
                  <Typography sx={{
                    fontSize: 13, fontWeight: 500,
                    color: rateColor(s.rate, theme),
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {s.received > 0 ? `${s.rate}%` : '—'}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>

          {/* ── Batch drill-down ─────────────────────── */}
          <Box>
            <Typography sx={{
              fontSize: 10, fontWeight: 500, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1.5,
            }}>
              Return rate per batch
            </Typography>
            <Box sx={{
              bgcolor: 'var(--surface)',
              border: '0.5px solid var(--rule)',
              borderRadius: '10px',
              overflow: 'hidden',
            }}>
              {/* Header */}
              <Box sx={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 120px 80px 80px 100px',
                px: 2, py: 1.25,
                bgcolor: 'var(--bg-2)',
                borderBottom: '0.5px solid var(--rule)',
              }}>
                {['Product', 'Supplier', 'Batch received', 'Returned', 'Received', 'Rate'].map(col => (
                  <Typography key={col} sx={{
                    fontSize: 10, fontWeight: 500,
                    letterSpacing: '0.08em', textTransform: 'uppercase',
                    color: 'var(--ink-4)',
                  }}>
                    {col}
                  </Typography>
                ))}
              </Box>
              {rows.map((row, i) => {
                const rate = row.return_rate_pct;
                const isSuspect = Number(rate ?? 0) >= Math.max(15, avgRate * 1.5);
                return (
                  <Box key={i} sx={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 120px 80px 80px 100px',
                    alignItems: 'center',
                    px: 2, py: 1.5,
                    borderBottom: '0.5px solid var(--rule)',
                    borderLeft: isSuspect
                      ? `3px solid ${theme.palette.error.main}`
                      : '3px solid transparent',
                    '&:last-child': { borderBottom: 'none' },
                    '&:hover': { bgcolor: 'var(--bg-2)' },
                  }}>
                    <Box>
                      <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                        {row.variant_title ?? '—'}
                      </Typography>
                      {row.sku && (
                        <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'monospace' }}>
                          {row.sku}
                        </Typography>
                      )}
                    </Box>
                    <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
                      {row.supplier_name ?? 'Unknown'}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: 'var(--ink-4)' }}>
                      {fmtDate(row.batch_received_at) ?? (row.receive_job_id ? 'Unknown date' : 'No batch data')}
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
                      {row.units_returned}
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
                      {row.units_received}
                    </Typography>
                    <Typography sx={{
                      fontSize: 13, fontWeight: 500,
                      color: rateColor(rate, theme),
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {rate != null ? `${rate}%` : '—'}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}