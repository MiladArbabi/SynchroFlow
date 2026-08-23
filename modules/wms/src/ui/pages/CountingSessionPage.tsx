// modules/wms/src/ui/pages/CountingSessionPage.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import {
  CheckCircle2,
  MapPin,
  PackageCheck,
  ScanBarcode,
  SkipForward,
} from 'lucide-react';

export type CountingSkipReason =
  | 'bin_inaccessible'
  | 'stock_in_motion'
  | 'bin_not_found'
  | 'other';

export type CountingTask = {
  recount_task_id: string;
  label: string;
  status: 'draft' | 'dispatched' | 'claimed' | 'counting' | 'manual_review';
  scope: string;
  blind: boolean;
  assigned_to: number | null;
  claimed_by: number | null;
  created_at: string;
  claimed_at: string | null;
  line_count: number;
  counted_count: number;
};

export type CountingFindingType =
  | 'unexpected_item'
  | 'product_defect'
  | 'packaging_defect';

export type CountingFinding = {
  recount_finding_id: string;
  recount_task_id: string;
  recount_line_id: string | null;
  lasyncro_variant_id: string;
  location_code: string;
  finding_type: CountingFindingType;
  quantity: number;
  notes: string | null;
  reported_by: number | null;
  reported_at: string;
};

export type CountingLine = {
  recount_line_id: string;
  lasyncro_variant_id: string;
  location_code: string;
  counted_quantity: number | null;
  count_method: 'unit_scan' | 'bin_quantity' | null;
  scan_count: number | null;
  counted_at: string | null;
  skip_reason: CountingSkipReason | null;
  skipped_at: string | null;
  product_title: string | null;
  variant_title: string | null;
  sku: string | null;
  image_url: string | null;
};

