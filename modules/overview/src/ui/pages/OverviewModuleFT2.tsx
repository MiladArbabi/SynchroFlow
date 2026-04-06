// modules/overview/src/ui/pages/OverviewModuleFT2.tsx
import { Box, Typography, Divider, Chip } from '@mui/material';
import { PanelRow } from '@lasyncro/ui-ft2';

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
    readyToShip: number | null;
    constrained: number | null;
    atRiskRevenue: number | null;
    oldestExceptionHours: number | null;
    pendingFulfillment: number | null;
  } | null;
}

export type OverviewModuleFT2Props = OverviewModuleFT2DataProps;

/**
 * PULSE STAT (B-05)
 * -----------------
 * Single large numeric with label.
 * No charts. No trends. Operator sees the number instantly.
 */
function PulseStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null;
  tone?: 'neutral' | 'warning' | 'critical';
}) {
  const color =
    tone === 'critical'
      ? '#C62828'
      : tone === 'warning'
      ? '#F9A825'
      : 'text.primary';

  return (
    <Box sx={{ flex: 1, minWidth: 120, px: 2, py: 1.5 }}>
      <Typography
        variant="h4"
        fontWeight={700}
        sx={{ color, fontVariantNumeric: 'tabular-nums' }}
      >
        {value ?? '—'}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
        {label}
      </Typography>
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

  const hasConstrained = pulse?.constrained != null && pulse.constrained > 0;
  const hasAtRisk = pulse?.atRiskRevenue != null && pulse.atRiskRevenue > 0;

  return (
    <Box sx={{ p: 3 }}>

      {/* ─────────────────────────────────────────
          ZONE 1 — PULSE
          Five numbers that tell the operator
          the state of the business right now.
          ───────────────────────────────────────── */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="overline" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
          Right Now
        </Typography>

        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <PulseStat
            label="Ready to Ship"
            value={pulse?.readyToShip ?? null}
            tone="neutral"
          />
          <Divider orientation="vertical" flexItem />
          <PulseStat
            label="Needs Attention"
            value={pulse?.constrained ?? null}
            tone={hasConstrained ? 'warning' : 'neutral'}
          />
          <Divider orientation="vertical" flexItem />
          <PulseStat
            label="Revenue at Risk"
            value={
              pulse?.atRiskRevenue != null
                ? Math.round(Number(pulse.atRiskRevenue))
                : null
            }
            tone={hasAtRisk ? 'critical' : 'neutral'}
          />
          <Divider orientation="vertical" flexItem />
          <PulseStat
            label="Pending Fulfillment"
            value={pulse?.pendingFulfillment ?? null}
            tone="neutral"
          />
          <Divider orientation="vertical" flexItem />
          <PulseStat
            label="Oldest Exception (hrs)"
            value={pulse?.oldestExceptionHours ?? null}
            tone={
              pulse?.oldestExceptionHours != null &&
              pulse.oldestExceptionHours > 48
                ? 'critical'
                : pulse?.oldestExceptionHours != null &&
                  pulse.oldestExceptionHours > 24
                ? 'warning'
                : 'neutral'
            }
          />
        </Box>
      </Box>

      {/* ─────────────────────────────────────────
          ZONE 2 — PRIORITIES
          What needs operator attention today.
          Sourced from constraint + trust signals.
          ───────────────────────────────────────── */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="overline" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
          Today's Priorities
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {hasConstrained && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                p: 2,
                border: '1px solid',
                borderColor: 'warning.light',
                borderRadius: 1.5,
                borderLeft: '4px solid',
                borderLeftColor: 'warning.main',
              }}
            >
              <Box>
                <Typography variant="body2" fontWeight={600}>
                  {pulse?.constrained} orders need attention
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Review the Fulfillment Queue to resolve blocked orders
                </Typography>
              </Box>
              <Chip label="Fulfillment Queue" size="small" variant="outlined" />
            </Box>
          )}

          {hasAtRisk && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                p: 2,
                border: '1px solid',
                borderColor: 'error.light',
                borderRadius: 1.5,
                borderLeft: '4px solid',
                borderLeftColor: 'error.main',
              }}
            >
              <Box>
                <Typography variant="body2" fontWeight={600}>
                  ${Math.round(Number(pulse?.atRiskRevenue ?? 0)).toLocaleString()} revenue at risk
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Orders with SLA breaches or unresolved constraints
                </Typography>
              </Box>
              <Chip label="Orders" size="small" variant="outlined" />
            </Box>
          )}

          {!hasConstrained && !hasAtRisk && (
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
                No urgent actions required
              </Typography>
              <Typography variant="caption" color="text.secondary">
                All orders are on track
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* ─────────────────────────────────────────
          ZONE 3 — AMBIENT CONTEXT
          Supporting facts that build intuition.
          Not urgent. Informational only.
          ───────────────────────────────────────── */}
      <Box>
        <Typography variant="overline" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
          Business Context
        </Typography>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 2,
          }}
        >
          <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              Total Orders
            </Typography>
            <Typography variant="h6" fontWeight={600} sx={{ mt: 0.5 }}>
              {context?.ordersObserved ?? '—'}
            </Typography>
          </Box>

          <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              Total Revenue
            </Typography>
            <Typography variant="h6" fontWeight={600} sx={{ mt: 0.5 }}>
              {snapshot?.orders?.revenueTotal != null
                ? `$${Number(snapshot.orders.revenueTotal).toLocaleString()}`
                : '—'}
            </Typography>
          </Box>

          <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              Data Trust
            </Typography>
            <Typography variant="h6" fontWeight={600} sx={{ mt: 0.5 }}>
              {trustTone === 'trusted'
                ? '✓ Trusted'
                : trustTone === 'blocked'
                ? '✗ Blocked'
                : '— Unknown'}
            </Typography>
          </Box>
        </Box>
      </Box>

    </Box>
  );
}