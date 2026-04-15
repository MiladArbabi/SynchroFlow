// modules/overview/src/ui/pages/OverviewModuleFT2.tsx
import { Box, Typography, Divider, Chip, Button } from '@mui/material';
import { useTheme } from '@mui/material/styles';

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
    /** Orders ready to leave today — positive action queue */
    shipToday: number | null;
    /** Orders that cannot ship without operator action */
    blockedOrders: number | null;
    /** Revenue held in blocked orders */
    blockedRevenue: number | null;
    /** Orders 24h–48h old — early warning */
    aging24h: number | null;
    /** Orders 48h–72h old — needs attention */
    aging48h: number | null;
    /** Orders 72h+ old — crisis, SLA breached */
    aging72hPlus: number | null;
  } | null;

  /**
   * MORNING BRIEF (OVR-01)
   * ----------------------
   * Pre-computed ranked signals for owner/admin.
   * Null = trust not eligible or brief not yet computed.
   * Undefined = not fetched yet (loading state).
   */
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
  } | null;
}

export type OverviewModuleFT2Props = OverviewModuleFT2DataProps & {
  onNavigate?: (deepLink: string) => void;
  onRefreshBrief?: () => void;
};

// --- Priority color map ---
const PRIORITY_BORDER: Record<number, { border: string; borderLeft: string }> = {
  1: { border: 'error.light',   borderLeft: 'error.main' },
  2: { border: 'error.light',   borderLeft: 'error.main' },
  3: { border: 'warning.light', borderLeft: 'warning.main' },
  4: { border: 'warning.light', borderLeft: 'warning.main' },
  5: { border: 'divider',       borderLeft: 'text.disabled' },
};