export type CountingSessionPageProps = {
  task: CountingTask;
  onComplete: () => void;
  onFetchLines: (taskId: string) => Promise<CountingLine[]>;
  onFetchFindings: (taskId: string) => Promise<CountingFinding[]>;
  onCreateFinding: (
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
  onClaimTask: (taskId: string) => Promise<void>;
  onResolveBarcode: (
    scannedValue: string
  ) => Promise<{ lasyncro_variant_id: string } | null>;
  onRecordCount: (
    taskId: string,
    lineId: string,
    params: {
      counted_quantity: number;
      count_method: 'bin_quantity';
    }
  ) => Promise<void>;
  onSkipLine: (
    taskId: string,
    lineId: string,
    params: {
      skip_reason: CountingSkipReason;
      notes?: string;
    }
  ) => Promise<void>;
  onCloseTask: (taskId: string) => Promise<void>;
};

type Phase = 'brief' | 'location' | 'bin' | 'summary' | 'complete';

type CountingBin = {
  location_code: string;
  lines: CountingLine[];
};

const SKIP_OPTIONS: Array<{
  value: CountingSkipReason;
  label: string;
}> = [
  { value: 'bin_inaccessible', label: 'Cannot access bin' },
  { value: 'stock_in_motion', label: 'Stock is moving' },
  { value: 'bin_not_found', label: 'Cannot find bin' },
  { value: 'other', label: 'Other' },
];

function locationMatches(scanned: string, locationCode: string): boolean {
  const value = scanned.trim().toUpperCase();
  const expected = locationCode.trim().toUpperCase();
  return value === expected || value === `LOC-${expected}`;
}

function isResolved(line: CountingLine): boolean {
  return line.counted_at !== null || line.skipped_at !== null;
}

function errorMessage(error: unknown, fallback: string): string {
  const responseError = (
    error as { response?: { data?: { error?: string } } }
  )?.response?.data?.error;

  if (responseError) return responseError;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export default function CountingSessionPage({
  task,
  onComplete,
  onFetchLines,
  onFetchFindings,
  onCreateFinding,
  onClaimTask,
  onResolveBarcode,
  onRecordCount,
  onSkipLine,
  onCloseTask,
}: CountingSessionPageProps) {
  const locationInputRef = useRef<HTMLInputElement>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const quantityRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [phase, setPhase] = useState<Phase>('brief');
  const [lines, setLines] = useState<CountingLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [locationInput, setLocationInput] = useState('');
  const [scanInput, setScanInput] = useState('');
  const [quantityInputs, setQuantityInputs] = useState<Record<string, string>>(
    {}
  );

  const [activeBinCode, setActiveBinCode] = useState<string | null>(null);
  const [skipTargetId, setSkipTargetId] = useState<string | null>(null);
  const [skipReason, setSkipReason] = useState<CountingSkipReason | null>(null);
  const [skipNotes, setSkipNotes] = useState('');

  // RECOUNT-EXCEPTIONS-80: findings describe physical observations only.
  // They never alter counted quantity or inventory truth.
  const [, setFindings] = useState<CountingFinding[]>([]);
  const [findingDraft, setFindingDraft] = useState<{
    client_event_id: string;
    line: CountingLine | null;
    lasyncro_variant_id: string;
    location_code: string;
    finding_type: CountingFindingType;
  } | null>(null);
  const [findingQuantity, setFindingQuantity] = useState('1');
  const [findingNotes, setFindingNotes] = useState('');

  // RECOUNT-BINLIST-62 — the domain is location-centric, not line-centric.
  // Lines arrive already sorted into walk order (RECOUNT-WALKORDER-27), so
  // grouping preserves first-appearance order rather than re-sorting: any
  // re-sort here would silently discard the lane ordering the backend built.
  const bins = useMemo<CountingBin[]>(() => {
    const order: string[] = [];
    const grouped = new Map<string, CountingLine[]>();

    for (const line of lines) {
      const existing = grouped.get(line.location_code);

      if (existing) {
        existing.push(line);
      } else {
        grouped.set(line.location_code, [line]);
        order.push(line.location_code);
      }
    }

    return order.map((code) => ({
      location_code: code,
      lines: grouped.get(code) ?? [],
    }));
  }, [lines]);

  const unresolvedLines = useMemo(
    () => lines.filter((line) => !isResolved(line)),
    [lines]
  );

  const activeBin =
    bins.find((bin) => bin.location_code === activeBinCode) ?? null;

  const activeBinResolved = activeBin
    ? activeBin.lines.filter(isResolved).length
    : 0;

  const activeBinComplete = Boolean(
    activeBin && activeBinResolved === activeBin.lines.length
  );

  const binsComplete = bins.filter((bin) =>
    bin.lines.every(isResolved)
  ).length;

  const activeBinNumber = activeBin
    ? bins.findIndex((bin) => bin.location_code === activeBin.location_code) + 1
    : 0;

  const firstOpenBin = (fromIndex = 0): CountingBin | null => {
    for (let index = fromIndex; index < bins.length; index += 1) {
      if (bins[index].lines.some((line) => !isResolved(line))) {
        return bins[index];
      }
    }
    return null;
  };

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);

      try {
        const loaded = await onFetchLines(task.recount_task_id);
        const loadedFindings = await onFetchFindings(task.recount_task_id);

        setLines(loaded);
        setFindings(loadedFindings);

        // RECOUNT-RESUME-POSITION-72: reopening an in-progress count should
        // resume at its first unresolved bin instead of restarting at brief.
        // Location confirmation is intentionally required again after refresh.
        if (task.status === 'claimed' || task.status === 'counting') {
          const nextUnresolvedLine = loaded.find((line) => !isResolved(line));

          setActiveBinCode(nextUnresolvedLine?.location_code ?? null);
          setPhase(nextUnresolvedLine ? 'location' : 'summary');
        }
      } catch (loadError) {
        setError(
          errorMessage(
            loadError,
            'Failed to load this count. Return to Warehouse and try again.'
          )
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [task.recount_task_id, onFetchLines, onFetchFindings]);

  useEffect(() => {
    if (phase === 'location') {
      setTimeout(() => locationInputRef.current?.focus(), 50);
    }
    if (phase === 'bin') {
      setTimeout(() => scanInputRef.current?.focus(), 50);
    }
  }, [phase, activeBinCode]);

  const handleStart = async () => {
    if (submitting || loading) return;

    setSubmitting(true);
    setError(null);

    try {
      if (task.status === 'dispatched') {
        await onClaimTask(task.recount_task_id);
      }

      const next = firstOpenBin();

      setActiveBinCode(next?.location_code ?? null);
      setPhase(next ? 'location' : 'summary');
    } catch (startError) {
      setError(
        errorMessage(
          startError,
          'Failed to start this count. Return to Warehouse and try again.'
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleLocation = () => {
    if (!activeBin) {
      setError('No location is active. Return to Warehouse and try again.');
      return;
    }

    if (!locationMatches(locationInput, activeBin.location_code)) {
      setError(`Wrong bin. Go to ${activeBin.location_code}.`);
      return;
    }

    setError(null);
    setLocationInput('');
    setPhase('bin');
  };

  // A scan does not commit anything on its own -- unlike stow, a count needs a
  // quantity. The scan only identifies which row the operator is standing in
  // front of and moves focus into that row's input.
  const handleScan = async () => {
    const scanned = scanInput.trim();

    if (!activeBin || !scanned || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const resolved = await onResolveBarcode(scanned);

      if (!resolved) {
        setError('Barcode not recognised. Try again.');
        return;
      }

      const match = activeBin.lines.find(
        (line) => line.lasyncro_variant_id === resolved.lasyncro_variant_id
      );

      if (!match) {
        // A resolved barcode physically observed in this bin is evidence,
        // even when the recount line set did not expect it here.
        setFindingDraft({
          client_event_id: crypto.randomUUID(),
          line: null,
          lasyncro_variant_id: resolved.lasyncro_variant_id,
          location_code: activeBin.location_code,
          finding_type: 'unexpected_item',
        });
        setFindingQuantity('1');
        setFindingNotes('');
        setScanInput('');
        return;
      }

      setScanInput('');
      setTimeout(
        () => quantityRefs.current[match.recount_line_id]?.focus(),
        50
      );
    } catch (scanError) {
      setError(
        errorMessage(scanError, 'Barcode could not be resolved. Try again.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCount = async (line: CountingLine) => {
    if (submitting) return;

    const raw = (quantityInputs[line.recount_line_id] ?? '').trim();

    if (!/^\d+$/.test(raw)) {
      setError('Enter a whole number, including 0 when the bin is empty.');
      return;
    }

    const quantity = Number(raw);

    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      setError('Enter a valid whole-number quantity.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await onRecordCount(task.recount_task_id, line.recount_line_id, {
        counted_quantity: quantity,
        count_method: 'bin_quantity',
      });

      setLines((previous) =>
        previous.map((entry) =>
          entry.recount_line_id === line.recount_line_id
            ? {
                ...entry,
                counted_quantity: quantity,
                count_method: 'bin_quantity',
                counted_at: new Date().toISOString(),
                skip_reason: null,
                skipped_at: null,
              }
            : entry
        )
      );

      setQuantityInputs((previous) => {
        const next = { ...previous };
        delete next[line.recount_line_id];
        return next;
      });

      setTimeout(() => scanInputRef.current?.focus(), 50);
    } catch (countError) {
      setError(
        errorMessage(
          countError,
          'Count could not be saved. Check the connection and try again.'
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = async () => {
    if (!skipTargetId || !skipReason || submitting) return;

    if (skipReason === 'other' && !skipNotes.trim()) {
      setError('Add a short note for Other.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await onSkipLine(task.recount_task_id, skipTargetId, {
        skip_reason: skipReason,
        ...(skipNotes.trim() ? { notes: skipNotes.trim() } : {}),
      });

      setLines((previous) =>
        previous.map((entry) =>
          entry.recount_line_id === skipTargetId
            ? {
                ...entry,
                counted_quantity: null,
                counted_at: null,
                skip_reason: skipReason,
                skipped_at: new Date().toISOString(),
              }
            : entry
        )
      );

      setSkipTargetId(null);
      setSkipReason(null);
      setSkipNotes('');
      setTimeout(() => scanInputRef.current?.focus(), 50);
    } catch (skipError) {
      setError(
        errorMessage(skipError, 'This item could not be skipped. Try again.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleNextBin = () => {
    if (!activeBin) return;

    const currentIndex = bins.findIndex(
      (bin) => bin.location_code === activeBin.location_code
    );

    const next = firstOpenBin(currentIndex + 1) ?? firstOpenBin(0);

    setError(null);
    setLocationInput('');
    setScanInput('');

    if (!next) {
      setPhase('summary');
      return;
    }

    setActiveBinCode(next.location_code);
    setPhase('location');
  };

  const handleSaveFinding = async () => {
    if (!findingDraft || submitting) return;

    const rawQuantity = findingQuantity.trim();

    if (!/^\d+$/.test(rawQuantity)) {
      setError('Enter a positive whole-number quantity.');
      return;
    }

    const quantity = Number(rawQuantity);

    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      setError('Enter a positive whole-number quantity.');
      return;
    }

    if (
      findingDraft.line?.counted_quantity !== null &&
      findingDraft.line?.counted_quantity !== undefined &&
      quantity > findingDraft.line.counted_quantity
    ) {
      setError('Defect quantity cannot exceed the physical quantity counted.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const created = await onCreateFinding(task.recount_task_id, {
        client_event_id: findingDraft.client_event_id,
        recount_line_id: findingDraft.line?.recount_line_id ?? null,
        lasyncro_variant_id: findingDraft.lasyncro_variant_id,
        location_code: findingDraft.location_code,
        finding_type: findingDraft.finding_type,
        quantity,
        ...(findingNotes.trim() ? { notes: findingNotes.trim() } : {}),
      });

      setFindings((previous) => [...previous, created]);
      setFindingDraft(null);
      setFindingQuantity('1');
      setFindingNotes('');

      setTimeout(() => scanInputRef.current?.focus(), 50);
    } catch (findingError) {
      setError(
        errorMessage(
          findingError,
          'This physical finding could not be saved. Try again.'
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleFinish = async () => {
    if (unresolvedLines.length > 0 || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      // The operator session deliberately ignores review/variance details.
      // Blind counting ends with a simple acknowledgement that the task
      // reached the server.
      await onCloseTask(task.recount_task_id);
      setPhase('complete');
    } catch (closeError) {
      setError(
        errorMessage(closeError, 'Count could not be finished. Try again.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ p: '30px 24px', maxWidth: 720, mx: 'auto' }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
          <CircularProgress size={26} />
        </Box>
      </Box>
    );
  }

  const renderRow = (line: CountingLine) => {
    const counted = line.counted_at !== null;
    const skipped = line.skipped_at !== null;
    const resolved = counted || skipped;

    return (
      <Box
        key={line.recount_line_id}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          py: 0.75,
          borderBottom: '1px solid var(--rule)',
          opacity: resolved ? 0.5 : 1,
        }}
      >
        <Box
          sx={{
            width: 32,
            height: 32,
            flexShrink: 0,
            borderRadius: '4px',
            bgcolor: 'var(--surface-2, var(--surface))',
            border: '1px solid var(--rule)',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {line.image_url ? (
            <Box
              component="img"
              src={line.image_url}
              alt=""
              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <PackageCheck size={14} color="var(--ink-4)" />
          )}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: 12,
              lineHeight: 1.35,
              color: 'var(--ink)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {line.product_title ?? 'Product'}
            {line.variant_title && line.variant_title !== 'Default Title'
              ? ` · ${line.variant_title}`
              : ''}
          </Typography>

          <Typography
            sx={{
              fontSize: 11,
              lineHeight: 1.35,
              fontFamily: '"DM Mono", "SF Mono", ui-monospace, monospace',
              color: 'var(--ink-4)',
            }}
          >
            {line.sku ?? 'No SKU'}
          </Typography>
        </Box>

        {counted && (
          <Typography
            sx={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', width: 72, textAlign: 'right' }}
          >
            {line.counted_quantity}
          </Typography>
        )}

        {counted && Number(line.counted_quantity) > 0 && (
          <Button
            size="small"
            variant="text"
            onClick={() => {
              setError(null);
              setFindingDraft({
                client_event_id: crypto.randomUUID(),
                line,
                lasyncro_variant_id: line.lasyncro_variant_id,
                location_code: line.location_code,
                finding_type: 'product_defect',
              });
              setFindingQuantity('1');
              setFindingNotes('');
            }}
            disabled={submitting}
            sx={{ minWidth: 'auto', px: 0.75, fontSize: 11 }}
          >
            Report defect
          </Button>
        )}

        {skipped && (
          <Typography
            sx={{ fontSize: 11, color: 'var(--ink-3)', width: 72, textAlign: 'right' }}
          >
            Skipped
          </Typography>
        )}

        {!resolved && (
          <>
            <TextField
              inputRef={(element: HTMLInputElement | null) => {
                quantityRefs.current[line.recount_line_id] = element;
              }}
              value={quantityInputs[line.recount_line_id] ?? ''}
              onChange={(event) =>
                setQuantityInputs((previous) => ({
                  ...previous,
                  [line.recount_line_id]: event.target.value,
                }))
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleCount(line);
              }}
              placeholder="Qty"
              size="small"
              disabled={submitting}
              autoComplete="off"
              inputProps={{
                inputMode: 'numeric',
                pattern: '[0-9]*',
                autoComplete: 'off',
                style: { textAlign: 'right', padding: '6px 8px', fontSize: 13 },
              }}
              sx={{ width: 72 }}
            />

            <Button
              size="small"
              onClick={() => {
                setError(null);
                setSkipReason(null);
                setSkipNotes('');
                setSkipTargetId(line.recount_line_id);
              }}
              disabled={submitting}
              aria-label="Cannot count this item"
              sx={{ minWidth: 32, px: 0.5 }}
            >
              <SkipForward size={15} />
            </Button>
          </>
        )}
      </Box>
    );
  };

  return (
    <Box sx={{ p: '30px 24px', maxWidth: 720, mx: 'auto' }}>
      <Box sx={{ mb: 3 }}>
        <Typography
          sx={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', mb: 0.5 }}
        >
          {task.label}
        </Typography>

        <Typography
          sx={{
            fontSize: 26,
            fontWeight: 700,
            color: 'var(--ink)',
            lineHeight: 1.1,
          }}
        >
          Count inventory
        </Typography>

        <Typography
          sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)', mt: 0.75 }}
        >
          {binsComplete} of {bins.length}{' '}
          {bins.length === 1 ? 'bin' : 'bins'} counted
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: '10px' }}>
          {error}
        </Alert>
      )}

      {phase === 'brief' && (
        <Box
          sx={{
            bgcolor: 'var(--surface)',
            border: '1px solid var(--rule)',
            borderRadius: '14px',
            p: 3,
          }}
        >
          <ScanBarcode size={28} color="var(--accent)" />

          <Typography
            sx={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', mt: 1.5 }}
          >
            {bins.length - binsComplete}{' '}
            {bins.length - binsComplete === 1 ? 'bin' : 'bins'} remaining
          </Typography>

          <Typography
            sx={{
              fontSize: 13,
              fontWeight: 300,
              color: 'var(--ink-3)',
              mt: 0.75,
              mb: 2.5,
            }}
          >
            Scan the bin, then scan each item and enter what you physically
            see. System quantities stay hidden while you count.
          </Typography>

          <Button
            variant="contained"
            onClick={() => void handleStart()}
            disabled={submitting || Boolean(error && lines.length === 0)}
          >
            {submitting
              ? 'Starting…'
              : binsComplete > 0
              ? 'Continue count'
              : 'Start count'}
          </Button>

          <Button onClick={onComplete} disabled={submitting} sx={{ ml: 1 }}>
            Back
          </Button>
        </Box>
      )}

      {phase === 'location' && activeBin && (
        <Box
          sx={{
            bgcolor: 'var(--surface)',
            border: '1px solid var(--rule)',
            borderRadius: '14px',
            p: 3,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <MapPin size={18} color="var(--accent)" />
            <Typography
              sx={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}
            >
              Scan the bin barcode
            </Typography>
          </Box>

          <Typography
            sx={{ fontSize: 12, color: 'var(--ink-3)', mb: 1.5 }}
          >
            Bin {activeBinNumber} of {bins.length} ·{' '}
            {activeBin.lines.length}{' '}
            {activeBin.lines.length === 1 ? 'item' : 'items'} to check
          </Typography>

          <TextField
            inputRef={locationInputRef}
            fullWidth
            value={locationInput}
            onChange={(event) =>
              setLocationInput(event.target.value.toUpperCase())
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleLocation();
            }}
            placeholder="Scan bin barcode"
            disabled={submitting}
            autoComplete="off"
            inputProps={{ autoComplete: 'off' }}
          />

          <Button
            variant="contained"
            onClick={handleLocation}
            disabled={!locationInput.trim() || submitting}
            sx={{ mt: 1.5 }}
          >
            Confirm bin
          </Button>
        </Box>
      )}

      {phase === 'bin' && activeBin && (
        <Box
          sx={{
            bgcolor: 'var(--surface)',
            border: '1px solid var(--rule)',
            borderRadius: '14px',
            p: 2.25,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              mb: 1.25,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <MapPin size={17} color="var(--accent)" />
              <Typography
                sx={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}
              >
                {activeBin.location_code}
              </Typography>
            </Box>

            <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
              Bin {activeBinNumber} of {bins.length} · {activeBinResolved} of{' '}
              {activeBin.lines.length} items
            </Typography>
          </Box>

          <TextField
            inputRef={scanInputRef}
            fullWidth
            size="small"
            value={scanInput}
            onChange={(event) => setScanInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleScan();
            }}
            placeholder="Scan product barcode"
            disabled={submitting || activeBinComplete}
            autoComplete="off"
            inputProps={{ autoComplete: 'off' }}
            sx={{ mb: 1.25 }}
          />

          <Box sx={{ borderTop: '1px solid var(--rule)' }}>
            {activeBin.lines.map(renderRow)}
          </Box>

          {activeBinComplete && (
            <Button
              variant="contained"
              onClick={handleNextBin}
              disabled={submitting}
              sx={{ mt: 2 }}
            >
              {firstOpenBin() ? 'Next bin' : 'Review count'}
            </Button>
          )}
        </Box>
      )}

      {phase === 'summary' && (
        <Box
          sx={{
            bgcolor: 'var(--surface)',
            border: '1px solid var(--rule)',
            borderRadius: '14px',
            p: 3,
          }}
        >
          <CheckCircle2 size={30} color="var(--accent)" />

          <Typography
            sx={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', mt: 1.5 }}
          >
            All bins counted
          </Typography>

          <Typography
            sx={{
              fontSize: 13,
              fontWeight: 300,
              color: 'var(--ink-3)',
              mt: 0.75,
              mb: 2.5,
            }}
          >
            Finish the count to send it for the next required step.
          </Typography>

          <Button
            variant="contained"
            onClick={() => void handleFinish()}
            disabled={submitting || unresolvedLines.length > 0}
          >
            {submitting ? 'Finishing…' : 'Finish count'}
          </Button>
        </Box>
      )}

      {phase === 'complete' && (
        <Box
          sx={{
            bgcolor: 'var(--surface)',
            border: '1px solid var(--rule)',
            borderRadius: '14px',
            p: 3,
          }}
        >
          <CheckCircle2 size={32} color="var(--accent)" />

          <Typography
            sx={{ fontSize: 19, fontWeight: 600, color: 'var(--ink)', mt: 1.5 }}
          >
            Count submitted
          </Typography>

          <Typography
            sx={{
              fontSize: 13,
              fontWeight: 300,
              color: 'var(--ink-3)',
              mt: 0.75,
              mb: 2.5,
            }}
          >
            Your count has been submitted. You can return to Warehouse.
          </Typography>

          <Button variant="contained" onClick={onComplete}>
            Back to Warehouse
          </Button>
        </Box>
      )}

      <Dialog
        open={findingDraft !== null}
        onClose={() => {
          if (!submitting) {
            setFindingDraft(null);
            setError(null);
          }
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {findingDraft?.finding_type === 'unexpected_item'
            ? 'Unexpected item found'
            : 'Report defective stock'}
        </DialogTitle>

        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Typography
            sx={{ fontSize: 13, color: 'var(--ink-3)', mb: 2 }}
          >
            {findingDraft?.finding_type === 'unexpected_item'
              ? `This item is not expected at ${findingDraft.location_code}. Record what you physically found.`
              : 'Keep these units in the physical count. Record only the units that are defective.'}
          </Typography>

          {findingDraft?.line && (
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <Button
                variant={
                  findingDraft.finding_type === 'product_defect'
                    ? 'contained'
                    : 'outlined'
                }
                onClick={() =>
                  setFindingDraft((previous) =>
                    previous
                      ? { ...previous, finding_type: 'product_defect' }
                      : previous
                  )
                }
                disabled={submitting}
              >
                Product defect
              </Button>

              <Button
                variant={
                  findingDraft.finding_type === 'packaging_defect'
                    ? 'contained'
                    : 'outlined'
                }
                onClick={() =>
                  setFindingDraft((previous) =>
                    previous
                      ? { ...previous, finding_type: 'packaging_defect' }
                      : previous
                  )
                }
                disabled={submitting}
              >
                Packaging defect
              </Button>
            </Box>
          )}

          <TextField
            fullWidth
            label="Quantity"
            value={findingQuantity}
            onChange={(event) => {
              setFindingQuantity(event.target.value);
              setError(null);
            }}
            disabled={submitting}
            inputProps={{
              inputMode: 'numeric',
              pattern: '[0-9]*',
            }}
          />

          <TextField
            fullWidth
            multiline
            minRows={2}
            value={findingNotes}
            onChange={(event) => setFindingNotes(event.target.value)}
            placeholder="Optional note"
            disabled={submitting}
            sx={{ mt: 2 }}
          />

          {findingDraft?.line && (
            <Typography
              sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 1 }}
            >
              Physically counted: {findingDraft.line.counted_quantity}
            </Typography>
          )}
        </DialogContent>

        <DialogActions>
          <Button
            onClick={() => {
              setFindingDraft(null);
              setError(null);
            }}
            disabled={submitting}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={() => void handleSaveFinding()}
            disabled={submitting || !findingQuantity.trim()}
          >
            {submitting ? 'Saving…' : 'Record finding'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={skipTargetId !== null}
        onClose={() => {
          if (!submitting) setSkipTargetId(null);
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Why can’t this item be counted?</DialogTitle>

        <DialogContent>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr',
              gap: 1,
              pt: 0.5,
            }}
          >
            {SKIP_OPTIONS.map((option) => (
              <Button
                key={option.value}
                variant={skipReason === option.value ? 'contained' : 'outlined'}
                onClick={() => {
                  setSkipReason(option.value);
                  setError(null);
                }}
                disabled={submitting}
                sx={{ justifyContent: 'flex-start' }}
              >
                {option.label}
              </Button>
            ))}
          </Box>

          {skipReason === 'other' && (
            <TextField
              fullWidth
              multiline
              minRows={2}
              value={skipNotes}
              onChange={(event) => setSkipNotes(event.target.value)}
              placeholder="What prevented the count?"
              disabled={submitting}
              sx={{ mt: 2 }}
            />
          )}
        </DialogContent>

        <DialogActions>
          <Button
            onClick={() => setSkipTargetId(null)}
            disabled={submitting}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={() => void handleSkip()}
            disabled={
              !skipReason ||
              submitting ||
              (skipReason === 'other' && !skipNotes.trim())
            }
          >
            {submitting ? 'Saving…' : 'Skip item'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
