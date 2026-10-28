// modules/wms/src/ui/pages/WmsModuleFT2.tsx
import { useState, memo, useCallback, useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  TextField,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Menu,
  MenuItem,
  Collapse,
  IconButton,
} from '@mui/material';
import { ScanBarcode, Package, ChevronDown, ChevronUp, ArrowUp, MoreVertical } from 'lucide-react';
import { WmsConnectionBadge } from '../components/WmsConnectionBadge.js';
import PickSessionPage, {
  type LineItem,
  type ConfirmScanParams,
  type ReportExceptionParams,
  type ReportPackExceptionParams,
  type CreateProblemTaskParams,
} from './PickSessionPage.js';
import PackSessionPage, {
  type PackOrder,
} from './PackSessionPage.js';
import ReceiveSessionPage, {
type ReceiveJobLine,
type ReceiveReconciliationEvidence,
type ReceiveReconciliationDraftPayload,
type ReceiveReconciliationFinalizePayload,
type ReceiveReconciliationRevisionResult,
type ReceiveSessionMode,
resolveReceiveSessionMode,
} from './ReceiveSessionPage.js';
import StowSessionPage, { type StowPlacement } from './StowSessionPage.js';
import CountingSessionPage, {
  type CountingLine,
  type CountingSkipReason,
  type CountingTask,
  type CountingFinding,
  type CountingFindingType,
  type CountingSessionPageProps,
  WMS_TIER1_ACTION_SX,
} from './CountingSessionPage.js';
import { EntityDetailModal, IsometricCanvas, ModuleErrorBoundary, SpotlightCoachMark } from '@lasyncro/shared/ui';
import {
  classifyRecountBinAvailability,
  mapRecountPreviewBinsToCanvas,
  selectAllRecountBins,
  toggleRecountBinSelection,
  warehouseLocationToZone,
  type RecountPreviewBin,
} from './recountSelection.js';
import { RecountEmptyState } from '../components/RecountEmptyState.js';

export {
  mapRecountPreviewBinsToCanvas,
} from './recountSelection.js';
export type {
  RecountBinCanvasSelection,
  RecountPreviewBin,
} from './recountSelection.js';
import type { WarehouseLocation } from '@lasyncro/shared/ui';
import ReturnSessionPage, { AddReturnLineInput, CompleteReturnJobInput, ReturnJobDetail, UpdateReturnLineInput } from './ReturnSessionPage.js';
import { isAllClear, type WorkTallyCounts } from '../components/WorkTally.js';
import {
  OpeningInventoryCutoverCard,
  type OpeningInventoryCutoverView,
} from '../components/OpeningInventoryCutoverCard.js';

/**
 * WMS MODULE — FT2 SURFACE
 * -------------------------
 * Mobile-optimized pick/pack operator interface.
 *
 * Zones:
 * - Active pick session → PickSessionPage
 * - Active pack session → PackSessionPage
 * - Available/pick_complete batches → action buttons
 * - Empty state → no batches released
 *
 * All API callbacks injected via props — module stays decoupled
 * from apps/frontend HTTP layer.
 *
 * Theme-aware: Paper, theme.palette tokens, no hardcoded colors.
 */

export type WmsBatch = {
  pick_batch_id: string;
  status: string;
  total_line_items: number;
  total_units: number;
  units_picked: number;
  units_packed: number;
  picked_by: number | null;
  packed_by: number | null;
  released_at: string;
  picker_name?: string | null;
  packer_name?: string | null;
  pick_completed_at?: string | null;
};

export type WmsData = {
  batches: WmsBatch[];
} | null;

export type WmsStowTask = {
  stow_task_id: string;
  lasyncro_variant_id: string;
  quantity: number;

  // STOW-SPLIT-01 — cumulative committed progress comes from stow_tasks.
  // Resume/refresh must reconstruct remaining work from persisted warehouse
  // state rather than assuming the original task quantity is still outstanding.
  quantity_placed: number;

  location_code: string | null;
  status: 'pending' | 'in_progress';
  trigger: string;
  // STOW-LIFECYCLE-02 — optional owner/admin dispatch. null means
  // "first one to claim"; narrows claim eligibility when set.
  assigned_operator_id: number | null;
  assigned_operator_name: string | null;
  claimed_by: number | null;
  claimed_at: string | null;
  created_at: string;
  variant_title: string | null;
  sku: string | null;
  product_title: string | null;
  image_url: string | null;       // WEB-STOW-UNIT-01: product image for item scan confirmation
  unit_ids: string[] | null;      // WEB-STOW-UNIT-01: LSU- IDs for units assigned to this task
};

export type WmsStowConfirmResult = {
  stow_task_id: string;
  status: 'in_progress' | 'completed';
  is_fully_placed: boolean;
  quantity_placed: number;
  quantity_total: number;
  placed_now: number;
};


/** WMS-OPS-NEEDS-ATTENTION-01 — presentation-only row; no alert authority. */
export type WmsNeedsAttentionRow = {
  id: string;
  title: string;
  actionLabel: string;
  tone: 'critical' | 'warning' | 'info';
  a11yLabel?: string;
};

/** `total` is the full canonical actionable count; `rows` are already bounded and ordered. */
export type WmsNeedsAttention = {
  total: number;
  rows: WmsNeedsAttentionRow[];
  /** PARITY-05 — app-derived (canonical NOW count − visible rows); >0 renders "{n} more". */
  overflowCount?: number;
};

export type WmsModuleFT2Props = {
  data: WmsData;
  isLoading: boolean;
  isError: boolean;
  gridLocations?: WarehouseLocation[];

  onCreateReceiveJob?: (poId: string) => Promise<{ receive_job_id: string }>;
  onFetchReceiveJob?: (jobId: string) => Promise<{
    job: {
      po_id: string;
      po_number?: number | null;
      supplier_name: string;
      status?: string;
      assigned_operator_id?: number | null;
      closed_at?: string | null;
      actual_delivery_date?: string | null;
      /** GH-1241 S3C-M1 — receive_jobs.delivery_accounting_version (1 legacy, 2 delivery-scoped). */
      delivery_accounting_version?: number | null;
    };
    lines: ReceiveJobLine[];
  }>;
  /**
   * GH-1241 S3C-M1 — GET /receive-jobs/:jobId/reconciliation. Required for v2
   * sessions: when absent the session fails closed (no per-line fallback).
   */
  onFetchReceiveReconciliation?: (jobId: string) => Promise<ReceiveReconciliationEvidence>;
  /** GH-1241 S3C-M3 — PUT /reconciliation/draft; the host owns the idempotency event. */
  onSaveReceiveReconciliationDraft?: (jobId: string, payload: ReceiveReconciliationDraftPayload) => Promise<ReceiveReconciliationRevisionResult>;
  /** GH-1241 S3C-M3 — POST /reconciliation/finalize; the host owns the idempotency event. */
  onFinalizeReceiveReconciliation?: (jobId: string, payload: ReceiveReconciliationFinalizePayload) => Promise<unknown>;
  onClaimReceiveJob?: (jobId: string) => Promise<void>;
  onInspectReceiveLine?: (jobId: string, params: { lasyncro_variant_id: string | null; receive_job_line_id: string; quantity_accepted: number; quantity_rejected: number; quantity_missing?: number; quantity_deferred?: number }) => Promise<void>;
  onPersistReceiveLineProgress?: (jobId: string, lineId: string, params: { quantity_sellable_provisional: number; reconciliation_required?: boolean; quantity_deferred?: number }) => Promise<void>;
  /** GH-1241 S3-A1 — operator physical-count confirmation; absent → Receive lines fail closed. */
  onConfirmReceiveLineCount?: (jobId: string, lineId: string, params: { quantity_confirmed: number }) => Promise<void>;
  onReportReceiveException?: (jobId: string, params: { lasyncro_variant_id: string | null; receive_job_line_id: string; exception_type: string; quantity_affected: number; accounting_role?: string; notes?: string }) => Promise<void>;
  /**
   * GH-1108 / RECEIVE-OVERCOUNT-01 — REQUIRED, deliberately not optional,
   * same reasoning as onConfirmUnitLabelsPrinted below. This module is a
   * pure pass-through between WmsOperationsPage and ReceiveSessionPage; an
   * optional prop dropped here fails OPEN — ReceiveSessionPage would treat a
   * missing callback as "approval unavailable" only if it guards for
   * undefined, but the whole point of this seam is that the canonical
   * overage-approval persistence (extra_item / accounting_role=overage)
   * must always actually happen before an over-expected line can be
   * inspected. Requiring it here means a dropped wire is a compile error,
   * not a silent no-op that lets "Accept extra" look like it worked.
   */
  onApproveOverDelivery: (jobId: string, params: { lasyncro_variant_id: string | null; receive_job_line_id: string; quantity_affected: number; notes: string }) => Promise<void>;
  onCloseReceiveJob?: (jobId: string, params: { actual_delivery_date?: string }) => Promise<void>;
  /**
   * WAREHOUSE-FOCUS-SHELL-01A — ReceiveSessionPage reports whether the
   * operator is actively executing (sessionPhase !== 'brief') for the
   * named job; the parent (WmsOperationsPage) uses this to add/remove
   * warehouseFocus in the URL without removing receiveJobId.
   */
  onReceiveSessionFocusChange?: (jobId: string, focused: boolean) => void;
  onPrintUnitLabels?: (receiveJobLineId: string) => Promise<void>;
  /**
   * GH-1085 — REQUIRED, deliberately not optional. This module is a pure
   * pass-through between WmsOperationsPage and ReceiveSessionPage, and an
   * optional prop dropped here fails OPEN: the operator's "labels printed &
   * attached" confirmation would silently no-op and barcode-less stock would
   * be treated as ready with nothing recorded in the backend.
   */
  onConfirmUnitLabelsPrinted: (receiveJobLineId: string) => Promise<void>;

  onClaimBatch: (batchId: string) => Promise<void>;
  onFetchLineItems: (batchId: string) => Promise<LineItem[]>;
  onResolveBarcode: (scannedValue: string) => Promise<{ lasyncro_variant_id: string } | null>;
  onConfirmScan: (batchId: string, params: ConfirmScanParams) => Promise<void>;
  onReportException: (batchId: string, params: ReportExceptionParams) => Promise<{ pick_exception_id: string }>;
  onCreateProblemTask: (params: CreateProblemTaskParams) => Promise<void>;
  onPickComplete: (batchId: string) => Promise<void>;

  onClaimPack: (batchId: string) => Promise<void>;
  onFetchPackOrders: (batchId: string) => Promise<PackOrder[]>;
  /**
   * WEB-PACK-02 — consequential Pack execution scanner (may auto-claim and
   * record Pack evidence). Used only inside Pack execution, never by the
   * Operations overview Quick Scan.
   */
  onPackFreeScan: (scannedValue: string, expectedOrderId?: string) => Promise<PackFreeScanApiResponse>;
  /**
   * WMS-OPS-LIFECYCLE-IA-02 — read-only Operations overview Quick Scan
   * (POST /api/v1/wms/scan/resolve). Identifies, never mutates. Kept separate
   * from onPackFreeScan so the two authorities cannot be confused.
   */
  onOperationsScanResolve?: (scannedValue: string) => Promise<OperationsScanResolution>;
  /**
   * Role-derived Operations shell. 'management' (owner/admin, the default) is
   * the five-stage pipeline overview; 'operator' is the task-focused shell.
   * Presentation only — backend action checks remain authoritative.
   */
  operationsShell?: 'management' | 'operator';
  onConfirmPackScan: (batchId: string, params: {
    lasyncro_order_id: string;
    lasyncro_line_item_id: string;
    lasyncro_variant_id: string;
    quantity_confirmed: number;
  }) => Promise<{ order_complete: boolean }>;
  onReportPackException: (batchId: string, params: ReportPackExceptionParams) => Promise<{ pick_exception_id: string }>;
  onPrintLabel: (orderId: string) => Promise<void>;
  onPrintInvoice: (orderId: string) => Promise<void>;
  onPackComplete: (batchId: string) => Promise<void>;

  onConfirmShipment: (batchId: string, orderId: string, partial?: boolean) => Promise<void>;
  onRaisePackDecision: (batchId: string, params: {
    pick_batch_id: string;
    lasyncro_order_id: string;
    lasyncro_line_item_id: string;
    exception_type: 'item_missing' | 'short_pick';
    question: 'ship_partial';
  }) => Promise<{ id: string }>;
  onPollPackDecision: (requestId: string) => Promise<{
    status: 'pending' | 'approved' | 'rejected';
    partial_shipment: boolean | null;
    note: string | null;
  }>;
  onRefresh: () => void;
  onSessionExit?: () => void;
  onCountFinished?: (label: string) => void;
  /** Stow tasks — pending stock that needs to be put away after receive or cancelled pick */
  stowTasks?: WmsStowTask[];
  onClaimStowTask?: (taskId: string) => Promise<void>;
  onConfirmStow?: (
    taskId: string,
    quantityPlaced?: number,
    lasyncroUnitId?: string
  ) => Promise<WmsStowConfirmResult>;
  // STOW-SPLIT-01 — the per-unit scanner commits each successful physical scan
  // directly. The retired bulk-shortfall exception callback is no longer part
  // of the stow session contract.
  onFetchStowTasks?: () => Promise<WmsStowTask[]>;
  onResolveLocation?: (scannedValue: string) => Promise<{ location_code: string } | null>;
  onAssignStowLocation?: (taskId: string, locationCode: string) => Promise<void>;
  // STOW-UX-SCAN-RAIL-01 — canonical current-bin activity trace, task-scoped.
  onFetchStowPlacements?: (taskId: string) => Promise<StowPlacement[]>;
  // STOW-LIFECYCLE-02 — owner/admin optional dispatch. UI gating here is
  // advisory only; wms:stow:assign remains backend-authoritative (see J).
  canAssignStow?: boolean;
  onFetchStowAssignees?: () => Promise<Array<{
    user_id: number;
    first_name: string | null;
    last_name: string | null;
    role: string;
  }>>;
  onAssignStowTask?: (taskId: string, assignedOperatorId: number | null) => Promise<void>;
  isOnline: boolean;
  queuedCount: number;
  /** App-owned Ops Console state. Presentation only; this module does not own Console state. */
  isOpsConsoleOpen?: boolean;
  /**
   * WMS-OPS-NEEDS-ATTENTION-01 — app-derived, read-only projection of canonical
   * Ops Console NOW. The app owns eligibility, order, count and routes; this
   * module only renders what it is given (management shell only). null/absent
   * = no strip.
   */
  needsAttention?: WmsNeedsAttention | null;
  /** Row action — the app resolves the row id to its canonical destination. */
  onNeedsAttentionAction?: (rowId: string) => void;
  /**
   * PARITY-03 — Needs attention trailing action: opens the app-owned,
   * read-only canonical History (never the Ops Console).
   */
  onOpenHistory?: () => void;
  /**
   * PARITY-05 — "{n} more": opens the app-owned, read-only full Needs
   * attention list (never the Ops Console, never History).
   */
  onOpenAllAttention?: () => void;
  /**
   * PARITY-02 — page-owned navigation to carrier setup (/settings/carriers).
   * Ship renders its "Configure carriers" setup action only when provided.
   */
  onConnectCarrier?: () => void;
  /** Pre-fetched receive job from URL handoff (Suppliers → WMS). Auto-enters receive session on mount. */
  pendingReceiveSession?: {
    receiveJobId: string;
    poId: string;
    poNumber?: number | null;
    supplierName: string;
    jobStatus?: string;
    assignedOperatorId?: number | null;
    closedAt?: string | null;
    actualDeliveryDate?: string | null;
    deliveryAccountingVersion?: number | null;
    lines: ReceiveJobLine[];
  } | null;
  /** Stow task ID from URL param — auto-enters stow session on mount. */
  pendingStowTaskId?: string | null;
  pendingStowStep?: 'location' | null;
  /** Return job ID from URL param — auto-enters the existing return session on mount. */
  pendingReturnJobId?: string | null;
  /** Called when operator claims a stow task — parent sets URL param for refresh recovery. */
  onStowSessionEnter?: (taskId: string) => void;
  onStowSessionStepChange?: (taskId: string, step: 'location' | null) => void;
  /** Pick batch ID from URL param — auto-enters pick session on mount. */
  pendingPickBatchId?: string | null;
  /** Called when operator enters a pick session — parent sets URL param for refresh recovery. */
  onPickSessionEnter?: (batchId: string) => void;
  /** Pack batch ID from URL param — auto-enters pack session on mount. */
  pendingPackBatchId?: string | null;
  /** Called when operator enters a pack session — parent sets URL param for refresh recovery. */
  onPackSessionEnter?: (batchId: string) => void;

  onFetchReturnJob: (returnJobId: string) => Promise<ReturnJobDetail>;
  onAddReturnLine: (returnJobId: string, input: AddReturnLineInput) => Promise<void>;
  onProcessReturnLine: (returnJobId: string, input: UpdateReturnLineInput) => Promise<void>;
  onCompleteReturnJob: (returnJobId: string, input: CompleteReturnJobInput) => Promise<void>;
  /**
   * Orders sitting in pick_complete batches — picked, no pack claim yet.
   * Powers the "X orders ready to be packed" summary + expandable list,
   * so operators can see which LSU- barcodes to scan without already
   * being mid pack-session. See wms_qa_findings_2026_07_24.md.
   */
  readyToPackOrders?: {
    pick_batch_id: string;
    lasyncro_order_id: string;
    external_order_id: string;
    wms_barcode: string | null;
    line_items: {
      lasyncro_line_item_id: string;
      product_title: string;
      variant_title: string | null;
      sku: string | null;
      quantity: number;
      unit_barcode: string | null;
    }[];
  }[];
  readyToPackCount?: number;

  /**
   * Work tally sources. Passed through rather than fetched here — this
   * component receives all data by prop (no context, no hooks of its own),
   * matching readyToPackOrders/readyToPackCount.
   */
  openReceiveJobCount?: number;
  /** Canonical open Receive jobs projected by useWms(). */
  openReceiveJobs?: Array<{
    receive_job_id: string;
    status: string;
    assigned_operator_id: number | null;
    /** GH-1143 — assignee identity for another-operator's management card. */
    assigned_operator_name?: string | null;
    started_at?: string | null;
    closed_at?: string | null;
    supplier_name: string;
    po_id: string;
    po_number?: number | null;
    total_units: number;
    total_variants: number;
  }>;
  /** Persists Receive session identity in the URL for refresh recovery. */
  onReceiveSessionEnter?: (jobId: string) => void;
  /**
   * GH-1143 RECEIVE-REASSIGN-UI-01 — owner/admin advisory dispatch gate,
   * same pattern as canAssignStow/canReassignCount. Backend re-validates
   * pending/unstarted state on the assignment PATCH regardless of this
   * prop's value.
   */
  canReassignReceive?: boolean;
  onFetchReceiveAssignees?: () => Promise<Array<{
    user_id: number;
    first_name: string | null;
    last_name: string | null;
    role: string;
  }>>;
  onReassignReceiveJob?: (jobId: string, targetOperatorId: number) => Promise<void>;
  /** True when the count routes returned 403 — Core tier required. */
  recountLocked?: boolean;
  onRecountUpgrade?: () => void;

  /** Count execution — operator-facing tasks only. */
  recountTasks?: CountingTask[];
  /**
   * #1164 — true once recountTasks/recountLocked are definitive (not loading
   * or refetching). Only then may an unresolvable countTaskId fail open.
   */
  recountTasksSettled?: boolean;
  onFetchCountingPreview: () => Promise<RecountPreviewBin[]>;
  onFetchCountingAssignees: () => Promise<Array<{
    user_id: number;
    first_name: string | null;
    last_name: string | null;
    role: string;
  }>>;
  onCreateCountingTask: (input: {
    scope: 'location' | 'locations' | 'suggested';
    location_code?: string;
    location_codes?: string[];
    assigned_to?: number | null;
    notes?: string;
  }) => Promise<void>;
  onFetchCountingLines: (taskId: string) => Promise<CountingLine[]>;
  onFetchCountingFindings: (taskId: string) => Promise<CountingFinding[]>;
  onCreateCountingFinding: (
    taskId: string,
    params: {
      client_event_id: string;
      recount_line_id?: string | null;
      lasyncro_variant_id: string;
      location_code: string;
      finding_type: CountingFindingType;
      quantity: number;
      notes?: string;
    }
  ) => Promise<CountingFinding>;
  onClaimCountingTask: (taskId: string) => Promise<void>;
  /**
   * RECOUNT-CLAIM-ABANDONED-131: owner/admin explicit recovery for an
   * abandoned claimed/counting task. Backend re-validates the target and the
   * acting user's own privilege regardless of what canReassignCount renders.
   */
  onReassignCountingTask?: (taskId: string, targetUserId: number) => Promise<void>;
  onRecordCountingLine: (
    taskId: string,
    lineId: string,
    params: {
      counted_quantity: number;
      count_method: 'unit_scan' | 'bin_quantity';
    }
  ) => Promise<void>;
  onSkipCountingLine: (
    taskId: string,
    lineId: string,
    params: {
      skip_reason: CountingSkipReason;
      notes?: string;
    }
  ) => Promise<void>;
  onCloseCountingTask: (taskId: string) => Promise<void>;
  /** #1164: opening_inventory discovery — server anchors the line to the task bin. */
  onCreateOpeningLine: CountingSessionPageProps['onCreateOpeningLine'];
  /** #1164: opening_inventory bin settlement — never the generic close. */
  onCompleteOpening: CountingSessionPageProps['onCompleteOpening'];

  /** Authenticated user ID used to enforce recount claimant ownership in UI. */
  currentUserId?: number | null;
  /**
   * RECOUNT-CLAIM-ABANDONED-131: advisory UI gate only, derived from the
   * single-role AuthContext exposure — same pattern as the existing
   * canReleaseBatch check in WmsOperationsPage. Backend requireAction is the
   * real authority regardless of this prop's value.
   */
  canReassignCount?: boolean;
  /**
   * GH-1222: advisory role gate for recount MANAGEMENT entry ("Reconcile
   * inventory" create flow, and with it "Set up bins"). Omitted means hidden
   * (fail closed). Evaluated BEFORE the commercial recountLocked upsell, so a
   * role-ineligible user never sees the Core badge or prompt. Does NOT gate
   * recount execution (claim/count). Backend recount create/review/commit
   * actions remain authoritative.
   */
  canManageRecount?: boolean;
  /** Count task ID from URL param — restores an active counting session. */
  pendingCountTaskId?: string | null;
  /**
   * GH-1188 — the URL requested protected count focus (warehouseFocus=count).
   * Holds the ordinary body only while that task is still resolving; it never
   * authorizes a session on its own once count-task state has settled.
   */
  countFocusRequested?: boolean;
  /** Called when an operator enters a counting session. */
  onCountSessionEnter?: (taskId: string) => void;
  /**
   * #1164 / WAREHOUSE-FOCUS-SHELL — reports protected-shell focus for the
   * named count task: focused from its Brief onward, and unfocused when a
   * requested task cannot produce a usable session (fail open). Parent owns
   * URL persistence.
   */
  onCountSessionFocusChange?: (taskId: string, focused: boolean) => void;
  /**
   * RECOUNT-FRESH-NOBINS-40: Reconcile Inventory's zero-bin empty state.
   * Navigation ownership stays at the page level (WmsOperationsPage), not
   * in this presentational module — same division already used for the
   * create-count API call.
   */
  onSetupBinsClick: () => void;

  /**
   * GH-1109 residual: onboarding coach mark teaching an assigned operator
   * that assignment reserves the work — claim/start is a separate step.
   * Rendered inline above the Receiving cards, never as a modal.
   */
  receiveAssignedWorkSpotlight?: { isDismissed: boolean; dismiss: () => void };
  /** #1164: first-time Opening Inventory count coaching (useSpotlight in the app layer). */
  openingInventorySpotlight?: { isDismissed: boolean; dismiss: () => void };

  /**
   * 4b-2b GRILL-04: canonical opening inventory view from
   * GET /api/v1/wms/opening-inventory/progress. HTTP stays in
   * WmsOperationsPage; this module only renders it.
   */
  openingInventory?: OpeningInventoryCutoverView | null;
  /** Advisory owner/admin gate — the backend cutover service is the authority. */
  canApproveOpeningInventoryCutover?: boolean;
  openingInventoryCutoverSubmitting?: boolean;
  openingInventoryCutoverError?: string | null;
  onApproveOpeningInventoryCutover?: (acceptPhysicalTruth: boolean) => Promise<void>;
};

