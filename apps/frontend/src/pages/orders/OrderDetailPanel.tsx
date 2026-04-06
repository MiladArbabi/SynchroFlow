// apps/frontend/src/pages/orders/OrderDetailPanel.tsx
import { Box, Drawer, Typography, Button, CircularProgress, Alert } from '@mui/material';
import { useOrderDecision, useExecuteOrderDecision } from './useOrderDecision';
import { getConstraintLabel } from './useConstrainedOrders';

/**
 * ORDER DETAIL PANEL (B-02)
 * -------------------------
 * Right-side drawer for a single constrained order.
 *
 * Responsibilities:
 * - Constraint reason in operator vocabulary (B-04)
 * - Recommended action display
 * - Execution trigger via POST /execute (B-03)
 * - Inline execution feedback — optimistic + settled state
 *
 * Rules:
 * - Opens as drawer — operator stays in queue context
 * - Never navigates away
 * - Button disabled while in-flight
 */

/**
 * ACTION LABEL TRANSLATION (B-04)
 * --------------------------------
 * System action types → operator-facing language.
 */
const ACTION_LABELS: Record<string, string> = {
  proceed_fulfillment: 'Proceed to Ship',
  resolve_operational_block: 'Mark as Resolved',
  resolve_inventory_block: 'Acknowledge Stock Issue',
  resolve_customer_block: 'Flag for Customer Review',
};

function getActionLabel(actionType: string): string {
  return ACTION_LABELS[actionType] ?? 'Take Action';
}

type OrderDetailPanelProps = {
  orderId: string | null;
  onClose: () => void;
};

export function OrderDetailPanel({ orderId, onClose }: OrderDetailPanelProps) {
  const { data, isLoading, isError } = useOrderDecision(orderId);
  const {
    mutate: execute,
    isPending,
    isSuccess,
    isError: isExecError,
    error: execError,
  } = useExecuteOrderDecision();

  const open = !!orderId;
  const decision = data?.decision;
  const constraints = data?.constraints ?? [];
  const recommendedAction = decision?.recommended_action;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: 420, p: 3 } }}
    >
      {/* HEADER */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h6" fontWeight={600}>
          Order Detail
        </Typography>
        <Button size="small" onClick={onClose}>Close</Button>
      </Box>

      {/* LOADING */}
      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {/* ERROR */}
      {isError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          No decision found for this order.
        </Alert>
      )}

      {/* DECISION CONTENT */}
      {decision && (
        <Box>

          {/* CONSTRAINTS — operator vocabulary (B-04) */}
          {constraints.length > 0 && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="overline" color="text.secondary">
                Issue
              </Typography>
              {constraints.map((c, i) => (
                <Box key={i} sx={{ mt: 0.5 }}>
                  <Typography variant="body1" fontWeight={500}>
                    {getConstraintLabel(c.constraint_type)}
                  </Typography>
                  {c.block_type && (
                    <Typography variant="body2" color="text.secondary">
                      {c.block_type.replace(/_/g, ' ')}
                    </Typography>
                  )}
                  {c.started_at && (
                    <Typography variant="caption" color="text.secondary">
                      Since {new Date(c.started_at).toLocaleDateString()}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          )}

          {/* REASON */}
          {decision.reason && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="overline" color="text.secondary">
                Why
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {decision.reason}
              </Typography>
            </Box>
          )}

          {/* RECOMMENDED ACTION + EXECUTION FEEDBACK (B-03) */}
          {recommendedAction && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="overline" color="text.secondary">
                Recommended Action
              </Typography>

              {/**
               * EXECUTION FEEDBACK STATES (B-03)
               * ---------------------------------
               * idle     → action button shown
               * pending  → button shows spinner, disabled
               * success  → green confirmation, no button
               * error    → red alert, button re-enabled
               *
               * Optimistic queue removal handled in useExecuteOrderDecision.
               */}
              {isSuccess ? (
                <Alert severity="success" sx={{ mt: 1 }}>
                  Action queued. The queue will update shortly.
                </Alert>
              ) : isExecError ? (
                <>
                  <Alert severity="error" sx={{ mt: 1 }}>
                    {execError?.message ?? 'Execution failed. Please try again.'}
                  </Alert>
                  <Button
                    variant="contained"
                    fullWidth
                    sx={{ mt: 1 }}
                    onClick={() => orderId && execute(orderId)}
                  >
                    {getActionLabel(recommendedAction.type)}
                  </Button>
                </>
              ) : (
                <Button
                  variant="contained"
                  fullWidth
                  sx={{ mt: 1 }}
                  disabled={isPending || decision.status === 'resolved'}
                  onClick={() => orderId && execute(orderId)}
                  startIcon={isPending
                    ? <CircularProgress size={16} color="inherit" />
                    : null}
                >
                  {isPending ? 'Processing…' : getActionLabel(recommendedAction.type)}
                </Button>
              )}

              {decision.status === 'resolved' && !isSuccess && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  This decision has already been resolved.
                </Typography>
              )}
            </Box>
          )}

          {/* LIFECYCLE TRAIL */}
          {decision.lifecycle?.resolved_at && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Resolved {new Date(decision.lifecycle.resolved_at).toLocaleString()}
                {decision.lifecycle.outcome && ` — ${decision.lifecycle.outcome}`}
              </Typography>
            </Box>
          )}

        </Box>
      )}
    </Drawer>
  );
}