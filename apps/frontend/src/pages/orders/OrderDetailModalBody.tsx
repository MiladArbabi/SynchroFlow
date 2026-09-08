/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/orders/OrderDetailModalBody.tsx
//
// OrderDetailModalBody
// ---------------------
// EXTRACTED (2026-07-02) from OrdersFT2Page.tsx, where it was a private,
// unexported function — OrderFlowPage.tsx needed the same "click a
// blocked order, see why + resolve it" modal body, and it couldn't be
// reused while private to another page. Moved here (apps/frontend/src/
// pages/orders/, NOT modules/shared) deliberately: this component
// orchestrates five data hooks (useOrderDecision, useExecuteOrderDecision,
// usePickExceptionsForOrder, useResolvePickException, useOrderDetail) plus
// contexts/hooks that only exist inside the apps/frontend workspace —
// modules/shared is a separate package with no access to those, confirmed
// via package.json/import audit before this move. A "presentational only"
// version in modules/shared was considered and rejected — it would mean
// re-deriving this component's business logic (pipeline status priority,
// exception filtering, similar-orders lookup) as prop-drilling from two
// separate page components, effectively a rewrite, not an extraction.
//
// Both OrdersFT2Page.tsx and OrderFlowPage.tsx now import this file
// directly (same apps/frontend workspace, same path aliases).
//
// Renders inside EntityDetailModal (@lasyncro/shared/ui) as `children`,
// and drives EntityDetailModal's `footerActions` slot via the
// onFooterReady callback prop — see that prop's own doc comment below.
import { useState, useEffect, ReactNode, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Alert,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Collapse,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { AlertCircle, AlertTriangle, ArrowRight, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useOrderDecision, useExecuteOrderDecision } from './useOrderDecision';
import { useOrderDetail } from './useOrderDetail';
import {
  getConstraintLabel,
  getConstraintSeverity,
  getSlaProximity,
  getAgeLabel,
  type ConstrainedOrder,
  type ConstrainedOrdersResponse,
} from './useConstrainedOrders';
import { usePickExceptionsForOrder, useResolvePickException } from './usePickExceptionsForOrder';
import { useOrderPackDecisions } from '../problem-center/usePackDecisions';
import { useUpdateShippingAddress } from './useShippingAddress';
import type {
  OrderShipping,
  OrderAddressAssist,
  InventoryAssistItem,
  InventoryTreatment,
} from './useOrderDetail';
import { useCurrency } from '../../hooks/useCurrency';
/**
 * GH-1053: the compact Warehouse Status visualization REUSES the existing
 * embeddable primitive. IsometricZoneView is presentational and inert (no
 * pan/zoom, no live data, no entitlement behaviour) — the full Overview
 * IsometricCanvas is deliberately NOT mounted here.
 */
import { IsometricZoneView } from '@lasyncro/shared/ui';
import type { WarehouseZone } from '@lasyncro/shared/ui';

/**
 * INV-ACTION-ARCH-01 (2026-09-06): `resolve_inventory_block: 'Go to sourcing'`
 * was removed. It labelled a generic execute(orderId) CTA as navigation while
 * actually invoking a machine handler that cannot resolve a real stockout.
 * Inventory routing is constraint-driven (inventorySourcingTargets below), and
 * `open_sourcing` is a workflow action that must never reach this map.
 */
const ACTION_LABELS: Record<string, string> = {
  resolve_operational_block: 'Mark as resolved',
  resolve_customer_block: 'Flag for customer review',
};

function getActionLabel(actionType: string): string {
  return ACTION_LABELS[actionType] ?? 'Take action';
}

// OV-103: local formatCurrency removed — it hardcoded the 'en-US' locale, so
// even calls passing order.currency rendered with US grouping and symbol
// placement. Line items use transaction currency (order.currency); aggregates
// across orders use the shop's display currency. See useCurrency's docstring.

function formatWarehouseStatus(status: string | null): string {
  if (!status) return 'In pool';
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
}

/**
 * formatTimelineEventLabel (2026-07-02)
 * ----------------------------------------
 * Raw order_fulfillment_history status codes are internal state-machine
 * vocabulary, not customer-facing language — 'pending' as a first-ever
 * timeline entry reads as "pending what?" to an SMB operator, not as
 * "order was placed." Every status shown in the Order Detail modal's
 * timeline must map to a plain-English phrase here, not just have its
 * underscores swapped for spaces (event.status.replace(/_/g, ' ')).
 *
 * 'pending' specifically means "order synced from Shopify, no
 * fulfillment action taken yet" — i.e. the very first lifecycle event —
 * so it's labeled as such, not left as raw status jargon.
 *
 * Add new cases here whenever a new status value is introduced anywhere
 * upstream (order_fulfillment_history, orders.paid_at synthetic event,
 * order_warehouse_status synthetic event — see VO-02, GH-1034). Falls
 * back to the raw underscore-replaced string only for genuinely unknown
 * future statuses, so nothing silently renders blank.
 */
function formatTimelineEventLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Order placed',
    processing: 'Processing',
    partially_fulfilled: 'Partially fulfilled',
    fulfilled: 'Fulfilled',
    cancelled: 'Cancelled',
    failed: 'Fulfillment failed',
    payment_captured: 'Payment captured',
    in_release_pool: 'Released to pick batch',
    address_corrected: 'Shipping address corrected',
  };
  return labels[status] ?? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
}

/**
 * useCachedConstrainedRow
 * ------------------------
 * The Fulfillment Queue row (useConstrainedOrders) is already fetched and
 * polling every 10s — reading it from the query cache costs nothing and
 * gives the modal urgency context (SLA/$/margin) without a second
 * round-trip. See entity-detail-modal-playbook.md §2.8.
 */
function useCachedConstrainedRow(orderId: string): ConstrainedOrder | undefined {
  const queryClient = useQueryClient();
  const caches = queryClient.getQueriesData<ConstrainedOrdersResponse>({ queryKey: ['orders', 'constrained'] });
  for (const [, data] of caches) {
    const row = data?.data?.find((o) => o.order_id === orderId);
    if (row) return row;
  }
  return undefined;
}

/**
 * buildUrgencySubtitle
 * ---------------------
 * Feeds EntityDetailModal's `subtitle` prop. Surfaces the exact numbers
 * that justified opening this order (revenue at stake, SLA breach age,
 * margin) so the operator never has to go back to the list to re-derive
 * why this order mattered.
 */
// OV-103: format is injected rather than imported — this is a plain function,
// not a component, so it cannot call useCurrency itself. The caller (line 526)
// is inside the component and supplies it. row.revenue aggregates across
// orders, so this is display currency, not the order's own.
function buildUrgencySubtitle(
  row: ConstrainedOrder | undefined,
  format: (n: number | null | undefined, opts?: { currency?: string }) => string,
): string | undefined {
  if (!row) return undefined;
  const parts: string[] = [];
  if (row.revenue != null) parts.push(`${format(row.revenue)} at stake`);
  const proximity = getSlaProximity(row);
  if (proximity === 'breached') parts.push(`SLA breached · ${getAgeLabel(row)} past`);
  else if (proximity === 'warning') parts.push(`Approaching SLA · ${getAgeLabel(row)} old`);
  /**
   * OF-09 (2026-07-02): margin_pct is typed number|null but is actually
   * a string at runtime — oms.margin_pct is a Postgres DECIMAL column,
   * and knex/pg return DECIMAL as string by default, not number. Same
   * class of bug already documented elsewhere today (see
   * decision-engine-playbook.md's inventory_blocked_revenue
   * decimal-as-string note). Coerce here rather than trust the type;
   * fixing knex's serialization globally is out of scope for this fix.
   */
  if (row.margin_pct != null) parts.push(`${Number(row.margin_pct).toFixed(1)}% margin`);
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * ConstraintAlertCard
 * --------------------
 * Stacked, independently-colored alert per active constraint — replaces
 * the original flat text list. Reuses the icon+color+label severity
 * pattern from TopnavbarContent.tsx's BellAlertRow (AlertsModule.md D5:
 * never colour alone).
 */
