/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/ft2-pages/WmsAnalyticsPage.tsx
//
// WAREHOUSE ANALYTICS — FT2 Owner surface
// ─────────────────────────────────────────
// Layout: scroll-free, 12-col grid, 3 rows, 5 zones.
//
// Zone 1 — Capacity strip (live, 60s, ignores date toggle)
// Zone 2 — Operator Performance Board (7 cols, owner only)
// Zone 3 — Pipeline Stage Velocity    (7 cols)
// Zone 4 — Exception Intelligence     (5 cols)
// Zone 5 — Cost & Throughput Story    (5 cols, owner only)
//
// RULES:
// - No hardcoded hex. CSS variables or theme.palette.* only.
// - No inline style={}. MUI sx prop only.
// - No fetching. Data via hooks at page level, passed as props to sub-components.

import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, ToggleButtonGroup, ToggleButton, Skeleton,
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import { AlertTriangle, TrendingUp, Clock, ArrowRight } from 'lucide-react';
import { useAppTheme } from '../../hooks/useAppTheme';
import { PlanGate } from '../../components/PlanGate';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import {
  useWmsAnalytics,
  useLiveCapacity,
  type LiveCapacity,
  type OperatorPerf,
  type PipelineVelocity,
  type ExceptionIntelligence,
  type CostStory,
} from '../wms/useWmsAnalytics';
import { useEntitlements } from '../../contexts/EntitlementsContext';
import { useExchangeRates } from '../../hooks/useExchangeRates';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from '../../api/axiosConfig';
import { Popper, Paper, ClickAwayListener, Tooltip } from '@mui/material';
import { Cast, ExternalLink, Copy } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';

// ─── HELPERS ──────────────────────────────────────────────────

