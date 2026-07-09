/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/ft2-pages/WmsAnalyticsPage.tsx
//
// WAREHOUSE ANALYTICS — FT2 Owner surface
//
// RULES: No alpha(). No useTheme(). No fontFamily overrides. No hardcoded hex except severity tokens.
//        CSS variables only for adaptive colors (var(--surface), var(--rule), var(--ink-*), var(--bg-*)).
//        Severity/status: #4CAF7A ok · #D9A23B watch · #E5484D critical · #F2555A critical-text.

import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, ToggleButtonGroup, ToggleButton, Skeleton,
  Popper, Paper, ClickAwayListener, Tooltip,
} from '@mui/material';
import { AlertTriangle, TrendingUp, Clock, ArrowRight, Cast, ExternalLink, Copy } from 'lucide-react';
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
  AgingWip,
  ExceptionTrend,
  ThroughputTrend,
} from '../wms/useWmsAnalytics';
import { useEntitlements } from '../../contexts/EntitlementsContext';
import { useExchangeRates } from '../../hooks/useExchangeRates';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
import { useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from '../../api/axiosConfig';
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

// Severity palette baked in to avoid alpha() calls
const ON_TRACK_PALETTE = {
  green: { color: '#4CAF7A', bg: 'rgba(76,175,122,0.1)',  bd: 'rgba(76,175,122,0.3)',  label: 'On track' },
  amber: { color: '#D9A23B', bg: 'rgba(217,162,59,0.1)',  bd: 'rgba(217,162,59,0.3)',  label: 'At risk'  },
  red:   { color: '#E5484D', bg: 'rgba(229,72,77,0.1)',   bd: 'rgba(229,72,77,0.3)',   label: 'Behind'   },
} as const;
type TrackKey = keyof typeof ON_TRACK_PALETTE;

const TONE_COLORS: Record<string, string> = {
  positive: '#4CAF7A',
  negative: '#E5484D',
  warning:  '#D9A23B',
};

// ─── SHARED SUB-COMPONENTS ────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{ fontSize: 10.5, fontWeight: 500, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.12em', mb: 1 }}>
      {children}
    </Typography>
  );
}

function ZoneCard({ children, sx = {} }: { children: React.ReactNode; sx?: object }) {
  return (
    <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '12px', overflow: 'hidden', ...sx }}>
      {children}
    </Box>
  );
}

function ZoneCardHeader({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid var(--rule)' }}>
      {children}
    </Box>
  );
}

function StatTile({ label, value, sub, tone }: {
  label: string; value: string; sub?: string;
  tone?: 'positive' | 'negative' | 'warning' | 'neutral';
}) {
  const color = (tone && tone !== 'neutral') ? (TONE_COLORS[tone] ?? 'var(--ink)') : 'var(--ink)';
  return (
    <Box sx={{ flex: 1, minWidth: 0, p: '0.85rem 1rem', bgcolor: 'var(--bg-2)', borderRadius: '6px' }}>
      <Typography sx={{ fontSize: 10.5, fontWeight: 500, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.12em', mb: 0.5 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
        {value}
      </Typography>
      {sub && <Typography sx={{ fontSize: 11, fontWeight: 300, color, mt: '2px' }}>{sub}</Typography>}
    </Box>
  );
}

function EmptyZone({ label }: { label: string }) {
  return (
    <Box sx={{ py: 1.25, px: 2, display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#4CAF7A', flexShrink: 0 }} />
      <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>{label}</Typography>
    </Box>
  );
}

function CtaButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <Box
      onClick={onClick}
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.5, fontSize: 12, fontWeight: 600, bgcolor: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.88 }, transition: 'opacity 0.1s' }}
    >
      {children}
    </Box>
  );
}

// ─── ZONE 1 — TODAY'S CAPACITY ────────────────────────────────

