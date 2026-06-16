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

import { useState } from 'react';
import { Box, Typography, Skeleton } from '@mui/material';
import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { ModuleErrorBoundary } from '@lasyncro/shared/ui';

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
    shipToday: number | null;
    blockedOrders: number | null;
    blockedRevenue: number | null;
    aging24h: number | null;
    aging48h: number | null;
    aging72hPlus: number | null;
    /** Orders currently being picked or packed */
    pickingNow?: number | null;
    /** Orders shipped so far today */
    shippedToday?: number | null;
    /** Revenue collected today */
    shippedRevenue?: number | null;
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
  onNavigate?: (deepLink: string) => void;
  onRefreshBrief?: () => void;
  onExportBrief?: () => void;
  onResolveAll?: () => void;
};

type Signal = NonNullable<NonNullable<OverviewModuleFT2DataProps['morningBrief']>['signals'][number]>;

// ─── CONSTANTS ────────────────────────────────────────────────

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
function fmtCurrency(n: number, currency = 'GBP'): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Math.round(n));
}
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
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>

        {/* LEFT: badge + content */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
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
        {(signal.revenueImpact != null || signal.ageLabel) && (
          <Box sx={{ flexShrink: 0, textAlign: 'right', minWidth: 80 }}>
            {signal.revenueImpact != null && (
              <Typography sx={{ fontSize: 14, fontWeight: 700, color: isCritical ? '#E5484D' : 'var(--ink)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
                {fmtCurrency(signal.revenueImpact, currency)}
              </Typography>
            )}
            {signal.ageLabel && (
              <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)', mt: '2px' }}>
                {signal.ageLabel}
              </Typography>
            )}
          </Box>
        )}

        {/* RIGHT: CTA */}
        {onNavigate && (
          <Box
            component="button"
            onClick={() => onNavigate(signal.deepLink)}
            sx={{
              flexShrink: 0,
              fontSize: 12, fontWeight: 600,
              px: '12px', py: '6px', borderRadius: '8px',
              ...(isCritical
                ? { bgcolor: 'var(--accent)', color: '#10151E', border: 'none' }
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

// ─── TODAY'S FLOW SIDEBAR ─────────────────────────────────────

function FlowSidebar({
  pulse,
  currency,
  onNavigate,
}: {
  pulse: OverviewModuleFT2DataProps['pulse'];
  currency: string;
  onNavigate?: (path: string) => void;
}) {
  const ready    = pulse?.shipToday    ?? 0;
  const picking  = pulse?.pickingNow   ?? 0;
  const blocked  = pulse?.blockedOrders ?? 0;
  const breached = pulse?.aging72hPlus ?? 0;
  const total    = ready + picking + blocked + breached;

  const rows: { label: string; value: number | null; color?: string; path?: string }[] = [
    { label: 'Ready to ship',    value: pulse?.shipToday    ?? null,                       path: '/orders?filter=ready' },
    { label: 'Picking & packing', value: pulse?.pickingNow  ?? null,                       },
    { label: 'Blocked',          value: pulse?.blockedOrders ?? null, color: '#D9A23B',    path: '/orders?filter=blocked' },
    { label: 'Breached 72h+',    value: pulse?.aging72hPlus ?? null,  color: '#E5484D',   path: '/orders?aging=72h' },
  ];

  return (
    <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '12px', overflow: 'hidden', flexShrink: 0, width: 272, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box sx={{ px: '1.25rem', py: '0.875rem', borderBottom: '1px solid var(--rule)' }}>
        <Typography sx={{ fontSize: 10.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--ink-4)' }}>
          Today's Flow
        </Typography>
      </Box>

      {/* KPI rows */}
      <Box sx={{ px: '1.25rem', py: '0.5rem' }}>
        {rows.map(row => (
          <Box
            key={row.label}
            onClick={row.path && onNavigate ? () => onNavigate(row.path!) : undefined}
            sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: '7px', cursor: row.path && onNavigate ? 'pointer' : 'default', '&:hover': row.path && onNavigate ? { opacity: 0.8 } : {} }}
          >
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
              {row.label}
            </Typography>
            <Typography sx={{ fontSize: 14, fontWeight: 700, color: row.color ?? 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
              {row.value ?? '—'}
            </Typography>
          </Box>
        ))}
      </Box>

      {/* Progress bar */}
      {total > 0 && (
        <Box sx={{ px: '1.25rem', pb: '0.75rem' }}>
          <Box sx={{ display: 'flex', height: 6, borderRadius: '3px', overflow: 'hidden', bgcolor: 'var(--bg-3)', mb: '8px' }}>
            {ready   > 0 && <Box sx={{ flex: ready,   bgcolor: '#4CAF7A', minWidth: '2px' }} />}
            {picking > 0 && <Box sx={{ flex: picking,  bgcolor: '#FF6B2B', minWidth: '2px' }} />}
            {blocked > 0 && <Box sx={{ flex: blocked,  bgcolor: '#D9A23B', minWidth: '2px' }} />}
            {breached > 0 && <Box sx={{ flex: breached, bgcolor: '#E5484D', minWidth: '2px' }} />}
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px' }}>
            {[
              { label: 'Ready',    n: ready,   color: '#4CAF7A' },
              { label: 'Picking',  n: picking,  color: '#FF6B2B' },
              { label: 'Blocked',  n: blocked,  color: '#D9A23B' },
              { label: 'Breached', n: breached, color: '#E5484D' },
            ].filter(l => l.n > 0).map(l => (
              <Box key={l.label} sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: l.color, flexShrink: 0 }} />
                <Typography sx={{ fontSize: 10, fontWeight: 300, color: 'var(--ink-3)' }}>
                  {l.label} {l.n}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Shipped today */}
      {(pulse?.shippedToday != null || pulse?.shippedRevenue != null) && (
        <Box sx={{ px: '1.25rem', py: '0.75rem', borderTop: '1px solid var(--rule)', bgcolor: 'var(--bg-2)', mt: 'auto' }}>
          <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)' }}>
            {pulse.shippedToday != null && (
              <>Shipped today <Box component="span" sx={{ fontWeight: 700, color: 'var(--ink)' }}>{pulse.shippedToday}</Box></>
            )}
            {pulse.shippedRevenue != null && pulse.shippedToday != null && ' · '}
            {pulse.shippedRevenue != null && (
              <>Collected <Box component="span" sx={{ fontWeight: 700, color: 'var(--ink)' }}>{fmtCurrency(pulse.shippedRevenue, currency)}</Box></>
            )}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────

function OverviewModuleFT2Inner(props: OverviewModuleFT2Props) {
  const { morningBrief, pulse, onNavigate, onRefreshBrief, onExportBrief } = props;

  const isLoading    = morningBrief === undefined;
  const isTrustGated = morningBrief === null;
  const signals      = morningBrief?.signals ?? [];
  const greeting     = morningBrief?.greeting ?? null;
  const summaryLine  = morningBrief?.summaryLine ?? null;
  const generatedAt  = morningBrief?.generatedAt ?? null;
  const trustWarning = morningBrief?.trustWarning ?? false;
  const currency     = props.currency ?? 'GBP';

  const criticalSignals = signals.filter(s => s.priority <= 2);
  const watchSignals    = signals.filter(s => s.priority === 3 || s.priority === 4);
  const onTrackSignals  = signals.filter(s => s.priority === 5);

  const generatedTime = generatedAt
    ? new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  const brandGreen = '#1D9E75';

  const greetingText = props.userName
    ? `Good ${timeOfDay()}, ${props.userName}.`
    : (greeting ?? `Good ${timeOfDay()}.`);

  const subText = (() => {
    if (isLoading) return null;
    if (isTrustGated) return 'Your morning brief will appear here once your first sync completes.';
    const urgent = criticalSignals.length + watchSignals.length;
    if (!urgent) return summaryLine ?? 'All operations are on track.';
    const atStake = pulse?.blockedRevenue
      ? ` · ${fmtCurrency(Number(pulse.blockedRevenue), currency)} at stake`
      : '';
    return `${urgent} decision${urgent !== 1 ? 's' : ''} need you${atStake} — everything else is on track.`;
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

      {/* ── BODY: two-column ── */}
      {!isLoading && (
        <Box sx={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>

          {/* LEFT: Needs a decision */}
          <Box sx={{ flex: 1, minWidth: 0, bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '12px', overflow: 'hidden' }}>
            {/* Card header */}
            <Box sx={{ px: '1.25rem', py: '0.9rem', borderBottom: '1px solid var(--rule)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Box>
                <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>
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
                {criticalSignals.map(s => (
                  <TriageRow key={s.id} signal={s} isCritical onNavigate={onNavigate} currency={currency} />
                ))}
              </>
            )}

            {/* WATCH group */}
            {watchSignals.length > 0 && (
              <>
                <GroupBand sevK="watch" count={watchSignals.length} />
                {watchSignals.map(s => (
                  <TriageRow key={s.id} signal={s} isCritical={false} onNavigate={onNavigate} currency={currency} />
                ))}
              </>
            )}

            {/* EVERYTHING ELSE — on-track signals collapsed */}
            {onTrackSignals.length > 0 && (
              <EverythingElse signals={onTrackSignals} onNavigate={onNavigate} currency={currency} />
            )}

            {/* Footer */}
            <Box sx={{ px: '1.25rem', py: '0.625rem', bgcolor: 'var(--bg-2)', borderTop: '1px solid var(--rule)', display: 'flex', alignItems: 'center', gap: '8px' }}>
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

          {/* RIGHT: TODAY'S FLOW */}
          <FlowSidebar pulse={pulse} currency={currency} onNavigate={onNavigate} />
        </Box>
      )}

      {/* Loading state for body */}
      {isLoading && (
        <Box sx={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1, bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '12px', p: '1.25rem', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[1, 2, 3].map(i => <Skeleton key={i} height={56} sx={{ borderRadius: '8px' }} />)}
          </Box>
          <Box sx={{ width: 272, bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '12px', p: '1.25rem', display: 'flex', flexDirection: 'column', gap: '12px', flexShrink: 0 }}>
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
