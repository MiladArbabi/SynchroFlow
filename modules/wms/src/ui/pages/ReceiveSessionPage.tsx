// modules/wms/src/ui/pages/ReceiveSessionPage.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

export interface ReceiveJobLine {
  receive_job_line_id: string;
  lasyncro_variant_id: string | null;
  sku: string | null;
  variant_title: string | null;
  description: string | null;
  quantity_expected: number;
  quantity_accepted?: number;
  quantity_rejected?: number;
  quantity_sellable_provisional?: number | null;
  reconciliation_started_at?: string | null;
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
}

export interface ReceiveSessionPageProps {
  receiveJobId: string;
  poId: string;
  supplierName: string;
  closedAt?: string | null;
  actualDeliveryDate?: string | null;
  lines: ReceiveJobLine[];
  onInspectLine: (params: {
    lasyncro_variant_id: string | null;
    receive_job_line_id: string;
    quantity_accepted: number;
    quantity_rejected: number;
  }) => Promise<void>;
  onReportException: (params: {
    lasyncro_variant_id: string | null;
    receive_job_line_id: string;
    exception_type: string;
    quantity_affected: number;
    accounting_role?: string;
    notes?: string;
  }) => Promise<void>;
  onPersistLineProgress?: (
    receiveJobLineId: string,
    params: { quantity_sellable_provisional: number; reconciliation_required?: boolean }
  ) => Promise<void>;
  onCloseJob: (params: { actual_delivery_date?: string }) => Promise<void>;
  onComplete: () => void;
  onResolveBarcode?: (scannedValue: string) => Promise<{ lasyncro_variant_id: string } | null>;
  onPrintUnitLabels?: (receiveJobLineId: string) => Promise<void>;
  onConfirmUnitLabelsPrinted: (receiveJobLineId: string) => Promise<void>;
  onRefresh?: () => Promise<void> | void;
}

type ProblemType = 'defect' | 'packaging_damage' | 'wrong_item' | 'wrong_variant' | 'wrong_quantity' | 'missing_item' | 'extra_item' | 'barcode_mismatch' | 'other';

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

function hasProjectedReconciliation(line: ReceiveJobLine): boolean {
  if (!line.reconciliation) return false;
  return !!line.reconciliation_started_at
    || line.reconciliation.allocations.length > 0
    || line.reconciliation.unaccounted === 0 && line.reconciliation.sellable < line.reconciliation.expected
    || line.reconciliation.sellable < line.reconciliation.expected
      && line.reconciliation.allocations.some((allocation) => allocation.counts_toward_shortfall);
}