function MorningBriefZone({
  morningBrief,
  onNavigate,
  onRefreshBrief,
}: {
  morningBrief: OverviewModuleFT2DataProps['morningBrief'];
  onNavigate?: (deepLink: string) => void;
  onRefreshBrief?: () => void;
}) {
  const theme = useTheme();

  // Not fetched yet
  if (morningBrief === undefined) return null;

  // Trust not eligible
  if (morningBrief === null) return null;

  const { signals, hasUrgentIssues, generatedAt, trustWarning } = morningBrief;
  const generatedTime = new Date(generatedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Box sx={{ mb: 4 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="overline" color="text.secondary">
          Morning Brief
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {trustWarning && (
            <Typography variant="caption" color="warning.main">
              Data may be stale
            </Typography>
          )}
          <Typography variant="caption" color="text.disabled">
            as of {generatedTime}
          </Typography>
          {onRefreshBrief && (
            <Typography
              variant="caption"
              color="primary.main"
              sx={{ cursor: 'pointer', textDecoration: 'underline' }}
              onClick={onRefreshBrief}
            >
              Refresh
            </Typography>
          )}
        </Box>
      </Box>

      {/* Signals */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {signals.length === 0 && (
          <Box
            sx={{
              p: 2,
              border: '1px solid',
              borderColor: 'success.light',
              borderRadius: 1.5,
              borderLeft: '4px solid',
              borderLeftColor: 'success.main',
            }}
          >
            <Typography variant="body2" fontWeight={600}>
              No urgent issues today
            </Typography>
            <Typography variant="caption" color="text.secondary">
              All operations are on track
            </Typography>
          </Box>
        )}

        {signals.map((signal) => {
          const colors = PRIORITY_BORDER[signal.priority] ?? PRIORITY_BORDER[5];
          return (
            <Box
              key={signal.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                p: 2,
                border: '1px solid',
                borderColor: colors.border,
                borderRadius: 1.5,
                borderLeft: '4px solid',
                borderLeftColor: colors.borderLeft,
              }}
            >
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" fontWeight={600}>
                  {signal.title}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {signal.detail}
                </Typography>
                {signal.revenueImpact != null && (
                  <Typography variant="caption" color="error.main" sx={{ display: 'block', mt: 0.25 }}>
                    ${Math.round(signal.revenueImpact).toLocaleString()} at risk
                  </Typography>
                )}
                {onNavigate && (
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => onNavigate(signal.deepLink)}
                    sx={{ mt: 0.5, px: 0, minWidth: 0, fontSize: 11, color: theme.palette.primary.main }}
                  >
                    View in {signal.module} →
                  </Button>
                )}
              </Box>
              <Chip
                label={signal.module}
                size="small"
                variant="outlined"
                sx={{ ml: 2, flexShrink: 0 }}
              />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/**
 * PULSE STAT (B-05)
 * -----------------
 * Single large numeric with label and optional click handler.
 * No charts. No trends. Operator sees the number instantly.
 */
function PulseStat({
  label,
  value,
  tone,
  onClick,
  buttonLabel,
}: {
  label: string;
  value: number | null;
  tone?: 'neutral' | 'warning' | 'critical';
  onClick?: () => void;
  buttonLabel?: string;
}) {
  const theme = useTheme();
  const color =
    tone === 'critical'
      ? theme.palette.error.dark
      : tone === 'warning'
      ? theme.palette.warning.dark
      : theme.palette.text.primary;
  return (
    <Box sx={{ flex: 1, minWidth: 100, px: 2, py: 1.5 }}>
      <Typography
        variant="h5"
        fontWeight={700}
        sx={{ color, fontVariantNumeric: 'tabular-nums' }}
      >
        {value ?? '—'}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
        {label}
      </Typography>
      {onClick && (
        <Button
          size="small"
          variant="text"
          onClick={onClick}
          sx={{ mt: 0.5, px: 0, minWidth: 0, fontSize: 11, color: theme.palette.primary.main }}
        >
          {buttonLabel ?? 'View →'}
        </Button>
      )}
    </Box>
  );
}

/**
 * AGING BAND (OVR-05)
 * -------------------
 * Single aging bucket — count + time label + severity color.
 * Tappable — navigates to Orders pre-filtered to this band.
 */
function AgingBand({
  label,
  count,
  tone,
  onClick,
}: {
  label: string;
  count: number | null;
  tone: 'neutral' | 'warning' | 'critical';
  onClick?: () => void;
}) {
  const theme = useTheme();
  const color =
    tone === 'critical'
      ? theme.palette.error.dark
      : tone === 'warning'
      ? theme.palette.warning.dark
      : theme.palette.text.secondary;
  const borderColor =
    tone === 'critical'
      ? theme.palette.error.light
      : tone === 'warning'
      ? theme.palette.warning.light
      : theme.palette.divider;
  const borderLeftColor =
    tone === 'critical'
      ? theme.palette.error.main
      : tone === 'warning'
      ? theme.palette.warning.main
      : theme.palette.text.disabled;

  return (
    <Box
      sx={{
        flex: 1,
        p: 2,
        border: '1px solid',
        borderColor,
        borderRadius: 1.5,
        borderLeft: '4px solid',
        borderLeftColor,
      }}
    >
      <Typography variant="h5" fontWeight={700} sx={{ color, fontVariantNumeric: 'tabular-nums' }}>
        {count ?? '—'}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
        {label}
      </Typography>
      {onClick && (
        <Button
          size="small"
          variant="text"
          onClick={onClick}
          sx={{ mt: 0.5, px: 0, minWidth: 0, fontSize: 11, color: theme.palette.primary.main }}
        >
          View orders →
        </Button>
      )}
    </Box>
  );
}

export default function OverviewModuleFT2(props: OverviewModuleFT2Props) {
  const { trust, context, snapshot, alignment, pulse } = props;

  const trustTone =
    trust == null
      ? undefined
      : trust.trustEligible === true
      ? 'trusted'
      : trust.trustEligible === false
      ? 'blocked'
      : 'constrained';

    const hasBlocked = pulse?.blockedOrders != null && pulse.blockedOrders > 0;
    const hasAtRisk = pulse?.blockedRevenue != null && pulse.blockedRevenue > 0;

  return (
    <Box sx={{ p: 3 }}>

      {/* ─────────────────────────────────────────
          ZONE 1 — PULSE (OVR-05)
          Three action-oriented numbers + aging bands.
          ───────────────────────────────────────── */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="overline" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
          Right Now
        </Typography>

        {/* Primary stats */}
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            overflow: 'hidden',
            mb: 2,
          }}
        >
          <PulseStat
            label="Ship Today"
            value={pulse?.shipToday ?? null}
            tone="neutral"
            onClick={props.onNavigate ? () => props.onNavigate?.('/orders?filter=ready') : undefined}
            buttonLabel="View orders →"
          />
          <Divider orientation="vertical" flexItem />
          <PulseStat
            label="Blocked Orders"
            value={pulse?.blockedOrders ?? null}
            tone={hasBlocked ? 'warning' : 'neutral'}
            onClick={props.onNavigate ? () => props.onNavigate?.('/orders?filter=blocked') : undefined}
            buttonLabel="Review blocked →"
          />
          <Divider orientation="vertical" flexItem />
          <PulseStat
            label="Blocked Revenue"
            value={
              pulse?.blockedRevenue != null
                ? Math.round(Number(pulse.blockedRevenue))
                : null
            }
            tone={hasAtRisk ? 'critical' : 'neutral'}
            onClick={props.onNavigate ? () => props.onNavigate?.('/cash-flow?focus=constrained') : undefined}
            buttonLabel="View cash flow →"
          />
        </Box>
        {/* Aging bands — button navigation, pre-filtered to Orders */}
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          <AgingBand
            label="24h+ — early warning"
            count={pulse?.aging24h ?? null}
            tone={pulse?.aging24h != null && pulse.aging24h > 0 ? 'warning' : 'neutral'}
            onClick={props.onNavigate ? () => props.onNavigate?.('/orders?aging=24h') : undefined}
          />
          <AgingBand
            label="48h+ — needs attention"
            count={pulse?.aging48h ?? null}
            tone={pulse?.aging48h != null && pulse.aging48h > 0 ? 'warning' : 'neutral'}
            onClick={props.onNavigate ? () => props.onNavigate?.('/orders?aging=48h') : undefined}
          />
          <AgingBand
            label="72h+ — SLA breached"
            count={pulse?.aging72hPlus ?? null}
            tone={pulse?.aging72hPlus != null && pulse.aging72hPlus > 0 ? 'critical' : 'neutral'}
            onClick={props.onNavigate ? () => props.onNavigate?.('/orders?aging=72h') : undefined}
          />
        </Box>
      </Box>

      {/* ─────────────────────────────────────────
          ZONE 2 — MORNING BRIEF (OVR-01)
          Pre-computed ranked signals for owner/admin.
          Replaces Today's Priorities when available.
          ───────────────────────────────────────── */}
      <MorningBriefZone
        morningBrief={props.morningBrief}
        onNavigate={props.onNavigate}
        onRefreshBrief={props.onRefreshBrief}
      />

    </Box>
  );
}