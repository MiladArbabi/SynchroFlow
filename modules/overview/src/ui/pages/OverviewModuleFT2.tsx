// modules/overview/src/ui/pages/OverviewModuleFT2.tsx
import { Box, Typography, Skeleton, Chip } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import { useColorScheme } from '@mui/material/styles';
import { RefreshCw } from 'lucide-react';
import { ModuleErrorBoundary } from '@lasyncro/shared/ui';

/**
 * OverviewModuleFT2DataProps
 * -------------------------
 * DATA-ONLY FT2 contract.
 * No fetching. No mapping. No hooks.
 */
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
    orders: {
      revenueTotal: number | null;
      currency: string | null;
    } | null;
    products: null;
    customers: null;
  };
  alignment: {
    demandReality?: 'aligned' | 'divergent' | 'unknown';
    operationalEconomic?: 'aligned' | 'divergent' | 'unknown';
    engagementRevenue?: 'aligned' | 'divergent' | 'unknown';
  } | null;
  /**
   * PULSE ZONE (B-05)
   * -----------------
   * Five key operational numbers surfaced on arrival.
   * Sourced from orders_operational_control_snapshot.
   * Null = snapshot not yet available.
   */
  pulse: {
    shipToday: number | null;
    blockedOrders: number | null;
    blockedRevenue: number | null;
    aging24h: number | null;
    aging48h: number | null;
    aging72hPlus: number | null;
  } | null;
  /**
   * MORNING BRIEF (OVR-01)
   * ----------------------
   * Pre-computed ranked signals for owner/admin.
   * Null = trust not eligible or brief not yet computed.
   * Undefined = not fetched yet (loading state).
   */

  /** Shop display currency ISO code — e.g. 'GBP', 'USD'. Used to format revenue impact on signals. */
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
};

type Signal = NonNullable<NonNullable<OverviewModuleFT2DataProps['morningBrief']>['signals'][number]>;

// ─────────────────────────────────────────────
// SIGNAL TONE — maps priority to semantic palette keys
// Uses MUI theme colors — no hardcoded hex
// ─────────────────────────────────────────────
type SignalToneKey = 'urgent' | 'warning' | 'info' | 'success';

function getSignalTone(priority: number): SignalToneKey {
  if (priority <= 2) return 'urgent';
  if (priority <= 4) return 'warning';
  return 'info';
}

// ─────────────────────────────────────────────
// THEME HOOK — uses LaSyncro design tokens directly
// Mirrors useSyncTheme pattern from SyncAnimationPage
// ─────────────────────────────────────────────
function useOverviewTheme() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  return {
    isDark,
    cardBg:       isDark ? '#1C2740' : '#FFFFFF',
    pageBg:       isDark ? '#151D29' : '#F8F9FA',
    border:       isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)',
    divider:      isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)',
    textPrimary:  isDark ? '#F0EEE8' : '#0F0E0D',
    textSecond:   isDark ? '#8B8F9A' : '#6B7280',
    tileBg:       isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
    footerBg:     isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
    shadow:       isDark ? '0 1px 3px rgba(0,0,0,0.4)' : '0 1px 3px rgba(0,0,0,0.06)',
  };
}

// Human-readable module labels for signal cards
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

function moduleLabel(module: string): string {
  return MODULE_LABELS[module] ?? module;
}