function projectedReconciliationState(line: ReceiveJobLine) {
  if (!line.reconciliation) return null;
  const expected = Number(line.reconciliation.expected ?? line.quantity_expected);
  const sellable = Number(line.reconciliation.sellable ?? line.quantity_accepted ?? 0);
  const accounted = Number(line.reconciliation.accounted ?? 0);
  const unaccounted = Number(line.reconciliation.unaccounted ?? Math.max(0, expected - sellable - accounted));
  const totalShortfall = accounted + unaccounted;
  if (totalShortfall <= 0) return null;

  return {
    line,
    accepted: sellable,
    totalShortfall,
    remainingShortfall: unaccounted,
    allocations: line.reconciliation.allocations.map((allocation) => ({
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

export default function ReceiveSessionPage({
  receiveJobId,
  poId,
  supplierName,
  closedAt,
  actualDeliveryDate,
  lines,
  onInspectLine,
  onReportException,
  onPersistLineProgress,
  onCloseJob,
  onComplete,
  onResolveBarcode,
  onPrintUnitLabels,
  onConfirmUnitLabelsPrinted,
  onRefresh,
}: ReceiveSessionPageProps) {
  const theme = useTheme();
  const scanInputRef = useRef<HTMLInputElement>(null);
  const progressPersistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const progressPersistErrorRef = useRef<Error | null>(null);

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

  const [sessionPhase, setSessionPhase] = useState<SessionPhase>(
    closedAt
      ? 'handoff'
      : startsComplete
        ? 'review'
        : firstReconciliationIndex >= 0
          ? 'reconcile'
          : hasResumeState
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
  const [scanInputValue, setScanInputValue] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanProcessing, setScanProcessing] = useState(false);
  const [flashLine, setFlashLine] = useState<string | null>(null);
  const [overDeliveryDecision, setOverDeliveryDecision] = useState<{
    line: ReceiveJobLine;
    counted: number;
  } | null>(null);

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
  ): Promise<{ awaitingLabelAck: boolean }> => {
    await onInspectLine({
      lasyncro_variant_id: line.lasyncro_variant_id,
      receive_job_line_id: line.receive_job_line_id,
      quantity_accepted: quantityAccepted,
      quantity_rejected: quantityRejected,
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

  const handleStart = useCallback(() => {
    const firstOpen = lines.findIndex((line) => !isLineDone(line));
    setCurrentIndex(firstOpen >= 0 ? firstOpen : 0);
    if (firstOpen >= 0) {
      void persistLineProgress(lines[firstOpen], projectedSellable(lines[firstOpen]));
    }
    setSessionPhase(firstOpen >= 0 ? 'inspect' : 'review');
  }, [isLineDone, lines, persistLineProgress]);

  const handleCountConfirm = useCallback(async () => {
    if (!currentLine || currentComplete || currentAwaitingLabel) return;
    try {
      await flushLineProgress();
    } catch (err: any) {
      setSubmitError(err?.message ?? 'Could not save count progress. Please retry.');
      return;
    }
    if (accepted > currentLine.quantity_expected) {
      setOverDeliveryDecision({ line: currentLine, counted: accepted });
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
  }, [accepted, completeLine, currentAwaitingLabel, currentComplete, currentLine, flushLineProgress, persistLineProgress]);

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
      if (next > currentLine.quantity_expected) {
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

  const handleRetryPrintLabels = useCallback(async () => {
    if (!labelHoldLineId || !onPrintUnitLabels) return;
    try {
      await onPrintUnitLabels(labelHoldLineId);
      setLabelPrintFailed(false);
    } catch {
      setLabelPrintFailed(true);
    }
  }, [labelHoldLineId, onPrintUnitLabels]);

  const handleConfirmLabelsPrinted = useCallback(async () => {
    if (!labelHoldLineId) return;
    setLabelAckSubmitting(true);
    setSubmitError(null);
    try {
      await onConfirmUnitLabelsPrinted(labelHoldLineId);
      setAcknowledgedLabelLines((prev) => new Set([...prev, labelHoldLineId]));
      const ackedLineId = labelHoldLineId;
      setLabelHoldLineId(null);
      setLabelPrintFailed(false);
      moveToNextLineOrReview(undefined, ackedLineId);
    } catch (err: any) {
      setSubmitError(err?.message ?? 'Could not record label acknowledgement. Please retry.');
    } finally {
      setLabelAckSubmitting(false);
    }
  }, [labelHoldLineId, moveToNextLineOrReview, onConfirmUnitLabelsPrinted]);

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
      await onReportException({
        lasyncro_variant_id: reconciliationLine.line.lasyncro_variant_id,
        receive_job_line_id: reconciliationLine.line.receive_job_line_id,
        exception_type: shortfallProblemType,
        quantity_affected: qty,
        accounting_role: 'shortfall',
        notes: shortfallProblemNotes.trim() || `${qty} ${problemLabel(shortfallProblemType).toLowerCase()} during receive`,
      });

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
      const outcome = await inspectAndResolveReadiness(reconciliationLine.line, reconciliationLine.accepted, 0);
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

  const handleMiscount = useCallback(async () => {
    if (!shortfallModal) return;
    setShortfallSubmitting(true);
    setAccepted(shortfallModal.line.quantity_expected);
    try {
      const outcome = await inspectAndResolveReadiness(shortfallModal.line, shortfallModal.line.quantity_expected, 0);
      setShortfallModal(null);
      if (!outcome.awaitingLabelAck) {
        moveToNextLineOrReview(shortfallModal.line.receive_job_line_id);
      }
    } catch (err: any) {
      setSubmitError(err?.message ?? 'Could not save this line. Please retry.');
    } finally {
      setShortfallSubmitting(false);
    }
  }, [inspectAndResolveReadiness, moveToNextLineOrReview, shortfallModal]);

  const handleReconciliationMiscount = useCallback(async () => {
    if (!reconciliationLine) return;
    setShortfallSubmitting(true);
    setAccepted(reconciliationLine.line.quantity_expected);
    try {
      const outcome = await inspectAndResolveReadiness(reconciliationLine.line, reconciliationLine.line.quantity_expected, 0);
      const completedLineId = reconciliationLine.line.receive_job_line_id;
      setReconciliationLine(null);
      setSessionPhase('inspect');
      if (!outcome.awaitingLabelAck) {
        moveToNextLineOrReview(completedLineId);
      }
    } catch (err: any) {
      setSubmitError(err?.message ?? 'Could not save this line. Please retry.');
    } finally {
      setShortfallSubmitting(false);
    }
  }, [inspectAndResolveReadiness, moveToNextLineOrReview, reconciliationLine]);

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

  const handleAcceptOverDelivery = useCallback(async () => {
    if (!overDeliveryDecision) return;
    const { line, counted } = overDeliveryDecision;
    setOverDeliveryDecision(null);
    await persistLineProgress(line, counted);
    await flushLineProgress();
    await completeLine(line, counted, 0);
  }, [completeLine, flushLineProgress, overDeliveryDecision, persistLineProgress]);

  const handleRejectOverDelivery = useCallback(() => {
    if (!overDeliveryDecision) return;
    void persistLineProgress(overDeliveryDecision.line, overDeliveryDecision.line.quantity_expected);
    setOverDeliveryDecision(null);
  }, [overDeliveryDecision, persistLineProgress]);

  const handleReportOverDelivery = useCallback(() => {
    if (!overDeliveryDecision) return;
    const extra = Math.max(1, overDeliveryDecision.counted - overDeliveryDecision.line.quantity_expected);
    void persistLineProgress(overDeliveryDecision.line, overDeliveryDecision.line.quantity_expected);
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
      setSubmitError(err?.message ?? 'Could not close receive. Nothing was changed; retry when ready.');
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
      ? 'start receive'
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
          ['Reference', poId],
          ['Item', item],
          ['Qty', quantity],
          ['Source', supplierName],
          ['Identity', identity],
          ['Next', nextStep],
        ]
      : [
          ['Action', action],
          ['Reference', poId],
          ['Item', item],
          ['Qty', quantity],
          ['Source', supplierName],
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
              sx={{ ...(label === 'Item' || label === 'Source' ? {} : monoSx), fontWeight: 650 }}
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
          PO <Box component="span" sx={monoSx}>{poId}</Box> · Receive <Box component="span" sx={monoSx}>{receiveJobId}</Box>
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

      <Alert severity="info">
        Barcode-capable lines can scan continuously or be counted locally. Barcode-less lines are counted, then held until LSU labels are printed and attached.
      </Alert>

      <Button
        variant="contained"
        size="large"
        onClick={handleStart}
        sx={{ justifySelf: 'start', bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, borderRadius: '6px', fontWeight: 700 }}
      >
        Start Receive
      </Button>
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
                        void persistLineProgress(currentLine, next);
                        if (next > currentLine.quantity_expected) {
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
                        if (accepted >= currentLine.quantity_expected) {
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

  const renderHandoff = () => (
    <Box sx={{ maxWidth: 560, mx: 'auto', textAlign: 'center', py: 7 }}>
      <CheckCircle size={58} color={theme.palette.success.main} />
      <Typography variant="h4" fontWeight={800} sx={{ mt: 2 }}>Receive complete</Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
        Received units are now available for Stow.
      </Typography>
      <Button
        variant="contained"
        onClick={onComplete}
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
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleRejectOverDelivery} color="inherit">Do not receive extra</Button>
          <Button onClick={handleReportOverDelivery} color="warning">Report problem</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => void handleAcceptOverDelivery()}
          >
            Accept extra unit{Math.max(0, (overDeliveryDecision?.counted ?? 0) - (overDeliveryDecision?.line.quantity_expected ?? 0)) === 1 ? '' : 's'}
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
