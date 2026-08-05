// modules/overview/src/ui/pages/OverviewModuleFT2.tsx
//
// OVERVIEW — "A: Triage-first" layout from the LaSyncro design file.
//
// LAYOUT:
//   HEADER (greeting · date · summary · page actions)
//   ────────────────────────────────────────────────────────────
//   BODY  [  Needs a decision (flex-1)  |  TODAY'S FLOW (280px)  ]
//
// RULES: No alpha(). No useTheme(). No fontFamily overrides. No 0.5px borders.
//        CSS vars for adaptive colors; direct hex only for severity tokens.
//        Severity palette: #E5484D critical · #D9A23B watch · #4CAF7A on-track.

import { useState, type ReactNode } from 'react';
import { Box, Collapse, Typography, Skeleton } from '@mui/material';
import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { formatCurrencyCompact, ModuleErrorBoundary, PulseCard, PulseCardRowData, PulseTone } from '@lasyncro/shared/ui';

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
    /** Revenue collected/realized today. */
    collectedRevenue: number | null;
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

export type OverviewModuleFT2Props = OverviewModuleFT2DataProps & {
  /**
   * Consolidated state for operational warnings rendered outside Morning Brief.
   * `unknown` prevents positive copy while those sources are loading or failed.
   */
  operationalWarningState: 'clear' | 'warning' | 'unknown';
  onNavigate?: (deepLink: string) => void;
  onRefreshBrief?: () => void;
  onExportBrief?: () => void;
  onResolveAll?: () => void;
  /**
   * Rendered in the 75% map slot.
   * When absent the module falls back to the triage-first layout.
   * Tier gate and zone guard are resolved by the page layer — module is layout-only.
   */
  mapContent?: ReactNode;
  upgradeTeaser?: ReactNode;
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

const DEFAULT_ACTIONS: Record<string, string> = {
  'order-nexus':      'Review queue',
  'wms':              'Review floor',
  'demand':           'Reorder',
  'suppliers-portal': 'View supplier',
  'returns':          'Review returns',
  'finances':         'View finances',
  'cashflow':         'View cashflow',
};

function moduleLabel(m: string): string { return MODULE_LABELS[m] ?? m; }
function actionLabel(signal: Signal): string {
  return signal.actionLabel ?? DEFAULT_ACTIONS[signal.module] ?? 'Review ›';
}

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
  onNavigate,
  currency,
}: {
  signal: Signal;
  isCritical: boolean;
  onNavigate?: (deepLink: string) => void;
  currency: string;
}) {
  const sev = SEV[sevKey(signal.priority)];
  const [expanded, setExpanded] = useState(false);
  const hasTags = (signal.tags?.length ?? 0) > 0;

  return (
    <Box sx={{ px: '1.25rem', py: '0.875rem', borderBottom: '1px solid var(--rule)', '&:last-child': { borderBottom: 'none' }, '&:hover': { bgcolor: 'var(--bg-2)' }, transition: 'background 0.1s' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: onNavigate ? 'minmax(0,1fr) 90px 118px' : 'minmax(0,1fr) 90px', gap: 1.75, alignItems: 'center' }}>

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
          {signal.ageLabel && (
            <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)', mt: '2px' }}>
              {signal.ageLabel}
            </Typography>
          )}
        </Box>

        {/* RIGHT: CTA */}
        {onNavigate && (
          <Box
            component="button"
            onClick={() => onNavigate(signal.deepLink)}
            sx={{
              fontSize: 12, fontWeight: 600,
              px: '12px', py: '6px', borderRadius: '8px',
              ...(isCritical
                ? { bgcolor: 'var(--accent)', color: 'var(--accent-ink)', border: 'none' }
                : { bgcolor: 'transparent', color: 'var(--ink-3)', border: '1px solid var(--rule)' }),
              cursor: 'pointer',
              '&:hover': { opacity: 0.88 },
              transition: 'opacity 0.1s',
              whiteSpace: 'nowrap',
            }}
          >
            {actionLabel(signal)}
          </Box>
        )}
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
    { id: 'collected-today', label: 'Collected today', value: fmt(pulse.collectedRevenue), tone: 'good' },
    { id: 'at-risk', label: 'At risk', value: fmt(pulse.atRiskRevenue), tone: (pulse.atRiskRevenue ?? 0) > 0 ? 'warning' : 'neutral' },
    { id: 'blocked', label: 'Blocked', value: fmt(pulse.blockedRevenue), tone: (pulse.blockedRevenue ?? 0) > 0 ? 'critical' : 'neutral', subtext: blockLabel ? `mostly ${blockLabel}` : undefined },
  ];
}

