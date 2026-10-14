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
  useTheme,
} from '@mui/material';
import {
  AlertTriangle,
  CheckCircle,
  Hash,
  Package,
  PackageX,
  ScanBarcode,
} from 'lucide-react';

type SessionPhase = 'brief' | 'inspect' | 'reconcile' | 'review' | 'handoff';
type LineAction = 'scan' | 'count';

const ACTIVE_RECEIVE_JOB_STATUSES = new Set([
  'in_progress',
  'inspection',
  'barcode_assignment',
  'stow_ready',
]);

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
  onCloseJob: (params: { actual_delivery_date?: string }) => Promise<void>;
  onComplete: () => void;
  onResolveBarcode?: (scannedValue: string) => Promise<{ lasyncro_variant_id: string } | null>;
  onPrintUnitLabels?: (receiveJobLineId: string) => Promise<void>;
  onConfirmUnitLabelsPrinted: (receiveJobLineId: string) => Promise<void>;
  onRefresh?: () => Promise<void> | void;
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

const RECONCILIATION_CHOICES: Array<{ type: ProblemType; label: string; requiresNotes?: boolean }> = [
  { type: 'deferred', label: 'Coming in a later delivery' },
  { type: 'defect', label: 'Damaged unit' },
  { type: 'wrong_item', label: 'Wrong product' },
  { type: 'wrong_variant', label: 'Wrong variant' },
  { type: 'missing_item', label: 'Missing item' },
  { type: 'other', label: 'Other', requiresNotes: true },
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
  height: 40,
  px: 1.5,
  borderRadius: '6px',
  bgcolor: emphasized ? 'var(--surface)' : 'transparent',
  borderColor: emphasized ? 'var(--rule-2)' : 'var(--rule)',
  color: 'var(--ink)',
  fontWeight: 800,
  '&:hover': {
    bgcolor: 'var(--surface)',
    borderColor: 'var(--rule-2)',
  },
  '&.Mui-disabled': {
    bgcolor: 'transparent',
    borderColor: 'var(--rule)',
  },
} as const);
const countStepperValueSx = {
  '& .MuiInputBase-root': {
    height: 40,
    borderRadius: '6px',
    bgcolor: 'transparent',
    color: 'var(--ink)',
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: 'var(--rule)',
  },
  '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': {
    borderColor: 'var(--rule-2)',
  },
  '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
    borderColor: 'var(--rule-2)',
    borderWidth: 1,
  },
  '& .MuiInputBase-input': {
    py: 0,
  },
} as const;
const reconciliationChoiceSx = (selected: boolean) => ({
  minHeight: 40,
  px: 1.5,
  py: 0.75,
  borderRadius: '6px',
  justifyContent: 'flex-start',
  bgcolor: selected ? 'var(--surface)' : 'transparent',
  borderColor: selected ? 'var(--rule-2)' : 'var(--rule)',
  color: 'var(--ink)',
  boxShadow: 'none',
  fontWeight: selected ? 700 : 600,
  cursor: 'pointer',
  '&:hover': {
    bgcolor: selected ? 'var(--surface)' : 'var(--surface-2, var(--surface))',
    borderColor: 'var(--rule-2)',
  },
  '&.Mui-focusVisible': {
    outline: '2px solid var(--focus-ring, var(--rule-2))',
    outlineOffset: 2,
  },
  '&.Mui-disabled': {
    bgcolor: 'transparent',
    borderColor: 'var(--rule)',
  },
} as const);
const reconciliationCommitActionSx = {
  width: '100%',
  minHeight: 38,
  borderRadius: '6px',
  bgcolor: 'var(--accent)',
  borderColor: 'var(--accent)',
  color: 'var(--accent-ink)',
  fontWeight: 750,
  '&:hover': {
    bgcolor: 'var(--accent)',
    borderColor: 'var(--accent)',
    opacity: 0.88,
  },
  '&.Mui-focusVisible': {
    outline: '2px solid var(--focus-ring, var(--rule-2))',
    outlineOffset: 2,
  },
  '&.Mui-disabled': {
    bgcolor: 'transparent',
    borderColor: 'var(--rule)',
    color: 'text.disabled',
  },
} as const;

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

function problemDetailLabel(problem: ReceiveReportedProblem): string {
  const label = problemLabel(problem.exception_type);
  const quantity = unitLabel(Number(problem.quantity_affected ?? 0));
  return problem.resolved ? `${label} · ${quantity} · resolved` : `${label} · ${quantity}`;
}