const STATUS_LABELS: Record<string, {
  label: string;
  color: 'default' | 'primary' | 'success' | 'warning' | 'error';
}> = {
  pending:       { label: 'Available',   color: 'primary' },
  picking:       { label: 'In Progress', color: 'warning' },
  pick_complete: { label: 'Ready to Pack', color: 'success' },
  packing:       { label: 'Packing',     color: 'warning' },
  pack_complete: { label: 'Complete',    color: 'success' },
  cancelled:     { label: 'Cancelled',   color: 'error'   },
};


/**
 * WMS-OPS-OWNER-1A-VISUAL-PARITY-02 — one overview work-card family for the
 * management pipeline board: flex column (content → status → action), same
 * padding/gap/min-height, CTA pinned to the bottom, nothing absolutely placed.
 * minHeight is a shared floor, never a clip: longer content grows.
 */
const OVERVIEW_WORK_CARD_SX = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  minWidth: 0,
  minHeight: 112,
  boxSizing: 'border-box',
  p: '12px 14px',
  m: 0,
  borderRadius: '10px',
  borderWidth: '1px',
  borderStyle: 'solid',
} as const;
const OVERVIEW_WORK_DATA = { 'data-layout': 'compact-work', 'data-size': 'overview-work' } as const;
/** Title wraps safely to at most two lines and never collides with the action row. */
const OVERVIEW_WORK_TITLE_SX = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  overflowWrap: 'anywhere',
} as const;
/** Bottom action row: own row, available card width, wraps rather than squeezes. */
const OVERVIEW_WORK_ACTION_SX = {
  mt: 'auto',
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 0.5,
  minWidth: 0,
} as const;

/** Shared sizing only for clickable board work-task actions. */
const OVERVIEW_WORK_CTA_SX = {
  minHeight: '36px',
  maxWidth: '100%',
  minWidth: 0,
  px: 1.5,
  py: 0.75,
  fontSize: 11,
  lineHeight: 1.5,
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
  boxSizing: 'border-box',
  position: 'static',
  flexShrink: 0,
} as const;

/**
 * PARITY-04 — task-CTA hierarchy by lifecycle state: ongoing/resumable work is
 * the filled primary action; fresh (not started) work is the orange ghost.
 * Same 1px border on both so the shared sizing family is unchanged.
 */
type OverviewWorkCtaEmphasis = 'primary' | 'secondary';
const OVERVIEW_WORK_CTA_EMPHASIS_SX = {
  primary: { ...WMS_TIER1_ACTION_SX, border: '1px solid var(--accent)' },
  secondary: { bgcolor: 'transparent', color: 'var(--accent-text)', border: '1px solid var(--accent-border)' },
} as const;

/**
 * PARITY-02 addendum — persisted completion for ONGOING Put away / Pick / Pack
 * only. One anatomy for all three grains: thin neutral track, accent fill,
 * compact label, inside the content region. Fresh/ready work renders none —
 * the absence of a rail is part of the fresh-work state (no empty 0% bar).
 */
