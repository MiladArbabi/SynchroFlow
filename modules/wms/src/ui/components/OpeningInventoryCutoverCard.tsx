// 4b-2b GRILL-04 — merchant opening inventory cutover card.
//
// Presentational only. Canonical state comes from the page's
// GET /api/v1/wms/opening-inventory/progress; the only input this card can
// send back is the explicit physical-truth acceptance boolean. Readiness,
// owner/admin authority, the economic delta, idempotency and retries are
// all owned by the backend cutover service — this card never computes
// deltas or Shopify quantities, and `canApprove` is an advisory UI gate.
//
// Extracted from WmsModuleFT2 so its contract can be proven with a direct
// render (same precedent as RecountEmptyState).
import { useState, type ReactNode } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, Typography } from '@mui/material';
import { WMS_TIER1_ACTION_SX } from '../pages/CountingSessionPage';

/**
 * JSON wire shape of the backend's ShopOpeningInventoryProgress
 * (apps/backend/src/services/wms/inventoryRecount.service.ts). Dates arrive
 * as ISO strings.
 */
export type OpeningInventoryReconciliationState =
  | 'not_required'
  | 'not_started'
  | 'counting'
  | 'needs_bin_review'
  | 'ready_for_cutover'
  | 'review_required';

export interface OpeningInventoryDifference {
  lasyncro_variant_id: string;
  expected_quantity: number;
  observed_quantity: number;
  delta: number;
}

export interface OpeningInventoryBinProgress {
  recount_task_id: string;
  warehouse_id: string;
  location_code: string;
  status: string;
  progress_state: 'not_started' | 'in_progress' | 'needs_review' | 'complete';
  claimed_by: number | null;
}

export interface OpeningInventoryProgress {
  bootstrap_model: 'legacy_opening_balance_v1' | 'reconcile_opening_expectation_v2';
  reconciliation_required: boolean;
  started_at: string | null;
  state: OpeningInventoryReconciliationState;
  total_bins: number;
  complete_bins: number;
  in_progress_bins: number;
  needs_review_bins: number;
  not_started_bins: number;
  remaining_bins: number;
  progress_pct: number;
  all_bins_settled: boolean;
  difference_count: number;
  differences: OpeningInventoryDifference[];
  bins: OpeningInventoryBinProgress[];
}

/** JSON wire shape of the backend's OpeningInventoryCutoverView. */
export type OpeningInventoryCutoverStatus = 'prepared' | 'executing' | 'failed' | 'complete';

export interface OpeningInventoryCutoverView {
  progress: OpeningInventoryProgress;
  cutover: {
    status: OpeningInventoryCutoverStatus;
    /** Persisted merchant acceptance (physical_truth_accepted_at IS NOT NULL). */
    physical_truth_accepted: boolean;
    /** Merchant-safe classification; the raw persisted error is never sent. */
    error_code: string | null;
    error_message: string | null;
    completed_at: string | null;
  } | null;
  shopify_synced_at: string | null;
}

export interface OpeningInventoryCutoverCardProps {
  view: OpeningInventoryCutoverView | null;
  /** Advisory owner/admin gate — the backend re-validates membership. */
  canApprove: boolean;
  /** True while the page's POST is in flight. */
  submitting: boolean;
  /** Last POST error message from the page, if any. */
  error: string | null;
  onApprove: (acceptPhysicalTruth: boolean) => void | Promise<void>;
}

export const OPENING_INVENTORY_ACCEPT_PHRASE = 'LaSyncro physical count is truth';

const CARD_SX = {
  bgcolor: 'var(--surface)',
  border: '1px solid var(--rule)',
  borderRadius: '14px',
  p: 2,
  mb: 3,
} as const;