function ReportedProblemSummary({
  line,
  compact = false,
}: {
  line: ReceiveJobLine;
  compact?: boolean;
}) {
  const problems = reportedProblems(line);
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
          <Typography variant="caption" color="text.secondary" noWrap>
            {problemLabel(problem.exception_type)}
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
  onCloseJob,
  onComplete,
  onResolveBarcode,
  onPrintUnitLabels,
  onConfirmUnitLabelsPrinted,
  onRefresh,
  onExecutionFocusChange,
}: ReceiveSessionPageProps) {
  const poDisplay = poNumber == null ? 'PO reference unavailable' : `PO-${poNumber}`;
  const theme = useTheme();
  const scanInputRef = useRef<HTMLInputElement>(null);
  const progressPersistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const progressPersistErrorRef = useRef<Error | null>(null);

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
  const [rejectedByLine, setRejectedByLine] = useState<Record<string, number>>(initialRejected);
  const [completeLines, setCompleteLines] = useState<Set<string>>(initialComplete);
  const [acknowledgedLabelLines, setAcknowledgedLabelLines] = useState<Set<string>>(new Set());
  const [labelHoldLineId, setLabelHoldLineId] = useState<string | null>(firstBackendHold);
  const [labelPrintFailed, setLabelPrintFailed] = useState(false);
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

  const totalExpected = lines.reduce((sum, line) => sum + line.quantity_expected, 0);
  const currentLine = lines[currentIndex] ?? null;

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
  const progress = lines.length ? Math.round((completedCount / lines.length) * 100) : 0;
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
    && !currentComplete;
  const activeAccepted = currentLine ? accepted : 0;
  const activeRejected = currentLine ? rejectedByLine[currentLine.receive_job_line_id] ?? 0 : 0;
  const allLinesDone = lines.length > 0 && lines.every(isLineDone);

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
    if (!onPersistLineProgress || isLineComplete(line)) return progressPersistQueueRef.current;

    progressPersistQueueRef.current = progressPersistQueueRef.current
      .then(async () => {
        await onPersistLineProgress(line.receive_job_line_id, {
          quantity_sellable_provisional: nextAccepted,
          ...(options?.reconciliationRequired ? { reconciliation_required: true } : {}),
        });
        progressPersistErrorRef.current = null;
      })
      .catch((err: any) => {
        const error = err instanceof Error ? err : new Error(err?.message ?? 'Could not save count progress.');
        progressPersistErrorRef.current = error;
      });

    return progressPersistQueueRef.current;
  }, [isLineComplete, onPersistLineProgress]);

  const flushLineProgress = useCallback(async () => {
    await progressPersistQueueRef.current;
    if (progressPersistErrorRef.current) throw progressPersistErrorRef.current;
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

    if (onPrintUnitLabels) {
      try {
        await onPrintUnitLabels(line.receive_job_line_id);
        setLabelPrintFailed(false);
      } catch {
        setLabelPrintFailed(true);
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
    if (!currentLine || currentComplete || currentAwaitingLabel) return;
    try {
      await flushLineProgress();
    } catch (err: any) {
      setSubmitError(err?.message ?? 'Could not save count progress. Please retry.');
      return;
    }
    try {
      await confirmLineCount(currentLine, accepted);
    } catch (err: any) {
      setSubmitError(err?.message ?? 'Could not confirm this count. Your count is kept; retry when ready.');
      return;
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
        await flushLineProgress();
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
  }, [accepted, completeLine, confirmLineCount, currentAwaitingLabel, currentComplete, currentLine, flushLineProgress, persistLineProgress]);

  const handleScan = useCallback(async (value: string) => {
    if (!scanReady || !currentLine || !onResolveBarcode || scanProcessing) return;
    const scannedValue = value.trim();
    if (!scannedValue) return;

    setScanProcessing(true);
    setScanError(null);
    try {
      const resolved = await onResolveBarcode(scannedValue);
      if (!resolved?.lasyncro_variant_id) {
        setScanError(`Barcode not recognised: ${scannedValue}`);
        return;
      }
      if (resolved.lasyncro_variant_id !== currentLine.lasyncro_variant_id) {
        setScanError('That barcode belongs to a different receive line.');
        return;
      }

      const next = activeAccepted + 1;
      if (next > currentLine.quantity_expected && activeAccepted <= currentLine.quantity_expected) {
        setOverDeliveryError(null);
        setOverDeliveryDecision({ line: currentLine, counted: next });
        return;
      }

      void persistLineProgress(currentLine, next);
      setFlashLine(currentLine.receive_job_line_id);
      window.setTimeout(() => setFlashLine(null), 450);
    } catch {
      setScanError('Scan failed. Check the connection and try again.');
    } finally {
      setScanProcessing(false);
      setScanInputValue('');
      if (scanReady) window.setTimeout(() => scanInputRef.current?.focus(), 30);
    }
  }, [
    activeAccepted,
    currentLine,
    onResolveBarcode,
    persistLineProgress,
    scanProcessing,
    scanReady,
  ]);

  // Printing never acknowledges: only the operator's explicit confirmation does.
  const handleRetryPrintLabels = useCallback(async () => {
    if (!activeHoldLineId || !onPrintUnitLabels) return;
    try {
      await onPrintUnitLabels(activeHoldLineId);
      setLabelPrintFailed(false);
    } catch {
      setLabelPrintFailed(true);
    }
  }, [activeHoldLineId, onPrintUnitLabels]);

  const handleConfirmLabelsPrinted = useCallback(async () => {
    if (!activeHoldLineId) return;
    const ackedLineId = activeHoldLineId;
    setLabelAckSubmitting(true);
    setSubmitError(null);
    try {
      await onConfirmUnitLabelsPrinted(ackedLineId);
      setAcknowledgedLabelLines((prev) => new Set([...prev, ackedLineId]));
      setLabelHoldLineId(null);
      setLabelPrintFailed(false);
      moveToNextLineOrReview(undefined, ackedLineId);
    } catch (err: any) {
      setSubmitError(err?.message ?? 'Could not record label acknowledgement. Please retry.');
    } finally {
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
        await flushLineProgress();
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
    if (!overDeliveryDecision) return;
    const { line, counted, approved, countConfirmed } = overDeliveryDecision;
    // GH-1241 S3-A1 — approval follows the persisted physical count; it never
    // confirms a count itself.
    if (!countConfirmed) return;
    const extra = Math.max(0, counted - line.quantity_expected);

    setOverDeliveryError(null);
    setOverDeliverySubmitting(true);
    try {
      await persistLineProgress(line, counted);
      await flushLineProgress();

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
  }, [flushLineProgress, inspectAndResolveReadiness, moveToNextLineOrReview, onApproveOverDelivery, overDeliveryDecision, persistLineProgress]);

  // GH-1241 S3-A1 — the live warning's "keep": the extra stays in the draft
  // count (a scan has not drafted it yet) and the operator continues to
  // Finish Count, which confirms the physical count before any approval.
  const handleKeepOverCount = useCallback(() => {
    if (!overDeliveryDecision || overDeliveryDecision.countConfirmed) return;
    void persistLineProgress(overDeliveryDecision.line, overDeliveryDecision.counted);
    setOverDeliveryError(null);
    setOverDeliveryDecision(null);
  }, [overDeliveryDecision, persistLineProgress]);

  const handleRejectOverDelivery = useCallback(() => {
    if (!overDeliveryDecision) return;
    void persistLineProgress(overDeliveryDecision.line, overDeliveryDecision.line.quantity_expected);
    setOverDeliveryError(null);
    setOverDeliveryDecision(null);
  }, [overDeliveryDecision, persistLineProgress]);

  const handleReportOverDelivery = useCallback(() => {
    if (!overDeliveryDecision) return;
    const extra = Math.max(1, overDeliveryDecision.counted - overDeliveryDecision.line.quantity_expected);
    void persistLineProgress(overDeliveryDecision.line, overDeliveryDecision.line.quantity_expected);
    setOverDeliveryError(null);
    setOverDeliveryDecision(null);
    openProblemDialog({
      choice: 'extra_item',
      qty: String(extra),
      notes: `${extra} extra unit${extra === 1 ? '' : 's'} found during receive`,
    });
  }, [openProblemDialog, overDeliveryDecision, persistLineProgress]);

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

  const handleCloseJob = useCallback(async () => {
    if (!deliveryDate.trim()) {
      setSubmitError('Actual delivery date is required before closing this receive.');
      return;
    }

    setClosing(true);
    setSubmitError(null);
    try {
      await onCloseJob({ actual_delivery_date: deliveryDate });
      await onRefresh?.();
      setSessionPhase('handoff');
    } catch (err: any) {
      const refusal = String(err?.response?.data?.error ?? err?.message ?? '');
      // GH-1241 S3C-M4 — an unanswered close, or "Already closed", may mean the
      // Receive did close: re-read it. Only a canonically closed job reaches the
      // handoff (the session re-renders closed); anything else stays this error.
      if (!err?.response || /already closed/i.test(refusal)) {
        try {
          await onRefresh?.();
        } catch {
          // The refusal below stays visible; a later retry re-reads again.
        }
      }
      setSubmitError(refusal || 'Could not close receive. Nothing was changed; retry when ready.');
    } finally {
      setClosing(false);
    }
  }, [deliveryDate, onCloseJob, onRefresh]);

  const WorkNote = () => {
    const item = currentLine ? lineName(currentLine) : `${lines.length} lines`;
    const identity = currentLine
      ? currentLine.barcode?.trim() || currentLine.sku || currentLine.lasyncro_variant_id || currentLine.receive_job_line_id
      : receiveJobId;
    const action = sessionPhase === 'brief'
      ? 'Brief'
      : sessionPhase === 'review'
        ? 'Review'
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
            ? 'account shortfall'
            : currentAwaitingLabel
              ? 'attach LSU labels'
              : lineAction === 'scan'
                ? 'scan or count locally'
                : 'finish count';

    const workNoteFields = sessionPhase === 'handoff'
      ? [
          ['Action', action],
          ['Status', 'CLOSED'],
          ['Closed at', formatOpsTimestamp(closedAt)],
          ['Actual delivery', formatOpsDate(actualDeliveryDate)],
          ['Reference', poDisplay],
          ['Item', item],
          ['Qty', quantity],
          ['Supplier', supplierName],
          ['Identity', identity],
          ['Next', nextStep],
        ]
      : [
          ['Action', action],
          ['Reference', poDisplay],
          ['Item', item],
          ['Qty', quantity],
          ['Supplier', supplierName],
          ['Identity', identity],
          ['Next', nextStep],
        ];

    return (
      <Paper
        variant="outlined"
        sx={{
          px: 2,
          py: 1.25,
          borderRadius: '6px',
          bgcolor: 'background.paper',
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr 1fr',
            md: sessionPhase === 'handoff'
              ? 'repeat(5, minmax(0, 1fr))'
              : 'repeat(4, minmax(0, 1fr))',
          },
          gap: 1,
        }}
      >
        {workNoteFields.map(([label, value]) => (
          <Box key={label} sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, textTransform: 'uppercase' }}>
              {label}
            </Typography>
            <Typography
              variant="body2"
              noWrap
              sx={{ ...(label === 'Item' || label === 'Supplier' ? {} : monoSx), fontWeight: 650 }}
            >
              {value}
            </Typography>
          </Box>
        ))}
      </Paper>
    );
  };

  const LineMedia = ({ line, size = 44 }: { line: ReceiveJobLine; size?: number }) => (
    line.image_url ? (
      <Box component="img" src={line.image_url} alt="" sx={{ width: size, height: size, objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
    ) : (
      <Box sx={{ width: size, height: size, borderRadius: '4px', bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Package size={Math.max(16, size / 2.5)} style={{ opacity: 0.4 }} />
      </Box>
    )
  );

  const renderBrief = () => (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box>
        <Typography variant="h5" fontWeight={750}>Receive from {supplierName}</Typography>
        <Typography variant="body2" color="text.secondary">
          <Box component="span" sx={monoSx}>{poDisplay}</Box> · Receive <Box component="span" sx={monoSx}>{receiveJobId}</Box>
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ borderRadius: '6px', overflow: 'hidden' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Product + variant</TableCell>
              <TableCell align="right">Expected</TableCell>
              <TableCell align="right">Already received</TableCell>
              <TableCell align="right">Remaining</TableCell>
              <TableCell>Barcode state</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((line) => {
              const acceptedQty = acceptedByLine[line.receive_job_line_id] ?? Number(line.quantity_accepted ?? 0);
              const remainingQty = Math.max(0, line.quantity_expected - acceptedQty);
              const awaiting = isLineAwaitingLabel(line);
              const complete = isLineComplete(line);
              return (
                <TableRow key={line.receive_job_line_id}>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', minWidth: 0 }}>
                      <LineMedia line={line} size={36} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={650} noWrap>{lineName(line)}</Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {variantName(line)}
                          {line.sku ? <> · <Box component="span" sx={monoSx}>{line.sku}</Box></> : null}
                        </Typography>
                        <ReportedProblemSummary line={line} compact />
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell align="right" sx={monoSx}>{line.quantity_expected}</TableCell>
                  <TableCell align="right" sx={monoSx}>{acceptedQty}</TableCell>
                  <TableCell align="right" sx={monoSx}>{remainingQty}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={hasExternalBarcode(line) ? `barcode ${line.barcode}` : awaiting ? 'LSU label hold' : 'barcode-less: LSU labels after count'}
                      color={awaiting ? 'warning' : complete ? 'success' : hasExternalBarcode(line) ? 'primary' : 'default'}
                      variant={complete || awaiting ? 'filled' : 'outlined'}
                      sx={{ maxWidth: 240, '& .MuiChip-label': { ...monoSx, overflow: 'hidden', textOverflow: 'ellipsis' } }}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>

      {claimError && (
        <Alert severity="error">
          {claimError}
        </Alert>
      )}

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

      <Alert severity="info">
        Barcode-capable lines can scan continuously or be counted locally. Barcode-less lines are counted, then held until LSU labels are printed and attached.
      </Alert>

      {!blockedLifecycle && (requiresClaim || !hasCanonicalJobStatus) && (
        <Button
          variant="contained"
          size="large"
          onClick={handleStart}
          disabled={claiming}
          sx={{ justifySelf: 'start', bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, borderRadius: '6px', fontWeight: 700 }}
        >
          {claiming
            ? 'Claiming…'
            : requiresClaim
              ? 'Claim & Start Receive'
              : 'Start Receive'}
        </Button>
      )}
    </Box>
  );

  const renderLineRail = () => (
    <Paper variant="outlined" sx={{ borderRadius: '6px', overflow: 'hidden' }}>
      {lines.map((line, index) => {
        const complete = isLineComplete(line);
        const awaiting = isLineAwaitingLabel(line);
        const done = isLineDone(line);
        return (
          <Box
            key={line.receive_job_line_id}
            component="button"
            disabled={done}
            onClick={() => setCurrentIndex(index)}
            sx={{
              width: '100%',
              display: 'grid',
              gridTemplateColumns: 'auto minmax(0,1fr) auto',
              gap: 1,
              alignItems: 'center',
              p: 1.25,
              border: 0,
              borderBottom: index === lines.length - 1 ? 0 : '1px solid',
              borderColor: 'divider',
              bgcolor: currentIndex === index ? 'var(--accent-ghost)' : 'transparent',
              color: 'text.primary',
              textAlign: 'left',
              cursor: done ? 'not-allowed' : 'pointer',
              opacity: done ? 0.58 : 1,
            }}
          >
            {done ? <CheckCircle size={16} color={theme.palette.success.main} /> : awaiting ? <AlertTriangle size={16} color={theme.palette.warning.main} /> : <Hash size={16} />}
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" fontWeight={650} noWrap>{lineName(line)}</Typography>
              <Typography variant="caption" color="text.secondary" noWrap sx={monoSx}>
                {line.sku ?? line.receive_job_line_id}
              </Typography>
              <ReportedProblemSummary line={line} compact />
            </Box>
            <Chip size="small" label={statusLabel(line, awaiting, complete)} variant="outlined" sx={{ '& .MuiChip-label': monoSx }} />
          </Box>
        );
      })}
    </Paper>
  );

  const renderInspect = () => {
    if (!currentLine) return null;
    const remaining = Math.max(0, currentLine.quantity_expected - activeAccepted);
    const extra = Math.max(0, activeAccepted - currentLine.quantity_expected);

    return (
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '320px minmax(0,1fr) 320px' },
          gap: 2,
          alignItems: 'stretch',
        }}
      >
        {renderLineRail()}

        <Paper
          variant="outlined"
          sx={{
            borderRadius: '6px',
            p: 2.25,
            bgcolor: flashLine === currentLine.receive_job_line_id ? 'rgba(34,197,94,0.10)' : 'background.paper',
            transition: 'background-color 180ms ease',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 320,
          }}
        >
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1, mb: 2 }}>
            {currentLine.sku && (
              <Chip
                size="small"
                label={`SKU ${currentLine.sku}`}
                sx={{ width: '100%', '& .MuiChip-label': monoSx }}
              />
            )}
            <Chip
              size="small"
              label={`Expected ${currentLine.quantity_expected}`}
              sx={{ width: '100%', '& .MuiChip-label': monoSx }}
            />
            <Chip
              size="small"
              label={`Remaining ${remaining}`}
              color={remaining === 0 ? 'success' : 'default'}
              sx={{ width: '100%', '& .MuiChip-label': monoSx }}
            />
          </Box>

          <ReportedProblemSummary line={currentLine} />

          {submitError && <Alert severity="error" sx={{ mb: 2 }}>{submitError}</Alert>}

          {currentAwaitingLabel ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 2 }}>
              <Box>
                <Typography variant="subtitle1" fontWeight={750}>
                  Attach a label to each unit
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {activeAccepted} unit labels were created for {variantName(currentLine)}.
                  Attach one label to each unit before moving them to Stow.
                </Typography>
              </Box>

              {!labelPrintFailed && onPrintUnitLabels && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => void handleRetryPrintLabels()}
                  sx={{ alignSelf: 'flex-start', borderRadius: '6px', fontWeight: 650 }}
                >
                  Print labels
                </Button>
              )}

              {labelPrintFailed && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" color="warning.main">
                    Labels could not be printed.
                  </Typography>
                  {onPrintUnitLabels && (
                    <Button
                      variant="outlined"
                      color="warning"
                      size="small"
                      onClick={() => void handleRetryPrintLabels()}
                      sx={{ borderRadius: '6px', fontWeight: 650 }}
                    >
                      Reprint labels
                    </Button>
                  )}
                </Box>
              )}

              <Button
                data-testid="confirm-unit-labels-printed"
                variant="contained"
                disabled={labelAckSubmitting}
                onClick={() => void handleConfirmLabelsPrinted()}
                startIcon={<CheckCircle size={16} />}
                sx={{
                  width: '100%',
                  minHeight: 36,
                  mt: 'auto',
                  bgcolor: 'var(--accent)',
                  '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                  borderRadius: '6px',
                  fontWeight: 700,
                }}
              >
                {labelAckSubmitting ? 'Confirming...' : `All ${activeAccepted} labels are attached`}
              </Button>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 2 }}>
              {currentCanScan && (
                <Box sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'center' }}>
                  <Button
                    variant={lineAction === 'scan' ? 'contained' : 'outlined'}
                    size="small"
                    startIcon={<ScanBarcode size={14} />}
                    onClick={() => setLineAction('scan')}
                    sx={{ borderRadius: '6px', fontWeight: 650 }}
                  >
                    Scan
                  </Button>
                  <Button
                    variant={lineAction === 'count' ? 'contained' : 'outlined'}
                    size="small"
                    startIcon={<Hash size={14} />}
                    onClick={() => {
                      setLineAction('count');
                      void persistLineProgress(currentLine, accepted);
                    }}
                    sx={{ borderRadius: '6px', fontWeight: 650 }}
                  >
                    Count
                  </Button>
                </Box>
              )}

              {lineAction === 'scan' && currentCanScan ? (
                <Box sx={{ display: 'grid', gap: 1 }}>
                  <TextField
                    inputRef={scanInputRef}
                    size="small"
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
                    helperText={scanProcessing ? 'Processing scan...' : 'Scanner-ready: scan, process, clear, refocus'}
                    autoComplete="off"
                    inputProps={{ style: monoSx }}
                  />
                  {scanError && <Alert severity="error" onClose={() => setScanError(null)}>{scanError}</Alert>}
                </Box>
              ) : (
                <Box sx={{ width: '100%', my: 'auto' }}>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                      gap: 1,
                    }}
                  >
                    <Button
                      variant="outlined"
                      onClick={() => {
                        const next = Math.max(0, accepted - 1);
                        void persistLineProgress(currentLine, next);
                      }}
                      disabled={accepted <= 0 || currentComplete}
                      sx={countStepperButtonSx()}
                    >
                      −
                    </Button>

                    <TextField
                      size="small"
                      value={accepted}
                      disabled={currentComplete}
                      onChange={(event) => {
                        const next = Number.parseInt(event.target.value, 10);
                        if (Number.isNaN(next) || next < 0) return;
                        const crossedExpected = accepted <= currentLine.quantity_expected;
                        void persistLineProgress(currentLine, next);
                        if (next > currentLine.quantity_expected && crossedExpected) {
                          setOverDeliveryError(null);
                          setOverDeliveryDecision({ line: currentLine, counted: next });
                          return;
                        }
                      }}
                      inputProps={{
                        min: 0,
                        style: { ...monoSx, textAlign: 'center', fontWeight: 800 },
                      }}
                      sx={countStepperValueSx}
                    />

                    <Button
                      variant="outlined"
                      onClick={() => {
                        const next = accepted + 1;
                        void persistLineProgress(currentLine, next);
                        if (accepted === currentLine.quantity_expected) {
                          setOverDeliveryError(null);
                          setOverDeliveryDecision({ line: currentLine, counted: next });
                          return;
                        }
                      }}
                      disabled={currentComplete}
                      sx={countStepperButtonSx(true)}
                    >
                      +
                    </Button>

                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => void persistLineProgress(currentLine, currentLine.quantity_expected)}
                      disabled={currentComplete}
                      sx={{
                        minWidth: 0,
                        height: 40,
                        gridColumn: 2,
                        borderRadius: '6px',
                        fontWeight: 650,
                      }}
                    >
                      ALL {currentLine.quantity_expected}
                    </Button>
                  </Box>

                  <Box sx={{ mt: 1.5 }}>
                    <Box
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        mb: 0.75,
                      }}
                    >
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 650 }}>
                        COUNTED
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={monoSx}>
                        {accepted} / {currentLine.quantity_expected}
                      </Typography>
                    </Box>

                    <Box
                      sx={{
                        height: 4,
                        borderRadius: 999,
                        bgcolor: 'action.hover',
                        overflow: 'hidden',
                      }}
                    >
                      <Box
                        sx={{
                          width: `${Math.min(
                            100,
                            (accepted / Math.max(1, currentLine.quantity_expected)) * 100,
                          )}%`,
                          height: '100%',
                          borderRadius: 999,
                          bgcolor:
                            accepted >= currentLine.quantity_expected
                              ? 'var(--accent)'
                              : 'text.secondary',
                          transition: 'width 180ms ease, background-color 180ms ease',
                        }}
                      />
                    </Box>
                  </Box>
                </Box>
              )}

              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 1, mt: 'auto' }}>
                <Button
                  variant="contained"
                  size="small"
                  aria-label="Finish count Confirm line"
                  disabled={submitting || currentComplete}
                  onClick={() => void handleCountConfirm()}
                  startIcon={<CheckCircle size={16} />}
                  sx={{
                    width: '100%',
                    minHeight: 36,
                    bgcolor: 'var(--accent)',
                    '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                    borderRadius: '6px',
                    fontWeight: 700,
                  }}
                >
                  {submitting ? 'Saving...' : 'Finish count'}
                </Button>
              </Box>
            </Box>
          )}
        </Paper>

        <Paper
          variant="outlined"
          sx={{
            display: { xs: 'none', lg: 'flex' },
            flexDirection: 'column',
            borderRadius: '6px',
            p: 2.25,
            minHeight: 320,
            overflow: 'hidden',
            bgcolor: 'background.paper',
          }}
        >
          <Box>
            <Typography variant="subtitle2" fontWeight={700} noWrap>
              {lineName(currentLine)}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {variantName(currentLine)}
            </Typography>
          </Box>

          <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
            <LineMedia line={currentLine} size={220} />
          </Box>
        </Paper>
      </Box>
    );
  };

  const renderReconciliation = () => {
    if (!reconciliationLine) return renderInspect();
    const { line, accepted: sellable, totalShortfall, remainingShortfall, allocations } = reconciliationLine;
    const accounted = totalShortfall - remainingShortfall;
    const selectedChoice = RECONCILIATION_CHOICES.find((choice) => choice.type === shortfallProblemType);

    return (
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '320px minmax(0,1fr) 320px' },
          gap: 2,
          alignItems: 'stretch',
        }}
      >
        {renderLineRail()}

        <Paper
          variant="outlined"
          sx={{
            borderRadius: '6px',
            p: 2.25,
            bgcolor: 'background.paper',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 420,
            gap: 1.5,
          }}
        >
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }}>
            {[
              ['Expected', line.quantity_expected],
              ['Sellable', sellable],
              ['To account for', remainingShortfall],
            ].map(([label, value]) => (
              <Paper key={label} variant="outlined" sx={{ p: 1.25, borderRadius: '6px', minHeight: 70 }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase' }}>
                  {label}
                </Typography>
                <Typography variant="h6" sx={monoSx} fontWeight={800}>
                  {value}
                </Typography>
              </Paper>
            ))}
          </Box>

          <Typography variant="body2" color="text.secondary" sx={{ mt: -0.25 }}>
            Account for the remaining {remainingShortfall} units before finishing this line.
          </Typography>

          {submitError && <Alert severity="error">{submitError}</Alert>}

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 0.875 }}>
            {RECONCILIATION_CHOICES.map((choice) => {
              const selected = shortfallProblemType === choice.type;
              const isOther = choice.type === 'other';
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
                  sx={{
                    ...reconciliationChoiceSx(selected),
                    gridColumn: { xs: '1', sm: isOther ? '1 / -1' : 'auto' },
                  }}
                  style={isOther ? { gridColumn: '1 / -1' } : undefined}
                >
                  {selected && (
                    <CheckCircle
                      size={14}
                      aria-hidden="true"
                      style={{ marginRight: 8, flexShrink: 0 }}
                    />
                  )}
                  {choice.label}
                </Button>
              );
            })}
          </Box>

          {shortfallProblemType && remainingShortfall > 0 && (
            <Box sx={{ display: 'grid', gap: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                Qty affected
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr) 44px', gap: 1, alignItems: 'center' }}>
                <Button
                  variant="outlined"
                  color="inherit"
                  disabled={shortfallSubmitting}
                  onClick={() => {
                    const current = Number.parseInt(shortfallProblemQty, 10) || 1;
                    setShortfallProblemQty(String(Math.max(1, current - 1)));
                  }}
                  sx={countStepperButtonSx()}
                >
                  −
                </Button>
                <TextField
                  type="number"
                  size="small"
                  value={shortfallProblemQty}
                  onChange={(event) => {
                    setShortfallProblemQty(event.target.value);
                    setShortfallQtyError(null);
                  }}
                  error={!!shortfallQtyError}
                  helperText={shortfallQtyError ?? undefined}
                  inputProps={{
                    min: 1,
                    max: remainingShortfall,
                    'aria-label': 'Qty affected',
                    style: { ...monoSx, textAlign: 'center' },
                  }}
                  sx={countStepperValueSx}
                />
                <Button
                  variant="outlined"
                  color="inherit"
                  disabled={shortfallSubmitting}
                  onClick={() => {
                    const current = Number.parseInt(shortfallProblemQty, 10) || 1;
                    setShortfallProblemQty(String(Math.min(remainingShortfall, current + 1)));
                  }}
                  sx={countStepperButtonSx(true)}
                >
                  +
                </Button>
              </Box>

              {selectedChoice?.requiresNotes && (
                <TextField
                  label="Notes"
                  size="small"
                  value={shortfallProblemNotes}
                  onChange={(event) => setShortfallProblemNotes(event.target.value)}
                  required
                  multiline
                  rows={2}
                />
              )}

              <Button
                variant="contained"
                color="inherit"
                disabled={shortfallSubmitting || !shortfallProblemType}
                onClick={() => void handleReconciliationAllocation()}
                sx={reconciliationCommitActionSx}
              >
                {shortfallSubmitting ? 'Adding...' : 'Add to reconciliation'}
              </Button>
            </Box>
          )}

          <Box sx={{ mt: 'auto', display: 'grid', gap: 0.75 }}>
            <Typography variant="subtitle2" fontWeight={750}>
              Accounted
            </Typography>
            {allocations.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No allocations yet.
              </Typography>
            ) : (
              <Box sx={{ display: 'grid', gap: 0.75 }}>
                {allocations.map((allocation, index) => (
                  <Box
                    key={`${allocation.type}-${index}`}
                    sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, borderBottom: '1px solid', borderColor: 'divider', pb: 0.75 }}
                  >
                    <Typography variant="body2">{problemLabel(allocation.type)}</Typography>
                    <Typography variant="body2" sx={monoSx}>{unitLabel(allocation.quantity)}</Typography>
                  </Box>
                ))}
              </Box>
            )}
            <Typography variant="body2" sx={monoSx}>
              Accounted {accounted} / {totalShortfall}
            </Typography>
            <Typography variant="body2" sx={monoSx}>
              To account for {remainingShortfall}
            </Typography>
            <Button
              variant="contained"
              disabled={remainingShortfall > 0 || submitting}
              onClick={() => void handleFinishReconciledLine()}
              sx={{
                mt: 0.5,
                width: '100%',
                minHeight: 36,
                bgcolor: 'var(--accent)',
                '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                borderRadius: '6px',
                fontWeight: 700,
              }}
            >
              {submitting ? 'Finishing...' : 'Finish line'}
            </Button>
            {allocations.length === 0 && (
              <Button
                color="inherit"
                disabled={shortfallSubmitting || submitting}
                onClick={() => void handleReconciliationMiscount()}
                sx={{ borderRadius: '6px', fontWeight: 650 }}
              >
                I miscounted
              </Button>
            )}
          </Box>
        </Paper>

        <Paper
          variant="outlined"
          sx={{
            display: { xs: 'none', lg: 'flex' },
            flexDirection: 'column',
            borderRadius: '6px',
            p: 2.25,
            minHeight: 420,
            overflow: 'hidden',
            bgcolor: 'background.paper',
          }}
        >
          <Box>
            <Typography variant="subtitle2" fontWeight={700} noWrap>
              {lineName(line)}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {variantName(line)}
            </Typography>
          </Box>

          <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
            <LineMedia line={line} size={220} />
          </Box>
        </Paper>
      </Box>
    );
  };

  const renderReview = () => {
    const totalAccepted = lines.reduce((sum, line) => sum + (acceptedByLine[line.receive_job_line_id] ?? Number(line.quantity_accepted ?? 0)), 0);
    const totalProblems = lines.reduce((sum, line) => sum + reportedProblems(line).length, 0);
    const totalExtra = lines.reduce((sum, line) => {
      const acceptedQty = acceptedByLine[line.receive_job_line_id] ?? Number(line.quantity_accepted ?? 0);
      return sum + Math.max(0, acceptedQty - line.quantity_expected);
    }, 0);

    return (
      <Box sx={{ display: 'grid', gap: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={750}>Review receive</Typography>
          <Typography variant="body2" color="text.secondary">
            Count and scan paths converge here before closing.
          </Typography>
        </Box>

        {submitError && <Alert severity="error">{submitError}</Alert>}

        <Paper variant="outlined" sx={{ borderRadius: '6px', overflow: 'hidden' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Line</TableCell>
                <TableCell align="right">Expected</TableCell>
                <TableCell align="right">Received</TableCell>
                <TableCell align="right">Extra</TableCell>
                <TableCell align="right">Problems</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.map((line) => {
                const acceptedQty = acceptedByLine[line.receive_job_line_id] ?? Number(line.quantity_accepted ?? 0);
                const problemCount = reportedProblems(line).length;
                const extraQty = Math.max(0, acceptedQty - line.quantity_expected);
                const awaiting = isLineAwaitingLabel(line);
                return (
                  <TableRow key={line.receive_job_line_id}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={650}>{lineName(line)}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={monoSx}>{line.sku ?? line.receive_job_line_id}</Typography>
                      <ReportedProblemSummary line={line} compact />
                    </TableCell>
                    <TableCell align="right" sx={monoSx}>{line.quantity_expected}</TableCell>
                    <TableCell align="right" sx={monoSx}>{acceptedQty}</TableCell>
                    <TableCell align="right" sx={{ ...monoSx, color: extraQty > 0 ? 'warning.main' : 'text.primary' }}>{extraQty}</TableCell>
                    <TableCell align="right" sx={monoSx}>{problemCount}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={awaiting ? 'warning' : 'success'}
                        label={awaiting ? 'label hold' : 'ready'}
                        sx={{ '& .MuiChip-label': monoSx }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow>
                <TableCell sx={{ fontWeight: 750 }}>Total</TableCell>
                <TableCell align="right" sx={{ ...monoSx, fontWeight: 750 }}>{totalExpected}</TableCell>
                <TableCell align="right" sx={{ ...monoSx, fontWeight: 750 }}>{totalAccepted}</TableCell>
                <TableCell align="right" sx={{ ...monoSx, fontWeight: 750, color: totalExtra > 0 ? 'warning.main' : 'text.primary' }}>{totalExtra}</TableCell>
                <TableCell align="right" sx={{ ...monoSx, fontWeight: 750 }}>{totalProblems}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </Paper>

        <Paper variant="outlined" sx={{ borderRadius: '6px', p: 2, display: 'grid', gap: 1.5, maxWidth: 420 }}>
          <TextField
            label="Actual delivery date"
            type="date"
            size="small"
            required
            value={deliveryDate}
            onChange={(event) => setDeliveryDate(event.target.value)}
            helperText="Required to close this receive."
            InputLabelProps={{ shrink: true }}
          />
          <Button
            variant="contained"
            disabled={closing || !deliveryDate.trim() || lines.some(isLineAwaitingLabel)}
            onClick={() => void handleCloseJob()}
            sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, borderRadius: '6px', fontWeight: 700 }}
          >
            {closing ? 'Closing receive...' : 'Close receive'}
          </Button>
        </Paper>
      </Box>
    );
  };

  // GH-1241 S3C-M4 — a Receive that accepted nothing creates no Stow work. Any
  // accepted unit, canonical or recorded by this session, keeps the Stow handoff.
  const receivedNothing = lines.every((line) => (
    Number(line.quantity_accepted ?? 0) <= 0
      && Number(acceptedByLine[line.receive_job_line_id] ?? 0) <= 0
  ));
  const renderHandoff = () => (
    <Box sx={{ maxWidth: 560, mx: 'auto', textAlign: 'center', py: 7 }}>
      <CheckCircle size={58} color={theme.palette.success.main} />
      <Typography variant="h4" fontWeight={800} sx={{ mt: 2 }}>Receive complete</Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
        {receivedNothing
          ? 'No usable items received. Nothing to put away.'
          : 'Received units are now available for Stow.'}
      </Typography>
      <Button
        variant="contained"
        // RECEIVE-COMPLETE-EXIT-01 — onComplete is a zero-argument domain
        // callback (exitSession upstream), not a MouseEvent handler. React
        // calls onClick with the SyntheticEvent regardless of the handler's
        // declared arity, so `onClick={onComplete}` forwarded that event as
        // exitSession's optional `finishedLabel: string` argument — a truthy
        // object that then reached onCountFinished/setFinishedCountLabel and
        // crashed WmsOperationsPage trying to render it as a child ("Objects
        // are not valid as a React child"). Call it explicitly instead.
        onClick={() => onComplete()}
        sx={{ mt: 3, bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, borderRadius: '6px', fontWeight: 700 }}
      >
        Back to WMS
      </Button>
    </Box>
  );

  const renderBody = () => {
    if (sessionPhase === 'brief') return renderBrief();
    if (sessionPhase === 'reconcile') return renderReconciliation();
    if (sessionPhase === 'review') return renderReview();
    if (sessionPhase === 'handoff') return renderHandoff();
    return renderInspect();
  };

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        bgcolor: 'background.default',
        color: 'text.primary',
        overflow: 'auto',
      }}
    >
      <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <Box
          component="header"
          sx={{
            px: { xs: 2, md: 3 },
            py: 1.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            position: 'sticky',
            top: 0,
            zIndex: 1,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10 }}>
                Focus receive session
              </Typography>
              <Typography variant="h6" fontWeight={800} noWrap>
                {supplierName}
              </Typography>
            </Box>
            <Chip
              label={`${progress}% complete`}
              color={progress === 100 ? 'success' : 'default'}
              sx={{ '& .MuiChip-label': monoSx }}
            />
          </Box>
          <LinearProgress variant="determinate" value={progress} sx={{ height: 5, borderRadius: 1, mb: 1.25 }} />
          <WorkNote />
        </Box>

        <Box component="main" sx={{ width: '100%', maxWidth: 1180, mx: 'auto', p: { xs: 2, md: 3 }, flex: 1 }}>
          {renderBody()}
        </Box>
      </Box>

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
              I miscounted
            </Button>
          )}
          <Button
            variant="contained"
            disabled={!shortfallProblemType || shortfallSubmitting}
            onClick={() => void handleShortfallConfirm()}
            sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, borderRadius: '6px', fontWeight: 700 }}
          >
            {shortfallSubmitting ? 'Saving...' : 'Save problem'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!overDeliveryDecision} fullWidth maxWidth="sm">
        <DialogTitle>Extra unit detected</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 1.5, pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Decide what to do with the overage before this line can continue.
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 1,
              }}
            >
              {[
                ['Expected', overDeliveryDecision?.line.quantity_expected ?? 0],
                ['Counted', overDeliveryDecision?.counted ?? 0],
                ['Extra', Math.max(0, (overDeliveryDecision?.counted ?? 0) - (overDeliveryDecision?.line.quantity_expected ?? 0))],
              ].map(([label, value]) => (
                <Paper key={label} variant="outlined" sx={{ p: 1.25, borderRadius: '6px' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase' }}>
                    {label}
                  </Typography>
                  <Typography variant="h6" sx={monoSx} fontWeight={800}>
                    {value}
                  </Typography>
                </Paper>
              ))}
            </Box>
            {!overDeliveryDecision?.countConfirmed && (
              <Typography variant="body2" color="text.secondary">
                Keep counting, then Finish Count to confirm your physical count before approving the extra.
              </Typography>
            )}
            {overDeliveryError && <Alert severity="error">{overDeliveryError}</Alert>}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleRejectOverDelivery} color="inherit" disabled={overDeliverySubmitting}>Do not receive extra</Button>
          <Button onClick={handleReportOverDelivery} color="warning" disabled={overDeliverySubmitting}>Report problem</Button>
          {overDeliveryDecision?.countConfirmed ? (
            <Button
              variant="contained"
              color="warning"
              disabled={overDeliverySubmitting}
              onClick={() => void handleAcceptOverDelivery()}
            >
              {overDeliverySubmitting
                ? 'Approving...'
                : `Accept extra unit${Math.max(0, (overDeliveryDecision?.counted ?? 0) - (overDeliveryDecision?.line.quantity_expected ?? 0)) === 1 ? '' : 's'}`}
            </Button>
          ) : (
            <Button variant="contained" color="warning" onClick={handleKeepOverCount}>
              Keep extra in count
            </Button>
          )}
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
              '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
              borderRadius: '6px',
              fontWeight: 700,
            }}
          >
            {problemSubmitting ? 'Saving...' : 'Report problem'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
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
  message,
  children,
}: {
  props: ReceiveSessionPageProps;
  severity: 'info' | 'error' | null;
  title: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <Box sx={{ display: 'grid', gap: 2, p: { xs: 2, md: 3 }, maxWidth: 880 }}>
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 750 }}>{title}</Typography>
        <Typography variant="body2" color="text.secondary">
          {props.supplierName}
          {props.poNumber != null ? <> · <Box component="span" sx={monoSx}>PO-{props.poNumber}</Box></> : null}
        </Typography>
      </Box>
      {severity ? <Alert severity={severity}>{message}</Alert> : <Typography variant="body2">{message}</Typography>}
      {children}
      <Box>
        <Button variant="outlined" onClick={props.onComplete} sx={{ borderRadius: '6px' }}>
          Back to WMS
        </Button>
      </Box>
    </Box>
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
type ReviewDecision = { missing: number; later: number; damaged: number; basisCount: number };

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
        .map((exception) => ({
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
          setMessage({
            severity: 'error',
            text: `Couldn't save the count for ${line ? lineName(line) : 'this product'}. Check the connection, then save again.`,
            retryLineId: lineId,
          });
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
    await saveQueueRef.current;
    if (confirmInFlightRef.current) await confirmInFlightRef.current.catch(() => undefined);
    if (submitInFlightRef.current) await submitInFlightRef.current.catch(() => undefined);
    if (!mountedRef.current) return;
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
    onComplete();
  }, [exiting, lineById, onComplete]);

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
    const defectEvidence = problems.filter((problem) => problem.exception_type === 'defect');
    const recordedDamaged = defectEvidence.reduce((sum, problem) => sum + Number(problem.quantity_affected ?? 0), 0);
    // Rejection evidence this review cannot express (wrong item/variant) is ambiguous: fail closed.
    const unsupportedEvidence = problems.some((problem) =>
      problem.exception_type === 'wrong_item' || problem.exception_type === 'wrong_variant');
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
        ? { missing: Number(savedLine.quantity_missing), later: Number(savedLine.quantity_deferred), damaged: Number(savedLine.quantity_rejected), basisCount: count }
        : { missing: recordedMissing, later: 0, damaged: recordedDamaged, basisCount: count });
    const assigned = decision.missing + decision.later + decision.damaged;
    const settled = !unsupportedEvidence && (difference < 0
      ? assigned === shortfall && decision.missing >= recordedMissing && decision.damaged >= recordedDamaged
      : recordedMissing === 0 && recordedDamaged === 0 && (difference === 0 || approved >= extra));
    // Recorded evidence that cannot fit this difference needs a lead, not a guess.
    const evidenceExceedsDifference = recordedMissing + recordedDamaged > shortfall;
    const missing = difference < 0 ? decision.missing : 0;
    const damaged = difference < 0 ? decision.damaged : 0;
    const later = difference < 0 ? decision.later : 0;
    const newMissing = missing - recordedMissing;
    const newDamaged = damaged - recordedDamaged;
    const payload: ReceiveReconciliationLinePayload = {
      receive_job_line_id: lineId,
      quantity_accepted: count,
      quantity_rejected: damaged,
      quantity_missing: missing,
      quantity_deferred: later,
      quantity_held_recoverable: 0,
      new_exceptions: [
        ...(newDamaged > 0 ? [{ exception_type: 'defect', quantity_affected: newDamaged, accounting_role: 'shortfall', notes: null }] : []),
        ...(newMissing > 0 ? [{ exception_type: 'missing_item', quantity_affected: newMissing, accounting_role: 'shortfall', notes: null }] : []),
      ],
      existing_exception_ids: [...missingEvidence, ...defectEvidence].map((problem) => problem.receive_exception_id),
    };
    return {
      lineId, line, count, expected, difference, shortfall, extra, approved, recordedMissing, recordedDamaged,
      unsupportedEvidence, evidenceExceedsDifference, countChanged, decision, assigned, settled, payload,
    };
  };
  type ReviewModel = ReturnType<typeof reviewLine>;

  const setDecisionField = (model: ReviewModel, field: 'missing' | 'later' | 'damaged', raw: string) => {
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
    <Button variant="outlined" onClick={() => void handleExit()} disabled={exiting} sx={{ borderRadius: '6px', flexShrink: 0 }}>
      Back to WMS
    </Button>
  );
  const identity = (
    <Typography variant="body2" color="text.secondary">
      {props.supplierName}
      {props.poNumber != null ? <> · <Box component="span" sx={monoSx}>PO-{props.poNumber}</Box></> : null}
    </Typography>
  );
  const messageNode = message ? (
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
      <Box sx={{ display: 'grid', gap: 2, p: { xs: 2, md: 3 }, maxWidth: 640 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 750 }}>Receive</Typography>
            {identity}
          </Box>
          {backButton}
        </Box>
        <Paper variant="outlined" sx={{ borderRadius: '10px', p: 2, display: 'grid', gap: 1.5 }}>
          <Typography variant="body1" sx={{ fontWeight: 600, color: 'var(--ink)' }}>
            {`${total} ${total === 1 ? 'product' : 'products'} · ${totalUnits} ${totalUnits === 1 ? 'unit' : 'units'} expected`}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Count good, usable units only. Set damaged items aside — you'll record them when you review.
          </Typography>
          <Box>
            <Button variant="contained" disableElevation onClick={() => void handleStart()} disabled={claiming} sx={{ borderRadius: '6px', fontWeight: 700 }}>
              {claiming ? 'Starting…' : 'Start receiving'}
            </Button>
          </Box>
        </Paper>
        {messageNode}
      </Box>
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

  return (
    <Box sx={{
      display: 'grid',
      gridTemplateRows: 'auto auto auto minmax(0, 1fr)',
      gap: 1.5,
      p: { xs: 2, md: 3 },
      height: { md: 'calc(100vh - 32px)' },
      maxWidth: 1280,
      minHeight: 0,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, minWidth: 0 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 750 }}>Receive</Typography>
          {identity}
        </Box>
        <Box sx={{ flex: 1, maxWidth: 320, display: 'grid', gap: 0.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--ink-2)' }}>
            {`${countedTotal} of ${total} products counted`}
          </Typography>
          <LinearProgress variant="determinate" value={total ? (countedTotal / total) * 100 : 0} />
        </Box>
        {backButton}
      </Box>

      <Box sx={{ display: 'grid', gap: 0.5 }}>
        {!showReview && (
          <>
            <TextField
              inputRef={scanInputRef}
              size="small"
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
              inputProps={{ style: monoSx, 'aria-label': 'Scan barcode' }}
            />
            <Typography variant="caption" color="text.secondary">
              Count good, usable units only. Set damaged items aside — you'll record them in review.
            </Typography>
          </>
        )}
      </Box>

      <Box sx={{ display: 'grid', gap: 1 }}>
        {messageNode}
        {allCounted && !showReview && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--ink)' }}>
              All products counted
            </Typography>
            <Button
              variant="contained"
              disableElevation
              size="small"
              onClick={() => { setMessage(null); setReviewing(true); }}
              sx={{ borderRadius: '6px', fontWeight: 700 }}
            >
              Review and finish
            </Button>
          </Box>
        )}
      </Box>

      {showReview ? (
        <Paper
          variant="outlined"
          data-testid="receive-review"
          sx={{ borderRadius: '10px', p: 2.5, display: 'grid', gap: 1.5, alignContent: 'start', minHeight: 0, overflowY: 'auto' }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Check differences</Typography>
              <Typography variant="body2" color="text.secondary">
                {differing.length === 0
                  ? 'Every product matches what was expected.'
                  : 'Tell us what happened to each difference. Counted means good, usable units.'}
              </Typography>
            </Box>
            <Button variant="text" onClick={() => setReviewing(false)} disabled={submitting} sx={{ flexShrink: 0 }}>
              Back to counting
            </Button>
          </Box>

          {differing.map((model) => {
            const remaining = model.shortfall - model.assigned;
            return (
              <Box
                key={model.lineId}
                data-testid={`receive-review-line-${model.lineId}`}
                data-difference={String(model.difference)}
                data-settled={model.settled ? 'true' : 'false'}
                sx={{ border: '1px solid var(--rule)', borderRadius: '8px', p: 1.5, display: 'grid', gap: 1 }}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', overflowWrap: 'anywhere' }}>
                      {lineName(model.line)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {`Expected ${model.expected} · Counted ${model.count}`}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.75, flexShrink: 0 }}>
                    {model.countChanged && <Chip size="small" color="warning" label="Count changed" />}
                    <Chip
                      size="small"
                      label={model.difference < 0 ? `${model.shortfall} short` : model.difference > 0 ? `${model.extra} extra` : 'Matches'}
                    />
                  </Box>
                </Box>

                {model.difference < 0 && (
                  <>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {(['missing', 'later', 'damaged'] as const).map((field) => (
                        <TextField
                          key={field}
                          label={field === 'missing' ? 'Missing' : field === 'later' ? 'Coming later' : 'Damaged'}
                          type="number"
                          size="small"
                          value={String(model.decision[field])}
                          disabled={submitting}
                          onChange={(event) => setDecisionField(model, field, event.target.value)}
                          inputProps={{
                            min: field === 'missing' ? model.recordedMissing : field === 'damaged' ? model.recordedDamaged : 0,
                            inputMode: 'numeric',
                            style: monoSx,
                          }}
                          sx={{ width: 140 }}
                        />
                      ))}
                    </Box>
                    <Typography variant="caption" sx={{ color: model.settled ? 'var(--ink-3)' : 'var(--ink-2)' }}>
                      {model.unsupportedEvidence
                        ? 'A wrong item was recorded for this product. Ask a lead to review it before finishing.'
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
                    </Typography>
                  </>
                )}

                {model.difference > 0 && (model.approved >= model.extra ? (
                  <Typography variant="body2" sx={{ color: 'var(--ink-2)' }}>
                    {`${model.extra} extra kept — received into stock when this Receive closes.`}
                  </Typography>
                ) : (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                    <Button
                      variant="outlined"
                      size="small"
                      disabled={keepingExtraId != null || submitting}
                      onClick={() => void keepExtra(model)}
                      sx={{ borderRadius: '6px' }}
                    >
                      Keep extra units
                    </Button>
                    <Typography variant="caption" color="text.secondary">
                      {`The ${model.extra} extra will be received into stock when this Receive closes.`}
                    </Typography>
                  </Box>
                ))}

                <Box>
                  <Button size="small" variant="text" disabled={submitting} onClick={() => editCountFromReview(model.lineId)}>
                    Edit count
                  </Button>
                </Box>
              </Box>
            );
          })}

          {matchingCount > 0 && (
            <Typography variant="body2" color="text.secondary">
              {`${matchingCount} ${matchingCount === 1 ? 'product matches' : 'products match'} what was expected`}
            </Typography>
          )}

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              disableElevation
              disabled={!allSettled || submitting || keepingExtraId != null}
              onClick={() => void submitReview(reviewModels)}
              sx={{ borderRadius: '6px', fontWeight: 700 }}
            >
              {submitting ? 'Saving…' : 'Confirm and continue'}
            </Button>
            <Typography variant="caption" color="text.secondary">
              Next: labels and closing this Receive. Stock is added when it closes.
            </Typography>
          </Box>
        </Paper>
      ) : (
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'minmax(260px, 2fr) 3fr' },
        gap: 2,
        minHeight: 0,
      }}>
        <Paper
          variant="outlined"
          component="ul"
          aria-label="Products on this delivery"
          sx={{ borderRadius: '10px', m: 0, p: 0.5, listStyle: 'none', overflowY: 'auto', minHeight: 0, maxHeight: { xs: 320, md: '100%' } }}
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
                  onClick={() => selectLine(lineId)}
                  sx={{
                    all: 'unset',
                    boxSizing: 'border-box',
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1.5,
                    px: 1.5,
                    py: 1,
                    borderRadius: '8px',
                    cursor: 'pointer',
                    bgcolor: isCurrent ? 'var(--accent-ghost)' : 'transparent',
                    '&:focus-visible': { outline: '2px solid var(--accent)' },
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflowWrap: 'anywhere' }}>
                      {lineName(line)}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', ...monoSx }}>
                      {line.sku ?? '—'}
                    </Typography>
                  </Box>
                  <Typography sx={{
                    fontSize: 12,
                    fontWeight: 600,
                    flexShrink: 0,
                    color: state === 'confirmed' ? 'var(--ink)' : state === 'unconfirmed' ? 'var(--ink-2)' : 'var(--ink-4)',
                  }}>
                    {status}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Paper>

        <Paper
          variant="outlined"
          data-testid="receive-count-current"
          sx={{ borderRadius: '10px', p: 2.5, display: 'grid', gap: 2, alignContent: 'start', minHeight: 0, overflowY: 'auto' }}
        >
          {current ? (
            <>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{lineName(current)}</Typography>
                <Typography variant="body2" color="text.secondary" sx={monoSx}>{current.sku ?? '—'}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Expected <Box component="span" sx={monoSx}>{currentExpected}</Box>
              </Typography>
              <TextField
                inputRef={countInputRef}
                label="Counted"
                type="number"
                value={currentCount == null ? '' : String(currentCount)}
                disabled={currentLocked}
                onChange={(event) => handleTypedCount(current.receive_job_line_id, event.target.value)}
                inputProps={{ min: 0, inputMode: 'numeric', style: { ...monoSx, fontSize: 28 } }}
                sx={{ maxWidth: 240 }}
              />
              {currentCount != null && currentCount !== currentExpected && (
                <Typography variant="body2" sx={{ color: 'var(--ink-2)' }}>
                  {currentCount > currentExpected
                    ? `${currentCount - currentExpected} more than expected`
                    : `${currentExpected - currentCount} fewer than expected`}
                </Typography>
              )}
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {currentLocked ? (
                  <Button
                    variant="outlined"
                    onClick={() => { setEditingId(current.receive_job_line_id); setMessage(null); }}
                    sx={{ borderRadius: '6px' }}
                  >
                    Edit count
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="contained"
                      disableElevation
                      disabled={currentCount == null || confirming}
                      onClick={() => {
                        if (currentCount != null) void confirmCount(current.receive_job_line_id, currentCount);
                      }}
                      sx={{ borderRadius: '6px', fontWeight: 700 }}
                    >
                      {confirming ? 'Confirming…' : 'Confirm count'}
                    </Button>
                    {(currentCount == null || currentCount === 0) && (
                      <Button
                        variant="outlined"
                        disabled={confirming}
                        onClick={() => void confirmCount(current.receive_job_line_id, 0)}
                        sx={{ borderRadius: '6px' }}
                      >
                        None arrived
                      </Button>
                    )}
                  </>
                )}
              </Box>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">Nothing to count on this delivery.</Typography>
          )}
        </Paper>
      </Box>
      )}
    </Box>
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
        <Box sx={{ display: 'grid', gap: 1.5, p: { xs: 2, md: 3 }, maxWidth: 880 }}>
          <Typography variant="body2" color="text.secondary">Checking this Receive…</Typography>
          <LinearProgress />
        </Box>
      </>
    );
  }

  return (
    <>
      {marker}
      <ReceiveSessionNotice
        props={props}
        severity="error"
        title="Receive unavailable"
        message="This Receive can't continue here because its current state couldn't be confirmed. Nothing has been changed. Return to Operations and reopen it, or ask a lead to review it."
      />
    </>
  );
}