function SignalCard({
  signal,
  onNavigate,
  currency,
}: {
  signal: Signal;
  onNavigate?: (deepLink: string) => void;
  currency?: string;
}) {
  const theme = useTheme();
  const pal = useOverviewTheme();
  const toneKey = getSignalTone(signal.priority);

  const toneMap = {
    urgent: {
      bg: alpha(theme.palette.error.main, pal.isDark ? 0.15 : 0.08),
      border: theme.palette.error.main,
      title: pal.isDark ? '#FF9999' : theme.palette.error.dark,
      sub: pal.isDark ? '#FF9999' : theme.palette.error.main,
    },
    warning: {
      bg: alpha(theme.palette.warning.main, pal.isDark ? 0.15 : 0.1),
      border: theme.palette.warning.main,
      title: pal.isDark ? '#FFD580' : theme.palette.warning.dark,
      sub: pal.isDark ? '#FFD580' : theme.palette.warning.main,
    },
    info: {
      bg: alpha(theme.palette.primary.main, pal.isDark ? 0.12 : 0.07),
      border: theme.palette.primary.main,
      title: pal.isDark ? '#93C5FD' : theme.palette.primary.dark,
      sub: pal.isDark ? '#93C5FD' : theme.palette.primary.main,
    },
    success: {
      bg: alpha(theme.palette.success.main, pal.isDark ? 0.15 : 0.08),
      border: theme.palette.success.main,
      title: pal.isDark ? '#86EFAC' : theme.palette.success.dark,
      sub: pal.isDark ? '#86EFAC' : theme.palette.success.main,
    },
  };

  const tone = toneMap[toneKey];

  return (
    <Box
      sx={{
        background: tone.bg,
        borderLeft: `3px solid ${tone.border}`,
        borderTopRightRadius: '8px',
        borderBottomRightRadius: '8px',
        p: '0.75rem 0.9rem',
        mb: '6px',
        '&:last-child': { mb: 0 },
      }}
    >
      <Typography sx={{ fontSize: 13, fontWeight: 500, color: tone.title, lineHeight: 1.4, mb: '3px' }}>
        {signal.title}
      </Typography>
      <Typography sx={{ fontSize: 11, color: tone.sub, lineHeight: 1.5 }}>
        {signal.detail}
      </Typography>
      {signal.revenueImpact != null && !/[$£€¥]/.test(signal.detail) && (
        <Typography sx={{ fontSize: 11, color: theme.palette.error.main, mt: '2px' }}>
          {new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Math.round(signal.revenueImpact))} at risk
        </Typography>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: '6px', flexWrap: 'wrap' }}>
        {onNavigate && (
          <Box
            component="button"
            onClick={() => onNavigate(signal.deepLink)}
            sx={{
              fontSize: 10,
              fontWeight: 500,
              px: '8px',
              py: '3px',
              borderRadius: '4px',
              background: tone.border,
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              lineHeight: 1.6,
            }}
          >
            View in {moduleLabel(signal.module)} →
          </Box>
        )}
        <Chip
          label={moduleLabel(signal.module)}
          size="small"
          sx={{ fontSize: 9, height: 18, opacity: 0.6 }}
        />
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────
// METRIC TILE
// ─────────────────────────────────────────────
function MetricTile({
  value,
  label,
  tone = 'neutral',
  onClick,
  navLabel,
  currency,
}: {
  value: number | null;
  label: string;
  tone?: 'critical' | 'warning' | 'neutral';
  onClick?: () => void;
  navLabel?: string;
  /** When provided, value is formatted as currency */
  currency?: string;
}) {
  const theme = useTheme();

  const pal = useOverviewTheme();
  const tileColor =
    tone === 'critical' ? theme.palette.error.main :
    tone === 'warning'  ? theme.palette.warning.main :
    pal.textPrimary;

  return (
    <Box
      sx={{
        background: theme.palette.mode === 'dark'
          ? 'rgba(255,255,255,0.04)'
          : 'rgba(0,0,0,0.04)',
        borderRadius: '6px',
        p: '0.6rem 0.75rem',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Typography sx={{ fontSize: 16, fontWeight: 500, color: tileColor, lineHeight: 1.2 }}>
        {value != null
          ? currency
            ? new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
            : value.toLocaleString()
          : '—'}
      </Typography>
      <Typography sx={{ fontSize: 10, color: 'text.secondary', mt: '1px', lineHeight: 1.3, flex: 1 }}>
        {label}
      </Typography>
      {onClick && navLabel && (
        <Box
          component="button"
          onClick={onClick}
          sx={{
            alignSelf: 'flex-end',
            mt: '6px',
            fontSize: 10,
            fontWeight: 500,
            color: theme.palette.primary.main,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            p: 0,
            lineHeight: 1,
            '&:hover': { opacity: 0.7 },
          }}
        >
          {navLabel} →
        </Box>
      )}
    </Box>
  );
}

// ─────────────────────────────────────────────
// AGING BAND
// ─────────────────────────────────────────────
function AgingBand({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number | null;
  tone: 'critical' | 'warning' | 'neutral';
  onClick?: () => void;
}) {
  const theme = useTheme();
  const hasValue = value != null && value > 0;

  const bg =
    tone === 'critical' && hasValue ? alpha(theme.palette.error.main, 0.1) :
    tone === 'warning' && hasValue  ? alpha(theme.palette.warning.main, 0.1) :
    theme.palette.mode === 'dark'   ? alpha('#ffffff', 0.05) :
    alpha(theme.palette.primary.main, 0.04);

  const color =
    tone === 'critical' && hasValue ? theme.palette.error.main :
    tone === 'warning' && hasValue  ? theme.palette.warning.main :
    theme.palette.text.secondary;

  const borderColor =
    tone === 'critical' && hasValue ? alpha(theme.palette.error.main, 0.4) :
    tone === 'warning' && hasValue  ? alpha(theme.palette.warning.main, 0.4) :
    theme.palette.divider;

  return (
    <Box
      onClick={hasValue && onClick ? onClick : undefined}
      sx={{
        px: '10px', py: '5px',
        borderRadius: '6px',
        fontSize: 12,
        fontWeight: hasValue ? 500 : 400,
        cursor: hasValue && onClick ? 'pointer' : 'default',
        background: bg,
        color,
        border: `0.5px solid ${borderColor}`,
        transition: 'opacity 0.15s',
        '&:hover': hasValue && onClick ? { opacity: 0.8 } : {},
      }}
    >
      {value ?? 0} {label}
    </Box>
  );
}

// ─────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────
function OverviewModuleFT2Inner(props: OverviewModuleFT2Props) {
  const theme = useTheme();
  const pal = useOverviewTheme();
  const { morningBrief, pulse, onNavigate, onRefreshBrief } = props;

  const isLoading = morningBrief === undefined;
  const isTrustGated = morningBrief === null;
  const signals = morningBrief?.signals ?? [];
  const hasUrgent = morningBrief?.hasUrgentIssues ?? false;
  const greeting = morningBrief?.greeting ?? null;
  const summaryLine = morningBrief?.summaryLine ?? null;
  const generatedAt = morningBrief?.generatedAt ?? null;
  const trustWarning = morningBrief?.trustWarning ?? false;

  const generatedTime = generatedAt
    ? new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  // Theme-aware surface colors using MUI palette
  const cardBg = pal.cardBg;
  const sectionBorder = pal.border;
  const footerBg = pal.footerBg;

  // LaSyncro brand green for date header — consistent with spec, not semantic
  const brandGreen = '#1D9E75';

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Box
        sx={{
          background: cardBg,
          border: `0.5px solid ${sectionBorder}`,
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow: theme.palette.mode === 'dark'
            ? '0 1px 3px rgba(0,0,0,0.4)'
            : '0 1px 3px rgba(0,0,0,0.06)',
        }}
      >

        {/* ── HEADER ── */}
        <Box sx={{ p: '1.1rem 1.25rem 0.85rem', borderBottom: `0.5px solid ${sectionBorder}` }}>
          <Typography sx={{
            fontSize: 10, fontWeight: 500,
            color: brandGreen,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            mb: '5px',
          }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </Typography>

          {isLoading ? (
            <>
              <Skeleton width="55%" height={28} sx={{ mb: '3px' }} />
              <Skeleton width="75%" height={18} />
            </>
          ) : isTrustGated ? (
            <>
              <Typography sx={{ fontSize: 18, fontWeight: 500, color: 'text.primary', mb: '3px', lineHeight: 1.3 }}>
                Setting things up
              </Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', lineHeight: 1.6 }}>
                Your morning brief will appear here once your first Shopify sync completes. This usually takes a few minutes.
              </Typography>
            </>
          ) : (
            <>
              <Typography sx={{ fontSize: 18, fontWeight: 500, color: 'text.primary', mb: '3px', lineHeight: 1.3 }}>
                {greeting ?? 'Good morning'}
              </Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', lineHeight: 1.6 }}>
                {summaryLine ?? 'Preparing your brief...'}
              </Typography>
            </>
          )}
        </Box>

        {/* ── METRIC GRID ── */}
        {!isLoading && !isTrustGated && (
          <Box sx={{ p: '0.85rem 1.25rem', borderBottom: `0.5px solid ${sectionBorder}` }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              <MetricTile
                value={pulse?.shipToday ?? null}
                label="Ship today"
                tone="neutral"
                onClick={onNavigate ? () => onNavigate('/orders?filter=ready') : undefined}
                navLabel="To orders"
              />
              <MetricTile
                value={pulse?.blockedOrders ?? null}
                label="Blocked orders"
                tone={pulse?.blockedOrders ? 'warning' : 'neutral'}
                onClick={onNavigate ? () => onNavigate('/orders?filter=blocked') : undefined}
                navLabel="To orders"
              />
              <MetricTile
                value={pulse?.blockedRevenue != null ? Math.round(Number(pulse.blockedRevenue)) : null}
                label="Blocked Revenue"
                tone={pulse?.blockedRevenue ? 'critical' : 'neutral'}
                onClick={onNavigate ? () => onNavigate('/cash-flow?focus=constrained') : undefined}
                navLabel="To cash flow"
                currency={props.currency}
              />
            </Box>
          </Box>
        )}

        {/* ── AGING BANDS — same tile style as metric grid ── */}
        {!isLoading && !isTrustGated && pulse && (
          <Box sx={{ p: '0.85rem 1.25rem', borderBottom: `0.5px solid ${sectionBorder}` }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              <MetricTile
                value={pulse.aging24h}
                label="24h+ early warning"
                tone={pulse.aging24h ? 'warning' : 'neutral'}
                onClick={onNavigate ? () => onNavigate('/orders?aging=24h') : undefined}
                navLabel="To orders"
              />
              <MetricTile
                value={pulse.aging48h}
                label="48h+ needs attention"
                tone={pulse.aging48h ? 'warning' : 'neutral'}
                onClick={onNavigate ? () => onNavigate('/orders?aging=48h') : undefined}
                navLabel="To orders"
              />
              <MetricTile
                value={pulse.aging72hPlus}
                label="72h+ SLA breached"
                tone={pulse.aging72hPlus ? 'critical' : 'neutral'}
                onClick={onNavigate ? () => onNavigate('/orders?aging=72h') : undefined}
                navLabel="To orders"
              />
              </Box>
            </Box>
        )}

        {/* ── SIGNALS ── */}
        {!isLoading && !isTrustGated && (
          <Box sx={{ p: '0.85rem 1.25rem', borderBottom: `0.5px solid ${sectionBorder}` }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '8px' }}>
              <Typography sx={{
                fontSize: 11, fontWeight: 500,
                color: 'text.secondary',
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
              }}>
                {hasUrgent ? 'Needs attention' : 'Signals'}
              </Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                {signals.length} {signals.length === 1 ? 'item' : 'items'}
              </Typography>
            </Box>

            {signals.length === 0 ? (
              <Box sx={{
                background: alpha(theme.palette.success.main, 0.08),
                borderLeft: `3px solid ${theme.palette.success.main}`,
                borderTopRightRadius: '8px',
                borderBottomRightRadius: '8px',
                p: '0.75rem 0.9rem',
              }}>
                <Typography sx={{ fontSize: 13, fontWeight: 500, color: theme.palette.success.dark, lineHeight: 1.4 }}>
                  No urgent issues today
                </Typography>
                <Typography sx={{ fontSize: 11, color: theme.palette.success.main, lineHeight: 1.5 }}>
                  All operations are on track
                </Typography>
              </Box>
            ) : (
              signals.map((signal) => (
                <SignalCard key={signal.id} signal={signal} onNavigate={onNavigate} currency={props.currency} />
              ))
            )}
          </Box>
        )}

        
        {/* ── FOOTER ── */}
        <Box sx={{
          p: '0.75rem 1.25rem',
          background: footerBg,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
            {trustWarning && (
              <Box component="span" sx={{ color: 'warning.main', mr: 1 }}>
                Data may be stale ·
              </Box>
            )}
            {isTrustGated ? 'Waiting for data sync' : generatedTime ? `Updated at ${generatedTime}` : 'Updating...'}
          </Typography>
          {onRefreshBrief && (
            <Box
              component="button"
              onClick={onRefreshBrief}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: 11,
                fontWeight: 500,
                color: pal.isDark ? pal.textSecond : theme.palette.primary.main,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                p: 0,
                '&:hover': { opacity: 0.75 },
              }}
            >
              <RefreshCw size={11} />
              Refresh
            </Box>
          )}
        </Box>

      </Box>
    </Box>
  );
}

export default function OverviewModuleFT2(props: OverviewModuleFT2Props) {
  return <ModuleErrorBoundary moduleName="overview"><OverviewModuleFT2Inner {...props} /></ModuleErrorBoundary>;
}