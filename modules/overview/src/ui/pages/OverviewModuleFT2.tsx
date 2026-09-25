// modules/overview/src/ui/pages/OverviewModuleFT2.tsx
//
// OVERVIEW
//
// OV-V1 LAYOUT (operationsPulse present — the production page):
//   HEADER (date · greeting)
//   ────────────────────────────────────────────────────────────
//   BODY  [  Live map / mapContent (~75%)  |  OPERATIONS PULSE (~25%)  ]
//   (no mapContent → Operations Pulse is the primary body surface)
//
// LEGACY COMPATIBILITY LAYOUT (operationsPulse absent) — "A: Triage-first":
//   HEADER (greeting · date · summary · page actions)
//   ────────────────────────────────────────────────────────────
//   BODY  [  Needs a decision (flex-1)  |  TODAY'S FLOW (280px)  ]
//
// RULES: No alpha(). No useTheme(). No fontFamily overrides. No 0.5px borders.
//        CSS vars for adaptive colors; direct hex only for severity tokens.
//        Severity palette: #E5484D critical · #D9A23B watch · #4CAF7A on-track.

import { Fragment, useState, type ReactNode } from 'react';
import { Box, Collapse, Typography, Skeleton } from '@mui/material';
import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { formatCurrencyCompact, ModuleErrorBoundary, PulseCard, PulseCardRowData, PulseTone } from '@lasyncro/shared/ui';
import { buildDecisionPendingSummary, revenueImpactLabel } from './overviewSemantics.js';

// ─── TYPES ────────────────────────────────────────────────────

export interface OverviewModuleFT2DataProps {
  trust: {
    dataFreshness: 'fresh' | 'stale' | 'unknown' | null;
    syncCoverage: 'complete' | 'partial' | 'missing' | 'unknown' | null;
    crossSourceConsistency: 'consistent' | 'inconsistent' | 'unknown' | null;
    trustEligible: boolean | null;
  } | null;
  context: {
    ordersObserved: number | null;
    productsObserved: number | null;
    customersObserved: number | null;
  };
  snapshot: {
    orders: { revenueTotal: number | null; currency: string | null } | null;
    products: null;
    customers: null;
  };
  alignment: {
    demandReality?: 'aligned' | 'divergent' | 'unknown';
    operationalEconomic?: 'aligned' | 'divergent' | 'unknown';
    engagementRevenue?: 'aligned' | 'divergent' | 'unknown';
  } | null;
  pulse: {
    /** Today's gross revenue. */
    revenueToday: number | null;
    /** Delta vs yesterday's gross revenue. */
    revenueDeltaVsYesterday: number | null;
    /** Revenue exposed but not yet lost. */
    atRiskRevenue: number | null;
    /** Revenue blocked from shipping. */
    blockedRevenue: number | null;
    /** Dominant block domain: inventory | customer | operational | none. */
    topBlockingType: string | null;
  } | null;
  userName?: string | null;
  currency?: string;
  morningBrief?: {
    signals: {
      id: string;
      priority: 1 | 2 | 3 | 4 | 5;
      title: string;
      detail: string;
      module: string;
      deepLink: string;
      revenueImpact: number | null;
      /** Original alert_type from the alerts aggregator — e.g. "sla_breach", "revenue_at_risk". */
      alertType?: string;
      /** Short age/recency label — e.g. "14d oldest", "6 orders". Server-provided. */
      ageLabel?: string | null;
      /** Specific CTA label — e.g. "Review queue", "Reorder". Falls back to module default. */
      actionLabel?: string | null;
      /** Expandable sub-items (SKUs, orders, etc.) */
      tags?: string[];
    }[];
    hasUrgentIssues: boolean;
    generatedAt: string;
    trustWarning: boolean;
    greeting: string | null;
    summaryLine: string | null;
  } | null;
}

export interface OverviewOperationsPulse {
  orders: {
    readyCount: number;
    blockedCount: number;
    blockedRevenue: number;
    pastSlaCount: number;
    pastSlaRevenue: number;
  };
  fulfillment: {
    activeBatchCount: number;
    pickingBatchCount: number;
    packingBatchCount: number;
  };
  inventory: {
    awaitingInventoryCount: number;
    awaitingInventoryRevenue: number;
  };
  inbound: {
    receiveAtDockUnits: number;
    awaitingStowUnits: number;
  };
}