function PipelinePip({ label, count, accent }: { label: string; count: number; accent?: boolean }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 56 }}>
      <Typography sx={{ fontSize: 18, fontWeight: 700, color: accent ? 'var(--accent)' : 'var(--ink)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
        {count}
      </Typography>
      <Typography sx={{ fontSize: 10, fontWeight: 300, color: 'var(--ink-3)', mt: '2px', textAlign: 'center', whiteSpace: 'nowrap' }}>
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
  const trackKey  = live?.on_track as TrackKey | undefined;
  const trackCfg  = trackKey ? ON_TRACK_PALETTE[trackKey] : null;
  const trackColor = trackCfg?.color ?? 'var(--ink-4)';

  const formatCpt = (hours: number | null, cptLocal: string | null): string => {
    if (cptLocal == null) return '—';
    const timeLabel = cptLocal.slice(0, 5);
    if (hours == null || hours <= 0) return `${timeLabel} (passed)`;
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return h > 0 ? `${h}h ${m}m to ${timeLabel}` : `${m}m to ${timeLabel}`;
  };

  return (
    <ZoneCard>
      <ZoneCardHeader><SectionLabel>Live Capacity</SectionLabel></ZoneCardHeader>
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.25 }}>

        {/* PIPELINE STAGES — vertical rows */}
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {[
            { label: 'Awaiting pick', value: live?.pipeline.awaiting_pick ?? 0, accent: false },
            { label: 'Picking',       value: live?.pipeline.picking ?? 0,       accent: false },
            { label: 'Packing',       value: live?.pipeline.packing ?? 0,       accent: false },
            { label: 'Ship-ready',    value: live?.pipeline.ship_ready ?? 0,    accent: false },
            { label: 'Shipped today', value: live?.shipped_today ?? 0,          accent: true  },
          ].map((row) => (
            <Box key={row.label} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.65, borderBottom: '1px solid var(--rule)', '&:last-child': { borderBottom: 'none' } }}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'var(--ink-3)' }}>{row.label}</Typography>
              <Typography sx={{ fontSize: 16, fontWeight: 600, color: row.accent ? 'var(--accent)' : 'var(--ink)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{row.value}</Typography>
            </Box>
          ))}
        </Box>

        {/* SHIPPED SPLIT — WMS scan vs legacy (WA-06) */}
        {(live?.shipped_today ?? 0) > 0 && (
          <Box sx={{ display: 'flex', gap: 0.75 }}>
            <Box sx={{ flex: 1, p: '6px 8px', borderRadius: '6px', bgcolor: 'var(--bg-2)', border: '1px solid var(--rule)' }}>
              <Typography sx={{ fontSize: 9.5, fontWeight: 500, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Scanned</Typography>
              <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{live?.shipped_via_wms ?? 0}</Typography>
            </Box>
            <Box sx={{ flex: 1, p: '6px 8px', borderRadius: '6px', bgcolor: 'var(--bg-2)', border: '1px solid var(--rule)' }}>
              <Typography sx={{ fontSize: 9.5, fontWeight: 500, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Legacy</Typography>
              <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{live?.shipped_via_legacy ?? 0}</Typography>
            </Box>
          </Box>
        )}

        <Box sx={{ height: '1px', bgcolor: 'var(--rule)' }} />

        {/* ON SHIFT + UPH */}
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <Typography sx={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>On shift</Typography>
            <Typography sx={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
              {live?.operators_on_shift ?? '—'}
              <Typography component="span" sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)', ml: 0.5 }}>ops</Typography>
            </Typography>
          </Box>
          {live?.live_uph != null && (
            <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <Typography sx={{ fontSize: 10, fontWeight: 500, color: trackColor, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                Live UPH
              </Typography>
              <Typography sx={{ fontSize: 18, fontWeight: 700, color: trackColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
                {live.live_uph}
                {live?.required_uph != null && (
                  <Typography component="span" sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)', ml: 0.5 }}>/ {live.required_uph} req</Typography>
                )}
              </Typography>
            </Box>
          )}
        </Box>

        {/* CPT COUNTDOWN */}
        {live?.cpt_local && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Cutoff</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Clock size={13} color={live?.hours_to_cpt != null && live.hours_to_cpt > 0 ? 'var(--ink-3)' : 'var(--ink-4)'} />
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: live?.hours_to_cpt != null && live.hours_to_cpt > 0 ? 'var(--ink)' : 'var(--ink-4)', fontVariantNumeric: 'tabular-nums' }}>
                {formatCpt(live?.hours_to_cpt ?? null, live?.cpt_local ?? null)}
              </Typography>
            </Box>
          </Box>
        )}

        {/* ON-TRACK SIGNAL */}
        {trackCfg && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.5, borderRadius: '20px', bgcolor: trackCfg.bg, border: `1px solid ${trackCfg.bd}`, alignSelf: 'flex-start' }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: trackCfg.color, flexShrink: 0 }} />
            <Typography sx={{ fontSize: 12, fontWeight: 600, color: trackCfg.color, lineHeight: 1 }}>{trackCfg.label}</Typography>
          </Box>
        )}
      </Box>
    </ZoneCard>
  );
}