// ─── MERGED PULSE CARD ────────────────────────────────────────
// Right-hand 25% card for the map layout. Combines ranked decisions
// (top 3, +N more → /order-flow) with the BusinessPulse stats strip.
// Decisions section self-hides when signals are empty (calm state).

function MergedPulseCard({
  criticalSignals,
  watchSignals,
  pulse,
  currency,
  onNavigate,
  generatedTime,
  trustWarning,
  onRefreshBrief,
}: {
  criticalSignals: Signal[];
  watchSignals: Signal[];
  pulse: OverviewModuleFT2DataProps['pulse'];
  currency: string;
  onNavigate?: (path: string) => void;
  generatedTime: string | null;
  trustWarning: boolean;
  onRefreshBrief?: () => void;
}) {
  const urgentSignals = [...criticalSignals, ...watchSignals];
  const visibleSignals = urgentSignals.slice(0, 3);
  const hiddenCount = Math.max(0, urgentSignals.length - 3);

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
          {visibleSignals.map(s => (
            <Box
              key={s.id}
              onClick={() => s.deepLink && onNavigate?.(s.deepLink)}
              sx={{ display: 'flex', alignItems: 'flex-start', gap: '8px', py: '6px', cursor: s.deepLink ? 'pointer' : 'default', '&:hover': s.deepLink ? { opacity: 0.8 } : {} }}
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
              </Box>
            </Box>
          ))}
          {hiddenCount > 0 && (
            <Box
              onClick={() => onNavigate?.('/order-flow')}
              sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', mt: '4px', fontSize: 11, fontWeight: 500, color: 'var(--accent)', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
            >
              +{hiddenCount} more →
            </Box>
          )}
        </Box>
      )}

      {/* Divider — only when both sections populated */}
      {urgentSignals.length > 0 && pulse && (
        <Box sx={{ height: '0.5px', bgcolor: 'var(--rule)' }} />
      )}

      {/* ── BUSINESS PULSE (inline, embedded PulseCard) — PULSE-01 ── */}
      {pulse && (
        <Box sx={{ px: '18px', py: '14px', flex: 1 }}>
          <PulseCard
            title="Business pulse"
            variant="embedded"
            rows={buildBusinessPulseRows(pulse, currency)}
            footerCta={onNavigate ? { label: 'View order flow', onClick: () => onNavigate('/orders/flow') } : undefined}
          />
        </Box>
      )}

      {/* ── FOOTER ── */}
      <Box sx={{ px: '1.25rem', py: '0.625rem', bgcolor: 'var(--bg-2)', borderTop: '0.5px solid var(--rule)', display: 'flex', alignItems: 'center', gap: '8px' }}>
        {trustWarning && (
          <Typography sx={{ fontSize: 11, fontWeight: 300, color: '#D9A23B' }}>
            Data may be stale ·
          </Typography>
        )}
        <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
          {generatedTime ? `Updated at ${generatedTime}` : 'Updating…'}
        </Typography>
        {onRefreshBrief && (
          <Box
            component="button"
            onClick={onRefreshBrief}
            sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: '4px', fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: 'none', cursor: 'pointer', p: 0, '&:hover': { opacity: 0.75 } }}
          >
            <RefreshCw size={11} />
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────

