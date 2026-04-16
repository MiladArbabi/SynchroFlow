// modules/cashflow/src/ui/pages/CashFlowModuleFT2.tsx

import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  useTheme,
  Divider,
} from '@mui/material';
import { DollarSign, Clock, AlertTriangle, RotateCcw, Package, Lock } from 'lucide-react';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';

/**
 * LOCAL TYPES
 * -----------
 * Mirror CashFlowResponse from the frontend hook.
 * Defined locally to avoid cross-rootDir import.
 */
export type CashFlowSummary = {
  realized_revenue: number;
  pending_revenue: number;
  at_risk_revenue: number;
  total_refunded: number;
  inventory_value: number;
  net_cash_position: number;
  working_capital_locked: number;
};

export type CashFlowBucket = {
  label: string;
  orders: number;
  revenue: number;
  description: string;
};

export type CashFlowByConstraint = {
  constraint_type: string;
  orders: number;
  revenue_blocked: number;
};

export type CashFlowData = {
  summary: CashFlowSummary;
  buckets: CashFlowBucket[];
  by_constraint: CashFlowByConstraint[];
  computed_at: string;
} | null;

export type CashFlowModuleFT2Props = {
  data: CashFlowData;
  isLoading: boolean;
  isError: boolean;
};

const BUCKET_ICONS: Record<string, React.ReactNode> = {
  Realized: <DollarSign size={16} />,
  Pending: <Clock size={16} />,
  'At Risk': <AlertTriangle size={16} />,
  Refunded: <RotateCcw size={16} />,
};

const CONSTRAINT_LABELS: Record<string, string> = {
  operational: 'Overdue orders',
  inventory: 'Out of stock',
  customer: 'Address issues',
};

function StatCard({
  label,
  value,
  subvalue,
  icon,
  color,
}: {
  label: string;
  value: string;
  subvalue?: string;
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
        minWidth: 160,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, color: color ?? 'text.secondary' }}>
        {icon}
        <Typography variant="caption" color="inherit">{label}</Typography>
      </Box>
      <Typography variant="h5" fontWeight={700} sx={{ color: color ?? 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
      {subvalue && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          {subvalue}
        </Typography>
      )}
    </Box>
  );
}

function BucketRow({ bucket }: { bucket: CashFlowBucket }) {
  const theme = useTheme();
  const fmt = (n: number) =>
    formatCurrencyCompact(n);

  const colorMap: Record<string, string> = {
    Realized: theme.palette.success.main,
    Pending: theme.palette.primary.main,
    'At Risk': theme.palette.warning.main,
    Refunded: theme.palette.error.main,
  };

  const color = colorMap[bucket.label] ?? theme.palette.text.secondary;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        py: 1.5,
        px: 2,
        borderBottom: '1px solid',
        borderColor: 'divider',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ color }}>{BUCKET_ICONS[bucket.label]}</Box>
        <Box>
          <Typography variant="body2" fontWeight={600}>{bucket.label}</Typography>
          <Typography variant="caption" color="text.secondary">{bucket.description}</Typography>
        </Box>
      </Box>
      <Box sx={{ textAlign: 'right' }}>
        <Typography variant="body2" fontWeight={700} sx={{ color }}>{fmt(bucket.revenue)}</Typography>
        <Typography variant="caption" color="text.secondary">
          {bucket.orders} order{bucket.orders !== 1 ? 's' : ''}
        </Typography>
      </Box>
    </Box>
  );
}

export default function CashFlowModuleFT2({ data, isLoading, isError }: CashFlowModuleFT2Props) {
  const theme = useTheme();

  const summary = data?.summary;
  const buckets = data?.buckets ?? [];
  const byConstraint = data?.by_constraint ?? [];

  const fmt = (n: number) =>
    formatCurrencyCompact(n);

  return (
    <Box sx={{ p: 3 }}>

      {/* HEADER */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>Cash Flow</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Revenue position, working capital, and blocked cash across your operations.
        </Typography>
      </Box>

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {isError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load cash flow data. Please refresh.
        </Alert>
      )}

      {summary && (
        <>
          {/* ZONE 1 — CASH POSITION */}
          <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
            <StatCard
              label="Net Cash Position"
              value={fmt(summary.net_cash_position)}
              subvalue="Realized revenue minus refunds"
              icon={<DollarSign size={14} />}
              color={theme.palette.success.main}
            />
            <StatCard
              label="Working Capital Locked"
              value={fmt(summary.working_capital_locked)}
              subvalue="Pending orders + inventory value"
              icon={<Lock size={14} />}
              color={theme.palette.warning.main}
            />
            <StatCard
              label="Inventory Value"
              value={fmt(summary.inventory_value)}
              subvalue="Stock on hand at cost"
              icon={<Package size={14} />}
            />
            <StatCard
              label="Revenue at Risk"
              value={fmt(summary.at_risk_revenue)}
              subvalue="Constrained — uncertain timing"
              icon={<AlertTriangle size={14} />}
              color={theme.palette.error.main}
            />
          </Box>

          <Divider sx={{ mb: 3 }} />

          {/* ZONE 2 — REVENUE BUCKETS */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="overline" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
              Revenue by State
            </Typography>
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
              {buckets.map(bucket => (
                <BucketRow key={bucket.label} bucket={bucket} />
              ))}
            </Box>
          </Box>

          {/* ZONE 3 — BLOCKED BY CONSTRAINT */}
          {byConstraint.length > 0 && (
            <Box>
              <Typography variant="overline" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
                Blocked Revenue — by cause
              </Typography>
              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
                {byConstraint.map(c => (
                  <Box
                    key={c.constraint_type}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      px: 2,
                      py: 1.5,
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      '&:last-child': { borderBottom: 'none' },
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    <Box>
                      <Typography variant="body2" fontWeight={600}>
                        {CONSTRAINT_LABELS[c.constraint_type] ?? c.constraint_type}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {c.orders} order{c.orders !== 1 ? 's' : ''} blocked
                      </Typography>
                    </Box>
                    <Typography variant="body2" fontWeight={700} sx={{ color: theme.palette.error.main }}>
                      {fmt(c.revenue_blocked)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}