export type OverviewModuleFT2Props = OverviewModuleFT2DataProps & {
  /**
   * Consolidated state for operational warnings rendered outside Morning Brief.
   * `unknown` prevents positive copy while those sources are loading or failed.
   */
  operationalWarningState: 'clear' | 'warning' | 'unknown';
  /**
   * UX-OWNERSHIP-01: Overview is status-only. Global Ops Console is the
   * external action owner, with the top nav as its sole entry point.
   * onNavigate may still be supplied for compatibility but is
   * no longer invoked by Overview's signal/pulse presentation.
   */
  onNavigate?: (deepLink: string) => void;
  onRefreshBrief?: () => void;
  isRefreshingBrief?: boolean;
  onResolveAll?: () => void;
  /**
   * Rendered in the 75% map slot.
   * When absent the module falls back to the triage-first layout.
   * Tier gate and zone guard are resolved by the page layer — module is layout-only.
   */
  mapContent?: ReactNode;
  /**
   * OV-V1: structured Operations Pulse values, composed by the page from
   * canonical sources. Optional while existing consumers migrate; not yet
   * rendered (visual composition lands in a later slice).
   */
  operationsPulse?: OverviewOperationsPulse;
};

type Signal = NonNullable<NonNullable<OverviewModuleFT2DataProps['morningBrief']>['signals'][number]>;

// ─── CONSTANTS ────────────────────────────────────────────────

const TRIAGE_PREVIEW_LIMIT = 3;

// Baked severity palette — no alpha() needed
const SEV = {
  critical: {
    color:  '#E5484D',
    bgBand: 'rgba(229,72,77,0.06)',
    badge:  'rgba(229,72,77,0.12)',
    band:   'CRITICAL — ACT TODAY',
  },
  watch: {
    color:  '#D9A23B',
    bgBand: 'rgba(217,162,59,0.06)',
    badge:  'rgba(217,162,59,0.12)',
    band:   'WATCH',
  },
  ontrack: {
    color:  '#4CAF7A',
    bgBand: 'rgba(76,175,122,0.05)',
    badge:  'rgba(76,175,122,0.10)',
    band:   'EVERYTHING ELSE',
  },
} as const;

const refreshButtonSx = (isRefreshingBrief: boolean, refreshRotationDeg: number, withAutoMargin = false) => ({
  ...(withAutoMargin ? { ml: 'auto' } : {}),
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--accent)',
  bgcolor: 'transparent',
  border: 'none',
  cursor: isRefreshingBrief ? 'wait' : 'pointer',
  opacity: isRefreshingBrief ? 0.6 : 1,
  p: 0,
  transition: 'opacity 0.2s',
  '&:hover': { opacity: isRefreshingBrief ? 0.6 : 0.75 },
  '& svg': {
    transform: `rotate(${refreshRotationDeg}deg)`,
    transition: 'transform 240ms ease',
    transformOrigin: 'center',
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },
});
type SevKey = keyof typeof SEV;

function sevKey(priority: number): SevKey {
  if (priority <= 2) return 'critical';
  if (priority <= 4) return 'watch';
  return 'ontrack';
}

const MODULE_LABELS: Record<string, string> = {
  'order-nexus':      'Orders',
  'cashflow':         'Cash Flow',
  'finances':         'Finances',
  'wms':              'Warehouse',
  'suppliers-portal': 'Suppliers',
  'floor-planning':   'Floor Planning',
  'overview':         'Overview',
  'products':         'Products',
  'customers':        'Customers',
  'demand':           'Demand',
  'returns':          'Returns',
};

function moduleLabel(m: string): string { return MODULE_LABELS[m] ?? m; }

/* # ISS-056: local fmtCurrency removed. Used locale 'en' (no region), which
# renders currency as a code prefix (e.g. "USD180") instead of a symbol
# ("$180") — inconsistent with every other screen in the app, which uses
# the shared formatCurrencyCompact('en-US', ...). All call sites below
# now import and use the shared formatter directly. */

function timeOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

// ─── TRIAGE ROW ───────────────────────────────────────────────

