// apps/frontend/src/pages/ft2-pages/OrderDetailPage.tsx
//
// ORDER DETAIL PAGE (ORD-12)
// --------------------------
// Single-order drill-in surface. Tab bar stays.
// Route: /orders/:orderId  (add to LifecycleRouteHost under /orders/*)
//
// Layout:
//   Header  — serif #XXXX + italic accent status phrase + status badges
//   Body    — two columns: left (line items) · right (payment + fulfillment + timeline)

import { useParams, useNavigate } from 'react-router-dom';
import { Box, Typography, useTheme, CircularProgress } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ArrowLeft } from 'lucide-react';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { useOrderDetail } from '../orders/useOrderDetail';
import type { OrderTimelineEvent, OrderLineItem } from '../orders/useOrderDetail';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const fmt$ = (n: number | null | undefined, currency = 'GBP') =>
  n == null ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(n);

const statusPhrase = (status: string | undefined): string => {
  switch (status) {
    case 'fulfilled':          return 'out the door.';
    case 'partially_fulfilled': return 'almost there.';
    case 'processing':         return 'being picked.';
    case 'pending':            return 'waiting to ship.';
    case 'cancelled':          return 'cancelled.';
    default:                   return 'in progress.';
  }
};

const statusBadgeColor = (status: string): 'success' | 'warning' | 'error' | 'default' => {
  if (status === 'fulfilled') return 'success';
  if (status === 'partially_fulfilled' || status === 'processing') return 'warning';
  if (status === 'cancelled') return 'error';
  return 'default';
};

// ─── STATUS BADGE ─────────────────────────────────────────────────────────────

function StatusBadge({ label, color }: { label: string; color: 'success' | 'warning' | 'error' | 'default' }) {
  const theme = useTheme();
  const palette = {
    success: theme.palette.success.main,
    warning: theme.palette.warning.main,
    error:   theme.palette.error.main,
    default: 'var(--ink-4)',
  }[color];

  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center',
      px: 1.25, py: 0.5,
      borderRadius: '4px',
      bgcolor: alpha(palette, theme.palette.mode === 'dark' ? 0.18 : 0.08),
      border: `1px solid ${alpha(palette, 0.3)}`,
    }}>
      <Typography sx={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: palette }}>
        {label}
      </Typography>
    </Box>
  );
}

// ─── TIMELINE EVENT ROW ───────────────────────────────────────────────────────

