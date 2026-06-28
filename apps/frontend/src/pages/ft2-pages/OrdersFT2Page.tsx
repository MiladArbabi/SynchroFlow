// apps/frontend/src/pages/ft2-pages/OrdersFT2Page.tsx
//
// OrdersFT2Page
// -------------
// FT2-only Orders observability surface.
//
// HARD CONTRACT:
// - MUST render OrdersModuleFT2 only
// - MUST NOT render FT1 modules
// - MUST NOT infer lifecycle
// - MUST assume FT2 routing is authoritative
//
// onPriorityFlag (Change 2 · Sprint 3):
// - Fires POST /api/v1/wms/orders/:orderId/priority for each selected id
// - Parallel via Promise.all — order-independent
// - Invalidates ['wms','order-pool'] so ReleaseQueuePage reflects priority
//   flags immediately when the navigation lands there
//
// onOrderClick (2026-06-28 — ORD-03, see entity-detail-modal-playbook.md §2):
// - Opens EntityDetailModal for the clicked order. Replaces the previous
//   OrderDetailPanel import, which was confirmed dead (its open trigger was
//   never wired anywhere — setSelectedOrderId was only ever called with
//   null). OrderDetailPanel.tsx and OrderDetailPage.tsx are now orphaned —
//   not deleted yet, flagging for a decision rather than removing unasked.
// - Modal merges useOrderDecision (constraint + recommended action) and
//   usePickExceptionsForOrder (NEW — per-exception audit trail, separate
//   concern from the order-level block, see that hook's file header).
// - DEFERRED, NOT YET MERGED: useOrderDetail's content (line items, payment,
//   fulfillment, tracking, timeline, pack decisions) — see
//   entity-detail-modal-playbook.md §2.5 step 3. Until merged, the modal
//   title shows a truncated order ID rather than externalOrderId, since
//   that field isn't fetched at this layer yet.
import { useState, useCallback, useEffect } from 'react';
import { Box, Typography, Button, CircularProgress, Alert } from '@mui/material';
import { EntityDetailModal } from '@lasyncro/shared/ui';
import { useSetPriority } from '../wms/useOrderPool';
import { OrdersModuleFT2 } from '@lasyncro/order-nexus';
import { useOrdersFt2Snapshot } from '../orders/useOrdersFt2Snapshot';
import { mapOrdersFt2Props } from '../orders/useOrdersFt2Adapter';
import { useOrdersOperatorSummary } from '../orders/useOrdersOperatorSummary';
import { useOrderDecision, useExecuteOrderDecision } from '../orders/useOrderDecision';
import { useOrderDetail } from '../orders/useOrderDetail';
import { getConstraintLabel } from '../orders/useConstrainedOrders';
import { usePickExceptionsForOrder, useResolvePickException } from '../orders/usePickExceptionsForOrder';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { useExchangeRates } from 'hooks/useExchangeRates';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { OrderCapBanner } from '../../components/OrderCapBanner';
import { axiosInstance } from 'api/axiosConfig';

const __DEV__ = import.meta.env.DEV;

// Ported from the now-orphaned OrderDetailPanel.tsx (B-02/B-04) — system
// action types → operator-facing language.
const ACTION_LABELS: Record<string, string> = {
  proceed_fulfillment: 'Proceed to Ship',
  resolve_operational_block: 'Mark as Resolved',
  resolve_inventory_block: 'Acknowledge Stock Issue',
  resolve_customer_block: 'Flag for Customer Review',
};
function getActionLabel(actionType: string): string {
  return ACTION_LABELS[actionType] ?? 'Take Action';
}

/**
 * OrderDetailModalBody
 * --------------------
 * Separate function, not inline JSX, so each query's loading/error state
 * is handled locally — a slow pick-exceptions fetch shouldn't block the
 * recommended-action button from rendering.
 */
