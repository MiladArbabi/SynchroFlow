/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/ft2-pages/ReturnSessionPage.tsx
//
// Return Session Page — replaces ReturnJobBriefPage (WEB-RETURN-01 full flow)
// -----------------------------------------------------------------------------
// Opened after a successful scan (ReturnScanEntryPage → /returns/session/:id).
// Per-line condition/quantity assessment, manual line add for items with no
// refund yet (scan_intake, pre-webhook), and job completion with reason
// capture — reason is job-level, gathered at completion after the operator
// has seen every line, not guessed at scan time (locked design decision).
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Typography, CircularProgress, Alert, Button, TextField, Paper } from '@mui/material';
import { CheckCircle } from 'lucide-react';
import { useReturnJob, type ReturnJobLine } from '../returns/useReturnJob';
import { useAddReturnLine, useProcessReturnLine, useCompleteReturnJob } from '../returns/useReturnScan';

const fmt = (n: number) =>
  `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const formatAge = (isoDate: string) => {
  const hours = (Date.now() - new Date(isoDate).getTime()) / 3600000;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

const CONDITIONS = [
  { value: 'resellable', label: 'Resellable' },
  { value: 'repackable', label: 'Repackable' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'unsellable', label: 'Unsellable' },
] as const;

const REASONS = [
  { value: 'wrong_item', label: 'Wrong item' },
  { value: 'damaged_in_transit', label: 'Damaged in transit' },
  { value: 'damaged_on_arrival', label: 'Damaged on arrival' },
  { value: 'not_as_described', label: 'Not as described' },
  { value: 'quality_issue', label: 'Quality issue' },
  { value: 'changed_mind', label: 'Changed mind' },
  { value: 'duplicate_order', label: 'Duplicate order' },
  { value: 'other', label: 'Other' },
] as const;

function LineRow({
  line, onSave,
}: {
  line: ReturnJobLine;
  onSave: (input: { lineId: string; itemCondition: typeof CONDITIONS[number]['value']; quantityReceived: number; conditionNotes?: string }) => void;
}) {
  const [condition, setCondition] = useState<typeof CONDITIONS[number]['value'] | null>(
    (line.item_condition as never) ?? null
  );
  const [qty, setQty] = useState(line.quantity_received ?? line.refunded_quantity);
  const [notes, setNotes] = useState('');
  const isProcessed = !!line.processed_at;
  const needsNotes = condition === 'damaged' || condition === 'unsellable';

  return (
    <Box sx={{ px: 2.5, py: 2, borderBottom: '0.5px solid var(--rule)' }}>
      <Typography sx={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
        {line.variant_title ?? line.sku ?? 'Unknown product'} · refunded qty {line.refunded_quantity}
      </Typography>

      {isProcessed ? (
        <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mt: 0.5 }}>
          Condition: {line.item_condition} · received {line.quantity_received}
        </Typography>
      ) : (
        <Box sx={{ mt: 1.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            {CONDITIONS.map((c) => (
              <Box
                key={c.value}
                onClick={() => setCondition(c.value)}
                sx={{
                  px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, borderRadius: '6px', cursor: 'pointer',
                  border: condition === c.value ? 'none' : '0.5px solid var(--accent)',
                  bgcolor: condition === c.value ? 'var(--accent)' : 'transparent',
                  color: condition === c.value ? 'var(--accent-ink)' : 'var(--accent)',
                }}
              >
                {c.label}
              </Box>
            ))}
          </Box>
          <TextField
            size="small" type="number" label="Quantity received"
            value={qty} onChange={(e) => setQty(Number(e.target.value))}
            sx={{ maxWidth: 160 }}
          />
          {needsNotes && (
            <TextField
              size="small" label="Condition notes (required)" multiline rows={2}
              value={notes} onChange={(e) => setNotes(e.target.value)}
            />
          )}
          <Button
            size="small" variant="contained"
            disabled={!condition || (needsNotes && !notes)}
            sx={{ alignSelf: 'flex-start', bgcolor: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: '6px', fontWeight: 600, '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}
            onClick={() => condition && onSave({ lineId: line.lasyncro_refund_line_item_id, itemCondition: condition, quantityReceived: qty, conditionNotes: notes || undefined })}
          >
            Save line
          </Button>
        </Box>
      )}
    </Box>
  );
}

export default function ReturnSessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const returnJobId = id ?? '';
  const { data, isLoading, isError } = useReturnJob(returnJobId);
  const addLine = useAddReturnLine(returnJobId);
  const processLine = useProcessReturnLine(returnJobId);
  const completeJob = useCompleteReturnJob(returnJobId);

  const [scanValue, setScanValue] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [reason, setReason] = useState<typeof REASONS[number]['value'] | null>(null);
  const [reasonNotes, setReasonNotes] = useState('');
  const [completeError, setCompleteError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }
  if (isError || !data?.data) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Return job not found.</Alert>
      </Box>
    );
  }

  const job = data.data;
  const lines = job.lines;
  const allProcessed = lines.length > 0 && lines.every((l) => !!l.processed_at);
  const needsReason = job.origin === 'customer_return';
  const reasonValid = !needsReason || (!!reason && (reason !== 'other' || !!reasonNotes));
  const canComplete = allProcessed && reasonValid && job.status !== 'awaiting_decision';

  const handleAddLine = () => {
    const val = scanValue.trim();
    if (!val) return;
    setScanError(null);
    addLine.mutate(
      { scannedValue: val, quantityReceived: 1, itemCondition: 'resellable' },
      { onError: (err) => setScanError(err.message) }
    );
    setScanValue('');
  };

  const handleComplete = () => {
    setCompleteError(null);
    completeJob.mutate(
      { returnReason: reason ?? undefined, returnNotes: reasonNotes || undefined },
      {
        onSuccess: () => navigate('/returns'),
        onError: (err) => setCompleteError(err.message),
      }
    );
  };

  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%', p: 3 }}>
      <Box onClick={() => navigate('/returns')} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2, cursor: 'pointer', color: 'var(--ink-3)', fontSize: 12 }}>
        ← Back to Returns
      </Box>

      <Box sx={{ maxWidth: 640 }}>
        <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', mb: 0.5 }}>
          Return job {job.external_order_id ? `— Order #${job.external_order_id}` : ''}
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'var(--ink-3)', mb: 3 }}>
          {job.origin === 'customer_return' ? 'Customer return' : 'Undelivered / return to sender'}
          {' · '}Created {formatAge(job.created_at)}
        </Typography>

        {job.status === 'awaiting_decision' && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            A damaged/unsellable line needs an owner decision before this job can complete.
          </Alert>
        )}

        <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden', mb: 2 }}>
          <Box sx={{ px: 2.5, py: 2, borderBottom: '1px solid var(--rule)' }}>
            <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>Line items</Typography>
          </Box>
          {lines.length === 0 && (
            <Box sx={{ px: 2.5, py: 2 }}>
              <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
                No refund linked yet — scan the physical product barcode below to log what arrived.
              </Typography>
            </Box>
          )}
          {lines.map((line) => (
            <LineRow key={line.lasyncro_refund_line_item_id} line={line} onSave={(input) => processLine.mutate(input)} />
          ))}
        </Box>

        {/* Manual line add — for scan-intake jobs with no refund yet */}
        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: '14px', border: '1px solid var(--rule)' }}>
          <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', mb: 1 }}>Scan an item to add a line</Typography>
          {scanError && <Alert severity="error" sx={{ mb: 1, py: 0.5, fontSize: 12 }}>{scanError}</Alert>}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              size="small" fullWidth autoComplete="off"
              placeholder="Scan product barcode…"
              value={scanValue} onChange={(e) => setScanValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddLine(); }}
            />
            <Button
              variant="outlined" onClick={handleAddLine} disabled={!scanValue.trim()}
              sx={{ color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', fontWeight: 500, whiteSpace: 'nowrap' }}
            >
              Add line
            </Button>
          </Box>
        </Paper>

        {needsReason && (
          <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', p: 2.5, mb: 2 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', mb: 1.5 }}>Why was this returned?</Typography>
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1.5 }}>
              {REASONS.map((r) => (
                <Box
                  key={r.value}
                  onClick={() => setReason(r.value)}
                  sx={{
                    px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, borderRadius: '6px', cursor: 'pointer',
                    border: reason === r.value ? 'none' : '0.5px solid var(--accent)',
                    bgcolor: reason === r.value ? 'var(--accent)' : 'transparent',
                    color: reason === r.value ? 'var(--accent-ink)' : 'var(--accent)',
                  }}
                >
                  {r.label}
                </Box>
              ))}
            </Box>
            {reason === 'other' && (
              <TextField
                size="small" fullWidth label="Notes (required)" multiline rows={2}
                value={reasonNotes} onChange={(e) => setReasonNotes(e.target.value)}
              />
            )}
          </Box>
        )}

        {completeError && <Alert severity="error" sx={{ mb: 2 }}>{completeError}</Alert>}

        <Button
          fullWidth variant="contained" size="large"
          disabled={!canComplete || completeJob.isPending}
          startIcon={completeJob.isPending ? <CircularProgress size={16} /> : <CheckCircle size={16} />}
          sx={{ bgcolor: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: '6px', fontWeight: 600, '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}
          onClick={handleComplete}
        >
          Complete return
        </Button>
        {!allProcessed && lines.length > 0 && (
          <Typography sx={{ fontSize: 11, color: 'var(--ink-3)', mt: 1, textAlign: 'center' }}>
            Assess every line before completing.
          </Typography>
        )}
      </Box>
    </Box>
  );
}