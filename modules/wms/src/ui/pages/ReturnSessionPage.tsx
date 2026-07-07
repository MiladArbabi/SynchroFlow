// modules/wms/src/ui/pages/ReturnSessionPage.tsx
//
// RETURN SESSION PAGE — folded into WMS operations free-scan (WEB-RETURN-01)
// -----------------------------------------------------------------------------
// Rendered by WmsModuleFT2 when a pack free-scan resolves to an already-
// shipped item/order. Presentational only — all data access is owned by
// WmsPage.tsx and threaded down as props, matching PackSessionPage/
// StowSessionPage. No hooks, no axios, per the module/app boundary
// (modules/wms's tsconfig rootDir excludes apps/frontend entirely).
import { useState, useEffect } from 'react';
import { Box, Typography, CircularProgress, Alert, Button, TextField, Paper } from '@mui/material';
import { CheckCircle } from 'lucide-react';

export type ReturnItemCondition = 'resellable' | 'repackable' | 'damaged' | 'unsellable';

export type ReturnJobLine = {
  lasyncro_refund_line_item_id: string;
  refunded_quantity: number;
  item_condition: ReturnItemCondition | null;
  quantity_received: number | null;
  processed_at: string | null;
  variant_title: string | null;
  sku: string | null;
};

export type ReturnJobDetail = {
  return_job_id: string;
  origin: 'customer_return' | 'undelivered_return';
  status: string;
  external_order_id: string | null;
  total_refund_amount: string;
  created_at: string;
  lines: ReturnJobLine[];
};

export interface AddReturnLineInput {
  scannedValue: string;
  quantityReceived: number;
  itemCondition: ReturnItemCondition;
  conditionNotes?: string;
}

export interface UpdateReturnLineInput {
  lineId: string;
  itemCondition: ReturnItemCondition;
  quantityReceived: number;
  conditionNotes?: string;
}

export interface CompleteReturnJobInput {
  returnReason?: string;
  returnNotes?: string;
}

export interface ReturnSessionPageProps {
  returnJobId: string;
  onFetchReturnJob: (returnJobId: string) => Promise<ReturnJobDetail>;
  onAddReturnLine: (returnJobId: string, input: AddReturnLineInput) => Promise<void>;
  onProcessReturnLine: (returnJobId: string, input: UpdateReturnLineInput) => Promise<void>;
  onCompleteReturnJob: (returnJobId: string, input: CompleteReturnJobInput) => Promise<void>;
  onComplete: () => void;
}

const CONDITIONS: { value: ReturnItemCondition; label: string }[] = [
  { value: 'resellable', label: 'Resellable' },
  { value: 'repackable', label: 'Repackable' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'unsellable', label: 'Unsellable' },
];

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

const formatAge = (isoDate: string) => {
  const hours = (Date.now() - new Date(isoDate).getTime()) / 3600000;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

function LineRow({
  line, onSave,
}: {
  line: ReturnJobLine;
  onSave: (input: UpdateReturnLineInput) => void;
}) {
  const [condition, setCondition] = useState<ReturnItemCondition | null>(line.item_condition);
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
          <TextField size="small" type="number" label="Quantity received" value={qty}
            onChange={(e) => setQty(Number(e.target.value))} sx={{ maxWidth: 160 }} />
          {needsNotes && (
            <TextField size="small" label="Condition notes (required)" multiline rows={2}
              value={notes} onChange={(e) => setNotes(e.target.value)} />
          )}
          <Button size="small" variant="contained" disabled={!condition || (needsNotes && !notes)}
            sx={{ alignSelf: 'flex-start', bgcolor: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: '6px', fontWeight: 600, '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}
            onClick={() => condition && onSave({ lineId: line.lasyncro_refund_line_item_id, itemCondition: condition, quantityReceived: qty, conditionNotes: notes || undefined })}>
            Save line
          </Button>
        </Box>
      )}
    </Box>
  );
}