function OrderDetailModalBody({ orderId, onTitleReady }: { orderId: string; onTitleReady: (title: string) => void }) {
  const { data, isLoading, isError } = useOrderDecision(orderId);
  const {
    mutate: execute,
    isPending,
    isSuccess,
    isError: isExecError,
    error: execError,
  } = useExecuteOrderDecision();

  const exceptionsQuery = usePickExceptionsForOrder(orderId);
  const resolveException = useResolvePickException(orderId);
  const detailQuery = useOrderDetail(orderId);

  const decision = data?.decision;
  const constraints = data?.constraints ?? [];
  const recommendedAction = decision?.recommended_action;
  const exceptions = exceptionsQuery.data?.exceptions ?? [];
  const unresolvedExceptions = exceptions.filter(e => !e.resolved);
  const order = detailQuery.data;

  // Reports the real title up to the parent once useOrderDetail resolves —
  // EntityDetailModal's header renders before this body mounts, so the
  // title can't be computed here and rendered here too; see call site.
  useEffect(() => {
    if (order) {
      onTitleReady(order.externalOrderId ? `Order #${order.externalOrderId}` : `Order #${orderId.slice(0, 8).toUpperCase()}`);
    }
  }, [order, orderId, onTitleReady]);

  if (isLoading || detailQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={24} sx={{ color: 'var(--accent)' }} />
      </Box>
    );
  }

  if (isError) {
    return <Alert severity="warning" sx={{ mb: 2 }}>No decision found for this order.</Alert>;
  }

  return (
    <Box>
      {order && (
        <Box sx={{ mb: 3, pb: 2, borderBottom: '1px solid var(--rule)' }}>
          <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
            Order Contents
          </Typography>
          {order.lineItems.map(item => (
            <Box key={item.id} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75 }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, color: 'var(--ink)' }}>{item.title}</Typography>
                <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>{item.sku ?? 'No SKU'} · qty {item.quantity}</Typography>
              </Box>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: order.currency }).format(item.line_total)}
              </Typography>
            </Box>
          ))}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 1, mt: 0.5, borderTop: '1px solid var(--rule)' }}>
            <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', textTransform: 'uppercase' }}>Total</Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: order.currency }).format(order.total)}
            </Typography>
          </Box>
          {order.tracking?.tracking_number && (
            <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mt: 1.5 }}>
              Tracking: {order.tracking.tracking_number}
              {order.tracking.carrier_code && ` (${order.tracking.carrier_code})`}
            </Typography>
          )}
        </Box>
      )}
      {constraints.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
            Issue
          </Typography>
          {constraints.map((c, i) => (
            <Box key={i} sx={{ mb: i < constraints.length - 1 ? 1.5 : 0 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
                {getConstraintLabel(c.constraint_type)}
              </Typography>
              {c.block_type && (
                <Typography sx={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                  {c.block_type.replace(/_/g, ' ')}
                </Typography>
              )}
              {c.started_at && (
                <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
                  Since {new Date(c.started_at).toLocaleDateString()}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}

      {decision?.reason && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
            Why
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'var(--ink-2)' }}>{decision.reason}</Typography>
        </Box>
      )}

      {recommendedAction && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
            Recommended Action
          </Typography>
          {isSuccess ? (
            <Alert severity="success">Action queued. The queue will update shortly.</Alert>
          ) : isExecError ? (
            <>
              <Alert severity="error" sx={{ mb: 1 }}>
                {execError?.message ?? 'Execution failed. Please try again.'}
              </Alert>
              <Button variant="contained" fullWidth onClick={() => execute(orderId)}
                sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}>
                {getActionLabel(recommendedAction.type)}
              </Button>
            </>
          ) : (
            <Button
              variant="contained" fullWidth
              disabled={isPending || decision?.status === 'resolved'}
              onClick={() => execute(orderId)}
              startIcon={isPending ? <CircularProgress size={16} color="inherit" /> : null}
              sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}
            >
              {isPending ? 'Processing…' : getActionLabel(recommendedAction.type)}
            </Button>
          )}
          {decision?.status === 'resolved' && !isSuccess && (
            <Typography sx={{ fontSize: 11.5, color: 'var(--ink-4)', mt: 1 }}>
              This decision has already been resolved.
            </Typography>
          )}
        </Box>
      )}

      {!exceptionsQuery.isLoading && exceptions.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
            Pick Exceptions · {unresolvedExceptions.length} open
          </Typography>
          <Box sx={{ bgcolor: 'var(--bg)', border: '1px solid var(--rule)', borderRadius: '10px', overflow: 'hidden' }}>
            {exceptions.map((exc, idx) => (
              <Box key={exc.pick_exception_id} sx={{ px: 2, py: 1.5, borderTop: idx > 0 ? '1px solid var(--rule)' : 'none' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Box>
                    <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                      {exc.exception_type.replace(/_/g, ' ')} — {exc.variant_title ?? exc.sku ?? 'Unknown item'}
                    </Typography>
                    <Typography sx={{ fontSize: 11.5, color: 'var(--ink-4)', mt: 0.25 }}>
                      Batch {exc.batch_short_id} · needed {exc.quantity_required}, found {exc.quantity_found}
                    </Typography>
                  </Box>
                  {exc.resolved ? (
                    <Typography sx={{ fontSize: 11, fontWeight: 600, color: '#4CAF7A' }}>Resolved</Typography>
                  ) : (
                    <Button
                      size="small" variant="outlined"
                      disabled={resolveException.isPending}
                      onClick={() => resolveException.mutate({
                        exceptionId: exc.pick_exception_id,
                        resolutionNote: 'Resolved from Order detail',
                      })}
                      sx={{ fontSize: 11, color: 'var(--accent)', borderColor: 'var(--accent)' }}
                    >
                      Resolve
                    </Button>
                  )}
                </Box>
                {exc.resolved && exc.resolution_note && (
                  <Typography sx={{ fontSize: 11.5, color: 'var(--ink-4)', mt: 0.5, fontStyle: 'italic' }}>
                    "{exc.resolution_note}"
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {decision?.lifecycle?.resolved_at && (
        <Typography sx={{ fontSize: 11.5, color: 'var(--ink-4)' }}>
          Resolved {new Date(decision.lifecycle.resolved_at).toLocaleString()}
          {decision.lifecycle.outcome && ` — ${decision.lifecycle.outcome}`}
        </Typography>
      )}
    </Box>
  );
}

export default function OrdersFT2Page() {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [modalTitle, setModalTitle] = useState('');
  const snapshotQuery = useOrdersFt2Snapshot();
  const operatorSummaryQuery = useOrdersOperatorSummary();
  const { displayCurrency, locale } = useEntitlements();
  const { rates } = useExchangeRates();
  const setPriority = useSetPriority();

  const onPriorityFlag = useCallback(
    async (orderIds: string[], flagged: boolean) => {
      await Promise.all(
        orderIds.map(orderId => setPriority.mutateAsync({ orderId, flagged }))
      );
    },
    [setPriority]
  );

  if (!snapshotQuery.data) {
    return <div>Loading orders insights…</div>;
  }

  const decision = snapshotQuery.data.decision;
  const operationalControl = snapshotQuery.data.operationalControl!;
  const headerProps = mapOrdersFt2Props(snapshotQuery.data, decision);

  if (__DEV__) {
    console.debug('[OrdersFT2Page] rendering OrdersModuleFT2', headerProps);
  }

  return (
    <>
      <ModuleTabBar tabs={ORDERS_MODULE_TABS} />
      <OrderCapBanner />
      <OrdersModuleFT2
        {...headerProps}
        operationalControl={operationalControl}
        operatorSummary={operatorSummaryQuery.data ?? null}
        currency={{ displayCurrency, locale, rates }}
        onPriorityFlag={onPriorityFlag}
        onOrderClick={(orderId) => setSelectedOrderId(orderId)}
        onExport={async () => {
          try {
            const res = await axiosInstance.post('/api/v1/exports/orders', {}, { responseType: 'blob' });
            const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `lasyncro-orders-${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          } catch {
            console.error('[Orders] export failed');
          }
        }}
      />
      <EntityDetailModal
        entityId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
        title={modalTitle}
      >
        {selectedOrderId && (
          <OrderDetailModalBody
            orderId={selectedOrderId}
            onTitleReady={setModalTitle}
          />
        )}
      </EntityDetailModal>
    </>
  );
}
