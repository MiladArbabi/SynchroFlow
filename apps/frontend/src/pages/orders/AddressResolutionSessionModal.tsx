// apps/frontend/src/pages/orders/AddressResolutionSessionModal.tsx
//
// GUIDED RESOLUTION SESSION — ADDRESS PILOT (OPS-RESOLVE-01, Slice B)
// -------------------------------------------------------------------
// A merchant works through every order blocked by customer/incomplete_address
// in one place, one order at a time, and can SEE what they have already fixed.
//
// THE GOVERNING RULE
//   PATCH success is NOT resolution. A row reaches FIXED only when the
//   canonical per-order constraint truth stops reporting
//   customer/incomplete_address WHILE that row is RECHECKING. There is no
//   timer, no optimistic transition, and no inference from the order leaving
//   the parent candidate list.
//
// WHY ROWS ARE CAPTURED, NOT DERIVED
//   Order Detail derives the address block's visibility straight from live
//   constraint truth, so canonical disappearance unmounts it (ADDR-UI-03 asserts
//   exactly that). A session needs the opposite: a row the merchant just fixed
//   must stay on screen as evidence of work done. So session membership is
//   frozen when the session opens and is never pruned while it stays open.
//
// SCOPE (Slice B): this component does NOT fetch
// GET /api/v1/orders/address-resolution. Candidates arrive as a prop; the
// parent owns that orchestration (Slice C).
//
// It reuses ShippingAddressResolver INLINE — no nested dialog — so the
// correction treatment renders inside the session workspace. It does not embed
// OrderDetailModalBody and duplicates none of its logic.

