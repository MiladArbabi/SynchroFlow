// modules/overview/src/ui/pages/OverviewModuleFT2.tsx
import { Box, Typography, Skeleton, Chip } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
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

  /** Display name for the greeting — first_name from JWT. Falls back to "there" if absent. */
  userName?: string | null;
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
  onExportBrief?: () => void;
  onResolveAll?: () => void;
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
  const theme = useTheme();
  // Use LaSyncro design tokens — consistent with all other modules.
  // These CSS vars are defined in themes/index.tsx per color scheme.
  return {
    cardBg:      'var(--surface)',
    pageBg:      'var(--bg)',
    border:      'var(--rule)',
    divider:     'var(--rule)',
    textPrimary: 'var(--ink)',
    textSecond:  'var(--ink-3)',
    tileBg:      'var(--bg-2)',
    footerBg:    'var(--bg-2)',
    shadow:      theme.palette.mode === 'dark'
      ? '0 1px 3px rgba(0,0,0,0.4)'
      : '0 1px 3px rgba(0,0,0,0.06)',
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
      bg:     alpha(theme.palette.error.main, 0.1),
      border: theme.palette.error.main,
      title:  theme.palette.error.main,
      sub:    theme.palette.error.main,
    },
    warning: {
      bg:     alpha(theme.palette.warning.main, 0.1),
      border: theme.palette.warning.main,
      title:  theme.palette.warning.main,
      sub:    theme.palette.warning.main,
    },
    info: {
      bg:     alpha(theme.palette.primary.main, 0.08),
      border: theme.palette.primary.main,
      title:  theme.palette.primary.main,
      sub:    theme.palette.primary.main,
    },
    success: {
      bg:     alpha(theme.palette.success.main, 0.08),
      border: theme.palette.success.main,
      title:  theme.palette.success.main,
      sub:    theme.palette.success.main,
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
// BRIEF ROW — single row in The Brief table
// Severity | Issue (title + sub) | £ at risk | Age | Snooze | Action
// ─────────────────────────────────────────────
function BriefRow({
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
  const isCritical = signal.priority <= 2;
  const isAttention = signal.priority === 3 || signal.priority === 4;

  const badgeBg = isCritical
    ? alpha(theme.palette.error.main, 0.12)
    : isAttention
    ? alpha(theme.palette.warning.main, 0.12)
    : alpha(theme.palette.success.main, 0.12);

  const badgeColor = isCritical
    ? theme.palette.error.main
    : isAttention
    ? theme.palette.warning.main
    : theme.palette.success.main;

  const badgeLabel = isCritical ? 'Critical' : isAttention ? 'Attention' : 'On Track';

  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: '110px 1fr 80px 48px 80px 96px',
      px: '1.25rem',
      py: '10px',
      borderBottom: `0.5px solid ${pal.divider}`,
      alignItems: 'center',
      '&:last-child': { borderBottom: 'none' },
    }}>
      {/* Severity badge */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '5px', px: '6px', py: '3px', borderRadius: '4px', background: badgeBg, width: 'fit-content' }}>
        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: badgeColor, flexShrink: 0 }} />
        <Typography sx={{ fontSize: 11, fontWeight: 500, color: badgeColor }}>{badgeLabel}</Typography>
      </Box>
      {/* Issue */}
      <Box sx={{ pl: '8px' }}>
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: pal.textPrimary, mb: '2px' }}>{signal.title}</Typography>
        <Typography sx={{ fontSize: 11, color: pal.textSecond }}>{moduleLabel(signal.module)} · {signal.detail}</Typography>
      </Box>
      {/* £ at risk */}
      <Typography sx={{ fontSize: 13, fontWeight: 500, color: pal.textPrimary }}>
        {signal.revenueImpact != null
          ? new Intl.NumberFormat('en', { style: 'currency', currency: currency ?? 'GBP', maximumFractionDigits: 0 }).format(Math.round(signal.revenueImpact))
          : '—'}
      </Typography>
      {/* Age — not yet in signal contract, placeholder */}
      <Typography sx={{ fontSize: 12, color: pal.textSecond }}>—</Typography>
      {/* Snooze */}
      <Box
        component="button"
        sx={{ fontSize: 11, color: pal.textSecond, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', p: 0, '&:hover': { color: pal.textPrimary } }}
      >
        Snooze
      </Box>
      {/* Action */}
      {onNavigate && (
        <Box
          component="button"
          onClick={() => onNavigate(signal.deepLink)}
          sx={{ fontSize: 12, fontWeight: 500, px: '10px', py: '5px', borderRadius: '5px', background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', '&:hover': { opacity: 0.85 } }}
        >
          {signal.priority <= 2 ? 'Review ›' : 'Open ›'}
        </Box>
      )}
    </Box>
  );
}

function timeOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

// ─────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────
function OverviewModuleFT2Inner(props: OverviewModuleFT2Props) {
  const theme = useTheme();
  const pal = useOverviewTheme();
  const { morningBrief, pulse, onNavigate, onRefreshBrief, onExportBrief, onResolveAll } = props;

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
    <Box sx={{ p: { xs: 2, md: '32px 40px' }, display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* ── HEADER — sits directly on page bg, no card container ── */}
      <Box>
        <Box sx={{ pb: '0.5rem' }}>
          {/* DATE + PAGE ACTIONS row */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: '5px' }}>
            <Typography sx={{
              fontSize: 10, fontWeight: 500,
              color: brandGreen,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}>
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              {' · '}
              <Box component="span" sx={{ color: brandGreen }}>{isLoading ? 'SYNCING…' : 'LIVE'}</Box>
            </Typography>
            {/* PAGE ACTIONS — Export brief + Resolve all */}
            {!isLoading && !isTrustGated && (
              <Box sx={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                {onExportBrief && (
                  <Box
                    component="button"
                    onClick={onExportBrief}
                    sx={{ fontSize: 12, fontWeight: 500, px: '12px', py: '6px', borderRadius: '6px', border: `0.5px solid ${sectionBorder}`, background: 'transparent', color: pal.textPrimary, cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
                  >
                    Export brief
                  </Box>
                )}
                {onResolveAll && (
                  <Box
                    component="button"
                    onClick={onResolveAll}
                    sx={{ fontSize: 12, fontWeight: 500, px: '12px', py: '6px', borderRadius: '6px', border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', '&:hover': { opacity: 0.85 } }}
                  >
                    Resolve all →
                  </Box>
                )}
              </Box>
            )}
          </Box>

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
              <Typography sx={{ fontFamily: '"DM Serif Display", serif', fontSize: 36, fontWeight: 400, color: 'text.primary', mb: '3px', lineHeight: 1.15 }}>
                {props.userName ? `Good ${timeOfDay()}, ${props.userName}.` : (greeting ?? 'Good afternoon.')}
              </Typography>
              <Typography sx={{ fontSize: 13, color: 'text.secondary', lineHeight: 1.6 }}>
                {pulse?.blockedOrders
                  ? `${signals.length} issue${signals.length !== 1 ? 's' : ''} need a decision today${pulse.blockedRevenue ? ` — ${new Intl.NumberFormat('en', { style: 'currency', currency: props.currency ?? 'GBP', maximumFractionDigits: 0 }).format(Math.round(Number(pulse.blockedRevenue)))} of revenue at stake` : ''}.`
                  : (summaryLine ?? 'All operations are on track.')}
              </Typography>
            </>
          )}
        </Box>

        {/* ── STAT CARDS — 4 cards: Revenue at Risk · Orders Blocked · Ready to Ship · SLA Breached ── */}
        {!isLoading && !isTrustGated && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              {/* Revenue at Risk — danger color */}
              <Box sx={{ background: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '10px', p: '14px 16px' }}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: pal.textSecond, mb: '8px' }}>Revenue at risk</Typography>
                <Typography sx={{ fontSize: 28, fontWeight: 500, color: theme.palette.error.main, lineHeight: 1 }}>
                  {pulse?.blockedRevenue != null
                    ? new Intl.NumberFormat('en', { style: 'currency', currency: props.currency ?? 'GBP', maximumFractionDigits: 0 }).format(Math.round(Number(pulse.blockedRevenue)))
                    : '—'}
                </Typography>
                <Typography sx={{ fontSize: 11, color: pal.textSecond, mt: '6px' }}>
                  {pulse?.blockedOrders ? `across ${pulse.blockedOrders} blocked orders` : 'no blocked orders'}
                </Typography>
              </Box>
              {/* Orders Blocked */}
              <Box sx={{ background: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '10px', p: '14px 16px', cursor: onNavigate ? 'pointer' : 'default' }} onClick={onNavigate ? () => onNavigate('/orders?filter=blocked') : undefined}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: pal.textSecond, mb: '8px' }}>Orders blocked</Typography>
                <Typography sx={{ fontSize: 28, fontWeight: 500, color: pal.textPrimary, lineHeight: 1 }}>
                  {pulse?.blockedOrders ?? '—'}<Box component="span" sx={{ fontSize: 14, fontWeight: 400, ml: '4px' }}>orders</Box>
                </Typography>
                <Typography sx={{ fontSize: 11, color: pal.textSecond, mt: '6px' }}>
                  {pulse?.blockedOrders ? 'need a decision to ship' : 'queue is clear'}
                </Typography>
              </Box>
              {/* Ready to Ship */}
              <Box sx={{ background: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '10px', p: '14px 16px', cursor: onNavigate ? 'pointer' : 'default' }} onClick={onNavigate ? () => onNavigate('/orders?filter=ready') : undefined}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: pal.textSecond, mb: '8px' }}>Ready to ship</Typography>
                <Typography sx={{ fontSize: 28, fontWeight: 500, color: pal.textPrimary, lineHeight: 1 }}>
                  {pulse?.shipToday ?? '—'}<Box component="span" sx={{ fontSize: 14, fontWeight: 400, ml: '4px' }}>orders</Box>
                </Typography>
                <Typography sx={{ fontSize: 11, color: pal.textSecond, mt: '6px' }}>
                  {pulse?.shipToday ? 'ready for pick & pack' : 'nothing queued yet'}
                </Typography>
              </Box>
              {/* SLA Breached */}
              <Box sx={{ background: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '10px', p: '14px 16px', cursor: onNavigate ? 'pointer' : 'default' }} onClick={onNavigate ? () => onNavigate('/orders?aging=72h') : undefined}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: pal.textSecond, mb: '8px' }}>SLA breached</Typography>
                <Typography sx={{ fontSize: 28, fontWeight: 500, color: pal.textPrimary, lineHeight: 1 }}>
                  {pulse?.aging72hPlus ?? '—'}<Box component="span" sx={{ fontSize: 14, fontWeight: 400, ml: '4px' }}>orders</Box>
                </Typography>
                <Typography sx={{ fontSize: 11, color: pal.textSecond, mt: '6px' }}>72h+ past promised ship</Typography>
              </Box>
            </Box>
          )}

        {/* ── THE BRIEF — severity-grouped table ── */}
        {!isLoading && !isTrustGated && (
          <Box sx={{ background: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '10px', overflow: 'hidden', mt: '16px' }}>
            {/* Table header */}
            <Box sx={{ px: '1.25rem', pt: '1.1rem', pb: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '0.5px solid var(--rule)' }}>
              <Box>
                <Typography sx={{ fontSize: 14, fontWeight: 600, color: pal.textPrimary }}>The Brief</Typography>
                <Typography sx={{ fontSize: 11, color: pal.textSecond, mt: '2px' }}>Ranked by commercial consequence</Typography>
              </Box>
              <Typography sx={{ fontSize: 11, color: pal.textSecond }}>{generatedTime ? `Updated ${generatedTime}` : 'Updating...'}</Typography>
            </Box>

            {/* Column headers */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '110px 1fr 80px 48px 80px 96px', px: '1.25rem', py: '8px', borderTop: '0.5px solid var(--rule)', borderBottom: '0.5px solid var(--rule)', background: 'var(--bg-3)' }}>
              {['Severity', 'Issue', '£ at risk', 'Age', '', 'Action'].map(col => (
                <Typography key={col} sx={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em', color: pal.textSecond }}>{col}</Typography>
              ))}
            </Box>

            {signals.length === 0 ? (
              <Box sx={{ px: '1.25rem', py: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: theme.palette.success.main }} />
                <Typography sx={{ fontSize: 13, color: pal.textSecond }}>No urgent issues — all operations on track</Typography>
              </Box>
            ) : (
              <>
                {/* CRITICAL group */}
                {signals.filter(s => s.priority <= 2).length > 0 && (
                  <>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', px: '1.25rem', py: '8px', bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.error.main, 0.18) : alpha(theme.palette.error.main, 0.06) }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: theme.palette.error.main }} />
                      <Typography sx={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.palette.error.main }}>Critical — Act today</Typography>
                      <Typography sx={{ ml: 'auto', fontSize: 11, color: pal.textSecond }}>{signals.filter(s => s.priority <= 2).length} items</Typography>
                    </Box>
                    {signals.filter(s => s.priority <= 2).map(signal => (
                      <BriefRow key={signal.id} signal={signal} onNavigate={onNavigate} currency={props.currency} />
                    ))}
                  </>
                )}
                {/* ATTENTION group */}
                {signals.filter(s => s.priority === 3 || s.priority === 4).length > 0 && (
                  <>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', px: '1.25rem', py: '8px', bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.warning.main, 0.18) : alpha(theme.palette.warning.main, 0.06) }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: theme.palette.warning.main }} />
                      <Typography sx={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.palette.warning.main }}>Attention — Review this week</Typography>
                      <Typography sx={{ ml: 'auto', fontSize: 11, color: pal.textSecond }}>{signals.filter(s => s.priority === 3 || s.priority === 4).length} items</Typography>
                    </Box>
                    {signals.filter(s => s.priority === 3 || s.priority === 4).map(signal => (
                      <BriefRow key={signal.id} signal={signal} onNavigate={onNavigate} currency={props.currency} />
                    ))}
                  </>
                )}
                {/* ON TRACK group */}
                {signals.filter(s => s.priority === 5).length > 0 && (
                  <>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', px: '1.25rem', py: '8px', bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.success.main, 0.18) : alpha(theme.palette.success.main, 0.06) }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: theme.palette.success.main }} />
                      <Typography sx={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.palette.success.main }}>On track — No action needed</Typography>
                      <Typography sx={{ ml: 'auto', fontSize: 11, color: pal.textSecond }}>{signals.filter(s => s.priority === 5).length} items</Typography>
                    </Box>
                    {signals.filter(s => s.priority === 5).map(signal => (
                      <BriefRow key={signal.id} signal={signal} onNavigate={onNavigate} currency={props.currency} />
                    ))}
                  </>
                )}
              </>
            )}
          {/* ── FOOTER — inside The Brief card, always visible when brief is shown ── */}
          <Box sx={{
            p: '0.75rem 1.25rem',
            background: 'var(--bg-2)',
            borderTop: '0.5px solid var(--rule)',
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
                  color: theme.palette.primary.main,
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
        )}
        
        </Box>
    </Box>
  );
}

export default function OverviewModuleFT2(props: OverviewModuleFT2Props) {
  return <ModuleErrorBoundary moduleName="overview"><OverviewModuleFT2Inner {...props} /></ModuleErrorBoundary>;
}