/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/ft2-pages/FulfillmentQueuePage.tsx

import { useState } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Card,
  CardContent,
  CardActionArea,
  Chip,
  Divider,
} from '@mui/material';
import {
  useConstrainedOrders,
  getConstraintLabel,
  type ConstrainedOrder,
} from '../orders/useConstrainedOrders';
import { useTheme } from '@mui/material/styles';
import { OrderDetailPanel } from '../orders/OrderDetailPanel';
import { getSlaProximity, getAgeLabel } from '../orders/useConstrainedOrders';
import { usePlanEntitlement } from '../../hooks/usePlanEntitlement';

/**
 * FULFILLMENT QUEUE PAGE (B-01)
 * -----------------------------
 * Three-swimlane operator control surface.
 *
 * Swimlanes (operator vocabulary — B-04):
 * - Overdue        (operational constraints)
 * - Out of Stock   (inventory constraints)
 * - Address Issue  (customer constraints)
 *
 * Each card is selectable → opens OrderDetailPanel (B-02).
 * Execution feedback handled inside the panel (B-03).
 */

const SWIMLANES = [
  {
    constraint_type: 'operational',
    label: 'Overdue',
    color: '#C62828',
    description: 'Orders past SLA — need immediate action',
  },
  {
    constraint_type: 'inventory',
    label: 'Out of Stock',
    color: '#F9A825',
    description: 'Orders blocked by missing inventory',
  },
  {
    constraint_type: 'customer',
    label: 'Address Issue',
    color: '#1976D2',
    description: 'Orders blocked by customer data problems',
  },
];

type OrderCardProps = {
  order: ConstrainedOrder;
  onSelect: (orderId: string) => void;
  showMargin: boolean;
};

function OrderCard({ order, onSelect, showMargin }: OrderCardProps) {
  const theme = useTheme();
  const proximity = getSlaProximity(order);
  const ageLabel = getAgeLabel(order);

  const slaColor =
    proximity === 'breached' ? theme.palette.error.main :
    proximity === 'warning'  ? theme.palette.warning.main :
    theme.palette.success.main;

  const revenue = order.revenue != null
    ? `$${Number(order.revenue).toFixed(2)}`
    : null;

  const marginPct = order.margin_pct != null ? Math.round(Number(order.margin_pct) * 100) : null;
  const marginColor =
    marginPct == null ? theme.palette.text.secondary :
    marginPct >= 40 ? theme.palette.success.main :
    marginPct >= 20 ? theme.palette.warning.main :
    theme.palette.error.main;

  return (
    <Card
      variant="outlined"
      sx={{
        mb: 1.5,
        borderRadius: 1.5,
        borderLeft: `3px solid ${slaColor}`,
      }}
    >
      <CardActionArea onClick={() => onSelect(order.order_id)}>
        <CardContent sx={{ py: 1.5, px: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Typography variant="body2" fontWeight={600} sx={{ fontFamily: 'monospace' }}>
              {order.order_id.slice(0, 8).toUpperCase()}
            </Typography>
            {revenue && (
              <Typography variant="body2" fontWeight={500} color="text.secondary">
                {revenue}
              </Typography>
            )}
          </Box>

          <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            {order.block_type && (
              <Chip
                label={order.block_type.replace(/_/g, ' ')}
                size="small"
                variant="outlined"
                sx={{ fontSize: 11 }}
              />
            )}
            {/* SLA AGE BADGE — color-coded proximity */}
            <Chip
              label={
                proximity === 'breached'
                  ? `⚠ ${ageLabel} — SLA breached`
                  : `${ageLabel} old`
              }
              size="small"
              sx={{
                fontSize: 11,
                bgcolor: proximity === 'breached'
                  ? 'error.main'
                  : proximity === 'warning'
                  ? 'warning.main'
                  : 'success.main',
                color: '#fff',
                fontWeight: proximity === 'breached' ? 700 : 400,
              }}
            />

            {/* MARGIN CHIP — Growth tier only */}
            {showMargin && marginPct != null && (
              <Chip
                label={`${marginPct}% margin`}
                size="small"
                sx={{
                  fontSize: 11,
                  color: marginColor,
                  borderColor: marginColor,
                  fontWeight: 600,
                }}
                variant="outlined"
              />
            )}
          </Box>

          {order.recommended_action && (
            <Typography variant="caption" color="primary" sx={{ mt: 0.5, display: 'block' }}>
              → {order.recommended_action.type.replace(/_/g, ' ')}
            </Typography>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

type SwimlaneProps = {
  constraint_type: string;
  label: string;
  color: string;
  description: string;
  orders: ConstrainedOrder[];
  onSelect: (orderId: string) => void;
  showMargin: boolean;
};

function Swimlane({ label, color, description, orders, onSelect, showMargin }: SwimlaneProps) {
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      {/* SWIMLANE HEADER */}
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color }} />
          <Typography variant="subtitle1" fontWeight={700}>
            {label}
          </Typography>
          <Chip
            label={orders.length}
            size="small"
            sx={{ bgcolor: color, color: '#fff', fontWeight: 700, fontSize: 11 }}
          />
        </Box>
        <Typography variant="caption" color="text.secondary">
          {description}
        </Typography>
      </Box>

      <Divider sx={{ mb: 2 }} />

      {/* ORDER CARDS */}
      {orders.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
          No orders
        </Typography>
      ) : (
        orders.map((order) => (
          <OrderCard
            key={order.order_id}
            order={order}
            onSelect={onSelect}
            showMargin={showMargin}
          />
        ))
      )}
    </Box>
  );
}

export default function FulfillmentQueuePage() {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const { data, isLoading, isError } = useConstrainedOrders();
  const { can } = usePlanEntitlement();
  const showMargin = can('cashflow.revenue_buckets');

  const orders = data?.data ?? [];

  /**
   * GROUP BY CONSTRAINT TYPE
   * ------------------------
   * Each swimlane filters the full list by its constraint_type.
   * Operator sees three parallel columns.
   */
  const grouped = (constraintType: string) =>
    orders.filter((o) => o.constraint_type === constraintType);

  return (
    <Box sx={{ p: 3 }}>

      {/* PAGE HEADER */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>
          Fulfillment Queue
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Orders that need your attention before they can ship.
        </Typography>
      </Box>

      {/* LOADING */}
      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {/* ERROR */}
      {isError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load constrained orders. Please refresh.
        </Alert>
      )}

      {/* THREE SWIMLANES */}
      {!isLoading && !isError && (
        <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
          {SWIMLANES.map((lane) => (
            <Swimlane
              key={lane.constraint_type}
              {...lane}
              orders={grouped(lane.constraint_type)}
              onSelect={setSelectedOrderId}
              showMargin={showMargin}
            />
          ))}
        </Box>
      )}

      {/* ORDER DETAIL PANEL */}
      <OrderDetailPanel
        orderId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
      />

    </Box>
  );
}