import { useEffect, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';

import { useOrderDecision } from './useOrderDecision';
import { useOrderDetail } from './useOrderDetail';
import { ShippingAddressResolver } from './ShippingAddressResolver';

/** One candidate order handed in by the parent. */
export interface AddressResolutionCandidate {
  lasyncroOrderId: string;
  /** Merchant-facing order number, e.g. "#1001". */
  orderNumber?: string | null;
}

export interface AddressResolutionSessionModalProps {
  open: boolean;
  orders: AddressResolutionCandidate[];
  onClose: () => void;
}

/** Session-local row lifecycle. Never persisted, never server-derived. */
type SessionRowState = 'OPEN' | 'RECHECKING' | 'FIXED';

const CONSTRAINT_TYPE = 'customer';
const BLOCK_TYPE = 'incomplete_address';

/**
 * Canonical oracle for one row, via the existing per-order decision truth.
 * GET /:orderId/decision reads order_constraints with is_active = true, applies
 * NO election and exposes block_type, so it can answer this honestly even when
 * another blocker would win the Order Flow election.
 */
function useHasAddressBlocker(orderId: string): boolean {
  const { data } = useOrderDecision(orderId);
  const constraints = (data?.constraints ?? []) as Array<{
    constraint_type?: string;
    block_type?: string | null;
  }>;
  return constraints.some(
    (c) => c.constraint_type === CONSTRAINT_TYPE && c.block_type === BLOCK_TYPE
  );
}

// ─── ROW ──────────────────────────────────────────────────────────────────────

function SessionRow({
  candidate,
  state,
  isActiveRow,
  onFix,
  onCollapse,
  onSaved,
  onCanonicalClear,
}: {
  candidate: AddressResolutionCandidate;
  state: SessionRowState;
  isActiveRow: boolean;
  onFix: () => void;
  onCollapse: () => void;
  onSaved: () => void;
  onCanonicalClear: () => void;
}) {
  const orderId = candidate.lasyncroOrderId;
  const hasBlocker = useHasAddressBlocker(orderId);
  const { data: detail } = useOrderDetail(orderId);

  /**
   * THE ONLY PATH TO FIXED.
   * Fires only while this row is RECHECKING — i.e. the merchant saved a
   * correction here in THIS session — and only once canonical truth has
   * actually dropped the blocker. A row that was never worked in this session
   * stays OPEN even if its constraint disappears externally, because the
   * session must not credit work it did not witness.
   */
  useEffect(() => {
    if (state === 'RECHECKING' && !hasBlocker) {
      onCanonicalClear();
    }
  }, [state, hasBlocker, onCanonicalClear]);

  const statusLabel =
    state === 'FIXED' ? 'Fixed'
    : state === 'RECHECKING' ? 'Address updated — rechecking order…'
    : 'Address incomplete';

  const statusColor =
    state === 'FIXED' ? 'var(--confirm-ink)'
    : state === 'RECHECKING' ? 'var(--confirm-ink)'
    : 'var(--warning-ink)';

  return (
    <Box
      data-testid={`address-session-row-${orderId}`}
      data-state={state}
      sx={{
        borderBottom: '1px solid var(--rule)',
        '&:last-of-type': { borderBottom: 'none' },
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          alignItems: 'center',
          gap: 1.5,
          px: 2,
          py: 1.5,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
            Order {candidate.orderNumber ?? orderId}
          </Typography>
          <Typography
            sx={{
              fontSize: 12,
              fontWeight: 300,
              color: statusColor,
              mt: 0.25,
              ...(state === 'RECHECKING'
                ? {
                    animation: 'addressSessionRecheckPulse 1400ms ease-in-out infinite',
                    '@keyframes addressSessionRecheckPulse': {
                      '0%, 100%': { opacity: 1 },
                      '50%': { opacity: 0.68 },
                    },
                    '@media (prefers-reduced-motion: reduce)': {
                      animation: 'none',
                      opacity: 1,
                    },
                  }
                : {}),
            }}
          >
            {statusLabel}
          </Typography>
          {state === 'OPEN' && (
            <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', mt: 0.25 }}>
              Required shipping fields are missing, so this order cannot be labelled.
            </Typography>
          )}
        </Box>

        {/* One action per row, and only while there is work to do. */}
        {state === 'OPEN' && !isActiveRow && (
          <Box
            component="button"
            type="button"
            onClick={onFix}
            sx={{
              px: 1.5, py: 0.5, flexShrink: 0, cursor: 'pointer',
              fontSize: 12, fontWeight: 600, textAlign: 'center',
              bgcolor: 'transparent', color: 'var(--accent)',
              border: '0.5px solid var(--accent)', borderRadius: '6px',
              '&:hover': { bgcolor: 'var(--accent-ghost)' },
            }}
          >
            Fix →
          </Box>
        )}
      </Box>

      {/* The reusable treatment, rendered INSIDE the session workspace. */}
      {isActiveRow && state === 'OPEN' && (
        <Box
          data-testid={`address-session-resolver-${orderId}`}
          sx={{ borderTop: '1px solid var(--rule)', bgcolor: 'var(--surface)' }}
        >
          <ShippingAddressResolver
            orderId={orderId}
            currentShipping={detail?.shipping}
            addressAssist={detail?.addressAssist}
            onSaved={onSaved}
            onCancel={onCollapse}
            active
          />
        </Box>
      )}
    </Box>
  );
}

// ─── SESSION ──────────────────────────────────────────────────────────────────

export function AddressResolutionSessionModal({
  open,
  orders,
  onClose,
}: AddressResolutionSessionModalProps) {
  /**
   * CAPTURED MEMBERSHIP.
   * Frozen for the life of this opening. Later changes to `orders` cannot
   * remove a captured row — that is the whole point of a session. Re-keying on
   * `open` means closing discards session state and reopening starts a fresh
   * session from the then-current candidates. Nothing persists across close or
   * reload, and none of this is written anywhere.
   */
  const [captured, setCaptured] = useState<AddressResolutionCandidate[]>(
    () => (open ? orders : [])
  );
  const [rowStates, setRowStates] = useState<Record<string, SessionRowState>>(() =>
    open
      ? Object.fromEntries(orders.map((o) => [o.lasyncroOrderId, 'OPEN' as SessionRowState]))
      : {}
  );
  const [sessionKey, setSessionKey] = useState(() => (open ? 1 : 0));
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);

  // Start a session on open; discard it on close.
  useEffect(() => {
    if (open && sessionKey === 0) {
      setCaptured(orders);
      setRowStates(
        Object.fromEntries(orders.map((o) => [o.lasyncroOrderId, 'OPEN' as SessionRowState]))
      );
      setActiveOrderId(null);
      setSessionKey(1);
    }
    if (!open && sessionKey !== 0) {
      setCaptured([]);
      setRowStates({});
      setActiveOrderId(null);
      setSessionKey(0);
    }
    // `orders` is deliberately NOT a dependency: a live candidate change must
    // never re-capture or prune an in-flight session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionKey]);

  const fixedCount = useMemo(
    () => captured.filter((o) => rowStates[o.lasyncroOrderId] === 'FIXED').length,
    [captured, rowStates]
  );

  const anyRechecking = useMemo(
    () => captured.some((o) => rowStates[o.lasyncroOrderId] === 'RECHECKING'),
    [captured, rowStates]
  );

  if (!open) return null;

  return (
    <Box
      role="dialog"
      aria-modal="true"
      aria-label="Address issues"
      data-testid="address-session"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'var(--surface)',
        border: '1px solid var(--rule)',
        borderRadius: '14px',
        overflow: 'hidden',
      }}
    >
      {/* HEADER — section label, count, progress */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          px: 2,
          py: 1.5,
          bgcolor: 'var(--bg-3)',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <Typography
          sx={{
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--ink-4)',
          }}
        >
          Address issues
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography
              data-testid="address-session-progress"
              sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-3)' }}
            >
              {fixedCount} of {captured.length} resolved
            </Typography>

            {anyRechecking && (
              <Box
                data-testid="address-session-rechecking-indicator"
                role="status"
                aria-label="Rechecking address resolution"
                sx={{
                  width: 12,
                  height: 12,
                  flexShrink: 0,
                  borderRadius: '50%',
                  border: '1.5px solid var(--ink-4)',
                  borderRightColor: 'transparent',
                  animation: 'addressSessionSpin 700ms linear infinite',
                  '@keyframes addressSessionSpin': {
                    to: { transform: 'rotate(360deg)' },
                  },
                  '@media (prefers-reduced-motion: reduce)': {
                    animation: 'none',
                  },
                }}
              />
            )}
          </Box>
          <Box
            component="button"
            type="button"
            aria-label="Close address issues"
            onClick={onClose}
            sx={{
              px: 1, py: 0.25, cursor: 'pointer',
              fontSize: 12, color: 'var(--ink-3)',
              bgcolor: 'transparent', border: 'none',
              '&:hover': { color: 'var(--ink)' },
            }}
          >
            Close
          </Box>
        </Box>
      </Box>

      {/* ROWS — fixed rows stay visible for the life of the session */}
      <Box>
        {captured.length === 0 ? (
          <Typography sx={{ fontSize: 12.5, color: 'var(--ink-3)', px: 2, py: 2 }}>
            No orders are blocked by an incomplete address.
          </Typography>
        ) : (
          captured.map((candidate) => {
            const orderId = candidate.lasyncroOrderId;
            return (
              <SessionRow
                key={orderId}
                candidate={candidate}
                state={rowStates[orderId] ?? 'OPEN'}
                isActiveRow={activeOrderId === orderId}
                onFix={() => setActiveOrderId(orderId)}
                onCollapse={() => setActiveOrderId(null)}
                /**
                 * PATCH succeeded. This is the ONLY thing a successful write
                 * earns: RECHECKING. It is never FIXED.
                 */
                onSaved={() => {
                  setRowStates((prev) => ({ ...prev, [orderId]: 'RECHECKING' }));
                  setActiveOrderId(null);
                }}
                onCanonicalClear={() =>
                  setRowStates((prev) =>
                    prev[orderId] === 'RECHECKING'
                      ? { ...prev, [orderId]: 'FIXED' }
                      : prev
                  )
                }
              />
            );
          })
        )}
      </Box>
    </Box>
  );
}

export default AddressResolutionSessionModal;