function OverviewModuleFT2Inner(props: OverviewModuleFT2Props) {
    const {
    morningBrief,
    pulse,
    operationalWarningState,
    onNavigate,
    onRefreshBrief,
    onExportBrief,
    mapContent,
    upgradeTeaser,
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
      const atStake = hasBlockedRevenue
        ? ` · ${formatCurrencyCompact(blockedRevenue, currency)} at stake`
        : '';

      return `${decisionCount} decision${decisionCount !== 1 ? 's' : ''} pending${atStake}. Review the issues below.`;
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
          {!isLoading && !isTrustGated && onExportBrief && (
            <Box
              onClick={onExportBrief}
              sx={{ display: 'inline-flex', alignItems: 'center', px: '12px', py: '6px', fontSize: 12, fontWeight: 500, color: 'var(--accent)', border: '0.5px solid var(--accent-border)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
            >
              Export brief →
            </Box>
          )}
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
              onNavigate={onNavigate}
              generatedTime={generatedTime}
              trustWarning={trustWarning}
              onRefreshBrief={onRefreshBrief}
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
                    {generatedTime ? `Updated ${generatedTime}` : 'Updating…'}
                  </Typography>
                  {onRefreshBrief && (
                    <Box
                      component="button"
                      onClick={onRefreshBrief}
                      sx={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: 'none', cursor: 'pointer', p: 0, '&:hover': { opacity: 0.75 } }}
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
                    <TriageRow key={s.id} signal={s} isCritical onNavigate={onNavigate} currency={currency} />
                  ))}
                  {hiddenCriticalSignals.length > 0 && (
                    <>
                      <Collapse in={criticalExpanded} timeout={180} unmountOnExit>
                        {hiddenCriticalSignals.map(s => (
                          <TriageRow key={s.id} signal={s} isCritical onNavigate={onNavigate} currency={currency} />
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
                    <TriageRow key={s.id} signal={s} isCritical={false} onNavigate={onNavigate} currency={currency} />
                  ))}
                  {hiddenWatchSignals.length > 0 && (
                    <>
                      <Collapse in={watchExpanded} timeout={180} unmountOnExit>
                        {hiddenWatchSignals.map(s => (
                          <TriageRow key={s.id} signal={s} isCritical={false} onNavigate={onNavigate} currency={currency} />
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
                <EverythingElse signals={onTrackSignals} onNavigate={onNavigate} currency={currency} />
              )}

              {/* Footer — pinned to the bottom when Business Pulse is taller */}
                  <Box
                    sx={{
                      mt: 'auto',
                      px: '1.25rem',
                      py: '0.625rem',
                      bgcolor: 'var(--bg-2)',
                      borderTop: '0.5px solid var(--rule)',
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
                  {generatedTime ? `Updated at ${generatedTime}` : 'Updating…'}
                </Typography>
              </Box>
            </Box>

            {pulse && (
              <Box sx={{ flex: { xs: '1 1 auto', lg: '0 0 280px' }, width: { xs: '100%', lg: '280px' }, minWidth: 0 }}>
                <PulseCard
                  title="Business pulse"
                  rows={buildBusinessPulseRows(pulse, currency)}
                  footerCta={onNavigate ? { label: 'View order flow', onClick: () => onNavigate('/orders/flow') } : undefined}
                />
              </Box>
            )}
            {upgradeTeaser && (
              <Box sx={{ flex: '1 0 100%', minWidth: 0 }}>
                {upgradeTeaser}
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
  onNavigate,
  currency,
}: {
  signals: Signal[];
  onNavigate?: (path: string) => void;
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
        <TriageRow key={s.id} signal={s} isCritical={false} onNavigate={onNavigate} currency={currency} />
      ))}
    </>
  );
}

// ─── EXPORT ───────────────────────────────────────────────────

export default function OverviewModuleFT2(props: OverviewModuleFT2Props) {
  return (
    <ModuleErrorBoundary moduleName="overview">
      <OverviewModuleFT2Inner {...props} />
    </ModuleErrorBoundary>
  );
}
