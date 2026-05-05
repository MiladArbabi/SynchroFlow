// apps/frontend/src/pages/ft2-pages/WmsAnalyticsPage.tsx
import { useState } from 'react';
import {
  Box, Typography, CircularProgress, ToggleButtonGroup,
  ToggleButton, Alert,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { usePickAnalytics } from '../wms/usePickAnalytics';
import { useAppTheme } from '../../hooks/useAppTheme';
import { PlanGate } from '../../components/PlanGate';
import { ModuleTabBar } from '../../components/ModuleTabBar';

function MetricTile({ label, value, sub, tone }: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'positive' | 'negative' | 'warning' | 'neutral';
}) {
  const theme = useTheme();
  const pal = useAppTheme();
  const color =
    tone === 'positive' ? theme.palette.success.main :
    tone === 'negative' ? theme.palette.error.main :
    tone === 'warning'  ? theme.palette.warning.main :
    pal.ink;

  return (
    <Box sx={{
      flex: 1, minWidth: 140,
      p: '0.85rem 1.25rem',
      background: pal.surface,
      border: `0.5px solid ${pal.rule}`,
      borderRadius: '12px',
    }}>
      <Typography sx={{ fontSize: 22, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
      <Typography sx={{ fontSize: 11, color: pal.ink3, mt: '2px' }}>{label}</Typography>
      {sub && <Typography sx={{ fontSize: 10, color, mt: '1px' }}>{sub}</Typography>}
    </Box>
  );
}

export default function WmsAnalyticsPage() {
  const pal = useAppTheme();
  const theme = useTheme();
  const [days, setDays] = useState(30);
  const { data, isLoading, isError } = usePickAnalytics(days);

  const summary = data?.summary;
  const exceptions = data?.exceptions ?? [];
  const batches = data?.batches ?? [];
  const operators = data?.operators ?? [];

  const avgBatchMinutes = batches.length > 0
    ? Math.round(batches.reduce((s, b) => s + b.pick_duration_seconds, 0) / batches.length / 60)
    : null;

  return (
    <PlanGate feature="wms.pick_batches">
      <Box sx={{ bgcolor: pal.bg, minHeight: '100%' }}>
      <ModuleTabBar tabs={[
        { id: 'operations', label: 'Operations', path: '/wms' },
        { id: 'analytics',  label: 'Analytics',  path: '/wms/analytics', requiredTier: 'growth', feature: 'wms.pick_batches' },
      ]} />
      <Box sx={{ p: { xs: 2, md: 3 } }}>

        {/* HEADER */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Typography sx={{ fontSize: 20, fontWeight: 700, color: pal.ink }}>Pick Analytics</Typography>
            <Typography sx={{ fontSize: 12, color: pal.ink3, mt: '2px' }}>
              Accuracy, velocity, and error signals from your warehouse floor.
            </Typography>
          </Box>
          <ToggleButtonGroup value={days} exclusive onChange={(_e, val) => val && setDays(val)} size="small">
            <ToggleButton value={7}>7d</ToggleButton>
            <ToggleButton value={30}>30d</ToggleButton>
            <ToggleButton value={90}>90d</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {isLoading && <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}><CircularProgress size={24} /></Box>}
        {isError && <Alert severity="error">Failed to load analytics. Please refresh.</Alert>}

        {summary && (
          <>
            {/* ZONE 1 — SUMMARY METRICS */}
            <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
              <MetricTile
                label="Pick Accuracy"
                value={summary.pick_accuracy_pct != null ? `${summary.pick_accuracy_pct}%` : '—'}
                tone={
                  summary.pick_accuracy_pct == null ? 'neutral' :
                  summary.pick_accuracy_pct >= 95 ? 'positive' :
                  summary.pick_accuracy_pct >= 85 ? 'warning' : 'negative'
                }
                sub={summary.pick_accuracy_pct != null
                  ? summary.pick_accuracy_pct >= 95 ? 'Excellent' : summary.pick_accuracy_pct >= 85 ? 'Needs attention' : 'Critical'
                  : undefined}
              />
              <MetricTile
                label="Units Picked"
                value={summary.total_units_picked.toLocaleString()}
                tone="neutral"
              />
              <MetricTile
                label="Total Exceptions"
                value={String(summary.total_exceptions)}
                tone={summary.total_exceptions === 0 ? 'positive' : summary.total_exceptions < 5 ? 'warning' : 'negative'}
              />
              <MetricTile
                label="Avg Batch Time"
                value={avgBatchMinutes != null ? `${avgBatchMinutes}m` : '—'}
                tone="neutral"
              />
            </Box>

            {/* ZONE 2 — ERROR RATE BY SKU */}
            {exceptions.length > 0 && (
              <Box sx={{
                background: pal.surface,
                border: `0.5px solid ${pal.rule}`,
                borderRadius: '12px',
                overflow: 'hidden',
                mb: 3,
              }}>
                <Box sx={{ p: '0.85rem 1.25rem', borderBottom: `0.5px solid ${pal.rule}` }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 600, color: pal.ink3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Error Rate by SKU — top {exceptions.length}
                  </Typography>
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', px: 2, py: 1, borderBottom: `0.5px solid ${pal.rule}` }}>
                  {['Product', 'Exceptions', 'Error Rate'].map(h => (
                    <Typography key={h} sx={{ fontSize: 10, fontWeight: 600, color: pal.ink3, textTransform: 'uppercase' }}>{h}</Typography>
                  ))}
                </Box>
                {exceptions.map(ex => (
                  <Box key={ex.lasyncro_variant_id} sx={{
                    display: 'grid', gridTemplateColumns: '2fr 1fr 1fr',
                    px: 2, py: 1.25,
                    borderBottom: `0.5px solid ${pal.rule}`,
                    '&:last-child': { borderBottom: 'none' },
                    '&:hover': { bgcolor: pal.rowHover },
                  }}>
                    <Box>
                      <Typography sx={{ fontSize: 13, color: pal.ink }}>{ex.title ?? '—'}</Typography>
                      {ex.sku && <Typography sx={{ fontSize: 10, color: pal.ink3, fontFamily: 'monospace' }}>{ex.sku}</Typography>}
                    </Box>
                    <Typography sx={{ fontSize: 13, color: pal.ink }}>{ex.exception_count}</Typography>
                    <Typography sx={{
                      fontSize: 13, fontWeight: 600,
                      color: ex.error_rate_pct == null ? pal.ink3 :
                        ex.error_rate_pct >= 20 ? theme.palette.error.main :
                        ex.error_rate_pct >= 10 ? theme.palette.warning.main :
                        theme.palette.success.main,
                    }}>
                      {ex.error_rate_pct != null ? `${ex.error_rate_pct}%` : '—'}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}

            {/* ZONE 3 — OPERATOR VELOCITY */}
            {operators.length > 0 && (
              <Box sx={{
                background: pal.surface,
                border: `0.5px solid ${pal.rule}`,
                borderRadius: '12px',
                overflow: 'hidden',
                mb: 3,
              }}>
                <Box sx={{ p: '0.85rem 1.25rem', borderBottom: `0.5px solid ${pal.rule}` }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 600, color: pal.ink3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Operator Velocity
                  </Typography>
                </Box>
                {operators.map((op, i) => (
                  <Box key={op.operator_id} sx={{
                    display: 'grid', gridTemplateColumns: '2fr 1fr 1fr',
                    px: 2, py: 1.25,
                    borderBottom: `0.5px solid ${pal.rule}`,
                    '&:last-child': { borderBottom: 'none' },
                    '&:hover': { bgcolor: pal.rowHover },
                  }}>
                    <Typography sx={{ fontSize: 13, color: pal.ink }}>Operator #{i + 1}</Typography>
                    <Typography sx={{ fontSize: 13, color: pal.ink }}>{Number(op.units_picked).toLocaleString()} units</Typography>
                    <Typography sx={{ fontSize: 13, color: pal.ink3 }}>{Number(op.scans)} scans</Typography>
                  </Box>
                ))}
              </Box>
            )}

            {/* EMPTY STATE */}
            {exceptions.length === 0 && operators.length === 0 && (
              <Box sx={{
                py: 8, textAlign: 'center',
                border: `0.5px solid ${pal.rule}`,
                borderRadius: '12px',
                bgcolor: pal.surface,
              }}>
                <Typography sx={{ fontSize: 14, color: pal.ink3 }}>
                  No pick activity in the last {days} days.
                </Typography>
              </Box>
            )}
          </>
        )}
      </Box>
     </Box>
    </PlanGate>
  );
}