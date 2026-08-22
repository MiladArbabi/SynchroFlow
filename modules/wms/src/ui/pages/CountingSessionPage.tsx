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

type Phase =
  | 'brief'
  | 'location'
  | 'product'
  | 'quantity'
  | 'summary'
  | 'complete';

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
  onClaimTask,
  onResolveBarcode,
  onRecordCount,
  onSkipLine,
  onCloseTask,
}: CountingSessionPageProps) {
  const locationInputRef = useRef<HTMLInputElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);
  const quantityInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>('brief');
  const [lines, setLines] = useState<CountingLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [locationInput, setLocationInput] = useState('');
  const [productInput, setProductInput] = useState('');
  const [quantityInput, setQuantityInput] = useState('');

  const [skipOpen, setSkipOpen] = useState(false);
  const [skipReason, setSkipReason] = useState<CountingSkipReason | null>(null);
  const [skipNotes, setSkipNotes] = useState('');

  const unresolvedLines = useMemo(
    () => lines.filter((line) => !isResolved(line)),
    [lines]
  );

  const currentLine = unresolvedLines[0] ?? null;
  const resolvedCount = lines.length - unresolvedLines.length;
  const progress =
    lines.length > 0
      ? Math.round((resolvedCount / lines.length) * 100)
      : 0;

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);

      try {
        const loaded = await onFetchLines(task.recount_task_id);
        setLines(loaded);
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
  }, [task.recount_task_id, onFetchLines]);

  useEffect(() => {
    if (phase === 'location') {
      setTimeout(() => locationInputRef.current?.focus(), 50);
    }
    if (phase === 'product') {
      setTimeout(() => productInputRef.current?.focus(), 50);
    }
    if (phase === 'quantity') {
      setTimeout(() => quantityInputRef.current?.focus(), 50);
    }
  }, [phase, currentLine?.recount_line_id]);

  const resetForNextLine = () => {
    setLocationInput('');
    setProductInput('');
    setQuantityInput('');
    setError(null);
    setSkipReason(null);
    setSkipNotes('');
  };

  const advanceAfterResolution = (resolvedLineId: string) => {
    const remaining = lines.filter(
      (line) =>
        line.recount_line_id !== resolvedLineId &&
        !isResolved(line)
    ).length;

    resetForNextLine();
    setPhase(remaining === 0 ? 'summary' : 'location');
  };

  const handleStart = async () => {
    if (submitting || loading) return;

    setSubmitting(true);
    setError(null);

    try {
      if (task.status === 'dispatched') {
        await onClaimTask(task.recount_task_id);
      }

      setPhase(unresolvedLines.length === 0 ? 'summary' : 'location');
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
    if (!currentLine) return;

    if (!locationMatches(locationInput, currentLine.location_code)) {
      setError(`Wrong location. Go to ${currentLine.location_code}.`);
      return;
    }

    setError(null);
    setLocationInput('');
    setPhase('product');
  };

  const handleProduct = async () => {
    if (!currentLine || !productInput.trim() || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const resolved = await onResolveBarcode(productInput.trim());

      if (
        !resolved ||
        resolved.lasyncro_variant_id !== currentLine.lasyncro_variant_id
      ) {
        setError(
          'Wrong item. Scan the product shown for this location.'
        );
        return;
      }

      setProductInput('');
      setPhase('quantity');
    } catch (scanError) {
      setError(
        errorMessage(scanError, 'Barcode could not be resolved. Try again.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCount = async () => {
    if (!currentLine || submitting) return;

    const raw = quantityInput.trim();

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
      await onRecordCount(
        task.recount_task_id,
        currentLine.recount_line_id,
        {
          counted_quantity: quantity,
          count_method: 'bin_quantity',
        }
      );

      setLines((previous) =>
        previous.map((line) =>
          line.recount_line_id === currentLine.recount_line_id
            ? {
                ...line,
                counted_quantity: quantity,
                count_method: 'bin_quantity',
                counted_at: new Date().toISOString(),
                skip_reason: null,
                skipped_at: null,
              }
            : line
        )
      );

      advanceAfterResolution(currentLine.recount_line_id);
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
    if (!currentLine || !skipReason || submitting) return;

    if (skipReason === 'other' && !skipNotes.trim()) {
      setError('Add a short note for Other.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await onSkipLine(
        task.recount_task_id,
        currentLine.recount_line_id,
        {
          skip_reason: skipReason,
          ...(skipNotes.trim() ? { notes: skipNotes.trim() } : {}),
        }
      );

      setLines((previous) =>
        previous.map((line) =>
          line.recount_line_id === currentLine.recount_line_id
            ? {
                ...line,
                counted_quantity: null,
                counted_at: null,
                skip_reason: skipReason,
                skipped_at: new Date().toISOString(),
              }
            : line
        )
      );

      setSkipOpen(false);
      advanceAfterResolution(currentLine.recount_line_id);
    } catch (skipError) {
      setError(
        errorMessage(
          skipError,
          'This item could not be skipped. Try again.'
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
        errorMessage(
          closeError,
          'Count could not be finished. Try again.'
        )
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

  return (
    <Box sx={{ p: '30px 24px', maxWidth: 720, mx: 'auto' }}>
      <Box sx={{ mb: 3 }}>
        <Typography
          sx={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--accent)',
            mb: 0.5,
          }}
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
          sx={{
            fontSize: 13,
            fontWeight: 300,
            color: 'var(--ink-3)',
            mt: 0.75,
          }}
        >
          {resolvedCount} of {lines.length} locations checked · {progress}%
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
            sx={{
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--ink)',
              mt: 1.5,
            }}
          >
            {unresolvedLines.length} locations remaining
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
            Scan the location, confirm the product, then enter what you
            physically see. System quantities stay hidden while you count.
          </Typography>

          <Button
            variant="contained"
            onClick={() => void handleStart()}
            disabled={submitting || Boolean(error && lines.length === 0)}
          >
            {submitting
              ? 'Starting…'
              : resolvedCount > 0
              ? 'Continue count'
              : 'Start count'}
          </Button>

          <Button
            onClick={onComplete}
            disabled={submitting}
            sx={{ ml: 1 }}
          >
            Back
          </Button>
        </Box>
      )}

      {(phase === 'location' ||
        phase === 'product' ||
        phase === 'quantity') &&
        currentLine && (
          <>
            <Box
              sx={{
                bgcolor: 'var(--surface)',
                border: '1px solid var(--rule)',
                borderRadius: '14px',
                p: 3,
                mb: 2,
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  mb: 2,
                }}
              >
                <MapPin size={18} color="var(--accent)" />
                <Typography
                  sx={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: 'var(--ink)',
                  }}
                >
                  {currentLine.location_code}
                </Typography>
              </Box>

              <Typography
                sx={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: 'var(--ink)',
                }}
              >
                {currentLine.product_title ?? 'Product'}
              </Typography>

              {currentLine.variant_title &&
                currentLine.variant_title !== 'Default Title' && (
                  <Typography
                    sx={{
                      fontSize: 13,
                      color: 'var(--ink-3)',
                      mt: 0.25,
                    }}
                  >
                    {currentLine.variant_title}
                  </Typography>
                )}

              <Typography
                sx={{
                  fontSize: 12,
                  fontFamily:
                    '"DM Mono", "SF Mono", ui-monospace, monospace',
                  color: 'var(--ink-4)',
                  mt: 0.75,
                }}
              >
                {currentLine.sku ?? 'No SKU'}
              </Typography>
            </Box>

            {phase === 'location' && (
              <Box
                sx={{
                  bgcolor: 'var(--surface)',
                  border: '1px solid var(--rule)',
                  borderRadius: '14px',
                  p: 3,
                }}
              >
                <Typography
                  sx={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--ink)',
                    mb: 1.5,
                  }}
                >
                  Scan location
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
                  placeholder={currentLine.location_code}
                  disabled={submitting}
                />

                <Button
                  variant="contained"
                  onClick={handleLocation}
                  disabled={!locationInput.trim() || submitting}
                  sx={{ mt: 1.5 }}
                >
                  Confirm location
                </Button>
              </Box>
            )}

            {phase === 'product' && (
              <Box
                sx={{
                  bgcolor: 'var(--surface)',
                  border: '1px solid var(--rule)',
                  borderRadius: '14px',
                  p: 3,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    mb: 1.5,
                  }}
                >
                  <PackageCheck size={18} color="var(--accent)" />
                  <Typography
                    sx={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--ink)',
                    }}
                  >
                    Scan product
                  </Typography>
                </Box>

                <TextField
                  inputRef={productInputRef}
                  fullWidth
                  value={productInput}
                  onChange={(event) =>
                    setProductInput(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void handleProduct();
                    }
                  }}
                  placeholder={currentLine.sku ?? 'Scan barcode'}
                  disabled={submitting}
                />

                <Button
                  variant="contained"
                  onClick={() => void handleProduct()}
                  disabled={!productInput.trim() || submitting}
                  sx={{ mt: 1.5 }}
                >
                  {submitting ? 'Checking…' : 'Confirm product'}
                </Button>
              </Box>
            )}

            {phase === 'quantity' && (
              <Box
                sx={{
                  bgcolor: 'var(--surface)',
                  border: '1px solid var(--rule)',
                  borderRadius: '14px',
                  p: 3,
                }}
              >
                <Typography
                  sx={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--ink)',
                    mb: 0.5,
                  }}
                >
                  How many are physically here?
                </Typography>

                <Typography
                  sx={{
                    fontSize: 12,
                    color: 'var(--ink-3)',
                    mb: 1.5,
                  }}
                >
                  Enter 0 if the location is empty.
                </Typography>

                <TextField
                  inputRef={quantityInputRef}
                  fullWidth
                  value={quantityInput}
                  onChange={(event) =>
                    setQuantityInput(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void handleCount();
                    }
                  }}
                  inputProps={{
                    inputMode: 'numeric',
                    pattern: '[0-9]*',
                  }}
                  disabled={submitting}
                />

                <Button
                  variant="contained"
                  onClick={() => void handleCount()}
                  disabled={!quantityInput.trim() || submitting}
                  sx={{ mt: 1.5 }}
                >
                  {submitting ? 'Saving…' : 'Save count'}
                </Button>
              </Box>
            )}

            <Button
              startIcon={<SkipForward size={16} />}
              onClick={() => {
                setError(null);
                setSkipReason(null);
                setSkipNotes('');
                setSkipOpen(true);
              }}
              disabled={submitting}
              sx={{ mt: 1.5 }}
            >
              Cannot count this item
            </Button>
          </>
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
            sx={{
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--ink)',
              mt: 1.5,
            }}
          >
            All locations checked
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
            sx={{
              fontSize: 19,
              fontWeight: 600,
              color: 'var(--ink)',
              mt: 1.5,
            }}
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
        open={skipOpen}
        onClose={() => {
          if (!submitting) setSkipOpen(false);
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
                variant={
                  skipReason === option.value
                    ? 'contained'
                    : 'outlined'
                }
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
              onChange={(event) =>
                setSkipNotes(event.target.value)
              }
              placeholder="What prevented the count?"
              disabled={submitting}
              sx={{ mt: 2 }}
            />
          )}
        </DialogContent>

        <DialogActions>
          <Button
            onClick={() => setSkipOpen(false)}
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