function TriageRow({
  signal,
  isCritical,
  currency,
}: {
  signal: Signal;
  isCritical: boolean;
  currency: string;
}) {
  const sev = SEV[sevKey(signal.priority)];
  const [expanded, setExpanded] = useState(false);
  const hasTags = (signal.tags?.length ?? 0) > 0;
  const impactLabel = revenueImpactLabel(signal.alertType);

  return (
    <Box sx={{ px: '1.25rem', py: '0.875rem', borderBottom: '1px solid var(--rule)', '&:last-child': { borderBottom: 'none' }, '&:hover': { bgcolor: 'var(--bg-2)' }, transition: 'background 0.1s' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 90px', gap: 1.75, alignItems: 'center' }}>

        {/* LEFT: badge + content */}
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mb: '4px' }}>
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', px: '5px', py: '2px', borderRadius: '4px', bgcolor: sev.badge, flexShrink: 0 }}>
              <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: sev.color }} />
              <Typography sx={{ fontSize: 10, fontWeight: 600, color: sev.color, lineHeight: 1 }}>
                {sev === SEV.critical ? 'Critical' : sev === SEV.watch ? 'Watch' : 'On track'}
              </Typography>
            </Box>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {signal.title}
            </Typography>
          </Box>
          <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', lineHeight: 1.45, pl: '0px' }}>
            {moduleLabel(signal.module)} · {signal.detail}
          </Typography>
          {hasTags && (
            <Box sx={{ mt: '6px' }}>
              <Box
                component="button"
                onClick={() => setExpanded(v => !v)}
                sx={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: 'none', cursor: 'pointer', p: 0, '&:hover': { opacity: 0.8 } }}
              >
                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {expanded ? 'Hide' : `Show ${signal.tags!.length}`} {signal.tags!.length === 1 ? 'item' : 'items'}
              </Box>
              {expanded && (
                <Box sx={{ mt: '6px', display: 'flex', flexDirection: 'column', gap: '3px', pl: '2px' }}>
                  {signal.tags!.map(tag => (
                    <Typography key={tag} sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)' }}>
                      · {tag}
                    </Typography>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </Box>

        {/* CENTER: revenue + age */}
        <Box sx={{ textAlign: 'right' }}>
          {signal.revenueImpact != null && (
            <Typography sx={{ fontSize: 14, fontWeight: 700, color: isCritical ? '#E5484D' : 'var(--ink)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
              {formatCurrencyCompact(signal.revenueImpact, currency)}
            </Typography>
          )}
          {signal.revenueImpact != null && impactLabel && (
            <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)', mt: '2px' }}>
              {impactLabel}
            </Typography>
          )}
          {signal.ageLabel && (
            <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)', mt: '2px' }}>
              {signal.ageLabel}
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}

// ─── GROUP BAND ───────────────────────────────────────────────

function GroupBand({ sevK, count }: { sevK: SevKey; count: number }) {
  const sev = SEV[sevK];
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', px: '1.25rem', py: '8px', bgcolor: sev.bgBand, borderBottom: '1px solid var(--rule)' }}>
      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: sev.color, flexShrink: 0 }} />
      <Typography sx={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: sev.color }}>
        {sev.band}
      </Typography>
      <Typography sx={{ ml: 'auto', fontSize: 11, fontWeight: 300, color: 'var(--ink-3)' }}>
        {count} item{count !== 1 ? 's' : ''}
      </Typography>
    </Box>
  );
}

// ─── BUSINESS PULSE SIDEBAR ───────────────────────────────────
function buildBusinessPulseRows(
  pulse: NonNullable<OverviewModuleFT2DataProps['pulse']>,
  currency: string
): PulseCardRowData[] {
  const fmt = (v: number | null) => formatCurrencyCompact(v, currency);
  const delta = pulse.revenueDeltaVsYesterday;
  const deltaLabel =
    delta == null
      ? undefined
      : delta === 0
        ? 'flat vs yesterday'
        : `${delta > 0 ? '▲' : '▼'} ${formatCurrencyCompact(Math.abs(Math.round(delta)), currency)} vs yesterday`;
  const deltaTone: PulseTone | undefined =
    delta == null || delta === 0 ? undefined : delta > 0 ? 'good' : 'warning';

  const blockLabelMap: Record<string, string> = {
    inventory: 'inventory',
    customer: 'customer',
    operational: 'fulfillment',
    none: 'none',
  };
  const blockLabel =
    pulse.topBlockingType && pulse.topBlockingType !== 'none'
      ? blockLabelMap[pulse.topBlockingType] ?? pulse.topBlockingType
      : null;

  return [
    { id: 'revenue-today', label: 'Revenue today', value: fmt(pulse.revenueToday), subtext: deltaLabel, subtextTone: deltaTone },
    { id: 'at-risk', label: 'At risk', value: fmt(pulse.atRiskRevenue), tone: (pulse.atRiskRevenue ?? 0) > 0 ? 'warning' : 'neutral' },
    { id: 'blocked', label: 'Blocked', value: fmt(pulse.blockedRevenue), tone: (pulse.blockedRevenue ?? 0) > 0 ? 'critical' : 'neutral', subtext: blockLabel ? `mostly ${blockLabel}` : undefined },
  ];
}

// ─── MERGED PULSE CARD ────────────────────────────────────────
// Right-hand 25% card for the map layout. Combines ranked decisions
// (top 3 initially, remaining decisions expand in-place) with the BusinessPulse stats strip.
// Decisions section self-hides when signals are empty (calm state).

function MergedPulseCard({
  criticalSignals,
  watchSignals,
  pulse,
  currency,
  generatedTime,
  trustWarning,
  onRefreshBrief,
  isRefreshingBrief = false,
  refreshRotationDeg,
}: {
  criticalSignals: Signal[];
  watchSignals: Signal[];
  pulse: OverviewModuleFT2DataProps['pulse'];
  currency: string;
  generatedTime: string | null;
  trustWarning: boolean;
  onRefreshBrief?: () => void;
  isRefreshingBrief?: boolean;
  refreshRotationDeg: number;
}) {
  const urgentSignals = [...criticalSignals, ...watchSignals];
  const visibleSignals = urgentSignals.slice(0, 3);
  const hiddenSignals = urgentSignals.slice(3);
  const hiddenCount = hiddenSignals.length;
  const [decisionsExpanded, setDecisionsExpanded] = useState(false);

  return (
    <Box
      sx={{
        flex: { xs: '1 1 auto', lg: '0 0 280px' },
        width: { xs: '100%', lg: '280px' },
        minWidth: 0,
        boxSizing: 'border-box',
        bgcolor: 'var(--surface)',
        border: '0.5px solid var(--rule)',
        borderRadius: '14px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        height: { xs: 'auto', lg: '100%' },
      }}
    >
      {/* ── DECISIONS ── */}
      {urgentSignals.length > 0 && (
        <Box sx={{ px: '1.25rem', pt: '1rem', pb: '0.75rem' }}>
          <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: '0.625rem' }}>
            Needs a decision
          </Typography>
          {visibleSignals.map(s => {
            const impactLabel = revenueImpactLabel(s.alertType);

            return (
              <Box
                key={s.id}
                sx={{ display: 'flex', alignItems: 'flex-start', gap: '8px', py: '6px' }}
              >
                <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: s.priority <= 2 ? '#E5484D' : '#D9A23B', mt: '5px', flexShrink: 0 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3 }} noWrap>
                    {s.title}
                  </Typography>
                  {s.revenueImpact != null && (
                    <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)' }}>
                      {formatCurrencyCompact(s.revenueImpact, currency)}
                    </Typography>
                  )}
                  {s.revenueImpact != null && impactLabel && (
                    <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)', mt: '2px' }}>
                      {impactLabel}
                    </Typography>
                  )}
                </Box>
              </Box>
            );
          })}
          {hiddenCount > 0 && (
            <>
              <Collapse in={decisionsExpanded} timeout={180} unmountOnExit>
                {hiddenSignals.map(s => {
                  const impactLabel = revenueImpactLabel(s.alertType);

                  return (
                    <Box
                      key={s.id}
                      sx={{ display: 'flex', alignItems: 'flex-start', gap: '8px', py: '6px' }}
                    >
                      <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: s.priority <= 2 ? '#E5484D' : '#D9A23B', mt: '5px', flexShrink: 0 }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3 }} noWrap>
                          {s.title}
                        </Typography>
                        {s.revenueImpact != null && (
                          <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)' }}>
                            {formatCurrencyCompact(s.revenueImpact, currency)}
                          </Typography>
                        )}
                        {s.revenueImpact != null && impactLabel && (
                          <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)', mt: '2px' }}>
                            {impactLabel}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  );
                })}
              </Collapse>
              <Box
                onClick={() => setDecisionsExpanded(v => !v)}
                sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', mt: '4px', fontSize: 11, fontWeight: 500, color: 'var(--accent)', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
              >
                {decisionsExpanded ? 'Show less' : `+${hiddenCount} more`}
                {decisionsExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </Box>
            </>
          )}
        </Box>
      )}

      {/* ── MORNING BRIEF FRESHNESS ── */}
      <Box
        sx={{
          px: '1.25rem',
          py: '0.625rem',
          bgcolor: 'var(--bg-2)',
          borderTop: urgentSignals.length > 0 ? '0.5px solid var(--rule)' : undefined,
          borderBottom: pulse ? '0.5px solid var(--rule)' : undefined,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        {trustWarning && (
          <Typography sx={{ fontSize: 11, fontWeight: 300, color: '#D9A23B' }}>
            Data may be stale ·
          </Typography>
        )}
        <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
          {generatedTime ? `Brief updated at ${generatedTime}` : 'Updating brief…'}
        </Typography>
        {onRefreshBrief && (
          <Box
            component="button"
            type="button"
            aria-label="Refresh morning brief"
            disabled={isRefreshingBrief}
            onClick={onRefreshBrief}
            sx={refreshButtonSx(isRefreshingBrief, refreshRotationDeg, true)}
          >
            <RefreshCw size={11} />
          </Box>
        )}
      </Box>

      {/* ── BUSINESS PULSE (inline, embedded PulseCard) — PULSE-01 ── */}
      {pulse && (
        <Box sx={{ px: '18px', py: '14px', flex: 1 }}>
          <PulseCard
            title="Business pulse"
            variant="embedded"
            rows={buildBusinessPulseRows(pulse, currency)}
          />
        </Box>
      )}
    </Box>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────

function OverviewModuleFT2Inner(props: OverviewModuleFT2Props) {
    const {
    morningBrief,
    pulse,
    operationalWarningState,
    onRefreshBrief,
    isRefreshingBrief = false,
    mapContent,
  } = props;

  const isLoading    = morningBrief === undefined;
  const isTrustGated = morningBrief === null;
  const signals      = morningBrief?.signals ?? [];
  const greeting     = morningBrief?.greeting ?? null;
  const summaryLine  = morningBrief?.summaryLine ?? null;
  const generatedAt  = morningBrief?.generatedAt ?? null;
  const trustWarning = morningBrief?.trustWarning ?? false;
  const currency     = props.currency ?? 'USD';

  const criticalSignals = signals.filter(s => s.priority <= 2);
  const watchSignals    = signals.filter(s => s.priority === 3 || s.priority === 4);
  const onTrackSignals  = signals.filter(s => s.priority === 5);

  const [criticalExpanded, setCriticalExpanded] = useState(false);
  const [watchExpanded, setWatchExpanded] = useState(false);
  const [refreshRotationDeg, setRefreshRotationDeg] = useState(0);

  const handleRefreshBrief = () => {
    if (isRefreshingBrief || !onRefreshBrief) return;
    setRefreshRotationDeg((prev) => prev + 180);
    onRefreshBrief();
  };

  const visibleCriticalSignals = criticalSignals.slice(0, TRIAGE_PREVIEW_LIMIT);
  const hiddenCriticalSignals  = criticalSignals.slice(TRIAGE_PREVIEW_LIMIT);
  const visibleWatchSignals    = watchSignals.slice(0, TRIAGE_PREVIEW_LIMIT);
  const hiddenWatchSignals     = watchSignals.slice(TRIAGE_PREVIEW_LIMIT);

  const generatedTime = generatedAt
    ? new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  const brandGreen = '#1D9E75';

  const greetingText = props.userName
    ? `Good ${timeOfDay()}, ${props.userName}.`
    : (greeting ?? `Good ${timeOfDay()}.`);

  const subText = (() => {
    if (isLoading) return null;
    if (isTrustGated) {
      return 'Your morning brief will appear here once your first sync completes.';
    }

    const decisionCount = criticalSignals.length + watchSignals.length;
    const hasBriefWarnings =
      morningBrief.hasUrgentIssues || decisionCount > 0;
    const blockedRevenue = Number(pulse?.blockedRevenue ?? 0);
    const hasBlockedRevenue = blockedRevenue > 0;
    const hasExternalWarnings = operationalWarningState === 'warning';
    const externalWarningsResolved = operationalWarningState !== 'unknown';

    const hasOperationalWarnings =
      hasBriefWarnings ||
      hasBlockedRevenue ||
      hasExternalWarnings;

    if (!hasOperationalWarnings) {
      if (!externalWarningsResolved) return null;
      return summaryLine ?? 'All operations are on track.';
    }

    if (decisionCount > 0) {
      return buildDecisionPendingSummary(decisionCount);
    }

    if (hasBlockedRevenue) {
      return `${formatCurrencyCompact(blockedRevenue, currency)} in blocked revenue needs attention.`;
    }

    return 'Warehouse warnings need your attention.';
  })();

  return (
    <Box sx={{ p: { xs: 2, md: '28px 32px' }, display: 'flex', flexDirection: 'column', gap: '20px', bgcolor: 'var(--bg)', minHeight: '100%' }}>

      {/* ── HEADER ── */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: '10px', flexWrap: 'wrap', gap: 1 }}>
          <Typography sx={{ fontSize: 10.5, fontWeight: 500, color: brandGreen, textTransform: 'uppercase', letterSpacing: '0.12em', lineHeight: 2 }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            {' · '}
            {isLoading ? 'Syncing…' : 'Live'}
          </Typography>
        </Box>

        {isLoading ? (
          <>
            <Skeleton width="52%" height={38} sx={{ mb: '8px' }} />
            <Skeleton width="72%" height={18} />
          </>
        ) : isTrustGated ? (
          <>
            <Typography sx={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', mb: '8px', lineHeight: 1.2, letterSpacing: '-0.01em' }}>
              Setting things up
            </Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)', lineHeight: 1.6 }}>
              {subText}
            </Typography>
          </>
        ) : (
          <>
            <Typography sx={{ fontSize: 32, fontWeight: 700, color: 'var(--ink)', mb: '8px', lineHeight: 1.1, letterSpacing: '-0.02em' }}>
              {greetingText}
            </Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)', lineHeight: 1.6 }}>
              {subText}
            </Typography>
          </>
        )}
      </Box>

      {/* ── BODY ── */}
      {!isLoading && (
        mapContent ? (
          /* MAP LAYOUT — 75% live map + 25% merged pulse card */
          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', lg: 'row' },
              gap: 2.25,
              alignItems: 'stretch',
            }}
          >
            {/* LEFT: live map slot */}
            <Box
              sx={{
                flex: '1 1 0',
                width: { xs: '100%', lg: 'auto' },
                minWidth: 0,
              }}
            >
              {mapContent}
            </Box>
            {/* RIGHT: merged pulse card (fixed 280px) */}
            <MergedPulseCard
              criticalSignals={criticalSignals}
              watchSignals={watchSignals}
              pulse={pulse ?? null}
              currency={currency}
              generatedTime={generatedTime}
              trustWarning={trustWarning}
              onRefreshBrief={onRefreshBrief ? handleRefreshBrief : undefined}
              isRefreshingBrief={isRefreshingBrief}
              refreshRotationDeg={refreshRotationDeg}
            />
          </Box>
        ) : (
          /* TRIAGE LAYOUT — fallback for non-scale tier and zero-zone tenants */
          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', lg: 'row' },
              flexWrap: { xs: 'nowrap', lg: 'wrap' },
              gap: 2.25,
              alignItems: 'stretch',
            }}
          >
            {/* LEFT: Needs a decision */}
            <Box
              sx={{
                flex: { xs: '1 1 auto', lg: '1 1 0' },
                width: { xs: '100%', lg: 'auto' },
                minWidth: 0,
                boxSizing: 'border-box',
                bgcolor: 'var(--surface)',
                border: '0.5px solid var(--rule)',
                borderRadius: '14px',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {/* Card header */}
              <Box sx={{ px: '1.25rem', py: '0.9rem', borderBottom: '0.5px solid var(--rule)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Box>
                  <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', lineHeight: 1 }}>
                    {isTrustGated ? 'Getting ready' : 'Needs a decision'}
                  </Typography>
                  {!isTrustGated && (
                    <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)', mt: '3px' }}>
                      Ranked by commercial consequence
                    </Typography>
                  )}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
                    {generatedTime ? `Brief updated ${generatedTime}` : 'Updating brief…'}
                  </Typography>
                  {onRefreshBrief && (
                    <Box
                      component="button"
                      type="button"
                      aria-label="Refresh morning brief"
                      disabled={isRefreshingBrief}
                      onClick={handleRefreshBrief}
                      sx={refreshButtonSx(isRefreshingBrief, refreshRotationDeg)}
                    >
                      <RefreshCw size={11} />
                    </Box>
                  )}
                </Box>
              </Box>

              {/* Trust-gated state */}
              {isTrustGated && (
                <Box sx={{ px: '1.25rem', py: '2rem', textAlign: 'center' }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)', lineHeight: 1.6 }}>
                    Waiting for your first data sync. This usually takes a few minutes.
                  </Typography>
                </Box>
              )}

              {/* No signals */}
              {!isTrustGated && signals.length === 0 && (
                <Box sx={{ px: '1.25rem', py: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#4CAF7A', flexShrink: 0 }} />
                  <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
                    All operations are on track — no decisions required
                  </Typography>
                </Box>
              )}

              {/* CRITICAL group */}
              {criticalSignals.length > 0 && (
                <>
                  <GroupBand sevK="critical" count={criticalSignals.length} />
                  {visibleCriticalSignals.map(s => (
                    <TriageRow key={s.id} signal={s} isCritical currency={currency} />
                  ))}
                  {hiddenCriticalSignals.length > 0 && (
                    <>
                      <Collapse in={criticalExpanded} timeout={180} unmountOnExit>
                        {hiddenCriticalSignals.map(s => (
                          <TriageRow key={s.id} signal={s} isCritical currency={currency} />
                        ))}
                      </Collapse>
                      <Box
                        onClick={() => setCriticalExpanded(v => !v)}
                        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, px: '1.25rem', py: '10px', borderBottom: '0.5px solid var(--rule)', cursor: 'pointer', color: 'var(--accent)', '&:hover': { opacity: 0.75 } }}
                      >
                        <Typography sx={{ fontSize: 11, fontWeight: 500 }}>
                          {criticalExpanded ? 'Show less' : `See ${hiddenCriticalSignals.length} more`}
                        </Typography>
                        {criticalExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </Box>
                    </>
                  )}
                </>
              )}

              {/* WATCH group */}
              {watchSignals.length > 0 && (
                <>
                  <GroupBand sevK="watch" count={watchSignals.length} />
                  {visibleWatchSignals.map(s => (
                    <TriageRow key={s.id} signal={s} isCritical={false} currency={currency} />
                  ))}
                  {hiddenWatchSignals.length > 0 && (
                    <>
                      <Collapse in={watchExpanded} timeout={180} unmountOnExit>
                        {hiddenWatchSignals.map(s => (
                          <TriageRow key={s.id} signal={s} isCritical={false} currency={currency} />
                        ))}
                      </Collapse>
                      <Box
                        onClick={() => setWatchExpanded(v => !v)}
                        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, px: '1.25rem', py: '10px', borderBottom: '0.5px solid var(--rule)', cursor: 'pointer', color: 'var(--accent)', '&:hover': { opacity: 0.75 } }}
                      >
                        <Typography sx={{ fontSize: 11, fontWeight: 500 }}>
                          {watchExpanded ? 'Show less' : `See ${hiddenWatchSignals.length} more`}
                        </Typography>
                        {watchExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </Box>
                    </>
                  )}
                </>
              )}

              {/* EVERYTHING ELSE — on-track signals collapsed */}
              {onTrackSignals.length > 0 && (
                <EverythingElse signals={onTrackSignals} currency={currency} />
              )}

              {/* Morning Brief trust warning */}
              {trustWarning && (
                <Box
                  sx={{
                    mt: 'auto',
                    px: '1.25rem',
                    py: '0.625rem',
                    bgcolor: 'var(--bg-2)',
                    borderTop: '0.5px solid var(--rule)',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <Typography sx={{ fontSize: 11, fontWeight: 300, color: '#D9A23B' }}>
                    Data may be stale
                  </Typography>
                </Box>
              )}
            </Box>

            {pulse && (
              <Box sx={{ flex: { xs: '1 1 auto', lg: '0 0 280px' }, width: { xs: '100%', lg: '280px' }, minWidth: 0 }}>
                <PulseCard
                  title="Business pulse"
                  rows={buildBusinessPulseRows(pulse, currency)}
                />
              </Box>
            )}
          </Box>
        )
      )}

      {/* Loading state for body */}
      {isLoading && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.25, alignItems: 'start' }}>
          <Box sx={{ flex: '1 0 300px', minWidth: 0, bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', p: '1.25rem', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[1, 2, 3].map(i => <Skeleton key={i} height={56} sx={{ borderRadius: '8px' }} />)}
          </Box>
          <Box sx={{ flex: '0 0 300px', bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', p: '1.25rem', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[1, 2, 3, 4].map(i => <Skeleton key={i} height={24} sx={{ borderRadius: '4px' }} />)}
          </Box>
        </Box>
      )}

    </Box>
  );
}

// ─── EVERYTHING ELSE (collapsible on-track section) ───────────

function EverythingElse({
  signals,
  currency,
}: {
  signals: Signal[];
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Box
        onClick={() => setOpen(v => !v)}
        sx={{ display: 'flex', alignItems: 'center', gap: '8px', px: '1.25rem', py: '8px', bgcolor: SEV.ontrack.bgBand, borderBottom: open ? '1px solid var(--rule)' : 'none', cursor: 'pointer', '&:hover': { opacity: 0.85 }, transition: 'opacity 0.1s' }}
      >
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#4CAF7A', flexShrink: 0 }} />
        <Typography sx={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#4CAF7A' }}>
          Everything else
        </Typography>
        <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)', ml: '4px' }}>
          {signals.length} on track
        </Typography>
        <Box sx={{ ml: 'auto' }}>
          {open ? <ChevronUp size={13} color="var(--ink-4)" /> : <ChevronDown size={13} color="var(--ink-4)" />}
        </Box>
      </Box>
      {open && signals.map(s => (
        <TriageRow key={s.id} signal={s} isCritical={false} currency={currency} />
      ))}
    </>
  );
}

// ─── OV-V1: OPERATIONS PULSE COMPOSITION ──────────────────────
//
// The production Overview (operationsPulse present):
//   compact orientation header · map slot · Operations Pulse.
// Whole-operation situational awareness only. Reads ONLY operationsPulse —
// never Morning Brief (no signals, greeting, summary, freshness or refresh),
// never Business Pulse. Informational only: no buttons, links or navigation
// until canonical destinations are ratified (OV-V1-4/5).

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function PulseRow({ text, tone = 'default' }: { text: string; tone?: 'default' | 'muted' | 'clear' }) {
  return (
    <Typography
      sx={{
        fontSize: 12.5,
        lineHeight: 1.45,
        fontWeight: tone === 'default' ? 500 : 400,
        color: tone === 'clear' ? '#4CAF7A' : tone === 'muted' ? 'var(--ink-3)' : 'var(--ink)',
      }}
    >
      {text}
    </Typography>
  );
}

function PulseGroup({ label, rows }: { label: string; rows: ReactNode[] }) {
  return (
    <Box
      role="group"
      aria-label={label}
      sx={{ display: 'flex', flexDirection: 'column', gap: '2px', py: '10px', borderTop: '0.5px solid var(--rule)', '&:first-of-type': { borderTop: 'none', pt: 0 } }}
    >
      <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: '2px' }}>
        {label}
      </Typography>
      {/* Whitespace between rows keeps each fact textually separate for
          assistive tech; the flex column ignores it visually. */}
      {rows.map((row, i) => <Fragment key={i}>{i > 0 ? ' ' : null}{row}</Fragment>)}
    </Box>
  );
}

function OperationsPulse({ pulse, currency }: { pulse: OverviewOperationsPulse; currency: string }) {
  const money = (v: number) => formatCurrencyCompact(v, currency);
  const { orders, fulfillment, inventory, inbound } = pulse;

  const orderRows: ReactNode[] = [<PulseRow key="ready" text={`${orders.readyCount} ready`} />];
  if (orders.blockedCount > 0) {
    orderRows.push(<PulseRow key="blocked" text={`${orders.blockedCount} blocked · ${money(orders.blockedRevenue)}`} />);
  }
  if (orders.pastSlaCount > 0) {
    orderRows.push(<PulseRow key="sla" text={`${orders.pastSlaCount} past SLA · ${money(orders.pastSlaRevenue)}`} />);
  }

  const fulfillmentRows: ReactNode[] = [
    <PulseRow
      key="active"
      text={`${fulfillment.activeBatchCount} active ${pluralize(fulfillment.activeBatchCount, 'batch', 'batches')}`}
    />,
  ];
  if (fulfillment.activeBatchCount > 0) {
    fulfillmentRows.push(
      <PulseRow key="stages" tone="muted" text={`${fulfillment.pickingBatchCount} picking · ${fulfillment.packingBatchCount} packing`} />
    );
  }

  const inventoryRows: ReactNode[] = inventory.awaitingInventoryCount > 0
    ? [<PulseRow key="waiting" text={`${inventory.awaitingInventoryCount} awaiting inventory · ${money(inventory.awaitingInventoryRevenue)}`} />]
    : [<PulseRow key="clear" tone="clear" text="Clear" />];

  const inboundRows: ReactNode[] = [];
  if (inbound.receiveAtDockUnits > 0) inboundRows.push(<PulseRow key="dock" text={`${inbound.receiveAtDockUnits} at dock`} />);
  if (inbound.awaitingStowUnits > 0) inboundRows.push(<PulseRow key="stow" text={`${inbound.awaitingStowUnits} awaiting stow`} />);
  if (inboundRows.length === 0) inboundRows.push(<PulseRow key="clear" tone="clear" text="Clear" />);

  return (
    <Box
      component="section"
      role="region"
      aria-label="Operations pulse"
      sx={{
        minWidth: 0,
        boxSizing: 'border-box',
        bgcolor: 'var(--surface)',
        border: '0.5px solid var(--rule)',
        borderRadius: '14px',
        px: '18px',
        py: '14px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Typography component="h2" sx={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', lineHeight: 1, mb: '12px' }}>
        Operations
      </Typography>
      <PulseGroup label="Orders" rows={orderRows} />
      <PulseGroup label="Fulfillment" rows={fulfillmentRows} />
      <PulseGroup label="Inventory" rows={inventoryRows} />
      <PulseGroup label="Inbound" rows={inboundRows} />
    </Box>
  );
}

function OverviewModuleV1({
  operationsPulse,
  mapContent,
  userName,
  currency = 'USD',
}: OverviewModuleFT2Props & { operationsPulse: OverviewOperationsPulse }) {
  const greetingText = userName ? `Good ${timeOfDay()}, ${userName}.` : `Good ${timeOfDay()}.`;

  return (
    <Box sx={{ p: { xs: 2, md: '28px 32px' }, display: 'flex', flexDirection: 'column', gap: '20px', bgcolor: 'var(--bg)', minHeight: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {/* ── COMPACT ORIENTATION HEADER — Live status belongs to the topnav ── */}
      <Box>
        <Typography sx={{ fontSize: 10.5, fontWeight: 500, color: '#1D9E75', textTransform: 'uppercase', letterSpacing: '0.12em', lineHeight: 2 }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </Typography>
        <Typography sx={{ fontSize: 24, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.15, letterSpacing: '-0.01em' }}>
          {greetingText}
        </Typography>
      </Box>

      {/* ── BODY — map ~75% + Operations Pulse ~25%; single column below lg ── */}
      {mapContent ? (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 3fr) minmax(260px, 1fr)' },
            gap: 2.25,
            alignItems: 'stretch',
            minWidth: 0,
          }}
        >
          <Box sx={{ minWidth: 0 }}>{mapContent}</Box>
          <OperationsPulse pulse={operationsPulse} currency={currency} />
        </Box>
      ) : (
        <Box sx={{ minWidth: 0, maxWidth: 560 }}>
          <OperationsPulse pulse={operationsPulse} currency={currency} />
        </Box>
      )}
    </Box>
  );
}

// ─── EXPORT ───────────────────────────────────────────────────

export default function OverviewModuleFT2(props: OverviewModuleFT2Props) {
  const { operationsPulse } = props;
  return (
    <ModuleErrorBoundary moduleName="overview">
      {operationsPulse ? (
        <OverviewModuleV1 {...props} operationsPulse={operationsPulse} />
      ) : (
        // LEGACY COMPATIBILITY PATH — only for callers that have not yet
        // supplied the structured OV-V1 `operationsPulse` prop. The production
        // Overview page always supplies it, so it never reaches this renderer.
        <OverviewModuleFT2Inner {...props} />
      )}
    </ModuleErrorBoundary>
  );
}