function TimelineRow({ event, isLast }: { event: OrderTimelineEvent; isLast: boolean }) {
  return (
    <Box sx={{ display: 'flex', gap: 1.5, position: 'relative' }}>
      {/* Vertical connector */}
      {!isLast && (
        <Box sx={{ position: 'absolute', left: 5, top: 14, bottom: -8, width: '1px', bgcolor: 'var(--rule)' }} />
      )}
      <Box sx={{ width: 11, height: 11, borderRadius: '50%', bgcolor: 'var(--accent)', flexShrink: 0, mt: '3px' }} />
      <Box sx={{ pb: 2 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', textTransform: 'capitalize' }}>
          {event.status.replace(/_/g, ' ')}
        </Typography>
        <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
          {new Date(event.event_occurred_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
        </Typography>
      </Box>
    </Box>
  );
}

// ─── LINE ITEM ROW ────────────────────────────────────────────────────────────

function LineItemRow({ item, currency }: { item: OrderLineItem; currency: string }) {
  return (
    <Box sx={{
      display: 'grid', gridTemplateColumns: '40px 1fr auto',
      gap: 1.5, alignItems: 'center',
      py: 1.5, borderBottom: '1px solid var(--rule)',
      '&:last-child': { borderBottom: 'none' },
    }}>
      {/* Product image */}
      <Box sx={{
        width: 40, height: 40, borderRadius: '6px',
        bgcolor: 'var(--bg-3)', border: '1px solid var(--rule)',
        overflow: 'hidden', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {item.image_url
          ? <img src={item.image_url} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <Typography sx={{ fontSize: 9, color: 'var(--ink-4)' }}>IMG</Typography>
        }
      </Box>

      {/* Title + SKU */}
      <Box>
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{item.title}</Typography>
        <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
          {item.sku ?? 'No SKU'} · qty {item.quantity}
        </Typography>
      </Box>

      {/* Line total */}
      <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
        {fmt$(item.line_total, currency)}
      </Typography>
    </Box>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { data: order, isLoading, isError } = useOrderDetail(orderId ?? null);

  const fulfillmentStatus = order?.fulfillment?.status ?? 'pending';
  const currency = order?.currency ?? 'GBP';

  const cardSx = {
    bgcolor: 'var(--surface)',
    border: '1px solid var(--rule)',
    borderRadius: '10px',
    overflow: 'hidden',
    mb: 3,
  };

  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%' }}>
      <ModuleTabBar tabs={ORDERS_MODULE_TABS} />

      <Box sx={{ p: '32px 40px' }}>

        {/* Back link */}
        <Box
          onClick={() => navigate('/orders')}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 2.5, cursor: 'pointer', width: 'fit-content' }}
        >
          <ArrowLeft size={14} color="var(--ink-4)" />
          <Typography sx={{ fontSize: 12, color: 'var(--ink-4)', '&:hover': { color: 'var(--ink)' } }}>
            Orders
          </Typography>
        </Box>

        {/* Loading */}
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
            <CircularProgress size={28} />
          </Box>
        )}

        {/* Error */}
        {isError && (
          <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
            Order not found or failed to load.
          </Typography>
        )}

        {order && (
          <>
            {/* ── HEADER ─────────────────────────────────────────────────── */}
            <Box sx={{ mb: 3 }}>
              <Box sx={{ mb: 1 }}>
                <Typography sx={{ fontFamily: '"DM Serif Display", serif', fontSize: 36, fontWeight: 400, color: 'var(--ink)', display: 'inline' }}>
                  Order #{order.externalOrderId ?? order.id.slice(0, 8).toUpperCase()}
                </Typography>
                {' '}
                <Typography sx={{ fontFamily: '"DM Serif Display", serif', fontSize: 36, fontWeight: 400, fontStyle: 'italic', color: 'var(--accent)', display: 'inline' }}>
                  {statusPhrase(fulfillmentStatus)}
                </Typography>
              </Box>

              {/* Status badges */}
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <StatusBadge
                  label={fulfillmentStatus.replace(/_/g, ' ')}
                  color={statusBadgeColor(fulfillmentStatus)}
                />
                <StatusBadge label={order.paymentState.replace(/_/g, ' ')} color="default" />
                {order.lineItems.length > 0 && (
                  <StatusBadge label={`${order.lineItems.length} line items`} color="default" />
                )}
              </Box>
            </Box>

            {/* ── TWO COLUMN BODY ────────────────────────────────────────── */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 3, alignItems: 'start' }}>

              {/* LEFT — Order Contents */}
              <Box>
                <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1.5 }}>
                  Order Contents
                </Typography>
                <Box sx={cardSx}>
                  <Box sx={{ px: 2 }}>
                    {order.lineItems.map(item => (
                      <LineItemRow key={item.id} item={item} currency={currency} />
                    ))}
                    {order.lineItems.length === 0 && (
                      <Typography sx={{ fontSize: 13, color: 'var(--ink-4)', py: 3, textAlign: 'center' }}>
                        No line items found.
                      </Typography>
                    )}
                  </Box>
                  {/* Order total footer */}
                  <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid var(--rule)', display: 'flex', justifyContent: 'space-between', bgcolor: 'var(--bg-2)' }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total</Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{fmt$(order.total, currency)}</Typography>
                  </Box>
                </Box>
              </Box>

              {/* RIGHT — Payment + Fulfillment + Timeline */}
              <Box>

                {/* Payment */}
                <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1.5 }}>
                  Payment
                </Typography>
                <Box sx={cardSx}>
                  {[
                    { label: 'Order total', value: fmt$(order.total, currency) },
                    { label: 'Payment state', value: order.paymentState.replace(/_/g, ' ') },
                    { label: 'Currency', value: order.currency },
                    { label: 'Order date', value: new Date(order.createdAt).toLocaleDateString('en-GB', { dateStyle: 'medium' }) },
                  ].map(row => (
                    <Box key={row.label} sx={{ display: 'flex', justifyContent: 'space-between', px: 2, py: 1.25, borderBottom: '1px solid var(--rule)', '&:last-child': { borderBottom: 'none' } }}>
                      <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>{row.label}</Typography>
                      <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>{row.value}</Typography>
                    </Box>
                  ))}
                </Box>

                {/* Fulfillment status */}
                {order.fulfillment && (
                  <>
                    <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1.5 }}>
                      Fulfillment
                    </Typography>
                    <Box sx={cardSx}>
                      {[
                        { label: 'Status', value: order.fulfillment.status.replace(/_/g, ' ') },
                        order.fulfillment.fulfilled_at && { label: 'Fulfilled at', value: new Date(order.fulfillment.fulfilled_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) },
                        order.fulfillment.inventory_block_type && { label: 'Inventory block', value: order.fulfillment.inventory_block_type },
                        order.fulfillment.customer_block_type && { label: 'Customer block', value: order.fulfillment.customer_block_type },
                        order.fulfillment.operational_block_type && { label: 'Operational block', value: order.fulfillment.operational_block_type },
                    ].filter((r): r is { label: string; value: string } => !!r).map((row) => (
                        <Box key={row.label} sx={{ display: 'flex', justifyContent: 'space-between', px: 2, py: 1.25, borderBottom: '1px solid var(--rule)', '&:last-child': { borderBottom: 'none' } }}>
                          <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>{row.label}</Typography>
                          <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', textTransform: 'capitalize' }}>{row.value}</Typography>
                        </Box>
                      ))}
                    </Box>
                  </>
                )}

                {/* Timeline */}
                {order.timeline.length > 0 && (
                  <>
                    <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1.5 }}>
                      Timeline
                    </Typography>
                    <Box sx={{ ...cardSx, p: 2 }}>
                      {order.timeline.map((event, i) => (
                        <TimelineRow
                          key={event.id}
                          event={event}
                          isLast={i === order.timeline.length - 1}
                        />
                      ))}
                    </Box>
                  </>
                )}

              </Box>
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}