// ─── ZONE 2 — OPERATOR PERFORMANCE BOARD ─────────────────────

type BaselineMode = 'personal' | 'team';

function Zone2OperatorBoard({ operators, loading }: { operators: OperatorPerf[]; loading: boolean }) {
  const navigate = useNavigate();
  const [baseline, setBaseline] = useState<BaselineMode>('personal');
  const COLS = '2fr 0.7fr 0.7fr 0.8fr 0.8fr 0.7fr 0.7fr';
  const COL_HEADERS = ['Operator', 'Units pick', 'Units pack', 'UPH', 'Accuracy', 'Exceptions', 'Avg batch'];

  const teamAvgUph = (() => {
    const valid = operators.filter(op => op.uph != null).map(op => op.uph!);
    return valid.length > 0 ? Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10 : null;
  })();

  const uphColor = (uph: number | null): string => {
    if (uph == null) return 'var(--ink-3)';
    if (baseline === 'personal') {
      if (uph >= 40) return '#4CAF7A';
      if (uph >= 25) return '#D9A23B';
      return '#E5484D';
    }
    if (teamAvgUph == null) return 'var(--ink-3)';
    if (uph >= teamAvgUph) return '#4CAF7A';
    if (uph >= teamAvgUph * 0.9) return '#D9A23B';
    return '#E5484D';
  };

  const accColor = (pct: number | null): string => {
    if (pct == null) return 'var(--ink-3)';
    if (pct >= 95) return '#4CAF7A';
    if (pct >= 85) return '#D9A23B';
    return '#E5484D';
  };

  const visible = operators.slice(0, 7);
  const hasMore = operators.length > 7;

  return (
    <ZoneCard sx={{ display: 'flex', flexDirection: 'column' }}>
      <ZoneCardHeader>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent:'space-between' }}>
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
          <Box sx={{ display: 'grid', gridTemplateColumns: COLS, px: 2, py: 0.75, borderBottom: '1px solid var(--rule)' }}>
            {COL_HEADERS.map(h => (
              <Typography key={h} sx={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
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
                sx={{ display: 'grid', gridTemplateColumns: COLS, px: 2, py: 0.75, borderBottom: '1px solid var(--rule)', '&:last-child': { borderBottom: 'none' }, cursor: 'pointer', '&:hover': { bgcolor: 'var(--bg-2)' }, transition: 'background 0.1s' }}
              >
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3 }}>
                    {fmtName(op.first_name, op.last_name)}
                  </Typography>
                  <Typography sx={{ fontSize: 10, fontWeight: 300, color: 'var(--ink-3)' }}>{op.role}</Typography>
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
                <Typography sx={{ fontSize: 13, fontWeight: 500, color: op.exception_count > 0 ? '#D9A23B' : 'var(--ink)', fontVariantNumeric: 'tabular-nums', alignSelf: 'center' }}>
                  {op.exception_count}
                </Typography>
                <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums', alignSelf: 'center' }}>
                  {fmtSeconds(op.avg_batch_seconds)}
                </Typography>
              </Box>
            ))}
          </Box>

          {hasMore && (
            <Box sx={{ px: 2, py: 0.75, borderTop: '1px solid var(--rule)' }}>
              <Typography
                onClick={() => navigate('/team')}
                sx={{ fontSize: 12, fontWeight: 500, color: 'var(--accent)', cursor: 'pointer', '&:hover': { opacity: 0.8 } }}
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
  const stages = pipeline?.stages;
  const allStages = [
    { label: 'Released → Picking', s: stages?.released_to_picking_s ?? null, color: '#3B82F6' },
    { label: 'Picking',            s: stages?.picking_s ?? null,             color: '#4CAF7A' },
    { label: 'Packing',            s: stages?.packing_s ?? null,             color: '#D9A23B' },
    { label: 'Ship',               s: stages?.packed_to_shipped_s ?? null,   color: '#F2555A' },
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
                  <Box key={st.label} sx={{ flex: st.s, bgcolor: st.color, minWidth: '4px' }} title={`${st.label}: ${fmtSeconds(st.s)}`} />
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
                  <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)' }}>{st.label}</Typography>
                  <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtSeconds(st.s)}
                  </Typography>
                </Box>
              ))}
            </Box>

            {/* LATENCY CALLOUTS */}
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Box sx={{ flex: 1, p: 1, borderRadius: '6px', bgcolor: 'var(--bg-2)', border: '1px solid var(--rule)' }}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                  Receive → pickable
                </Typography>
                <Typography sx={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtHours(pipeline?.latencies.receive_to_pickable_hours ?? null)}
                </Typography>
                {(pipeline?.latencies.receive_to_pickable_samples ?? 0) > 0 && (
                  <Typography sx={{ fontSize: 10, fontWeight: 300, color: 'var(--ink-3)' }}>
                    avg · {pipeline?.latencies.receive_to_pickable_samples} POs
                  </Typography>
                )}
              </Box>
              <Box sx={{ flex: 1, p: 1, borderRadius: '6px', bgcolor: 'var(--bg-2)', border: '1px solid var(--rule)' }}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                  Return → restocked
                </Typography>
                <Typography sx={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtHours(pipeline?.latencies.return_to_restock_hours ?? null)}
                </Typography>
                <Typography sx={{ fontSize: 10, fontWeight: 300, color: 'var(--ink-3)' }}>avg turnaround</Typography>
              </Box>
            </Box>
          </>
        )}
      </Box>
    </ZoneCard>
  );
}

