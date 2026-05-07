// modules/customers/src/ui/pages/CustomersModuleFT2.tsx
import { memo } from 'react';
import { Box, Typography, useTheme, Chip } from '@mui/material';
import { ModuleLoadingSkeleton } from '@lasyncro/shared/ui';
import { Users, TrendingUp, AlertTriangle, Star } from 'lucide-react';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';
import { ModuleErrorBoundary } from '@lasyncro/shared/ui';

/**
 * LOCAL TYPES
 * -----------
 * Mirror CustomerLtvResponse from frontend hook.
 * Defined locally to avoid cross-rootDir import.
 */
export type CustomerLtvRecord = {
  customer_hashed_id: string;
  total_orders: number;
  total_revenue: number;
  avg_order_value: number;
  first_order_at: string | null;
  last_order_at: string | null;
  days_since_last_order: number | null;
  total_refunds: number;
  net_revenue: number;
  churn_risk: 'low' | 'medium' | 'high';
  customer_tier: 'VIP' | 'CORE' | 'AT_RISK' | 'LOST' | 'NEW';
};

export type CustomerLtvSummary = {
  total_customers: number;
  avg_ltv: number;
  avg_order_frequency: number;
  avg_days_between_orders: number | null;
  vip_count: number;
  at_risk_count: number;
  lost_count: number;
};

export type CustomerLtvData = {
  summary: CustomerLtvSummary;
  customers: CustomerLtvRecord[];
  computed_at: string;
} | null;

/**
 * CUSTOMERS MODULE FT2 PROPS
 * --------------------------
 * Rebuilt from scratch — LTV-first design.
 * Previous snapshot-based props discarded.
 */
export interface CustomersModuleFT2Props {
  ltv: CustomerLtvData;
  /** CURRENCY LAYER 3 — pass from EntitlementsContext, never hardcode */
  currency?: CurrencyContext;
}

const TIER_COLORS: Record<string, string> = {
  VIP: '#7C3AED',
  CORE: '#2563EB',
  NEW: '#16A34A',
  AT_RISK: '#CA8A04',
  LOST: '#DC2626',
};

const CHURN_LABELS: Record<string, string> = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
};

function StatBox({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color?: string;
}) {
  return (
    <Box
      sx={{
        flex: 1,
        p: 2.5,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        minWidth: 140,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, color: color ?? 'text.secondary' }}>
        {icon}
        <Typography variant="caption" color="inherit">{label}</Typography>
      </Box>
      <Typography variant="h5" fontWeight={700} sx={{ color: color ?? 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  );
}

const CustomerRow = memo(function CustomerRow({ customer, currency }: { customer: CustomerLtvRecord; currency?: CurrencyContext }) {
  const theme = useTheme();

  const fmt = (n: number) => formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);

  const churnColor =
    customer.churn_risk === 'low'
      ? theme.palette.success.main
      : customer.churn_risk === 'medium'
      ? theme.palette.warning.main
      : theme.palette.error.main;

  const shortId = customer.customer_hashed_id.slice(0, 8).toUpperCase();

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1fr 1fr',
        px: 2,
        py: 1.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
        alignItems: 'center',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Chip
          label={customer.customer_tier}
          size="small"
          sx={{
            bgcolor: TIER_COLORS[customer.customer_tier] ?? theme.palette.primary.main,
            color: '#fff',
            fontWeight: 700,
            fontSize: 10,
            height: 20,
          }}
        />
        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 11 }}>
          {shortId}
        </Typography>
      </Box>
      <Typography variant="body2">{customer.total_orders}</Typography>
      <Typography variant="body2" fontWeight={600}>{fmt(customer.total_revenue)}</Typography>
      <Typography variant="body2">{fmt(customer.avg_order_value)}</Typography>
      <Typography variant="body2">
        {customer.days_since_last_order != null
          ? `${customer.days_since_last_order}d ago`
          : '—'}
      </Typography>
      <Typography variant="caption" sx={{ color: churnColor, fontWeight: 600 }}>
        {CHURN_LABELS[customer.churn_risk]}
      </Typography>
    </Box>
  );
});