function OverviewWorkProgress({ completed, total, verb }: { completed: number; total: number; verb: string }) {
  const label = `${completed} of ${total} ${verb}`;
  const percent = total > 0 ? Math.min(100, Math.max(0, (completed / total) * 100)) : 0;
  return (
    <Box
      role="progressbar"
      data-progress="active"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={completed}
      aria-valuetext={label}
      sx={{ mt: 0.75, display: 'grid', gap: 0.5, minWidth: 0 }}
    >
      <Box aria-hidden="true" sx={{ height: 4, borderRadius: '100px', bgcolor: 'var(--rule)', overflow: 'hidden' }}>
        <Box sx={{ height: '100%', width: `${percent}%`, borderRadius: '100px', bgcolor: 'var(--accent)' }} />
      </Box>
      <Typography sx={{ fontSize: 11.5, fontWeight: 400, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
        {label}
      </Typography>
    </Box>
  );
}

const BatchCard = memo(function BatchCard({
  batch, onOpenPick, onOpenPack, currentUserId, orderCount, board = false,
}: {
  batch: WmsBatch;
  /** Opens the Pick Brief; the Brief's Start Picking owns any claim. */
  onOpenPick: (batchId: string) => void;
  /** Navigation only; Pack execution owns claim and evidence. */
  onOpenPack: (batchId: string) => void;
  currentUserId?: number | null;
  orderCount?: number;
  /** PARITY-02: rendered inside the management pipeline board. */
  board?: boolean;
}) {
  const isPending = batch.status === 'pending';
  const isPicking = batch.status === 'picking';
  const isPickComplete = batch.status === 'pick_complete';
  const isPacking = batch.status === 'packing';
  const ownsPack = isPacking && currentUserId != null && batch.packed_by === currentUserId;
  const ctaLabel = isPending ? 'Start picking →'
    : isPicking ? 'Continue picking →'
    : isPickComplete ? 'Start packing →'
    : ownsPack ? 'Resume packing →'
    : null;
  const ctaEmphasis: OverviewWorkCtaEmphasis = isPicking || ownsPack ? 'primary' : 'secondary';
  const workload = orderCount != null
    ? `${orderCount} ${orderCount === 1 ? 'order' : 'orders'}`
    : `${batch.total_line_items} ${batch.total_line_items === 1 ? 'line' : 'lines'}`;
  const progress = isPacking ? `${batch.units_packed}/${batch.total_units} packed`
    : isPickComplete ? (batch.pick_completed_at
      ? `Picked ${new Date(batch.pick_completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : 'Picked')
    : `${batch.units_picked}/${batch.total_units} picked`;
  const owner = isPacking ? batch.packer_name : isPicking ? batch.picker_name : null;
  // PARITY-02 — current-user active work: own Pick custody (picking +
  // picked_by) or own Pack custody (packing + packed_by). Nothing else.
  const isCurrent = board && currentUserId != null && (
    (isPicking && batch.picked_by === currentUserId) || ownsPack
  );
  const openFromCta = () => {
    if (isPending || isPicking) onOpenPick(batch.pick_batch_id);
    else if (isPickComplete || ownsPack) onOpenPack(batch.pick_batch_id);
  };

  if (board) {
    return (
      <Box component="article" aria-label={`Batch ${batch.pick_batch_id.slice(0, 8).toUpperCase()}`}
        data-surface="raised"
        data-emphasis={isCurrent ? 'current' : undefined}
        data-work-state={isPicking || isPacking ? 'ongoing' : 'fresh'}
        {...OVERVIEW_WORK_DATA}
        sx={{
          ...OVERVIEW_WORK_CARD_SX,
          bgcolor: isCurrent ? 'var(--accent-ghost)' : 'var(--surface)',
          borderColor: isCurrent ? 'var(--accent-border)' : 'var(--rule)',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ ...OVERVIEW_WORK_TITLE_SX, fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
            Batch <Box component="span">{batch.pick_batch_id.slice(0, 8).toUpperCase()}</Box>
          </Typography>
          <Typography sx={{ mt: 0.5, fontSize: 12, fontWeight: 400, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
            {workload} · {batch.total_units} {batch.total_units === 1 ? 'unit' : 'units'}
            {isPickComplete && ` · ${progress}`}
          </Typography>
          {owner && (
            <Typography sx={{ mt: 0.25, fontSize: 12, fontWeight: 400, color: 'var(--ink-3)', overflowWrap: 'anywhere' }}>
              {isPacking ? 'Packer' : 'Picker'}: {owner}
            </Typography>
          )}
          {isPicking && <OverviewWorkProgress completed={batch.units_picked} total={batch.total_units} verb="picked" />}
          {isPacking && <OverviewWorkProgress completed={batch.units_packed} total={batch.total_units} verb="packed" />}
        </Box>
        {ctaLabel ? (
          <Box sx={OVERVIEW_WORK_ACTION_SX}>
            <Box component="button" type="button" onClick={openFromCta}
              data-size="overview-work-action"
              data-emphasis={ctaEmphasis}
              sx={{
                ...OVERVIEW_WORK_CTA_EMPHASIS_SX[ctaEmphasis], fontFamily: 'inherit',
                fontWeight: 600, borderRadius: '6px',
                cursor: 'pointer',
                ...OVERVIEW_WORK_CTA_SX,
                '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 },
                '&:hover': { opacity: 0.88 },
              }}
            >{ctaLabel}</Box>
          </Box>
        ) : isPacking ? (
          <Box sx={OVERVIEW_WORK_ACTION_SX}>
            <Typography sx={{ fontSize: 12, fontWeight: 400, color: 'var(--ink-2)' }}>
              Packing in progress
            </Typography>
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <Box component="article" aria-label={`Batch ${batch.pick_batch_id.slice(0, 8).toUpperCase()}`}
      data-surface="raised"
      sx={{
      bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '10px',
      px: 2, py: 1.5, mb: 1,
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5,
    }}>
      <Box sx={{ flex: '1 1 220px', minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
          Batch <Box component="span">{batch.pick_batch_id.slice(0, 8).toUpperCase()}</Box>
        </Typography>
        <Typography sx={{ mt: 0.5, fontSize: 12, fontWeight: 400, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
          {workload} · {batch.total_units} {batch.total_units === 1 ? 'unit' : 'units'} · {progress}
        </Typography>
        {owner && (
          <Typography sx={{ mt: 0.5, fontSize: 12, fontWeight: 400, color: 'var(--ink-3)' }}>
            {isPacking ? 'Packer' : 'Picker'}: {owner}
          </Typography>
        )}
      </Box>
      {ctaLabel ? (
        <Box component="button" type="button"
          onClick={openFromCta}
          sx={{
            ...WMS_TIER1_ACTION_SX, fontFamily: 'inherit',
            fontSize: 11, fontWeight: 600, border: 'none', borderRadius: '6px',
            px: 1.25, py: 0.5, cursor: 'pointer',
            '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 },
            '&:hover': { opacity: 0.88 },
          }}
        >{ctaLabel}</Box>
      ) : isPacking ? (
        <Typography sx={{ fontSize: 12, fontWeight: 400, color: 'var(--ink-2)' }}>
          Packing in progress
        </Typography>
      ) : null}
    </Box>
  );
});

/**
 * STOW TASK CARD
 * --------------
 * Displays a pending stow task — stock that needs to be put away.
 * Triggered by: inbound receive close, cancelled order mid-pick.
 */
/**
 * STOW-LIFECYCLE-02 — assignment status copy.
 * Visibility filtering (WmsModuleFT2Inner) already ensures an operator only
 * ever receives a card they may act on; this only decides the exact wording.
 */
function describeStowAssignment(task: WmsStowTask, currentUserId?: number | null): string {
  if (task.status === 'in_progress') return 'In progress';
  if (task.assigned_operator_id === null) return 'First one to claim';
  if (task.assigned_operator_id === currentUserId) return 'Assigned to you';
  return `Assigned to ${task.assigned_operator_name ?? 'operator'}`;
}

const StowTaskCard = memo(function StowTaskCard({
  task,
  currentUserId,
  canAssignStow,
  onOpen,
  onAssignRequest,
  onMakeFirstToClaim,
  board = false,
}: {
  task: WmsStowTask;
  currentUserId?: number | null;
  /** Advisory only — backend wms:stow:assign remains authoritative (see J). */
  canAssignStow?: boolean;
  onOpen: (taskId: string) => void;
  onAssignRequest?: (task: WmsStowTask) => void;
  onMakeFirstToClaim?: (task: WmsStowTask) => void;
  /** PARITY-02: rendered inside the management pipeline board. */
  board?: boolean;
}) {
  const triggerLabel = task.trigger === 'order_cancelled_mid_pick' ? 'Cancelled pick' : 'Inbound receive';

  // STOW-CARD-CTA-01 — the card is an entry point, never a confirm.
  //
  // Previously an in_progress task took a direct onConfirmStow(id) branch
  // that passed neither quantity nor LSU. Inbound stow survived it only via
  // the legacy no-LSU fallback in confirmStow; order_cancelled_mid_pick
  // hard-requires an LSU scan (stow.service.ts) and could never complete.
  // Once claimed, a task had no route back into the scan session at all.
  //
  // StowSessionPage already loads both pending and in_progress tasks, and
  // the session-entry callback only writes a URL param, so a single route
  // is safe for every status. The claim fires inside the session at the
  // location-scan step, which is why the old 'Claim & stow' label was
  // describing the session, not this button.
  const isClaimed = task.status === 'in_progress';

  // STOW-LIFECYCLE-02 — an operator must never see a Start button for a task
  // assigned to somebody else. Visibility filtering keeps this card off an
  // operator's list entirely for that case; owner/admin may still see it (to
  // manage assignment) but gets no execution CTA either — assignment is not
  // a takeover path.
  const assignedToOther =
    task.status === 'pending' &&
    task.assigned_operator_id !== null &&
    task.assigned_operator_id !== currentUserId;

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const showMenu = Boolean(canAssignStow) && task.status === 'pending';
  // PARITY-02 — current-user active work: own claimed in-progress stow. On the
  // board, accent marks only that; elsewhere the card keeps its prior styling.
  const isCurrent = board && currentUserId != null && isClaimed && task.claimed_by === currentUserId;
  const accentOn = !board || isCurrent;
  const menuNode = showMenu ? (
      <>
        <IconButton
          size="small"
          aria-label="Stow task options"
          data-testid={`stow-task-menu-${task.stow_task_id}`}
          onClick={(e) => setMenuAnchor(e.currentTarget)}
          sx={{ flexShrink: 0, ml: 0.5 }}
        >
          <MoreVertical size={16} />
        </IconButton>
        <Menu
          anchorEl={menuAnchor}
          open={Boolean(menuAnchor)}
          onClose={() => setMenuAnchor(null)}
        >
          {task.assigned_operator_id === null ? (
            <MenuItem
              onClick={() => {
                setMenuAnchor(null);
                onAssignRequest?.(task);
              }}
            >
              Assign to…
            </MenuItem>
          ) : [
            <MenuItem
              key="reassign"
              onClick={() => {
                setMenuAnchor(null);
                onAssignRequest?.(task);
              }}
            >
              Reassign…
            </MenuItem>,
            <MenuItem
              key="unassign"
              onClick={() => {
                setMenuAnchor(null);
                onMakeFirstToClaim?.(task);
              }}
            >
              Make first one to claim
            </MenuItem>,
          ]}
        </Menu>
      </>
  ) : null;

  if (board) {
    return (
      <Box
        data-surface="raised"
        data-emphasis={isCurrent ? 'current' : undefined}
        data-work-state={isClaimed ? 'ongoing' : 'fresh'}
        {...OVERVIEW_WORK_DATA}
        sx={{
          ...OVERVIEW_WORK_CARD_SX,
          bgcolor: isCurrent ? 'var(--accent-ghost)' : 'var(--surface)',
          borderColor: isCurrent ? 'var(--accent-border)' : 'var(--rule)',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, minWidth: 0 }}>
            <Typography sx={{ ...OVERVIEW_WORK_TITLE_SX, flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
              {task.product_title ?? task.variant_title ?? task.sku ?? task.lasyncro_variant_id.slice(0, 8).toUpperCase()}
            </Typography>
            {menuNode}
          </Box>
          <Typography sx={{ mt: 0.5, fontSize: 12, fontWeight: 400, color: 'var(--ink-3)', overflowWrap: 'anywhere' }}>
            {[task.sku, `Qty ${task.quantity}`, task.location_code ?? 'No location', triggerLabel].filter(Boolean).join(' · ')}
          </Typography>
          {isClaimed && <OverviewWorkProgress completed={task.quantity_placed} total={task.quantity} verb="put away" />}
          <Box sx={{ mt: 0.75, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            <Box sx={{ px: 1, py: 0.25, bgcolor: accentOn ? 'var(--accent-ghost)' : 'var(--bg)', border: '0.5px solid', borderColor: accentOn ? 'var(--accent-border)' : 'var(--rule-2)', borderRadius: '100px' }}>
              <Typography sx={{ fontSize: 10.5, fontWeight: 600, color: accentOn ? 'var(--accent)' : 'var(--ink-2)', letterSpacing: '0.04em' }}>
                {describeStowAssignment(task, currentUserId)}
              </Typography>
            </Box>
          </Box>
        </Box>
        {!assignedToOther && (
          <Box sx={OVERVIEW_WORK_ACTION_SX}>
            <Box
              component="button"
              onClick={() => onOpen(task.stow_task_id)}
              data-size="overview-work-action"
              data-emphasis={isClaimed ? 'primary' : 'secondary'}
              sx={{
                ...OVERVIEW_WORK_CTA_EMPHASIS_SX[isClaimed ? 'primary' : 'secondary'], fontFamily: 'inherit',
                fontWeight: 600, borderRadius: '6px',
                cursor: 'pointer',
                ...OVERVIEW_WORK_CTA_SX,
                '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 },
                '&:hover': { opacity: 0.88 },
              }}
            >
              {isClaimed ? 'Resume stow →' : 'Start stow →'}
            </Box>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box
      data-surface="raised"
      sx={{
      bgcolor: 'var(--surface)',
      border: '1px solid',
      borderColor: 'var(--accent-border)',
      borderRadius: '14px',
      p: '18px 20px',
      mb: 1.5,
    }}>
      {/* HEADER */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.25 }}>
        {task.image_url ? (
          <Box component="img" src={task.image_url} alt="" sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: '8px', flexShrink: 0 }} />
        ) : (
          <Box sx={{ width: 40, height: 40, borderRadius: '8px', bgcolor: accentOn ? 'var(--accent-ghost)' : 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Package size={18} color={accentOn ? 'var(--accent)' : 'var(--ink-3)'} />
          </Box>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {task.product_title ?? task.variant_title ?? task.sku ?? task.lasyncro_variant_id.slice(0, 8).toUpperCase()}
          </Typography>
          {task.sku && (
            <Typography sx={{ fontSize: 11.5, fontWeight: 400, color: 'var(--ink-3)', mt: 0.25 }}>{task.sku}</Typography>
          )}
        </Box>
        <Box sx={{ px: 1, py: 0.375, bgcolor: accentOn ? 'var(--accent-ghost)' : 'var(--bg)', border: '0.5px solid', borderColor: accentOn ? 'var(--accent-border)' : 'var(--rule-2)', borderRadius: '100px', flexShrink: 0 }}>
          <Typography sx={{ fontSize: 10.5, fontWeight: 600, color: accentOn ? 'var(--accent)' : 'var(--ink-2)', letterSpacing: '0.04em' }}>
            {describeStowAssignment(task, currentUserId)}
          </Typography>
        </Box>

        {menuNode}
      </Box>

      {/* METADATA */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: 12, fontWeight: 400, color: 'var(--ink-3)' }}>Qty: {task.quantity}</Typography>
        <Typography sx={{ fontSize: 12, fontWeight: 400, color: 'var(--ink-3)' }}>Location: {task.location_code ?? 'Unassigned'}</Typography>
        <Typography sx={{ fontSize: 12, fontWeight: 400, color: 'var(--ink-3)' }}>Source: {triggerLabel}</Typography>
      </Box>

      {/* CTA — withheld for a task assigned to somebody else (see J: never a
          silent takeover path). Owner/admin manage such a task only via ⋮. */}
      {!assignedToOther && (
        <Box
          component="button"
          onClick={() => onOpen(task.stow_task_id)}
          sx={{
            width: '100%', fontSize: 12, fontWeight: 600,
            color: 'var(--accent-ink)', bgcolor: 'var(--accent)',
            border: 'none', borderRadius: '6px',
            py: 1.25, cursor: 'pointer',
            '&:hover': { opacity: 0.88 },
            transition: 'opacity 0.15s ease',
          }}
        >
          {isClaimed ? 'Resume stow →' : 'Start stow →'}
        </Box>
      )}
    </Box>
  );
});

export type WmsOpenReceiveJob = {
  receive_job_id: string;
  status: string;
  assigned_operator_id: number | null;
  assigned_operator_name?: string | null;
  started_at?: string | null;
  closed_at?: string | null;
  supplier_name: string;
  po_id: string;
  po_number?: number | null;
  total_units: number;
  total_variants: number;
};

/**
 * RECEIVE WORK CARD
 * -----------------
 * GH-1143 RECEIVE-REASSIGN-UI-01 — own assigned work keeps the existing
 * Open/Resume execution CTA unchanged. A pending/unstarted job assigned to
 * another operator (visible only when canReassignReceive, via the
 * visibility projection in WmsModuleFT2Inner) gets no execution CTA at all
 * — only a contextual ⋮ → Reassign… management affordance, mirroring
 * STOW-LIFECYCLE-02's StowTaskCard menu.
 */
const ReceiveWorkCard = memo(function ReceiveWorkCard({
  job,
  isOwnJob,
  canManageAssignment,
  onOpen,
  onReassignRequest,
  board = false,
}: {
  job: WmsOpenReceiveJob;
  isOwnJob: boolean;
  canManageAssignment: boolean;
  onOpen: (jobId: string) => void;
  onReassignRequest?: (job: WmsOpenReceiveJob) => void;
  /** PARITY-02: rendered inside the management pipeline board. */
  board?: boolean;
}) {
  const started = job.status === 'in_progress' || Boolean(job.started_at);
  // PARITY-02 — current-user active work: started_at != null on a job assigned
  // to the current user (isOwnJob; an unassigned job is never "own").
  const isCurrent = board && isOwnJob && job.assigned_operator_id !== null && job.started_at != null;
  const showAssignmentMenu =
    canManageAssignment &&
    job.status === 'pending' &&
    !job.started_at &&
    !job.closed_at;
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const menuNode = showAssignmentMenu ? (
      <>
        <IconButton
          size="small"
          aria-label="Receive job options"
          data-testid={`receive-job-menu-${job.receive_job_id}`}
          onClick={(e) => setMenuAnchor(e.currentTarget)}
          sx={{ flexShrink: 0 }}
        >
          <MoreVertical size={16} />
        </IconButton>
        <Menu
          anchorEl={menuAnchor}
          open={Boolean(menuAnchor)}
          onClose={() => setMenuAnchor(null)}
        >
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              onReassignRequest?.(job);
            }}
          >
            Reassign…
          </MenuItem>
        </Menu>
      </>
  ) : null;
  if (board) {
    const ownership = isOwnJob ? 'Assigned to you' : `Assigned to ${job.assigned_operator_name ?? 'another operator'}`;
    const lifecycle = isOwnJob && started ? 'In progress' : 'Not started';
    // PARITY-02 compact card: identity → one metadata line → ownership/state →
    // one action. "Continue receiving shipment" is dropped: it restated the
    // Resume receive CTA. The not-started guidance is kept (claim is a
    // distinct step from assignment, GH-1109).
    return (
      <Box
        data-testid={`receive-work-card-${job.receive_job_id}`}
        data-surface="raised"
        data-emphasis={isCurrent ? 'current' : undefined}
        {...OVERVIEW_WORK_DATA}
        sx={{
          ...OVERVIEW_WORK_CARD_SX,
          bgcolor: isCurrent ? 'var(--accent-ghost)' : 'var(--surface)',
          borderColor: isCurrent ? 'var(--accent-border)' : 'var(--rule)',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          {/* WMS-OPS-MODAL-PARITY-01 — ⋮ sits top-right of the identity row,
              matching the Put away card; the CTA stays in the action row. */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, minWidth: 0 }}>
            <Typography sx={{ ...OVERVIEW_WORK_TITLE_SX, flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
              {job.supplier_name}
            </Typography>
            {menuNode}
          </Box>
          <Typography sx={{ mt: 0.25, fontSize: 12, color: 'var(--ink-3)', overflowWrap: 'anywhere' }}>
            {job.po_number == null ? 'PO reference unavailable' : `PO-${job.po_number}`}
            {' · '}
            {job.total_variants} {job.total_variants === 1 ? 'product' : 'products'}
            {' · '}
            {job.total_units} {job.total_units === 1 ? 'unit' : 'units'}
          </Typography>
          <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 0.5, minWidth: 0 }}>
            {[ownership, lifecycle].map((label) => (
              <Box component="span" key={label} sx={{
                px: 0.75, py: 0.25, borderRadius: '6px',
                border: '1px solid var(--rule-2)', bgcolor: 'var(--bg)',
                fontSize: 11.5, fontWeight: 500, color: 'var(--ink-2)', overflowWrap: 'anywhere',
              }}>
                {label}
              </Box>
            ))}
          </Box>
          {!(isOwnJob && started) && (
            <Typography sx={{ mt: 0.25, fontSize: 11.5, color: 'var(--ink-4)', overflowWrap: 'anywhere' }}>
              {isOwnJob ? 'Review shipment and claim Receive' : 'Pending — manage assignment'}
            </Typography>
          )}
        </Box>
        {isOwnJob && (
          <Box sx={OVERVIEW_WORK_ACTION_SX}>
            <Button
              variant={started ? 'contained' : 'outlined'}
              disableElevation
              size="small"
              onClick={() => onOpen(job.receive_job_id)}
              data-size="overview-work-action"
              data-emphasis={started ? 'primary' : 'secondary'}
              sx={{
                ...OVERVIEW_WORK_CTA_SX,
                ...(started
                  ? OVERVIEW_WORK_CTA_EMPHASIS_SX.primary
                  : { borderColor: 'var(--rule)', color: 'var(--accent-text)' }),
                borderRadius: '6px',
                fontWeight: 600,
              }}
            >
              {started ? 'Resume receive →' : 'Open receive →'}
            </Button>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box
      data-testid={`receive-work-card-${job.receive_job_id}`}
      data-surface="raised"
      sx={{
        border: '1px solid var(--rule)',
        borderRadius: '10px',
        bgcolor: 'var(--surface)',
        px: 2,
        py: 1.5,
        mb: 1,
        '&:last-child': { mb: 0 },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
            {job.supplier_name}
          </Typography>

          <Typography sx={{ mt: 0.25, fontSize: 12, color: 'var(--ink-3)' }}>
            {job.po_number == null ? 'PO reference unavailable' : `PO-${job.po_number}`}
            {' · '}
            {job.total_variants} {job.total_variants === 1 ? 'product' : 'products'}
            {' · '}
            {job.total_units} {job.total_units === 1 ? 'unit' : 'units'}
          </Typography>

          <Typography sx={{ mt: 0.75, fontSize: 11.5, fontWeight: 500, color: 'var(--ink-2)' }}>
            {isOwnJob
              ? (started ? 'Assigned to you · In progress' : 'Assigned to you · Not started')
              : `Assigned to ${job.assigned_operator_name ?? 'another operator'} · Not started`}
          </Typography>

          <Typography sx={{ mt: 0.25, fontSize: 11.5, color: 'var(--ink-4)' }}>
            {isOwnJob
              ? (started ? 'Continue receiving shipment' : 'Review shipment and claim Receive')
              : 'Pending — manage assignment'}
          </Typography>
        </Box>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            flexShrink: 0,
          }}
        >
          {isOwnJob && (
            <Button
              variant="outlined"
              size="small"
              onClick={() => onOpen(job.receive_job_id)}
              sx={{
                flexShrink: 0,
                borderColor: 'var(--rule)',
                color: 'var(--accent-text)',
                borderRadius: '6px',
                fontWeight: 600,
              }}
            >
              {started ? 'Resume receive' : 'Open receive'}
            </Button>
          )}

          {menuNode}
        </Box>
      </Box>
    </Box>
  );
});

export interface PackFreeScanLineItem {
  lasyncro_line_item_id: string;
  lasyncro_variant_id: string;
  product_title: string;
  quantity: number;
  image_url: string | null;
  sku: string | null;
  packed_quantity: number;
  packable_quantity: number;
  pack_scanned: boolean;
  has_tracked_unit: boolean;
}

/** Shape of POST /wms/pack/free-scan LSU- happy-path response (WEB-PACK-02). */
export interface PackFreeScanResult {
  type: 'unit_resolved';
  pick_batch_id: string;
  lasyncro_unit_id: string;
  lasyncro_order_id: string;
  order_complete: boolean;
  auto_claimed: boolean;
  has_carrier_label: boolean;
  variant: { variant_title: string; sku: string | null; image_url: string | null } | null;
  order: {
    lasyncro_order_id: string;
    external_order_id: string;
    wms_barcode: string | null;
    total_price: number;
    currency: string;
    shipping_name: string | null;
    shipping_address1: string | null;
    shipping_city: string | null;
    shipping_zip: string | null;
    shipping_country_code: string | null;
  } | null;
  line_items: {
    lasyncro_line_item_id: string;
    lasyncro_variant_id: string;
    product_title: string;
    quantity: number;
    image_url: string | null;
    sku: string | null;
    packed_quantity: number;
    packable_quantity: number;
    pack_scanned: boolean;
    has_tracked_unit: boolean;
  }[];
}

export type PackFreeScanApiResponse =
  | PackFreeScanResult
  | { type: 'packed'; lasyncro_order_id: string; external_order_id: string; pick_batch_id: string; batch_complete: boolean }
  | { type: 'return'; lasyncro_order_id: string; returnJobId: string; status: string; isNew: boolean; claimedByOther: boolean }
  | { error: string; message: string };

const CountingTaskCard = memo(function CountingTaskCard({
  task,
  onOpen,
  currentUserId,
  canReassignCount,
  onReassignRequest,
}: {
  task: CountingTask;
  onOpen: (task: CountingTask) => void;
  currentUserId?: number | null;
  /** RECOUNT-CLAIM-ABANDONED-131: advisory only — backend is authoritative. */
  canReassignCount?: boolean;
  onReassignRequest?: (task: CountingTask) => void;
}) {
  const continuing =
    task.status === 'claimed' || task.status === 'counting';

  // RECOUNT-RESUME-POSITION-72: operators may only start/resume work they own.
  // Owner/admin takeover or reassignment must be explicit.
  const assignedToOther =
    task.status === 'dispatched' &&
    task.assigned_to !== null &&
    task.assigned_to !== currentUserId;

  const claimedByOther =
    continuing &&
    task.claimed_by !== null &&
    task.claimed_by !== currentUserId;

  const blockedByOwnership = assignedToOther || claimedByOther;

  // RECOUNT-CLAIM-ABANDONED-131: only on another operator's active
  // (claimed/counting) claim — never dispatched, never the viewer's own
  // task, never manual_review/committed (both fall outside `continuing`).
  const showReassign = Boolean(canReassignCount) && claimedByOther;

  return (
    <Box sx={{
      bgcolor: 'var(--surface)',
      border: '1px solid var(--rule)',
      borderRadius: '12px',
      p: '16px 18px',
      mb: 1.25,
      display: 'flex',
      alignItems: 'center',
      gap: 2,
    }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--ink)',
        }}>
          {task.label}
        </Typography>

        <Typography sx={{
          fontSize: 12,
          fontWeight: 400,
          color: 'var(--ink-3)',
          mt: 0.375,
        }}>
          {task.line_count} checks
          {task.counted_count > 0
            ? ` · ${task.counted_count} counted`
            : ''}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, flexShrink: 0 }}>
        <Button
          variant="contained"
          size="small"
          disabled={blockedByOwnership}
          onClick={() => onOpen(task)}
          sx={{ ...WMS_TIER1_ACTION_SX, flexShrink: 0 }}
        >
          {assignedToOther
            ? 'Assigned'
            : claimedByOther
            ? 'Claimed'
            : continuing
            ? 'Continue'
            : 'Start count'}
        </Button>

        {showReassign && (
          <Button
            variant="outlined"
            size="small"
            onClick={() => onReassignRequest?.(task)}
            sx={{
              borderColor: 'var(--rule)',
              color: 'var(--ink)',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: 11,
              px: 1,
              py: 0.25,
              minWidth: 'auto',
            }}
          >
            Reassign count
          </Button>
        )}
      </Box>
    </Box>
  );
});

function WorkQueueFamily({
  title,
  summary,
  expanded,
  onToggle,
  children,
  regionLabel,
  sectionId,
}: {
  title: string;
  summary: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  regionLabel?: string;
  sectionId?: string;
}) {
  return (
    <Box
      id={sectionId}
      component={regionLabel ? 'section' : 'div'}
      aria-label={regionLabel}
      sx={{ border: '1px solid var(--rule)', borderRadius: '8px', overflow: 'hidden' }}
    >
      <Box
        component="button"
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2,
          py: 1.5,
          border: 0,
          bgcolor: 'transparent',
          color: 'var(--ink)',
          font: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
          '&:hover': { bgcolor: 'var(--bg-2)' },
          '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: -2 },
        }}
      >
        <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
          {title}
        </Typography>
        <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
          {summary}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <ChevronDown
          size={16}
          color="var(--ink-4)"
          style={{
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 150ms ease',
          }}
        />
      </Box>
      <Collapse in={expanded}>
        <Box sx={{ px: 2, pb: 2 }}>
          {children}
        </Box>
      </Collapse>
    </Box>
  );
}

export type OperationsLifecycleStage =
  | 'receive'
  | 'put-away'
  | 'pick'
  | 'pack'
  | 'ship';

/**
 * WMS-OPS-LIFECYCLE-IA-02 — the lifecycle stage IS the queue. One physical
 * lifecycle representation: no separate flow navigation, no separate Work
 * Queue, no scroll-derived active stage. Order is physical order.
 */
const OPERATIONS_LIFECYCLE_STAGES: ReadonlyArray<{
  stage: OperationsLifecycleStage;
  label: string;
}> = [
  { stage: 'receive', label: 'Receive' },
  { stage: 'put-away', label: 'Put away' },
  { stage: 'pick', label: 'Pick' },
  { stage: 'pack', label: 'Pack' },
  { stage: 'ship', label: 'Ship' },
];

/** Overview stages show a bounded preview; View all N opens the full stage list in a modal. */
const STAGE_PREVIEW_LIMIT = 3;
/** WMS-OPS-MODAL-PARITY-01 — full stage task-list modal titles (Ship has no work list). */
const STAGE_LIST_COPY: Record<
  Exclude<OperationsLifecycleStage, 'ship'>,
  { title: string; singular: string; plural: string }
> = {
  receive: {
    title: 'Receive',
    singular: 'receive job',
    plural: 'receive jobs',
  },
  'put-away': {
    title: 'Put away',
    singular: 'put-away task',
    plural: 'put-away tasks',
  },
  pick: {
    title: 'Pick',
    singular: 'pick batch',
    plural: 'pick batches',
  },
  pack: {
    title: 'Pack',
    singular: 'pack batch',
    plural: 'pack batches',
  },
};
/** Operator Up next is a short list of the next actionable work, not a queue. */
const OPERATOR_UP_NEXT_LIMIT = 5;

/**
 * Stage count grain (the region's accessible description is the count seam):
 * Receive counts jobs, Put away stow tasks, Pick batches, and Pack batch/group
 * contexts — never contained orders. This is overview grouping only; Pack
 * execution remains order/parcel authority. Ship is structural: no count.
 */
function describeStageCount(stage: OperationsLifecycleStage, count: number): string {
  switch (stage) {
    case 'receive': return `${count} receive ${count === 1 ? 'job' : 'jobs'}`;
    case 'put-away': return `${count} put-away ${count === 1 ? 'task' : 'tasks'}`;
    case 'pick': return `${count} pick ${count === 1 ? 'batch' : 'batches'}`;
    case 'pack': return `${count} pack ${count === 1 ? 'batch' : 'batches'}`;
    case 'ship': return 'Not tracked in Operations yet';
  }
}

/** WMS-OPS-OWNER-1A-VISUAL-PARITY-02 — canonical SR-only text (px strings: MUI reads numeric 1 as 100%). */
const SR_ONLY_SX = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  p: 0,
  m: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

const VISUALLY_HIDDEN_SX = {
  position: 'absolute',
  width: 1,
  height: 1,
  p: 0,
  m: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

const STAGE_TEXT_ACTION_SX = {
  border: 0,
  bgcolor: 'transparent',
  color: 'var(--accent-text)',
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  p: 0,
  cursor: 'pointer',
  '&:hover': { opacity: 0.75 },
  '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 },
} as const;

/**
 * One lifecycle stage. Module-level so its DOM node survives parent renders
 * (Ops Console open/close, task-list modal) — never remounted to change state.
 * Stages never own a scroll container; the page owns ordinary scrolling.
 */
function LifecycleStageRegion({
  label,
  count,
  description,
  lead,
  items,
  empty,
  onViewAll,
}: {
  label: string;
  /** null = structural stage (Ship): visible "—", no numeric work count. */
  count: number | null;
  description: string;
  /** Stage-scoped guidance shown above the work (not counted as work). */
  lead?: ReactNode;
  items: ReactNode[];
  empty?: ReactNode;
  onViewAll?: () => void;
}) {
  const descriptionId = useId();
  const visibleItems = items.slice(0, STAGE_PREVIEW_LIMIT);
  const canViewAll = items.length > STAGE_PREVIEW_LIMIT && onViewAll;

  return (
    <Box
      component="section"
      role="region"
      aria-label={label}
      aria-describedby={descriptionId}
      data-surface="canvas"
      sx={{
        // WMS-OPS-OWNER-1A-ALIGNMENT — a column of the shared pipeline board,
        // not a floating card: the board owns surface/border/radius; stages
        // are divided by internal rules only.
        position: 'relative',
        minWidth: 0,
        // PARITY-04: flex column so the stage body (Ship empty state) can fill it.
        display: 'flex',
        flexDirection: 'column',
        p: '14px',
        '&:not(:last-of-type)': { borderRight: '1px solid var(--rule)' },
      }}
    >
      <Box component="span" id={descriptionId} sx={VISUALLY_HIDDEN_SX}>
        {description}
      </Box>

      {/* PARITY-02 — [STAGE NAME] … [COUNT]: compact uppercase name, dominant
          32px count opposite it; 0 and Ship's "—" keep the size but recede. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
        <Typography
          component="h2"
          sx={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}
        >
          {label}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography
          component="span"
          aria-hidden="true"
          sx={{
            fontSize: 32,
            fontWeight: 500,
            lineHeight: 1,
            letterSpacing: '-0.02em',
            color: count === null || count === 0 ? 'var(--ink-4)' : 'var(--ink)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {count === null ? '—' : count}
        </Typography>
      </Box>

      {lead}

      {visibleItems.length > 0 ? (
        <Box sx={{ display: 'grid', rowGap: 1, minWidth: 0 }}>
          {visibleItems}
        </Box>
      ) : empty}

      {canViewAll && (
        <Box component="button" type="button" onClick={onViewAll} sx={{ ...STAGE_TEXT_ACTION_SX, mt: 0.5, alignSelf: 'flex-start' }}>
          {`View all ${items.length}`}
        </Box>
      )}
    </Box>
  );
}

const NEEDS_ATTENTION_TONE_INK: Record<WmsNeedsAttentionRow['tone'], string> = {
  critical: 'var(--critical-ink)',
  warning: 'var(--warning-ink)',
  info: 'var(--accent)',
};

/** Visually hidden but announced (px strings: MUI reads numeric 1 as 100%). */
const NEEDS_ATTENTION_SR_ONLY_SX = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

/** Rail cell: 18px gutter, separators are CSS borders (never DOM nodes). */
const NEEDS_ATTENTION_CELL_SX = {
  display: 'flex',
  alignItems: 'center',
  gap: 1.25,
  minWidth: 0,
  px: '18px',
  py: { xs: 1.25, md: 0 },
} as const;

/**
 * WMS-OPS-NEEDS-ATTENTION-01 — bounded overview rail (Owner/Admin 1a). Renders
 * the app-supplied canonical NOW projection verbatim: no allowlist, ranking,
 * grouping, routes, alert lifecycle controls or local alert state live here.
 * Each alert cell has one explicit action control; no cell is clickable.
 *
 * md+: one 48px row — [label + count] [alert]×≤3 [History].
 * <md: two-column grid — [label + count | History], then one full-width
 * row per alert. Never horizontally overflows; no cell is hidden for layout.
 */
function NeedsAttentionStrip({
  attention,
  onAction,
  onOpenHistory,
  onOpenAll,
}: {
  attention: WmsNeedsAttention;
  onAction?: (rowId: string) => void;
  onOpenHistory?: () => void;
  onOpenAll?: () => void;
}) {
  const headingId = useId();
  const separator = '1px solid var(--rule)';
  const overflowCount = attention.overflowCount ?? 0;
  const showMore = overflowCount > 0 && !!onOpenAll;
  return (
    <Box
      component="section"
      role="region"
      aria-labelledby={headingId}
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr) auto',
          md: `auto repeat(${attention.rows.length}, minmax(0, 1fr))${showMore ? ' auto' : ''} auto`,
        },
        alignItems: 'stretch',
        minHeight: { md: 48 },
        border: separator,
        borderRadius: '12px',
        bgcolor: 'var(--surface)',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ ...NEEDS_ATTENTION_CELL_SX, gap: 1, gridRow: { xs: 1, md: 'auto' }, gridColumn: { xs: 1, md: 'auto' }, borderRight: { md: separator } }}>
        <Typography
          id={headingId}
          component="h2"
          sx={{ fontSize: 11, fontWeight: 500, lineHeight: 1, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--accent-text)', whiteSpace: 'nowrap' }}
        >
          Needs attention
        </Typography>
        <Typography component="span" sx={{ fontSize: 11, fontWeight: 500, lineHeight: 1, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
          {attention.total}
        </Typography>
      </Box>

      <Box component="ul" role="list" sx={{ display: 'contents', listStyle: 'none', m: 0, p: 0 }}>
        {attention.rows.map((row, index) => (
          <Box
            component="li"
            key={row.id}
            sx={{
              ...NEEDS_ATTENTION_CELL_SX,
              justifyContent: 'space-between',
              gridColumn: { xs: '1 / -1', md: 'auto' },
              borderTop: { xs: separator, md: 0 },
              borderRight: { md: index < attention.rows.length - 1 || showMore || onOpenHistory ? separator : 0 },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.125, minWidth: 0 }}>
              <Box
                component="span"
                aria-hidden="true"
                sx={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, bgcolor: NEEDS_ATTENTION_TONE_INK[row.tone] }}
              />
              <Typography sx={{ minWidth: 0, fontSize: 13, lineHeight: 1.2, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.title}
              </Typography>
              {row.a11yLabel && <Box component="span" sx={NEEDS_ATTENTION_SR_ONLY_SX}>{row.a11yLabel}</Box>}
            </Box>
            <Box
              component="button"
              type="button"
              onClick={() => onAction?.(row.id)}
              sx={{ ...STAGE_TEXT_ACTION_SX, fontWeight: 500, lineHeight: 1, flexShrink: 0, whiteSpace: 'nowrap' }}
            >
              {row.actionLabel} <span aria-hidden="true">→</span>
            </Box>
          </Box>
        ))}
      </Box>

      {/* PARITY-05 — ghost "{n} more" between the last visible row and History. */}
      {showMore && (
        <Box
          sx={{
            ...NEEDS_ATTENTION_CELL_SX,
            gridColumn: { xs: '1 / -1', md: 'auto' },
            borderTop: { xs: separator, md: 0 },
            borderRight: { md: onOpenHistory ? separator : 0 },
          }}
        >
          <Box
            component="button"
            type="button"
            data-emphasis="secondary"
            onClick={onOpenAll}
            sx={{
              ...STAGE_TEXT_ACTION_SX,
              fontWeight: 500,
              lineHeight: 1,
              whiteSpace: 'nowrap',
              px: 1,
              py: 0.5,
              border: '1px solid var(--accent-border)',
              borderRadius: '6px',
              '&:hover': { bgcolor: 'var(--accent-ghost)' },
            }}
          >
            {`${overflowCount} more`}
          </Box>
        </Box>
      )}

      {onOpenHistory && (
        <Box sx={{ ...NEEDS_ATTENTION_CELL_SX, gridRow: { xs: 1, md: 'auto' }, gridColumn: { xs: 2, md: 'auto' } }}>
          <Box
            component="button"
            type="button"
            onClick={onOpenHistory}
            sx={{ ...STAGE_TEXT_ACTION_SX, fontWeight: 500, lineHeight: 1, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}
          >
            History
          </Box>
        </Box>
      )}
    </Box>
  );
}

/** Small empty-state line inside a stage; never a teaching panel. */
function StageEmpty({ children }: { children: ReactNode }) {
  return (
    <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
      {children}
    </Typography>
  );
}

/**
 * Operations overview Quick Scan resolution — POST /api/v1/wms/scan/resolve.
 * Read-only: it identifies what was scanned and never creates warehouse
 * evidence. Shapes mirror the resolver's response branches.
 */
export type OperationsScanResolution =
  | { type: 'location'; location_code: string; total_variants: number; total_units: number; pending_stow_tasks: number }
  | { type: 'product'; variant_title: string | null; sku: string | null; stage: string; total_on_hand: number; total_available: number }
  | { type: 'invoice_scan' | 'order'; external_order_id: string; active_batch: { pick_batch_id: string; status: string } | null }
  | { type?: undefined };

const SCAN_STAGE_LABELS: Record<string, string> = {
  receiving: 'Receive',
  received: 'Received',
  stow_pending: 'Waiting to put away',
  stowing: 'Putting away',
  picking: 'Pick',
  pick_complete: 'Ready to pack',
  packing: 'Pack',
  stowed: 'In stock',
};

function describeScanResolution(result: OperationsScanResolution): string {
  switch (result.type) {
    case 'location':
      return `Bin ${result.location_code} · ${result.total_units} ${result.total_units === 1 ? 'unit' : 'units'} · ${result.total_variants} ${result.total_variants === 1 ? 'product' : 'products'}`;
    case 'product': {
      const name = result.variant_title ?? result.sku ?? 'Product';
      const stage = SCAN_STAGE_LABELS[result.stage];
      return `${name}${result.sku && result.variant_title ? ` · ${result.sku}` : ''} · ${result.total_on_hand} on hand${stage ? ` · ${stage}` : ''}`;
    }
    case 'invoice_scan':
    case 'order': {
      const batch = result.active_batch;
      const batchStatus = batch ? STATUS_LABELS[batch.status]?.label ?? batch.status : null;
      return `Order #${result.external_order_id}${batch ? ` · Batch ${batch.pick_batch_id.slice(0, 8).toUpperCase()} · ${batchStatus}` : ''}`;
    }
    default:
      return 'Scanned — no warehouse details available.';
  }
}

/**
 * The count task this user may open from a countTaskId: dispatched to them
 * (or unassigned), or already claimed by them. Shared by the session-resolution
 * effect and the GH-1188 render hold so both apply the same usability rule.
 */
function findUsableCountTask(
  recountTasks: CountingTask[] | undefined,
  taskId: string,
  currentUserId: number | null | undefined
): CountingTask | undefined {
  return (recountTasks ?? []).find(
    (candidate) =>
      candidate.recount_task_id === taskId &&
      (
        (
          candidate.status === 'dispatched' &&
          (
            candidate.assigned_to === null ||
            candidate.assigned_to === currentUserId
          )
        ) ||
        (
          (candidate.status === 'claimed' || candidate.status === 'counting') &&
          candidate.claimed_by === currentUserId
        )
      )
  );
}

type ActiveSession =
  | { type: 'pick'; batchId: string; lineItems: LineItem[] }
  | { type: 'pack'; freeScanResult: PackFreeScanResult }
  | {
      type: 'receive';
      receiveJobId: string;
      poId: string;
      poNumber?: number | null;
      supplierName: string;
      jobStatus?: string;
      assignedOperatorId?: number | null;
      closedAt?: string | null;
      actualDeliveryDate?: string | null;
      deliveryAccountingVersion?: number | null;
      lines: ReceiveJobLine[];
    }
  | { type: 'stow'; taskId: string }
  | { type: 'count'; task: CountingTask }
  | { type: 'return'; returnJobId: string }
  | null;

function WmsModuleFT2Inner({
  data,
  isLoading,
  isError,
  isOpsConsoleOpen = false,
  needsAttention = null,
  onNeedsAttentionAction,
  onOpenHistory,
  onOpenAllAttention,
  onConnectCarrier,

  onCreateReceiveJob,
  onFetchReceiveJob,
  onFetchReceiveReconciliation,
  onSaveReceiveReconciliationDraft,
  onFinalizeReceiveReconciliation,
  onClaimReceiveJob,
  onInspectReceiveLine,
  onPersistReceiveLineProgress,
  onConfirmReceiveLineCount,
  onReportReceiveException,
  onApproveOverDelivery,
  onCloseReceiveJob,
  onReceiveSessionFocusChange,
  onPrintUnitLabels,
  onConfirmUnitLabelsPrinted,

  onClaimBatch,
  onFetchLineItems,
  onResolveBarcode,
  onConfirmScan,
  onReportException,
  onCreateProblemTask,
  onPickComplete,
  onClaimPack,
  onFetchPackOrders,
  onPackFreeScan,
  onOperationsScanResolve,
  operationsShell = 'management',
  onConfirmPackScan,
  onReportPackException,
  onPrintLabel,
  onPrintInvoice,
  onPackComplete,
  onConfirmShipment,
  onRefresh,
  onSessionExit,
  onCountFinished,
  isOnline,
  queuedCount,
  stowTasks,
  onClaimStowTask,
  onConfirmStow,
  onFetchStowTasks,
  onResolveLocation,
  onAssignStowLocation,
  onFetchStowPlacements,
  canAssignStow,
  onFetchStowAssignees,
  onAssignStowTask,
  gridLocations,
  pendingReceiveSession,
  pendingStowTaskId,
  pendingStowStep,
  pendingReturnJobId,
  onStowSessionEnter,
  onStowSessionStepChange,
  pendingPickBatchId,
  onPickSessionEnter,
  pendingPackBatchId,
  onPackSessionEnter,
  onRaisePackDecision,
  onPollPackDecision,

  onFetchReturnJob,
  onAddReturnLine,
  onProcessReturnLine,
  onCompleteReturnJob,
  readyToPackOrders,
  openReceiveJobCount,
  openReceiveJobs,
  onReceiveSessionEnter,
  canReassignReceive,
  onFetchReceiveAssignees,
  onReassignReceiveJob,
  recountLocked,
  recountTasks,
  recountTasksSettled,
  onRecountUpgrade,
  onFetchCountingPreview,
  onFetchCountingAssignees,
  onCreateCountingTask,
  onFetchCountingLines,
  onFetchCountingFindings,
  onCreateCountingFinding,
  onClaimCountingTask,
  onReassignCountingTask,
  onRecordCountingLine,
  onSkipCountingLine,
  onCloseCountingTask,
  onCreateOpeningLine,
  onCompleteOpening,
  currentUserId,
  canReassignCount,
  canManageRecount = false,
  pendingCountTaskId,
  countFocusRequested,
  onCountSessionEnter,
  onCountSessionFocusChange,
  onSetupBinsClick,
  receiveAssignedWorkSpotlight,
  openingInventorySpotlight,
  openingInventory,
  canApproveOpeningInventoryCutover,
  openingInventoryCutoverSubmitting,
  openingInventoryCutoverError,
  onApproveOpeningInventoryCutover,
}: WmsModuleFT2Props) {
  const [countDialogOpen, setCountDialogOpen] = useState(false);
  const [countDialogLoading, setCountDialogLoading] = useState(false);
  const [countDialogError, setCountDialogError] = useState<string | null>(null);
  const [countPreviewBins, setCountPreviewBins] = useState<RecountPreviewBin[]>([]);
  const [countAssignees, setCountAssignees] = useState<Array<{
    user_id: number;
    first_name: string | null;
    last_name: string | null;
    role: string;
  }>>([]);
  const [selectedCountBins, setSelectedCountBins] = useState<string[]>([]);
  const [countAssignedTo, setCountAssignedTo] = useState<number | ''>('');
  const [countNotes, setCountNotes] = useState('');
  const [countCreating, setCountCreating] = useState(false);

  // RECOUNT-CLAIM-ABANDONED-131
  const [reassignTask, setReassignTask] = useState<CountingTask | null>(null);
  const [reassignTargets, setReassignTargets] = useState<Array<{
    user_id: number;
    first_name: string | null;
    last_name: string | null;
    role: string;
  }>>([]);
  const [reassignLoading, setReassignLoading] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState<number | ''>('');
  const [reassignSubmitting, setReassignSubmitting] = useState(false);

  const openReassignDialog = async (task: CountingTask) => {
    setReassignTask(task);
    setReassignTargetId('');
    setReassignError(null);
    setReassignLoading(true);
    try {
      const targets = await onFetchCountingAssignees();
      setReassignTargets(targets);
    } catch (error) {
      setReassignError(
        error instanceof Error ? error.message : 'Failed to load team operators.'
      );
    } finally {
      setReassignLoading(false);
    }
  };

  const closeReassignDialog = () => {
    setReassignTask(null);
    setReassignTargetId('');
    setReassignError(null);
  };

  const submitReassign = async () => {
    if (!reassignTask || reassignTargetId === '') return;
    setReassignSubmitting(true);
    setReassignError(null);
    try {
      await onReassignCountingTask?.(reassignTask.recount_task_id, reassignTargetId);
      onRefresh();
      closeReassignDialog();
    } catch (error) {
      setReassignError(
        error instanceof Error ? error.message : 'Reassignment failed. Try again.'
      );
    } finally {
      setReassignSubmitting(false);
    }
  };

  // STOW-LIFECYCLE-02 — owner/admin optional dispatch. Mirrors the recount
  // reassign dialog above; assignment is separate from claim/execution.
  const [stowAssignTask, setStowAssignTask] = useState<WmsStowTask | null>(null);
  const [stowAssignees, setStowAssignees] = useState<Array<{
    user_id: number;
    first_name: string | null;
    last_name: string | null;
    role: string;
  }>>([]);
  const [stowAssignLoading, setStowAssignLoading] = useState(false);
  const [stowAssignError, setStowAssignError] = useState<string | null>(null);
  const [stowAssignTargetId, setStowAssignTargetId] = useState<number | ''>('');
  const [stowAssignSubmitting, setStowAssignSubmitting] = useState(false);

  const openStowAssignDialog = async (task: WmsStowTask) => {
    setStowAssignTask(task);
    setStowAssignTargetId('');
    setStowAssignError(null);
    setStowAssignLoading(true);
    try {
      const targets = (await onFetchStowAssignees?.()) ?? [];
      setStowAssignees(targets);
    } catch (error) {
      setStowAssignError(
        error instanceof Error ? error.message : 'Failed to load team operators.'
      );
    } finally {
      setStowAssignLoading(false);
    }
  };

  const closeStowAssignDialog = () => {
    setStowAssignTask(null);
    setStowAssignTargetId('');
    setStowAssignError(null);
  };

  const submitStowAssign = async () => {
    if (!stowAssignTask || stowAssignTargetId === '') return;
    setStowAssignSubmitting(true);
    setStowAssignError(null);
    try {
      await onAssignStowTask?.(stowAssignTask.stow_task_id, stowAssignTargetId);
      onRefresh();
      closeStowAssignDialog();
    } catch (error: any) {
      // H — a 409 means the task was claimed concurrently: no stale
      // assignment UI, refresh so the card reflects the real current state.
      const status = error?.response?.status;
      if (status === 409) {
        setStowAssignError(
          'This task was just claimed by an operator and can no longer be assigned.'
        );
        onRefresh();
      } else {
        setStowAssignError(
          error instanceof Error ? error.message : 'Assignment failed. Try again.'
        );
      }
    } finally {
      setStowAssignSubmitting(false);
    }
  };

  const makeStowFirstToClaim = async (task: WmsStowTask) => {
    try {
      await onAssignStowTask?.(task.stow_task_id, null);
      onRefresh();
    } catch (error: any) {
      if (error?.response?.status === 409) {
        onRefresh();
      }
      // Advisory-only UI action (see J) — the card re-renders from the
      // refreshed list either way; no separate error surface needed here.
    }
  };

  // GH-1143 RECEIVE-REASSIGN-UI-01 — owner/admin reassignment of a
  // pending/unstarted Receive job assigned to another operator. Mirrors the
  // Stow/Recount reassign dialogs above; no "Pool"/unassign action exists
  // for Receive (contract: no Receive Pool/unassigned semantics).
  const [receiveReassignJob, setReceiveReassignJob] = useState<WmsOpenReceiveJob | null>(null);
  const [receiveReassignTargets, setReceiveReassignTargets] = useState<Array<{
    user_id: number;
    first_name: string | null;
    last_name: string | null;
    role: string;
  }>>([]);
  const [receiveReassignLoading, setReceiveReassignLoading] = useState(false);
  const [receiveReassignError, setReceiveReassignError] = useState<string | null>(null);
  const [receiveReassignTargetId, setReceiveReassignTargetId] = useState<number | ''>('');
  const [receiveReassignSubmitting, setReceiveReassignSubmitting] = useState(false);

  const openReceiveReassignDialog = async (job: WmsOpenReceiveJob) => {
    setReceiveReassignJob(job);
    // Current assignee represented/preselected, when present.
    setReceiveReassignTargetId(job.assigned_operator_id ?? '');
    setReceiveReassignError(null);
    setReceiveReassignLoading(true);
    try {
      const targets = (await onFetchReceiveAssignees?.()) ?? [];
      setReceiveReassignTargets(targets);
    } catch (error) {
      setReceiveReassignError(
        error instanceof Error ? error.message : 'Failed to load team operators.'
      );
    } finally {
      setReceiveReassignLoading(false);
    }
  };

  const closeReceiveReassignDialog = () => {
    setReceiveReassignJob(null);
    setReceiveReassignTargetId('');
    setReceiveReassignError(null);
  };

  const submitReceiveReassign = async () => {
    if (!receiveReassignJob || receiveReassignTargetId === '') return;
    setReceiveReassignSubmitting(true);
    setReceiveReassignError(null);
    try {
      await onReassignReceiveJob?.(receiveReassignJob.receive_job_id, receiveReassignTargetId);
      onRefresh();
      closeReceiveReassignDialog();
    } catch (error: any) {
      // A 409 means the job was claimed/started concurrently — no stale
      // reassignment UI, refresh so the card reflects real current state.
      const status = error?.response?.status;
      if (status === 409) {
        setReceiveReassignError(
          'This Receive job has already started and can no longer be reassigned.'
        );
        onRefresh();
      } else {
        setReceiveReassignError(
          error instanceof Error ? error.message : 'Reassignment failed. Try again.'
        );
      }
    } finally {
      setReceiveReassignSubmitting(false);
    }
  };

  const openCountDialog = async () => {
    setCountDialogOpen(true);
    setCountDialogLoading(true);
    setCountDialogError(null);
    setSelectedCountBins([]);
    setCountAssignedTo('');
    setCountNotes('');

    try {
      const [bins, assignees] = await Promise.all([
        onFetchCountingPreview(),
        onFetchCountingAssignees(),
      ]);
      setCountPreviewBins(bins);
      setCountAssignees(assignees);
    } catch (error) {
      setCountDialogError(
        error instanceof Error ? error.message : 'Failed to load count setup.'
      );
    } finally {
      setCountDialogLoading(false);
    }
  };

  const toggleCountBin = (locationCode: string) => {
    setSelectedCountBins((current) =>
      toggleRecountBinSelection(current, locationCode)
    );
  };

  const selectAllSuggestedCountBins = () => {
    setSelectedCountBins(selectAllRecountBins(countPreviewBins));
  };

  const createCount = async () => {
    if (selectedCountBins.length === 0) return;

    setCountCreating(true);
    setCountDialogError(null);

    try {
      await onCreateCountingTask({
        scope: 'locations',
        location_codes: selectedCountBins,
        assigned_to: countAssignedTo === '' ? null : countAssignedTo,
        ...(countNotes.trim() ? { notes: countNotes.trim() } : {}),
      });
      setCountDialogOpen(false);
    } catch (error) {
      setCountDialogError(
        error instanceof Error ? error.message : 'Failed to create count.'
      );
    } finally {
      setCountCreating(false);
    }
  };

  const countBinCanvasSelection = mapRecountPreviewBinsToCanvas(
    gridLocations,
    countPreviewBins
  );
  const selectedCanvasBins = selectedCountBins.filter((locationCode) =>
    countBinCanvasSelection.selectableCodes.has(locationCode)
  );
  const recountBinAvailability = classifyRecountBinAvailability(
    gridLocations,
    countPreviewBins
  );

  // Auto-enter receive session if handed off from Suppliers portal via URL param
  const [activeSession, setActiveSession] = useState<ActiveSession>(
    pendingReceiveSession
      ? { type: 'receive', ...pendingReceiveSession }
      : pendingReturnJobId
      ? { type: 'return', returnJobId: pendingReturnJobId }
      : pendingStowTaskId
      ? { type: 'stow', taskId: pendingStowTaskId }
      : null
  );
  // GH-1241 S3C-E1 — Receive exit is authoritative over in-flight Receive
  // reads. Every entry attempt takes a new generation; exit (and any later
  // entry) supersedes it, so an older response never touches the session,
  // its error or the loading state. The exited job is also fenced against a
  // handoff that resolves before the router commits the cleared URL; the
  // fence lifts once the host stops handing that job off.
  const receiveEntryGenerationRef = useRef(0);
  const receiveEntryInFlightRef = useRef(false);
  const exitedReceiveJobIdRef = useRef<string | null>(null);
  // GH-1241 S3C-M2 — the latest in-session refresh; an older one never lands.
  const receiveRefreshSequenceRef = useRef(0);
  useEffect(() => {
    if (!pendingReceiveSession) {
      exitedReceiveJobIdRef.current = null;
      return;
    }
    if (pendingReceiveSession.receiveJobId === exitedReceiveJobIdRef.current) return;
    setActiveSession({ type: 'receive', ...pendingReceiveSession });
  }, [pendingReceiveSession]);

  // GH-1241 S3C-M1 — the Receive session mode is resolved from canonical job
  // data plus GET /reconciliation every time the session is (re)built: entry,
  // URL handoff and canonical refresh. A refresh of the same job keeps its
  // resolved mode until new evidence arrives (no remount mid-work); a newer
  // request or another job always supersedes an older response.
  const [receiveMode, setReceiveMode] = useState<{
    receiveJobId: string;
    mode: ReceiveSessionMode;
    reconciliation: ReceiveReconciliationEvidence | null;
  } | null>(null);
  const receiveModeRequestRef = useRef(0);
  const onFetchReceiveReconciliationRef = useRef(onFetchReceiveReconciliation);
  onFetchReceiveReconciliationRef.current = onFetchReceiveReconciliation;
  useEffect(() => {
    const requestId = ++receiveModeRequestRef.current;
    if (activeSession?.type !== 'receive') {
      setReceiveMode(null);
      return;
    }
    const { receiveJobId, deliveryAccountingVersion, lines } = activeSession;
    const settle = (mode: ReceiveSessionMode, reconciliation: ReceiveReconciliationEvidence | null) => {
      if (requestId !== receiveModeRequestRef.current) return;
      setReceiveMode({ receiveJobId, mode, reconciliation });
    };
    const version = deliveryAccountingVersion == null ? null : Number(deliveryAccountingVersion);
    if (version !== 2) {
      settle(resolveReceiveSessionMode({ receiveJobId, deliveryAccountingVersion, lines, reconciliation: null }), null);
      return;
    }
    const fetchReconciliation = onFetchReceiveReconciliationRef.current;
    if (!fetchReconciliation) {
      settle('unavailable', null);
      return;
    }
    setReceiveMode((previous) => (
      previous?.receiveJobId === receiveJobId ? previous : { receiveJobId, mode: 'resolving', reconciliation: null }
    ));
    fetchReconciliation(receiveJobId)
      .then((evidence) => settle(
        resolveReceiveSessionMode({ receiveJobId, deliveryAccountingVersion, lines, reconciliation: evidence }),
        evidence ?? null,
      ))
      .catch(() => settle('unavailable', null));
  }, [activeSession]);

  // RECEIVE-FOCUS-EXIT-02 — ReceiveSessionPage's execution-focus effect
  // (WAREHOUSE-FOCUS-SHELL-01A) is keyed on
  // [sessionPhase, onExecutionFocusChange]. The `onExecutionFocusChange`
  // prop passed to <ReceiveSessionPage> below used to be a fresh inline
  // arrow function on EVERY WmsModuleFT2 render — including renders
  // triggered by the exit sequence itself (setActiveSession(null),
  // onSessionExit's setSearchParams, onRefresh's refetch). Because that
  // identity changed even though sessionPhase hadn't, the child effect
  // could re-fire and re-report focused=true for the just-exited session,
  // racing with (and landing after) onSessionExit's URL cleanup and
  // rewriting warehouseFocus/receiveJobId back into the URL.
  //
  // Fix is two-layered, matching "stabilize callback identity AND make
  // parent/session-exit state authoritative":
  //   1. activeSessionRef/onReceiveSessionFocusChangeRef track the latest
  //      values without being useCallback dependencies, so the callback
  //      handed to ReceiveSessionPage has a STABLE identity for the whole
  //      lifetime of this component — the child effect then only re-fires
  //      when sessionPhase itself genuinely changes, never merely because
  //      this parent re-rendered.
  //   2. handleReceiveExecutionFocusChange reads activeSessionRef live at
  //      call time and no-ops unless the CURRENT active session is still
  //      the receive session being reported for — exitSession's
  //      setActiveSession(null) is synchronous and always the first thing
  //      it does, so by the time any stale/delayed report could arrive,
  //      activeSessionRef.current is already not 'receive' and the report
  //      is dropped instead of reaching the URL.
  const activeSessionRef = useRef(activeSession);
  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  // GH-1191 — the count task whose session explicitly began exit. Until the
  // URL stops naming that task, the exit is authoritative over stale
  // recountTasks: the restore effect must not re-create the session while the
  // router's URL cleanup and the post-exit refetch are still in flight.
  const exitedCountTaskIdRef = useRef<string | null>(null);

  const onReceiveSessionFocusChangeRef = useRef(onReceiveSessionFocusChange);
  useEffect(() => {
    onReceiveSessionFocusChangeRef.current = onReceiveSessionFocusChange;
  }, [onReceiveSessionFocusChange]);

  const onCountSessionFocusChangeRef = useRef(onCountSessionFocusChange);
  useEffect(() => {
    onCountSessionFocusChangeRef.current = onCountSessionFocusChange;
  }, [onCountSessionFocusChange]);

  // #1164 — same exit-race protection as Receive: stable callback identity,
  // and only the CURRENT active count session is allowed to update the URL.
  const handleCountExecutionFocusChange = useCallback((focused: boolean) => {
    const current = activeSessionRef.current;
    if (current?.type !== 'count') return;
    onCountSessionFocusChangeRef.current?.(
      current.task.recount_task_id,
      focused
    );
  }, []);

  const handleReceiveExecutionFocusChange = useCallback((focused: boolean) => {
    const current = activeSessionRef.current;
    if (current?.type !== 'receive') return;
    onReceiveSessionFocusChangeRef.current?.(current.receiveJobId, focused);
  }, []);

  useEffect(() => {
    if (pendingStowTaskId) {
      setActiveSession({ type: 'stow', taskId: pendingStowTaskId });
    }
  }, [pendingStowTaskId]);

  useEffect(() => {
    if (pendingReturnJobId) {
      setActiveSession({ type: 'return', returnJobId: pendingReturnJobId });
    }
  }, [pendingReturnJobId]);

  // #1164 — fail open. A focused count URL must not hide app chrome for a
  // session that is not there: once count-task state has settled and the
  // requested task cannot produce a usable session for this user (missing,
  // another user's, locked, or the read failed), report it unfocused through
  // the existing count-focus boundary, which keeps countTaskId and drops
  // warehouseFocus. Loading never fails open; a live session never does.
  const failOpenCountFocus = (taskId: string) => {
    if (!recountTasksSettled) return;
    const current = activeSessionRef.current;
    if (current?.type === 'count' && current.task.recount_task_id === taskId) return;
    onCountSessionFocusChangeRef.current?.(taskId, false);
  };

  useEffect(() => {
    // GH-1191 — the exit fence lasts only while the URL still names the
    // exited task; once countTaskId is gone or names another task, clear it.
    // It tracks URL ownership, not entitlement, so it clears even while locked.
    const exitedTaskId = exitedCountTaskIdRef.current;
    if (exitedTaskId && pendingCountTaskId !== exitedTaskId) {
      exitedCountTaskIdRef.current = null;
    }

    if (recountLocked) {
      setActiveSession((session) => session?.type === 'count' ? null : session);
      if (pendingCountTaskId) failOpenCountFocus(pendingCountTaskId);
      return;
    }

    if (!pendingCountTaskId) return;

    if (exitedCountTaskIdRef.current === pendingCountTaskId) return;

    const task = findUsableCountTask(recountTasks, pendingCountTaskId, currentUserId);

    if (task) {
      setActiveSession({ type: 'count', task });
      // #1164 — the module owns the positive focus handoff for a resolved
      // Opening Inventory session: protection begins at the Brief even when
      // the URL arrived without warehouseFocus=count (e.g. after a fail-open).
      // CountingSessionPage's own mount report can run before activeSessionRef
      // syncs and be dropped; the parent's focus handler is idempotent.
      if (task.purpose === 'opening_inventory') {
        onCountSessionFocusChangeRef.current?.(task.recount_task_id, true);
      }
      return;
    }

    failOpenCountFocus(pendingCountTaskId);
  }, [pendingCountTaskId, recountTasks, currentUserId, recountLocked, recountTasksSettled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (pendingPickBatchId) {
      enterPickSession(pendingPickBatchId).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [loadingSession, setLoadingSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const batches = data?.batches ?? [];
  const pickingBatches = batches.filter((batch) => batch.status === 'pending' || batch.status === 'picking');
  const readyPackBatches = batches.filter((batch) => batch.status === 'pick_complete');
  const packingBatches = batches.filter((batch) => batch.status === 'packing');

  // PICK-EXECUTION-SPATIAL-01B — canonical warehouse geometry for the Pick
  // execution map, via the shared WMS adapter. undefined (grid not resolved)
  // stays undefined: missing geometry is never turned into an empty floor.
  const pickFloorZones = useMemo(
    () => gridLocations?.map(warehouseLocationToZone),
    [gridLocations],
  );

  // GH-1109 — Operations is an assigned-work queue, never an unassigned pool.
  // Derive cards and tally from this exact same projection so the two cannot
  // drift. Owner/admin broader API visibility does not broaden floor work:
  // this surface still shows only work assigned to the authenticated operator.
  const ownReceiveWorkJobs = (openReceiveJobs ?? []).filter(
    (job) =>
      job.assigned_operator_id === currentUserId &&
      (job.status === 'pending' || job.status === 'in_progress') &&
      !job.closed_at
  );

  // GH-1143 RECEIVE-REASSIGN-UI-01 — owner/admin additionally sees PENDING/
  // UNSTARTED work assigned to someone else, solely for reassignment
  // management. Never in_progress/started, closed, or cancelled work — no
  // takeover path (mirrors STOW-LIFECYCLE-02's canAssignStow visibility).
  const otherPendingReceiveJobsForManagement = canReassignReceive
    ? (openReceiveJobs ?? []).filter(
        (job) =>
          job.assigned_operator_id !== null &&
          job.assigned_operator_id !== currentUserId &&
          job.status === 'pending' &&
          !job.started_at &&
          !job.closed_at
      )
    : [];

  const receiveWorkJobs = [...ownReceiveWorkJobs, ...otherPendingReceiveJobsForManagement];

  // STOW-LIFECYCLE-02 (Part E) — an operator sees only unassigned pending
  // work, work assigned to them, and work they themselves claimed.
  // Owner/admin additionally sees pending work assigned to someone else, so
  // the ⋮ menu has something to manage — never another operator's active
  // in_progress claim (no takeover path here; out of scope for this slice).
  // Tally and rendered cards both read this one array so they cannot drift.
  const visibleStowTasks = (stowTasks ?? []).filter((task) => {
    if (task.status === 'pending') {
      return (
        task.assigned_operator_id === null ||
        task.assigned_operator_id === currentUserId ||
        Boolean(canAssignStow)
      );
    }
    if (task.status === 'in_progress') {
      return task.claimed_by === currentUserId;
    }
    return false;
  });

  // Warehouse execution owns only physical counting work.
  // manual_review belongs to the owner decision surface, not this floor list.
  const countingTasks = (recountTasks ?? []).filter(
    (task) =>
      task.status === 'dispatched' ||
      task.status === 'claimed' ||
      task.status === 'counting'
  );

  const enterReceiveSession = async (jobId: string) => {
    if (!onFetchReceiveJob) {
      setSessionError(
        'Receive work is unavailable. Refresh Operations and try again.'
      );
      return;
    }

    // GH-1241 S3C-E1 — this attempt supersedes any earlier one; a deliberate
    // (re)open lifts the exit fence for this job.
    const generation = ++receiveEntryGenerationRef.current;
    const isCurrentEntry = () => generation === receiveEntryGenerationRef.current;
    receiveEntryInFlightRef.current = true;
    exitedReceiveJobIdRef.current = null;

    setLoadingSession(true);
    setSessionError(null);

    // Persist identity before the fetch so a refresh/retry reconstructs the
    // same canonical Receive session instead of dropping the operator's work.
    onReceiveSessionEnter?.(jobId);

    try {
      const result = await onFetchReceiveJob(jobId);
      if (!isCurrentEntry()) return;

      setActiveSession({
        type: 'receive',
        receiveJobId: jobId,
        poId: result.job.po_id,
        poNumber: result.job.po_number ?? null,
        supplierName: result.job.supplier_name,
        jobStatus: result.job.status,
        assignedOperatorId: result.job.assigned_operator_id ?? null,
        closedAt: result.job.closed_at ?? null,
        actualDeliveryDate: result.job.actual_delivery_date ?? null,
        deliveryAccountingVersion: result.job.delivery_accounting_version ?? null,
        lines: result.lines,
      });
    } catch (error) {
      if (!isCurrentEntry()) return;
      setSessionError(
        error instanceof Error
          ? error.message
          : 'Failed to open Receive work.'
      );
    } finally {
      if (isCurrentEntry()) {
        receiveEntryInFlightRef.current = false;
        setLoadingSession(false);
      }
    }
  };

  // BATCH-DETAIL-HANDOFF-01 — opening pick work (Operations card or
  // /wms?batchId= restore) only enters the Pick Brief. It never claims.
  const enterPickSession = async (batchId: string) => {
    setLoadingSession(true);
    setSessionError(null);

    // WAREHOUSE-SESSION-FOCUS-02B — report identity before the fetch (same
    // precedent as enterReceiveSession) so the host lands on the focused Pick
    // URL immediately instead of leaving ordinary chrome up while line items
    // load. Reporting is non-mutating; Start Picking still owns the claim.
    onPickSessionEnter?.(batchId);

    try {
      const items = await onFetchLineItems(batchId);
      setActiveSession({ type: 'pick', batchId, lineItems: items });
    } catch (err: any) {
      setSessionError(err?.message ?? 'Failed to start pick session.');
    } finally {
      setLoadingSession(false);
    }
  };

  // The Brief's Start Picking is the claim boundary. Whether a claim is needed
  // derives from canonical WmsData batch.status: an already-picking batch
  // continues without a duplicate claim; anything else (pending, or not yet
  // in the loaded data) goes through the canonical claim, which the backend
  // arbitrates. A rejection propagates so the Brief stays put and can retry.
  const startPickBatch = async (batchId: string) => {
    const status = batches.find((batch) => batch.pick_batch_id === batchId)?.status;
    if (status === 'picking') return;
    await onClaimBatch(batchId);
  };

  // Pack execution entry scanner (consequential, onPackFreeScan).
  const [packScanLoading, setPackScanLoading] = useState(false);
  const [packScanError, setPackScanError] = useState<string | null>(null);
  // Operations overview Quick Scan (read-only, onOperationsScanResolve).
  const [quickScanLoading, setQuickScanLoading] = useState(false);
  const [quickScanError, setQuickScanError] = useState<string | null>(null);
  const [quickScanResult, setQuickScanResult] = useState<string | null>(null);
  const [inventoryChecksExpanded, setInventoryChecksExpanded] = useState(false);
  const [showAllInventoryChecks, setShowAllInventoryChecks] = useState(false);
  // WMS-OPS-MODAL-PARITY-01 — View all N opens the stage's full task list in
  // the shared EntityDetailModal; the five-stage board never recomposes.
  // null = no task-list modal open.
  const [stageListStage, setStageListStage] = useState<Exclude<OperationsLifecycleStage, 'ship'> | null>(null);
  // Card CTAs inside the modal hand off to their existing workflow/dialog only
  // after the list modal closes (never stacked). No-op when it is not open.
  const closeStageList = () => setStageListStage(null);
  // WMS-OPS-OWNER-1A-ALIGNMENT — management header / Reconcile description seams.
  const managementHeadingId = useId();
  const managementSummaryId = useId();
  const reconcileDueId = useId();
  const quickScanLabelId = useId();
  const quickScanInputRef = useRef<HTMLInputElement>(null);
  const packEntryInputRef = useRef<HTMLInputElement>(null);
  const scannerFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scannerOwnedFocusBeforeConsoleRef = useRef(false);
  const previousOpsConsoleOpenRef = useRef(Boolean(isOpsConsoleOpen));
  const packErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Quick Scan focus belongs to the Operations surface, but an open Ops
  // Console temporarily owns interaction. Preserve scanner focus ownership
  // across that transition without unmounting the scanner or stealing focus
  // from another control.
  useEffect(() => {
    if (scannerFocusTimerRef.current) {
      clearTimeout(scannerFocusTimerRef.current);
      scannerFocusTimerRef.current = null;
    }

    const consoleOpen = Boolean(isOpsConsoleOpen);
    const wasConsoleOpen = previousOpsConsoleOpenRef.current;
    const scanner = quickScanInputRef.current;

    previousOpsConsoleOpenRef.current = consoleOpen;

    if (consoleOpen) {
      // Capture ownership only on the closed -> open transition. Subsequent
      // renders while open must not erase the fact that the scanner owned focus.
      if (!wasConsoleOpen) {
        const scannerOwnedFocus =
          scanner !== null && document.activeElement === scanner;

        scannerOwnedFocusBeforeConsoleRef.current = scannerOwnedFocus;

        if (scannerOwnedFocus) scanner.blur();
      }
      return;
    }

    if (activeSession) return;

    // Initial Operations entry keeps the existing scanner autofocus.
    // Console close restores focus only when the scanner owned it before open.
    const shouldFocus =
      !wasConsoleOpen || scannerOwnedFocusBeforeConsoleRef.current;

    if (!shouldFocus) return;

    scannerFocusTimerRef.current = setTimeout(() => {
      if (!activeSession && !isOpsConsoleOpen) {
        quickScanInputRef.current?.focus();
      }

      scannerOwnedFocusBeforeConsoleRef.current = false;
      scannerFocusTimerRef.current = null;
    }, 100);

    return () => {
      if (scannerFocusTimerRef.current) {
        clearTimeout(scannerFocusTimerRef.current);
        scannerFocusTimerRef.current = null;
      }
    };
  }, [activeSession, isOpsConsoleOpen]);

  const handlePackFreeScan = async (scannedValue: string) => {
    if (packScanLoading) return;
    if (packErrorTimerRef.current) clearTimeout(packErrorTimerRef.current);
    setPackScanLoading(true);
    setPackScanError(null);
    try {
      const result = await onPackFreeScan(scannedValue);
      if ('error' in result) {
        setPackScanError(result.message);
        packErrorTimerRef.current = setTimeout(() => setPackScanError(null), 3500);
        return;
      }
      if (result.type === 'unit_resolved') {
        setActiveSession({ type: 'pack', freeScanResult: result });
      }
      if (result.type === 'return') {
        if (result.claimedByOther) {
          setPackScanError('This return is already claimed by another operator.');
          packErrorTimerRef.current = setTimeout(() => setPackScanError(null), 3500);
          return;
        }
        setActiveSession({ type: 'return', returnJobId: result.returnJobId });
      }
    } catch (err: any) {
      const msg: string = err?.response?.data?.message ?? err?.message ?? 'Scan failed — try again';
      setPackScanError(msg);
      packErrorTimerRef.current = setTimeout(() => setPackScanError(null), 3500);
    } finally {
      setPackScanLoading(false);
      if (packEntryInputRef.current) packEntryInputRef.current.value = '';
    }
  };

  // WMS-OPS-LIFECYCLE-IA-02 — the Operations overview Quick Scan only
  // resolves (POST /wms/scan/resolve). It never enters Pack, claims, scans or
  // completes anything; consequential scanning lives inside Pack execution.
  const handleQuickScanResolve = async (scannedValue: string) => {
    if (quickScanLoading || !onOperationsScanResolve) return;
    setQuickScanLoading(true);
    setQuickScanError(null);
    setQuickScanResult(null);
    try {
      const result = await onOperationsScanResolve(scannedValue);
      setQuickScanResult(describeScanResolution(result ?? {}));
    } catch (err: any) {
      setQuickScanError(
        err?.response?.status === 404
          ? `Nothing in the warehouse matches ${scannedValue}.`
          : err?.response?.data?.error ?? err?.message ?? 'Scan failed — try again'
      );
    } finally {
      setQuickScanLoading(false);
      if (quickScanInputRef.current) quickScanInputRef.current.value = '';
    }
  };

  const exitSession = (finishedLabel?: string) => {
    const current = activeSessionRef.current;
    if (current?.type === 'count') {
      exitedCountTaskIdRef.current = current.task.recount_task_id;
    }
    // GH-1241 S3C-E1 — exit supersedes every outstanding Receive entry read
    // and fences the exited job against an obsolete URL handoff.
    receiveEntryGenerationRef.current += 1;
    if (receiveEntryInFlightRef.current) {
      receiveEntryInFlightRef.current = false;
      setLoadingSession(false);
    }
    if (current?.type === 'receive') {
      exitedReceiveJobIdRef.current = current.receiveJobId;
    }
    setActiveSession(null);
    onRefresh();
    onSessionExit?.();
    // RECEIVE-COMPLETE-EXIT-01 — exitSession is passed directly as
    // `onComplete` to every session page (Pick/Pack/Receive/Stow/Return),
    // several of which wire it straight to a Button's onClick. A bare
    // `onClick={onComplete}` at any of those call sites makes React invoke
    // this function with a SyntheticEvent, not a string — `if (finishedLabel)`
    // alone treated that as truthy and forwarded the event object into
    // onCountFinished -> setFinishedCountLabel -> rendered as a child,
    // crashing the page. Require an actual non-empty string so any such
    // call-site mistake, present or future, can never leak a MouseEvent (or
    // any other non-string value) into session-exit state.
    if (typeof finishedLabel === 'string' && finishedLabel) {
      onCountFinished?.(finishedLabel);
    }
  };

  // Navigation-only seam. Do not use exitSession: it would clear the Pack
  // target. Pack orientation/restoration belongs to the next slice.
  const enterPackHandoff = (batchId: string) => {
    setActiveSession(null);
    onPackSessionEnter?.(batchId);
  };

  // Active pick session
  if (activeSession?.type === 'pick') {
    return (
      <PickSessionPage
        pickBatchId={activeSession.batchId}
        lineItems={activeSession.lineItems}
        onComplete={exitSession}
        onStartPacking={enterPackHandoff}
        onResolveBarcode={onResolveBarcode}
        onConfirmScan={(params) => onConfirmScan(activeSession.batchId, params)}
        onReportException={(params) => onReportException(activeSession.batchId, params)}
        onPickComplete={() => onPickComplete(activeSession.batchId)}
        onStartPicking={() => startPickBatch(activeSession.batchId)}
        // PICK-RESUME-SEMANTICS-01 — only exact canonical `picking` resumes
        // execution; unknown/unresolved status keeps the Brief. Derived per
        // render so status resolving after the session still applies.
        resumePicking={
          batches.find((batch) => batch.pick_batch_id === activeSession.batchId)?.status === 'picking'
        }
        floorZones={pickFloorZones}
        isOnline={isOnline}
        queuedCount={queuedCount}
      />
    );
  }

  // Active pack session (WEB-PACK-02 — item-centric free-scan)
  if (activeSession?.type === 'pack') {
    return (
      <PackSessionPage
        initialFreeScanResult={activeSession.freeScanResult}
        onPackFreeScan={onPackFreeScan}
        onPackCountConfirm={async (params) => {
          await onConfirmPackScan(activeSession.freeScanResult.pick_batch_id, {
            lasyncro_order_id: activeSession.freeScanResult.lasyncro_order_id,
            ...params,
          });
        }}
        onPrintInvoice={onPrintInvoice}
        onPrintLabel={onPrintLabel}
        onCreateProblemTask={onCreateProblemTask}
        onComplete={exitSession}
      />
    );
  }

  // Active receive session
  if (activeSession?.type === 'receive') {
    const refreshReceiveSession = async () => {
      if (!onFetchReceiveJob) return;
      // GH-1241 S3C-M2 — same authority as E1 entry reads: a refresh started
      // before exit, before a (re)open, or before a newer refresh never lands.
      const generation = receiveEntryGenerationRef.current;
      const sequence = ++receiveRefreshSequenceRef.current;
      const receiveJobId = activeSession.receiveJobId;
      const latest = await onFetchReceiveJob(receiveJobId);
      const current = activeSessionRef.current;
      if (
        generation !== receiveEntryGenerationRef.current
        || sequence !== receiveRefreshSequenceRef.current
        || current?.type !== 'receive'
        || current.receiveJobId !== receiveJobId
      ) {
        return;
      }
      setActiveSession({
        type: 'receive',
        receiveJobId: activeSession.receiveJobId,
        poId: latest.job.po_id,
        poNumber: latest.job.po_number ?? activeSession.poNumber ?? null,
        supplierName: latest.job.supplier_name,
        jobStatus: latest.job.status,
        assignedOperatorId: latest.job.assigned_operator_id ?? null,
        closedAt: latest.job.closed_at ?? null,
        actualDeliveryDate: latest.job.actual_delivery_date ?? null,
        deliveryAccountingVersion: latest.job.delivery_accounting_version ?? null,
        lines: latest.lines,
      });
    };
    const resolvedReceiveMode = receiveMode?.receiveJobId === activeSession.receiveJobId ? receiveMode : null;
    // Missing host writers fail closed rather than reporting a write that never happened.
    const unavailableReceiveWrite = (what: string) =>
      Promise.reject(new Error(`${what} is unavailable. Return to Operations and try again.`));

    return (
      <ReceiveSessionPage
        receiveJobId={activeSession.receiveJobId}
        poId={activeSession.poId}
        poNumber={activeSession.poNumber}
        supplierName={activeSession.supplierName}
        jobStatus={activeSession.jobStatus}
        assignedOperatorId={activeSession.assignedOperatorId}
        currentUserId={currentUserId}
        closedAt={activeSession.closedAt}
        actualDeliveryDate={activeSession.actualDeliveryDate}
        lines={activeSession.lines}
        onClaimJob={() =>
          onClaimReceiveJob?.(activeSession.receiveJobId) ??
          Promise.reject(
            new Error('Receive claim is unavailable. Return to Operations and try again.')
          )
        }
        onInspectLine={(params) => onInspectReceiveLine?.(activeSession.receiveJobId, params) ?? unavailableReceiveWrite('Finishing a line')}
        onPersistLineProgress={(lineId, params) => onPersistReceiveLineProgress?.(activeSession.receiveJobId, lineId, params) ?? unavailableReceiveWrite('Saving count progress')}
        onConfirmLineCount={onConfirmReceiveLineCount
          ? (lineId, params) => onConfirmReceiveLineCount(activeSession.receiveJobId, lineId, params)
          : undefined}
        onReportException={(params) => onReportReceiveException?.(activeSession.receiveJobId, params) ?? unavailableReceiveWrite('Reporting a problem')}
        onApproveOverDelivery={(params) => onApproveOverDelivery(activeSession.receiveJobId, params)}
        onCloseJob={(params) => onCloseReceiveJob?.(activeSession.receiveJobId, params) ?? unavailableReceiveWrite('Closing this Receive')}
        onComplete={exitSession}
        onResolveBarcode={onResolveBarcode}
        onPrintUnitLabels={onPrintUnitLabels}
        onConfirmUnitLabelsPrinted={onConfirmUnitLabelsPrinted}
        onRefresh={refreshReceiveSession}
        onExecutionFocusChange={handleReceiveExecutionFocusChange}
        sessionMode={resolvedReceiveMode?.mode ?? 'resolving'}
        reconciliation={resolvedReceiveMode?.reconciliation ?? null}
        onSaveReconciliationDraft={onSaveReceiveReconciliationDraft
          ? (payload) => onSaveReceiveReconciliationDraft(activeSession.receiveJobId, payload)
          : undefined}
        onFinalizeReconciliation={onFinalizeReceiveReconciliation
          ? (payload) => onFinalizeReceiveReconciliation(activeSession.receiveJobId, payload)
          : undefined}
      />
    );
  }

  // Active stow session
  if (activeSession?.type === 'stow') {
    return (
      <StowSessionPage
        initialTaskId={activeSession.taskId}
        initialStep={pendingStowStep}
        currentUserId={currentUserId}
        onComplete={exitSession}
        // STOW-SESSION-TRANSITION-01 — the child reports its OWN current task
        // ID with every call (same-task step change, or an automatic
        // advance to a different task). Never derive taskId from the
        // activeSession closure captured when this element was created —
        // that was the root cause of the stale-URL/stale-parent-session
        // defect: activeSession.taskId still pointed at a just-completed
        // task after StowSessionPage silently advanced to the next one.
        // Both the local session identity and the persisted URL must move
        // together to the task the child actually reports.
        onActiveTaskChange={(taskId, step) => {
          setActiveSession((session) =>
            session?.type === 'stow' && session.taskId !== taskId
              ? { type: 'stow', taskId }
              : session
          );
          onStowSessionStepChange?.(taskId, step);
        }}
        onFetchTasks={onFetchStowTasks ?? (() => Promise.resolve([]))}
        onResolveLocation={onResolveLocation ?? (() => Promise.resolve(null))}
        onAssignLocation={(taskId, locationCode) =>
          onAssignStowLocation?.(taskId, locationCode) ?? Promise.resolve()
        }
        onClaimTask={(taskId) =>
          onClaimStowTask?.(taskId) ?? Promise.resolve()
        }
        onResolveBarcode={onResolveBarcode}
        onConfirmStow={(taskId, qty, lasyncroUnitId) =>
          onConfirmStow?.(taskId, qty, lasyncroUnitId) ??
          // STOW-SPLIT-01 — StowSession requires the authoritative committed
          // server result. Never silently resolve when the confirm adapter is absent,
          // because that would let the scanner advance without a warehouse mutation.
          Promise.reject(
            new Error(
              'Stow confirmation is unavailable. Return to Operations and try again.'
            )
          )
        }
        onFetchPlacements={(taskId) =>
          onFetchStowPlacements?.(taskId) ?? Promise.resolve([])
        }
      />
    );
  }

  if (activeSession?.type === 'count' && !recountLocked) {
    return (
      <CountingSessionPage
        task={activeSession.task}
        onComplete={exitSession}
        onFetchLines={onFetchCountingLines}
        onFetchFindings={onFetchCountingFindings}
        onCreateFinding={onCreateCountingFinding}
        onClaimTask={onClaimCountingTask}
        onResolveBarcode={onResolveBarcode}
        onRecordCount={onRecordCountingLine}
        onSkipLine={onSkipCountingLine}
        onCloseTask={onCloseCountingTask}
        onCreateOpeningLine={onCreateOpeningLine}
        onCompleteOpening={onCompleteOpening}
        openingInventorySpotlight={openingInventorySpotlight}
        onExecutionFocusChange={handleCountExecutionFocusChange}
      />
    );
  }

  if (activeSession?.type === 'return') {
    return (
      <ReturnSessionPage
        returnJobId={activeSession.returnJobId}
        onFetchReturnJob={onFetchReturnJob}
        onAddReturnLine={onAddReturnLine}
        onProcessReturnLine={onProcessReturnLine}
        onCompleteReturnJob={onCompleteReturnJob}
        onComplete={exitSession}
      />
    );
  }

  // WMS-OPS-LIFECYCLE-IA-02 — Pack execution entry. Operations hands off only
  // the batch identity (packBatchId); nothing is claimed or recorded until the
  // operator scans here. This is the consequential Pack scanner
  // (onPackFreeScan) that previously sat on the Operations overview; the
  // overview Quick Scan is now read-only resolution. Pack execution stays
  // order/parcel authority: the first scan resolves the order to pack.
  if (pendingPackBatchId) {
    const packBatch = batches.find((batch) => batch.pick_batch_id === pendingPackBatchId);
    const packOrderCount = new Set(
      (readyToPackOrders ?? [])
        .filter((order) => order.pick_batch_id === pendingPackBatchId)
        .map((order) => order.lasyncro_order_id)
    ).size;

    return (
      <Box sx={{ p: { xs: '20px 16px', md: '24px' }, maxWidth: 640, mx: 'auto', width: '100%', boxSizing: 'border-box' }}>
        <Button
          variant="text"
          size="small"
          onClick={() => exitSession()}
          sx={{ minWidth: 'auto', px: 0, mb: 1.5, fontSize: 12, textTransform: 'none', color: 'var(--accent-text)' }}
        >
          Return to Operations
        </Button>
        <Typography component="h1" sx={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
          Pack batch {pendingPackBatchId.slice(0, 8).toUpperCase()}
        </Typography>
        {packBatch && (
          <Typography sx={{ mt: 0.5, fontSize: 13, fontWeight: 400, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
            {packOrderCount > 0 ? `${packOrderCount} ${packOrderCount === 1 ? 'order' : 'orders'} · ` : ''}
            {packBatch.total_units} {packBatch.total_units === 1 ? 'unit' : 'units'}
          </Typography>
        )}

        <Box sx={{
          mt: 2.5, display: 'flex', alignItems: 'center', gap: 1.25,
          bgcolor: 'var(--surface)', border: '1.5px solid',
          borderColor: packScanError ? 'var(--critical-border)' : 'var(--accent-border)',
          borderRadius: '10px', px: 1.5, py: 1,
        }}>
          {packScanLoading
            ? <CircularProgress size={16} sx={{ color: 'var(--accent-text)' }} />
            : <ScanBarcode size={18} color={packScanError ? 'var(--critical-ink)' : 'var(--accent)'} />}
          <TextField
            inputRef={packEntryInputRef}
            autoFocus
            fullWidth
            variant="standard"
            placeholder="Scan an item or invoice barcode to begin packing"
            disabled={packScanLoading}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const val = packEntryInputRef.current?.value.trim();
                if (val) void handlePackFreeScan(val);
              }
            }}
            autoComplete="off"
            InputProps={{ disableUnderline: true }}
            sx={{ '& .MuiInputBase-input': { fontFamily: 'inherit', fontSize: 15, color: 'var(--ink-3)' } }}
          />
        </Box>
        {packScanError && (
          <Alert severity="error" sx={{ mt: 1, py: 0.5, fontSize: 13, borderRadius: '8px' }}>
            {packScanError}
          </Alert>
        )}
      </Box>
    );
  }

  // BATCH-DETAIL-HANDOFF-01 — protected Pick URL first paint.
  //
  // A targeted ?batchId= URL already declares which workflow the merchant
  // intends to enter. enterPickSession() resolves from a passive effect, so
  // without this synchronous render guard the ordinary Warehouse body can
  // commit for one frame before the Pick Brief exists.
  //
  // Match the existing Counting precedent: hold the ordinary body while the
  // requested session resolves, then render either the Pick Brief or an
  // explicit target-specific failure. Navigation/restoration remains
  // non-mutating; Start Picking is still the claim boundary.
  if (pendingPickBatchId) {
    if (sessionError) {
      // WAREHOUSE-SESSION-FOCUS-02B — a focused Pick hides all navigation, so
      // the failure carries its own non-mutating exit through the existing
      // session exit (clears batchId + focus). No claim, no fabricated Brief.
      return (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            px: 2,
            py: 8,
          }}
        >
          <Alert
            severity="error"
            sx={{
              width: '100%',
              maxWidth: 560,
              borderRadius: '10px',
            }}
          >
            {sessionError}
          </Alert>
          <Button
            variant="text"
            size="small"
            onClick={() => {
              setSessionError(null);
              exitSession();
            }}
            sx={{ minWidth: 'auto', px: 0, fontSize: 11, textTransform: 'none' }}
          >
            Leave pick
          </Button>
        </Box>
      );
    }

    return (
      <Box
        role="status"
        aria-label="Loading pick session"
        sx={{
          display: 'flex',
          justifyContent: 'center',
          py: 8,
        }}
      >
        <CircularProgress size={24} />
      </Box>
    );
  }

  // GH-1188 — protected count mode begins at the Brief. While a focused count
  // URL is still resolving (task read pending, or a usable task whose session
  // the resolution effect has not committed yet) the ordinary Warehouse body
  // must not paint. Once settled with no usable task this hold releases and
  // the existing fail-open path proceeds; loading never fails open.
  if (
    countFocusRequested &&
    pendingCountTaskId &&
    activeSession?.type !== 'count' &&
    (
      !recountTasksSettled ||
      (
        !recountLocked &&
        findUsableCountTask(recountTasks, pendingCountTaskId, currentUserId) !== undefined
      )
    )
  ) {
    return (
      <Box
        role="status"
        aria-label="Loading count session"
        sx={{ display: 'flex', justifyContent: 'center', py: 8 }}
      >
        <CircularProgress size={24} />
      </Box>
    );
  }

  // Lifecycle tallies count batches, not order rows or physical quantities.
  const workCounts: WorkTallyCounts = {
    picking: pickingBatches.length,
    readyToPack: readyPackBatches.length,
    packing: packingBatches.length,
    puttingAway: visibleStowTasks.length,
    receiving: receiveWorkJobs.length,
    counting: recountLocked ? 0 : countingTasks.length,
  };

  const isOperatorShell = operationsShell === 'operator';

  const readyOrderCount = (batchId: string) => {
    const orderIds = (readyToPackOrders ?? [])
      .filter((order) => order.pick_batch_id === batchId)
      .map((order) => order.lasyncro_order_id);
    return orderIds.length > 0 ? new Set(orderIds).size : undefined;
  };

  const renderBatchCard = (batch: WmsBatch) => (
    <BatchCard
      key={batch.pick_batch_id}
      batch={batch}
      currentUserId={currentUserId}
      onOpenPick={(id) => { closeStageList(); void enterPickSession(id); }}
      onOpenPack={(id) => { closeStageList(); enterPackHandoff(id); }}
      orderCount={readyOrderCount(batch.pick_batch_id)}
      board={!isOperatorShell}
    />
  );

  const renderReceiveCard = (job: WmsOpenReceiveJob) => (
    <ReceiveWorkCard
      key={job.receive_job_id}
      job={job}
      isOwnJob={job.assigned_operator_id === currentUserId}
      canManageAssignment={!isOperatorShell && Boolean(canReassignReceive)}
      onOpen={(jobId) => { closeStageList(); void enterReceiveSession(jobId); }}
      onReassignRequest={(j) => { closeStageList(); void openReceiveReassignDialog(j); }}
      board={!isOperatorShell}
    />
  );

  const renderStowCard = (task: WmsStowTask) => (
    <StowTaskCard
      key={task.stow_task_id}
      task={task}
      currentUserId={currentUserId}
      canAssignStow={!isOperatorShell && canAssignStow}
      onOpen={(id) => { closeStageList(); onStowSessionEnter?.(id); setActiveSession({ type: 'stow', taskId: id }); }}
      onAssignRequest={(t) => { closeStageList(); void openStowAssignDialog(t); }}
      onMakeFirstToClaim={(t) => void makeStowFirstToClaim(t)}
      board={!isOperatorShell}
    />
  );

  const renderCountCard = (task: CountingTask) => (
    <CountingTaskCard
      key={task.recount_task_id}
      task={task}
      currentUserId={currentUserId}
      onOpen={(selectedTask) => {
        onCountSessionEnter?.(selectedTask.recount_task_id);
        setActiveSession({ type: 'count', task: selectedTask });
      }}
    />
  );

  // Owner/Admin pipeline: each lifecycle stage directly owns its work.
  // Every batch has exactly one lifecycle home; pack_complete has none here.
  const stageWork: Record<OperationsLifecycleStage, {
    count: number | null;
    lead?: ReactNode;
    items: ReactNode[];
    empty?: ReactNode;
  }> = {
    receive: {
      count: receiveWorkJobs.length,
      lead: receiveWorkJobs.length > 0 &&
        receiveAssignedWorkSpotlight &&
        !receiveAssignedWorkSpotlight.isDismissed ? (
          <SpotlightCoachMark
            title="Receive work assigned to you"
            body="Open a shipment to review the Receive Brief, then Claim & Start Receive. Assignment reserves the work for you; it does not start the job."
            isDismissed={receiveAssignedWorkSpotlight.isDismissed}
            onDismiss={receiveAssignedWorkSpotlight.dismiss}
          />
        ) : undefined,
      items: receiveWorkJobs.map(renderReceiveCard),
      empty: <StageEmpty>No shipments to receive.</StageEmpty>,
    },
    'put-away': {
      count: visibleStowTasks.length,
      items: visibleStowTasks.map(renderStowCard),
      empty: <StageEmpty>Received stock appears here when it needs a warehouse location.</StageEmpty>,
    },
    pick: {
      count: pickingBatches.length,
      items: pickingBatches.map(renderBatchCard),
      empty: <StageEmpty>No batches to pick.</StageEmpty>,
    },
    pack: {
      // Batch/group grain: a ready batch of N orders is one Pack context.
      count: readyPackBatches.length + packingBatches.length,
      items: [...readyPackBatches, ...packingBatches].map(renderBatchCard),
      empty: <StageEmpty>Picked batches appear here ready to pack.</StageEmpty>,
    },
    ship: {
      count: null,
      items: [],
      empty: (
        <Box
          data-layout="ship-empty-state"
          sx={{
            // PARITY-04: one centered empty-state group filling the stage body.
            flexGrow: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            textAlign: 'center',
            gap: 0.5,
          }}
        >
          {/* Status-neutral: Operations has no canonical carrier status. */}
          <Typography sx={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-2)' }}>Carrier setup</Typography>
          <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
            Packed orders queue here for label and handoff.
          </Typography>
          {onConnectCarrier && (
            <Box component="button" type="button" onClick={onConnectCarrier} sx={{ ...STAGE_TEXT_ACTION_SX, mt: 0.5 }}>
              Configure carriers <span aria-hidden="true">→</span>
            </Box>
          )}
        </Box>
      ),
    },
  };

  // WMS-OPS-OWNER-1A-ALIGNMENT — header summary reads the same stage grain the
  // board reports (jobs, stow tasks, pick batches, Pack contexts). Ship is
  // structural (null) and Count work is not lifecycle work: neither contributes.
  const lifecycleStageCounts = OPERATIONS_LIFECYCLE_STAGES
    .map(({ stage }) => stageWork[stage].count)
    .filter((count): count is number => count !== null);
  const openLifecycleWork = lifecycleStageCounts.reduce((sum, count) => sum + count, 0);
  const activeLifecycleStages = lifecycleStageCounts.filter((count) => count > 0).length;
  const lifecycleSummary =
    `${openLifecycleWork} open ${openLifecycleWork === 1 ? 'task' : 'tasks'} across ` +
    `${activeLifecycleStages} ${activeLifecycleStages === 1 ? 'stage' : 'stages'}`;

  // Reconcile inventory — the single management inventory-maintenance entry.
  // Due = canonical open Count tasks, shown even while recount is locked.
  const reconcileDueCount = countingTasks.length;
  const reconcileOpensCountReveal = !recountLocked && reconcileDueCount > 0;
  const handleReconcile = () => {
    if (recountLocked) {
      onRecountUpgrade?.();
      return;
    }
    if (reconcileDueCount > 0) {
      if (inventoryChecksExpanded) setShowAllInventoryChecks(false);
      setInventoryChecksExpanded((value) => !value);
      return;
    }
    void openCountDialog();
  };

  // Operator shell — Current work (claimed / in progress, resumable by this
  // operator) and Up next (assigned, then available). Ordering is a total
  // order over current data, never input-array order: tier, then oldest,
  // then lifecycle position, then identity.
  type OperatorWorkItem = { key: string; tier: number; at: number; stageOrder: number; node: ReactNode };
  const timeOf = (value?: string | null) => {
    const parsed = value ? Date.parse(value) : Number.NaN;
    return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
  };
  const compareOperatorWork = (a: OperatorWorkItem, b: OperatorWorkItem) =>
    a.tier - b.tier || a.at - b.at || a.stageOrder - b.stageOrder || a.key.localeCompare(b.key);

  const operatorCurrentWork: OperatorWorkItem[] = [];
  const operatorUpNext: OperatorWorkItem[] = [];
  if (isOperatorShell) {
    for (const job of ownReceiveWorkJobs) {
      const started = job.status === 'in_progress' || Boolean(job.started_at);
      (started ? operatorCurrentWork : operatorUpNext).push({
        key: `receive:${job.receive_job_id}`, tier: started ? 0 : 1,
        at: timeOf(job.started_at), stageOrder: 0, node: renderReceiveCard(job),
      });
    }
    for (const task of visibleStowTasks) {
      const claimed = task.status === 'in_progress';
      (claimed ? operatorCurrentWork : operatorUpNext).push({
        key: `stow:${task.stow_task_id}`,
        tier: claimed ? 0 : task.assigned_operator_id === currentUserId ? 1 : 2,
        at: timeOf(claimed ? task.claimed_at ?? task.created_at : task.created_at),
        stageOrder: 1, node: renderStowCard(task),
      });
    }
    for (const batch of pickingBatches) {
      if (batch.status === 'picking' && batch.picked_by !== currentUserId) continue;
      const resuming = batch.status === 'picking';
      (resuming ? operatorCurrentWork : operatorUpNext).push({
        key: `pick:${batch.pick_batch_id}`, tier: resuming ? 0 : 2,
        at: timeOf(batch.released_at), stageOrder: 2, node: renderBatchCard(batch),
      });
    }
    for (const batch of readyPackBatches) {
      operatorUpNext.push({
        key: `pack:${batch.pick_batch_id}`, tier: 2,
        at: timeOf(batch.pick_completed_at ?? batch.released_at), stageOrder: 3, node: renderBatchCard(batch),
      });
    }
    for (const batch of packingBatches) {
      if (batch.packed_by !== currentUserId) continue;
      operatorCurrentWork.push({
        key: `pack:${batch.pick_batch_id}`, tier: 0,
        at: timeOf(batch.pick_completed_at ?? batch.released_at), stageOrder: 3, node: renderBatchCard(batch),
      });
    }
    if (!recountLocked) {
      for (const task of countingTasks) {
        const continuing = task.status === 'claimed' || task.status === 'counting';
        if (continuing ? task.claimed_by !== currentUserId
          : task.assigned_to !== null && task.assigned_to !== currentUserId) continue;
        (continuing ? operatorCurrentWork : operatorUpNext).push({
          key: `count:${task.recount_task_id}`,
          tier: continuing ? 0 : task.assigned_to === currentUserId ? 1 : 2,
          at: timeOf(continuing ? task.claimed_at ?? task.created_at : task.created_at),
          stageOrder: 4, node: renderCountCard(task),
        });
      }
    }
    operatorCurrentWork.sort(compareOperatorWork);
    operatorUpNext.sort(compareOperatorWork);
  }

  return (
    <Box
      sx={{
        p: { xs: '20px 16px', md: '24px' },
        width: '100%',
        maxWidth: 'none',
        // Management grows with work; AppLayout owns vertical page scrolling.
        // Preserve the operator execution shell's existing scroll behavior.
        height: isOperatorShell ? '100%' : 'auto',
        minHeight: 0,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        overflowY: isOperatorShell ? 'auto' : 'visible',
        bgcolor: 'var(--bg)',
      }}
    >

      {/* PAGE HEADER — operator shell (frozen). Management uses the 1a
          Warehouse header region inside the always-mounted composition. */}
      {isOperatorShell && (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 2,
          mb: { xs: 2, lg: 2.5 },
          flexShrink: 0,
        }}
      >
        <Box>
          <Typography sx={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }}>
            Warehouse
          </Typography>
            <Typography sx={{ fontSize: 14, fontWeight: 300, color: 'var(--ink-3)', mt: 0.75 }}>
            {isAllClear(workCounts)
              ? 'All clear — nothing waiting.'
              : 'Work waiting to be done.'}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }}>
          {/*<WmsConnectionBadge isOnline={isOnline} queuedCount={queuedCount} /> */}
          {/* {isOnline && (
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 0.875,
              border: '1px solid rgba(76,175,122,0.3)',
              borderRadius: '100px', px: 1.375, py: 0.625,
            }}>
              <Box sx={{
                width: 6, height: 6, borderRadius: '50%', bgcolor: 'var(--good-ink)',
                '@keyframes wmsOnlinePulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.4 } },
                animation: 'wmsOnlinePulse 2.4s ease-in-out infinite',
              }} />
              <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--good-ink)' }}>Online</Typography>
            </Box>
          )} */}
        </Box>
      </Box>
      )}

      {/* WORK TALLY — everything waiting on the floor, above the fold */}

      {!isOperatorShell && onApproveOpeningInventoryCutover && (
        <OpeningInventoryCutoverCard
          view={openingInventory ?? null}
          canApprove={Boolean(canApproveOpeningInventoryCutover)}
          submitting={Boolean(openingInventoryCutoverSubmitting)}
          error={openingInventoryCutoverError ?? null}
          onApprove={onApproveOpeningInventoryCutover}
        />
      )}

      <Dialog
        open={countDialogOpen}
        onClose={() => {
          if (!countCreating) setCountDialogOpen(false);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Reconcile inventory</DialogTitle>

        <DialogContent dividers>
          <Typography sx={{ fontSize: 13, color: 'var(--ink-3)', mb: 2 }}>
            Count what’s physically in your warehouse and compare it with system stock.
          </Typography>

          {countDialogLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          )}

          {countDialogError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {countDialogError}
            </Alert>
          )}

          {!countDialogLoading && (
            <>
              <RecountEmptyState
                availability={recountBinAvailability}
                onSetupBinsClick={onSetupBinsClick}
              />

              {recountBinAvailability === 'suggestions_available' && (
                <>
                  <Typography
                    sx={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', mb: 1 }}
                  >
                    Suggested bins
                  </Typography>

                  {countBinCanvasSelection.canvasZones.length > 0 && (
                    <Box
                      sx={{
                        height: 260,
                        border: '1px solid var(--rule)',
                        borderRadius: '8px',
                        bgcolor: 'var(--bg-2)',
                        overflow: 'hidden',
                        mb: countBinCanvasSelection.fallbackBins.length > 0 ? 1.5 : 2.5,
                      }}
                    >
                      <IsometricCanvas
                        zones={countBinCanvasSelection.canvasZones}
                        onZoneClick={(locationCode) => {
                          if (
                            countBinCanvasSelection.selectableCodes.has(locationCode)
                          ) {
                            toggleCountBin(locationCode);
                          }
                        }}
                        focusedBins={
                          selectedCanvasBins.length > 0
                            ? selectedCanvasBins
                            : undefined
                        }
                        focusTone="risk"
                        focusDimOpacity={0.58}
                        showLegend={false}
                        showControls={false}
                        disablePan
                        autoFit
                        fitPhysicalFloorFirst
                        fitPadding={0.82}
                      />
                    </Box>
                  )}

                  {countBinCanvasSelection.fallbackBins.length > 0 && (
                    <Box sx={{ display: 'grid', gap: 0.75, mb: 2.5 }}>
                      {countBinCanvasSelection.fallbackBins.map((bin) => {
                        const selected = selectedCountBins.includes(bin.location_code);

                        return (
                          <Box
                            key={bin.location_code}
                            component="button"
                            type="button"
                            onClick={() => toggleCountBin(bin.location_code)}
                            sx={{
                              width: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 2,
                              px: 1.5,
                              py: 1.25,
                              borderRadius: '10px',
                              border: selected
                                ? '2px solid var(--accent)'
                                : '1px solid var(--rule)',
                              bgcolor: selected
                                ? 'var(--bg-3)'
                                : 'var(--bg-2)',
                              color: 'var(--ink)',
                              font: 'inherit',
                              textAlign: 'left',
                              cursor: 'pointer',
                            }}
                          >
                            <Box>
                              <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                                {bin.location_code}
                              </Typography>
                              <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
                                {bin.variant_count} variant{bin.variant_count === 1 ? '' : 's'}
                                {' · '}
                                {bin.reason.replace(/_/g, ' ')}
                              </Typography>
                            </Box>

                            <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
                              {bin.units} units
                            </Typography>
                          </Box>
                        );
                      })}
                    </Box>
                  )}
                </>
              )}

              <TextField
                select
                fullWidth
                size="small"
                label="Assign to"
                value={countAssignedTo}
                onChange={(event) => {
                  const value = event.target.value;
                  setCountAssignedTo(value === '' ? '' : Number(value));
                }}
                sx={{ mb: 2 }}
              >
                <MenuItem value="">Anyone can claim</MenuItem>
                {countAssignees.map((operator) => {
                  const name =
                    `${operator.first_name ?? ''} ${operator.last_name ?? ''}`.trim() ||
                    `Operator ${operator.user_id}`;

                  return (
                    <MenuItem key={operator.user_id} value={operator.user_id}>
                      {name} · {operator.role}
                    </MenuItem>
                  );
                })}
              </TextField>

              <TextField
                fullWidth
                size="small"
                label="Notes"
                placeholder="Optional note"
                multiline
                minRows={2}
                value={countNotes}
                onChange={(event) => setCountNotes(event.target.value)}
              />
            </>
          )}
        </DialogContent>

        <DialogActions>
          <Button
            onClick={() => setCountDialogOpen(false)}
            disabled={countCreating}
            sx={{ color: 'var(--accent-text)' }}
          >
            Cancel
          </Button>

          <Button
            variant="outlined"
            onClick={selectAllSuggestedCountBins}
            disabled={
              countDialogLoading ||
              countCreating ||
              countPreviewBins.length === 0
            }
            sx={{
              borderColor: 'var(--rule)',
              color: 'var(--ink)',
              borderRadius: '6px',
              fontWeight: 600,
            }}
          >
            Select all suggested bins
          </Button>

          <Button
            variant="contained"
            onClick={() => {
              void createCount();
            }}
            disabled={
              countDialogLoading ||
              countCreating ||
              selectedCountBins.length === 0
            }
            sx={{
              bgcolor: 'var(--accent)',
              color: 'var(--accent-ink)',
              borderRadius: '6px',
              fontWeight: 600,
              '&:hover': { bgcolor: 'var(--accent-hover)' },
            }}
          >
            {`Create count · ${selectedCountBins.length} ${
              selectedCountBins.length === 1 ? 'bin' : 'bins'
            }`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* RECOUNT-CLAIM-ABANDONED-131: small, focused — pick a target, explicit
          confirm, no one-click takeover. Not a redesign of the task card. */}
      <Dialog
        open={reassignTask !== null}
        onClose={reassignSubmitting ? undefined : closeReassignDialog}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Reassign count</DialogTitle>

        <DialogContent>
          {reassignTask && (
            <Typography sx={{ fontSize: 13, color: 'var(--ink-3)', mb: 2 }}>
              {reassignTask.label} is currently claimed by another operator.
              Choose who should take it over.
            </Typography>
          )}

          {reassignError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {reassignError}
            </Alert>
          )}

          <TextField
            select
            fullWidth
            size="small"
            label="Reassign to"
            value={reassignTargetId}
            disabled={reassignLoading || reassignSubmitting}
            onChange={(event) => {
              const value = event.target.value;
              setReassignTargetId(value === '' ? '' : Number(value));
            }}
          >
            <MenuItem value="" disabled>
              {reassignLoading ? 'Loading operators…' : 'Select an operator'}
            </MenuItem>
            {reassignTargets
              .filter((operator) => operator.user_id !== reassignTask?.claimed_by)
              .map((operator) => {
                const name =
                  `${operator.first_name ?? ''} ${operator.last_name ?? ''}`.trim() ||
                  `Operator ${operator.user_id}`;

                return (
                  <MenuItem key={operator.user_id} value={operator.user_id}>
                    {name} · {operator.role}
                  </MenuItem>
                );
              })}
          </TextField>
        </DialogContent>

        <DialogActions>
          <Button
            onClick={closeReassignDialog}
            disabled={reassignSubmitting}
            sx={{ color: 'var(--accent-text)' }}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={() => void submitReassign()}
            disabled={reassignTargetId === '' || reassignSubmitting}
            sx={{
              bgcolor: 'var(--accent)',
              color: 'var(--accent-ink)',
              borderRadius: '6px',
              fontWeight: 600,
              '&:hover': { bgcolor: 'var(--accent-hover)' },
            }}
          >
            {reassignSubmitting ? 'Reassigning…' : 'Reassign count'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* STOW-LIFECYCLE-02 — Assign / Reassign Stow task. Owner/admin only
          (advisory gate; wms:stow:assign is backend-authoritative). Mirrors
          the recount reassign dialog above: explicit operator choice, no
          silent takeover. "Make first one to claim" skips this dialog
          entirely — it PATCHes { assigned_operator_id: null } directly. */}
      <Dialog
        open={stowAssignTask !== null}
        onClose={stowAssignSubmitting ? undefined : closeStowAssignDialog}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {stowAssignTask?.assigned_operator_id === null ? 'Assign Stow task' : 'Reassign Stow task'}
        </DialogTitle>

        <DialogContent>
          {stowAssignError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {stowAssignError}
            </Alert>
          )}

          <TextField
            select
            fullWidth
            size="small"
            label="Assign to"
            value={stowAssignTargetId}
            disabled={stowAssignLoading || stowAssignSubmitting}
            onChange={(event) => {
              const value = event.target.value;
              setStowAssignTargetId(value === '' ? '' : Number(value));
            }}
          >
            <MenuItem value="" disabled>
              {stowAssignLoading ? 'Loading operators…' : 'Select an operator'}
            </MenuItem>
            {stowAssignees.map((operator) => {
              const name =
                `${operator.first_name ?? ''} ${operator.last_name ?? ''}`.trim() ||
                `Operator ${operator.user_id}`;

              return (
                <MenuItem key={operator.user_id} value={operator.user_id}>
                  {name} · {operator.role}
                </MenuItem>
              );
            })}
          </TextField>
        </DialogContent>

        <DialogActions>
          <Button
            onClick={closeStowAssignDialog}
            disabled={stowAssignSubmitting}
            sx={{ color: 'var(--accent-text)' }}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={() => void submitStowAssign()}
            disabled={stowAssignTargetId === '' || stowAssignSubmitting}
            sx={{
              bgcolor: 'var(--accent)',
              color: 'var(--accent-ink)',
              borderRadius: '6px',
              fontWeight: 600,
              '&:hover': { bgcolor: 'var(--accent-hover)' },
            }}
          >
            {stowAssignSubmitting
              ? 'Saving…'
              : stowAssignTask?.assigned_operator_id === null
                ? 'Assign'
                : 'Reassign'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* GH-1143 RECEIVE-REASSIGN-UI-01 — Reassign Receive. Owner/admin only
          (advisory gate; the backend assignment PATCH re-validates
          pending/unstarted state atomically). No "Pool"/unassign action —
          Receive reassignment always targets a specific operator. */}
      <Dialog
        open={receiveReassignJob !== null}
        onClose={receiveReassignSubmitting ? undefined : closeReceiveReassignDialog}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Reassign Receive</DialogTitle>

        <DialogContent>
          {receiveReassignJob && (
            <Typography sx={{ fontSize: 13, color: 'var(--ink-3)', mb: 1.5 }}>
              {receiveReassignJob.supplier_name}
            </Typography>
          )}

          {receiveReassignError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {receiveReassignError}
            </Alert>
          )}

          <Box role="radiogroup" aria-label="Reassign Receive to" sx={{ display: 'grid', gap: 0.5 }}>
            {receiveReassignLoading && (
              <Typography sx={{ fontSize: 12, color: 'var(--ink-4)' }}>
                Loading operators…
              </Typography>
            )}
            {receiveReassignTargets.map((operator) => {
              const name =
                `${operator.first_name ?? ''} ${operator.last_name ?? ''}`.trim() ||
                `Operator ${operator.user_id}`;
              const isSelected = receiveReassignTargetId === operator.user_id;

              return (
                <Box
                  key={operator.user_id}
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={0}
                  onClick={() => setReceiveReassignTargetId(operator.user_id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setReceiveReassignTargetId(operator.user_id);
                    }
                  }}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1,
                    py: 0.75,
                    border: '1px solid',
                    borderColor: isSelected ? 'var(--accent)' : 'var(--rule)',
                    borderRadius: 1,
                    cursor: 'pointer',
                  }}
                >
                  <Typography sx={{ fontSize: 13 }}>{name}</Typography>
                </Box>
              );
            })}
          </Box>
        </DialogContent>

        <DialogActions>
          <Button
            onClick={closeReceiveReassignDialog}
            disabled={receiveReassignSubmitting}
            sx={{ color: 'var(--accent-text)' }}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={() => void submitReceiveReassign()}
            disabled={receiveReassignTargetId === '' || receiveReassignSubmitting}
            sx={{
              bgcolor: 'var(--accent)',
              color: 'var(--accent-ink)',
              borderRadius: '6px',
              fontWeight: 600,
              '&:hover': { bgcolor: 'var(--accent-hover)' },
            }}
          >
            {receiveReassignSubmitting ? 'Reassigning…' : 'Reassign'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* LOADING */}
      {(isLoading || loadingSession) && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {/* ERROR */}
      {(isError || sessionError) && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: '10px' }}>
          {sessionError ?? 'Failed to load warehouse data. Please refresh.'}
        </Alert>
      )}

      {/* WMS-OPS-LIFECYCLE-IA-02 — one composition, always mounted. An open
          Ops Console makes it inert in place — still visible underneath the
          overlay (no unmount, no remount, no reflow); the page owns ordinary
          vertical scrolling. */}
      <Box
        aria-hidden={isOpsConsoleOpen ? true : undefined}
        inert={isOpsConsoleOpen ? true : undefined}
        sx={{
          // Management grows with visible work; the operator keeps its grid.
          ...(isOperatorShell
            ? { display: 'grid', alignContent: 'start' }
            : { display: 'flex', flexDirection: 'column', flex: '1 0 auto', minHeight: 'auto' }),
          gap: 2,
          // VISUAL-PARITY-02: Operations stays visibly present (same nodes,
          // same geometry) under the Console overlay; inert + aria-hidden +
          // no pointer events withdraw interaction and focus only.
          pointerEvents: isOpsConsoleOpen ? 'none' : 'auto',
        }}
      >
        {/* Operator: Quick Scan card (unchanged). Management (WMS-OPS-OWNER-1A):
            one Warehouse header region — heading, summary, compact Quick Scan
            and Reconcile. Same scanner node/authority in both shells. */}
        <Box
          component={isOperatorShell ? 'div' : 'section'}
          role={isOperatorShell ? undefined : 'region'}
          aria-labelledby={isOperatorShell ? undefined : managementHeadingId}
          aria-describedby={!isOperatorShell && !isLoading && !loadingSession ? managementSummaryId : undefined}
          sx={isOperatorShell
            ? {
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr)' },
              gap: 1.5,
              alignItems: 'start',
            }
            : {
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'auto minmax(0, 1fr) auto' },
              columnGap: 2.5,
              rowGap: 1.25,
              alignItems: 'center',
              flexShrink: 0,
            }}
        >
      {!isOperatorShell && (
        <Box sx={{ minWidth: 0 }}>
          <Typography
            id={managementHeadingId}
            component="h1"
            sx={{ fontSize: 24, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em' }}
          >
            Warehouse
          </Typography>
          {!isLoading && !loadingSession && (
            <Typography
              id={managementSummaryId}
              sx={{ mt: 0.5, fontSize: 13, fontWeight: 400, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}
            >
              {lifecycleSummary}
            </Typography>
          )}
        </Box>
      )}

      {/* QUICK SCAN — read-only identifier resolution (POST /wms/scan/resolve).
          Stage-neutral: Operations spans the whole lifecycle. Consequential
          Pack scanning lives inside Pack execution, never here. */}
      {/* Operator: the Quick Scan card (unchanged). Management (1a): one 44px
          group — [icon] [textbox] [Listening] — named by a real, SR-only
          "Quick scan" label; no visible title, helper or card anatomy. */}
      <Box
        sx={isOperatorShell
          ? {
            bgcolor: 'var(--surface)',
            border: '1px solid var(--rule)',
            borderRadius: '14px',
            p: '12px 14px',
            minWidth: 0,
          }
          : { minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: { xs: 'stretch', md: 'flex-end' } }}
      >
        <Box
          role={isOperatorShell ? undefined : 'group'}
          aria-labelledby={isOperatorShell ? undefined : quickScanLabelId}
          sx={isOperatorShell
            ? { display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: { xs: 'wrap', md: 'nowrap' } }
            : {
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              height: 44,
              width: '100%',
              maxWidth: 460,
              boxSizing: 'border-box',
              pl: 1.25,
              pr: 0.75,
              bgcolor: 'var(--surface)',
              border: '1px solid',
              borderColor: quickScanError ? 'var(--critical-border)' : 'var(--rule)',
              borderRadius: '10px',
              minWidth: 0,
            }}
        >
          <Box sx={{
            width: isOperatorShell ? 32 : 28, height: isOperatorShell ? 32 : 28, borderRadius: '8px',
            bgcolor: quickScanError ? 'var(--critical-ghost)' : 'var(--accent-ghost)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {quickScanLoading
              ? <CircularProgress size={16} sx={{ color: 'var(--accent-text)' }} />
              : <ScanBarcode size={18} color={quickScanError ? 'var(--critical-ink)' : 'var(--accent)'} />}
          </Box>
          <Typography
            id={quickScanLabelId}
            sx={isOperatorShell ? { fontSize: 14, fontWeight: 500, color: 'var(--ink)', flexShrink: 0 } : SR_ONLY_SX}
          >
            Quick scan
          </Typography>

          <Box sx={isOperatorShell
            ? {
              flex: '1 1 280px',
              minWidth: 0,
              bgcolor: 'var(--bg)',
              border: '1.5px solid',
              borderColor: quickScanError ? 'var(--critical-border)' : 'var(--accent-border)',
              borderRadius: '8px',
              px: 1.5, py: 0.75,
            }
            : { flex: '1 1 auto', minWidth: 0 }}>
            <TextField
              inputRef={quickScanInputRef}
              fullWidth
              variant="standard"
              placeholder={isOperatorShell
                ? 'Scan an item or invoice barcode, bin or order number'
                : 'Scan an item or invoice barcode'}
              inputProps={isOperatorShell ? undefined : { 'aria-labelledby': quickScanLabelId }}
              disabled={quickScanLoading}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = quickScanInputRef.current?.value.trim();
                  if (val) void handleQuickScanResolve(val);
                }
              }}
              autoComplete="off"
              InputProps={{ disableUnderline: true }}
              sx={{
                '& .MuiInputBase-input': {
                  fontFamily: 'inherit',
                  fontSize: 15, color: 'var(--ink-3)',
                  '&::placeholder': { color: 'var(--ink-4)' },
                },
              }}
            />
          </Box>

          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0, flexGrow: 0,
            border: `1px solid ${quickScanError ? 'var(--critical-border)' : 'var(--accent-border)'}`,
            borderRadius: '100px', px: 1.375, py: 0.5,
          }}>
            <Box sx={{
              width: 5, height: 5, borderRadius: '50%',
              bgcolor: quickScanError ? 'var(--critical-ink)' : 'var(--accent)',
              ...(!quickScanError && !quickScanLoading && {
                '@keyframes wmsListenPulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.4 } },
                animation: 'wmsListenPulse 1.6s ease-in-out infinite',
              }),
            }} />
            <Typography sx={{ fontSize: 11.5, fontWeight: 500, color: quickScanError ? 'var(--critical-ink)' : 'var(--accent)' }}>
              {quickScanLoading ? 'Resolving…' : quickScanError ? 'Hold' : 'Listening'}
            </Typography>
          </Box>
        </Box>

        {quickScanError && (
          <Alert severity="error" sx={{ mt: 1, py: 0.5, fontSize: 13, borderRadius: '8px' }}>
            {quickScanError}
          </Alert>
        )}

        {quickScanResult && (
          <Typography role="status" sx={{ mt: 1, fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
            {quickScanResult}
          </Typography>
        )}

        {isOperatorShell && (
          <Typography sx={{ mt: 0.75, fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
            Look up anything in the warehouse · scanner auto-submits · manual entry: press Enter
          </Typography>
        )}
      </Box>

      {!isOperatorShell && canManageRecount && !isLoading && !loadingSession && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, justifySelf: { xs: 'start', md: 'end' } }}>
          <Button
            variant={reconcileDueCount > 0 ? 'contained' : 'outlined'}
            data-emphasis={reconcileDueCount > 0 ? 'primary' : 'secondary'}
            aria-describedby={reconcileDueId}
            aria-expanded={reconcileOpensCountReveal ? inventoryChecksExpanded : undefined}
            onClick={handleReconcile}
            sx={reconcileDueCount > 0
              ? {
                height: 44,
                bgcolor: 'var(--accent)',
                color: 'var(--accent-ink)',
                borderRadius: '6px',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                '&:hover': { bgcolor: 'var(--accent-hover)' },
              }
              : {
                height: 44,
                bgcolor: 'transparent',
                color: 'var(--ink-2)',
                borderColor: 'var(--rule)',
                borderRadius: '6px',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                '&:hover': { bgcolor: 'var(--surface)', borderColor: 'var(--ink-4)' },
              }}
          >
            Reconcile inventory
          </Button>
          <Typography
            id={reconcileDueId}
            component="span"
            sx={{
              fontSize: 12,
              fontWeight: 500,
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
              color: reconcileDueCount > 0 ? 'var(--ink-2)' : 'var(--ink-4)',
            }}
          >
            {`${reconcileDueCount} due`}
          </Typography>

          {recountLocked && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                bgcolor: 'var(--accent-ghost)',
                border: '1px solid var(--accent-border)',
                borderRadius: '4px',
                px: '4px',
                py: '1px',
              }}
            >
              <ArrowUp size={8} color="var(--accent)" strokeWidth={2.5} />
              <Typography
                sx={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: 'var(--accent-text)',
                  lineHeight: 1.6,
                }}
              >
                Core
              </Typography>
            </Box>
          )}
        </Box>
      )}

      {/* Existing bounded Count-task reveal, now entered only through
          Reconcile inventory while Count work is due. */}
      {!isOperatorShell && !isLoading && !loadingSession && reconcileOpensCountReveal && inventoryChecksExpanded && (
        <Box
          sx={{
            gridColumn: '1 / -1',
            border: '1px solid var(--rule)',
            borderRadius: '10px',
            bgcolor: 'var(--surface)',
            overflow: 'hidden',
          }}
        >
          {(showAllInventoryChecks ? countingTasks : countingTasks.slice(0, 4)).map((task) => (
            <CountingTaskCard
              key={task.recount_task_id}
              task={task}
              currentUserId={currentUserId}
              canReassignCount={canReassignCount}
              onReassignRequest={(t) => void openReassignDialog(t)}
              onOpen={(selectedTask) => {
                onCountSessionEnter?.(selectedTask.recount_task_id);
                setActiveSession({
                  type: 'count',
                  task: selectedTask,
                });
              }}
            />
          ))}

          {countingTasks.length > 4 && (
            <Box
              onClick={() => setShowAllInventoryChecks((value) => !value)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 0.5,
                px: 2.5,
                py: 1.125,
                borderTop: '1px solid var(--rule)',
                color: 'var(--accent-text)',
                cursor: 'pointer',
                '&:hover': { opacity: 0.75 },
              }}
            >
              <Typography sx={{ fontSize: 11, fontWeight: 500 }}>
                {showAllInventoryChecks
                  ? 'Show less'
                  : `See ${countingTasks.length - 4} more`}
              </Typography>
              {showAllInventoryChecks
                ? <ChevronUp size={13} />
                : <ChevronDown size={13} />}
            </Box>
          )}
        </Box>
      )}
        </Box>

      {/* WMS-OPS-NEEDS-ATTENTION-01 — overview level, outside every lifecycle stage. */}
      {!isLoading && !loadingSession && !isOperatorShell && needsAttention && needsAttention.rows.length > 0 && (
        <NeedsAttentionStrip
          attention={needsAttention}
          onAction={onNeedsAttentionAction}
          onOpenHistory={onOpenHistory}
          onOpenAll={onOpenAllAttention}
        />
      )}

      {/* WMS-OPS-OWNER-1A-ALIGNMENT — one pipeline board. The five stages are
          its direct children on one continuous surface; one stable track
          definition (no 1/2/5 wrapping). The page scrolls vertically when
          work exceeds the viewport. Below lg the BOARD also scrolls
          horizontally — a stage never scrolls. */}
      {!isLoading && !loadingSession && !isOperatorShell && (
        <Box
          component="section"
          role="region"
          aria-label="Warehouse pipeline"
          sx={{
            flex: '1 0 auto',
            // Keep the horizontal scroll container at least as tall as its work.
            minHeight: 'min-content',
            display: 'grid',
            alignItems: 'stretch',
            gridTemplateColumns: `repeat(${OPERATIONS_LIFECYCLE_STAGES.length}, minmax(0, 1fr))`,
            // Below lg five usable tracks no longer fit: tracks get a minimum
            // width and the BOARD alone scrolls horizontally (never a stage).
            '@media (max-width: 1199.95px)': {
              gridTemplateColumns: `repeat(${OPERATIONS_LIFECYCLE_STAGES.length}, minmax(180px, 1fr))`,
              overflowX: 'auto',
              overflowY: 'hidden',
            },
            // Desktop: no scroll container on either axis (visible on both, so
            // the browser never promotes one axis to auto).
            overflowX: 'visible',
            overflowY: 'visible',
            // Finite board edge: one outer boundary and radius, longhand so
            // every side/corner (incl. the bottom) is explicit.
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: 'var(--rule)',
            borderTopLeftRadius: '12px',
            borderTopRightRadius: '12px',
            borderBottomLeftRadius: '12px',
            borderBottomRightRadius: '12px',
            // PARITY-02: the board is page canvas; only work cards are raised.
            bgcolor: 'var(--bg)',
          }}
        >
          {OPERATIONS_LIFECYCLE_STAGES.map(({ stage, label }) => {
            const work = stageWork[stage];
            return (
              <LifecycleStageRegion
                key={stage}
                label={label}
                count={work.count}
                description={describeStageCount(stage, work.count ?? 0)}
                lead={work.lead}
                items={work.items}
                empty={work.empty}
                onViewAll={stage === 'ship' ? undefined : () => setStageListStage(stage)}
              />
            );
          })}
        </Box>
      )}

      {/* WMS-OPS-MODAL-PARITY-01 — full stage task list: the same work-card
          nodes in the same canonical order, inspection framing only. */}
      {!isLoading && !loadingSession && !isOperatorShell && (
        <EntityDetailModal
          entityId={stageListStage}
          onClose={closeStageList}
          title={stageListStage ? STAGE_LIST_COPY[stageListStage].title : ''}
          subtitle={stageListStage
            ? `${stageWork[stageListStage].items.length} ${
                stageWork[stageListStage].items.length === 1
                  ? STAGE_LIST_COPY[stageListStage].singular
                  : STAGE_LIST_COPY[stageListStage].plural
              }`
            : undefined}
        >
          {stageListStage && (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
                gap: 1.5,
                minWidth: 0,
              }}
            >
              {stageWork[stageListStage].items}
            </Box>
          )}
        </EntityDetailModal>
      )}

      {!isLoading && !loadingSession && isOperatorShell && (
        <Box sx={{ display: 'grid', gap: 1.5, maxWidth: 760 }}>
          {/* Lifecycle orientation only — not five management work regions. */}
          <Box
            component="ol"
            aria-label="Warehouse lifecycle"
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, listStyle: 'none', m: 0, p: 0 }}
          >
            {OPERATIONS_LIFECYCLE_STAGES.map(({ stage, label }, index) => (
              <Box component="li" key={stage} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                {index > 0 && <Box component="span" aria-hidden="true" sx={{ color: 'var(--ink-4)', fontSize: 11 }}>→</Box>}
                <Typography component="span" sx={{ fontSize: 11.5, fontWeight: 500, color: 'var(--ink-3)' }}>
                  {label}
                </Typography>
              </Box>
            ))}
          </Box>

          {[
            { title: 'Current work', work: operatorCurrentWork, empty: 'Nothing in progress.', more: 0 },
            { title: 'Up next', work: operatorUpNext.slice(0, OPERATOR_UP_NEXT_LIMIT), empty: 'No work waiting.', more: Math.max(0, operatorUpNext.length - OPERATOR_UP_NEXT_LIMIT) },
          ].map(({ title, work, empty, more }) => (
            <Box
              key={title}
              component="section"
              role="region"
              aria-label={title}
              sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '10px', p: '12px' }}
            >
              <Typography component="h2" sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', mb: 1.25 }}>
                {title}
              </Typography>
              {work.length > 0 ? work.map((item) => item.node) : <StageEmpty>{empty}</StageEmpty>}
              {more > 0 && (
                <Typography sx={{ mt: 0.5, fontSize: 11.5, fontWeight: 300, color: 'var(--ink-4)' }}>
                  {`+${more} more waiting`}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}
      </Box>
    </Box>
  );
}

export default function WmsModuleFT2(props: WmsModuleFT2Props) {
  return <ModuleErrorBoundary moduleName="wms"><WmsModuleFT2Inner {...props} /></ModuleErrorBoundary>;
}
