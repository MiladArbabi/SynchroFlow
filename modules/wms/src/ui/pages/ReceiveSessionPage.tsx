// modules/wms/src/ui/pages/ReceiveSessionPage.tsx
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import {
  AlertTriangle,
  CheckCircle,
  Hash,
  Package,
  PackageX,
  ScanBarcode,
} from 'lucide-react';
import {
  ReceiveActions,
  ReceiveCta,
  ReceiveExitSheet,
  ReceiveFactStrip,
  ReceiveFooterButton,
  ReceiveItemLine,
  ReceiveProductImage,
  ReceiveLinesDrawer,
  ReceiveListPager,
  RECEIVE_LIST_PAGE_SIZE,
  ReceivePill,
  ReceivePillRow,
  ReceiveSeal,
  ReceiveSessionShell,
  ReceiveStatusLine,
  ReceiveTaskHeading,
  ReceiveTextAction,
  receiveFocusRingSx,
  receiveTouchTargetSx,
  type ReceiveBarTone,
  type ReceiveStatusTone,
} from '../components/receive/ReceiveSessionShell';

type SessionPhase = 'brief' | 'inspect' | 'reconcile' | 'review' | 'handoff';
type LineAction = 'scan' | 'count';

const ACTIVE_RECEIVE_JOB_STATUSES = new Set([
  'in_progress',
  'inspection',
  'barcode_assignment',
  'stow_ready',
]);

/**
 * WS-UX-RECEIVE-D4R S8-C3 — the host's report of one canonical refresh.
 * applied:false means the read was skipped, superseded or belonged to an
 * older session; it is never evidence of the Receive's state.
 */
export type ReceiveRefreshResult =
  | { applied: true; jobStatus: string | null; closedAt: string | null }
  | { applied: false };

type CanonicalCloseStatus = 'closed' | 'open' | 'unknown';

const CLOSE_UNKNOWN_MESSAGE = "We couldn't confirm whether this Receive closed. Check its latest status before trying again.";
const CLOSE_OPEN_MESSAGE = 'This Receive is still open. You can try closing it again.';

/**
 * S8-C3 — a definitive close refusal, as operator instructions. null means the
 * response is no proof the close failed (no response, 5xx, Already closed,
 * terminal job): the caller must read the canonical status instead.
 */
/** S8-C5 — a definitive Recount refusal: the server changed nothing. */
function recountRefusalMessage(err: any): string {
  const code = err?.response?.data?.code;
  if (code === 'RECEIVE_LINE_ALREADY_INSPECTED') return 'This product is already finished, so it can\'t be recounted. Nothing was changed.';
  if (code === 'RECEIVE_JOB_TERMINAL') return 'This Receive is finished, so it can\'t be recounted. Nothing was changed.';
  if (code === 'RECEIVE_RECOUNT_GROUPED' || code === 'RECEIVE_RECONCILIATION_FINALIZED') {
    return 'This Receive is checked as a group, so this product can\'t be recounted here. Nothing was changed.';
  }
  if (err?.response?.status === 403) return 'This Receive isn\'t assigned to you, so it can\'t be recounted. Nothing was changed.';
  return 'The Recount wasn\'t accepted. Nothing was changed.';
}

function closeRefusalMessage(err: any): string | null {
  const status = Number(err?.response?.status);
  if (!err?.response || !Number.isFinite(status) || status >= 500) return null;
  const refusal = String(err?.response?.data?.error ?? '');
  if (/already closed|is terminal/i.test(refusal)) return null;
  if (err?.response?.data?.code === 'RECEIVE_HELD_CUSTODY_REQUIRED' || /RECEIVE_HELD_CUSTODY_REQUIRED/.test(refusal)) {
    return 'Some units held for repair still need placing in a problem bin before this Receive can close.';
  }
  if (err?.response?.data?.code === 'RECEIVE_BARCODE_READINESS_REQUIRED' || /RECEIVE_BARCODE_READINESS_REQUIRED/.test(refusal)) {
    return 'Some unit labels still need confirmation before this Receive can close.';
  }
  if (/not yet inspected/i.test(refusal)) return 'Some products still need inspection. Finish those products before closing.';
  if (/delivery accounting|grouped reconciliation/i.test(refusal)) return 'Some products still need their delivery counts finished before this Receive can close.';
  if (/cancelled po/i.test(refusal)) return 'This purchase order was cancelled, so this Receive can’t close. Return to Operations.';
  if (status === 400) return 'Enter a valid actual delivery date, then try again.';
  if (status === 401 || status === 403) return 'You don’t have access to close this Receive. Ask a lead for help.';
  if (status === 404) return 'This Receive couldn’t be found. Return to Operations and reopen it.';
  return 'This Receive couldn’t close. Review the products above, then try again.';
}

export interface ReceiveJobLine {
  receive_job_line_id: string;
  lasyncro_variant_id: string | null;
  sku: string | null;
  variant_title: string | null;
  description: string | null;
  quantity_expected: number;
  quantity_accepted?: number;
  quantity_rejected?: number;
  quantity_missing?: number | null;
  quantity_deferred?: number | null;
  quantity_sellable_provisional?: number | null;
  reconciliation_started_at?: string | null;
  /** GH-1241 S3-A1 — the operator's persisted physical count; null = never confirmed. */
  quantity_count_confirmed?: number | null;
  count_confirmed_at?: string | null;
  /** GH-1241 S3-A1 — GET evidence contract; only 'confirmed' is a physical count. */
  count_state?: 'not_counted' | 'confirmed' | 'inspected';
  inspection_complete?: boolean;
  image_url: string | null;
  barcode: string | null;
  product_title: string | null;
  barcode_ready?: boolean;
  barcode_readiness_reason?:
    | 'not_inspected'
    | 'no_accepted_units'
    | 'external_barcode'
    | 'labels_acknowledged'
    | 'labels_outstanding'
    | 'unit_evidence_mismatch';
  awaiting_label_ack?: boolean;
  accepted_unit_count?: number;
  labelled_unit_count?: number;
  reported_problems?: ReceiveReportedProblem[];
  /** S4-4C — held LSUs of this line and their server-authoritative problem-bin custody. */
  held_units?: ReceiveHeldUnit[];
  reconciliation?: {
    expected: number;
    sellable: number;
    accounted: number;
    unaccounted: number;
    allocations: ReceiveReportedProblem[];
    /**
     * GH-1108 / RECEIVE-OVERCOUNT-01 — true once the canonical extra_item /
     * accounting_role=overage exception has been persisted for this line
     * (receiveLineReconciliationState's isPersistedOverageApproval). Lets a
     * refreshed/re-entered session reconstruct an already-approved
     * over-delivery decision from server data instead of local UI state.
     */
    overage_approved?: boolean;
    /**
     * GH-1241 S3-A1 — what `sellable` is: an uncounted projection (untouched
     * line), an unconfirmed draft, the operator's confirmed count, or the
     * inspected result. Only 'confirmed_count' / 'inspected' are counts.
     */
    sellable_basis?: 'uncounted_projection' | 'unconfirmed_draft' | 'confirmed_count' | 'inspected';
  };
}

export interface ReceiveReportedProblem {
  receive_exception_id: string;
  exception_type: ProblemType | string;
  quantity_affected: number;
  notes?: string | null;
  resolved?: boolean;
  raised_at?: string | null;
  counts_toward_shortfall?: boolean;
  /** 'shortfall' | 'overage' | null — GET receive job reported_problems. */
  accounting_role?: string | null;
  /** S4-4C — 'recoverable_held' for units held for repair; null = legacy evidence. */
  disposition?: string | null;
}

/** S4-4C — GET receive job lines[].held_units. */
export interface ReceiveHeldUnit {
  lasyncro_unit_id: string;
  label_acknowledged: boolean;
  location_code: string | null;
  placed: boolean;
}

/** S4-4C — a problem bin resolved from a scanned barcode or typed location code. */
export interface ReceiveProblemBin {
  location_code: string;
  barcode: string | null;
}

export interface ReceiveSessionPageProps {
  receiveJobId: string;
  poId: string;
  poNumber?: number | null;
  supplierName: string;
  jobStatus?: string;
  assignedOperatorId?: number | null;
  currentUserId?: number | null;
  closedAt?: string | null;
  actualDeliveryDate?: string | null;
  lines: ReceiveJobLine[];
  onClaimJob?: () => Promise<void>;
  onInspectLine: (params: {
    lasyncro_variant_id: string | null;
    receive_job_line_id: string;
    quantity_accepted: number;
    quantity_rejected: number;
    quantity_missing?: number;
    quantity_deferred?: number;
  }) => Promise<void>;
  onReportException: (params: {
    lasyncro_variant_id: string | null;
    receive_job_line_id: string;
    exception_type: string;
    quantity_affected: number;
    accounting_role?: string;
    notes?: string;
  }) => Promise<void>;
  /** Persists explicit overage approval before inspection. */
  onApproveOverDelivery: (params: {
    lasyncro_variant_id: string | null;
    receive_job_line_id: string;
    quantity_affected: number;
    notes: string;
  }) => Promise<void>;
  onPersistLineProgress?: (
    receiveJobLineId: string,
    params: { quantity_sellable_provisional: number; reconciliation_required?: boolean; quantity_deferred?: number }
  ) => Promise<void>;
  /**
   * GH-1241 S3-A1 — persists the operator's explicit physical count for a
   * line. Inspection is refused without it, so a host that omits it cannot
   * finish lines (fails closed).
   */
  onConfirmLineCount?: (
    receiveJobLineId: string,
    params: { quantity_confirmed: number }
  ) => Promise<void>;
  /**
   * S8-C5 — Recount a line after shortfall allocations were saved (before
   * inspection): the server supersedes them and voids the count. Without it,
   * Recount stays available only while nothing is allocated (client-only).
   */
  onRecountLine?: (receiveJobLineId: string) => Promise<void>;
  onCloseJob: (params: { actual_delivery_date?: string }) => Promise<void>;
  onComplete: () => void;
  onResolveBarcode?: (scannedValue: string) => Promise<{ lasyncro_variant_id: string } | null>;
  onPrintUnitLabels?: (receiveJobLineId: string) => Promise<void>;
  onConfirmUnitLabelsPrinted: (receiveJobLineId: string) => Promise<void>;
  /** S4-4C — resolve a scanned or typed problem-bin value to its Floor Planning location. */
  onResolveProblemBin?: (scannedValue: string) => Promise<ReceiveProblemBin>;
  /**
   * S4-4C — place one held LSU into a problem bin. The host owns the
   * device_event_id and reuses it until the request succeeds, so a retry after
   * an interrupted request replays instead of placing twice.
   */
  onPlaceHeldUnit?: (params: { lasyncro_unit_id: string; location_code: string }) => Promise<{ replayed: boolean }>;
  /** S8-C3 — the WMS host returns a ReceiveRefreshResult; other hosts may return nothing (never close evidence). */
  onRefresh?: () => Promise<ReceiveRefreshResult | void> | void;
  /**
   * WAREHOUSE-FOCUS-SHELL-01A — reports whether the operator is actively
   * executing this Receive job (sessionPhase !== 'brief') versus still on
   * the pre-execution Brief. Driven by an effect over sessionPhase rather
   * than called ad hoc from individual handlers, so every path that can
   * change sessionPhase — successful claim/start, a canonical in_progress
   * job initializing straight into 'inspect' on refresh, reconcile/review/
   * handoff — reports focus consistently, and a failed claim (which never
   * calls setSessionPhase) never does.
   */
  onExecutionFocusChange?: (focused: boolean) => void;
  /**
   * GH-1241 S3C-M1 — the host-resolved session mode (resolveReceiveSessionMode).
   * Omitted only by direct renders of the existing per-line page; the WMS
   * host always resolves and passes it.
   */
  sessionMode?: ReceiveSessionMode;
  /** GH-1241 S3C-M1 — canonical GET /reconciliation evidence for grouped modes. */
  reconciliation?: ReceiveReconciliationEvidence | null;
  /** GH-1241 S3C-M3 — PUT /reconciliation/draft (the host owns the idempotency event). */
  onSaveReconciliationDraft?: (payload: ReceiveReconciliationDraftPayload) => Promise<ReceiveReconciliationRevisionResult>;
  /** GH-1241 S3C-M3 — POST /reconciliation/finalize of exactly the saved revision payload. */
  onFinalizeReconciliation?: (payload: ReceiveReconciliationFinalizePayload) => Promise<unknown>;
}

/** GH-1241 S3C-M1 — how this Receive session may proceed. */
export type ReceiveSessionMode = 'resolving' | 'per_line' | 'grouped' | 'grouped_finalized' | 'unavailable';

/** GH-1241 S3-B — new discrepancy evidence a grouped line reports. */
export interface ReceiveReconciliationException {
  exception_type: string;
  quantity_affected: number;
  accounting_role: string | null;
  notes?: string | null;
  /** S4-4C — present only for units held for repair (defect / packaging_damage). */
  disposition?: 'recoverable_held';
}

/** GH-1241 S3-B — one line of a grouped draft revision or finalization. */
export interface ReceiveReconciliationLinePayload {
  receive_job_line_id: string;
  quantity_accepted: number;
  quantity_rejected: number;
  quantity_missing: number;
  quantity_deferred: number;
  quantity_held_recoverable?: number;
  new_exceptions?: ReceiveReconciliationException[];
  existing_exception_ids?: string[];
}

/** GH-1241 S3C-M3 — PUT /reconciliation/draft body (without the host-owned event). */
export interface ReceiveReconciliationDraftPayload {
  base_revision_id: string | null;
  lines: ReceiveReconciliationLinePayload[];
}

/** GH-1241 S3C-M3 — POST /reconciliation/finalize body (without the host-owned event). */
export interface ReceiveReconciliationFinalizePayload {
  current_revision_id: string;
  lines: ReceiveReconciliationLinePayload[];
}

/** GH-1241 S3-B — PUT /reconciliation/draft response. */
export interface ReceiveReconciliationRevisionResult {
  revision_id: string;
  revision_number?: number;
  base_revision_id?: string | null;
  status?: string;
}

/** GH-1241 S3-B — GET /receive-jobs/:jobId/reconciliation (fields the session reads). */
export interface ReceiveReconciliationEvidence {
  receive_job_id?: string;
  status: string;
  current_revision_id: string | null;
  revisions: Array<{ revision_id: string; status: string; lines: ReceiveReconciliationLinePayload[] }>;
  lines: Array<{ receive_job_line_id: string; quantity_expected: number }>;
  finalization: { reconciliation_id: string; revision_id: string; lines: ReceiveReconciliationLinePayload[] } | null;
}

/**
 * GH-1241 S3-B — an expected-zero line a grouped finalization left out: no
 * count, no inspection, no label hold. Excluded from completion navigation.
 */
function isExcludedExpectedZeroLine(line: ReceiveJobLine): boolean {
  return Number(line.quantity_expected) === 0
    && !line.inspection_complete
    && line.quantity_count_confirmed == null
    && !line.awaiting_label_ack;
}

/**
 * GH-1241 S3C-M1 — deterministic Receive session mode from canonical job data
 * (delivery_accounting_version, per-line inspection) plus GET /reconciliation.
 * Anything unknown, missing or contradictory is 'unavailable' (fail closed);
 * there is no fallback to the per-line journey.
 */
export function resolveReceiveSessionMode(input: {
  receiveJobId: string;
  deliveryAccountingVersion: number | null | undefined;
  lines: ReceiveJobLine[];
  reconciliation: ReceiveReconciliationEvidence | null | undefined;
}): Exclude<ReceiveSessionMode, 'resolving'> {
  const version = input.deliveryAccountingVersion == null ? null : Number(input.deliveryAccountingVersion);
  if (version === 1) return 'per_line';
  if (version !== 2) return 'unavailable';

  const evidence = input.reconciliation;
  if (!evidence || typeof evidence !== 'object') return 'unavailable';
  if (evidence.receive_job_id != null && evidence.receive_job_id !== input.receiveJobId) return 'unavailable';

  const anyInspected = input.lines.some((line) => line.inspection_complete);
  if (evidence.status === 'finalized') {
    // Every non-excluded line must carry the finalized inspection.
    const unfinished = input.lines.some((line) => !line.inspection_complete && !isExcludedExpectedZeroLine(line));
    return evidence.finalization && !unfinished ? 'grouped_finalized' : 'unavailable';
  }
  if (evidence.status === 'draft') {
    const current = evidence.current_revision_id
      ? (evidence.revisions ?? []).find((revision) => revision.revision_id === evidence.current_revision_id)
      : undefined;
    // A draft alongside per-line inspection is conflicting evidence.
    return current && !anyInspected ? 'grouped' : 'unavailable';
  }
  if (evidence.status === 'open') return anyInspected ? 'per_line' : 'grouped';
  return 'unavailable';
}

type ProblemType = 'deferred' | 'defect' | 'packaging_damage' | 'wrong_item' | 'wrong_variant' | 'wrong_quantity' | 'missing_item' | 'extra_item' | 'barcode_mismatch' | 'other';

type ProblemChoice =
  | 'defect'
  | 'packaging_damage'
  | 'wrong_item'
  | 'wrong_variant'
  | 'missing_item'
  | 'extra_item'
  | 'barcode_mismatch'
  | 'other';

const PROBLEM_LABELS: Record<ProblemType, string> = {
  deferred: 'Later delivery',
  defect: 'Damaged unit',
  packaging_damage: 'Damaged packaging',
  wrong_item: 'Wrong product',
  wrong_variant: 'Wrong variant',
  wrong_quantity: 'Missing or extra',
  missing_item: 'Missing item',
  extra_item: 'Extra item',
  barcode_mismatch: 'Barcode problem',
  other: 'Other problem',
};

const PROBLEM_CHOICES: Array<{
  id: ProblemChoice;
  label: string;
  problemType: ProblemType;
  defaultNotes?: string;
}> = [
  { id: 'defect', label: 'Damaged unit', problemType: 'defect' },
  { id: 'packaging_damage', label: 'Damaged packaging', problemType: 'packaging_damage' },
  { id: 'wrong_item', label: 'Wrong product', problemType: 'wrong_item' },
  { id: 'wrong_variant', label: 'Wrong variant', problemType: 'wrong_variant' },
  {
    id: 'missing_item',
    label: 'Missing item',
    problemType: 'missing_item',
    defaultNotes: 'Missing item reported during receive',
  },
  {
    id: 'extra_item',
    label: 'Extra item',
    problemType: 'extra_item',
    defaultNotes: 'Extra item reported during receive',
  },
  { id: 'barcode_mismatch', label: 'Barcode problem', problemType: 'barcode_mismatch' },
  { id: 'other', label: 'Other', problemType: 'other' },
];

// WS-UX-RECEIVE-D4R S3 / owner decision O2 — the six canonical shortfall
// reasons. Barcode mismatch is never one: it consumes no shortfall and stays
// on its own scan/problem path.
const RECONCILIATION_CHOICES: Array<{ type: ProblemType; label: string; hint: string; requiresNotes?: boolean }> = [
  { type: 'deferred', label: 'Later delivery', hint: 'Coming in a later delivery' },
  { type: 'defect', label: 'Damaged unit', hint: 'Set aside, not sellable' },
  { type: 'wrong_item', label: 'Wrong product', hint: 'Different product sent' },
  { type: 'wrong_variant', label: 'Wrong variant', hint: 'Different size or colour' },
  { type: 'missing_item', label: 'Missing item', hint: 'Not in the delivery' },
  { type: 'other', label: 'Other', hint: 'Notes required', requiresNotes: true },
];

const OPS_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
const monoSx = { fontFamily: OPS_MONO, letterSpacing: 0 };