// ─── ZONE 5 — COST & THROUGHPUT STORY ────────────────────────

function Zone5CostStory({ cost, loading, fmt }: {
  cost: CostStory | undefined; loading: boolean;
  fmt: (n: number | null) => string;
}) {
  const navigate = useNavigate();

  if (!loading && cost && !cost.unlocked) {
    return (
      <ZoneCard>
        <ZoneCardHeader><SectionLabel>Cost & Throughput</SectionLabel></ZoneCardHeader>
        <Box sx={{ px: 2, py: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)', lineHeight: 1.5 }}>
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
            <StatTile label="Cost / order" value={fmt(cost.cost_per_order)} tone="neutral" />
            <StatTile label="Cost / unit"  value={fmt(cost.cost_per_unit)}  tone="neutral" />
          </Box>

          {cost.exception_cost != null && (
            <StatTile
              label="Exception cost (period)"
              value={fmt(cost.exception_cost)}
              tone={cost.exception_cost > 100 ? 'warning' : 'neutral'}
            />
          )}

          {cost.editorial && (
            <Box sx={{ mt: 0.5, pt: 1, borderTop: '1px solid var(--rule)' }}>
              <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start' }}>
                <TrendingUp size={13} color="var(--ink-3)" style={{ marginTop: 1, flexShrink: 0 }} />
                <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', lineHeight: 1.5, fontStyle: 'italic' }}>
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

// ─── CAST BUTTON ──────────────────────────────────────────────

function CastButton() {
  const navigate     = useNavigate();
  const queryClient  = useQueryClient();
  const { show }     = useToast();
  const anchorRef    = useRef<HTMLDivElement | null>(null);
  const [open, setOpen]   = useState(false);
  const [busy, setBusy]   = useState(false);

  const buildUrl = (raw: string) =>
    `${window.location.origin}/wms/analytics/display?token=${encodeURIComponent(raw)}`;

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
            px: 1.25, py: 0.5, borderRadius: '8px',
            border: `1px solid ${open ? 'var(--accent)' : 'var(--rule)'}`,
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
            bgcolor: 'var(--surface)',
            border: '1px solid var(--rule)',
            borderRadius: '12px',
            boxShadow: '0 8px 28px rgba(15,14,13,0.08)',
            minWidth: 240, overflow: 'hidden',
          }}>
            <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid var(--rule)' }}>
              <Typography sx={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                Cast to Floor Display
              </Typography>
            </Box>

            <Box sx={{ py: 0.5 }}>
              <Box
                onClick={busy ? undefined : handleCopyLink}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 0.875, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1, '&:hover': { bgcolor: busy ? 'transparent' : 'var(--bg-2)' } }}
              >
                <Copy size={14} color="var(--ink-3)" strokeWidth={1.75} />
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3 }}>Copy display link</Typography>
                  <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>Paste into any TV browser</Typography>
                </Box>
              </Box>

              <Box
                onClick={busy ? undefined : handleOpenDisplay}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 0.875, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1, '&:hover': { bgcolor: busy ? 'transparent' : 'var(--bg-2)' } }}
              >
                <ExternalLink size={14} color="var(--ink-3)" strokeWidth={1.75} />
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3 }}>Open display now</Typography>
                  <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>Launch in a new tab</Typography>
                </Box>
              </Box>

              <Box sx={{ px: 2, py: 0.875, borderTop: '1px solid var(--rule)' }}>
                <Typography
                  onClick={() => { setOpen(false); navigate('/settings'); }}
                  sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)', cursor: 'pointer', '&:hover': { color: 'var(--accent)' } }}
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