export default function ReturnSessionPage({
  returnJobId, onFetchReturnJob, onAddReturnLine, onProcessReturnLine, onCompleteReturnJob, onComplete,
}: ReturnSessionPageProps) {
  const [job, setJob] = useState<ReturnJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scanValue, setScanValue] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [reason, setReason] = useState<typeof REASONS[number]['value'] | null>(null);
  const [reasonNotes, setReasonNotes] = useState('');
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  const refetch = () => {
    setLoading(true);
    onFetchReturnJob(returnJobId)
      .then((data) => { setJob(data); setLoadError(null); })
      .catch((err: any) => setLoadError(err?.message ?? 'Failed to load return job'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refetch(); }, [returnJobId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}><CircularProgress size={24} /></Box>;
  }
  if (loadError || !job) {
    return <Box sx={{ p: 3 }}><Alert severity="error">{loadError ?? 'Return job not found.'}</Alert></Box>;
  }

  const lines = job.lines;
  const allProcessed = lines.length > 0 && lines.every((l) => !!l.processed_at);
  const needsReason = job.origin === 'customer_return';
  const reasonValid = !needsReason || (!!reason && (reason !== 'other' || !!reasonNotes));
  const canComplete = allProcessed && reasonValid && job.status !== 'awaiting_decision';

  const handleAddLine = () => {
    const val = scanValue.trim();
    if (!val) return;
    setScanError(null);
    onAddReturnLine(returnJobId, { scannedValue: val, quantityReceived: 1, itemCondition: 'resellable' })
      .then(refetch)
      .catch((err: any) => setScanError(err?.message ?? 'Failed to add line'));
    setScanValue('');
  };

  const handleSaveLine = (input: UpdateReturnLineInput) => {
    onProcessReturnLine(returnJobId, input).then(refetch).catch(() => {});
  };

  const handleComplete = () => {
    setCompleteError(null);
    setCompleting(true);
    onCompleteReturnJob(returnJobId, { returnReason: reason ?? undefined, returnNotes: reasonNotes || undefined })
      .then(onComplete)
      .catch((err: any) => setCompleteError(err?.message ?? 'Failed to complete return'))
      .finally(() => setCompleting(false));
  };

  return (
    <Box sx={{ p: '30px 24px', maxWidth: 640, mx: 'auto' }}>
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
          <LineRow key={line.lasyncro_refund_line_item_id} line={line} onSave={handleSaveLine} />
        ))}
      </Box>

      <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: '14px', border: '1px solid var(--rule)' }}>
        <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', mb: 1 }}>Scan an item to add a line</Typography>
        {scanError && <Alert severity="error" sx={{ mb: 1, py: 0.5, fontSize: 12 }}>{scanError}</Alert>}
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField size="small" fullWidth autoComplete="off" placeholder="Scan product barcode…"
            value={scanValue} onChange={(e) => setScanValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddLine(); }} />
          <Button variant="outlined" onClick={handleAddLine} disabled={!scanValue.trim()}
            sx={{ color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', fontWeight: 500, whiteSpace: 'nowrap' }}>
            Add line
          </Button>
        </Box>
      </Paper>

      {needsReason && (
        <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', p: 2.5, mb: 2 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', mb: 1.5 }}>Why was this returned?</Typography>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1.5 }}>
            {REASONS.map((r) => (
              <Box key={r.value} onClick={() => setReason(r.value)} sx={{
                px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, borderRadius: '6px', cursor: 'pointer',
                border: reason === r.value ? 'none' : '0.5px solid var(--accent)',
                bgcolor: reason === r.value ? 'var(--accent)' : 'transparent',
                color: reason === r.value ? 'var(--accent-ink)' : 'var(--accent)',
              }}>
                {r.label}
              </Box>
            ))}
          </Box>
          {reason === 'other' && (
            <TextField size="small" fullWidth label="Notes (required)" multiline rows={2}
              value={reasonNotes} onChange={(e) => setReasonNotes(e.target.value)} />
          )}
        </Box>
      )}

      {completeError && <Alert severity="error" sx={{ mb: 2 }}>{completeError}</Alert>}

      <Button fullWidth variant="contained" size="large" disabled={!canComplete || completing}
        startIcon={completing ? <CircularProgress size={16} /> : <CheckCircle size={16} />}
        sx={{ bgcolor: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: '6px', fontWeight: 600, '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}
        onClick={handleComplete}>
        Complete return
      </Button>
      {!allProcessed && lines.length > 0 && (
        <Typography sx={{ fontSize: 11, color: 'var(--ink-3)', mt: 1, textAlign: 'center' }}>
          Assess every line before completing.
        </Typography>
      )}
    </Box>
  );
}