function CustomersModuleFT2Inner({ ltv, currency }: CustomersModuleFT2Props) {
  const theme = useTheme();

  const fmt = (n: number) => formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);

  const summary = ltv?.summary;
  const customers = ltv?.customers ?? [];

  return (
    <Box sx={{ p: 3 }}>

      {/* HEADER */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>Customers</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Lifetime value, order frequency, and churn intelligence — anonymous, PII-free.
        </Typography>
      </Box>

      {!ltv && <ModuleLoadingSkeleton />}

      {summary && (
        <>
          {/* ZONE 1 — LTV PULSE */}
          <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
            <StatBox
              label="Total Customers"
              value={String(summary.total_customers)}
              icon={<Users size={14} />}
            />
            <StatBox
              label="Avg Lifetime Value"
              value={fmt(summary.avg_ltv)}
              icon={<TrendingUp size={14} />}
              color={theme.palette.primary.main}
            />
            <StatBox
              label="Avg Order Frequency"
              value={`${summary.avg_order_frequency} orders`}
              icon={<TrendingUp size={14} />}
            />
            <StatBox
              label="VIP Customers"
              value={String(summary.vip_count)}
              icon={<Star size={14} />}
              color="#7C3AED"
            />
            <StatBox
              label="At Risk"
              value={String(summary.at_risk_count)}
              icon={<AlertTriangle size={14} />}
              color={theme.palette.warning.main}
            />
          </Box>

          {/* ZONE 2 — AT-RISK COHORT */}
          {(summary.at_risk_count > 0 || summary.lost_count > 0) && (() => {
            const atRiskCustomers = customers
              .filter(c => c.customer_tier === 'AT_RISK' || c.customer_tier === 'LOST')
              .slice(0, 5);
            return (
              <Box sx={{
                mb: 3,
                border: '1px solid',
                borderColor: theme.palette.warning.main,
                borderRadius: 2,
                overflow: 'hidden',
              }}>
                <Box sx={{
                  px: 2, py: 1.5,
                  bgcolor: theme.palette.mode === 'dark'
                    ? 'rgba(202,138,4,0.12)'
                    : 'rgba(202,138,4,0.06)',
                  borderBottom: '1px solid',
                  borderColor: theme.palette.warning.main,
                  display: 'flex', alignItems: 'center', gap: 1,
                }}>
                  <AlertTriangle size={14} color={theme.palette.warning.main} />
                  <Typography variant="caption" fontWeight={700} color="warning.main">
                    {summary.at_risk_count + summary.lost_count} high-value customers need attention
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                    No order in 90+ days
                  </Typography>
                </Box>
                {atRiskCustomers.map(c => (
                  <Box key={c.customer_hashed_id} sx={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr 1fr',
                    px: 2, py: 1.25,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    alignItems: 'center',
                    '&:last-child': { borderBottom: 'none' },
                  }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{
                        width: 8, height: 8, borderRadius: '50%',
                        bgcolor: c.customer_tier === 'LOST'
                          ? theme.palette.error.main
                          : theme.palette.warning.main,
                      }} />
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                        {c.customer_hashed_id.slice(0, 8).toUpperCase()}
                      </Typography>
                    </Box>
                    <Typography variant="caption" fontWeight={600}>
                      {fmt(c.total_revenue)} LTV
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {c.days_since_last_order != null ? `${c.days_since_last_order}d ago` : '—'}
                    </Typography>
                    <Box sx={{
                      display: 'inline-flex',
                      bgcolor: c.customer_tier === 'LOST'
                        ? theme.palette.error.main
                        : theme.palette.warning.main,
                      color: '#fff',
                      borderRadius: '4px',
                      px: '6px', py: '2px',
                      width: 'fit-content',
                    }}>
                      <Typography sx={{ fontSize: 10, fontWeight: 700 }}>
                        {c.customer_tier}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            );
          })()}

          {/* ZONE 3 — CUSTOMER TABLE */}
          {customers.length > 0 && (
            <Box>
              <Typography variant="overline" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
                Customer Intelligence — ranked by lifetime value
              </Typography>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1fr 1fr',
                  px: 2,
                  py: 1,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                }}
              >
                {['Customer', 'Orders', 'LTV', 'Avg Order', 'Last Order', 'Churn Risk'].map(h => (
                  <Typography key={h} variant="caption" color="text.secondary" fontWeight={600}>
                    {h}
                  </Typography>
                ))}
              </Box>

              {customers.map(c => (
                <CustomerRow key={c.customer_hashed_id} customer={c} currency={currency} />
              ))}
            </Box>
          )}

          {customers.length === 0 && (
            <Box sx={{ py: 4, textAlign: 'center', border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
              <Typography variant="body2" color="text.secondary">
                No registered customer orders found. Guest checkouts are excluded by design.
              </Typography>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

export default function CustomersModuleFT2(props: CustomersModuleFT2Props) {
  return <ModuleErrorBoundary moduleName="customers"><CustomersModuleFT2Inner {...props} /></ModuleErrorBoundary>;
}