const OPS_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatOpsDate(value?: string | null): string {
  if (!value) return '—';

  const calendarDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (calendarDate) {
    const [, year, month, day] = calendarDate;
    return `${Number(day)} ${OPS_MONTHS[Number(month) - 1]} ${year}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return `${parsed.getDate()} ${OPS_MONTHS[parsed.getMonth()]} ${parsed.getFullYear()}`;
}

function formatOpsTimestamp(value?: string | null): string {
  if (!value) return '—';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');

  return `${parsed.getDate()} ${OPS_MONTHS[parsed.getMonth()]} ${parsed.getFullYear()} · ${hours}:${minutes}`;
}
const countStepperButtonSx = (emphasized = false) => ({
  minWidth: 0,
  height: { xs: 64, md: 88 },
  px: 0,
  borderRadius: '10px',
  bgcolor: 'var(--surface)',
  borderColor: emphasized ? 'var(--rule-2)' : 'var(--rule-2)',
  color: 'var(--ink)',
  fontSize: 30,
  fontWeight: 300,
  '&:hover': {
    bgcolor: 'var(--bg-2)',
    borderColor: 'var(--rule-2)',
  },
  '&.Mui-disabled': {
    bgcolor: 'var(--surface)',
    borderColor: 'var(--rule)',
  },
  ...receiveFocusRingSx,
} as const);
// WS-UX-RECEIVE-D4R S1 — the counter's physical-count value (88/64px light).
const countValueSx = {
  width: '100%',
  '& .MuiInputBase-input': {
    fontSize: { xs: 64, md: 88 },
    lineHeight: 1,
    height: 'auto',
    color: 'var(--ink)',
    fontVariantNumeric: 'tabular-nums',
  },
  // S8-C4 — the empty-count placeholder is a label, not a numeral: sized to fit.
  '& .MuiInputBase-input::placeholder': {
    fontSize: { xs: 28, md: 36 },
    color: 'var(--ink-3)',
    opacity: 1,
  },
} as const;
const reconciliationChoiceSx = (selected: boolean) => ({
  minHeight: { xs: 46, md: 48 },
  px: 1.75,
  py: 0.75,
  borderRadius: '10px',
  justifyContent: 'flex-start',
  textAlign: 'left',
  textTransform: 'none',
  bgcolor: selected ? 'var(--accent-ghost)' : 'var(--surface)',
  border: selected ? '2px solid var(--accent)' : '1px solid var(--rule-2)',
  color: 'var(--ink)',
  boxShadow: 'none',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
  '&:hover': {
    bgcolor: selected ? 'var(--accent-ghost)' : 'var(--bg-2)',
    borderColor: selected ? 'var(--accent)' : 'var(--rule-2)',
  },
  '&.Mui-focusVisible': {
    outline: '2px solid var(--accent)',
    outlineOffset: 2,
  },
  '&.Mui-disabled': {
    bgcolor: 'var(--surface)',
    borderColor: 'var(--rule)',
  },
} as const);

function lineName(line: ReceiveJobLine): string {
  return line.product_title ?? line.variant_title ?? line.description ?? line.sku ?? 'Unknown item';
}

function variantName(line: ReceiveJobLine): string {
  return line.variant_title && line.variant_title !== 'Default Title'
    ? line.variant_title
    : line.description ?? line.sku ?? 'Default variant';
}

function hasExternalBarcode(line: ReceiveJobLine): boolean {
  return !!line.barcode?.trim();
}

function statusLabel(line: ReceiveJobLine, awaitingLabel: boolean, complete: boolean): string {
  if (awaitingLabel) return 'label hold';
  if (complete) return 'received';
  if (hasExternalBarcode(line)) return 'scan or count';
  return 'count only';
}

function problemLabel(exceptionType: string): string {
  return PROBLEM_LABELS[exceptionType as ProblemType] ?? 'Reported problem';
}

function unitLabel(quantity: number): string {
  return `${quantity} unit${quantity === 1 ? '' : 's'}`;
}

function reportedProblems(line: ReceiveJobLine): ReceiveReportedProblem[] {
  return line.reported_problems ?? [];
}

// WS-UX-RECEIVE-D4R S8-C1 — Review/Completion outcome classification.
// reported_problems are receive_exceptions rows; accounting_role=overage is the
// persisted over-delivery approval (isPersistedOverageApproval), not a problem.
// Later delivery is never an exception row: it is the line's quantity_deferred
// (also echoed as a synthetic reconciliation allocation, so read it only here).
// Problems count records, as before; later and extra count units.
export interface ReceiveLineOutcome {
  accepted: number;
  problems: ReceiveReportedProblem[];
  later: number;
  extra: number;
  extraApproved: boolean;
}

export function receiveLineOutcome(line: ReceiveJobLine, acceptedOverride?: number): ReceiveLineOutcome {
  const accepted = acceptedOverride ?? Number(line.quantity_accepted ?? 0);
  const all = reportedProblems(line);
  const extra = Math.max(0, accepted - line.quantity_expected);
  return {
    accepted,
    problems: all.filter((problem) => problem.accounting_role !== 'overage'),
    later: Math.max(0, Number(line.quantity_deferred ?? 0)),
    extra,
    extraApproved: extra > 0 && (Boolean(line.reconciliation?.overage_approved) || all.some((problem) => problem.accounting_role === 'overage')),
  };
}

export function summarizeReceiveOutcome(lines: ReceiveJobLine[], acceptedByLine: Record<string, number> = {}) {
  const outcomes = lines.map((line) => receiveLineOutcome(line, acceptedByLine[line.receive_job_line_id]));
  return {
    accepted: outcomes.reduce((sum, outcome) => sum + outcome.accepted, 0),
    problems: outcomes.reduce((sum, outcome) => sum + outcome.problems.length, 0),
    later: outcomes.reduce((sum, outcome) => sum + outcome.later, 0),
    extra: outcomes.reduce((sum, outcome) => sum + outcome.extra, 0),
    extraApproved: outcomes.some((outcome) => outcome.extra > 0) && outcomes.every((outcome) => outcome.extra === 0 || outcome.extraApproved),
  };
}

function receiveOutcomeSub(summary: ReturnType<typeof summarizeReceiveOutcome>): string {
  return `${summary.accepted} accepted · ${summary.problems} ${summary.problems === 1 ? 'problem' : 'problems'}`
    + (summary.later > 0 ? ` · ${summary.later} later` : '')
    + (summary.extra > 0 ? ` · +${summary.extra} extra${summary.extraApproved ? ' approved' : ''}` : '');
}

function projectedSellable(line: ReceiveJobLine): number {
  return Number(
    line.quantity_sellable_provisional
      ?? line.quantity_accepted
      ?? 0
  );
}

// GH-1108 / RECEIVE-OVERCOUNT-01 — refresh/re-entry contract: a line with an
// uninspected over-expected provisional count and the canonical persisted
// overage approval must reconstruct the approved over-delivery decision from
// server data, not rely on local UI state that resets to null on reload.
// GH-1241 S3-A1 — re-entry may rebuild the decision only when the operator's
// persisted confirmed count IS the over-expected draft. A draft plus approval
// without a confirmed count re-enters counting: the operator must Finish Count
// again, and Accept extra never turns the draft into count evidence.
function hasApprovedOverage(line: ReceiveJobLine): boolean {
  return !line.inspection_complete
    && line.reconciliation?.overage_approved === true
    && projectedSellable(line) > line.quantity_expected
    && confirmedCount(line) === projectedSellable(line);
}

// GH-1241 S3-A1 — only the operator's persisted physical count can seed an
// accepted quantity. The GET projection's sellable for an untouched line is
// expected minus reported problems: an inference, never a count.
function confirmedCount(line: ReceiveJobLine): number | null {
  return line.quantity_count_confirmed == null ? null : Number(line.quantity_count_confirmed);
}

// A canonical confirmed zero is explicit count evidence. An unconfirmed
// provisional zero is not: older/default projections may expose zero before
// any physical counting action. Non-zero provisional progress can only have
// come from an operator count/scan and remains resumable.
function hasEstablishedCountEvidence(line: ReceiveJobLine): boolean {
  if (confirmedCount(line) != null) return true;
  if (line.quantity_sellable_provisional != null
    && Number(line.quantity_sellable_provisional) > 0) return true;
  return Number(line.quantity_accepted ?? 0) > 0;
}

function hasProjectedReconciliation(line: ReceiveJobLine): boolean {
  if (!line.reconciliation || confirmedCount(line) == null) return false;
  return !!line.reconciliation_started_at
    || line.reconciliation.allocations.length > 0
    || line.reconciliation.unaccounted === 0 && line.reconciliation.sellable < line.reconciliation.expected
    || line.reconciliation.sellable < line.reconciliation.expected
      && line.reconciliation.allocations.some((allocation) => allocation.counts_toward_shortfall);
}

function projectedReconciliationState(line: ReceiveJobLine) {
  const sellable = confirmedCount(line);
  if (!line.reconciliation || sellable == null) return null;
  const expected = Number(line.reconciliation.expected ?? line.quantity_expected);
  const accounted = Number(line.reconciliation.accounted ?? 0);
  const unaccounted = Number(line.reconciliation.unaccounted ?? Math.max(0, expected - sellable - accounted));
  const totalShortfall = accounted + unaccounted;
  if (totalShortfall <= 0) return null;

  return {
    line,
    accepted: sellable,
    totalShortfall,
    remainingShortfall: unaccounted,
    allocations: line.reconciliation.allocations.filter((allocation) => allocation.counts_toward_shortfall).map((allocation) => ({
      type: allocation.exception_type as ProblemType,
      quantity: Number(allocation.quantity_affected ?? 0),
    })),
  };
}

function problemCountLabel(line: ReceiveJobLine): string | null {
  const count = reportedProblems(line).length;
  if (count === 0) return null;
  return `${count} problem${count === 1 ? '' : 's'} reported`;
}

/**
 * S4-4D F4 — damage rows say whether the units are held for repair
 * (recoverable_held) or set aside as not recoverable; null disposition on a
 * damage type is the non-recoverable path (S4-4C).
 */
function problemTypeLabel(problem: ReceiveReportedProblem): string {
  const label = problemLabel(problem.exception_type);
  if (problem.exception_type !== 'defect' && problem.exception_type !== 'packaging_damage') return label;
  return problem.disposition === 'recoverable_held' ? `${label} · held for repair` : `${label} · not recoverable`;
}

function problemDetailLabel(problem: ReceiveReportedProblem): string {
  const label = problemLabel(problem.exception_type);
  const quantity = unitLabel(Number(problem.quantity_affected ?? 0));
  return problem.resolved ? `${label} · ${quantity} · resolved` : `${label} · ${quantity}`;
}


function ReportedProblemSummary({
  line,
  compact = false,
  problems = reportedProblems(line),
}: {
  line: ReceiveJobLine;
  compact?: boolean;
  problems?: ReceiveReportedProblem[];
}) {
  if (problems.length === 0) return null;

  if (compact) {
    return (
      <Chip
        size="small"
        variant="outlined"
        label={`${problems.length} problem${problems.length === 1 ? '' : 's'}`}
        sx={{
          mt: 0.5,
          height: 24,
          maxWidth: '100%',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          '& .MuiChip-label': {
            px: 0.9,
            fontSize: 11,
            fontWeight: 650,
          },
        }}
      />
    );
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        width: '100%',
        minHeight: 64,
        p: 1.25,
        mb: 2,
        borderRadius: '6px',
        borderColor: 'divider',
        bgcolor: 'background.default',
        display: 'grid',
        gap: 0.75,
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          gap: 1,
          alignItems: 'center',
        }}
      >
        <Typography variant="body2" fontWeight={700}>
          {problemCountLabel(line)}
        </Typography>

        <Chip
          size="small"
          variant="outlined"
          label="Problem Center"
          sx={{
            height: 24,
            borderColor: 'divider',
            '& .MuiChip-label': {
              px: 0.9,
              fontSize: 11,
              fontWeight: 650,
            },
          }}
        />
      </Box>

      {problems.map((problem) => (
        <Box
          key={problem.receive_exception_id}
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto',
            gap: 1,
            alignItems: 'center',
          }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            {problemTypeLabel(problem)}
          </Typography>

          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            sx={monoSx}
          >
            {unitLabel(Number(problem.quantity_affected ?? 0))}
            {problem.resolved ? ' · resolved' : ''}
          </Typography>
        </Box>
      ))}
    </Paper>
  );
}

function ReceiveSessionFlow({
  receiveJobId,
  poId,
  poNumber = null,
  supplierName,
  jobStatus,
  assignedOperatorId,
  currentUserId,
  closedAt,
  actualDeliveryDate,
  lines,
  onClaimJob,
  onInspectLine,
  onReportException,
  onApproveOverDelivery,
  onPersistLineProgress,
  onConfirmLineCount,
  onRecountLine,
  onCloseJob,
  onComplete,
  onResolveBarcode,
  onPrintUnitLabels,
  onConfirmUnitLabelsPrinted,
  onResolveProblemBin,
  onPlaceHeldUnit,
  onRefresh,
  onExecutionFocusChange,
}: ReceiveSessionPageProps) {
  const poDisplay = poNumber == null ? 'PO reference unavailable' : `PO-${poNumber}`;
  // S4-4C — held-for-repair custody. The selected problem bin stays selected
  // until the operator changes it or leaves this session.
  const [problemBin, setProblemBin] = useState<ReceiveProblemBin | null>(null);
  const [binInputValue, setBinInputValue] = useState('');
  const [heldInputValue, setHeldInputValue] = useState('');
  const [custodyBusy, setCustodyBusy] = useState(false);
  const [custodyNotice, setCustodyNotice] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const custodyInFlightRef = useRef(false);
  const heldInputRef = useRef<HTMLInputElement>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const progressPersistQueueRef = useRef<Promise<void>>(Promise.resolve());
  // WS-UX-RECEIVE-D4R S3-B — per line, the last provisional count the server
  // accepted; a failed over-delivery save restores the screen to it.
  const savedProgressRef = useRef<Record<string, number>>({});
  // WS-UX-RECEIVE-D4R S7-CORRECT — per line, the latest provisional write the
  // server refused (line, attempted quantity, reason). Only a later successful
  // write for the SAME line clears it; writes for other lines never do.
  const failedProgressRef = useRef<Record<string, { line: ReceiveJobLine; quantity: number; error: Error }>>({});
  // Without a progress writer nothing reaches the server: counts stay local
  // drafts and are never reported as saved.
  const unsavedDraftRef = useRef<Record<string, { line: ReceiveJobLine; quantity: number }>>({});

  const hasCanonicalJobStatus = typeof jobStatus === 'string';
  const isPendingJob = jobStatus === 'pending';
  const isActiveJob = jobStatus != null && ACTIVE_RECEIVE_JOB_STATUSES.has(jobStatus);
  const assignedToCurrentUser =
    assignedOperatorId != null &&
    currentUserId != null &&
    assignedOperatorId === currentUserId;
  const assignedToOther =
    assignedOperatorId != null &&
    (currentUserId == null || assignedOperatorId !== currentUserId);
  const requiresClaim =
    isPendingJob &&
    assignedToCurrentUser;
  const ownedActiveJob =
    isActiveJob &&
    assignedToCurrentUser;
  const blockedByOwnership =
    (isPendingJob || isActiveJob) &&
    assignedToOther;
  const blockedUnassigned =
    (isPendingJob || isActiveJob) &&
    assignedOperatorId == null;
  const blockedLifecycle =
    blockedByOwnership ||
    blockedUnassigned ||
    jobStatus === 'cancelled';

  const initialComplete = useMemo(
    () => new Set(lines.filter((line) => line.inspection_complete).map((line) => line.receive_job_line_id)),
    [lines]
  );
  const initialAccepted = useMemo(
    () => Object.fromEntries(lines.map((line) => [line.receive_job_line_id, projectedSellable(line)])),
    [lines]
  );
  const initialCountEstablished = useMemo(
    () => Object.fromEntries(lines.map((line) => [
      line.receive_job_line_id,
      hasEstablishedCountEvidence(line),
    ])),
    [lines]
  );
  const initialRejected = useMemo(
    () => Object.fromEntries(lines.map((line) => [line.receive_job_line_id, Number(line.quantity_rejected ?? 0)])),
    [lines]
  );

  const firstBackendHold = lines.find((line) => line.awaiting_label_ack)?.receive_job_line_id ?? null;
  const firstReconciliationIndex = lines.findIndex((line) => !line.inspection_complete && hasProjectedReconciliation(line));
  const firstActiveIndex = lines.findIndex((line) => !line.inspection_complete && line.quantity_sellable_provisional != null);
  const hasResumeState = lines.some((line) => (
    line.inspection_complete
      || line.awaiting_label_ack
      || hasProjectedReconciliation(line)
      || line.quantity_sellable_provisional != null
  ));
  const startsComplete = lines.length > 0 && lines.every((line) => line.inspection_complete && !line.awaiting_label_ack);
  const initialCurrentIndex = firstReconciliationIndex >= 0
    ? firstReconciliationIndex
    : firstBackendHold
      ? lines.findIndex((line) => line.receive_job_line_id === firstBackendHold)
      : firstActiveIndex >= 0
        ? firstActiveIndex
        : (() => {
          const firstOpen = lines.findIndex((line) => !line.inspection_complete || line.awaiting_label_ack);
          return firstOpen >= 0 ? firstOpen : 0;
        })();
  const initialReconciliationLine = firstReconciliationIndex >= 0
    ? projectedReconciliationState(lines[firstReconciliationIndex])
    : null;
  const firstApprovedOverageIndex = lines.findIndex(hasApprovedOverage);
  const initialOverDeliveryDecision = firstApprovedOverageIndex >= 0
    ? {
      line: lines[firstApprovedOverageIndex],
      counted: projectedSellable(lines[firstApprovedOverageIndex]),
      approved: true,
      countConfirmed: true,
    }
    : null;

  const [sessionPhase, setSessionPhase] = useState<SessionPhase>(
    closedAt || jobStatus === 'closed'
      ? 'handoff'
      : isPendingJob || blockedLifecycle
        ? 'brief'
        : startsComplete
          ? 'review'
          : firstReconciliationIndex >= 0
            ? 'reconcile'
            : hasResumeState || ownedActiveJob
              ? 'inspect'
              : 'brief'
  );
  const [currentIndex, setCurrentIndex] = useState(initialCurrentIndex);
  const [lineAction, setLineAction] = useState<LineAction>('count');
  const [accepted, setAccepted] = useState(0);
  const [acceptedByLine, setAcceptedByLine] = useState<Record<string, number>>(initialAccepted);
  const [countEstablishedByLine, setCountEstablishedByLine] = useState<Record<string, boolean>>(initialCountEstablished);
  const [rejectedByLine, setRejectedByLine] = useState<Record<string, number>>(initialRejected);
  const [completeLines, setCompleteLines] = useState<Set<string>>(initialComplete);
  const [acknowledgedLabelLines, setAcknowledgedLabelLines] = useState<Set<string>>(new Set());
  const [labelHoldLineId, setLabelHoldLineId] = useState<string | null>(firstBackendHold);
  const [labelPrintFailed, setLabelPrintFailed] = useState(false);
  // WS-UX-RECEIVE-D4R S4 — local print request status for the held line.
  // Printing is never acknowledgement: only onConfirmUnitLabelsPrinted
  // releases a hold. Refs block duplicate print / acknowledgement requests
  // fired before React re-renders the disabled controls.
  const [labelPrinting, setLabelPrinting] = useState(false);
  const [labelsPrinted, setLabelsPrinted] = useState(false);
  const labelPrintInFlightRef = useRef(false);
  const labelAckInFlightRef = useRef(false);
  const [labelAckSubmitting, setLabelAckSubmitting] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [scanInputValue, setScanInputValue] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanProcessing, setScanProcessing] = useState(false);
  const [flashLine, setFlashLine] = useState<string | null>(null);
  const [overDeliveryDecision, setOverDeliveryDecision] = useState<{
    line: ReceiveJobLine;
    counted: number;
    /**
     * GH-1108 / RECEIVE-OVERCOUNT-01 — true only when this decision was
     * reconstructed from an already-persisted canonical overage approval
     * (see initialOverDeliveryDecision / hasApprovedOverage), never when the
     * operator just counted past expected in this session.
     */
    approved?: boolean;
    /**
     * GH-1241 S3-A1 — true when `counted` is the operator's persisted
     * confirmed count (Finish Count, or re-entry with matching evidence):
     * only then can the overage be approved. Otherwise the decision is the
     * live +/typed/scan warning; it can keep the extra in the draft count,
     * which Finish Count must confirm before any approval.
     */
    countConfirmed?: boolean;
  } | null>(initialOverDeliveryDecision);
  const [overDeliverySubmitting, setOverDeliverySubmitting] = useState(false);
  const [overDeliveryError, setOverDeliveryError] = useState<string | null>(null);

  const [problemDialog, setProblemDialog] = useState(false);
  const [problemChoice, setProblemChoice] = useState<ProblemChoice | null>(null);
  const [problemType, setProblemType] = useState<ProblemType | null>(null);
  const [problemNotes, setProblemNotes] = useState('');
  const [problemQty, setProblemQty] = useState('1');
  const [problemSubmitting, setProblemSubmitting] = useState(false);
  const [problemError, setProblemError] = useState<string | null>(null);

  const [shortfallModal, setShortfallModal] = useState<{
    line: ReceiveJobLine;
    accepted: number;
    totalShortfall: number;
    remainingShortfall: number;
  } | null>(null);
  const [shortfallProblemType, setShortfallProblemType] = useState<ProblemType | null>(null);
  const [shortfallProblemQty, setShortfallProblemQty] = useState('');
  const [shortfallProblemNotes, setShortfallProblemNotes] = useState('');
  const [shortfallSubmitting, setShortfallSubmitting] = useState(false);
  // S8-C5 Recount sheet: confirm → busy → (closed | refused | unknown outcome).
  const [recountSheet, setRecountSheet] = useState<null | { status: 'confirm' | 'busy' | 'refused' | 'unknown'; message?: string }>(null);
  const [shortfallQtyError, setShortfallQtyError] = useState<string | null>(null);
  const [reconciliationLine, setReconciliationLine] = useState<{
    line: ReceiveJobLine;
    accepted: number;
    totalShortfall: number;
    remainingShortfall: number;
    allocations: Array<{ type: ProblemType; quantity: number }>;
  } | null>(initialReconciliationLine);

  const [deliveryDate, setDeliveryDate] = useState('');
  const [closing, setClosing] = useState(false);
  const [linesDrawerOpen, setLinesDrawerOpen] = useState(false);
  const [identityDetailLine, setIdentityDetailLine] = useState<ReceiveJobLine | null>(null);
  // WS-UX-RECEIVE-D4R S6 — UX-14 page of the Brief / Review line list
  // (presentation only; totals and gates always use every line).
  const [listPage, setListPage] = useState(0);
  const closeInFlightRef = useRef(false);
  // WS-UX-RECEIVE-D4R S7 — save-aware per-line Exit. 'saving' flushes queued
  // count writes; 'checking' waits for in-flight submissions, then decides.
  const [exitSheet, setExitSheet] = useState<
    | { variant: 'saving' }
    | { variant: 'checking' }
    | { variant: 'saved' }
    | { variant: 'failed'; failures: Array<{ lineId: string; name: string; quantity: number; error: string }> }
    | { variant: 'review'; reasons: string[] }
    | null
  >(null);
  const exitInFlightRef = useRef(false);
  // Finish Count's canonical confirmation is in flight (Exit waits for it).
  const [countConfirming, setCountConfirming] = useState(false);
  // Each Exit attempt gets a token; a flush finishing after Keep receiving is ignored.
  const exitAttemptRef = useRef(0);
  // S8-C3 — close outcome reconciliation: 'checking' reads canonical status,
  // 'unknown' blocks Close until a read succeeds, 'open' allows a deliberate retry.
  const [closeRecovery, setCloseRecovery] = useState<'checking' | 'unknown' | 'open' | null>(null);
  // A confirmed close never reverts; its final details may still need a re-read.
  const closeConfirmedRef = useRef(false);
  const [closeDetailsPending, setCloseDetailsPending] = useState(false);
  const closeOutcomeUnknown = closeRecovery === 'checking';

  const totalExpected = lines.reduce((sum, line) => sum + line.quantity_expected, 0);
  const currentLine = lines[currentIndex] ?? null;
  const currentCountEstablished = currentLine
    ? countEstablishedByLine[currentLine.receive_job_line_id] === true
    : false;

  // WAREHOUSE-FOCUS-SHELL-01A — execution-focus is derived purely from
  // sessionPhase, not called individually from handleStart/handleClaim/etc.
  // This makes every phase transition report consistently: brief -> false;
  // inspect/reconcile/review/handoff -> true. A failed claim never calls
  // setSessionPhase, so it never fires this effect with a change, and a
  // refresh that initializes sessionPhase straight into 'inspect' (a
  // canonical in_progress job) or 'handoff' fires it on mount, same as any
  // other sessionPhase change.
  useEffect(() => {
    onExecutionFocusChange?.(sessionPhase !== 'brief');
  }, [sessionPhase, onExecutionFocusChange]);

  const isLineComplete = useCallback((line: ReceiveJobLine) => (
    completeLines.has(line.receive_job_line_id) || !!line.inspection_complete
  ), [completeLines]);

  const isLineAwaitingLabel = useCallback((line: ReceiveJobLine) => {
    if (acknowledgedLabelLines.has(line.receive_job_line_id)) return false;
    return labelHoldLineId === line.receive_job_line_id || !!line.awaiting_label_ack;
  }, [acknowledgedLabelLines, labelHoldLineId]);

  const isLineDone = useCallback((line: ReceiveJobLine) => (
    isLineComplete(line) && !isLineAwaitingLabel(line)
  ), [isLineAwaitingLabel, isLineComplete]);

  const completedCount = lines.filter(isLineDone).length;
  const currentAwaitingLabel = currentLine ? isLineAwaitingLabel(currentLine) : false;
  // GH-1241 S3C-M4 — the product whose labels are being handled: the one this
  // session put on hold, else the current product canonical readiness still
  // holds (resume, grouped finalization, the next held product).
  const activeHoldLineId = labelHoldLineId
    ?? (currentAwaitingLabel && currentLine ? currentLine.receive_job_line_id : null);
  const currentComplete = currentLine ? isLineComplete(currentLine) : false;
  const currentCanScan = !!currentLine && hasExternalBarcode(currentLine) && !!onResolveBarcode;
  const scanReady = sessionPhase === 'inspect'
    && !!currentLine
    && lineAction === 'scan'
    && currentCanScan
    && !currentAwaitingLabel
    && !problemDialog
    && !shortfallModal
    && !reconciliationLine
    && !overDeliveryDecision
    && !submitting
    && !exitSheet
    && !currentComplete;
  const activeAccepted = currentLine ? accepted : 0;
  const activeRejected = currentLine ? rejectedByLine[currentLine.receive_job_line_id] ?? 0 : 0;
  const allLinesDone = lines.length > 0 && lines.every(isLineDone);

  /** Queue one provisional write for `line` without touching the count on screen. */
  const enqueueProgressWrite = useCallback((
    line: ReceiveJobLine,
    quantity: number,
    options?: { reconciliationRequired?: boolean },
  ) => {
    if (!onPersistLineProgress) return progressPersistQueueRef.current;
    const lineId = line.receive_job_line_id;
    progressPersistQueueRef.current = progressPersistQueueRef.current
      .then(async () => {
        await onPersistLineProgress(lineId, {
          quantity_sellable_provisional: quantity,
          ...(options?.reconciliationRequired ? { reconciliation_required: true } : {}),
        });
        savedProgressRef.current = { ...savedProgressRef.current, [lineId]: quantity };
        if (failedProgressRef.current[lineId]) {
          const { [lineId]: _resolved, ...rest } = failedProgressRef.current;
          failedProgressRef.current = rest;
        }
      })
      .catch((err: any) => {
        const error = err instanceof Error ? err : new Error(err?.message ?? 'Could not save count progress.');
        failedProgressRef.current = { ...failedProgressRef.current, [lineId]: { line, quantity, error } };
      });
    return progressPersistQueueRef.current;
  }, [onPersistLineProgress]);

  const persistLineProgress = useCallback((
    line: ReceiveJobLine,
    nextAccepted: number,
    options?: { reconciliationRequired?: boolean }
  ) => {
    setAccepted(nextAccepted);
    setAcceptedByLine((prev) => ({
      ...prev,
      [line.receive_job_line_id]: nextAccepted,
    }));
    if (isLineComplete(line)) return progressPersistQueueRef.current;
    if (!onPersistLineProgress) {
      unsavedDraftRef.current = { ...unsavedDraftRef.current, [line.receive_job_line_id]: { line, quantity: nextAccepted } };
      return progressPersistQueueRef.current;
    }
    return enqueueProgressWrite(line, nextAccepted, options);
  }, [enqueueProgressWrite, isLineComplete, onPersistLineProgress]);

  const establishCount = useCallback((line: ReceiveJobLine) => {
    setCountEstablishedByLine((prev) => prev[line.receive_job_line_id]
      ? prev
      : { ...prev, [line.receive_job_line_id]: true });
  }, []);

  /** Wait for queued writes; reject if this line's (or, without a line, any line's) latest write failed. */
  const flushLineProgress = useCallback(async (lineId?: string) => {
    await progressPersistQueueRef.current;
    const failures = lineId
      ? (failedProgressRef.current[lineId] ? [failedProgressRef.current[lineId]] : [])
      : Object.values(failedProgressRef.current);
    if (failures.length > 0) throw failures[0].error;
  }, []);

  // GH-1241 S3-A1 — the operator's explicit "this is my physical count".
  // Only explicit operator actions call it; never Start, mode changes,
  // mount/refresh, projections or problem reports.
  const confirmLineCount = useCallback(async (line: ReceiveJobLine, quantity: number) => {
    if (!onConfirmLineCount) {
      throw new Error('Count confirmation is unavailable. Refresh and try again.');
    }
    await onConfirmLineCount(line.receive_job_line_id, { quantity_confirmed: quantity });
  }, [onConfirmLineCount]);

  useEffect(() => {
    if (!currentLine) return;
    setAccepted(acceptedByLine[currentLine.receive_job_line_id] ?? Number(currentLine.quantity_accepted ?? 0));
    setLineAction(currentLine.quantity_sellable_provisional != null ? 'count' : currentCanScan ? 'scan' : 'count');
    setSubmitError(null);
    setScanError(null);
    setScanInputValue('');
  }, [currentCanScan, currentLine]);

  useEffect(() => {
    setListPage(0);
  }, [sessionPhase]);

  useEffect(() => {
    if (sessionPhase !== 'inspect' || !allLinesDone) return;
    setSessionPhase('review');
  }, [allLinesDone, sessionPhase]);

  useEffect(() => {
    if (!scanReady) return;
    scanInputRef.current?.focus();
  }, [scanReady, currentIndex, scanError, scanProcessing]);

  const moveToNextLineOrReview = useCallback((completedLineId?: string, ackedLineId?: string) => {
    const nextIndex = lines.findIndex((line) => {
      if (line.receive_job_line_id === completedLineId || line.receive_job_line_id === ackedLineId) return false;
      const complete = completeLines.has(line.receive_job_line_id) || !!line.inspection_complete;
      const awaitingLabel = line.receive_job_line_id === labelHoldLineId || !!line.awaiting_label_ack;
      const acked = acknowledgedLabelLines.has(line.receive_job_line_id) || line.receive_job_line_id === ackedLineId;
      return !complete || (awaitingLabel && !acked);
    });

    if (nextIndex === -1) {
      setSessionPhase('review');
      return;
    }

    setCurrentIndex(nextIndex);
    setSessionPhase('inspect');
  }, [acknowledgedLabelLines, completeLines, labelHoldLineId, lines]);

  const inspectAndResolveReadiness = useCallback(async (
    line: ReceiveJobLine,
    quantityAccepted: number,
    quantityRejected: number,
    quantityMissing = 0,
    quantityDeferred = 0,
  ): Promise<{ awaitingLabelAck: boolean }> => {
    await onInspectLine({
      lasyncro_variant_id: line.lasyncro_variant_id,
      receive_job_line_id: line.receive_job_line_id,
      quantity_accepted: quantityAccepted,
      quantity_rejected: quantityRejected,
      quantity_missing: quantityMissing,
      quantity_deferred: quantityDeferred,
    });

    setAcceptedByLine((prev) => ({ ...prev, [line.receive_job_line_id]: quantityAccepted }));
    setRejectedByLine((prev) => ({ ...prev, [line.receive_job_line_id]: quantityRejected }));
    setCompleteLines((prev) => new Set([...prev, line.receive_job_line_id]));

    const needsLabelAck = quantityAccepted > 0 && !hasExternalBarcode(line);
    if (!needsLabelAck) return { awaitingLabelAck: false };

    // Establish the hold before any asynchronous print work. Otherwise the
    // completed-line effect can briefly see every line as done and advance
    // the session to Review before attachment acknowledgement exists.
    setLabelHoldLineId(line.receive_job_line_id);
    setLabelsPrinted(false);
    setLabelPrintFailed(false);

    if (onPrintUnitLabels && !labelPrintInFlightRef.current) {
      labelPrintInFlightRef.current = true;
      setLabelPrinting(true);
      try {
        await onPrintUnitLabels(line.receive_job_line_id);
        setLabelPrintFailed(false);
        setLabelsPrinted(true);
      } catch {
        setLabelPrintFailed(true);
      } finally {
        labelPrintInFlightRef.current = false;
        setLabelPrinting(false);
      }
    }

    return { awaitingLabelAck: true };
  }, [onInspectLine, onPrintUnitLabels]);

  const completeLine = useCallback(async (
    line: ReceiveJobLine,
    quantityAccepted: number,
    quantityRejected: number,
  ) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const outcome = await inspectAndResolveReadiness(line, quantityAccepted, quantityRejected);
      if (!outcome.awaitingLabelAck) {
        moveToNextLineOrReview(line.receive_job_line_id);
      }
    } catch (err: any) {
      setSubmitError(err?.message ?? 'Could not save this line. Please retry.');
    } finally {
      setSubmitting(false);
    }
  }, [inspectAndResolveReadiness, moveToNextLineOrReview]);

  const handleStart = useCallback(async () => {
    if (blockedLifecycle) return;

    setClaimError(null);

    if (requiresClaim) {
      if (!onClaimJob) {
        setClaimError(
          'Receive claim is unavailable. Return to Operations and try again.'
        );
        return;
      }

      setClaiming(true);
      try {
        await onClaimJob();
      } catch (err: any) {
        const code =
          err?.response?.data?.error ??
          err?.message ??
          'RECEIVE_CLAIM_FAILED';

        setClaimError(
          code === 'JOB_CLAIMED_BY_OTHER'
            ? 'This Receive is already claimed by another operator.'
            : 'Could not claim this Receive job. Please retry.'
        );
        return;
      } finally {
        setClaiming(false);
      }
    }

    const firstOpen = lines.findIndex((line) => !isLineDone(line));
    setCurrentIndex(firstOpen >= 0 ? firstOpen : 0);

    if (firstOpen >= 0) {
      void persistLineProgress(
        lines[firstOpen],
        projectedSellable(lines[firstOpen])
      );
    }

    setSessionPhase(firstOpen >= 0 ? 'inspect' : 'review');
  }, [
    blockedLifecycle,
    isLineDone,
    lines,
    onClaimJob,
    persistLineProgress,
    requiresClaim,
  ]);

  const handleCountConfirm = useCallback(async () => {
    if (!currentLine || !currentCountEstablished || currentComplete || currentAwaitingLabel) return;
    try {
      await flushLineProgress(currentLine.receive_job_line_id);
    } catch (err: any) {
      setSubmitError(err?.message ?? 'Could not save count progress. Please retry.');
      return;
    }
    setCountConfirming(true);
    try {
      await confirmLineCount(currentLine, accepted);
    } catch (err: any) {
      setSubmitError(err?.message ?? 'Could not confirm this count. Your count is kept; retry when ready.');
      return;
    } finally {
      setCountConfirming(false);
    }
    if (accepted > currentLine.quantity_expected) {
      setOverDeliveryError(null);
      setOverDeliveryDecision({
        line: currentLine,
        counted: accepted,
        countConfirmed: true,
        // A persisted approval (e.g. before a refresh) is never posted twice.
        approved: currentLine.reconciliation?.overage_approved === true,
      });
      return;
    }

    const shortfall = currentLine.quantity_expected - accepted;
    if (shortfall > 0) {
      try {
        await persistLineProgress(currentLine, accepted, { reconciliationRequired: true });
        await flushLineProgress(currentLine.receive_job_line_id);
      } catch (err: any) {
        setSubmitError(err?.message ?? 'Could not save count progress. Please retry.');
        return;
      }
      setReconciliationLine({
        line: currentLine,
        accepted,
        totalShortfall: shortfall,
        remainingShortfall: shortfall,
        allocations: [],
      });
      setShortfallProblemType(null);
      setShortfallProblemQty('1');
      setShortfallProblemNotes('');
      setShortfallQtyError(null);
      setSessionPhase('reconcile');
      return;
    }

    await completeLine(currentLine, accepted, 0);
  }, [accepted, completeLine, confirmLineCount, currentAwaitingLabel, currentComplete, currentCountEstablished, currentLine, flushLineProgress, persistLineProgress]);

  const handleScan = useCallback(async (value: string) => {
    if (!scanReady || !currentLine || !onResolveBarcode || scanProcessing) return;
    const scannedValue = value.trim();
    if (!scannedValue) return;

    setScanProcessing(true);
    setScanError(null);
    try {
      const resolved = await onResolveBarcode(scannedValue);
      if (!resolved?.lasyncro_variant_id) {
        setScanError(`Barcode not recognised: ${scannedValue}. Nothing was counted.`);
        return;
      }
      if (resolved.lasyncro_variant_id !== currentLine.lasyncro_variant_id) {
        setScanError('That barcode belongs to a different receive line. Nothing was counted.');
        return;
      }

      const next = activeAccepted + 1;
      if (next > currentLine.quantity_expected && activeAccepted <= currentLine.quantity_expected) {
        setOverDeliveryError(null);
        setOverDeliveryDecision({ line: currentLine, counted: next });
        return;
      }

      establishCount(currentLine);
      void persistLineProgress(currentLine, next);
      setFlashLine(currentLine.receive_job_line_id);
      window.setTimeout(() => setFlashLine(null), 450);
    } catch {
      setScanError('Scan failed. Nothing was counted. Check the connection and try again.');
    } finally {
      setScanProcessing(false);
      setScanInputValue('');
      if (scanReady) window.setTimeout(() => scanInputRef.current?.focus(), 30);
    }
  }, [
    activeAccepted,
    currentLine,
    establishCount,
    onResolveBarcode,
    persistLineProgress,
    scanProcessing,
    scanReady,
  ]);

  // Printing never acknowledges: only the operator's explicit confirmation does.
  const handleRetryPrintLabels = useCallback(async () => {
    if (!activeHoldLineId || !onPrintUnitLabels || labelPrintInFlightRef.current) return;
    labelPrintInFlightRef.current = true;
    setLabelPrinting(true);
    try {
      await onPrintUnitLabels(activeHoldLineId);
      setLabelPrintFailed(false);
      setLabelsPrinted(true);
    } catch {
      setLabelPrintFailed(true);
      setLabelsPrinted(false);
    } finally {
      labelPrintInFlightRef.current = false;
      setLabelPrinting(false);
    }
  }, [activeHoldLineId, onPrintUnitLabels]);

  const handleConfirmLabelsPrinted = useCallback(async () => {
    if (!activeHoldLineId || labelAckInFlightRef.current) return;
    const ackedLineId = activeHoldLineId;
    labelAckInFlightRef.current = true;
    setLabelAckSubmitting(true);
    setSubmitError(null);
    try {
      await onConfirmUnitLabelsPrinted(ackedLineId);
      setAcknowledgedLabelLines((prev) => new Set([...prev, ackedLineId]));
      setLabelHoldLineId(null);
      setLabelPrintFailed(false);
      setLabelsPrinted(false);
      moveToNextLineOrReview(undefined, ackedLineId);
    } catch (err: any) {
      setSubmitError(err?.message ?? 'Could not record label acknowledgement. Please retry.');
    } finally {
      labelAckInFlightRef.current = false;
      setLabelAckSubmitting(false);
    }
  }, [activeHoldLineId, moveToNextLineOrReview, onConfirmUnitLabelsPrinted]);

  const submitInspectionAfterShortfall = useCallback(async (
    line: ReceiveJobLine,
    acceptedQty: number,
    totalShortfall: number,
  ) => {
    try {
      const outcome = await inspectAndResolveReadiness(line, acceptedQty, totalShortfall);
      setShortfallModal(null);
      setShortfallProblemType(null);
      setShortfallProblemQty('');
      setShortfallProblemNotes('');
      setShortfallQtyError(null);
      if (!outcome.awaitingLabelAck) {
        moveToNextLineOrReview(line.receive_job_line_id);
      }
    } catch (err: any) {
      setSubmitError(err?.message ?? 'Could not save this line. Please retry.');
    }
  }, [inspectAndResolveReadiness, moveToNextLineOrReview]);

  const handleShortfallConfirm = useCallback(async () => {
    if (!shortfallModal || !shortfallProblemType) return;
    const qty = Number.parseInt(shortfallProblemQty, 10);
    if (!shortfallProblemQty.trim() || Number.isNaN(qty) || qty <= 0) {
      setShortfallQtyError('Enter a quantity to continue.');
      return;
    }
    if (qty > shortfallModal.remainingShortfall) {
      setShortfallQtyError(`Maximum is ${shortfallModal.remainingShortfall}.`);
      return;
    }
    const needsNotes = shortfallProblemType === 'barcode_mismatch' || shortfallProblemType === 'other';
    if (needsNotes && !shortfallProblemNotes.trim()) return;

    setShortfallSubmitting(true);
    setSubmitError(null);
    try {
      await onReportException({
        lasyncro_variant_id: shortfallModal.line.lasyncro_variant_id,
        receive_job_line_id: shortfallModal.line.receive_job_line_id,
        exception_type: shortfallProblemType,
        quantity_affected: qty,
        accounting_role: 'shortfall',
        notes: shortfallProblemNotes.trim() || `${qty} missing during receive`,
      });

      const remainingShortfall = shortfallModal.remainingShortfall - qty;
      if (remainingShortfall > 0) {
        setShortfallModal((prev) => prev ? { ...prev, remainingShortfall } : null);
        setShortfallProblemType(null);
        setShortfallProblemQty('');
        setShortfallProblemNotes('');
      } else {
        await submitInspectionAfterShortfall(
          shortfallModal.line,
          shortfallModal.accepted,
          shortfallModal.totalShortfall,
        );
      }
    } catch (err: any) {
      setSubmitError(err?.message ?? 'Could not report the problem. Nothing was changed; retry to continue.');
    } finally {
      setShortfallSubmitting(false);
    }
  }, [
    onReportException,
    shortfallModal,
    shortfallProblemNotes,
    shortfallProblemQty,
    shortfallProblemType,
    submitInspectionAfterShortfall,
  ]);

  const handleReconciliationAllocation = useCallback(async () => {
    if (!reconciliationLine || !shortfallProblemType) return;
    const qty = Number.parseInt(shortfallProblemQty, 10);
    if (!shortfallProblemQty.trim() || Number.isNaN(qty) || qty <= 0) {
      setShortfallQtyError('Enter a quantity to continue.');
      return;
    }
    if (qty > reconciliationLine.remainingShortfall) {
      setShortfallQtyError(`Maximum is ${reconciliationLine.remainingShortfall}.`);
      return;
    }
    if (shortfallProblemType === 'other' && !shortfallProblemNotes.trim()) {
      setShortfallQtyError('Add a note to continue.');
      return;
    }

    setShortfallSubmitting(true);
    setSubmitError(null);
    try {
      if (shortfallProblemType === 'deferred') {
        if (!onPersistLineProgress) throw new Error('Later-delivery reporting is unavailable. Please refresh.');
        const deferred = reconciliationLine.allocations.filter((a) => a.type === 'deferred').reduce((n, a) => n + a.quantity, 0) + qty;
        await flushLineProgress(reconciliationLine.line.receive_job_line_id);
        await onPersistLineProgress(reconciliationLine.line.receive_job_line_id, {
          quantity_sellable_provisional: reconciliationLine.accepted,
          reconciliation_required: true,
          quantity_deferred: deferred,
        });
      } else {
        await onReportException({
          lasyncro_variant_id: reconciliationLine.line.lasyncro_variant_id,
          receive_job_line_id: reconciliationLine.line.receive_job_line_id,
          exception_type: shortfallProblemType,
          quantity_affected: qty,
          accounting_role: 'shortfall',
          notes: shortfallProblemNotes.trim() || `${qty} ${problemLabel(shortfallProblemType).toLowerCase()} during receive`,
        });
      }

      const remainingShortfall = reconciliationLine.remainingShortfall - qty;
      const allocations = [...reconciliationLine.allocations, { type: shortfallProblemType, quantity: qty }];
      setReconciliationLine({ ...reconciliationLine, remainingShortfall, allocations });
      setShortfallProblemType(null);
      setShortfallProblemQty(remainingShortfall > 0 ? '1' : '0');
      setShortfallProblemNotes('');
      setShortfallQtyError(null);
      await onRefresh?.();
    } catch (err: any) {
      setSubmitError(err?.message ?? 'Could not add this reconciliation item. Retry to continue.');
    } finally {
      setShortfallSubmitting(false);
    }
  }, [
    onRefresh,
    onReportException,
    onPersistLineProgress,
    flushLineProgress,
    reconciliationLine,
    shortfallProblemNotes,
    shortfallProblemQty,
    shortfallProblemType,
  ]);

  const handleFinishReconciledLine = useCallback(async () => {
    if (!reconciliationLine || reconciliationLine.remainingShortfall > 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const sum = (type: string) => reconciliationLine.allocations.filter((a) => a.type === type).reduce((n, a) => n + a.quantity, 0);
      const missing = sum('missing_item');
      const deferred = sum('deferred');
      const rejected = reconciliationLine.totalShortfall - missing - deferred;
      const outcome = await inspectAndResolveReadiness(reconciliationLine.line, reconciliationLine.accepted, rejected, missing, deferred);
      const completedLineId = reconciliationLine.line.receive_job_line_id;
      setReconciliationLine(null);
      setSessionPhase('inspect');
      if (!outcome.awaitingLabelAck) {
        moveToNextLineOrReview(completedLineId);
      }
    } catch (err: any) {
      setSubmitError(err?.message ?? 'Could not finish this line. Please retry.');
    } finally {
      setSubmitting(false);
    }
  }, [inspectAndResolveReadiness, moveToNextLineOrReview, reconciliationLine]);

  // GH-1241 S3-A1 — "I miscounted" means the confirmed count was wrong, not
  // that every expected unit is present. Return to counting this line; the
  // next Finish Count confirms the corrected physical count. Never inspect
  // the expected quantity without a count.
  const handleMiscount = useCallback(async () => {
    if (!shortfallModal) return;
    setShortfallModal(null);
    setLineAction('count');
    setSessionPhase('inspect');
  }, [shortfallModal]);

  const handleReconciliationMiscount = useCallback(async () => {
    if (!reconciliationLine) return;
    setAccepted(reconciliationLine.accepted);
    setReconciliationLine(null);
    setLineAction('count');
    setSessionPhase('inspect');
  }, [reconciliationLine]);

  // S8-C5 — saved allocations make Recount a server write. Only a confirmed
  // success returns to Count; a refusal changed nothing; an unanswered request
  // may have applied, so the only next step is the same (idempotent) request.
  const handleConfirmRecount = useCallback(async () => {
    if (!reconciliationLine || !onRecountLine) return;
    setRecountSheet({ status: 'busy' });
    try {
      await onRecountLine(reconciliationLine.line.receive_job_line_id);
    } catch (err: any) {
      const status = err?.response?.status;
      if (typeof status === 'number' && status >= 400 && status < 500) {
        setRecountSheet({ status: 'refused', message: recountRefusalMessage(err) });
      } else {
        setRecountSheet({ status: 'unknown' });
      }
      return;
    }
    setRecountSheet(null);
    setAccepted(reconciliationLine.accepted);
    setReconciliationLine(null);
    setShortfallProblemType(null);
    setShortfallProblemQty('1');
    setShortfallProblemNotes('');
    setShortfallQtyError(null);
    setLineAction('count');
    setSessionPhase('inspect');
    await onRefresh?.();
  }, [onRecountLine, onRefresh, reconciliationLine]);

  const openProblemDialog = useCallback((defaults?: { choice?: ProblemChoice; qty?: string; notes?: string }) => {
    const choice = defaults?.choice ?? null;
    const option = choice ? PROBLEM_CHOICES.find((item) => item.id === choice) : undefined;

    setProblemChoice(choice);
    setProblemType(option?.problemType ?? null);
    setProblemQty(defaults?.qty ?? '1');
    setProblemNotes(defaults?.notes ?? option?.defaultNotes ?? '');
    setProblemError(null);
    setProblemDialog(true);
  }, []);

  // GH-1108 / RECEIVE-OVERCOUNT-01 — "Accept extra" previously dismissed this
  // dialog and called completeLine (-> onInspectLine) immediately, before any
  // canonical overage evidence existed. The backend fails closed on
  // quantityAccepted > expected unless a persisted extra_item /
  // accounting_role=overage exception already exists for this line, so that
  // path always attempted an inspection the backend was guaranteed to reject.
  // Required order: (1) persist the provisional sellable count, (2) persist
  // the canonical overage approval, (3) only once approval succeeds, inspect
  // the line with the actual accepted quantity, (4) only once that succeeds,
  // dismiss the decision. A rejection at any step leaves the decision open,
  // preserves the counted quantity, and surfaces a retryable error — no
  // optimistic completion.
  const handleAcceptOverDelivery = useCallback(async () => {
    if (!overDeliveryDecision || overDeliverySubmitting) return;
    const { line, counted, approved, countConfirmed } = overDeliveryDecision;
    // GH-1241 S3-A1 — approval follows the persisted physical count; it never
    // confirms a count itself.
    if (!countConfirmed) return;
    const extra = Math.max(0, counted - line.quantity_expected);

    setOverDeliveryError(null);
    setOverDeliverySubmitting(true);
    try {
      await persistLineProgress(line, counted);
      await flushLineProgress(line.receive_job_line_id);

      // Refresh/re-entry contract (GH-1108): when this decision was
      // reconstructed from an already-persisted canonical overage approval
      // (initialOverDeliveryDecision), that evidence already exists on the
      // server — do not persist it again.
      if (!approved) {
        await onApproveOverDelivery({
          lasyncro_variant_id: line.lasyncro_variant_id,
          receive_job_line_id: line.receive_job_line_id,
          quantity_affected: extra,
          notes: `Accepted ${extra} extra unit${extra === 1 ? '' : 's'} during receive — approved by operator.`,
        });
      }

      const outcome = await inspectAndResolveReadiness(line, counted, 0);

      setOverDeliveryDecision(null);
      if (!outcome.awaitingLabelAck) {
        moveToNextLineOrReview(line.receive_job_line_id);
      }
    } catch (err: any) {
      setOverDeliveryError(err?.message ?? 'Could not approve the extra unit. Please retry.');
    } finally {
      setOverDeliverySubmitting(false);
    }
  }, [flushLineProgress, inspectAndResolveReadiness, moveToNextLineOrReview, onApproveOverDelivery, overDeliveryDecision, overDeliverySubmitting, persistLineProgress]);

  // WS-UX-RECEIVE-D4R S3-B — every over-delivery decision that writes the
  // provisional count waits for that write to be saved before the decision
  // closes. A failed save keeps the decision open with a retryable error and
  // puts the local count back to the last value written for this line, so
  // the screen never shows a count the server does not have. One submission
  // at a time.
  const persistOverDeliveryCount = useCallback(async (
    decision: NonNullable<typeof overDeliveryDecision>,
    nextAccepted: number,
  ) => {
    const lineId = decision.line.receive_job_line_id;
    const previous = savedProgressRef.current[lineId]
      ?? (decision.line.quantity_sellable_provisional != null
        ? Number(decision.line.quantity_sellable_provisional)
        : Number(decision.line.quantity_accepted ?? 0));
    setOverDeliveryError(null);
    setOverDeliverySubmitting(true);
    try {
      await persistLineProgress(decision.line, nextAccepted);
      await flushLineProgress(lineId);
      return true;
    } catch (err: any) {
      setAccepted(previous);
      setAcceptedByLine((prev) => ({ ...prev, [lineId]: previous }));
      setOverDeliveryError(err?.message
        ? `Count not saved: ${err.message}. Nothing changed; try again.`
        : 'Count not saved. Nothing changed; try again.');
      return false;
    } finally {
      setOverDeliverySubmitting(false);
    }
  }, [flushLineProgress, persistLineProgress]);

  // GH-1241 S3-A1 — the live warning's "keep": the extra stays in the draft
  // count (a scan has not drafted it yet) and the operator continues to
  // Finish Count, which confirms the physical count before any approval.
  const handleKeepOverCount = useCallback(async () => {
    if (!overDeliveryDecision || overDeliveryDecision.countConfirmed || overDeliverySubmitting) return;
    if (await persistOverDeliveryCount(overDeliveryDecision, overDeliveryDecision.counted)) {
      setOverDeliveryDecision(null);
    }
  }, [overDeliveryDecision, overDeliverySubmitting, persistOverDeliveryCount]);

  const handleRejectOverDelivery = useCallback(async () => {
    if (!overDeliveryDecision || overDeliverySubmitting) return;
    if (await persistOverDeliveryCount(overDeliveryDecision, overDeliveryDecision.line.quantity_expected)) {
      setOverDeliveryDecision(null);
    }
  }, [overDeliveryDecision, overDeliverySubmitting, persistOverDeliveryCount]);

  const handleReportOverDelivery = useCallback(async () => {
    if (!overDeliveryDecision || overDeliverySubmitting) return;
    const extra = Math.max(1, overDeliveryDecision.counted - overDeliveryDecision.line.quantity_expected);
    if (!(await persistOverDeliveryCount(overDeliveryDecision, overDeliveryDecision.line.quantity_expected))) return;
    setOverDeliveryDecision(null);
    openProblemDialog({
      choice: 'extra_item',
      qty: String(extra),
      notes: `${extra} extra unit${extra === 1 ? '' : 's'} found during receive`,
    });
  }, [openProblemDialog, overDeliveryDecision, overDeliverySubmitting, persistOverDeliveryCount]);

  const handleReportProblem = useCallback(async () => {
    if (!currentLine || !problemType) return;
    const qty = Number.parseInt(problemQty, 10);
    if (Number.isNaN(qty) || qty <= 0) {
      setProblemError('Enter a quantity to continue.');
      return;
    }
    const needsNotes = problemType === 'barcode_mismatch' || problemType === 'other';
    if (needsNotes && !problemNotes.trim()) {
      setProblemError('Add a note to continue.');
      return;
    }

    setProblemSubmitting(true);
    setProblemError(null);
    try {
      await onReportException({
        lasyncro_variant_id: currentLine.lasyncro_variant_id,
        receive_job_line_id: currentLine.receive_job_line_id,
        exception_type: problemType,
        quantity_affected: qty,
        notes: problemNotes.trim() || undefined,
      });
      setProblemDialog(false);
      setProblemChoice(null);
      setProblemType(null);
      setProblemNotes('');
      setProblemQty('1');
      await onRefresh?.();
    } catch (err: any) {
      setProblemError(err?.message ?? 'Could not report the problem. Your entry is still here; retry when ready.');
    } finally {
      setProblemSubmitting(false);
    }
  }, [currentLine, onRefresh, onReportException, problemNotes, problemQty, problemType]);

  // S8-C3 — only an applied canonical read decides closed vs open.
  const readCanonicalCloseStatus = useCallback(async (): Promise<CanonicalCloseStatus> => {
    if (!onRefresh) return 'unknown';
    try {
      const result = await onRefresh();
      if (!result || result.applied !== true) return 'unknown';
      if (result.closedAt || result.jobStatus === 'closed') return 'closed';
      return result.jobStatus != null && ACTIVE_RECEIVE_JOB_STATUSES.has(result.jobStatus) ? 'open' : 'unknown';
    } catch {
      return 'unknown';
    }
  }, [onRefresh]);

  const applyCloseStatus = useCallback((status: CanonicalCloseStatus) => {
    if (closeConfirmedRef.current || status === 'closed') {
      closeConfirmedRef.current = true;
      setCloseRecovery(null);
      setSubmitError(null);
      setCloseDetailsPending(status !== 'closed');
      setSessionPhase('handoff');
      return;
    }
    setCloseRecovery(status);
    setSubmitError(status === 'open' ? CLOSE_OPEN_MESSAGE : null);
  }, []);

  const handleCloseJob = useCallback(async () => {
    if (!deliveryDate.trim()) {
      setSubmitError('Actual delivery date is required before closing this receive.');
      return;
    }
    // WS-UX-RECEIVE-D4R S6 — one close request (or status read) at a time; an
    // unresolved outcome never sends another close.
    if (closeInFlightRef.current || closeConfirmedRef.current || closeRecovery === 'unknown') return;
    closeInFlightRef.current = true;

    setClosing(true);
    setSubmitError(null);
    setCloseRecovery(null);
    try {
      try {
        await onCloseJob({ actual_delivery_date: deliveryDate });
      } catch (err: any) {
        const refusal = closeRefusalMessage(err);
        if (refusal) {
          setSubmitError(refusal);
          return;
        }
        // GH-1241 S3C-M4 / S8-C3 — an unanswered or uncertain close may have
        // committed: read the canonical status before offering anything.
        setClosing(false);
        setCloseRecovery('checking');
        applyCloseStatus(await readCanonicalCloseStatus());
        return;
      }
      closeConfirmedRef.current = true;
      applyCloseStatus(await readCanonicalCloseStatus());
    } finally {
      closeInFlightRef.current = false;
      setClosing(false);
    }
  }, [applyCloseStatus, closeRecovery, deliveryDate, onCloseJob, readCanonicalCloseStatus]);

  const handleCheckCloseStatus = useCallback(async () => {
    if (closeInFlightRef.current) return;
    closeInFlightRef.current = true;
    setCloseRecovery('checking');
    try {
      applyCloseStatus(await readCanonicalCloseStatus());
    } finally {
      closeInFlightRef.current = false;
    }
  }, [applyCloseStatus, readCanonicalCloseStatus]);

  // WS-UX-RECEIVE-D4R S1 — Distributed Work Note (UX-13). The same canonical
  // facts as before, placed in the shell instead of a separate strip:
  // Action → eyebrow, Reference/Supplier/Job → header, Item/Identity/Qty → the
  // item line, Next → status line.
  // WS-UX-RECEIVE-D4R S7 — Exit never writes, closes, finalizes or releases
  // the claim: it only waits for what is already being saved and tells the
  // operator the truth about anything that is not.
  const exitBusy = submitting || countConfirming || shortfallSubmitting || overDeliverySubmitting || labelAckSubmitting
    || labelPrinting || closing || problemSubmitting || scanProcessing || claiming;
  const unsubmittedWork = (): string[] => {
    const reasons: string[] = [];
    for (const draft of Object.values(unsavedDraftRef.current)) {
      reasons.push(`the count of ${draft.quantity} for ${lineName(draft.line)} (this screen cannot save counts)`);
    }
    if (scanInputValue.trim()) reasons.push(`the scanned code ${scanInputValue.trim()}`);
    if (overDeliveryDecision && !overDeliveryDecision.approved) {
      reasons.push(`the extra-unit decision for ${lineName(overDeliveryDecision.line)}`);
    }
    if (reconciliationLine && (shortfallProblemType || shortfallProblemNotes.trim())) {
      reasons.push(`the shortfall reason for ${lineName(reconciliationLine.line)}`);
    }
    if (problemDialog && (problemChoice || problemNotes.trim())) reasons.push('the problem report you were writing');
    if (sessionPhase === 'review' && deliveryDate.trim()) reasons.push('the actual delivery date you entered');
    return reasons;
  };

  /** Every line whose latest provisional write the server refused, with what was attempted. */
  const exitFailures = () => Object.entries(failedProgressRef.current).map(([lineId, failure]) => ({
    lineId,
    name: lineName(failure.line),
    quantity: failure.quantity,
    error: failure.error.message || 'The server did not confirm the save.',
  }));

  const flushForExit = useCallback(async () => {
    const attempt = exitAttemptRef.current;
    try {
      await flushLineProgress();
      if (attempt !== exitAttemptRef.current) return;
      setExitSheet({ variant: 'checking' });
    } catch {
      if (attempt !== exitAttemptRef.current) return;
      exitInFlightRef.current = false;
      setExitSheet({ variant: 'failed', failures: exitFailures() });
    }
    // exitFailures reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushLineProgress]);

  const handleExitRequest = useCallback(() => {
    if (exitInFlightRef.current) return;
    exitInFlightRef.current = true;
    setExitSheet({ variant: 'saving' });
    void flushForExit();
  }, [flushForExit]);

  const handleExitSaveAgain = useCallback(() => {
    if (exitInFlightRef.current) return;
    exitInFlightRef.current = true;
    setExitSheet({ variant: 'saving' });
    // Retry each failed line with the quantity that line attempted; the count
    // on screen (possibly another product) is left untouched.
    for (const failure of Object.values(failedProgressRef.current)) {
      void enqueueProgressWrite(failure.line, failure.quantity);
    }
    void flushForExit();
  }, [enqueueProgressWrite, flushForExit]);

  const leaveSession = useCallback(() => {
    exitInFlightRef.current = false;
    setExitSheet(null);
    onComplete();
  }, [onComplete]);

  const keepReceiving = useCallback(() => {
    exitAttemptRef.current += 1;
    exitInFlightRef.current = false;
    setExitSheet(null);
  }, []);

  // Once queued writes are flushed and nothing consequential is in flight,
  // flush once more (a finished submission may have queued a write) and
  // decide: unsaved choices, or saved.
  useEffect(() => {
    if (exitSheet?.variant !== 'checking' || exitBusy) return;
    let cancelled = false;
    const attempt = exitAttemptRef.current;
    void (async () => {
      try {
        await flushLineProgress();
      } catch {
        if (cancelled || attempt !== exitAttemptRef.current) return;
        exitInFlightRef.current = false;
        setExitSheet({ variant: 'failed', failures: exitFailures() });
        return;
      }
      if (cancelled || attempt !== exitAttemptRef.current) return;
      const reasons = unsubmittedWork();
      exitInFlightRef.current = false;
      setExitSheet(reasons.length > 0 ? { variant: 'review', reasons } : { variant: 'saved' });
    })();
    return () => { cancelled = true; };
    // unsubmittedWork reads current render state; re-run only on these changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exitBusy, exitSheet, flushLineProgress]);

  const getWorkNote = () => {
    const item = currentLine ? lineName(currentLine) : `${lines.length} lines`;
    const identity = currentLine
      ? currentLine.barcode?.trim() || currentLine.sku || currentLine.lasyncro_variant_id || currentLine.receive_job_line_id
      : receiveJobId;
    const action = sessionPhase === 'brief'
      ? 'Brief'
      : sessionPhase === 'review'
        ? 'Review receive'
        : sessionPhase === 'handoff'
          ? 'Stow handoff'
          : sessionPhase === 'reconcile'
            ? 'Reconcile'
            : currentAwaitingLabel
            ? 'Label hold'
            : lineAction === 'scan'
              ? 'Scan line'
              : 'Count line';
    const quantity = currentLine
      ? sessionPhase === 'reconcile' && reconciliationLine
        ? `${reconciliationLine.accepted}/${currentLine.quantity_expected}, ${reconciliationLine.remainingShortfall} unaccounted`
        : `${activeAccepted}/${currentLine.quantity_expected}${activeAccepted > currentLine.quantity_expected ? `, +${activeAccepted - currentLine.quantity_expected} extra` : ''}${activeRejected ? `, ${activeRejected} problem` : ''}`
      : `${completedCount}/${lines.length} lines`;
    const nextStep = sessionPhase === 'brief'
      ? blockedByOwnership
        ? 'assigned operator continues'
        : blockedUnassigned
          ? 'assignment required'
          : jobStatus === 'cancelled'
            ? 'receive unavailable'
            : requiresClaim
              ? 'claim & start receive'
              : 'start receive'
      : sessionPhase === 'review'
        ? 'close receive'
        : sessionPhase === 'handoff'
          ? 'move stock to stow'
          : sessionPhase === 'reconcile'
            ? reconciliationLine && reconciliationLine.remainingShortfall <= 0 ? 'finish line' : 'account shortfall'
            : currentAwaitingLabel
              ? 'attach unit labels'
              : lineAction === 'scan'
                ? 'scan or count locally'
                : 'finish count';
    return { item, identity, action, quantity, nextStep };
  };
  const workNote = getWorkNote();

  const LineMedia = ({ line, size = 44 }: { line: ReceiveJobLine; size?: number }) => (
    line.image_url ? (
      <Box component="img" src={line.image_url} alt="" sx={{ width: size, height: size, objectFit: 'cover', borderRadius: '8px', flexShrink: 0 }} />
    ) : (
      <Box sx={{ width: size, height: size, borderRadius: '8px', bgcolor: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Package size={Math.max(16, size / 2.5)} style={{ opacity: 0.4 }} />
      </Box>
    )
  );

  /** Item + mono identity + Work Note quantity for the current line. */
  const currentItemLine = (line: ReceiveJobLine, withMedia = true) => (
    <ReceiveItemLine
      media={withMedia ? <LineMedia line={line} size={40} /> : undefined}
      name={lineName(line)}
      identity={`${workNote.identity} · ${workNote.quantity}`}
    />
  );

  const statusNext = (tone: ReceiveStatusTone = 'neutral') => (
    <ReceiveStatusLine tone={tone}>Next · {workNote.nextStep}</ReceiveStatusLine>
  );

  const lineRowSx = {
    '& td': { borderBottom: '1px solid var(--rule)', py: 0.75, px: { xs: 1.25, md: 2 } },
    '&:last-of-type td': { borderBottom: 0 },
  } as const;
  // WS-UX-RECEIVE-D4R S6 — V3.1 list rows stay one-line by default so six fit;
  // operators can explicitly expand the full name and identity without hover.
  const rowNameSx = { fontSize: 14, fontWeight: 500, lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;
  const rowMetaSx = { ...monoSx, fontSize: 11, lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;
  const shrinkCellSx = { width: '100%', maxWidth: 0 } as const;

  // S8-C4 — Review names stay single-line with ellipsis on every viewport so
  // six rows fit without scrolling; the identity dialog shows name and SKU in full.
  const reviewWrapSx = {
    name: {},
    meta: {},
  } as const;
  const expandableLineIdentity = (line: ReceiveJobLine, meta: ReactNode, wrap = false) => {
    const identity = line.sku ?? line.receive_job_line_id;
    return (
      <Button
        variant="text"
        color="inherit"
        aria-expanded={identityDetailLine?.receive_job_line_id === line.receive_job_line_id}
        aria-haspopup="dialog"
        aria-label={`Show full product identity for ${lineName(line)}, SKU ${identity}`}
        onClick={() => setIdentityDetailLine(line)}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          justifyContent: 'center',
          width: '100%',
          minWidth: 0,
          p: 0,
          // S8-C4 — a 44px mobile hit area without growing the row: the
          // invisible target extends 6px above and below, inside the cell.
          position: 'relative',
          '&::after': { content: '""', position: 'absolute', left: 0, right: 0, top: { xs: -6, md: 0 }, bottom: { xs: -6, md: 0 } },
          borderRadius: '3px',
          color: 'inherit',
          textAlign: 'left',
          textTransform: 'none',
          '&:hover': { bgcolor: 'transparent' },
          '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '2px' },
        }}
      >
        <Typography sx={{
          ...rowNameSx,
          ...(wrap ? reviewWrapSx.name : {}),
        }}>
          {lineName(line)}
        </Typography>
        <Typography component="div" sx={{
          ...rowMetaSx,
          ...(wrap ? reviewWrapSx.meta : {}),
          color: 'var(--ink-3)',
        }}>
          {meta}
        </Typography>
      </Button>
    );
  };

  const briefHeadSx = { fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', borderBottom: '1px solid var(--rule)', py: 0.75 } as const;
  const wideOnlySx = { display: { xs: 'none', sm: 'table-cell' } } as const;
  const narrowOnlySx = { display: { xs: 'block', sm: 'none' } } as const;
  const pageCount = Math.max(1, Math.ceil(lines.length / RECEIVE_LIST_PAGE_SIZE));
  const pageIndex = Math.min(listPage, pageCount - 1);
  const pageLines = lines.slice(pageIndex * RECEIVE_LIST_PAGE_SIZE, (pageIndex + 1) * RECEIVE_LIST_PAGE_SIZE);
  const briefQtySx = { ...monoSx, fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', verticalAlign: 'top' } as const;

  const renderBrief = () => (
    // Lists carry up to six rows; a tighter local rhythm keeps them on one screen.
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 1.25, md: 1.75 }, flex: { xs: 1, md: 'none' } }}>
      <ReceiveTaskHeading
        eyebrow={workNote.action}
        title={<>Receive from {supplierName}</>}
        sub={`${lines.length} ${lines.length === 1 ? 'product' : 'products'} · ${totalExpected} ${totalExpected === 1 ? 'unit' : 'units'} expected`}
      />

      <Box sx={{ border: '1px solid var(--rule-2)', borderRadius: '12px', bgcolor: 'var(--surface)', overflow: 'hidden' }}>
        <Table size="small" aria-label="Products on this Receive">
          <TableHead>
            <TableRow>
              <TableCell sx={briefHeadSx}>Product</TableCell>
              <TableCell align="right" sx={briefHeadSx}>Expected</TableCell>
              <TableCell align="right" sx={{ ...briefHeadSx, ...wideOnlySx }}>Received</TableCell>
              <TableCell align="right" sx={{ ...briefHeadSx, ...wideOnlySx }}>Remaining</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pageLines.map((line) => {
              const acceptedQty = acceptedByLine[line.receive_job_line_id] ?? Number(line.quantity_accepted ?? 0);
              const remainingQty = Math.max(0, line.quantity_expected - acceptedQty);
              const awaiting = isLineAwaitingLabel(line);
              const complete = isLineComplete(line);
              return (
                <TableRow key={line.receive_job_line_id} sx={lineRowSx}>
                  <TableCell sx={shrinkCellSx}>
                    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', minWidth: 0 }}>
                    <Box
                      aria-hidden="true"
                      sx={{ width: 20, height: 20, flex: '0 0 auto', borderRadius: '50%', bgcolor: complete && !awaiting ? 'var(--good-ink)' : awaiting ? 'var(--accent)' : 'var(--bg-3)' }}
                    />
                    <Box sx={{ minWidth: 0 }}>
                    {expandableLineIdentity(line, <>
                      <Box component="span" sx={{ fontFamily: 'inherit' }}>{variantName(line)}</Box>
                      {line.sku && line.sku !== variantName(line) ? <> · {line.sku}</> : null}
                      {' · '}
                      <Box component="span">
                        {hasExternalBarcode(line) ? `barcode ${line.barcode}` : awaiting ? 'LSU label hold' : 'barcode-less: LSU labels after count'}
                      </Box>
                    </>)}
                    {/* Mobile keeps the facts of the collapsed columns. */}
                    <Typography component="div" sx={{ ...rowMetaSx, ...narrowOnlySx, whiteSpace: 'normal', fontFamily: 'inherit', letterSpacing: 0, color: 'var(--ink-2)' }}>
                      {`Received ${acceptedQty} · Remaining ${remainingQty}`}
                    </Typography>
                    <ReportedProblemSummary line={line} compact />
                    </Box>
                    </Box>
                  </TableCell>
                  <TableCell align="right" sx={briefQtySx}>{line.quantity_expected}</TableCell>
                  <TableCell align="right" sx={{ ...briefQtySx, ...wideOnlySx }}>{acceptedQty}</TableCell>
                  <TableCell align="right" sx={{ ...briefQtySx, ...wideOnlySx }}>{remainingQty}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>
      <ReceiveListPager page={pageIndex} total={lines.length} onPage={setListPage} label="Products on this Receive pages" />

      {claimError && <Alert severity="error">{claimError}</Alert>}
      {blockedByOwnership && (
        <Alert severity="warning">
          This Receive is assigned to another operator. Only the assigned operator can continue this job.
        </Alert>
      )}
      {blockedUnassigned && (
        <Alert severity="warning">
          This Receive must be assigned before it can be started or continued.
        </Alert>
      )}
      {jobStatus === 'cancelled' && (
        <Alert severity="warning">
          This Receive job has been cancelled and cannot be started.
        </Alert>
      )}

      <ReceiveActions>
        <ReceiveStatusLine>
          Count good units only. Barcode-less products get LSU labels after count. Next · {workNote.nextStep}
        </ReceiveStatusLine>
        {!blockedLifecycle && (requiresClaim || !hasCanonicalJobStatus) && (
          <ReceiveCta onClick={handleStart} disabled={claiming}>
            {claiming
              ? 'Claiming…'
              : requiresClaim
                ? 'Claim & Start Receive'
                : 'Start Receive'}
          </ReceiveCta>
        )}
      </ReceiveActions>
    </Box>
  );

  const renderLineRail = () => (
    <Box sx={{ border: '1px solid var(--rule-2)', borderRadius: '12px', bgcolor: 'var(--surface)', overflow: 'hidden' }}>
      {lines.map((line, index) => {
        const complete = isLineComplete(line);
        const awaiting = isLineAwaitingLabel(line);
        const done = isLineDone(line);
        return (
          <Box
            key={line.receive_job_line_id}
            component="button"
            disabled={done}
            onClick={() => { setCurrentIndex(index); setLinesDrawerOpen(false); }}
            sx={{
              width: '100%',
              display: 'grid',
              gridTemplateColumns: 'auto minmax(0,1fr) auto',
              gap: 1.5,
              alignItems: 'center',
              px: 2,
              py: 1.25,
              border: 0,
              borderBottom: index === lines.length - 1 ? 0 : '1px solid var(--rule)',
              bgcolor: currentIndex === index ? 'var(--accent-ghost)' : 'transparent',
              color: 'var(--ink)',
              font: 'inherit',
              textAlign: 'left',
              cursor: done ? 'not-allowed' : 'pointer',
              opacity: done ? 0.58 : 1,
            }}
          >
            {done ? <CheckCircle size={18} color="var(--good-ink)" /> : awaiting ? <AlertTriangle size={18} color="var(--accent)" /> : <Hash size={18} color="var(--ink-3)" />}
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 500, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{lineName(line)}</Typography>
              <Typography sx={{ ...monoSx, fontSize: 11, color: 'var(--ink-3)', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                {line.sku ?? line.receive_job_line_id}
              </Typography>
              <ReportedProblemSummary line={line} compact />
            </Box>
            <Typography component="span" sx={{ ...monoSx, fontSize: 12, color: 'var(--ink-2)' }}>
              {statusLabel(line, awaiting, complete)}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );

  const renderInspect = () => {
    if (!currentLine) return null;
    const remaining = Math.max(0, currentLine.quantity_expected - activeAccepted);

    if (currentAwaitingLabel) {
      // WS-UX-RECEIVE-D4R S4 — Label hold (V3.1 Labels printing / Print
      // failed / Labels ready). The hold stays until the operator confirms the
      // labels are physically attached; print success or failure never does.
      const labelCount = `${activeAccepted} unit ${activeAccepted === 1 ? 'label' : 'labels'}`;
      // WS-UX-RECEIVE-D4R S8-C2 — print status is local only: after refresh or
      // re-entry (or without a print path) it is unknown, never "printed".
      // A resolved print request is a dispatch (printer or PDF), not proof of
      // printed or attached labels.
      const printUnknown = !labelPrinting && !labelPrintFailed && !labelsPrinted;
      const printLeads = printUnknown && !!onPrintUnitLabels;
      const unitLabels = `${activeAccepted} unit ${activeAccepted === 1 ? 'label' : 'labels'}`;
      const holdStatus = labelPrinting ? (
        <ReceiveStatusLine tone="warn" role="status">
          {lineName(currentLine)} · Sending labels to the printer…
        </ReceiveStatusLine>
      ) : submitError ? (
        <ReceiveStatusLine tone="error" role="alert">
          {lineName(currentLine)} · {submitError}
        </ReceiveStatusLine>
      ) : labelPrintFailed ? (
        <ReceiveStatusLine tone="error" role="alert">
          {lineName(currentLine)} · Print failed · reprint, then attach a label to every unit
        </ReceiveStatusLine>
      ) : (
        <ReceiveStatusLine tone={labelsPrinted ? 'ok' : 'neutral'}>
          {lineName(currentLine)} · {labelsPrinted
            ? `Print request sent · check all ${activeAccepted} labels printed, then attach them`
            : printLeads
              ? 'Next · print labels'
              : `Next · attach a label to each of the ${activeAccepted} ${activeAccepted === 1 ? 'unit' : 'units'}`}
        </ReceiveStatusLine>
      );
      return (
        <>
          <ReceiveTaskHeading
            eyebrow={workNote.action}
            eyebrowTone={labelPrintFailed && !labelPrinting ? 'error' : 'accent'}
            title={labelPrinting ? 'Print' : labelPrintFailed ? 'Labels' : printUnknown ? 'Confirm' : 'Attach'}
            accent={labelPrinting ? `${labelCount}.` : labelPrintFailed ? 'didn’t print.' : printUnknown ? `${unitLabels}.` : `${labelCount}.`}
            sub={labelPrinting
              ? 'These units have no barcode. One label goes on each unit.'
              : labelPrintFailed
                ? `The print request failed. Reprint, or continue only after all ${activeAccepted} labels are physically attached.`
                : labelsPrinted
                  ? 'Print request sent to the printer or opened as a PDF. Check every label, attach one to each unit, then confirm.'
                  : printLeads
                    ? `Label printing status is unknown. Print labels if needed, or continue only after all ${activeAccepted} labels are physically attached.`
                    : `Label printing status is unknown. Continue only after all ${activeAccepted} labels are physically attached.`}
          />
          {currentItemLine(currentLine)}
          <ReportedProblemSummary line={currentLine} />
          {labelPrinting && (
            <LinearProgress
              aria-label="Printing labels"
              sx={{ width: 200, alignSelf: 'center', height: 3, borderRadius: '2px', bgcolor: 'var(--bg-3)', '& .MuiLinearProgress-bar': { bgcolor: 'var(--accent)' } }}
            />
          )}
          {labelPrintFailed && !labelPrinting && (
            <Box sx={{ borderRadius: '10px', px: 1.75, py: 1.25, textAlign: 'center', fontSize: 13, bgcolor: 'var(--warning-ghost, var(--bg-2))', color: 'var(--ink-2)' }}>
              <Box component="b" sx={{ display: 'block', fontWeight: 600 }}>Labels could not be printed.</Box>
              {`${activeAccepted} ${activeAccepted === 1 ? 'label' : 'labels'} for ${activeAccepted} ${activeAccepted === 1 ? 'unit' : 'units'}. Check the printer, then reprint.`}
            </Box>
          )}
          <ReceiveActions>
            {holdStatus}
            {labelPrintFailed && onPrintUnitLabels && (
              <ReceiveCta tier="strong" disabled={labelPrinting || labelAckSubmitting} onClick={() => void handleRetryPrintLabels()}>
                {labelPrinting ? 'Printing…' : 'Reprint labels'}
              </ReceiveCta>
            )}
            {printLeads && (
              <ReceiveCta disabled={labelAckSubmitting} onClick={() => void handleRetryPrintLabels()}>
                Print labels
              </ReceiveCta>
            )}
            <ReceiveCta
              data-testid="confirm-unit-labels-printed"
              tier={labelPrintFailed || printLeads ? 'secondary' : 'primary'}
              disabled={labelAckSubmitting || labelPrinting}
              onClick={() => void handleConfirmLabelsPrinted()}
              startIcon={<CheckCircle size={16} />}
            >
              {labelAckSubmitting ? 'Confirming...' : `All ${activeAccepted} labels are attached`}
            </ReceiveCta>
            {!labelPrintFailed && !printLeads && !labelPrinting && onPrintUnitLabels && (
              <ReceiveTextAction disabled={labelPrinting || labelAckSubmitting} onClick={() => void handleRetryPrintLabels()}>
                {labelsPrinted ? 'Reprint labels' : 'Print labels'}
              </ReceiveTextAction>
            )}
          </ReceiveActions>
        </>
      );
    }

    const scanning = lineAction === 'scan' && currentCanScan;
    return (
      <>
        <ReceiveTaskHeading
          eyebrow={workNote.action}
          title={scanning ? 'Scan each' : lineName(currentLine)}
          accent={scanning ? 'good unit.' : undefined}
          titleSx={scanning ? undefined : { fontSize: { xs: 30, md: 44 } }}
        />
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: { xs: 1.5, md: 2 },
            borderRadius: '12px',
            bgcolor: flashLine === currentLine.receive_job_line_id ? 'var(--good-ghost, rgba(34,197,94,0.10))' : 'transparent',
            transition: 'background-color 180ms ease',
          }}
        >
          <ReceiveProductImage src={currentLine.image_url} />
          {currentItemLine(currentLine, false)}

          {currentCanScan && (
            <Box
              role="group"
              aria-label="Receive treatment"
              sx={{ alignSelf: 'center', display: 'inline-flex', border: '1px solid var(--rule-2)', borderRadius: '100px', p: '3px', bgcolor: 'var(--surface)' }}
            >
              {(['scan', 'count'] as const).map((mode) => (
                <Button
                  key={mode}
                  size="small"
                  aria-pressed={lineAction === mode}
                  startIcon={mode === 'scan' ? <ScanBarcode size={14} /> : <Hash size={14} />}
                  onClick={() => {
                    if (mode === 'scan') {
                      setLineAction('scan');
                      return;
                    }
                    setLineAction('count');
                  }}
                  sx={{
                    minHeight: { xs: 44, md: 28 },
                    px: 1.75,
                    borderRadius: '100px',
                    ...receiveFocusRingSx,
                    fontSize: 12,
                    fontWeight: 500,
                    textTransform: 'none',
                    color: lineAction === mode ? 'var(--bg)' : 'var(--ink-3)',
                    bgcolor: lineAction === mode ? 'var(--ink)' : 'transparent',
                    '&:hover': { bgcolor: lineAction === mode ? 'var(--ink)' : 'var(--bg-2)' },
                  }}
                >
                  {mode === 'scan' ? 'Scan' : 'Count'}
                </Button>
              ))}
            </Box>
          )}

          <ReportedProblemSummary line={currentLine} />

          <Box sx={{ display: 'grid', gap: 1.25 }}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '64px minmax(0,1fr) 64px', md: '88px minmax(0,1fr) 88px' },
                alignItems: 'center',
                gap: { xs: 1, md: 1.5 },
                p: { xs: '12px', md: '20px 24px' },
                border: '1px solid var(--rule-2)',
                borderRadius: '12px',
                bgcolor: 'var(--surface)',
              }}
            >
              <Button
                variant="outlined"
                onClick={() => {
                  const next = Math.max(0, accepted - 1);
                  establishCount(currentLine);
                  void persistLineProgress(currentLine, next);
                }}
                disabled={scanning || !currentCountEstablished || accepted <= 0 || currentComplete}
                sx={countStepperButtonSx()}
              >
                −
              </Button>

              <Box sx={{ display: 'grid', justifyItems: 'center', gap: '2px', minWidth: 0 }}>
                <TextField
                  variant="standard"
                  value={currentCountEstablished ? accepted : ''}
                  placeholder="Not counted"
                  disabled={scanning || currentComplete}
                  onChange={(event) => {
                    const next = Number.parseInt(event.target.value, 10);
                    if (Number.isNaN(next) || next < 0) return;
                    const crossedExpected = accepted <= currentLine.quantity_expected;
                    establishCount(currentLine);
                    void persistLineProgress(currentLine, next);
                    if (next > currentLine.quantity_expected && crossedExpected) {
                      setOverDeliveryError(null);
                      setOverDeliveryDecision({ line: currentLine, counted: next });
                      return;
                    }
                  }}
                  InputProps={{ disableUnderline: true }}
                  inputProps={{
                    min: 0,
                    'aria-label': 'Sellable count',
                    style: { textAlign: 'center', fontWeight: 300, padding: 0 },
                  }}
                  sx={countValueSx}
                />
                <Typography component="span" sx={{ fontSize: 14, fontWeight: 300, color: 'var(--ink-3)' }}>
                  {currentCountEstablished
                    ? `${accepted} / ${currentLine.quantity_expected} expected · remaining ${remaining}`
                    : `of ${currentLine.quantity_expected} expected`}
                </Typography>
              </Box>

              <Button
                variant="outlined"
                onClick={() => {
                  const next = accepted + 1;
                  establishCount(currentLine);
                  void persistLineProgress(currentLine, next);
                  if (accepted === currentLine.quantity_expected) {
                    setOverDeliveryError(null);
                    setOverDeliveryDecision({ line: currentLine, counted: next });
                    return;
                  }
                }}
                disabled={scanning || currentComplete}
                sx={countStepperButtonSx(true)}
              >
                +
              </Button>
            </Box>

            {scanning && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.75,
                  height: 60,
                  px: 2.25,
                  border: scanError ? '1.5px solid var(--critical-ink)' : '1px solid var(--rule-2)',
                  borderStyle: scanProcessing ? 'dashed' : 'solid',
                  borderRadius: '12px',
                  bgcolor: 'var(--surface)',
                }}
              >
                <ScanBarcode size={18} color="var(--accent)" aria-hidden="true" />
                <TextField
                  inputRef={scanInputRef}
                  variant="standard"
                  fullWidth
                  value={scanInputValue}
                  disabled={!scanReady || scanProcessing || currentComplete}
                  placeholder="Scan barcode"
                  onChange={(event) => setScanInputValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    const value = scanInputValue;
                    setScanInputValue('');
                    void handleScan(value);
                  }}
                  autoComplete="off"
                  InputProps={{ disableUnderline: true }}
                  inputProps={{ style: { ...monoSx, fontSize: 18 } }}
                />
                <Box
                  component="span"
                  aria-hidden="true"
                  sx={{ display: { xs: 'none', md: 'inline' }, fontSize: 10, fontWeight: 500, border: '1px solid currentColor', borderRadius: '4px', px: 0.75, py: '2px', opacity: 0.75 }}
                >
                  Enter
                </Box>
              </Box>
            )}
          </Box>
        </Box>

        {submitError && <Alert severity="error">{submitError}</Alert>}

        <ReceiveActions>
          {scanning && scanError ? (
            <ReceiveStatusLine tone="error" role="alert">
              <Box component="span">{scanError}</Box>
              <Button size="small" color="inherit" onClick={() => setScanError(null)} sx={{ ml: 1, minWidth: { xs: 44, md: 0 }, textTransform: 'none', fontSize: 12, ...receiveTouchTargetSx, ...receiveFocusRingSx }}>
                Dismiss
              </Button>
            </ReceiveStatusLine>
          ) : scanning ? (
            <ReceiveStatusLine tone={scanProcessing ? 'warn' : 'ok'}>
              {scanProcessing ? 'Processing scan...' : 'Scanner ready · each scan adds 1'} · Next · {workNote.nextStep}
            </ReceiveStatusLine>
          ) : (
            statusNext()
          )}
          <ReceiveCta
            aria-label="Finish count Confirm line"
            disabled={submitting || countConfirming || !currentCountEstablished || currentComplete}
            onClick={() => void handleCountConfirm()}
          >
            {submitting ? 'Saving...' : 'Finish count'}
          </ReceiveCta>
        </ReceiveActions>
      </>
    );
  };

  const renderReconciliation = () => {
    if (!reconciliationLine) return renderInspect();
    const { line, accepted: sellable, totalShortfall, remainingShortfall, allocations } = reconciliationLine;
    const accounted = totalShortfall - remainingShortfall;
    const selectedChoice = RECONCILIATION_CHOICES.find((choice) => choice.type === shortfallProblemType);

    return (
      // Shortfall carries the densest decision: a tighter local rhythm keeps
      // every reason, the notes, errors and actions inside one screen.
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 0.75, md: 1.75 }, flex: { xs: 1, md: 'none' } }}>
        <ReceiveTaskHeading
          eyebrow={workNote.action}
          title={remainingShortfall === 0 ? 'All' : `${sellable} of ${line.quantity_expected}`}
          accent={remainingShortfall === 0 ? 'accounted for.' : 'sellable.'}
          titleSx={{ fontSize: { xs: 34, md: 44 } }}
          sub={remainingShortfall === 0
            ? `Sellable ${sellable} + accounted ${accounted} = expected ${line.quantity_expected}`
            : `Account for the remaining ${remainingShortfall} ${remainingShortfall === 1 ? 'unit' : 'units'} before finishing this line.`}
        />
        {currentItemLine(line)}
        <ReceiveFactStrip
          facts={[
            { label: 'Expected', value: line.quantity_expected },
            { label: 'Sellable', value: sellable },
            { label: 'To account for', value: remainingShortfall, highlight: remainingShortfall > 0 },
          ]}
        />

        <ReceivePillRow>
          {allocations.map((allocation, index) => (
            <ReceivePill key={`${allocation.type}-${index}`}>
              <span>{problemLabel(allocation.type)}</span>
              <b>{unitLabel(allocation.quantity)}</b>
            </ReceivePill>
          ))}
          <ReceivePill tone={remainingShortfall === 0 ? 'ok' : 'neutral'}>
            <span>{`Accounted ${accounted} / ${totalShortfall}`}</span>
          </ReceivePill>
          <ReceivePill>
            <span>{`To account for ${remainingShortfall}`}</span>
          </ReceivePill>
        </ReceivePillRow>

        {submitError && <Alert severity="error">{submitError}</Alert>}

        {remainingShortfall > 0 && (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
            {RECONCILIATION_CHOICES.map((choice) => {
              const selected = shortfallProblemType === choice.type;
              return (
                <Button
                  key={choice.type}
                  variant="outlined"
                  color="inherit"
                  aria-pressed={selected}
                  data-testid={`reconciliation-choice-${choice.type}`}
                  disabled={remainingShortfall === 0 || shortfallSubmitting}
                  onClick={() => {
                    setShortfallProblemType(choice.type);
                    setShortfallProblemQty('1');
                    setShortfallProblemNotes('');
                    setShortfallQtyError(null);
                  }}
                  sx={reconciliationChoiceSx(selected)}
                >
                  <Box component="span" sx={{ display: 'grid', gap: '1px', textAlign: 'left', minWidth: 0 }}>
                    <Box component="span" sx={{ fontSize: 14, fontWeight: 500, lineHeight: 1.3 }}>{choice.label}</Box>
                    <Box component="span" sx={{ display: { xs: 'none', md: 'block' }, fontSize: 12, fontWeight: 300, lineHeight: 1.3, color: 'var(--ink-3)' }}>
                      {choice.hint}
                    </Box>
                  </Box>
                </Button>
              );
            })}
          </Box>
        )}

        {shortfallProblemType && remainingShortfall > 0 && (
          <Box sx={{ display: 'grid', gap: 1 }}>
            {selectedChoice?.requiresNotes && (
              <TextField
                label="Notes"
                size="small"
                value={shortfallProblemNotes}
                onChange={(event) => setShortfallProblemNotes(event.target.value)}
                required
                error={!!shortfallQtyError && !shortfallProblemNotes.trim()}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px', bgcolor: 'var(--surface)' } }}
              />
            )}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: 1.25, alignItems: 'center' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', height: { xs: 52, md: 56 }, border: '1px solid var(--rule-2)', borderRadius: '10px', bgcolor: 'var(--surface)' }}>
                <Button
                  color="inherit"
                  disabled={shortfallSubmitting}
                  onClick={() => {
                    const current = Number.parseInt(shortfallProblemQty, 10) || 1;
                    setShortfallProblemQty(String(Math.max(1, current - 1)));
                  }}
                  sx={{ minWidth: 44, height: '100%', fontSize: 22, fontWeight: 300 }}
                >
                  −
                </Button>
                <TextField
                  type="number"
                  variant="standard"
                  value={shortfallProblemQty}
                  onChange={(event) => {
                    setShortfallProblemQty(event.target.value);
                    setShortfallQtyError(null);
                  }}
                  error={!!shortfallQtyError}
                  InputProps={{ disableUnderline: true }}
                  inputProps={{
                    min: 1,
                    max: remainingShortfall,
                    'aria-label': 'Qty affected',
                    style: { ...monoSx, textAlign: 'center', fontSize: 20, fontWeight: 500 },
                  }}
                  sx={{ width: 52, borderLeft: '1px solid var(--rule)', borderRight: '1px solid var(--rule)' }}
                />
                <Button
                  color="inherit"
                  disabled={shortfallSubmitting}
                  onClick={() => {
                    const current = Number.parseInt(shortfallProblemQty, 10) || 1;
                    setShortfallProblemQty(String(Math.min(remainingShortfall, current + 1)));
                  }}
                  sx={{ minWidth: 44, height: '100%', fontSize: 22, fontWeight: 300 }}
                >
                  +
                </Button>
              </Box>
              <ReceiveCta
                disabled={shortfallSubmitting || !shortfallProblemType}
                onClick={() => void handleReconciliationAllocation()}
              >
                {shortfallSubmitting ? 'Adding...' : 'Add to reconciliation'}
              </ReceiveCta>
            </Box>
          </Box>
        )}

        <ReceiveActions>
          {/* One status slot: a validation error replaces Next until it is fixed. */}
          {shortfallQtyError && remainingShortfall > 0 ? (
            <ReceiveStatusLine tone="error" role="alert">{shortfallQtyError}</ReceiveStatusLine>
          ) : (
            statusNext(remainingShortfall > 0 ? 'warn' : 'ok')
          )}
          <ReceiveCta
            tier={remainingShortfall > 0 && shortfallProblemType ? 'secondary' : 'primary'}
            disabled={remainingShortfall > 0 || submitting}
            onClick={() => void handleFinishReconciledLine()}
          >
            {submitting ? 'Finishing...' : 'Finish line'}
          </ReceiveCta>
          {(allocations.length === 0 || onRecountLine) && (
            <ReceiveTextAction
              disabled={shortfallSubmitting || submitting}
              onClick={() => (allocations.length === 0
                ? void handleReconciliationMiscount()
                : setRecountSheet({ status: 'confirm' }))}
            >
              Recount
            </ReceiveTextAction>
          )}
        </ReceiveActions>
      </Box>
    );
  };

  // S4-4C — server-authoritative held units across every line, never just the
  // visible page. A label acknowledged in this session counts before the next
  // re-read; placement itself is still refused server-side without it.
  const heldUnits = lines.flatMap((line) => (line.held_units ?? []).map((unit) => (
    acknowledgedLabelLines.has(line.receive_job_line_id) ? { ...unit, label_acknowledged: true } : unit
  )));
  const unplacedHeld = heldUnits.filter((unit) => !unit.placed).length;

  const custodyRefusal = (err: any, fallback: string) => {
    if (!err?.response) return "Couldn't reach the server. Scan again to retry — nothing is placed twice.";
    const code = String(err.response.data?.code ?? '');
    if (code === 'RECEIVE_PROBLEM_BIN_INVALID') return "That isn't an active problem bin. Scan a bin in a problem zone.";
    if (code === 'RECEIVE_HELD_UNIT_ALREADY_PLACED') return 'That unit is already in a problem bin.';
    if (code === 'RECEIVE_HELD_CUSTODY_REPLAY_CONFLICT') return 'That scan conflicts with a placement already recorded. Scan the unit again.';
    if (code === 'RECEIVE_HELD_LABEL_REQUIRED') return 'Attach and confirm this unit’s label before placing it.';
    if (code === 'RECEIVE_HELD_UNIT_NOT_HELD' || code === 'RECEIVE_HELD_UNIT_NOT_FOUND') return 'That label isn’t a held unit of this Receive.';
    return fallback;
  };

  const handleResolveProblemBin = useCallback(async (raw: string) => {
    const value = raw.trim();
    if (!value || custodyInFlightRef.current) return;
    if (!onResolveProblemBin) {
      setCustodyNotice({ tone: 'error', text: 'Problem-bin scanning is unavailable. Refresh and try again.' });
      return;
    }
    custodyInFlightRef.current = true;
    setCustodyBusy(true);
    try {
      const bin = await onResolveProblemBin(value);
      setProblemBin(bin);
      setCustodyNotice({ tone: 'ok', text: `Problem bin ${bin.location_code} selected. Scan each held unit.` });
      window.setTimeout(() => heldInputRef.current?.focus(), 30);
    } catch (err: any) {
      setCustodyNotice({ tone: 'error', text: custodyRefusal(err, 'That bin couldn’t be checked. Try again.') });
    } finally {
      custodyInFlightRef.current = false;
      setCustodyBusy(false);
    }
  }, [onResolveProblemBin]);

  const handlePlaceHeldUnit = useCallback(async (raw: string) => {
    const value = raw.trim();
    if (!value || custodyInFlightRef.current) return;
    const unit = heldUnits.find((candidate) => candidate.lasyncro_unit_id.toLowerCase() === value.toLowerCase());
    if (!unit) {
      setCustodyNotice({ tone: 'error', text: 'That label isn’t a held unit of this Receive.' });
      return;
    }
    // A duplicate scan of a placed unit never reaches the server.
    if (unit.placed) {
      setCustodyNotice({ tone: 'warn', text: `${unit.lasyncro_unit_id} is already in ${unit.location_code}.` });
      return;
    }
    if (!unit.label_acknowledged) {
      setCustodyNotice({ tone: 'error', text: 'Attach and confirm this unit’s label before placing it.' });
      return;
    }
    if (!problemBin) {
      setCustodyNotice({ tone: 'warn', text: 'Scan the problem bin first.' });
      return;
    }
    if (!onPlaceHeldUnit) {
      setCustodyNotice({ tone: 'error', text: 'Placing held units is unavailable. Refresh and try again.' });
      return;
    }
    custodyInFlightRef.current = true;
    setCustodyBusy(true);
    try {
      const placed = await onPlaceHeldUnit({ lasyncro_unit_id: unit.lasyncro_unit_id, location_code: problemBin.location_code });
      setCustodyNotice({
        tone: 'ok',
        text: placed.replayed
          ? `${unit.lasyncro_unit_id} was already recorded in ${problemBin.location_code}.`
          : `${unit.lasyncro_unit_id} placed in ${problemBin.location_code}.`,
      });
    } catch (err: any) {
      if (err?.response?.data?.code === 'RECEIVE_PROBLEM_BIN_INVALID') setProblemBin(null);
      setCustodyNotice({ tone: 'error', text: custodyRefusal(err, 'That unit couldn’t be placed. Try again.') });
    } finally {
      custodyInFlightRef.current = false;
      setCustodyBusy(false);
    }
    // Placement state is the server's: re-read it whatever happened.
    try {
      await onRefresh?.();
    } catch {
      // A failed refresh keeps the last server state; the next scan or close re-checks.
    }
    window.setTimeout(() => heldInputRef.current?.focus(), 30);
  }, [heldUnits, onPlaceHeldUnit, onRefresh, problemBin]);

  const renderHeldCustody = () => {
    if (heldUnits.length === 0) return null;
    const scanFieldSx = {
      display: 'flex', alignItems: 'center', gap: 1, px: 1.5, height: 48,
      border: '1px solid var(--rule-2)', borderRadius: '10px', bgcolor: 'var(--surface)',
    } as const;
    return (
      <Box
        data-testid="receive-held-custody"
        // S4-4D F4.1 — minmax(0, 1fr) keeps nowrap content from widening the implicit grid track past the card.
        sx={{ border: '1px solid var(--rule-2)', borderRadius: '12px', bgcolor: 'var(--surface)', px: 2, py: 1.75, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 1.25, minWidth: 0 }}
      >
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>Held for repair</Typography>
          <Typography sx={{ ...monoSx, fontSize: 12, color: unplacedHeld > 0 ? 'var(--accent-text)' : 'var(--good-ink)' }}>
            {`${heldUnits.length - unplacedHeld} of ${heldUnits.length} placed`}
          </Typography>
        </Box>

        {problemBin ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, minWidth: 0 }}>
            {/* S4-4D F4/F4.1 — label above, code on its own line; a code too long for the row breaks at its hyphens, never truncated. */}
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>Problem bin</Typography>
              <Typography
                data-testid="receive-problem-bin"
                sx={{ ...monoSx, fontSize: 14, color: 'var(--ink)', minWidth: 0, overflowWrap: 'break-word' }}
              >
                {problemBin.location_code}
              </Typography>
            </Box>
            {/* Responsive values: receiveCtaSx sets {xs, md} height/fontSize, which a scalar override would not replace at md. */}
            <ReceiveCta
              tier="secondary"
              disabled={custodyBusy}
              onClick={() => { setProblemBin(null); setCustodyNotice(null); }}
              sx={{ width: 'auto', flexShrink: 0, height: { xs: 36, md: 36 }, minWidth: 0, px: 1.5, fontSize: { xs: 13, md: 13 }, whiteSpace: 'nowrap' }}
            >
              Change bin
            </ReceiveCta>
          </Box>
        ) : (
          <Box sx={scanFieldSx}>
            <ScanBarcode size={18} color="var(--accent)" aria-hidden="true" />
            <TextField
              variant="standard"
              fullWidth
              value={binInputValue}
              disabled={custodyBusy}
              placeholder="Scan or type problem bin"
              inputProps={{ 'aria-label': 'Problem bin', style: { ...monoSx, fontSize: 16 } }}
              onChange={(event) => setBinInputValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                const value = binInputValue;
                setBinInputValue('');
                void handleResolveProblemBin(value);
              }}
              autoComplete="off"
              InputProps={{ disableUnderline: true }}
            />
          </Box>
        )}

        {problemBin && unplacedHeld > 0 && (
          <Box sx={scanFieldSx}>
            <ScanBarcode size={18} color="var(--accent)" aria-hidden="true" />
            <TextField
              inputRef={heldInputRef}
              variant="standard"
              fullWidth
              value={heldInputValue}
              disabled={custodyBusy}
              placeholder="Scan or type held unit label"
              inputProps={{ 'aria-label': 'Held unit label', style: { ...monoSx, fontSize: 16 } }}
              onChange={(event) => setHeldInputValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                const value = heldInputValue;
                setHeldInputValue('');
                void handlePlaceHeldUnit(value);
              }}
              autoComplete="off"
              InputProps={{ disableUnderline: true }}
            />
          </Box>
        )}

        <Box component="ul" aria-label="Held units" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.5 }}>
          {heldUnits.map((unit) => (
            <Box
              component="li"
              key={unit.lasyncro_unit_id}
              data-testid={`receive-held-unit-${unit.lasyncro_unit_id}`}
              data-placed={unit.placed ? 'true' : 'false'}
              sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 1, minWidth: 0, ...monoSx, fontSize: 13 }}
            >
              <Box component="span" sx={{ color: 'var(--ink)', minWidth: 0, overflowWrap: 'anywhere' }}>{unit.lasyncro_unit_id}</Box>
              <Box component="span" sx={{ color: unit.placed ? 'var(--good-ink)' : 'var(--ink-3)', minWidth: 0, overflowWrap: 'anywhere' }}>
                {unit.placed ? unit.location_code : unit.label_acknowledged ? 'not placed' : 'label not confirmed'}
              </Box>
            </Box>
          ))}
        </Box>

        {custodyNotice && (
          <ReceiveStatusLine tone={custodyNotice.tone} role={custodyNotice.tone === 'error' ? 'alert' : 'status'}>
            {custodyNotice.text}
          </ReceiveStatusLine>
        )}
      </Box>
    );
  };

  const renderReview = () => {
    const summary = summarizeReceiveOutcome(lines, acceptedByLine);
    const { accepted: totalAccepted, problems: totalProblems, extra: totalExtra } = summary;
    const headSx = { fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', borderBottom: '1px solid var(--rule)', py: 0.75 } as const;
    // Close is gated on every line, never just the visible page.
    const heldLines = lines.filter(isLineAwaitingLabel).length;

    return (
      // Lists carry up to six rows; a tighter local rhythm keeps them on one screen.
      <Box data-testid="receive-review-content" sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 0, md: 1.75 }, flex: { xs: 1, md: 'none' } }}>
        <ReceiveTaskHeading
          eyebrow={workNote.action}
          title="Check, then"
          accent="close."
          titleSx={{ fontSize: { xs: 34, md: 44 } }}
          sub={receiveOutcomeSub(summary)}
        />

        <Box sx={{ border: '1px solid var(--rule-2)', borderRadius: '12px', bgcolor: 'var(--surface)', overflow: 'hidden' }}>
          <Table size="small" aria-label="Review lines">
            <TableHead>
              <TableRow>
                <TableCell sx={headSx}>Line</TableCell>
                <TableCell align="right" sx={headSx}>Expected</TableCell>
                <TableCell align="right" sx={headSx}>Received</TableCell>
                <TableCell align="right" sx={{ ...headSx, ...wideOnlySx }}>Extra</TableCell>
                <TableCell align="right" sx={{ ...headSx, ...wideOnlySx }}>Problems</TableCell>
                <TableCell sx={{ ...headSx, ...wideOnlySx }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pageLines.map((line) => {
                const outcome = receiveLineOutcome(line, acceptedByLine[line.receive_job_line_id]);
                const acceptedQty = outcome.accepted;
                const problemCount = outcome.problems.length;
                const extraQty = outcome.extra;
                const awaiting = isLineAwaitingLabel(line);
                return (
                  <TableRow key={line.receive_job_line_id} sx={lineRowSx}>
                    <TableCell sx={shrinkCellSx}>
                      {expandableLineIdentity(line, line.sku ?? line.receive_job_line_id, true)}
                      {/* Mobile keeps the facts of the collapsed columns. */}
                      <Typography component="div" sx={{ ...rowMetaSx, ...narrowOnlySx, whiteSpace: 'normal', fontFamily: 'inherit', letterSpacing: 0, color: awaiting ? 'var(--accent-text)' : 'var(--ink-2)' }}>
                        {`Extra ${extraQty} · Problems ${problemCount}${outcome.later > 0 ? ` · Later ${outcome.later}` : ''} · ${awaiting ? 'Label hold' : 'Ready'}`}
                      </Typography>
                      <ReportedProblemSummary line={line} problems={outcome.problems} compact />
                      {outcome.later > 0 && (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`${outcome.later} later`}
                          sx={{ mt: 0.5, ml: 0.5, height: 24, borderColor: 'divider', bgcolor: 'background.paper', '& .MuiChip-label': { px: 0.9, fontSize: 11, fontWeight: 650 } }}
                        />
                      )}
                    </TableCell>
                    <TableCell align="right" sx={monoSx}>{line.quantity_expected}</TableCell>
                    <TableCell align="right" sx={monoSx}>{acceptedQty}</TableCell>
                    <TableCell align="right" sx={{ ...monoSx, ...wideOnlySx, color: extraQty > 0 ? 'var(--warning-text)' : 'var(--ink)' }}>{extraQty}</TableCell>
                    <TableCell align="right" sx={{ ...monoSx, ...wideOnlySx }}>{problemCount}</TableCell>
                    <TableCell sx={wideOnlySx}>
                      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, ...monoSx, fontSize: 12 }}>
                        <Box aria-hidden="true" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: awaiting ? 'var(--accent)' : 'var(--good-ink)' }} />
                        {awaiting ? 'label hold' : 'ready'}
                      </Box>
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow sx={lineRowSx}>
                <TableCell sx={{ fontWeight: 600 }}>Total</TableCell>
                <TableCell align="right" sx={{ ...monoSx, fontWeight: 600 }}>{totalExpected}</TableCell>
                <TableCell align="right" sx={{ ...monoSx, fontWeight: 600 }}>{totalAccepted}</TableCell>
                <TableCell align="right" sx={{ ...monoSx, ...wideOnlySx, fontWeight: 600, color: totalExtra > 0 ? 'var(--warning-text)' : 'var(--ink)' }}>{totalExtra}</TableCell>
                <TableCell align="right" sx={{ ...monoSx, ...wideOnlySx, fontWeight: 600 }}>{totalProblems}</TableCell>
                <TableCell sx={wideOnlySx} />
              </TableRow>
            </TableBody>
          </Table>
        </Box>
        <ReceiveListPager page={pageIndex} total={lines.length} onPage={setListPage} label="Review lines pages" />

        {renderHeldCustody()}

        <TextField
          label="Actual delivery date"
          type="date"
          required
          value={deliveryDate}
          onChange={(event) => setDeliveryDate(event.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ '& .MuiOutlinedInput-root': { height: 52, borderRadius: '10px', bgcolor: 'var(--surface)' }, '& input': monoSx }}
        />

        <ReceiveActions>
          {/* One status slot: unknown outcome, closing, close refusal, label holds, date, Next. */}
          {closeOutcomeUnknown ? (
            <ReceiveStatusLine tone="warn" role="status">
              Checking whether this Receive closed… reading the latest saved state.
            </ReceiveStatusLine>
          ) : closing ? (
            <ReceiveStatusLine tone="warn" role="status">Closing… waiting for the server to confirm.</ReceiveStatusLine>
          ) : closeRecovery === 'unknown' ? (
            <ReceiveStatusLine tone="warn" role="alert">{CLOSE_UNKNOWN_MESSAGE}</ReceiveStatusLine>
          ) : submitError ? (
            <ReceiveStatusLine tone={closeRecovery === 'open' ? 'warn' : 'error'} role="alert">{submitError}</ReceiveStatusLine>
          ) : heldLines > 0 ? (
            <ReceiveStatusLine tone="warn">
              {`${heldLines} ${heldLines === 1 ? 'product still needs' : 'products still need'} labels attached before closing.`}
            </ReceiveStatusLine>
          ) : unplacedHeld > 0 ? (
            <ReceiveStatusLine tone="warn">
              {`${unplacedHeld} held ${unplacedHeld === 1 ? 'unit needs' : 'units need'} a problem bin before closing.`}
            </ReceiveStatusLine>
          ) : !deliveryDate.trim() ? (
            <ReceiveStatusLine>Next · enter the actual delivery date</ReceiveStatusLine>
          ) : (
            statusNext('neutral')
          )}
          {closeRecovery === 'unknown' && (
            <ReceiveCta onClick={() => void handleCheckCloseStatus()}>Check status</ReceiveCta>
          )}
          <ReceiveCta
            tier={closeRecovery === 'unknown' ? 'secondary' : 'primary'}
            disabled={closing || closeRecovery === 'checking' || closeRecovery === 'unknown' || !deliveryDate.trim() || heldLines > 0 || unplacedHeld > 0}
            onClick={() => void handleCloseJob()}
          >
            {closing ? 'Closing receive...' : 'Close receive'}
          </ReceiveCta>
        </ReceiveActions>
      </Box>
    );
  };

  // GH-1241 S3C-M4 — a Receive that accepted nothing creates no Stow work. Any
  // accepted unit, canonical or recorded by this session, keeps the Stow handoff.
  const receivedNothing = lines.every((line) => (
    Number(line.quantity_accepted ?? 0) <= 0
      && Number(acceptedByLine[line.receive_job_line_id] ?? 0) <= 0
  ));
  const renderHandoff = () => {
    const { accepted: totalAccepted, problems: totalProblems, later: totalLater, extra: totalExtra } = summarizeReceiveOutcome(lines, acceptedByLine);
    return (
      <>
        <ReceiveTaskHeading
          eyebrow={<>Received · <Box component="span" sx={monoSx}>{poDisplay}</Box></>}
          eyebrowTone="ok"
          title="Receive complete"
          sub={receivedNothing
            ? 'No usable items received. Nothing to put away.'
            : 'Received units are now available for Stow.'}
        />
        <ReceiveSeal
          facts={[
            { label: 'Status', value: 'CLOSED' },
            { label: 'Closed at', value: formatOpsTimestamp(closedAt) },
            { label: 'Actual delivery', value: formatOpsDate(actualDeliveryDate) },
          ]}
        />
        <ReceivePillRow>
          <ReceivePill tone="ok"><span>Accepted</span><b>{totalAccepted}</b></ReceivePill>
          <ReceivePill><span>Problems</span><b>{totalProblems}</b></ReceivePill>
          {totalLater > 0 && <ReceivePill><span>Later</span><b>{totalLater}</b></ReceivePill>}
          {totalExtra > 0 && <ReceivePill><span>Extra</span><b>+{totalExtra}</b></ReceivePill>}
        </ReceivePillRow>
        <ReceiveActions>
          {closeDetailsPending ? (
            <ReceiveStatusLine tone="warn" role="status">
              {closeOutcomeUnknown ? 'Loading the final details…' : 'This Receive closed. Its final details couldn’t load yet.'}
            </ReceiveStatusLine>
          ) : statusNext()}
          {closeDetailsPending && (
            <ReceiveTextAction disabled={closeOutcomeUnknown} onClick={() => void handleCheckCloseStatus()}>Check status</ReceiveTextAction>
          )}
          <ReceiveCta
            tier="secondary"
            // RECEIVE-COMPLETE-EXIT-01 — onComplete is a zero-argument domain
            // callback (exitSession upstream), not a MouseEvent handler. React
            // calls onClick with the SyntheticEvent regardless of the handler's
            // declared arity, so `onClick={onComplete}` forwarded that event as
            // exitSession's optional `finishedLabel: string` argument — a truthy
            // object that then reached onCountFinished/setFinishedCountLabel and
            // crashed WmsOperationsPage trying to render it as a child ("Objects
            // are not valid as a React child"). Call it explicitly instead.
            onClick={() => onComplete()}
          >
            Back to WMS
          </ReceiveCta>
        </ReceiveActions>
      </>
    );
  };

  // WS-UX-RECEIVE-D4R S3-C (UX-4) — the over-delivery decision sits inline in
  // the task column instead of a modal dialog. Same handlers and gating:
  // a live (unconfirmed) count can only be kept, refused or reported; Accept
  // exists only for a count Finish Count has confirmed. No CTA autofocus.
  const renderOverDelivery = () => {
    if (!overDeliveryDecision) return null;
    const { line, counted, countConfirmed } = overDeliveryDecision;
    const extra = Math.max(0, counted - line.quantity_expected);
    const extraUnits = `${extra} extra ${extra === 1 ? 'unit' : 'units'}`;
    return (
      <Box
        role="region"
        aria-label="Extra unit detected"
        sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 1.5, md: 2.25 }, flex: { xs: 1, md: 'none' } }}
      >
        <ReceiveTaskHeading
          eyebrow="Over count"
          title={countConfirmed ? `${extra} more than` : 'More than'}
          accent="ordered."
          sub={countConfirmed
            ? `Your count of ${counted} is confirmed. Decide what to do with the ${extraUnits}.`
            : 'Keep counting, then Finish Count to confirm your physical count before approving the extra.'}
        />
        <ReceiveItemLine
          media={<LineMedia line={line} size={40} />}
          name={lineName(line)}
          identity={line.barcode?.trim() || line.sku || line.receive_job_line_id}
        />
        <ReceiveFactStrip
          facts={[
            { label: 'Expected', value: line.quantity_expected },
            { label: 'Counted', value: counted },
            { label: 'Extra', value: `+${extra}`, highlight: true },
          ]}
        />
        <ReceiveActions>
          {overDeliverySubmitting ? (
            <ReceiveStatusLine tone="warn" role="status">Saving…</ReceiveStatusLine>
          ) : overDeliveryError ? (
            <ReceiveStatusLine tone="error" role="alert">{overDeliveryError}</ReceiveStatusLine>
          ) : (
            <ReceiveStatusLine tone="warn">
              {countConfirmed ? `Next · accept or refuse ${extraUnits}` : 'Next · keep counting, then Finish Count'}
            </ReceiveStatusLine>
          )}
          {countConfirmed ? (
            <ReceiveCta disabled={overDeliverySubmitting} onClick={() => void handleAcceptOverDelivery()}>
              {overDeliverySubmitting ? 'Approving...' : `Accept extra unit${extra === 1 ? '' : 's'}`}
            </ReceiveCta>
          ) : (
            <ReceiveCta disabled={overDeliverySubmitting} onClick={() => void handleKeepOverCount()}>
              Keep extra in count
            </ReceiveCta>
          )}
          <ReceiveCta tier="secondary" disabled={overDeliverySubmitting} onClick={() => void handleRejectOverDelivery()}>
            Do not receive extra
          </ReceiveCta>
          <ReceiveTextAction disabled={overDeliverySubmitting} onClick={() => void handleReportOverDelivery()}>
            Report problem
          </ReceiveTextAction>
        </ReceiveActions>
      </Box>
    );
  };

  const renderBody = () => {
    if (overDeliveryDecision && sessionPhase !== 'handoff') return renderOverDelivery();
    if (sessionPhase === 'brief') return renderBrief();
    if (sessionPhase === 'reconcile') return renderReconciliation();
    if (sessionPhase === 'review') return renderReview();
    if (sessionPhase === 'handoff') return renderHandoff();
    return renderInspect();
  };

  const sessionBars: ReceiveBarTone[] = sessionPhase === 'brief'
    ? lines.map(() => 'idle')
    : lines.map((line, index) => {
        if (isLineDone(line)) return 'done';
        if (index !== currentIndex || sessionPhase === 'review' || sessionPhase === 'handoff') return 'idle';
        return sessionPhase === 'reconcile' || isLineAwaitingLabel(line) ? 'flag' : 'current';
      });
  const progressLabel = sessionPhase === 'brief'
    ? `Brief · ${lines.length} ${lines.length === 1 ? 'product' : 'products'}`
    : sessionPhase === 'handoff'
      ? 'Receive closed'
      : `${completedCount} of ${lines.length} lines counted`;
  const showLinesFooter = sessionPhase === 'inspect' || sessionPhase === 'reconcile' || sessionPhase === 'review';
  // V3.1: Exit in the header, hidden while closing and on Completion (which
  // has its own Back to WMS). From the Brief nothing can be unsaved.
  const showExit = sessionPhase !== 'handoff' && !closing && !closeOutcomeUnknown;

  const recountSheetNode = (() => {
    if (!recountSheet || !reconciliationLine) return null;
    const recorded = reconciliationLine.allocations.length;
    const keep = () => setRecountSheet(null);
    if (recountSheet.status === 'unknown') {
      return (
        <ReceiveExitSheet
          open
          eyebrow="Not confirmed"
          eyebrowTone="error"
          title="Recount not"
          accent="confirmed."
          body={<span role="alert">We couldn't confirm whether the Recount was applied. Try again to check — it is never applied twice.</span>}
        >
          <ReceiveCta onClick={() => void handleConfirmRecount()}>Try again</ReceiveCta>
        </ReceiveExitSheet>
      );
    }
    if (recountSheet.status === 'refused') {
      return (
        <ReceiveExitSheet
          open
          eyebrow="Recount"
          eyebrowTone="error"
          title="Recount not"
          accent="possible."
          body={<span role="alert">{recountSheet.message}</span>}
          onDismiss={keep}
        >
          <ReceiveCta tier="strong" onClick={keep}>Back to reconciliation</ReceiveCta>
        </ReceiveExitSheet>
      );
    }
    const busy = recountSheet.status === 'busy';
    return (
      <ReceiveExitSheet
        open
        eyebrow="Recount"
        title="Recount this"
        accent="product?"
        busy={busy}
        body={`Your ${recorded} recorded problem${recorded === 1 ? '' : 's'} for it will be cleared. Other products are not affected.`}
        onDismiss={busy ? undefined : keep}
      >
        <ReceiveCta disabled={busy} onClick={() => void handleConfirmRecount()}>{busy ? 'Recounting…' : 'Recount'}</ReceiveCta>
        <ReceiveCta tier="secondary" disabled={busy} onClick={keep}>Keep</ReceiveCta>
      </ReceiveExitSheet>
    );
  })();

  const exitSheetNode = (() => {
    if (!exitSheet) return null;
    if (exitSheet.variant === 'saving' || exitSheet.variant === 'checking') {
      return (
        <ReceiveExitSheet
          open
          eyebrow="Leave receiving"
          title="Saving your"
          accent="count…"
          busy
          body={<span role="status">Wait until saving finishes. Leaving now could lose the count you just entered.</span>}
          onDismiss={keepReceiving}
        >
          <ReceiveCta tier="strong" onClick={keepReceiving}>Keep receiving</ReceiveCta>
          <ReceiveCta tier="secondary" disabled>Back to WMS</ReceiveCta>
        </ReceiveExitSheet>
      );
    }
    if (exitSheet.variant === 'failed') {
      const { failures } = exitSheet;
      const several = failures.length > 1;
      return (
        <ReceiveExitSheet
          open
          eyebrow="Not saved"
          eyebrowTone="error"
          title={several ? 'Counts not' : 'Count not'}
          accent="saved."
          body={(
            <span role="alert">
              {several
                ? `${failures.length} counts weren't saved: ${failures.map((f) => `${f.name} (${f.quantity}) — ${f.error}`).join('; ')}. Save them again, or leave without them.`
                : `The count of ${failures[0]?.quantity ?? 0} for ${failures[0]?.name ?? 'a product'} wasn't saved (${failures[0]?.error ?? 'no confirmation'}). Save it again, or leave without it.`}
            </span>
          )}
          onDismiss={keepReceiving}
        >
          <ReceiveCta onClick={handleExitSaveAgain}>Save again</ReceiveCta>
          <ReceiveCta tier="secondary" onClick={leaveSession}>Leave without saving</ReceiveCta>
        </ReceiveExitSheet>
      );
    }
    if (exitSheet.variant === 'review') {
      return (
        <ReceiveExitSheet
          open
          eyebrow="Not saved"
          eyebrowTone="error"
          title="Choices"
          accent="not saved."
          body={(
            <span role="alert">
              {`Not saved yet: ${exitSheet.reasons.join('; ')}. Leaving now discards ${exitSheet.reasons.length === 1 ? 'it' : 'them'}. Saved counts stay saved.`}
            </span>
          )}
          onDismiss={keepReceiving}
        >
          <ReceiveCta tier="strong" onClick={keepReceiving}>Back to receiving</ReceiveCta>
          <ReceiveCta tier="secondary" onClick={leaveSession}>Leave without saving</ReceiveCta>
        </ReceiveExitSheet>
      );
    }
    return (
      <ReceiveExitSheet
        open
        eyebrow="Leave receiving"
        title="Leave this"
        accent="Receive?"
        body="Your counts are saved. This Receive stays assigned to you."
        onDismiss={keepReceiving}
      >
        <ReceiveCta tier="strong" onClick={keepReceiving}>Keep receiving</ReceiveCta>
        <ReceiveCta tier="secondary" onClick={leaveSession}>Back to WMS</ReceiveCta>
      </ReceiveExitSheet>
    );
  })();

  return (
    <>
      <ReceiveSessionShell
        reference={poDisplay}
        supplier={supplierName}
        jobId={receiveJobId}
        bars={sessionBars}
        progressLabel={progressLabel}
        headerAction={showExit ? (
          <ReceiveFooterButton
            onClick={() => (sessionPhase === 'brief' ? onComplete() : handleExitRequest())}
            disabled={!!exitSheet}
            aria-haspopup={sessionPhase === 'brief' ? undefined : 'dialog'}
            sx={{ height: 36 }}
          >
            Exit
          </ReceiveFooterButton>
        ) : undefined}
        footerRight={showLinesFooter ? (
          <ReceiveFooterButton onClick={() => setLinesDrawerOpen(true)} aria-haspopup="dialog">
            PO lines · {lines.length}
          </ReceiveFooterButton>
        ) : undefined}
      >
        {renderBody()}
      </ReceiveSessionShell>
      {exitSheetNode}
      {recountSheetNode}

      <ReceiveLinesDrawer
        keepMounted={sessionPhase !== 'review'}
        open={linesDrawerOpen && showLinesFooter}
        title={`PO lines · ${lines.length}`}
        onClose={() => setLinesDrawerOpen(false)}
      >
        {renderLineRail()}
      </ReceiveLinesDrawer>

      <Dialog open={!!identityDetailLine} fullWidth maxWidth="xs" onClose={() => setIdentityDetailLine(null)} sx={{ zIndex: 1400 }}>
        <DialogTitle>Product identity</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 16, fontWeight: 500, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
            {identityDetailLine ? lineName(identityDetailLine) : ''}
          </Typography>
          <Typography sx={{ ...monoSx, mt: 1, fontSize: 13, color: 'var(--ink-3)', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
            {identityDetailLine?.sku ?? identityDetailLine?.receive_job_line_id ?? ''}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setIdentityDetailLine(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!shortfallModal}
        fullWidth
        maxWidth="sm"
        onClose={() => {
          if (shortfallModal && shortfallModal.remainingShortfall === shortfallModal.totalShortfall) {
            setShortfallModal(null);
          }
        }}
      >
        <DialogTitle>
          {shortfallModal?.remainingShortfall} missing unit{(shortfallModal?.remainingShortfall ?? 0) === 1 ? '' : 's'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 1.5, pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Expected <Box component="span" sx={monoSx}>{shortfallModal?.line.quantity_expected}</Box>, counted <Box component="span" sx={monoSx}>{shortfallModal?.accepted}</Box>. Account for every missing unit before the line can close.
            </Typography>
            {submitError && <Alert severity="error">{submitError}</Alert>}
            {(Object.keys(PROBLEM_LABELS) as ProblemType[]).map((type) => (
              <Button
                key={type}
                variant={shortfallProblemType === type ? 'contained' : 'outlined'}
                color={type === 'defect' || type === 'wrong_item' ? 'error' : 'warning'}
                onClick={() => setShortfallProblemType(type)}
                sx={{ justifyContent: 'flex-start', borderRadius: '6px' }}
              >
                {PROBLEM_LABELS[type]}
              </Button>
            ))}
            {shortfallProblemType && (
              <TextField
                label={`Qty affected (max ${shortfallModal?.remainingShortfall})`}
                type="number"
                size="small"
                value={shortfallProblemQty}
                onChange={(event) => {
                  setShortfallProblemQty(event.target.value);
                  setShortfallQtyError(null);
                }}
                error={!!shortfallQtyError}
                helperText={shortfallQtyError ?? undefined}
                inputProps={{ min: 1, max: shortfallModal?.remainingShortfall, style: monoSx }}
              />
            )}
            {(shortfallProblemType === 'barcode_mismatch' || shortfallProblemType === 'other') && (
              <TextField
                label={shortfallProblemType === 'barcode_mismatch' ? 'Barcode value' : 'Notes'}
                value={shortfallProblemNotes}
                onChange={(event) => setShortfallProblemNotes(event.target.value)}
                required
                multiline={shortfallProblemType === 'other'}
                rows={shortfallProblemType === 'other' ? 2 : 1}
              />
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
          {shortfallModal && shortfallModal.remainingShortfall === shortfallModal.totalShortfall && (
            <Button color="inherit" disabled={shortfallSubmitting} onClick={() => void handleMiscount()}>
              Recount
            </Button>
          )}
          <Button
            variant="contained"
            disabled={!shortfallProblemType || shortfallSubmitting}
            onClick={() => void handleShortfallConfirm()}
            sx={{ bgcolor: 'var(--accent)', color: 'var(--accent-ink)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, borderRadius: '6px', fontWeight: 700 }}
          >
            {shortfallSubmitting ? 'Saving...' : 'Save problem'}
          </Button>
        </DialogActions>
      </Dialog>


      <Dialog
        open={problemDialog}
        onClose={() => !problemSubmitting && setProblemDialog(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Report a problem</DialogTitle>

        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, pt: 0.5 }}>
            {problemError && <Alert severity="error">{problemError}</Alert>}

            {currentLine && (
              <Paper
                variant="outlined"
                sx={{
                  p: 1.5,
                  borderRadius: '6px',
                  bgcolor: 'background.default',
                }}
              >
                <Typography variant="body2" fontWeight={700}>
                  {lineName(currentLine)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {variantName(currentLine)}
                </Typography>
                {currentLine.sku && (
                  <Typography variant="caption" color="text.secondary" sx={monoSx}>
                    SKU {currentLine.sku}
                  </Typography>
                )}
              </Paper>
            )}

            <Box>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                What happened?
              </Typography>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                  gap: 1,
                }}
              >
                {PROBLEM_CHOICES.map((choice) => {
                  const selected = problemChoice === choice.id;

                  return (
                    <Button
                      key={choice.id}
                      variant="outlined"
                      onClick={() => {
                        if (problemChoice !== choice.id) {
                          setProblemNotes(choice.defaultNotes ?? '');
                        }
                        setProblemChoice(choice.id);
                        setProblemType(choice.problemType);
                        setProblemError(null);
                      }}
                      sx={{
                        minHeight: 40,
                        justifyContent: 'flex-start',
                        borderRadius: '6px',
                        fontWeight: 650,
                        color: 'text.primary',
                        bgcolor: selected ? 'action.selected' : 'transparent',
                        borderColor: selected ? 'text.secondary' : 'divider',
                        boxShadow: selected ? 'inset 0 0 0 1px currentColor' : 'none',
                        '&:hover': {
                          bgcolor: selected ? 'action.selected' : 'action.hover',
                          borderColor: 'text.secondary',
                        },
                      }}
                    >
                      {choice.label}
                    </Button>
                  );
                })}
              </Box>
            </Box>

            {problemChoice && (
              <TextField
                label="Qty affected"
                type="number"
                size="small"
                value={problemQty}
                onChange={(event) => setProblemQty(event.target.value)}
                inputProps={{ min: 1, style: monoSx }}
              />
            )}

            {problemChoice === 'barcode_mismatch' && (
              <TextField
                label="Barcode value"
                size="small"
                value={problemNotes}
                onChange={(event) => setProblemNotes(event.target.value)}
                required
              />
            )}

            {problemChoice === 'other' && (
              <TextField
                label="Notes"
                size="small"
                value={problemNotes}
                onChange={(event) => setProblemNotes(event.target.value)}
                required
                multiline
                rows={2}
              />
            )}
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button
            color="inherit"
            disabled={problemSubmitting}
            onClick={() => setProblemDialog(false)}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            disabled={!problemChoice || !problemType || problemSubmitting}
            onClick={() => void handleReportProblem()}
            sx={{
              bgcolor: 'var(--accent)',
              color: 'var(--accent-ink)',
              '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
              borderRadius: '6px',
              fontWeight: 700,
            }}
          >
            {problemSubmitting ? 'Saving...' : 'Report problem'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GH-1241 S3C-M1 — session-mode gate
// ─────────────────────────────────────────────────────────────────────────────

const refuseFinalizedAccounting = () =>
  Promise.reject(new Error('This Receive was finalized as a group; its accounting cannot change here.'));

function ReceiveSessionNotice({
  props,
  severity,
  title,
  accent,
  message,
  ctaLabel = 'Back to WMS',
  children,
}: {
  props: ReceiveSessionPageProps;
  severity: 'info' | 'error' | null;
  title: string;
  accent?: ReactNode;
  message: string;
  ctaLabel?: string;
  children?: ReactNode;
}) {
  return (
    <ReceiveSessionShell
      reference={props.poNumber != null ? `PO-${props.poNumber}` : 'PO reference unavailable'}
      supplier={props.supplierName}
      jobId={props.receiveJobId}
      bars={[]}
    >
      <ReceiveTaskHeading
        eyebrow={severity === 'error' ? 'Unavailable' : 'Receive'}
        eyebrowTone={severity === 'error' ? 'error' : 'accent'}
        title={title}
        accent={accent}
        sub={props.supplierName}
      />
      {severity ? <Alert severity={severity}>{message}</Alert> : <ReceiveStatusLine>{message}</ReceiveStatusLine>}
      {children}
      <ReceiveActions>
        <ReceiveCta tier="secondary" onClick={props.onComplete}>
          {ctaLabel}
        </ReceiveCta>
      </ReceiveActions>
    </ReceiveSessionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GH-1241 S3C-M2 — grouped Receive counting
// ─────────────────────────────────────────────────────────────────────────────

/** One applicable line's physical count: the operator's draft and its explicit confirmation. */
type GroupedCountEntry = { count: number | null; confirmed: number | null };
type GroupedCountMessage = {
  severity: 'error' | 'warning' | 'info';
  text: string;
  /** Line whose unsaved count the operator may save again. */
  retryLineId?: string;
  /** Offer an explicit exit that leaves an unsaved count behind. */
  leaveAnyway?: boolean;
} | null;

/**
 * Canonical evidence only: the confirmed count, else the raw provisional
 * draft. The GET projection's optimistic sellable is never a count (S3-A1).
 */
function canonicalCountEntry(line: ReceiveJobLine): GroupedCountEntry {
  const confirmed = line.quantity_count_confirmed == null ? null : Number(line.quantity_count_confirmed);
  const provisional = line.quantity_sellable_provisional == null ? null : Number(line.quantity_sellable_provisional);
  return { count: confirmed ?? provisional, confirmed };
}

function countEntryState(entry: GroupedCountEntry | undefined): 'not_counted' | 'unconfirmed' | 'confirmed' {
  if (entry?.confirmed != null) return 'confirmed';
  return entry?.count != null ? 'unconfirmed' : 'not_counted';
}

/**
 * GH-1241 S3C-M2 — scanner-first grouped counting. Start claims a pending
 * job and writes no count. A valid unit scan selects its product and adds
 * one unit; a typed count is the same provisional draft. Drafts persist
 * through one serialized progress writer; only "Confirm count" / "None
 * arrived" confirm, after the draft is saved. Writes nothing on mount,
 * refresh or exit, and never inspects, reports, approves, labels, closes or
 * drafts/finalizes the reconciliation.
 */
/** GH-1241 S3C-M3 — the operator's shortfall reasons for one line, bound to the good count they were made for. */
/**
 * repairDamage / repairPackaging — S4-4C units held for repair (recoverable
 * defect / packaging_damage). `damaged` stays non-recoverable.
 */
type ReviewDecision = { missing: number; later: number; damaged: number; repairDamage: number; repairPackaging: number; basisCount: number };
type ReviewDecisionField = 'missing' | 'later' | 'damaged' | 'repairDamage' | 'repairPackaging';
const REVIEW_DECISION_FIELDS: Array<{ field: ReviewDecisionField; label: string }> = [
  { field: 'missing', label: 'Missing' },
  { field: 'later', label: 'Coming later' },
  { field: 'damaged', label: 'Damaged' },
  { field: 'repairDamage', label: 'Repairable damage' },
  { field: 'repairPackaging', label: 'Repairable packaging' },
];

/** S4-4C — held quantity of one type in a saved grouped payload line. */
function savedHeld(line: ReceiveReconciliationLinePayload, exceptionType: string): number {
  return (line.new_exceptions ?? [])
    .filter((exception) => exception.disposition === 'recoverable_held' && exception.exception_type === exceptionType)
    .reduce((sum, exception) => sum + Number(exception.quantity_affected ?? 0), 0);
}

const RECONCILIATION_SHORTFALL_TYPES = new Set(['missing_item', 'defect', 'wrong_item', 'wrong_variant']);
/** A revision or payload the server no longer considers current: the review must be renewed. */
const RECONCILIATION_STALE_CODES = new Set([
  'RECEIVE_RECONCILIATION_REVISION_STALE',
  'RECEIVE_RECONCILIATION_PAYLOAD_MISMATCH',
  'RECEIVE_RECONCILIATION_REVISION_REQUIRED',
]);

/** The server's canonical payload identity (parseGroupedLines): order and omitted defaults never matter. */
function canonicalReconciliationLines(lines: ReceiveReconciliationLinePayload[]) {
  return [...lines]
    .map((line) => ({
      receive_job_line_id: line.receive_job_line_id.toLowerCase(),
      quantity_accepted: Number(line.quantity_accepted),
      quantity_rejected: Number(line.quantity_rejected),
      quantity_missing: Number(line.quantity_missing),
      quantity_deferred: Number(line.quantity_deferred),
      quantity_held_recoverable: Number(line.quantity_held_recoverable ?? 0),
      new_exceptions: (line.new_exceptions ?? [])
        .map((exception) => (exception.disposition === 'recoverable_held'
          // S4-4C — held evidence never carries an accounting role (0224).
          ? {
            exception_type: exception.exception_type,
            quantity_affected: Number(exception.quantity_affected),
            accounting_role: null,
            notes: exception.notes ?? null,
            disposition: 'recoverable_held',
          }
          : {
            exception_type: exception.exception_type,
            quantity_affected: Number(exception.quantity_affected),
            accounting_role: exception.accounting_role
              ?? (RECONCILIATION_SHORTFALL_TYPES.has(exception.exception_type) ? 'shortfall' : null),
            notes: exception.notes ?? null,
          }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      existing_exception_ids: (line.existing_exception_ids ?? []).map((id) => id.toLowerCase()).sort(),
    }))
    .sort((a, b) => a.receive_job_line_id.localeCompare(b.receive_job_line_id));
}

function sameReconciliationPayload(a: ReceiveReconciliationLinePayload[], b: ReceiveReconciliationLinePayload[]) {
  return JSON.stringify(canonicalReconciliationLines(a)) === JSON.stringify(canonicalReconciliationLines(b));
}

function GroupedReceiveCount({ props }: { props: ReceiveSessionPageProps }) {
  const {
    lines,
    onClaimJob,
    onPersistLineProgress,
    onConfirmLineCount,
    onResolveBarcode,
    onRefresh,
    onExecutionFocusChange,
    onComplete,
    onApproveOverDelivery,
    onSaveReconciliationDraft,
    onFinalizeReconciliation,
  } = props;

  const applicable = useMemo(() => lines.filter((line) => Number(line.quantity_expected) > 0), [lines]);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const applicableRef = useRef(applicable);
  applicableRef.current = applicable;

  const assignedToMe = props.assignedOperatorId != null
    && props.currentUserId != null
    && Number(props.assignedOperatorId) === Number(props.currentUserId);
  const [started, setStarted] = useState(false);
  const counting = assignedToMe && (started || props.jobStatus !== 'pending');

  const [entries, setEntries] = useState<Record<string, GroupedCountEntry>>(() =>
    Object.fromEntries(applicable.map((line) => [line.receive_job_line_id, canonicalCountEntry(line)]))
  );
  const entriesRef = useRef(entries);
  const writeEntry = useCallback((lineId: string, entry: GroupedCountEntry) => {
    entriesRef.current = { ...entriesRef.current, [lineId]: entry };
    setEntries(entriesRef.current);
  }, []);

  const firstUnconfirmedId = useCallback(() => (
    applicableRef.current.find((line) => entriesRef.current[line.receive_job_line_id]?.confirmed == null)
      ?.receive_job_line_id ?? null
  ), []);
  const [currentId, setCurrentId] = useState<string | null>(() => (
    applicable.find((line) => entries[line.receive_job_line_id]?.confirmed == null)?.receive_job_line_id
      ?? applicable[0]?.receive_job_line_id
      ?? null
  ));
  const [editingId, setEditingIdState] = useState<string | null>(null);
  const editingRef = useRef<string | null>(null);
  const setEditingId = useCallback((lineId: string | null) => {
    editingRef.current = lineId;
    setEditingIdState(lineId);
  }, []);

  const [message, setMessage] = useState<GroupedCountMessage>(null);
  // Lines whose latest provisional save failed: never shown as saved/confirmed.
  const saveFailedRef = useRef<Record<string, boolean>>({});
  const markSaveFailed = useCallback((lineId: string, failed: boolean) => {
    saveFailedRef.current = { ...saveFailedRef.current, [lineId]: failed };
  }, []);
  // GH-1241 S3C-M2-C — per line, the server state the operator's latest
  // successful write produced. Until a canonical read shows exactly that state,
  // a disagreeing read predates the write and cannot replace the newer count.
  // Cleared by that echo, by an explicit server refusal, or by remount.
  const awaitingEchoRef = useRef<Record<string, GroupedCountEntry>>({});

  const [claiming, setClaiming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [exiting, setExiting] = useState(false);
  // WS-UX-RECEIVE-D4R S7 — the exit sheet shows while Exit waits for saves.
  const [exitSaving, setExitSaving] = useState(false);
  // S7-CORRECT — V3.1 Saved sheet for a clean grouped exit; the exit itself
  // happens only on its Back to WMS, once.
  const [exitSavedOpen, setExitSavedOpen] = useState(false);
  const exitConfirmedRef = useRef(false);
  const [scanValue, setScanValue] = useState('');
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const countInputRef = useRef<HTMLInputElement | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const savesInFlightRef = useRef<Record<string, number>>({});
  const confirmInFlightRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // GH-1241 S3C-M3 — review: unsaved decisions (each bound to its good count),
  // the revision this session saved, approvals made here, one submission.
  const [reviewing, setReviewing] = useState(false);
  // WS-UX-RECEIVE-D4R S5 (UX-14) — which difference the Check differences
  // pager shows. Navigation only: decisions live in `decisions` for every
  // line and finalization always submits the full review model.
  const [reviewPage, setReviewPage] = useState(0);
  const [productsOpen, setProductsOpen] = useState(false);
  const [decisions, setDecisionsState] = useState<Record<string, ReviewDecision>>({});
  const decisionsRef = useRef(decisions);
  const setDecisions = useCallback((next: Record<string, ReviewDecision>) => {
    decisionsRef.current = next;
    setDecisionsState(next);
  }, []);
  type SavedRevision = { revision_id: string; lines: ReceiveReconciliationLinePayload[] };
  const [savedRevision, setSavedRevisionState] = useState<SavedRevision | null>(null);
  const savedRevisionRef = useRef<SavedRevision | null>(null);
  const setSavedRevision = useCallback((next: SavedRevision | null) => {
    savedRevisionRef.current = next;
    setSavedRevisionState(next);
  }, []);
  const [approvedExtra, setApprovedExtra] = useState<Record<string, number>>({});
  const [keepingExtraId, setKeepingExtraId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitInFlightRef = useRef<Promise<void> | null>(null);
  const propRevision = useMemo<SavedRevision | null>(() => {
    const evidence = props.reconciliation;
    if (!evidence?.current_revision_id) return null;
    const revision = (evidence.revisions ?? []).find((r) => r.revision_id === evidence.current_revision_id);
    return revision ? { revision_id: revision.revision_id, lines: revision.lines } : null;
  }, [props.reconciliation]);
  const propRevisionRef = useRef(propRevision);
  propRevisionRef.current = propRevision;
  // This session's own saved revision stays current until the server refuses it.
  const currentRevision = savedRevision ?? propRevision;

  // Canonical re-reads (refresh, handoff) replace a line's count unless the
  // operator still owns it locally: a save in flight, a failed save, an edit,
  // or a successful write the server has not yet echoed back.
  useEffect(() => {
    let changed = false;
    const next = { ...entriesRef.current };
    for (const line of applicable) {
      const lineId = line.receive_job_line_id;
      if ((savesInFlightRef.current[lineId] ?? 0) > 0 || saveFailedRef.current[lineId] || editingRef.current === lineId) continue;
      const canonical = canonicalCountEntry(line);
      const awaiting = awaitingEchoRef.current[lineId];
      if (awaiting) {
        if (awaiting.count !== canonical.count || awaiting.confirmed !== canonical.confirmed) continue;
        delete awaitingEchoRef.current[lineId];
      }
      const local = next[lineId];
      if (!local || local.count !== canonical.count || local.confirmed !== canonical.confirmed) {
        next[lineId] = canonical;
        changed = true;
      }
    }
    if (changed) {
      entriesRef.current = next;
      setEntries(next);
    }
  }, [applicable]);

  // WAREHOUSE-FOCUS-SHELL-01A — counting is execution; the brief is not.
  useEffect(() => {
    onExecutionFocusChange?.(counting);
  }, [counting, onExecutionFocusChange]);
  useEffect(() => {
    if (counting) scanInputRef.current?.focus();
  }, [counting]);

  const lineById = useCallback(
    (lineId: string | null) => applicableRef.current.find((line) => line.receive_job_line_id === lineId) ?? null,
    []
  );

  /** Serialized provisional save. A failure is surfaced and never reported as saved. */
  const saveCount = useCallback((lineId: string, quantity: number) => {
    savesInFlightRef.current[lineId] = (savesInFlightRef.current[lineId] ?? 0) + 1;
    const run = async () => {
      try {
        if (!onPersistLineProgress) throw new Error('Saving counts is unavailable.');
        await onPersistLineProgress(lineId, { quantity_sellable_provisional: quantity });
        markSaveFailed(lineId, false);
        // Server rule (S3-A1 C5): an unchanged count keeps its confirmation.
        const confirmedBefore = entriesRef.current[lineId]?.confirmed ?? null;
        awaitingEchoRef.current[lineId] = { count: quantity, confirmed: confirmedBefore === quantity ? quantity : null };
        if (mountedRef.current) setMessage((current) => (current?.retryLineId === lineId ? null : current));
      } catch {
        markSaveFailed(lineId, true);
        const line = lineById(lineId);
        if (mountedRef.current) {
          // A retry from the exit sheet that fails again keeps its explicit leave option.
          setMessage((current) => ({
            severity: 'error',
            text: `Couldn't save the count for ${line ? lineName(line) : 'this product'}. Check the connection, then save again.`,
            retryLineId: lineId,
            ...(current?.leaveAnyway && current.retryLineId === lineId ? { leaveAnyway: true } : {}),
          }));
        }
      } finally {
        savesInFlightRef.current[lineId] -= 1;
      }
    };
    saveQueueRef.current = saveQueueRef.current.then(run);
    return saveQueueRef.current;
  }, [lineById, markSaveFailed, onPersistLineProgress]);

  /** A changed count voids its confirmation, exactly as the server does. */
  const setCount = useCallback((lineId: string, quantity: number) => {
    const previous = entriesRef.current[lineId] ?? { count: null, confirmed: null };
    writeEntry(lineId, { count: quantity, confirmed: previous.confirmed === quantity ? previous.confirmed : null });
    void saveCount(lineId, quantity);
  }, [saveCount, writeEntry]);

  const selectLine = useCallback((lineId: string) => {
    setCurrentId(lineId);
    if (editingRef.current !== lineId) setEditingId(null);
    setMessage(null);
    const line = lineById(lineId);
    window.setTimeout(() => {
      (line && hasExternalBarcode(line) ? scanInputRef : countInputRef).current?.focus();
    }, 0);
  }, [lineById, setEditingId]);

  // Scans resolve concurrently and each applies to the latest count, so a
  // burst of scans never loses an increment.
  const handleScan = useCallback(async (raw: string) => {
    const value = raw.trim();
    if (!value || !counting) return;
    if (!onResolveBarcode) {
      setMessage({ severity: 'error', text: 'Scanning is unavailable. Go back to WMS and try again.' });
      return;
    }
    let resolved: { lasyncro_variant_id: string } | null;
    try {
      resolved = await onResolveBarcode(value);
    } catch {
      if (mountedRef.current) {
        setMessage({ severity: 'error', text: "Couldn't check this barcode. Check the connection and try again." });
      }
      return;
    }
    if (!mountedRef.current) return;
    if (!resolved?.lasyncro_variant_id) {
      setMessage({ severity: 'warning', text: `Barcode not recognised: ${value}` });
      return;
    }
    const match = linesRef.current.find((line) => line.lasyncro_variant_id === resolved!.lasyncro_variant_id);
    if (!match) {
      setMessage({ severity: 'warning', text: 'This product is not on this delivery.' });
      return;
    }
    if (Number(match.quantity_expected) <= 0) {
      setMessage({ severity: 'warning', text: 'This product is not expected on this delivery.' });
      return;
    }
    const lineId = match.receive_job_line_id;
    setCurrentId(lineId);
    if (editingRef.current !== lineId) setEditingId(null);
    const entry = entriesRef.current[lineId];
    if (entry?.confirmed != null && editingRef.current !== lineId) {
      setMessage({ severity: 'info', text: `${lineName(match)} is already counted. Tap Edit count to change it.` });
      return;
    }
    setMessage(null);
    setCount(lineId, (entry?.count ?? 0) + 1);
  }, [counting, onResolveBarcode, setCount, setEditingId]);

  const handleTypedCount = useCallback((lineId: string, raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (!digits) {
      const previous = entriesRef.current[lineId] ?? { count: null, confirmed: null };
      writeEntry(lineId, { count: null, confirmed: previous.confirmed });
      return;
    }
    const quantity = Number.parseInt(digits, 10);
    if (!Number.isSafeInteger(quantity)) return;
    setMessage(null);
    setCount(lineId, quantity);
  }, [setCount, writeEntry]);

  const refreshCanonical = useCallback(() => {
    void Promise.resolve(onRefresh?.()).catch(() => undefined);
  }, [onRefresh]);

  const unsavedMessage = useCallback((lineId: string): GroupedCountMessage => {
    const line = lineById(lineId);
    return {
      severity: 'error',
      text: `The count for ${line ? lineName(line) : 'this product'} isn't saved yet. Save it again before confirming.`,
      retryLineId: lineId,
    };
  }, [lineById]);

  /** The canonical confirmation, only after the provisional count is durably saved. */
  const confirmCount = useCallback(async (lineId: string, quantity: number) => {
    if (confirmInFlightRef.current) return;
    if (saveFailedRef.current[lineId]) {
      setMessage(unsavedMessage(lineId));
      return;
    }
    setConfirming(true);
    const run = (async () => {
      await saveQueueRef.current;
      if (!mountedRef.current) return;
      if (saveFailedRef.current[lineId]) {
        setMessage(unsavedMessage(lineId));
        return;
      }
      if (!onConfirmLineCount) {
        setMessage({ severity: 'error', text: 'Confirming counts is unavailable. Go back to WMS and try again.' });
        return;
      }
      try {
        await onConfirmLineCount(lineId, { quantity_confirmed: quantity });
      } catch (err: any) {
        if (!mountedRef.current) return;
        setMessage({ severity: 'error', text: "Couldn't confirm the count. Your count is kept — try again." });
        const status = Number(err?.response?.status);
        // A definitive refusal means the Receive changed: re-read it.
        if (status >= 400 && status < 500) {
          // The server disagrees: canonical evidence is authoritative again.
          delete awaitingEchoRef.current[lineId];
          refreshCanonical();
        }
        return;
      }
      if (!mountedRef.current) return;
      writeEntry(lineId, { count: quantity, confirmed: quantity });
      awaitingEchoRef.current[lineId] = { count: quantity, confirmed: quantity };
      setEditingId(null);
      setMessage(null);
      const next = firstUnconfirmedId();
      if (next) setCurrentId(next);
      scanInputRef.current?.focus();
      refreshCanonical();
    })();
    confirmInFlightRef.current = run;
    try {
      await run;
    } finally {
      confirmInFlightRef.current = null;
      if (mountedRef.current) setConfirming(false);
    }
  }, [firstUnconfirmedId, onConfirmLineCount, refreshCanonical, setEditingId, unsavedMessage, writeEntry]);

  const saveAgain = useCallback((lineId: string) => {
    const count = entriesRef.current[lineId]?.count;
    if (count == null) return;
    void saveCount(lineId, count);
  }, [saveCount]);

  const handleStart = useCallback(async () => {
    if (!onClaimJob) {
      setMessage({ severity: 'error', text: 'Starting this Receive is unavailable. Go back to WMS and try again.' });
      return;
    }
    setClaiming(true);
    setMessage(null);
    try {
      await onClaimJob();
    } catch (err: any) {
      const code = err?.response?.data?.error ?? err?.message;
      if (mountedRef.current) {
        setMessage({
          severity: 'error',
          text: code === 'JOB_CLAIMED_BY_OTHER'
            ? 'This Receive is already claimed by another operator.'
            : "Couldn't start this Receive. Please try again.",
        });
      }
      return;
    } finally {
      if (mountedRef.current) setClaiming(false);
    }
    if (mountedRef.current) setStarted(true);
  }, [onClaimJob]);

  /** Leaving waits for outstanding saves; an unsaved count is never dropped silently. */
  const handleExit = useCallback(async () => {
    if (exiting) return;
    setExiting(true);
    setExitSaving(true);
    await saveQueueRef.current;
    if (confirmInFlightRef.current) await confirmInFlightRef.current.catch(() => undefined);
    if (submitInFlightRef.current) await submitInFlightRef.current.catch(() => undefined);
    if (!mountedRef.current) return;
    setExitSaving(false);
    const unsavedId = Object.keys(saveFailedRef.current).find((lineId) => saveFailedRef.current[lineId]);
    if (unsavedId) {
      setExiting(false);
      const line = lineById(unsavedId);
      setMessage({
        severity: 'error',
        text: `The count for ${line ? lineName(line) : 'a product'} wasn't saved. Save it again, or leave without it.`,
        retryLineId: unsavedId,
        leaveAnyway: true,
      });
      return;
    }
    if (Object.keys(decisionsRef.current).length > 0) {
      setExiting(false);
      setMessage({
        severity: 'warning',
        text: "Your review choices aren't saved yet. Confirm them, or leave without saving.",
        leaveAnyway: true,
      });
      return;
    }
    // Everything is saved: confirm before leaving (V3.1 Saved sheet). No write.
    setExitSavedOpen(true);
  }, [exiting, lineById]);

  const keepReceivingGrouped = useCallback(() => {
    setExitSavedOpen(false);
    setExiting(false);
  }, []);

  const confirmGroupedExit = useCallback(() => {
    if (exitConfirmedRef.current) return;
    exitConfirmedRef.current = true;
    onComplete();
  }, [onComplete]);

  /** One line's review: difference, the decision in force, settledness and its exact grouped payload. */
  const reviewLine = (line: ReceiveJobLine) => {
    const lineId = line.receive_job_line_id;
    const count = entries[lineId]?.confirmed ?? 0;
    const expected = Number(line.quantity_expected);
    const difference = count - expected;
    const shortfall = Math.max(0, -difference);
    const extra = Math.max(0, difference);
    const problems = reportedProblems(line);
    const missingEvidence = problems.filter((problem) => problem.exception_type === 'missing_item');
    const recordedMissing = missingEvidence.reduce((sum, problem) => sum + Number(problem.quantity_affected ?? 0), 0);
    // GH-1241 S3C-M4 — damaged units an older client already recorded on this
    // line are part of the explanation, referenced by ID and never re-reported.
    const defectEvidence = problems.filter((problem) =>
      problem.exception_type === 'defect' && problem.disposition !== 'recoverable_held');
    const recordedDamaged = defectEvidence.reduce((sum, problem) => sum + Number(problem.quantity_affected ?? 0), 0);
    // Rejection evidence this review cannot express (wrong item/variant) is ambiguous: fail closed.
    // S4-4C — so is held evidence recorded before this review (per-line capture is deferred).
    const unsupportedEvidence = problems.some((problem) =>
      problem.exception_type === 'wrong_item' || problem.exception_type === 'wrong_variant'
      || problem.disposition === 'recoverable_held');
    const canonicalApproved = problems
      .filter((problem) => problem.exception_type === 'extra_item' && problem.accounting_role === 'overage')
      .reduce((sum, problem) => sum + Number(problem.quantity_affected ?? 0), 0);
    const approved = Math.max(canonicalApproved, approvedExtra[lineId] ?? 0);
    const savedLine = currentRevision?.lines
      .find((candidate) => candidate.receive_job_line_id.toLowerCase() === lineId.toLowerCase()) ?? null;
    // A decision saved for another good count no longer describes this delivery.
    const countChanged = savedLine != null && Number(savedLine.quantity_accepted) !== count;
    const local = decisions[lineId]?.basisCount === count ? decisions[lineId] : null;
    const decision: ReviewDecision = local
      ?? (savedLine && !countChanged
        ? {
          missing: Number(savedLine.quantity_missing),
          later: Number(savedLine.quantity_deferred),
          damaged: Number(savedLine.quantity_rejected),
          repairDamage: savedHeld(savedLine, 'defect'),
          repairPackaging: savedHeld(savedLine, 'packaging_damage'),
          basisCount: count,
        }
        : { missing: recordedMissing, later: 0, damaged: recordedDamaged, repairDamage: 0, repairPackaging: 0, basisCount: count });
    const assigned = decision.missing + decision.later + decision.damaged + decision.repairDamage + decision.repairPackaging;
    const settled = !unsupportedEvidence && (difference < 0
      ? assigned === shortfall && decision.missing >= recordedMissing && decision.damaged >= recordedDamaged
      : recordedMissing === 0 && recordedDamaged === 0 && (difference === 0 || approved >= extra));
    // Recorded evidence that cannot fit this difference needs a lead, not a guess.
    const evidenceExceedsDifference = recordedMissing + recordedDamaged > shortfall;
    const missing = difference < 0 ? decision.missing : 0;
    const damaged = difference < 0 ? decision.damaged : 0;
    const later = difference < 0 ? decision.later : 0;
    const repairDamage = difference < 0 ? decision.repairDamage : 0;
    const repairPackaging = difference < 0 ? decision.repairPackaging : 0;
    const newMissing = missing - recordedMissing;
    const newDamaged = damaged - recordedDamaged;
    const payload: ReceiveReconciliationLinePayload = {
      receive_job_line_id: lineId,
      quantity_accepted: count,
      quantity_rejected: damaged,
      quantity_missing: missing,
      quantity_deferred: later,
      // S4-4C — each held unit becomes one held LSU and one Problem Center task at finalize.
      quantity_held_recoverable: repairDamage + repairPackaging,
      new_exceptions: [
        ...(newDamaged > 0 ? [{ exception_type: 'defect', quantity_affected: newDamaged, accounting_role: 'shortfall', notes: null }] : []),
        ...(newMissing > 0 ? [{ exception_type: 'missing_item', quantity_affected: newMissing, accounting_role: 'shortfall', notes: null }] : []),
        ...(repairDamage > 0 ? [{ exception_type: 'defect', quantity_affected: repairDamage, accounting_role: null, notes: null, disposition: 'recoverable_held' as const }] : []),
        ...(repairPackaging > 0 ? [{ exception_type: 'packaging_damage', quantity_affected: repairPackaging, accounting_role: null, notes: null, disposition: 'recoverable_held' as const }] : []),
      ],
      existing_exception_ids: [...missingEvidence, ...defectEvidence].map((problem) => problem.receive_exception_id),
    };
    return {
      lineId, line, count, expected, difference, shortfall, extra, approved, recordedMissing, recordedDamaged,
      unsupportedEvidence, evidenceExceedsDifference, countChanged, decision, assigned, settled, payload,
    };
  };
  type ReviewModel = ReturnType<typeof reviewLine>;

  const setDecisionField = (model: ReviewModel, field: ReviewDecisionField, raw: string) => {
    const digits = raw.replace(/\D/g, '');
    const value = digits ? Number.parseInt(digits, 10) : 0;
    if (!Number.isSafeInteger(value)) return;
    setMessage(null);
    setDecisions({ ...decisionsRef.current, [model.lineId]: { ...model.decision, [field]: value, basisCount: model.count } });
  };

  const handleSubmitFailure = (err: any) => {
    if (!err?.response) {
      setMessage({ severity: 'error', text: "Couldn't reach the server. Your choices are kept — try again." });
      return;
    }
    const status = Number(err.response.status);
    const code = String(err.response.data?.code ?? '');
    if (RECONCILIATION_STALE_CODES.has(code)) {
      // Renewed review: drop this session's decisions and re-read the Receive.
      setSavedRevision(null);
      setDecisions({});
      setMessage({ severity: 'warning', text: 'This Receive was changed on another device. Please check again.' });
      refreshCanonical();
      return;
    }
    if (status >= 400 && status < 500) {
      setMessage({ severity: 'error', text: "This Receive couldn't be completed with these choices. Check the products below and try again." });
      refreshCanonical();
      return;
    }
    setMessage({ severity: 'error', text: 'Something went wrong while finishing. Your choices are kept — try again.' });
  };

  /** Save a revision only when the payload differs from the current one, then finalize exactly that revision and payload. */
  const submitReview = async (models: ReviewModel[]) => {
    if (submitInFlightRef.current) return;
    if (!onSaveReconciliationDraft || !onFinalizeReconciliation) {
      setMessage({ severity: 'error', text: 'Finishing this Receive is unavailable. Go back to WMS and try again.' });
      return;
    }
    const payloadLines = models.map((model) => model.payload);
    setSubmitting(true);
    setMessage(null);
    const run = (async () => {
      const current = savedRevisionRef.current ?? propRevisionRef.current;
      let revisionId = current && sameReconciliationPayload(current.lines, payloadLines) ? current.revision_id : null;
      if (!revisionId) {
        let saved: ReceiveReconciliationRevisionResult;
        try {
          saved = await onSaveReconciliationDraft({ base_revision_id: current?.revision_id ?? null, lines: payloadLines });
        } catch (err) {
          if (mountedRef.current) handleSubmitFailure(err);
          return;
        }
        if (!mountedRef.current) return;
        revisionId = saved.revision_id;
        setSavedRevision({ revision_id: saved.revision_id, lines: payloadLines });
        setDecisions({});
      }
      try {
        await onFinalizeReconciliation({ current_revision_id: revisionId, lines: payloadLines });
      } catch (err) {
        if (mountedRef.current) handleSubmitFailure(err);
        return;
      }
      if (!mountedRef.current) return;
      setMessage(null);
      // The canonical job and evidence now route the session to labels/close (M4).
      refreshCanonical();
    })();
    submitInFlightRef.current = run;
    try {
      await run;
    } finally {
      submitInFlightRef.current = null;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  /** Explicit overage approval through the existing writer; never inferred from a high count. */
  const keepExtra = async (model: ReviewModel) => {
    const quantity = model.extra - model.approved;
    if (quantity <= 0 || keepingExtraId) return;
    setKeepingExtraId(model.lineId);
    setMessage(null);
    try {
      await onApproveOverDelivery({
        lasyncro_variant_id: model.line.lasyncro_variant_id ?? null,
        receive_job_line_id: model.lineId,
        quantity_affected: quantity,
        notes: `${quantity} extra unit${quantity === 1 ? '' : 's'} kept during receive`,
      });
    } catch {
      if (mountedRef.current) setMessage({ severity: 'error', text: "Couldn't keep the extra units. Please try again." });
      return;
    } finally {
      if (mountedRef.current) setKeepingExtraId(null);
    }
    if (!mountedRef.current) return;
    setApprovedExtra((previous) => ({ ...previous, [model.lineId]: model.approved + quantity }));
    refreshCanonical();
  };

  const editCountFromReview = (lineId: string) => {
    setReviewing(false);
    selectLine(lineId);
    setEditingId(lineId);
  };

  const total = applicable.length;
  const countedTotal = applicable.filter((line) => entries[line.receive_job_line_id]?.confirmed != null).length;
  const totalUnits = applicable.reduce((sum, line) => sum + Number(line.quantity_expected), 0);

  const backButton = (
    <ReceiveFooterButton onClick={() => void handleExit()} disabled={exiting} sx={{ height: 36 }}>
      Exit
    </ReceiveFooterButton>
  );
  const reference = props.poNumber != null ? `PO-${props.poNumber}` : 'PO reference unavailable';
  // Exit outcomes (failed save / unsaved review choices) open in the V3.1
  // exit sheet; every other message stays inline in the task column.
  const exitMessage = message?.leaveAnyway ? message : null;
  const exitSheetNode = exitSavedOpen ? (
    <ReceiveExitSheet
      open
      eyebrow="Leave receiving"
      title="Leave this"
      accent="Receive?"
      body="Your counts are saved. This Receive stays assigned to you."
      onDismiss={keepReceivingGrouped}
    >
      <ReceiveCta tier="strong" onClick={keepReceivingGrouped}>Keep receiving</ReceiveCta>
      <ReceiveCta tier="secondary" onClick={confirmGroupedExit}>Back to WMS</ReceiveCta>
    </ReceiveExitSheet>
  ) : exitSaving ? (
    <ReceiveExitSheet
      open
      eyebrow="Leave receiving"
      title="Saving your"
      accent="count…"
      busy
      body={<span role="status">Wait until saving finishes. Leaving now could lose the count you just entered.</span>}
    >
      <ReceiveCta tier="secondary" disabled>Back to WMS</ReceiveCta>
    </ReceiveExitSheet>
  ) : exitMessage ? (
    <ReceiveExitSheet
      open
      eyebrow="Not saved"
      eyebrowTone="error"
      title={exitMessage.retryLineId ? 'Count not' : 'Review choices'}
      accent={exitMessage.retryLineId ? 'saved.' : 'not saved.'}
      body={<span role="alert">{exitMessage.text}</span>}
      onDismiss={() => setMessage(null)}
    >
      {exitMessage.retryLineId ? (
        <ReceiveCta onClick={() => saveAgain(exitMessage.retryLineId!)}>Save again</ReceiveCta>
      ) : (
        <ReceiveCta tier="strong" onClick={() => setMessage(null)}>Back to review</ReceiveCta>
      )}
      <ReceiveCta tier="secondary" onClick={() => onComplete()}>Leave without saving</ReceiveCta>
    </ReceiveExitSheet>
  ) : null;
  const messageNode = message && !message.leaveAnyway ? (
    <Alert
      severity={message.severity}
      action={(message.retryLineId || message.leaveAnyway) ? (
        <Box sx={{ display: 'flex', gap: 1 }}>
          {message.retryLineId && (
            <Button color="inherit" size="small" onClick={() => saveAgain(message.retryLineId!)}>Save again</Button>
          )}
          {message.leaveAnyway && (
            <Button color="inherit" size="small" onClick={() => onComplete()}>Leave without saving</Button>
          )}
        </Box>
      ) : undefined}
    >
      {message.text}
    </Alert>
  ) : null;

  if (!assignedToMe) {
    return (
      <ReceiveSessionNotice
        props={props}
        severity="info"
        title="Receive"
        message="This Receive is assigned to another operator. Nothing has been changed."
      />
    );
  }

  if (!counting) {
    return (
      <ReceiveSessionShell
        reference={reference}
        supplier={props.supplierName}
        jobId={props.receiveJobId}
        bars={applicable.map(() => 'idle')}
        progressLabel={`Brief · ${total} ${total === 1 ? 'product' : 'products'}`}
        headerAction={backButton}
        overlay={exitSheetNode}
      >
        <ReceiveTaskHeading
          eyebrow="Brief"
          title={<>Receive from {props.supplierName}</>}
          sub={`${total} ${total === 1 ? 'product' : 'products'} · ${totalUnits} ${totalUnits === 1 ? 'unit' : 'units'} expected`}
        />
        {messageNode}
        <ReceiveActions>
          <ReceiveStatusLine>
            Count only items ready to sell. Set damaged items aside and report them in Review.
          </ReceiveStatusLine>
          <ReceiveCta onClick={() => void handleStart()} disabled={claiming}>
            {claiming ? 'Starting…' : 'Start receiving'}
          </ReceiveCta>
        </ReceiveActions>
      </ReceiveSessionShell>
    );
  }

  const current = lineById(currentId);
  const currentEntry = current ? entries[current.receive_job_line_id] : undefined;
  const currentLocked = currentEntry?.confirmed != null && editingId !== current?.receive_job_line_id;
  const currentCount = currentEntry?.count ?? null;
  const currentExpected = current ? Number(current.quantity_expected) : 0;
  const allCounted = total > 0 && countedTotal === total;
  const showReview = reviewing && allCounted;
  const reviewModels = showReview ? applicable.map(reviewLine) : [];
  const differing = reviewModels.filter((model) => model.difference !== 0 || model.countChanged || !model.settled);
  const matchingCount = reviewModels.length - differing.length;
  const allSettled = reviewModels.length > 0 && reviewModels.every((model) => model.settled);
  const groupedBars: ReceiveBarTone[] = applicable.map((line) => {
    const state = countEntryState(entries[line.receive_job_line_id]);
    if (state === 'confirmed') return 'done';
    return !showReview && line.receive_job_line_id === currentId ? 'current' : 'idle';
  });

  const productsList = (
    <Box
      component="ul"
      aria-label="Products on this delivery"
      sx={{ border: '1px solid var(--rule-2)', borderRadius: '12px', bgcolor: 'var(--surface)', m: 0, p: 0.5, listStyle: 'none' }}
    >
      {applicable.map((line) => {
        const lineId = line.receive_job_line_id;
        const entry = entries[lineId];
        const state = countEntryState(entry);
        const isCurrent = lineId === currentId;
        const status = state === 'confirmed'
          ? `Counted ${entry!.confirmed}`
          : state === 'unconfirmed'
            ? `${entry!.count} · not confirmed`
            : 'Not counted';
        return (
          <Box component="li" key={lineId}>
            <Box
              component="button"
              type="button"
              data-testid={`receive-count-line-${lineId}`}
              data-count-state={state}
              data-count={entry?.count == null ? '' : String(entry.count)}
              data-current={isCurrent ? 'true' : 'false'}
              aria-current={isCurrent ? 'true' : undefined}
              onClick={() => { setProductsOpen(false); selectLine(lineId); }}
              sx={{
                all: 'unset',
                boxSizing: 'border-box',
                width: '100%',
                display: 'grid',
                gridTemplateColumns: '22px minmax(0,1fr) auto',
                alignItems: 'center',
                gap: 1.5,
                px: 1.5,
                py: 1.1,
                borderRadius: '8px',
                cursor: 'pointer',
                bgcolor: isCurrent ? 'var(--accent-ghost)' : 'transparent',
                '&:focus-visible': { outline: '2px solid var(--accent)' },
              }}
            >
              <Box
                aria-hidden="true"
                sx={{ width: 20, height: 20, borderRadius: '50%', bgcolor: state === 'confirmed' ? 'var(--good-ink)' : state === 'unconfirmed' ? 'var(--accent)' : 'var(--bg-3)' }}
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', overflowWrap: 'anywhere' }}>
                  {lineName(line)}
                </Typography>
                <Typography sx={{ fontSize: 11, color: 'var(--ink-3)', ...monoSx }}>
                  {line.sku ?? '—'}
                </Typography>
              </Box>
              <Typography sx={{
                ...monoSx,
                fontSize: 12,
                fontWeight: 500,
                flexShrink: 0,
                color: state === 'confirmed' ? 'var(--ink)' : state === 'unconfirmed' ? 'var(--ink-2)' : 'var(--ink-4)',
              }}>
                {status}
              </Typography>
            </Box>
          </Box>
        );
      })}
    </Box>
  );

  const pageIndex = Math.min(reviewPage, Math.max(0, differing.length - 1));
  const unsettledCount = differing.filter((model) => !model.settled).length;

  const reviewBody = (
    <Box data-testid="receive-review" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <ReceiveTaskHeading
        eyebrow="Check differences"
        title={differing.length === 0
          ? 'Every product'
          : `${differing.length} ${differing.length === 1 ? 'product' : 'products'}`}
        accent={differing.length === 0 ? 'matches.' : differing.length === 1 ? 'differs.' : 'differ.'}
        sub={differing.length === 0
          ? 'Every product matches what was expected.'
          : 'Tell us what happened to each difference. Counted means good, usable units.'}
      />

      {differing.length > 1 && (
        <Box component="nav" aria-label="Differences" sx={{ display: 'grid', gap: 1 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', alignItems: 'center', gap: 1 }}>
            <ReceiveFooterButton
              aria-label="Previous difference"
              disabled={pageIndex === 0}
              onClick={() => setReviewPage(pageIndex - 1)}
              sx={{ height: 32, minWidth: { xs: 44, md: 32 }, px: 1.25 }}
            >
              ‹
            </ReceiveFooterButton>
            <Typography role="status" aria-live="polite" sx={{ textAlign: 'center', fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}>
              {`Difference ${pageIndex + 1} of ${differing.length}`}
              {unsettledCount > 0 ? ` · ${unsettledCount} to settle` : ' · all settled'}
            </Typography>
            <ReceiveFooterButton
              aria-label="Next difference"
              disabled={pageIndex >= differing.length - 1}
              onClick={() => setReviewPage(pageIndex + 1)}
              sx={{ height: 32, minWidth: { xs: 44, md: 32 }, px: 1.25 }}
            >
              ›
            </ReceiveFooterButton>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', columnGap: { xs: '20px', md: 0.75 }, rowGap: { xs: '20px', md: 0.75 } }}>
            {differing.map((model, index) => (
              <Box
                key={model.lineId}
                component="button"
                type="button"
                data-testid={`receive-review-page-${model.lineId}`}
                aria-label={`Difference ${index + 1}: ${lineName(model.line)} — ${model.settled ? 'settled' : 'needs a decision'}`}
                aria-current={index === pageIndex ? 'step' : undefined}
                onClick={() => setReviewPage(index)}
                sx={{
                  all: 'unset',
                  boxSizing: 'border-box',
                  cursor: 'pointer',
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  border: index === pageIndex ? '2px solid var(--ink)' : '1px solid var(--rule-2)',
                  bgcolor: 'var(--surface)',
                  '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 },
                  // S8-C5 — 44px touch target on mobile; the gap above keeps neighbours from overlapping.
                  // The inset is measured from the padding box, so it also covers the 1–2px border.
                  position: 'relative',
                  '&::after': { content: '""', position: 'absolute', inset: { xs: index === pageIndex ? -12 : -11, md: 0 } },
                }}
              >
                <Box aria-hidden="true" sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: model.settled ? 'var(--good-ink)' : 'var(--accent)' }} />
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {differing.slice(pageIndex, pageIndex + 1).map((model) => {
        const remaining = model.shortfall - model.assigned;
        return (
          <Box
            key={model.lineId}
            data-testid={`receive-review-line-${model.lineId}`}
            data-difference={String(model.difference)}
            data-settled={model.settled ? 'true' : 'false'}
            sx={{ border: '1px solid var(--rule-2)', borderRadius: '12px', bgcolor: 'var(--surface)', px: 2, py: 1.75, display: 'grid', gap: 1.25 }}
          >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5 }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', overflowWrap: 'anywhere' }}>
                  {lineName(model.line)}
                </Typography>
                <Typography sx={{ ...monoSx, fontSize: 12, color: 'var(--ink-3)' }}>
                  {`Expected ${model.expected} · Counted ${model.count}`}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.75, flexShrink: 0 }}>
                {model.countChanged && <Chip size="small" color="warning" label="Count changed" />}
                <Chip
                  size="small"
                  variant="outlined"
                  label={model.difference < 0 ? `${model.shortfall} short` : model.difference > 0 ? `${model.extra} extra` : 'Matches'}
                  sx={{ borderColor: 'var(--rule-2)', '& .MuiChip-label': monoSx }}
                />
              </Box>
            </Box>

            {model.difference < 0 && (
              <>
                {/* S4-4D F1 — two columns on mobile so the long Repairable labels stay fully readable at 390px. */}
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' }, columnGap: 1, rowGap: { xs: 1.5, sm: 1 } }}>
                  {REVIEW_DECISION_FIELDS.map(({ field, label }) => (
                    <TextField
                      key={field}
                      label={label}
                      type="number"
                      size="small"
                      value={String(model.decision[field])}
                      disabled={submitting}
                      onChange={(event) => setDecisionField(model, field, event.target.value)}
                      inputProps={{
                        min: field === 'missing' ? model.recordedMissing : field === 'damaged' ? model.recordedDamaged : 0,
                        inputMode: 'numeric',
                        style: { ...monoSx, textAlign: 'center', fontSize: 17 },
                      }}
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px', bgcolor: 'var(--surface)' } }}
                    />
                  ))}
                </Box>
                <ReceiveStatusLine tone={model.settled ? 'ok' : 'warn'}>
                  {model.unsupportedEvidence
                    ? 'A wrong item or held unit was already recorded for this product. Ask a lead to review it before finishing.'
                    : model.evidenceExceedsDifference
                    ? 'More units were already recorded as missing or damaged than this difference. Ask a lead to review it.'
                    : model.decision.missing < model.recordedMissing
                    ? `${model.recordedMissing} already recorded as missing must stay missing`
                    : model.decision.damaged < model.recordedDamaged
                    ? `${model.recordedDamaged} already recorded as damaged must stay damaged`
                    : remaining > 0
                      ? `Assign ${remaining} more`
                      : remaining < 0
                        ? `${-remaining} too many assigned`
                        : model.recordedMissing > 0
                          ? `All accounted for · ${model.recordedMissing} already recorded as missing`
                          : 'All accounted for'}
                </ReceiveStatusLine>
              </>
            )}

            {model.difference > 0 && (model.approved >= model.extra ? (
              <ReceiveStatusLine tone="ok">
                {`${model.extra} extra kept — received into stock when this Receive closes.`}
              </ReceiveStatusLine>
            ) : (
              <Box sx={{ display: 'grid', gap: 0.75 }}>
                <ReceiveCta
                  tier="secondary"
                  disabled={keepingExtraId != null || submitting}
                  onClick={() => void keepExtra(model)}
                  sx={{ height: 44 }}
                >
                  Keep extra units
                </ReceiveCta>
                <ReceiveStatusLine>
                  {`The ${model.extra} extra will be received into stock when this Receive closes.`}
                </ReceiveStatusLine>
              </Box>
            ))}

            <ReceiveTextAction disabled={submitting} onClick={() => editCountFromReview(model.lineId)} sx={{ minHeight: { xs: 44, md: 28 } }}>
              Edit count
            </ReceiveTextAction>
          </Box>
        );
      })}

      {matchingCount > 0 && (
        <ReceiveStatusLine tone="ok">
          {`${matchingCount} ${matchingCount === 1 ? 'product matches' : 'products match'} what was expected`}
        </ReceiveStatusLine>
      )}

      {messageNode}

      <ReceiveActions>
        {allSettled ? (
          <ReceiveStatusLine>Next: labels and closing this Receive. Stock is added when it closes.</ReceiveStatusLine>
        ) : (
          <ReceiveStatusLine tone="warn">
            {`${unsettledCount} ${unsettledCount === 1 ? 'difference still needs' : 'differences still need'} a decision before you can continue.`}
          </ReceiveStatusLine>
        )}
        <ReceiveCta
          disabled={!allSettled || submitting || keepingExtraId != null}
          onClick={() => void submitReview(reviewModels)}
        >
          {submitting ? 'Saving…' : 'Confirm and continue'}
        </ReceiveCta>
        <ReceiveTextAction onClick={() => setReviewing(false)} disabled={submitting}>
          Back to counting
        </ReceiveTextAction>
      </ReceiveActions>
    </Box>
  );

  const countBody = (
    <Box data-testid="receive-count-current" sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 1.5, md: 2 }, flex: { xs: 1, md: 'none' } }}>
      {current ? (
        <>
          <ReceiveTaskHeading
            eyebrow="Count"
            title={lineName(current)}
            titleSx={{ fontSize: { xs: 30, md: 44 } }}
            sub={<Box component="span" sx={{ ...monoSx, fontSize: 12, letterSpacing: '0.04em', color: 'var(--ink-3)' }}>{current.sku ?? '—'}</Box>}
          />
          <ReceiveProductImage src={current.image_url} />
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.75,
              height: 60,
              px: 2.25,
              border: '1px solid var(--rule-2)',
              borderRadius: '12px',
              bgcolor: 'var(--surface)',
            }}
          >
            <ScanBarcode size={18} color="var(--accent)" aria-hidden="true" />
            <TextField
              inputRef={scanInputRef}
              variant="standard"
              fullWidth
              value={scanValue}
              placeholder="Scan barcode"
              onChange={(event) => setScanValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                const value = (event.target as HTMLInputElement).value;
                setScanValue('');
                void handleScan(value);
              }}
              autoComplete="off"
              InputProps={{ disableUnderline: true }}
              inputProps={{ style: { ...monoSx, fontSize: 18 }, 'aria-label': 'Scan barcode' }}
            />
            <Box
              component="span"
              aria-hidden="true"
              sx={{ display: { xs: 'none', md: 'inline' }, fontSize: 10, fontWeight: 500, border: '1px solid currentColor', borderRadius: '4px', px: 0.75, py: '2px', opacity: 0.75 }}
            >
              Enter
            </Box>
          </Box>
          <Box
            sx={{
              display: 'grid',
              justifyItems: 'center',
              gap: '2px',
              p: { xs: '12px 16px', md: '20px 24px' },
              border: '1px solid var(--rule-2)',
              borderRadius: '12px',
              bgcolor: 'var(--surface)',
            }}
          >
            <TextField
              inputRef={countInputRef}
              variant="standard"
              label="Counted"
              type="number"
              value={currentCount == null ? '' : String(currentCount)}
              disabled={currentLocked}
              onChange={(event) => handleTypedCount(current.receive_job_line_id, event.target.value)}
              placeholder="not counted"
              InputProps={{ disableUnderline: true }}
              InputLabelProps={{ shrink: true, sx: { width: '100%', textAlign: 'center', transformOrigin: 'top center', left: 0, right: 0 } }}
              inputProps={{ min: 0, inputMode: 'numeric', style: { textAlign: 'center', fontWeight: 300 } }}
              sx={{
                width: '100%',
                maxWidth: 320,
                '& .MuiInputBase-input': { fontSize: { xs: 56, md: 72 }, lineHeight: 1, height: 'auto', fontVariantNumeric: 'tabular-nums' },
                '& .MuiInputBase-input::placeholder': { fontSize: 28, color: 'var(--ink-3)', opacity: 1 },
              }}
            />
            <Typography component="span" sx={{ fontSize: 14, fontWeight: 300, color: 'var(--ink-3)' }}>
              of <Box component="span" sx={monoSx}>{currentExpected}</Box> expected
            </Typography>
          </Box>
          {currentCount != null && currentCount !== currentExpected && (
            <ReceiveStatusLine tone="warn">
              {currentCount > currentExpected
                ? `${currentCount - currentExpected} more than expected`
                : `${currentExpected - currentCount} fewer than expected`}
            </ReceiveStatusLine>
          )}
          {messageNode}
          <ReceiveActions>
            {allCounted ? (
              <ReceiveStatusLine tone="ok">All products counted · only items ready to sell are counted.</ReceiveStatusLine>
            ) : (
              <ReceiveStatusLine>
                Count only items ready to sell. Set damaged items aside and report them in Review.
              </ReceiveStatusLine>
            )}
            {currentLocked ? (
              <ReceiveCta
                tier={allCounted ? 'secondary' : 'primary'}
                onClick={() => { setEditingId(current.receive_job_line_id); setMessage(null); }}
              >
                Edit count
              </ReceiveCta>
            ) : (
              <ReceiveCta
                tier={allCounted ? 'secondary' : 'primary'}
                disabled={currentCount == null || confirming}
                onClick={() => {
                  if (currentCount != null) void confirmCount(current.receive_job_line_id, currentCount);
                }}
              >
                {confirming ? 'Confirming…' : 'Confirm count'}
              </ReceiveCta>
            )}
            {allCounted && (
              <ReceiveCta onClick={() => { setMessage(null); setReviewPage(0); setReviewing(true); }}>
                Review and finish
              </ReceiveCta>
            )}
            {!currentLocked && (currentCount == null || currentCount === 0) && (
              <ReceiveTextAction
                disabled={confirming}
                onClick={() => void confirmCount(current.receive_job_line_id, 0)}
              >
                None arrived
              </ReceiveTextAction>
            )}
          </ReceiveActions>
        </>
      ) : (
        <>
          <ReceiveTaskHeading eyebrow="Count" title="Nothing to count" />
          <ReceiveStatusLine>Nothing to count on this delivery.</ReceiveStatusLine>
          {messageNode}
        </>
      )}
    </Box>
  );

  return (
    <>
      <ReceiveSessionShell
        reference={reference}
        supplier={props.supplierName}
        jobId={props.receiveJobId}
        bars={groupedBars}
        progressLabel={`${countedTotal} of ${total} products counted`}
        headerAction={backButton}
        overlay={exitSheetNode}
        footerRight={(
          <ReceiveFooterButton onClick={() => setProductsOpen(true)} aria-haspopup="dialog">
            Products · {countedTotal} of {total}
          </ReceiveFooterButton>
        )}
      >
        {showReview ? reviewBody : countBody}
      </ReceiveSessionShell>
      <ReceiveLinesDrawer
        open={productsOpen}
        title={`Products · ${countedTotal} of ${total}`}
        onClose={() => setProductsOpen(false)}
      >
        {productsList}
      </ReceiveLinesDrawer>
    </>
  );
}

/**
 * GH-1241 S3C-M1 — routes the session by its host-resolved mode. Only the
 * per-line journey and a grouped-finalized label/close continuation run the
 * operational flow; every other mode is non-operational and writes nothing.
 * A closed Receive always restores the canonical completion handoff.
 */
export default function ReceiveSessionPage(props: ReceiveSessionPageProps) {
  const mode: ReceiveSessionMode = props.sessionMode ?? 'per_line';
  const marker = (
    <Box
      data-testid="receive-session-mode"
      data-receive-mode={mode}
      data-current-revision-id={props.reconciliation?.current_revision_id ?? ''}
      sx={{ display: 'none' }}
    />
  );
  const closed = !!props.closedAt || props.jobStatus === 'closed';

  if (closed || mode === 'per_line') {
    return <>{marker}<ReceiveSessionFlow key={closed ? 'closed' : 'per_line'} {...props} /></>;
  }

  if (mode === 'grouped_finalized') {
    return (
      <>
        {marker}
        <ReceiveSessionFlow
          key="grouped_finalized"
          {...props}
          lines={props.lines.filter((line) => !isExcludedExpectedZeroLine(line))}
          onInspectLine={refuseFinalizedAccounting}
          onPersistLineProgress={refuseFinalizedAccounting}
          onConfirmLineCount={refuseFinalizedAccounting}
          onReportException={refuseFinalizedAccounting}
          onApproveOverDelivery={refuseFinalizedAccounting}
        />
      </>
    );
  }

  if (mode === 'grouped') return <>{marker}<GroupedReceiveCount props={props} /></>;

  if (mode === 'resolving') {
    return (
      <>
        {marker}
        <ReceiveSessionShell
          reference={props.poNumber != null ? `PO-${props.poNumber}` : 'PO reference unavailable'}
          supplier={props.supplierName}
          jobId={props.receiveJobId}
          bars={[]}
        >
          <ReceiveTaskHeading eyebrow="Receive" title="Checking this" accent="Receive." sub="Checking this Receive…" />
          <LinearProgress aria-label="Loading the latest saved state" sx={{ width: 200, alignSelf: 'center', height: 3, borderRadius: '2px', bgcolor: 'var(--bg-3)', '& .MuiLinearProgress-bar': { bgcolor: 'var(--accent)' } }} />
        </ReceiveSessionShell>
      </>
    );
  }

  return (
    <>
      {marker}
      <ReceiveSessionNotice
        props={props}
        severity="error"
        title="This Receive"
        accent="can't continue here."
        ctaLabel="Back to Operations"
        message="This Receive can't continue here because its current state couldn't be confirmed. Nothing has been changed. Return to Operations and reopen it, or ask a lead to review it."
      />
    </>
  );
}