function ConstraintAlertCard({
  constraintType,
  blockType,
  detail,
}: {
  constraintType: string;
  blockType: string | null;
  detail?: string;
}) {
  const theme = useTheme();
  const severity = getConstraintSeverity(constraintType);
  const color = severity === 'critical' ? theme.palette.error.main : theme.palette.warning.main;
  const bg = severity === 'critical' ? 'rgba(226,75,74,0.08)' : 'rgba(239,159,39,0.08)';
  const Icon = severity === 'critical' ? AlertCircle : AlertTriangle;
  const isReturnedUndelivered =
    constraintType === 'operational' && blockType === 'returned_undelivered';
  const title = isReturnedUndelivered
    ? 'Package returned'
    : getConstraintLabel(constraintType);
  const body = isReturnedUndelivered
    ? 'The carrier returned this package before delivery.'
    : detail ?? blockType?.replace(/_/g, ' ');

  return (
    <Box sx={{ display: 'flex', gap: 1.25, bgcolor: bg, borderRadius: '10px', p: 1.25 }}>
      <Icon size={16} color={color} style={{ flexShrink: 0, marginTop: 1 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 500, color }}>
          {title}
        </Typography>
        {body && (
          <Typography sx={{ fontSize: 11.5, color, mt: 0.5 }}>
            {body}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

/**
 * INV-TREAT-01 — compact evidence/recommendation copy for the GH-1053 modal.
 * These helpers are presentation-only. constraints[] remains blocker truth,
 * and treatment actions remain navigation-only.
 */
function treatmentLabel(treatment: InventoryTreatment): string {
  switch (treatment.type) {
    case 'wait_for_inbound':
      return 'Review incoming stock';
    case 'continue_purchasing':
      return 'Continue purchasing';
    case 'source_remaining':
      return `Source ${treatment.quantity ?? 0} units`;
    case 'find_supplier':
      return 'Find a supplier';
    case 'investigate_inventory':
    default:
      return 'Recheck inventory';
  }
}

function treatmentContext(
  item: InventoryAssistItem,
  treatment: InventoryTreatment
): string {
  const {
    committedInboundQty,
    pendingQueueQty,
    draftPoQty,
    supplierOptionCount,
  } = item.purchasingEvidence;

  switch (treatment.type) {
    case 'wait_for_inbound':
      return `${committedInboundQty} committed inbound`;
    case 'continue_purchasing':
      return `${pendingQueueQty} queued · ${draftPoQty} in draft`;
    case 'source_remaining':
      return `${supplierOptionCount} supplier ${supplierOptionCount === 1 ? 'option' : 'options'}`;
    case 'find_supplier':
      return 'No supplier set up yet';
    case 'investigate_inventory':
    default:
      return 'Current stock no longer matches this blocker.';
  }
}

// §ISS-OD-02: PackDecisionHistory merged from OrderDetailPage (removed 2026-07-11)
// Shows pack decision requests (pending/approved/rejected) per order.
// Returns null when no requests exist — no empty state needed here.
function PackDecisionHistory({ lasyncroOrderId }: { lasyncroOrderId: string }) {
  const { data, isLoading } = useOrderPackDecisions(lasyncroOrderId);
  const theme = useTheme();
  const requests = data?.requests ?? [];
  if (isLoading || requests.length === 0) return null;
  const statusConfig = {
    pending:  { icon: Clock,        color: theme.palette.warning.main, label: 'Pending' },
    approved: { icon: CheckCircle2, color: theme.palette.success.main, label: 'Approved' },
    rejected: { icon: XCircle,      color: theme.palette.error.main,   label: 'Rejected' },
  };
  return (
    <Box sx={{ mb: 3 }}>
      <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
        Pack decisions
      </Typography>
      <Box sx={{ bgcolor: 'var(--bg)', border: '1px solid var(--rule)', borderRadius: '10px', overflow: 'hidden' }}>
        {requests.map((req, idx) => {
          const cfg = statusConfig[req.status] ?? statusConfig.pending;
          const Icon = cfg.icon;
          const itemLabel = req.variant_title ?? req.sku ?? req.lasyncro_line_item_id.slice(0, 8).toUpperCase();
          const exLabel = req.exception_type.replace(/_/g, ' ');
          const batchShort = req.pick_batch_id.slice(0, 8).toUpperCase();
          return (
            <Box key={req.id} sx={{ px: 2, py: 1.5, borderTop: idx > 0 ? '1px solid var(--rule)' : 'none', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Icon size={13} color={cfg.color} />
                <Typography sx={{ fontSize: 12, fontWeight: 500, color: cfg.color }}>{cfg.label}</Typography>
                <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', ml: 'auto' }}>Batch {batchShort}</Typography>
              </Box>
              <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>{exLabel} — {itemLabel}</Typography>
              {req.status !== 'pending' && (
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {req.partial_shipment !== null && req.status === 'approved' && (
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, px: 1, py: 0.25, borderRadius: '4px', fontSize: 11,
                      bgcolor: req.partial_shipment ? `${theme.palette.warning.main}1A` : `${theme.palette.success.main}1A`,
                      color: req.partial_shipment ? theme.palette.warning.main : theme.palette.success.main }}>
                      <AlertTriangle size={10} />
                      {req.partial_shipment ? 'Shipped partial' : 'Full shipment'}
                    </Box>
                  )}
                  {req.note && <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }}>"{req.note}"</Typography>}
                </Box>
              )}
              <Typography sx={{ fontSize: 10, color: 'var(--ink-4)' }}>
                Raised {new Date(req.raised_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                {req.resolved_at && ` · Resolved ${new Date(req.resolved_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}`}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/**
 * ShippingAddressDialog
 * ---------------------
 * BL-16-UX-01: customer/incomplete_address resolution stays on the existing
 * shipping-address mutation, but moves into a focused child dialog so the
 * Order Detail surface remains concise and the parent modal stays open.
 */
function ShippingAddressDialog({
  open,
  onClose,
  onSaved,
  orderId,
  currentShipping,
  addressAssist,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  orderId: string;
  currentShipping: OrderShipping | undefined;
  addressAssist: OrderAddressAssist | null | undefined;
}) {
  const [name, setName] = useState(currentShipping?.name ?? '');
  const [address1, setAddress1] = useState(currentShipping?.address1 ?? '');
  const [address2, setAddress2] = useState(currentShipping?.address2 ?? '');
  const [city, setCity] = useState(currentShipping?.city ?? '');
  const [zip, setZip] = useState(currentShipping?.zip ?? '');
  const [province, setProvince] = useState(currentShipping?.province ?? '');
  const [countryCode, setCountryCode] = useState(currentShipping?.countryCode ?? '');
  const [phone, setPhone] = useState(currentShipping?.phone ?? '');

  /**
   * CORRECTION PROVENANCE (OUTCOME-ATTR-01)
   * ---------------------------------------
   * EXPLICIT state: true only after the operator actually clicked "Use this
   * address". Provenance is never inferred by comparing typed values against
   * the candidate — an operator who happens to type the same address did not
   * use the assist, and recording that they did would be a fabricated fact.
   *
   * Any subsequent edit to a field the candidate filled drops back to manual:
   * what gets saved is no longer the historical address, so it must not be
   * attributed to the assist.
   *
   * Applying a candidate still writes NOTHING. Save remains the sole write.
   */
  const [assistApplied, setAssistApplied] = useState(false);

  // Dialog lifecycle reset — provenance must never leak across openings.
  useEffect(() => {
    if (!open) setAssistApplied(false);
  }, [open]);

  const updateAddress = useUpdateShippingAddress();

  const canSave = Boolean(
    address1.trim() &&
    city.trim() &&
    zip.trim() &&
    countryCode.trim()
  );

  const handleClose = () => {
    if (!updateAddress.isPending) {
      onClose();
    }
  };

  const handleSave = () => {
    updateAddress.mutate(
      {
        orderId,
        name: name.trim() || undefined,
        address1: address1.trim(),
        address2: address2.trim() || undefined,
        city: city.trim(),
        zip: zip.trim(),
        province: province.trim() || undefined,
        countryCode: countryCode.trim(),
        phone: phone.trim() || undefined,
        correctionSource: assistApplied ? 'historical_address_assist' : 'manual',
      },
      {
      // BL-16-UX-02: PATCH success confirms the address write, not constraint resolution.
      onSuccess: onSaved,
      }
    );
  };

  const fieldSx = { mb: 1.25 };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="shipping-address-dialog-title"
      PaperProps={{
        sx: {
          bgcolor: 'var(--surface)',
          border: '1px solid var(--rule)',
          borderRadius: '14px',
          backgroundImage: 'none',
        },
      }}
    >
      <DialogTitle
        id="shipping-address-dialog-title"
        sx={{
          px: 3,
          py: 2,
          fontSize: 16,
          fontWeight: 500,
          color: 'var(--ink)',
          bgcolor: 'var(--bg-3)',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        Correct shipping address
      </DialogTitle>

      <DialogContent sx={{ p: '24px !important', bgcolor: 'var(--surface)' }}>
        <Typography
          sx={{
            fontSize: 12.5,
            fontWeight: 300,
            color: 'var(--ink-3)',
            mb: 2,
          }}
        >
          Complete the required shipping fields so this order can be re-checked automatically.
        </Typography>

        {addressAssist && (
          <Box sx={{ mb: 2, p: 2, bgcolor: 'var(--bg-3)', border: '1px solid var(--rule)', borderRadius: '6px' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', mb: 0.75 }}>
              Previously used address
            </Typography>
            <Typography sx={{ fontSize: 12.5, color: 'var(--ink-3)', whiteSpace: 'pre-line' }}>
              {[
                addressAssist.candidate.address1,
                addressAssist.candidate.address2,
                `${addressAssist.candidate.city} ${addressAssist.candidate.zip}`,
                addressAssist.candidate.province,
                addressAssist.candidate.countryCode,
              ].filter(Boolean).join('\n')}
            </Typography>
            <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mt: 1 }}>
              Used on {addressAssist.usageCount} fulfilled {addressAssist.usageCount === 1 ? 'order' : 'orders'} · Last used{' '}
              {new Date(addressAssist.lastUsedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              disabled={updateAddress.isPending}
              sx={{
                mt: 1,
                px: 1.25,
                py: 0.5,
                minWidth: 0,
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'none',
                color: 'var(--accent)',
                bgcolor: 'transparent',
                border: '0.5px solid var(--accent)',
                borderRadius: '6px',
                '&:hover': {
                  bgcolor: 'transparent',
                  border: '0.5px solid var(--accent)',
                  opacity: 0.75,
                },
              }}
              onClick={() => {
                const { candidate } = addressAssist;
                setAssistApplied(true);
                setAddress1(candidate.address1);
                setAddress2(candidate.address2 ?? '');
                setCity(candidate.city);
                setZip(candidate.zip);
                setProvince(candidate.province ?? '');
                setCountryCode(candidate.countryCode);
              }}
            >
              Use this address
            </Button>
          </Box>
        )}

        {updateAddress.isError && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {updateAddress.error?.message ?? 'Could not save the address. Please try again.'}
          </Alert>
        )}

        <TextField
          size="small"
          fullWidth
          label="Recipient name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={fieldSx}
        />

        <TextField
          size="small"
          fullWidth
          required
          label="Address line 1"
          value={address1}
          onChange={(e) => { setAssistApplied(false); setAddress1(e.target.value); }}
          sx={fieldSx}
        />

        <TextField
          size="small"
          fullWidth
          label="Address line 2 (optional)"
          value={address2}
          onChange={(e) => { setAssistApplied(false); setAddress2(e.target.value); }}
          sx={fieldSx}
        />

        <Box sx={{ display: 'flex', gap: 1.25, mb: 1.25 }}>
          <TextField
            size="small"
            fullWidth
            required
            label="City"
            value={city}
            onChange={(e) => { setAssistApplied(false); setCity(e.target.value); }}
          />
          <TextField
            size="small"
            fullWidth
            label="State / Province"
            value={province}
            onChange={(e) => { setAssistApplied(false); setProvince(e.target.value); }}
          />
        </Box>

        <Box sx={{ display: 'flex', gap: 1.25, mb: 1.25 }}>
          <TextField
            size="small"
            fullWidth
            required
            label="ZIP / Postal code"
            value={zip}
            onChange={(e) => { setAssistApplied(false); setZip(e.target.value); }}
          />
          <TextField
            size="small"
            fullWidth
            required
            label="Country code"
            placeholder="US"
            value={countryCode}
            onChange={(e) => { setAssistApplied(false); setCountryCode(e.target.value.toUpperCase()); }}
          />
        </Box>

        <TextField
          size="small"
          fullWidth
          label="Phone (optional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </DialogContent>

      <DialogActions
        sx={{
          px: 3,
          py: 2,
          gap: 1,
          bgcolor: 'var(--bg-3)',
          borderTop: '1px solid var(--rule)',
        }}
      >
        <Button
          onClick={handleClose}
          disabled={updateAddress.isPending}
          sx={{
            color: 'var(--ink-3)',
            textTransform: 'none',
            borderRadius: '6px',
          }}
        >
          Cancel
        </Button>

        <Button
          variant="contained"
          disabled={!canSave || updateAddress.isPending}
          onClick={handleSave}
          sx={{
            bgcolor: 'var(--accent)',
            color: 'var(--accent-ink)',
            borderRadius: '6px',
            fontWeight: 600,
            textTransform: 'none',
            '&:hover': {
              bgcolor: 'var(--accent)',
              opacity: 0.88,
            },
          }}
        >
          {updateAddress.isPending ? 'Saving…' : 'Save address'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * WAREHOUSE STATUS — CANONICAL STAGE, NOT A PHYSICAL LOCATION (GH-1053)
 * ----------------------------------------------------------------------
 * Truth is order.warehouseStatus (order_warehouse_status_type). That column
 * says which STAGE of the pick/pack/ship pipeline an order has reached — it
 * does NOT say where any unit physically is, and no per-order live position
 * signal exists behind this surface. So this panel states the stage and
 * nothing more: the words "current location" and "live location" must never
 * appear here, and the isometric box is a stage representation, never the
 * merchant's actual zone.
 *
 * `zoneType: null` renders stage text without a box (unblocked order pool,
 * cancelled, or fulfilled outside LaSyncro). Blocked orders in the pool use
 * the synthetic `order_pool` type for a presentational box, not a location.
 *
 * `inZone: false` renders the box inactive/muted rather than as an occupied
 * zone: unreleased blocked orders, shipped, or partially_shipped.
 */
type WarehouseStageView = {
  status: string;
  context: string;
  zoneType: string | null;
  inZone: boolean;
};

const WAREHOUSE_STAGE_VIEWS: Record<string, WarehouseStageView> = {
  awaiting_pick:     { status: 'Awaiting pick',     context: 'Released, waiting on a picker', zoneType: 'storage', inZone: true },
  picking:           { status: 'Picking',           context: 'Pick stage',                    zoneType: 'pick',    inZone: true },
  picked:            { status: 'Picked',            context: 'Pick stage complete',           zoneType: 'pick',    inZone: true },
  packing:           { status: 'Packing',           context: 'Pack stage',                    zoneType: 'pack',    inZone: true },
  packed:            { status: 'Packed',            context: 'Outbound stage',                zoneType: 'ship',    inZone: true },
  shipped:           { status: 'Shipped',           context: 'Left the warehouse',            zoneType: 'ship',    inZone: false },
  partially_shipped: { status: 'Partially shipped', context: 'Outbound stage — units remain', zoneType: 'ship',    inZone: false },
  cancelled:         { status: 'Cancelled',         context: 'No longer in the pipeline',     zoneType: null,      inZone: false },
};

function resolveWarehouseStageView(
  warehouseStatus: string | null,
  hasAnyActiveConstraint: boolean,
  isFulfilled: boolean,
): WarehouseStageView {
  if (warehouseStatus) {
    return (
      WAREHOUSE_STAGE_VIEWS[warehouseStatus] ?? {
        // Unknown future status: say the stage, claim nothing about it.
        // Same tolerance formatWarehouseStatus already had.
        status: formatWarehouseStatus(warehouseStatus),
        context: 'Warehouse stage',
        zoneType: null,
        inZone: false,
      }
    );
  }
  // Null stage is a real state, not missing data.
  if (hasAnyActiveConstraint) {
    return { status: 'Blocked', context: 'Order pool', zoneType: 'order_pool', inZone: false };
  }
  if (isFulfilled) {
    // ISS-07b: fulfilled outside LaSyncro's own pipeline — never described as
    // sitting in a warehouse zone.
    return { status: 'Fulfilled', context: 'Fulfilled outside the warehouse pipeline', zoneType: null, inZone: false };
  }
  return { status: 'In pool', context: 'Not yet released to a pick batch', zoneType: null, inZone: false };
}

/**
 * Synthetic presentation geometry for the stage box. This is NOT a
 * warehouse_locations row and must never be mistaken for one — hence the
 * empty location_code: IsometricZoneView paints location_code as the box
 * label, and any code we invented there would read as one of the merchant's
 * real zones. The shared WarehouseZone type is used as-is, not weakened.
 */
function buildStageZone(view: WarehouseStageView): WarehouseZone {
  return {
    location_code: '',
    type: 'bin',
    parent_location_code: null,
    barcode: null,
    active: view.inZone,
    children_count: 0,
    position_x: 0,
    position_y: 0,
    width: 1.6,
    depth: 1.1,
    orientation: 0,
    rack_levels: 2,
    zone_type: view.zoneType,
    last_printed_at: null,
    warehouse_name: null,
  };
}

function WarehouseStatusPanel({
  view,
  tone,
}: {
  view: WarehouseStageView;
  tone: 'danger' | 'success' | 'accent' | 'neutral';
}) {
  const statusColor =
    tone === 'danger' ? '#A32D2D' : tone === 'success' ? 'var(--confirm-ink)' : tone === 'accent' ? 'var(--accent)' : 'var(--ink-2)';

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        p: 1.25,
        bgcolor: 'var(--bg-2)',
        border: '1px solid var(--rule)',
        borderRadius: '10px',
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.5 }}>
          Warehouse status
        </Typography>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: statusColor }}>{view.status}</Typography>
        <Typography sx={{ fontSize: 11.5, color: 'var(--ink-4)', mt: 0.25 }}>{view.context}</Typography>
      </Box>

      {view.zoneType && (
        // Decorative reinforcement only — the stage is fully carried by the
        // text above (WCAG 1.4.1).
        <Box aria-hidden sx={{ flexShrink: 0, opacity: view.inZone ? 1 : 0.55 }}>
          <IsometricZoneView zone={buildStageZone(view)} width={156} height={106} />
        </Box>
      )}
    </Box>
  );
}

export function OrderDetailModalBody({
  orderId,
  onTitleReady,
  onSubtitleReady,
  onNavigateToOrder,
  onFooterReady,
  onPriorityFlag,
  onClose,
}: {
  orderId: string;
  onTitleReady: (title: string) => void;
  onSubtitleReady: (subtitle: string | undefined) => void;
  onNavigateToOrder: (orderId: string) => void;
  /**
   * FOOTER LIFT (2026-07-02)
   * ------------------------
   * Unlike onTitleReady/onSubtitleReady (fire-once-per-order, simple
   * useEffect), the footer's content depends on several pieces of
   * mid-render local state (constraint status, isPrioritizing,
   * prioritized) — so it's computed via useMemo, not set once, and
   * re-fires onFooterReady whenever that memoized value changes.
   */
  onFooterReady: (footer: ReactNode) => void;
  /**
   * ORDM-04b (2026-07-01): same mutation as ORDM-02's list-row
   * "Prioritize" action (see OrdersModuleFT2.tsx handlePrioritizeOrder).
   * Reused here rather than re-implementing — one source of truth for
   * what "prioritize" does (bulk-set-priority endpoint, order surfaces
   * at top of pool with a Priority badge).
   */
  onPriorityFlag?: (orderIds: string[], flagged: boolean) => Promise<void>;
  /** OV-22: called before navigate so the Dialog unmounts before the new route mounts. */
  onClose?: () => void;
}) {
  const { data, isLoading, isError, error } = useOrderDecision(orderId);
  const navigate = useNavigate();
  const { format } = useCurrency();
  // FIX (2026-07-01): 404 is now an expected, good response from
  // httpGetOrderDecision after the status-filter fix — it means "no
  // active decision for this order" (fully resolved, or calmly sitting
  // in the pool), not a failure. Confirmed the interceptor in
  // axiosConfig.ts passes 404s through untouched (only 401s are
  // special-cased for token refresh), so error.response.status is safe
  // to read directly here. Only a genuine non-404 error should
  // short-circuit the modal into a warning state.
  const is404 = (error as { response?: { status?: number } })?.response?.status === 404;
  const isRealError = isError && !is404;

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
  const cachedRow = useCachedConstrainedRow(orderId);
  /**
   * ORDM-04b (2026-07-01): local pending/success state for the modal's
   * "Prioritize" action — deliberately NOT reusing OrdersModuleFT2's
   * holdPriorityMovement/flashPriorityRow (that's row-hold/flash
   * animation logic coupled to the list view, not applicable inside a
   * single-order modal). Same underlying mutation, simpler local UI.
   */
  const [isPrioritizing, setIsPrioritizing] = useState(false);
  const [prioritized, setPrioritized] = useState(false);

  /**
   * GH-1053: the cross-order "similar orders" derivation that used to live
   * here was removed with the surface it fed. cachedRow stays — it still
   * supplies the urgency subtitle (buildUrgencySubtitle above).
   */

  // data is undefined on 404 — every read below already tolerates that
  // via ?? [] / ?. fallbacks, no additional guarding needed.
  const decision = data?.decision;
  const constraints = data?.constraints ?? [];
  // ORD-CTA-01B: proceed_fulfillment performs a real Shopify fulfillment.
  // Order Detail must never expose that shortcut; fulfillment remains owned
  // by the release → pick → pack → ship workflow.
  const recommendedAction =
    decision?.recommended_action?.type === 'proceed_fulfillment'
      ? undefined
      : decision?.recommended_action;
  /**
   * INV-ACTION-ARCH-01: `open_sourcing` is workflow navigation with no
   * execution handler — the backend refuses to enqueue it. It must therefore
   * never reach the generic execute(orderId) CTA, even when no usable
   * inventory sourcing target exists (constraint with a null target_id).
   * Inventory routing comes from active constraints, never from this action.
   */
  const executableRecommendedAction =
    recommendedAction?.type === 'open_return_job' ||
    recommendedAction?.type === 'open_sourcing'
      ? undefined
      : recommendedAction;

  const alternateActions = (decision?.actions ?? []).filter(
    (a) =>
      a.type !== 'proceed_fulfillment' &&
      a.type !== recommendedAction?.type
  );
  const exceptions = exceptionsQuery.data?.exceptions ?? [];
  const unresolvedExceptions = exceptions.filter((e) => !e.resolved);
  const order = detailQuery.data;

  /**
   * GH-1057: hydrate the modal's local optimistic priority state from
   * canonical persisted truth. Local state is still retained so the existing
   * prioritize mutation can flip the button immediately after success.
   *
   * orderId is included deliberately: switching directly between two orders
   * must never carry the previous modal's local priority state forward.
   */
  const persistedPriority =
    order?.fulfillment?.is_priority_flagged ?? false;

  useEffect(() => {
    setPrioritized(persistedPriority);
  }, [orderId, persistedPriority]);

  // INV-TREAT-01: fresh, read-only evidence/recommendations from Order Detail.
  // constraints[] remains canonical blocker truth; assist only enriches it.
  const inventoryAssistItems = order?.inventoryAssist?.items;

  const hasActiveInventoryConstraint = constraints.some((c) => c.constraint_type === 'inventory');
  /**
   * INVENTORY SOURCING TARGETS (ORD-DECISION-01)
   * --------------------------------------------
   * Derived from ACTIVE CONSTRAINTS, never from the elected decision
   * payload. Two reasons, both observed:
   *
   * 1. TRUTHFULNESS. An active oversell is not something the merchant can
   *    "resolve" by pressing a button — the units do not exist. The old
   *    CTA ran execute(orderId), which reached resolve_inventory_block and
   *    either silently did nothing or emitted a reorder alert, while the
   *    label promised "Go to sourcing" and no navigation occurred.
   * 2. EXACTNESS. One order can block on several variants. The decision
   *    row carries a single ranked recommendation, so routing from it
   *    would send the merchant to an arbitrary first variant. Each active
   *    inventory constraint carries its own target_id, so each blocked
   *    variant stays independently actionable.
   *
   * Constraints without a usable target_id are skipped rather than routed
   * to a broken Sourcing URL.
   */
  const inventorySourcingTargets = constraints
    .filter(
      (c) =>
        c.constraint_type === 'inventory' &&
        typeof c.target_id === 'string' &&
        c.target_id.length > 0
    )
    .map((c) => c.target_id as string);
  const hasInventorySourcingAction = inventorySourcingTargets.length > 0;
  // BL-16: constraints are canonical blocker truth; decision enrichment may be absent.
  const hasActiveCustomerConstraint = constraints.some(
    (c) => c.constraint_type === 'customer' && c.block_type === 'incomplete_address'
  );
  const returnedPackageConstraint = constraints.find(
    (c) => c.constraint_type === 'operational' && c.block_type === 'returned_undelivered'
  );
  const returnJobId =
    typeof returnedPackageConstraint?.target_id === 'string'
      ? returnedPackageConstraint.target_id
      : null;
  const returnJobStatus = returnedPackageConstraint?.target_status ?? null;
  const returnJobActionLabel =
    returnJobId && (returnJobStatus === 'pending' || returnJobStatus === 'in_progress')
      ? 'Process return'
      : returnJobId && returnJobStatus === 'awaiting_decision'
        ? 'Review return'
        : null;
  // RET-CTA-DECOUPLE: the returned-package CTA is gated on the active
  // returned_undelivered constraint and an actionable target_status
  // (returnJobActionLabel already encodes valid target_id + pending/
  // in_progress/awaiting_decision). It must NOT also require the elected
  // decision to be open_return_job — a co-active inventory/SLA blocker
  // whose decision outranks open_return_job would otherwise silently hide
  // the only route into the return job. Customer-constraint suppression
  // and the elected-decision behaviour elsewhere in the modal are unchanged.
  const hasReturnedPackageAction = Boolean(returnJobActionLabel);
  const hasAnyActiveConstraint = constraints.length > 0;

  // BL-16-UX-01: keep address correction focused without replacing the parent order modal.
  const [shippingAddressDialogOpen, setShippingAddressDialogOpen] = useState(false);

  // BL-16-UX-02: address persistence is immediate; blocker resolution remains server-confirmed.
  const [addressRecheckPending, setAddressRecheckPending] = useState(false);

  useEffect(() => {
    if (addressRecheckPending && !hasActiveCustomerConstraint) {
      setAddressRecheckPending(false);
    }
  }, [addressRecheckPending, hasActiveCustomerConstraint]);

  useEffect(() => {
    setShippingAddressDialogOpen(false);
    setAddressRecheckPending(false);
  }, [orderId]);

  const showInventoryResolvedBanner = !hasActiveInventoryConstraint && isSuccess;

  /**
   * REMEDIATION LIVES IN THE FOOTER (GH-1053)
   * ------------------------------------------
   * Blocker remediation used to render inside this component's scrollable
   * body, so the one action the operator opened the modal for could scroll
   * out of sight. It now reaches EntityDetailModal's `footerActions` slot
   * through the existing onFooterReady path — the SAME path the healthy-pool
   * footer already used. Nothing about what each action DOES changed:
   * customer still opens ShippingAddressDialog (still mounted by this
   * component), inventory still routes per constraint target_id and never
   * executes, returned packages still route to their exact job, and the
   * generic path still runs execute(orderId) with its own error/loading and
   * alternate actions.
   *
   * MUST stay referentially stable between renders — onFooterReady is fired
   * from an effect and the parent stores the node in state, so a fresh node
   * every render would loop. Hence useMemo with the primitives the content
   * actually reads (the two navigation handlers are inlined here for the same
   * reason: as plain per-render closures they would defeat the memo).
   */
  const remediationFooter = useMemo(() => {
    if (showInventoryResolvedBanner) return null;

    const hasRemediation =
      hasActiveCustomerConstraint ||
      hasReturnedPackageAction ||
      hasInventorySourcingAction ||
      Boolean(executableRecommendedAction);

    if (!hasRemediation) return null;

    const openSourcing = (variantId: string) => {
      onClose?.();
      /**
       * SRC-L3-11A (SOURCING-UX-COGNITIVE-01 Slice 1A): carry the originating
       * order as CONTEXT so Sourcing can say which order sent the merchant
       * there. `orderId` is the canonical orders.lasyncro_order_id — the same
       * key the decision and constrained read models use. Deliberately
       * nothing else: shortage, value, inbound and constraint id are all
       * mutable facts the server re-derives, and a display number or Shopify
       * id could not be matched against canonical order state anyway.
       */
      navigate(
        `/suppliers-portal/sourcing?variantId=${encodeURIComponent(variantId)}` +
          `&orderId=${encodeURIComponent(orderId)}`
      );
    };

    const openReturnJob = () => {
      if (!returnJobId) return;
      onClose?.();
      if (returnJobStatus === 'awaiting_decision') {
        navigate(`/returns/items?returnJobId=${encodeURIComponent(returnJobId)}`);
        return;
      }
      navigate(`/wms?returnJobId=${encodeURIComponent(returnJobId)}`);
    };

    const primaryButtonSx = {
      bgcolor: 'var(--accent)',
      color: 'var(--accent-ink)',
      borderRadius: '6px',
      fontWeight: 600,
      textTransform: 'none',
      minWidth: 168,
      '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
    } as const;

    /**
     * OF-08 (2026-07-02): customer/incomplete_address blocks get a real
     * in-app resolution form instead of the generic execute button —
     * resolve_customer_block's own handler is a documented manual no-op
     * (resolve_customer_block.handler.ts), so that button never did
     * anything. Precedence below is unchanged from the body version:
     * customer > returned package > inventory sourcing > generic execute.
     */
    const actions = hasActiveCustomerConstraint ? (
      addressRecheckPending ? (
        // BL-16-UX-02: address persistence is immediate; blocker resolution
        // stays server-confirmed. The footer shows the recheck state rather
        // than a duplicate actionable button.
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            p: 1.25,
            bgcolor: 'var(--confirm-ghost)',
            border: '1px solid var(--confirm-border)',
            borderRadius: '10px',
          }}
        >
          <CircularProgress size={14} thickness={5} sx={{ color: 'var(--confirm-ink)', flexShrink: 0 }} />
          <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'var(--confirm-ink)' }}>
            Address updated — rechecking order…
          </Typography>
        </Box>
      ) : (
        <Button variant="contained" onClick={() => setShippingAddressDialogOpen(true)} sx={primaryButtonSx}>
          Correct shipping address
        </Button>
      )
    ) : hasReturnedPackageAction ? (
      <Button variant="contained" onClick={openReturnJob} sx={primaryButtonSx}>
        {returnJobActionLabel}
      </Button>
            ) : hasInventorySourcingAction ? (
      /*
       * INV-TREAT-01 + GH-1053:
       * ACTIVE constraint target_ids own inventory action truth.
       * inventoryAssist may enrich each target, but can never create one.
       * Missing/stale assist data falls back per variant to Source this item.
       */
      <>
        {inventorySourcingTargets.map((variantId) => {
          const item = inventoryAssistItems?.find(
            (candidate) => candidate.variantId === variantId
          );
          const treatment = item?.treatments[0];

          if (!item || !treatment) {
            return (
              <Button
                key={variantId}
                variant="contained"
                startIcon={<ArrowRight size={16} />}
                onClick={() => openSourcing(variantId)}
                sx={primaryButtonSx}
              >
                Source this item
              </Button>
            );
          }

          const action = treatment.action;
          const itemLabel =
            [
              item.identity.variantTitle ?? item.identity.productTitle,
              item.identity.sku,
            ]
              .filter(Boolean)
              .join(' · ') || 'Inventory item';

          return (
            <Box
              key={variantId}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                flexWrap: 'wrap',
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  sx={{
                    fontSize: 11.5,
                    fontWeight: 500,
                    color: 'var(--ink-2)',
                  }}
                >
                  {itemLabel}
                </Typography>

                <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
                  {treatmentContext(item, treatment)}
                </Typography>
              </Box>

              {action ? (
                <Button
                  variant="contained"
                  startIcon={<ArrowRight size={16} />}
                  onClick={() => openSourcing(variantId)}
                  sx={primaryButtonSx}
                >
                  {treatmentLabel(treatment)}
                </Button>
              ) : (
                <Typography
                  sx={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--ink-2)',
                  }}
                >
                  {treatmentLabel(treatment)}
                </Typography>
              )}
            </Box>
          );
        })}
      </>
) : executableRecommendedAction ? (
      isExecError ? (
        <Button variant="contained" onClick={() => execute(orderId)} sx={primaryButtonSx}>
          {getActionLabel(executableRecommendedAction.type)}
        </Button>
      ) : (
        <Button
          variant="contained"
          disabled={isPending}
          onClick={() => execute(orderId)}
          startIcon={isPending ? <CircularProgress size={16} color="inherit" /> : null}
          sx={primaryButtonSx}
        >
          {isPending ? 'Processing…' : getActionLabel(executableRecommendedAction.type)}
        </Button>
      )
    ) : null;

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, width: '100%' }}>
        {executableRecommendedAction && isExecError && (
          <Alert severity="error" sx={{ py: 0 }}>
            {execError?.message ?? 'Execution failed. Please try again.'}
          </Alert>
        )}

        <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          Recommended action
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {actions}

          {executableRecommendedAction && alternateActions.length > 0 && (
            <>
              <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>Other options</Typography>
              {alternateActions.map((a) => (
                <Button
                  key={a.type}
                  variant="outlined"
                  size="small"
                  disabled={isPending}
                  onClick={() => execute(orderId)}
                  sx={{ fontSize: 12.5, color: 'var(--ink-2)', borderColor: 'var(--rule)', textTransform: 'none' }}
                >
                  {getActionLabel(a.type)}
                </Button>
              ))}
            </>
          )}
        </Box>
      </Box>
    );
  }, [
    showInventoryResolvedBanner,
    hasActiveCustomerConstraint,
    addressRecheckPending,
    hasReturnedPackageAction,
    returnJobActionLabel,
    returnJobId,
    returnJobStatus,
    inventoryAssistItems,
    hasInventorySourcingAction,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    inventorySourcingTargets.join(','),
    executableRecommendedAction,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    alternateActions.map((a) => a.type).join(','),
    isExecError,
    execError,
    isPending,
    execute,
    orderId,
    onClose,
    navigate,
  ]);

  /**
   * FOOTER LIFT (2026-07-02, extended by GH-1053)
   * ---------------------------------------------
   * Computed here (not inline in JSX) because it must reach
   * EntityDetailModal's footerActions slot via onFooterReady, not render
   * inside this component's own body. Remediation now takes the slot
   * whenever a blocker offers a real action; the constraint-free/unbatched
   * Prioritize + Go to order flow footer is unchanged below it.
   */
  const slaTreatment = order?.slaTreatment;
  const slaNavigation = slaTreatment?.assistance?.kind === 'navigate' ? slaTreatment.assistance : null;
  const slaActionHref = slaNavigation?.href;
  const slaActionLabel = slaNavigation?.label;
  const slaHasBlocker = (slaTreatment?.activeBlockerRefs?.length ?? 0) > 0;

  const actionFooter = useMemo(() => {
    if (remediationFooter) return remediationFooter;
    if (hasAnyActiveConstraint || slaHasBlocker) return null;
    if (slaActionHref && slaActionLabel) return (
      <Button variant="contained" size="small" onClick={() => { onClose?.(); navigate(slaActionHref); }} sx={{ textTransform: 'none' }}>
        {slaActionLabel}
      </Button>
    );
    if (order?.warehouseStatus) return null;
    return (
      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-start' }}>
        <Button
          variant="contained"
          size="small"
          sx={{
            flex: '0 1 auto',
            minWidth: 140,
            textTransform: 'none',
            borderRadius: '6px',
            color: prioritized ? 'var(--confirm-ink)' : 'var(--accent-ink)',
            bgcolor: prioritized ? 'var(--confirm-ghost)' : 'var(--accent)',
            border: prioritized ? '1px solid var(--confirm-border)' : 'none',
            cursor: prioritized ? 'default' : 'pointer',
            '&:hover': { bgcolor: prioritized ? 'var(--confirm-ghost)' : 'var(--accent)', opacity: prioritized ? 1 : 0.88 },
            '&.Mui-disabled': { color: prioritized ? 'var(--confirm-ink)' : undefined, bgcolor: prioritized ? 'var(--confirm-ghost)' : undefined },
          }}
          disabled={isPrioritizing || prioritized}
          onClick={async () => {
            if (!onPriorityFlag) return;
            setIsPrioritizing(true);
            try {
              await onPriorityFlag([orderId], true);
              setPrioritized(true);
            } finally {
              setIsPrioritizing(false);
            }
          }}
        >
          {prioritized ? 'Prioritized ✓' : isPrioritizing ? 'Prioritizing…' : 'Prioritize'}
        </Button>
        <Button
          variant="outlined"
          size="small"
          endIcon={<ArrowRight size={14} />}
          onClick={() => { onClose?.(); navigate('/orders/flow'); }}
          sx={{ flex: '0 1 auto', minWidth: 140, borderColor: 'var(--accent-border)', color: 'var(--accent)', textTransform: 'none' }}
        >
          Go to order flow
        </Button>
      </Box>
    );
  }, [remediationFooter, hasAnyActiveConstraint, slaHasBlocker, slaActionHref, slaActionLabel, order?.warehouseStatus, prioritized, isPrioritizing, onPriorityFlag, orderId, onClose, navigate]);

  // The timeline is chronological, as in the former body presentation.
  // Memoize from rendered primitives so equivalent refetched arrays cannot
  // republish the footer through onFooterReady.
  const newestEvent = order?.timeline?.[order.timeline.length - 1];
  const previousEvent = order?.timeline?.[order.timeline.length - 2];
  const newestLabel = newestEvent ? formatTimelineEventLabel(newestEvent.status) : undefined;
  const newestTimestamp = newestEvent ? new Date(newestEvent.event_occurred_at).toLocaleString() : undefined;
  const previousLabel = previousEvent ? formatTimelineEventLabel(previousEvent.status) : undefined;
  const previousTimestamp = previousEvent ? new Date(previousEvent.event_occurred_at).toLocaleString() : undefined;

  const activityFooter = useMemo(() => {
    if (newestLabel === undefined) return null;
    return (
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.75 }}>
          Latest activity
        </Typography>
        {[
          { label: newestLabel, timestamp: newestTimestamp },
          { label: previousLabel, timestamp: previousTimestamp },
        ].filter((event) => event.label !== undefined).map((event, i) => (
          <Box key={i} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mt: i === 0 ? 0 : 0.5 }}>
            <Typography sx={{ fontSize: 13, color: 'var(--ink)' }}>{event.label}</Typography>
            <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>{event.timestamp}</Typography>
          </Box>
        ))}
      </Box>
    );
  }, [newestLabel, newestTimestamp, previousLabel, previousTimestamp]);

  const footerContent = useMemo(() => {
    if (!actionFooter && !activityFooter) return null;
    return (
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: { xs: 'stretch', md: 'flex-start' }, gap: 2, width: '100%' }}>
        {actionFooter && <Box sx={{ flex: 1, minWidth: 0 }}>{actionFooter}</Box>}
        {activityFooter && <Box sx={{ flex: 1, minWidth: 0, ml: { md: 'auto' }, maxWidth: { md: 380 } }}>{activityFooter}</Box>}
      </Box>
    );
  }, [actionFooter, activityFooter]);

  const urgencySubtitle = buildUrgencySubtitle(cachedRow, format);

  useEffect(() => {
    if (order) {
      onTitleReady(order.externalOrderId ? `Order #${order.externalOrderId}` : `Order #${orderId.slice(0, 8).toUpperCase()}`);
    }
  }, [order, orderId, onTitleReady]);

  useEffect(() => {
    onSubtitleReady(urgencySubtitle);
  }, [urgencySubtitle, onSubtitleReady]);

  useEffect(() => {
    onFooterReady(footerContent);
  }, [footerContent, onFooterReady]);

  if (isLoading || detailQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={24} sx={{ color: 'var(--accent)' }} />
      </Box>
    );
  }

  if (isRealError) {
    return <Alert severity="warning" sx={{ mb: 2 }}>Couldn't load this order's decision. Try reopening.</Alert>;
  }

  // ISS-07b FIX (2026-07-04): order_warehouse_status has no row for any
  // order fulfilled outside LaSyncro's own pick/pack pipeline (confirmed
  // live: 10/10 seeded "shipped" orders, likely also real Shopify-side-
  // fulfilled orders in production) — formatWarehouseStatus(null) then
  // fell back to a hardcoded 'In pool' string even though the order had
  // already shipped, per order.fulfillment.status = 'fulfilled'. Adding
  // the missing third tier: Blocked > Fulfilled > real warehouse stage >
  // In pool. order.fulfillment was already fetched and returned by the
  // backend (orders.service.ts) — no backend or type change needed, this
  // field was simply never read here.
  const isFulfilled = order?.fulfillment?.status === 'fulfilled';
  /**
   * GH-1053: the old "Pipeline status" chip in the money column is replaced by
   * the Warehouse Status plane below — same three-tier truth (Blocked >
   * Fulfilled > real warehouse stage > pool), stated once instead of twice.
   */
  const stageView = resolveWarehouseStageView(
    order?.warehouseStatus ?? null,
    hasAnyActiveConstraint,
    isFulfilled,
  );
  const pipelineColorKey = hasAnyActiveConstraint
    ? 'danger'
    : isFulfilled
    ? 'success'
    : order?.warehouseStatus
    ? 'accent'
    : 'neutral';

  return (
    <Box>
      {/*
        THREE-PLANE BODY (GH-1053)
        ---------------------------
        Facts | Money | Why + Warehouse status, as a compact desktop grid that
        fits without scrolling at normal desktop width, and stacks at narrow
        widths. Density comes from spacing and hierarchy overhead only —
        established type sizes are unchanged. Remediation is NOT here; it
        lives in the footer (see remediationFooter above), so the action never
        scrolls out of reach.
      */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.25fr) minmax(0, 0.85fr) minmax(0, 1fr)' },
          gap: 2.5,
          alignItems: 'start',
          mb: 2.5,
        }}
      >
        {/* ── PLANE A — FACTS ─────────────────────────────────────────────
            Order contents, shipping/customer context, and the compact
            activity trail. Customer identity is sourced from orders.shipping_*
            (VO-01/VO-07) — NOT customers.email/first_name, which is
            structurally blank for most merchants (Shopify PCD scope). "name"
            here is the shipping recipient, not a verified account identity —
            do not imply otherwise in copy. */}
        <Box sx={{ minWidth: 0 }}>
          {order && (
            <>
              <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.75 }}>
                Order contents
              </Typography>
              {order.lineItems.map((item) => (
                <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.5 }}>
                  {item.image_url ? (
                    <Box component="img" src={item.image_url} alt=""
                      sx={{ width: 36, height: 36, borderRadius: '6px', objectFit: 'cover', flexShrink: 0, border: '1px solid var(--rule)' }} />
                  ) : (
                    // VO-08: no placeholder asset exists yet — a plain
                    // bordered box avoids a broken-image icon without
                    // inventing product imagery.
                    <Box sx={{ width: 36, height: 36, borderRadius: '6px', flexShrink: 0, border: '1px solid var(--rule)', bgcolor: 'var(--bg-2)' }} />
                  )}
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontSize: 13, color: 'var(--ink)' }}>{item.title}</Typography>
                    <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>{item.sku ?? 'No SKU'} · qty {item.quantity}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                    {format(item.line_total, { currency: order.currency })}
                  </Typography>
                </Box>
              ))}

              {order.shipping.name && (
                <Box sx={{ mt: 2 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.75 }}>
                    Customer
                  </Typography>
                  <Typography sx={{ fontSize: 13, color: 'var(--ink)' }}>{order.shipping.name}</Typography>
                  {order.shipping.address1 && (
                    <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mt: 0.25 }}>{order.shipping.address1}</Typography>
                  )}
                  {order.shipping.address2 && (
                    <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>{order.shipping.address2}</Typography>
                  )}
                  {(order.shipping.city || order.shipping.province || order.shipping.countryCode) && (
                    <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
                      {[order.shipping.city, order.shipping.province, order.shipping.countryCode].filter(Boolean).join(', ')}
                    </Typography>
                  )}
                </Box>
              )}
            </>
          )}

        </Box>

        {/* ── PLANE B — MONEY ─────────────────────────────────────────────
            Shipping line intentionally omitted — GH-1032, no reliable source
            yet, and it must not be derived client-side either. */}
        {order && (
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.75 }}>
              Summary
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.25 }}>
              <Typography sx={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Subtotal</Typography>
              <Typography sx={{ fontSize: 12.5, color: 'var(--ink)' }}>{format(order.subtotal, { currency: order.currency })}</Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.25 }}>
              <Typography sx={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Tax</Typography>
              <Typography sx={{ fontSize: 12.5, color: 'var(--ink)' }}>{format(order.tax, { currency: order.currency })}</Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 0.75, mt: 0.5, borderTop: '1px solid var(--rule)' }}>
              <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', textTransform: 'uppercase' }}>Total</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{format(order.total, { currency: order.currency })}</Typography>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1.5 }}>
              <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>Payment status</Typography>
              <Box sx={{ px: 1.25, py: 0.375, borderRadius: '999px', fontSize: 11, fontWeight: 500, bgcolor: 'rgba(99,153,34,0.12)', color: '#3B6D11' }}>
                {order.paymentState.replace(/_/g, ' ')}
              </Box>
            </Box>

            {order.tracking?.tracking_number && (
              <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mt: 1.25 }}>
                Tracking: {order.tracking.tracking_number}{order.tracking.carrier_code && ` (${order.tracking.carrier_code})`}
              </Typography>
            )}
          </Box>
        )}

        {/* ── PLANE C — WHY / WAREHOUSE STATUS ────────────────────────────
            Active blockers first (constraints[] is canonical blocker truth,
            decision enrichment may be absent), then the compact stage
            visualization. The similar-orders surface that used to sit under
            the blocker cards is removed — see GH-1053. */}
        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {constraints.length > 0 && (
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.75 }}>
                Issue
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {constraints.map((c, i) => {
                  const assistItem =
                    c.constraint_type === 'inventory' &&
                    typeof c.target_id === 'string'
                      ? inventoryAssistItems?.find((item) => item.variantId === c.target_id)
                      : undefined;

                  return (
                    <Box
                      key={`${c.constraint_type}-${c.block_type ?? 'unknown'}-${c.target_id ?? i}`}
                      sx={{ display: 'flex', flexDirection: 'column', gap: assistItem ? 0.5 : 0 }}
                    >
                      <ConstraintAlertCard
                        constraintType={c.constraint_type}
                        blockType={c.block_type}
                      />

                      {assistItem && (
                        <Box
                          data-testid={`inv-assist-item-${assistItem.variantId}`}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 1,
                            px: 1.25,
                            py: 0.5,
                            borderRadius: '8px',
                            bgcolor: 'var(--bg-2)',
                          }}
                        >
                          <Typography
                            sx={{
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              fontSize: 11.5,
                              color: 'var(--ink-3)',
                            }}
                          >
                            {[
                              assistItem.identity.productTitle,
                              assistItem.identity.variantTitle,
                              assistItem.identity.sku,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Typography>

                          <Typography
                            sx={{
                              flexShrink: 0,
                              fontSize: 11.5,
                              fontWeight: 500,
                              color: 'var(--ink-2)',
                            }}
                          >
                            Need{' '}
                            <span data-testid={`inv-assist-need-${assistItem.variantId}`}>
                              {assistItem.blockerEvidence.orderRemainingQty}
                            </span>
                            {' · '}Available{' '}
                            <span data-testid={`inv-assist-available-${assistItem.variantId}`}>
                              {assistItem.blockerEvidence.pickableAvailableQty}
                            </span>
                            {' · '}Short{' '}
                            <span data-testid={`inv-assist-short-${assistItem.variantId}`}>
                              {assistItem.blockerEvidence.shortageQty}
                            </span>
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}

          <WarehouseStatusPanel view={stageView} tone={pipelineColorKey} />
          {slaTreatment && (
            <Box sx={{ mt: 1, color: 'var(--ink-3)' }}>
              {slaTreatment.sla.state && <Typography sx={{ fontSize: 12 }}>Fulfillment SLA: {slaTreatment.sla.state}</Typography>}
              {slaTreatment.execution.assessment && <Typography sx={{ fontSize: 12 }}>{slaTreatment.execution.assessment.replace(/_/g, ' ')}</Typography>}
              {slaTreatment.cpt.state === 'before_cutoff' && <Typography sx={{ fontSize: 12 }}>Today's cutoff: {slaTreatment.cpt.localTime?.slice(0, 5)} ({slaTreatment.cpt.timezone})</Typography>}
              {slaTreatment.cpt.state === 'cutoff_reached' && <Typography sx={{ fontSize: 12 }}>Today's configured cutoff has been reached.</Typography>}
            </Box>
          )}

          {showInventoryResolvedBanner && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'rgba(99,153,34,0.12)', borderRadius: '10px', p: 1.25 }}>
              <Typography sx={{ fontSize: 12.5, color: '#3B6D11' }}>Stock confirmed — inventory block resolved</Typography>
            </Box>
          )}

          {!hasAnyActiveConstraint && !order?.warehouseStatus && !isFulfilled && (
            <Box sx={{ display: 'flex', gap: 1.25, bgcolor: 'var(--bg-2)', borderRadius: '10px', p: 1.25 }}>
              <Clock size={16} color="var(--ink-3)" style={{ flexShrink: 0, marginTop: 1 }} />
              <Typography sx={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                No open issues. Order is in the pool, waiting to be released into a pick batch.
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/*
        Mounted by this component regardless of where its trigger lives — the
        footer's "Correct shipping address" action only flips the open state.
        PATCH / recheck / canonical-constraint semantics are unchanged.
      */}
      <ShippingAddressDialog
        key={orderId}
        open={shippingAddressDialogOpen}
        onClose={() => setShippingAddressDialogOpen(false)}
        onSaved={() => {
          setShippingAddressDialogOpen(false);
          setAddressRecheckPending(true);
        }}
        orderId={orderId}
        currentShipping={order?.shipping}
        addressAssist={order?.addressAssist}
      />

      {!exceptionsQuery.isLoading && exceptions.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
            Pick exceptions · {unresolvedExceptions.length} open
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
                      {exc.stage.replace(/_/g, ' ')} · Batch {exc.batch_short_id} · needed {exc.quantity_required}, found {exc.quantity_found}
                    </Typography>
                  </Box>
                  {exc.resolved ? (
                    <Typography sx={{ fontSize: 11, fontWeight: 600, color: '#4CAF7A' }}>Resolved</Typography>
                  ) : (
                    <Button size="small" variant="outlined" disabled={resolveException.isPending}
                      onClick={() => resolveException.mutate({ exceptionId: exc.pick_exception_id, resolutionNote: 'Resolved from Order detail' })}
                      sx={{ fontSize: 11, color: 'var(--accent)', borderColor: 'var(--accent)' }}>
                      Resolve
                    </Button>
                  )}
                </Box>
                {exc.resolved && exc.resolution_note && (
                  <Typography sx={{ fontSize: 11.5, color: 'var(--ink-4)', mt: 0.5, fontStyle: 'italic' }}>"{exc.resolution_note}"</Typography>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}
      {/* §ISS-OD-02: pack decision history — merged from OrderDetailPage */}
      {order && <PackDecisionHistory lasyncroOrderId={order.id} />}
    </Box>
  );
}