// ─── AGING WIP — what's stuck on the floor ───────────────────
const WIP_STAGES: { key: string; label: string }[] = [
  { key: 'picking', label: 'Picking' },
  { key: 'picked',  label: 'Picked'  },
  { key: 'packing', label: 'Packing' },
  { key: 'packed',  label: 'Packed'  },
];
function ageColor(s: number): string {
  return s >= 14400 ? '#E5484D' : s >= 7200 ? '#D9A23B' : 'var(--ink-3)';
}
function AgingWipCard({ wip, loading }: { wip: AgingWip | undefined; loading: boolean }) {
  if (loading) return <ZoneCard sx={{ flexShrink: 0 }}><ZoneCardHeader><SectionLabel>Stuck on the floor</SectionLabel></ZoneCardHeader><Box sx={{ p: 2 }}><Skeleton height={80} /></Box></ZoneCard>;
  const total = wip?.total ?? 0;
  return (
    <ZoneCard sx={{ flexShrink: 0 }}>
      <ZoneCardHeader>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <SectionLabel>Stuck on the floor</SectionLabel>
          {total > 0 && (
            <Typography sx={{ fontSize: 11, fontWeight: 600, color: ageColor(wip?.oldest_overall_s ?? 0), fontVariantNumeric: 'tabular-nums' }}>
              oldest {fmtSeconds(wip?.oldest_overall_s ?? 0)}
            </Typography>
          )}
        </Box>
      </ZoneCardHeader>
      {total === 0 ? (
        <EmptyZone label="Floor is clear — nothing mid-flight." />
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, p: 2 }}>
          {WIP_STAGES.map(s => {
            const cell = wip?.by_stage?.[s.key] ?? { count: 0, oldest_age_s: 0 };
            return (
              <Box key={s.key} sx={{ p: 1.25, borderRadius: '8px', bgcolor: 'var(--bg-2)', border: '1px solid var(--rule)' }}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</Typography>
                <Typography sx={{ fontSize: 22, fontWeight: 700, color: cell.count > 0 ? 'var(--ink)' : 'var(--ink-4)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{cell.count}</Typography>
                {cell.count > 0 && (
                  <Typography sx={{ fontSize: 10.5, fontWeight: 600, color: ageColor(cell.oldest_age_s), fontVariantNumeric: 'tabular-nums' }}>{fmtSeconds(cell.oldest_age_s)}</Typography>
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </ZoneCard>
  );
}

// ─── THROUGHPUT TREND — daily UPH sparkline ──────────────────
function ThroughputTrendCard({ trend, loading }: { trend: ThroughputTrend | undefined; loading: boolean }) {
  const fillSx = { flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' } as const;

  if (loading) return <ZoneCard sx={fillSx}><ZoneCardHeader><SectionLabel>Throughput trend</SectionLabel></ZoneCardHeader><Box sx={{ p: 2 }}><Skeleton height={80} /></Box></ZoneCard>;
  const pts = (trend?.points ?? []).filter(p => p.uph != null);
  const max = pts.reduce((m, p) => Math.max(m, p.uph as number), 0) || 1;
  return (
    <ZoneCard sx={fillSx}>
      <ZoneCardHeader>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <SectionLabel>Throughput trend</SectionLabel>
          {trend?.avg_uph != null && (
            <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)' }}>avg <Typography component="span" sx={{ fontWeight: 600, color: 'var(--ink)' }}>{trend.avg_uph}</Typography> UPH</Typography>
          )}
        </Box>
      </ZoneCardHeader>
      {pts.length === 0 ? (
        <EmptyZone label="No completed picks in this period yet." />
      ) : pts.length === 1 ? (
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 100, gap: 0.5 }}>
          <Typography sx={{ fontSize: 32, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{trend?.latest_uph ?? '—'}</Typography>
          <Typography sx={{ fontSize: 11.5, fontWeight: 300, color: 'var(--ink-3)' }}>units/hr · 1 active day</Typography>
          <Typography sx={{ fontSize: 10.5, fontWeight: 300, color: 'var(--ink-4)' }}>Trend builds as more days complete</Typography>
        </Box>
      ) : (
        <Box sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, height: 80 }}>
            {pts.map((p, i) => (
              <Box key={i} title={`${p.day}: ${p.uph} UPH`} sx={{ flex: 1, minWidth: 3, maxWidth: 48, height: `${Math.max(6, ((p.uph as number) / max) * 100)}%`, bgcolor: i === pts.length - 1 ? 'var(--accent)' : 'var(--accent-ghost)', borderRadius: '3px 3px 0 0', transition: 'height 0.2s' }} />
            ))}
          </Box>
          <Typography sx={{ fontSize: 10.5, fontWeight: 300, color: 'var(--ink-4)', mt: 1 }}>
            Latest <Typography component="span" sx={{ fontWeight: 600, color: 'var(--ink)' }}>{trend?.latest_uph ?? '—'}</Typography> units/hr · last {pts.length} active days
          </Typography>
        </Box>
      )}
    </ZoneCard>
  );
}

// ─── EXCEPTION TREND — by type ───────────────────────────────
const EXC_LABELS: Record<string, string> = {
  item_missing: 'Missing', short_pick: 'Short pick', product_defect: 'Product defect',
  packaging_defect: 'Packaging', wrong_item: 'Wrong item',
};

function ExceptionsCard({ trend, exceptions, loading }: { trend: ExceptionTrend | undefined; exceptions: ExceptionIntelligence | undefined; loading: boolean }) {
  const navigate = useNavigate();
  const byType = trend?.by_type ?? {};
  const rows = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const max = rows.reduce((m, [, v]) => Math.max(m, v), 0) || 1;
  const topSkus = exceptions?.top_skus ?? [];
  const heatGrid = exceptions?.heat_grid ?? [];
  const rateColor = (pct: number): string => pct >= 15 ? '#E5484D' : pct >= 8 ? '#D9A23B' : '#4CAF7A';
  const hasAny = rows.length > 0 || topSkus.length > 0;

  if (loading) return <ZoneCard sx={{ flex: '1 1 0' }}><ZoneCardHeader><SectionLabel>Exceptions</SectionLabel></ZoneCardHeader><Box sx={{ p: 2 }}><Skeleton height={80} /></Box></ZoneCard>;

  return (
    <ZoneCard sx={{ display: 'flex', flexDirection: 'column' }}>
      <ZoneCardHeader>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <SectionLabel>Exceptions</SectionLabel>
          {(trend?.total ?? 0) > 0 ? (
            <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)' }}>
              <Typography component="span" sx={{ fontWeight: 600, color: '#E5484D' }}>{trend?.open_total ?? 0}</Typography> open / {trend?.total} total
            </Typography>
          ) : topSkus.length > 0 ? (
            <Typography onClick={() => navigate('/wms/problem-center')} sx={{ fontSize: 11, fontWeight: 500, color: 'var(--accent)', cursor: 'pointer', '&:hover': { opacity: 0.8 } }}>
              Problem center →
            </Typography>
          ) : null}
        </Box>
      </ZoneCardHeader>

      {!hasAny ? (
        <EmptyZone label="No exceptions this period — picks are clean." />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {/* BY TYPE */}
          {rows.length > 0 && (
            <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {rows.map(([type, count]) => (
                <Box key={type} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography sx={{ fontSize: 11.5, fontWeight: 300, color: 'var(--ink-3)', width: 96, flexShrink: 0 }}>{EXC_LABELS[type] ?? type}</Typography>
                  <Box sx={{ flex: 1, height: 8, borderRadius: '4px', bgcolor: 'var(--bg-3)', overflow: 'hidden' }}>
                    <Box sx={{ width: `${(count / max) * 100}%`, height: '100%', bgcolor: '#E5484D', borderRadius: '4px' }} />
                  </Box>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', width: 20, textAlign: 'right' }}>{count}</Typography>
                </Box>
              ))}
            </Box>
          )}

          {/* TOP SKUS */}
          {topSkus.length > 0 && (
            <>
              <Box sx={{ height: '1px', bgcolor: 'var(--rule)', mx: 2 }} />
              <Box sx={{ px: 2, pt: 1, pb: 0.5 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.12em', mb: 0.75 }}>Top problem SKUs</Typography>
                {topSkus.slice(0, 5).map(sku => (
                  <Box key={sku.lasyncro_variant_id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', py: 0.6, borderBottom: '1px solid var(--rule)', '&:last-child': { borderBottom: 'none' } }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sku.title ?? '—'}</Typography>
                      {sku.sku && <Typography sx={{ fontSize: 10, fontWeight: 300, color: 'var(--ink-3)' }}>{sku.sku}</Typography>}
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ml: 1, flexShrink: 0 }}>
                      <Box sx={{ px: '5px', py: '1px', borderRadius: '4px', bgcolor: 'rgba(229,72,77,0.1)', border: '1px solid rgba(229,72,77,0.3)' }}>
                        <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#E5484D' }}>{sku.exception_count}</Typography>
                      </Box>
                      <AlertTriangle size={11} color="#D9A23B" />
                    </Box>
                  </Box>
                ))}
              </Box>
            </>
          )}

          {/* HEAT GRID */}
          {heatGrid.length > 0 && (
            <>
              <Box sx={{ height: '1px', bgcolor: 'var(--rule)', mx: 2 }} />
              <Box sx={{ px: 2, pt: 1, pb: 1.5 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.12em', mb: 0.75 }}>Exception rate by operator</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 0.6fr 0.6fr', mb: 0.5 }}>
                  {['Operator', 'Pick %', 'Pack %'].map(h => (
                    <Typography key={h} sx={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.10em' }}>{h}</Typography>
                  ))}
                </Box>
                {heatGrid.slice(0, 5).map(row => (
                  <Box key={row.user_id} sx={{ display: 'grid', gridTemplateColumns: '1fr 0.6fr 0.6fr', py: 0.4, borderBottom: '1px solid var(--rule)', '&:last-child': { borderBottom: 'none' } }}>
                    <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</Typography>
                    <Typography sx={{ fontSize: 11, fontWeight: 600, color: rateColor(row.pick_exception_rate_pct), fontVariantNumeric: 'tabular-nums' }}>{row.pick_exception_rate_pct}%</Typography>
                    <Typography sx={{ fontSize: 11, fontWeight: 600, color: rateColor(row.pack_exception_rate_pct), fontVariantNumeric: 'tabular-nums' }}>{row.pack_exception_rate_pct}%</Typography>
                  </Box>
                ))}
              </Box>
            </>
          )}
        </Box>
      )}
    </ZoneCard>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────

export default function WmsAnalyticsPage() {
  const [days, setDays] = useState(30);
  const liveQuery      = useLiveCapacity();
  const analyticsQuery = useWmsAnalytics(days);
  const { displayCurrency, locale } = useEntitlements();
  const { rates } = useExchangeRates();

  const fmt = (n: number | null) => formatCurrencyCompact(n, displayCurrency, locale, rates);

  const operators  = analyticsQuery.data?.operators ?? [];
  const pipeline   = analyticsQuery.data?.pipeline;
  const exceptions = analyticsQuery.data?.exceptions;
  const cost       = analyticsQuery.data?.cost;
  const agingWip   = analyticsQuery.data?.aging_wip;
  const throughput = analyticsQuery.data?.throughput_trend;
  const excTrend   = analyticsQuery.data?.exception_trend;
  const loading    = analyticsQuery.isLoading;

  return (
    <PlanGate feature="wms.pick_batches">
      <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        <ModuleTabBar tabs={[
          { id: 'operations',     label: 'Operations',     path: '/wms' },
          { id: 'floor-planning', label: 'Floor Planning', path: '/floor-planning', requiredTier: 'scale' },
          { id: 'analytics',      label: 'Analytics',      path: '/wms/analytics',  requiredTier: 'growth', feature: 'wms.pick_batches' },
          { id: 'product-issues', label: 'Problem Center', path: '/problem-center', requiredTier: 'scale' },
        ]} />

        {/* HEADER */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', px: 2.5, pt: 2, pb: 1.25, flexShrink: 0, flexWrap: 'wrap', gap: 1 }}>
          <Box>
            <Typography sx={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }}>
              Warehouse Analytics
            </Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
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

        {/* MAIN GRID — dense main column + 300px pulse rail (Orders-sibling) */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, px: 2.5, pb: 2, alignItems: 'stretch' }}>
          {/* MAIN COLUMN — operator + pipeline first, then stacked detail */}
          <Box sx={{ flex: '1 1 460px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}><Zone2OperatorBoard operators={operators} loading={loading} /></Box>
            <Zone3PipelineVelocity pipeline={pipeline} loading={loading} />
            <AgingWipCard wip={agingWip} loading={loading} />
            <ExceptionsCard trend={excTrend} exceptions={exceptions} loading={loading} />
            <Zone5CostStory cost={cost} loading={loading} fmt={fmt} />
          </Box>

          {/* PULSE RAIL — live capacity + throughput, fixed 300px */}
          <Box sx={{ flex: '1 1 300px', maxWidth: { xs: '100%', lg: 300 }, display: 'flex', flexDirection: 'column', gap: 1.5, alignSelf: 'stretch', minHeight: 0 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column' }}><Zone1CapacityStrip live={liveQuery.data} /></Box>
            <ThroughputTrendCard trend={throughput} loading={loading} />
          </Box>
        </Box>
      </Box>
    </PlanGate>
  );
}