function fmtSeconds(s: number | null): string {
  if (s == null) return '—';
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtHours(h: number | null): string {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(1)}h`;
}

function fmtName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(' ') || 'Unknown';
}

// ─── SHARED SUB-COMPONENTS ────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{
      fontSize: 11, fontWeight: 700, color: 'var(--ink-3)',
      textTransform: 'uppercase', letterSpacing: '0.08em',
      mb: 1,
    }}>
      {children}
    </Typography>
  );
}

function ZoneCard({ children, sx = {} }: { children: React.ReactNode; sx?: object }) {
  const pal = useAppTheme();
  return (
    <Box sx={{
      background: pal.surface,
      border: `0.5px solid ${pal.rule}`,
      borderRadius: '8px',
      overflow: 'hidden',
      ...sx,
    }}>
      {children}
    </Box>
  );
}

function ZoneCardHeader({ children }: { children: React.ReactNode }) {
  const pal = useAppTheme();
  return (
    <Box sx={{ px: 2, py: 1.25, borderBottom: `0.5px solid ${pal.rule}` }}>
      {children}
    </Box>
  );
}

function StatTile({
  label, value, sub, tone,
}: {
  label: string; value: string; sub?: string;
  tone?: 'positive' | 'negative' | 'warning' | 'neutral';
}) {
  const theme = useTheme();
  const color =
    tone === 'positive' ? theme.palette.success.main :
    tone === 'negative' ? theme.palette.error.main :
    tone === 'warning'  ? theme.palette.warning.main :
    'var(--ink)';
  return (
    <Box sx={{ flex: 1, minWidth: 0, p: '0.85rem 1rem', background: 'var(--bg-2)', borderRadius: '6px' }}>
      <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.5 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
        {value}
      </Typography>
      {sub && <Typography sx={{ fontSize: 11, color, mt: '2px' }}>{sub}</Typography>}
    </Box>
  );
}

function EmptyZone({ label }: { label: string }) {
  const pal = useAppTheme();
  return (
    <Box sx={{ py: 3, textAlign: 'center' }}>
      <Typography sx={{ fontSize: 12, color: pal.ink3 }}>{label}</Typography>
    </Box>
  );
}

function CtaButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  const theme = useTheme();
  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.5,
        px: 1.25, py: 0.5, fontSize: 12, fontWeight: 600,
        bgcolor: 'var(--accent)', color: theme.palette.common.white,
        borderRadius: '6px', cursor: 'pointer',
        '&:hover': { opacity: 0.88 },
        transition: 'opacity 0.1s',
      }}
    >
      {children}
    </Box>
  );
}

// ─── ZONE 1 — TODAY'S CAPACITY ────────────────────────────────

function PipelinePip({ label, count, accent }: { label: string; count: number; accent?: boolean }) {
  const pal = useAppTheme();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 56 }}>
      <Typography sx={{
        fontSize: 18, fontWeight: 700,
        color: accent ? 'var(--accent)' : 'var(--ink)',
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.1,
      }}>
        {count}
      </Typography>
      <Typography sx={{ fontSize: 10, color: pal.ink3, mt: '2px', textAlign: 'center', whiteSpace: 'nowrap' }}>
        {label}
      </Typography>
    </Box>
  );
}

function PipelineDivider() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', pb: 2 }}>
      <ArrowRight size={12} color="var(--ink-4)" />
    </Box>
  );
}

function Zone1CapacityStrip({ live }: { live: LiveCapacity | undefined }) {
  const pal = useAppTheme();
  const theme = useTheme();

  const onTrackColor =
    live?.on_track === 'green' ? theme.palette.success.main :
    live?.on_track === 'amber' ? theme.palette.warning.main :
    live?.on_track === 'red'   ? theme.palette.error.main :
    'var(--ink-4)';

  const onTrackLabel =
    live?.on_track === 'green' ? 'On track' :
    live?.on_track === 'amber' ? 'At risk' :
    live?.on_track === 'red'   ? 'Behind' : '—';

  const formatCpt = (hours: number | null, cptLocal: string | null): string => {
    if (cptLocal == null) return '—';
    const timeLabel = cptLocal.slice(0, 5);
    if (hours == null || hours <= 0) return `${timeLabel} (passed)`;
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return h > 0 ? `${h}h ${m}m to ${timeLabel}` : `${m}m to ${timeLabel}`;
  };

  return (
    <ZoneCard sx={{ mx: 2.5, mb: 1.5, flexShrink: 0 }}>
      <Box sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap' }}>

        {/* PIPELINE COUNTS */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mr: 3 }}>
          <PipelinePip label="Awaiting pick" count={live?.pipeline.awaiting_pick ?? 0} />
          <PipelineDivider />
          <PipelinePip label="Picking" count={live?.pipeline.picking ?? 0} />
          <PipelineDivider />
          <PipelinePip label="Packing" count={live?.pipeline.packing ?? 0} />
          <PipelineDivider />
          <PipelinePip label="Ship-ready" count={live?.pipeline.ship_ready ?? 0} />
          <PipelineDivider />
          <PipelinePip label="Shipped today" count={live?.shipped_today ?? 0} accent />
        </Box>

        {/* DIVIDER */}
        <Box sx={{ width: '0.5px', height: 40, bgcolor: pal.rule, mr: 3, flexShrink: 0 }} />

        {/* OPERATORS */}
        <Box sx={{ display: 'flex', flexDirection: 'column', mr: 3, minWidth: 80 }}>
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            On shift
          </Typography>
          <Typography sx={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
            {live?.operators_on_shift ?? '—'}
            <Typography component="span" sx={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 400, ml: 0.5 }}>
              operators
            </Typography>
          </Typography>
        </Box>

        {/* CPT COUNTDOWN */}
        {live?.cpt_local && (
          <>
            <Box sx={{ width: '0.5px', height: 40, bgcolor: pal.rule, mr: 3, flexShrink: 0 }} />
            <Box sx={{ display: 'flex', flexDirection: 'column', mr: 3 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Cutoff
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Clock size={13} color={live?.hours_to_cpt != null && live.hours_to_cpt > 0 ? 'var(--ink-3)' : 'var(--ink-4)'} />
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: live?.hours_to_cpt != null && live.hours_to_cpt > 0 ? 'var(--ink)' : 'var(--ink-4)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatCpt(live?.hours_to_cpt ?? null, live?.cpt_local ?? null)}
                </Typography>
              </Box>
            </Box>
          </>
        )}

        {/* UPH SIGNALS */}
        {(live?.live_uph != null || live?.required_uph != null) && (
          <>
            <Box sx={{ width: '0.5px', height: 40, bgcolor: pal.rule, mr: 3, flexShrink: 0 }} />
            <Box sx={{ display: 'flex', gap: 2, mr: 3 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                <Typography sx={{ fontSize: 11, fontWeight: 700, color: onTrackColor, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Live UPH
                </Typography>
                <Typography sx={{ fontSize: 18, fontWeight: 700, color: onTrackColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
                  {live?.live_uph ?? '—'}
                </Typography>
              </Box>
              {live?.required_uph != null && (
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Required
                  </Typography>
                  <Typography sx={{ fontSize: 18, fontWeight: 700, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
                    {live?.required_uph}
                  </Typography>
                </Box>
              )}
            </Box>
          </>
        )}

        {/* ON-TRACK SIGNAL */}
        {live?.on_track && (
          <Box sx={{
            ml: 'auto',
            display: 'flex', alignItems: 'center', gap: 0.75,
            px: 1.25, py: 0.5,
            borderRadius: '20px',
            bgcolor: alpha(onTrackColor, 0.1),
            border: `0.5px solid ${alpha(onTrackColor, 0.3)}`,
          }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: onTrackColor, flexShrink: 0 }} />
            <Typography sx={{ fontSize: 12, fontWeight: 600, color: onTrackColor, lineHeight: 1 }}>
              {onTrackLabel}
            </Typography>
          </Box>
        )}
      </Box>
    </ZoneCard>
  );
}

// ─── ZONE 2 — OPERATOR PERFORMANCE BOARD ─────────────────────

type BaselineMode = 'personal' | 'team';

function Zone2OperatorBoard({ operators, loading }: { operators: OperatorPerf[]; loading: boolean }) {
  const pal = useAppTheme();
  const theme = useTheme();
  const navigate = useNavigate();
  const [baseline, setBaseline] = useState<BaselineMode>('personal');
  const COLS = '2fr 0.7fr 0.7fr 0.8fr 0.8fr 0.7fr 0.7fr';
  const COL_HEADERS = ['Operator', 'Picks', 'Packs', 'UPH', 'Accuracy', 'Exceptions', 'Avg batch'];

  // Team average UPH — mean of all operators with a non-null UPH
  const teamAvgUph = (() => {
    const valid = operators.filter(op => op.uph != null).map(op => op.uph!);
    return valid.length > 0 ? Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10 : null;
  })();

  const uphColor = (uph: number | null): string => {
    if (uph == null) return 'var(--ink-3)';
    const ref = baseline === 'team' ? (teamAvgUph ?? uph) : uph;
    // Personal baseline: colour by absolute thresholds
    // Team baseline: colour relative to team avg (within 10% = amber, below = red, above = green)
    if (baseline === 'personal') {
      if (uph >= 40) return theme.palette.success.main;
      if (uph >= 25) return theme.palette.warning.main;
      return theme.palette.error.main;
    }
    if (teamAvgUph == null) return 'var(--ink-3)';
    if (uph >= teamAvgUph) return theme.palette.success.main;
    if (uph >= teamAvgUph * 0.9) return theme.palette.warning.main;
    return theme.palette.error.main;
  };

  const accColor = (pct: number | null): string => {
    if (pct == null) return 'var(--ink-3)';
    if (pct >= 95) return theme.palette.success.main;
    if (pct >= 85) return theme.palette.warning.main;
    return theme.palette.error.main;
  };

  const visible = operators.slice(0, 7);
  const hasMore = operators.length > 7;

  return (
    <ZoneCard sx={{ flex: '1 1 0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <ZoneCardHeader>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <SectionLabel>Operator Performance</SectionLabel>
          <ToggleButtonGroup
            value={baseline} exclusive size="small"
            onChange={(_e, val) => val && setBaseline(val)}
            sx={{ '& .MuiToggleButton-root': { fontSize: 10, py: 0.25, px: 1, lineHeight: 1.4, textTransform: 'none', fontWeight: 500 } }}
          >
            <ToggleButton value="personal">vs self</ToggleButton>
            <ToggleButton value="team">
              vs team{teamAvgUph != null ? ` (${teamAvgUph})` : ''}
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </ZoneCardHeader>

      {loading && (
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {[1, 2, 3].map(i => <Skeleton key={i} height={28} sx={{ borderRadius: '4px' }} />)}
        </Box>
      )}

      {!loading && operators.length === 0 && (
        <EmptyZone label="No pick activity in this period." />
      )}

      {!loading && operators.length > 0 && (
        <>
          {/* HEADER ROW */}
          <Box sx={{ display: 'grid', gridTemplateColumns: COLS, px: 2, py: 0.75, borderBottom: `0.5px solid ${pal.rule}` }}>
            {COL_HEADERS.map(h => (
              <Typography key={h} sx={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {h}
              </Typography>
            ))}
          </Box>

          {/* DATA ROWS */}
          <Box sx={{ flex: 1, overflowY: 'hidden' }}>
            {visible.map(op => (
              <Box
                key={op.user_id}
                onClick={() => navigate(`/team/${op.user_id}`)}
                sx={{
                  display: 'grid', gridTemplateColumns: COLS,
                  px: 2, py: 0.75,
                  borderBottom: `0.5px solid ${pal.rule}`,
                  '&:last-child': { borderBottom: 'none' },
                  cursor: 'pointer',
                  '&:hover': { bgcolor: pal.rowHover },
                  transition: 'background 0.1s',
                }}
              >
                <Box>
                  <Typography sx={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500, lineHeight: 1.3 }}>
                    {fmtName(op.first_name, op.last_name)}
                  </Typography>
                  <Typography sx={{ fontSize: 10, color: 'var(--ink-3)' }}>{op.role}</Typography>
                </Box>
                <Typography sx={{ fontSize: 13, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', alignSelf: 'center' }}>
                  {op.picks.toLocaleString()}
                </Typography>
                <Typography sx={{ fontSize: 13, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', alignSelf: 'center' }}>
                  {op.packs.toLocaleString()}
                </Typography>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: uphColor(op.uph), fontVariantNumeric: 'tabular-nums', alignSelf: 'center' }}>
                  {op.uph != null ? op.uph : '—'}
                </Typography>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: accColor(op.accuracy_pct), fontVariantNumeric: 'tabular-nums', alignSelf: 'center' }}>
                  {op.accuracy_pct != null ? `${op.accuracy_pct}%` : '—'}
                </Typography>
                <Typography sx={{ fontSize: 13, color: op.exception_count > 0 ? theme.palette.warning.main : 'var(--ink)', fontVariantNumeric: 'tabular-nums', alignSelf: 'center' }}>
                  {op.exception_count}
                </Typography>
                <Typography sx={{ fontSize: 13, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums', alignSelf: 'center' }}>
                  {fmtSeconds(op.avg_batch_seconds)}
                </Typography>
              </Box>
            ))}
          </Box>

          {hasMore && (
            <Box sx={{ px: 2, py: 0.75, borderTop: `0.5px solid ${pal.rule}` }}>
              <Typography
                onClick={() => navigate('/team')}
                sx={{ fontSize: 12, color: 'var(--accent)', cursor: 'pointer', fontWeight: 500, '&:hover': { opacity: 0.8 } }}
              >
                View all {operators.length} operators →
              </Typography>
            </Box>
          )}
        </>
      )}
    </ZoneCard>
  );
}

// ─── ZONE 3 — PIPELINE STAGE VELOCITY ────────────────────────

function Zone3PipelineVelocity({ pipeline, loading }: { pipeline: PipelineVelocity | undefined; loading: boolean }) {
  const pal = useAppTheme();
  const theme = useTheme();

  const stages = pipeline?.stages;
  const allStages = [
    { label: 'Released → Picking', s: stages?.released_to_picking_s ?? null, color: theme.palette.info.main },
    { label: 'Picking',            s: stages?.picking_s ?? null,             color: theme.palette.success.main },
    { label: 'Packing',            s: stages?.packing_s ?? null,             color: theme.palette.warning.main },
    { label: 'Ship',               s: stages?.packed_to_shipped_s ?? null,   color: theme.palette.error.light },
  ];

  const totalS = allStages.reduce((acc, s) => acc + (s.s ?? 0), 0);

  return (
    <ZoneCard sx={{ flexShrink: 0 }}>
      <ZoneCardHeader>
        <SectionLabel>Pipeline Stage Velocity</SectionLabel>
      </ZoneCardHeader>

      <Box sx={{ px: 2, py: 1.5 }}>
        {loading && <Skeleton height={20} sx={{ borderRadius: '4px' }} />}

        {!loading && (
          <>
            {/* STACKED BAR */}
            {totalS > 0 ? (
              <Box sx={{ display: 'flex', height: 10, borderRadius: '4px', overflow: 'hidden', mb: 1.5 }}>
                {allStages.map(st => st.s != null && st.s > 0 && (
                  <Box
                    key={st.label}
                    sx={{ flex: st.s, bgcolor: st.color, minWidth: '4px' }}
                    title={`${st.label}: ${fmtSeconds(st.s)}`}
                  />
                ))}
              </Box>
            ) : (
              <Box sx={{ height: 10, borderRadius: '4px', bgcolor: 'var(--bg-3)', mb: 1.5 }} />
            )}

            {/* STAGE LEGEND */}
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1.5 }}>
              {allStages.map(st => (
                <Box key={st.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: st.color, flexShrink: 0 }} />
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-3)' }}>{st.label}</Typography>
                  <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtSeconds(st.s)}
                  </Typography>
                </Box>
              ))}
            </Box>

            {/* LATENCY CALLOUTS */}
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Box sx={{
                flex: 1, p: 1, borderRadius: '6px',
                background: 'var(--bg-2)', border: `0.5px solid ${pal.rule}`,
              }}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Receive → pickable
                </Typography>
                <Typography sx={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtHours(pipeline?.latencies.receive_to_pickable_hours ?? null)}
                </Typography>
                {(pipeline?.latencies.receive_to_pickable_samples ?? 0) > 0 && (
                  <Typography sx={{ fontSize: 10, color: 'var(--ink-3)' }}>
                    avg · {pipeline?.latencies.receive_to_pickable_samples} POs
                  </Typography>
                )}
              </Box>
              <Box sx={{
                flex: 1, p: 1, borderRadius: '6px',
                background: 'var(--bg-2)', border: `0.5px solid ${pal.rule}`,
              }}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Return → restocked
                </Typography>
                <Typography sx={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtHours(pipeline?.latencies.return_to_restock_hours ?? null)}
                </Typography>
                <Typography sx={{ fontSize: 10, color: 'var(--ink-3)' }}>avg turnaround</Typography>
              </Box>
            </Box>
          </>
        )}
      </Box>
    </ZoneCard>
  );
}

// ─── ZONE 4 — EXCEPTION INTELLIGENCE ─────────────────────────

function Zone4ExceptionIntel({ exceptions, loading }: { exceptions: ExceptionIntelligence | undefined; loading: boolean }) {
  const pal = useAppTheme();
  const theme = useTheme();
  const navigate = useNavigate();
  const topSkus = exceptions?.top_skus ?? [];
  const heatGrid = exceptions?.heat_grid ?? [];

  return (
    <ZoneCard sx={{ flex: '1 1 0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <ZoneCardHeader>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <SectionLabel>Exception Intelligence</SectionLabel>
          {topSkus.length > 0 && (
            <Typography
              onClick={() => navigate('/wms/problem-center')}
              sx={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer', fontWeight: 500, '&:hover': { opacity: 0.8 } }}
            >
              Problem center →
            </Typography>
          )}
        </Box>
      </ZoneCardHeader>

      {loading && (
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {[1, 2, 3].map(i => <Skeleton key={i} height={24} sx={{ borderRadius: '4px' }} />)}
        </Box>
      )}

      {!loading && topSkus.length === 0 && (
        <EmptyZone label="No exceptions in this period." />
      )}

      {!loading && topSkus.length > 0 && (
        <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* TOP-5 SKUS */}
          <Box sx={{ px: 2, pt: 1, pb: 0.5 }}>
            <Typography sx={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.75 }}>
              Top problem SKUs
            </Typography>
            {topSkus.slice(0, 5).map(sku => (
              <Box
                key={sku.lasyncro_variant_id}
                sx={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                  py: 0.6, borderBottom: `0.5px solid ${pal.rule}`,
                  '&:last-child': { borderBottom: 'none' },
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 12, color: 'var(--ink)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sku.title ?? '—'}
                  </Typography>
                  {sku.sku && (
                    <Typography sx={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'monospace' }}>
                      {sku.sku}
                    </Typography>
                  )}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ml: 1, flexShrink: 0 }}>
                  <Box sx={{
                    px: '5px', py: '1px', borderRadius: '4px',
                    bgcolor: alpha(theme.palette.error.main, 0.1),
                    border: `0.5px solid ${alpha(theme.palette.error.main, 0.3)}`,
                  }}>
                    <Typography sx={{ fontSize: 11, fontWeight: 700, color: theme.palette.error.main }}>
                      {sku.exception_count}
                    </Typography>
                  </Box>
                  <AlertTriangle size={11} color={theme.palette.warning.main} />
                </Box>
              </Box>
            ))}
          </Box>

          {/* HEAT GRID */}
          {heatGrid.length > 0 && (
            <>
              <Box sx={{ height: '0.5px', bgcolor: pal.rule, mx: 2 }} />
              <Box sx={{ px: 2, pt: 1 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.75 }}>
                  Exception rate by operator
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 0.6fr 0.6fr', mb: 0.5 }}>
                  {['Operator', 'Pick %', 'Pack %'].map(h => (
                    <Typography key={h} sx={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase' }}>
                      {h}
                    </Typography>
                  ))}
                </Box>
                {heatGrid.slice(0, 5).map(row => {
                  const pickColor = row.pick_exception_rate_pct >= 15
                    ? theme.palette.error.main
                    : row.pick_exception_rate_pct >= 8
                      ? theme.palette.warning.main
                      : theme.palette.success.main;
                  const packColor = row.pack_exception_rate_pct >= 15
                    ? theme.palette.error.main
                    : row.pack_exception_rate_pct >= 8
                      ? theme.palette.warning.main
                      : theme.palette.success.main;
                  return (
                    <Box key={row.user_id} sx={{ display: 'grid', gridTemplateColumns: '1fr 0.6fr 0.6fr', py: 0.4, borderBottom: `0.5px solid ${pal.rule}`, '&:last-child': { borderBottom: 'none' } }}>
                      <Typography sx={{ fontSize: 11, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.name}
                      </Typography>
                      <Typography sx={{ fontSize: 11, fontWeight: 600, color: pickColor, fontVariantNumeric: 'tabular-nums' }}>
                        {row.pick_exception_rate_pct}%
                      </Typography>
                      <Typography sx={{ fontSize: 11, fontWeight: 600, color: packColor, fontVariantNumeric: 'tabular-nums' }}>
                        {row.pack_exception_rate_pct}%
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            </>
          )}
        </Box>
      )}
    </ZoneCard>
  );
}

// ─── ZONE 5 — COST & THROUGHPUT STORY ────────────────────────

function Zone5CostStory({ cost, loading, fmt }: {
  cost: CostStory | undefined;
  loading: boolean;
  fmt: (n: number | null) => string;
}) {
  const pal = useAppTheme();
  const navigate = useNavigate();

  if (!loading && cost && !cost.unlocked) {
    return (
      <ZoneCard>
        <ZoneCardHeader><SectionLabel>Cost & Throughput</SectionLabel></ZoneCardHeader>
        <Box sx={{ px: 2, py: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography sx={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5 }}>
            Add hourly costs in Team to unlock cost-per-order, cost-per-unit, and exception cost.
          </Typography>
          <CtaButton onClick={() => navigate('/team')}>
            Set hourly costs →
          </CtaButton>
        </Box>
      </ZoneCard>
    );
  }

  return (
    <ZoneCard sx={{ flexShrink: 0 }}>
      <ZoneCardHeader><SectionLabel>Cost & Throughput</SectionLabel></ZoneCardHeader>

      {loading && (
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {[1, 2, 3].map(i => <Skeleton key={i} height={48} sx={{ borderRadius: '6px' }} />)}
        </Box>
      )}

      {!loading && cost?.unlocked && (
        <Box sx={{ px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <StatTile
              label="Cost / order"
              value={fmt(cost.cost_per_order)}
              tone="neutral"
            />
            <StatTile
              label="Cost / unit"
              value={fmt(cost.cost_per_unit)}
              tone="neutral"
            />
          </Box>

          {cost.exception_cost != null && (
            <StatTile
              label="Exception cost (period)"
              value={fmt(cost.exception_cost)}
              tone={cost.exception_cost > 100 ? 'warning' : 'neutral'}
            />
          )}

          {/* EDITORIAL LINE */}
          {cost.editorial && (
            <Box sx={{
              mt: 0.5, pt: 1,
              borderTop: `0.5px solid ${pal.rule}`,
            }}>
              <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start' }}>
                <TrendingUp size={13} color="var(--ink-3)" style={{ marginTop: 1, flexShrink: 0 }} />
                <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, fontStyle: 'italic' }}>
                  {cost.editorial}
                </Typography>
              </Box>
            </Box>
          )}
        </Box>
      )}
    </ZoneCard>
  );
}

function CastButton() {
  const pal = useAppTheme();
  const theme = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { show } = useToast();
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const buildUrl = (raw: string) =>
    `${window.location.origin}/wms/analytics/display?token=${encodeURIComponent(raw)}`;

  // Creates a token on demand, returns the raw token immediately.
  // Old tokens persist in DB for heartbeat tracking; cleaned up from Settings.
  const provisionToken = async (): Promise<string> => {
    const { data } = await axiosInstance.post('/api/v1/wms/analytics/display-tokens', { label: 'Cast display' });
    queryClient.invalidateQueries({ queryKey: ['display-tokens'] });
    return data.raw_token as string;
  };

  const handleCopyLink = async () => {
    setBusy(true);
    try {
      const raw = await provisionToken();
      await navigator.clipboard.writeText(buildUrl(raw));
      show('Display link copied to clipboard', 'success');
      setOpen(false);
    } catch (err) {
      console.error('[Cast] copy link failed', err);
      show('Could not create display link', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleOpenDisplay = async () => {
    setBusy(true);
    // Open the tab synchronously to avoid popup blockers, then navigate it once the token is ready.
    const tab = window.open('', '_blank');
    try {
      const raw = await provisionToken();
      if (tab) tab.location.href = buildUrl(raw);
      setOpen(false);
    } catch (err) {
      console.error('[Cast] open display failed', err);
      if (tab) tab.close();
      show('Could not open display', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleClose = (e: MouseEvent | TouchEvent) => {
    if (anchorRef.current?.contains(e.target as Node)) return;
    setOpen(false);
  };

  return (
    <>
      <Tooltip title="Cast to display">
        <Box
          ref={anchorRef}
          onClick={() => setOpen(prev => !prev)}
          sx={{
            display: 'flex', alignItems: 'center', gap: 0.75,
            px: 1.25, py: 0.5, borderRadius: '6px',
            border: `0.5px solid ${open ? 'var(--accent)' : pal.rule}`,
            bgcolor: open ? 'var(--accent-ghost)' : 'transparent',
            cursor: 'pointer', flexShrink: 0,
            '&:hover': { bgcolor: 'var(--bg-2)', borderColor: 'var(--accent)' },
            transition: 'all 0.15s',
          }}
        >
          <Cast size={14} strokeWidth={1.75} color={open ? 'var(--accent)' : 'var(--ink-3)'} />
          <Typography sx={{ fontSize: 12, fontWeight: 500, color: open ? 'var(--accent)' : 'var(--ink-3)' }}>
            Cast
          </Typography>
        </Box>
      </Tooltip>

      <Popper
        open={open}
        anchorEl={anchorRef.current}
        placement="bottom-end"
        disablePortal={false}
        popperOptions={{ modifiers: [{ name: 'offset', options: { offset: [0, 6] } }] }}
        sx={{ zIndex: 1300 }}
      >
        <ClickAwayListener onClickAway={handleClose}>
          <Paper sx={{
            bgcolor: 'var(--surface)', border: `0.5px solid ${pal.rule}`,
            borderRadius: '10px', boxShadow: theme.shadows[8],
            minWidth: 240, overflow: 'hidden',
          }}>
            <Box sx={{ px: 2, py: 1.25, borderBottom: `0.5px solid ${pal.rule}` }}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Cast to Floor Display
              </Typography>
            </Box>

            <Box sx={{ py: 0.5 }}>
              <Box
                onClick={busy ? undefined : handleCopyLink}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.5,
                  px: 2, py: 0.875, cursor: busy ? 'default' : 'pointer',
                  opacity: busy ? 0.5 : 1,
                  '&:hover': { bgcolor: busy ? 'transparent' : 'var(--bg-2)' },
                }}
              >
                <Copy size={14} color="var(--ink-3)" strokeWidth={1.75} />
                <Box>
                  <Typography sx={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.3 }}>Copy display link</Typography>
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>Paste into any TV browser</Typography>
                </Box>
              </Box>

              <Box
                onClick={busy ? undefined : handleOpenDisplay}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.5,
                  px: 2, py: 0.875, cursor: busy ? 'default' : 'pointer',
                  opacity: busy ? 0.5 : 1,
                  '&:hover': { bgcolor: busy ? 'transparent' : 'var(--bg-2)' },
                }}
              >
                <ExternalLink size={14} color="var(--ink-3)" strokeWidth={1.75} />
                <Box>
                  <Typography sx={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.3 }}>Open display now</Typography>
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>Launch in a new tab</Typography>
                </Box>
              </Box>

              <Box sx={{ px: 2, py: 0.875, borderTop: `0.5px solid ${pal.rule}` }}>
                <Typography
                  onClick={() => { setOpen(false); navigate('/settings'); }}
                  sx={{ fontSize: 11, color: 'var(--ink-3)', cursor: 'pointer', '&:hover': { color: 'var(--accent)' } }}
                >
                  Manage displays in Settings →
                </Typography>
              </Box>
            </Box>
          </Paper>
        </ClickAwayListener>
      </Popper>
    </>
  );
}

export default function WmsAnalyticsPage() {
  const [days, setDays] = useState(30);
  const liveQuery = useLiveCapacity();
  const analyticsQuery = useWmsAnalytics(days);
  const { displayCurrency, locale } = useEntitlements();
  const { rates } = useExchangeRates();

  const fmt = (n: number | null) => formatCurrencyCompact(n, displayCurrency, locale, rates);

  const operators  = analyticsQuery.data?.operators ?? [];
  const pipeline   = analyticsQuery.data?.pipeline;
  const exceptions = analyticsQuery.data?.exceptions;
  const cost       = analyticsQuery.data?.cost;
  const loading    = analyticsQuery.isLoading;

  return (
    <PlanGate feature="wms.pick_batches">
      <Box sx={{
        bgcolor: 'var(--bg)',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <ModuleTabBar tabs={[
          { id: 'operations',     label: 'Operations',     path: '/wms' },
          { id: 'floor-planning', label: 'Floor Planning', path: '/floor-planning', requiredTier: 'scale' },
          { id: 'analytics',      label: 'Analytics',      path: '/wms/analytics',  requiredTier: 'growth', feature: 'wms.pick_batches' },
        ]} />

        {/* HEADER */}
        <Box sx={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          px: 2.5, pt: 1.5, pb: 1, flexShrink: 0, flexWrap: 'wrap', gap: 1,
        }}>
          <Box>
            <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2 }}>
              Warehouse Analytics
            </Typography>
            <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mt: '2px' }}>
              Pace, accuracy, and cost signals from your warehouse floor.
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CastButton />
            <ToggleButtonGroup
              value={days} exclusive size="small"
              onChange={(_e, val) => val && setDays(val)}
            >
              <ToggleButton value={7}>7d</ToggleButton>
              <ToggleButton value={30}>30d</ToggleButton>
              <ToggleButton value={90}>90d</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </Box>

        {/* ZONE 1 — CAPACITY STRIP (live, ignores date toggle) */}
        <Zone1CapacityStrip live={liveQuery.data} />

        {/* MAIN GRID — 2 rows × 2 cols
            Row 1: Pipeline Velocity (7) + Cost & Throughput (5)   — summary
            Row 2: Operator Board (7)   + Exception Intel (5)       — detail
            Both rows use flex: 1 so they split the remaining height equally.
        */}
        <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          px: 2.5,
          pb: 2,
          flex: 1,
          overflow: 'hidden',
          minHeight: 0,
        }}>
          {/* ROW 1 — Pipeline + Cost (fixed height, content-driven) */}
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: '7fr 5fr',
            gap: 1.5,
            flexShrink: 0,
          }}>
            <Zone3PipelineVelocity pipeline={pipeline} loading={loading} />
            <Zone5CostStory cost={cost} loading={loading} fmt={fmt} />
          </Box>

          {/* ROW 2 — Operator Board + Exception Intel (equal height, fill remaining) */}
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: '7fr 5fr',
            gap: 1.5,
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
          }}>
            <Zone2OperatorBoard operators={operators} loading={loading} />
            <Zone4ExceptionIntel exceptions={exceptions} loading={loading} />
          </Box>
        </Box>
      </Box>
    </PlanGate>
  );
}