export function OpeningInventoryCutoverCard({
  view,
  canApprove,
  submitting,
  error,
  onApprove,
}: OpeningInventoryCutoverCardProps) {
  const [accepted, setAccepted] = useState(false);

  if (!view || view.progress.state === 'not_required') return null;

  const { progress, cutover } = view;
  const isComplete = cutover?.status === 'complete' || Boolean(view.shopify_synced_at);
  // Only the local in-flight request blocks the action. A persisted
  // 'executing' cutover (e.g. the process died mid-sync) is resumable
  // immediately through the same POST: the backend replays the persisted
  // payload under the same Shopify idempotency keys.
  const isPersistedExecuting = cutover?.status === 'executing';
  const isFailed = cutover?.status === 'failed';
  const isActionable =
    progress.state === 'ready_for_cutover' || progress.state === 'review_required';
  const requiresAcceptance = progress.state === 'review_required';
  // Consent is never invented: it is either already recorded on the
  // persisted cutover or given now via the explicit control.
  const hasPersistedAcceptance = cutover?.physical_truth_accepted === true;
  const acceptanceSatisfied = !requiresAcceptance || hasPersistedAcceptance || accepted;

  const title = (
    <Typography sx={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', mb: 1 }}>
      Opening inventory
    </Typography>
  );

  if (isComplete) {
    return (
      <Box sx={CARD_SX}>
        {title}
        <Alert severity="success">Opening inventory synced to Shopify.</Alert>
      </Box>
    );
  }

  let status: ReactNode;
  switch (progress.state) {
    case 'not_started':
      status = (
        <Alert severity="info">
          Your first warehouse count has not started yet. Count every bin before stock is synced to Shopify.
        </Alert>
      );
      break;
    case 'counting':
      status = (
        <Alert severity="info">
          Count in progress — {progress.complete_bins} of {progress.total_bins} bins counted.
        </Alert>
      );
      break;
    case 'needs_bin_review':
      status = (
        <Alert severity="warning">
          {progress.needs_review_bins} {progress.needs_review_bins === 1 ? 'bin needs' : 'bins need'} bin review.
          Resolve them before stock can be synced to Shopify.
        </Alert>
      );
      break;
    case 'review_required':
      status = (
        <Alert severity="warning">
          Your count differs from Shopify for {progress.difference_count}{' '}
          {progress.difference_count === 1 ? 'product' : 'products'}. Syncing will correct Shopify to match what you counted.
        </Alert>
      );
      break;
    case 'ready_for_cutover':
      status = (
        <Alert severity="info">
          All bins are counted and match Shopify. Confirm to finish the opening sync.
        </Alert>
      );
      break;
    default:
      status = null;
  }

  const actionLabel = submitting
    ? 'Syncing to Shopify…'
    : isPersistedExecuting
      ? 'Resume Shopify sync'
      : isFailed
        ? 'Retry Shopify sync'
        : 'Sync opening inventory to Shopify';

  return (
    <Box sx={CARD_SX}>
      {title}
      {status}

      {isPersistedExecuting && !submitting && (
        <Alert severity="info" sx={{ mt: 1 }}>
          A Shopify sync was started but has not finished. Resuming continues the same sync.
        </Alert>
      )}

      {isFailed && cutover?.error_message && (
        <Alert severity="error" sx={{ mt: 1 }}>
          Shopify sync failed: {cutover.error_message}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}

      {isActionable && !canApprove && (
        <Typography sx={{ fontSize: 13, color: 'var(--ink-3)', mt: 1.5 }}>
          {submitting
            ? 'Syncing to Shopify.'
            : isPersistedExecuting || isFailed
              ? 'An owner or admin must resume the Shopify sync.'
              : 'An owner or admin must approve the Shopify sync.'}
        </Typography>
      )}

      {isActionable && canApprove && (
        <Box sx={{ mt: 1.5 }}>
          {requiresAcceptance && hasPersistedAcceptance && (
            <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
              You already accepted the LaSyncro physical count as truth for this sync.
            </Typography>
          )}
          {requiresAcceptance && !hasPersistedAcceptance && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={accepted}
                  disabled={submitting}
                  onChange={(event) => setAccepted(event.target.checked)}
                />
              }
              label={OPENING_INVENTORY_ACCEPT_PHRASE}
            />
          )}
          <Box>
            <Button
              variant="contained"
              disabled={submitting || !acceptanceSatisfied}
              onClick={() => {
                if (submitting || !acceptanceSatisfied) return;
                void onApprove(requiresAcceptance);
              }}
              sx={{ ...WMS_TIER1_ACTION_SX, borderRadius: '6px', fontWeight: 600, mt: 1 }}
            >
              {actionLabel}
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}
