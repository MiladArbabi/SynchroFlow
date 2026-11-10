import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, TextField, Typography } from '@mui/material';

/**
 * SF-PROBLEM-BIN Phase A — shared Problem Bin scan flow.
 * Scan Problem Bin → scan exact LSU → quarantine. No reason form.
 * Used by Free Scan (no task) and by Stow (task adapter). The caller supplies
 * the server calls; this component owns step state and retry identity.
 *
 * Retry identity: the device event id survives an ambiguous (network/5xx)
 * failure so a re-scan of the same LSU returns the committed result instead
 * of repeating it. A definitive 4xx refusal did not commit and clears it.
 */
export interface ProblemBinScanFlowProps<R> {
  onResolveBin: (scan: string) => Promise<{ location_code: string }>;
  onQuarantine: (lsu: string, bin: string, eventId: string) => Promise<R>;
  onQuarantined?: (result: R, lsu: string, bin: string) => void;
  onExit?: () => void;
  exitLabel?: string;
  disabled?: boolean;
}

function newEventId(): string {
  return globalThis.crypto.randomUUID();
}

export default function ProblemBinScanFlow<R>({
  onResolveBin, onQuarantine, onQuarantined, onExit, exitLabel = 'Done', disabled = false,
}: ProblemBinScanFlowProps<R>) {
  const [bin, setBin] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const pending = useRef<{ lsu: string; bin: string; id: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const locked = busy || disabled;

  useEffect(() => {
    if (locked) return;
    const timer = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
    return () => clearTimeout(timer);
  }, [locked, bin]);

  const submit = async (raw: string) => {
    const scan = raw.trim();
    if (!scan || locked) return;
    setValue('');
    setError(null);
    setBusy(true);
    try {
      if (!bin) {
        const resolved = await onResolveBin(scan);
        setSuccess(null);
        setBin(resolved.location_code);
        return;
      }
      if (!scan.startsWith('LSU-')) throw new Error('Scan the exact LSU label on the unit.');
      const prior = pending.current;
      if (prior && (prior.lsu !== scan || prior.bin !== bin)) {
        throw new Error('Retry the previous LSU scan to confirm its saved result before continuing.');
      }
      const request = prior ?? { lsu: scan, bin, id: newEventId() };
      pending.current = request;
      const result = await onQuarantine(request.lsu, request.bin, request.id);
      pending.current = null;
      setBin(null);
      setSuccess(`Unit quarantined · ${request.lsu} · ${request.bin}`);
      onQuarantined?.(result, request.lsu, request.bin);
    } catch (err: any) {
      const status = err?.response?.status;
      if (typeof status === 'number' && status >= 400 && status < 500) pending.current = null;
      setError(err?.response?.data?.error ?? err?.message ?? 'Unable to quarantine the unit. Retry the same scan.');
    } finally {
      setBusy(false);
    }
  };

  const hint = bin ? 'Scan exact LSU label' : 'Scan Problem Bin barcode';
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography sx={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
        {bin ? `Scan exact LSU · ${bin}` : 'Scan Problem Bin'}
      </Typography>
      <TextField
        inputRef={inputRef}
        fullWidth
        placeholder={hint}
        inputProps={{ 'aria-label': hint, autoCapitalize: 'off', spellCheck: false }}
        sx={{ '& .MuiInputBase-root': { minHeight: 56, borderRadius: '12px', bgcolor: 'var(--surface)' } }}
        value={value}
        disabled={locked}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void submit(value); }}
        helperText={locked ? 'Saving scan…' : 'Scanner auto-submits · manual entry: press Enter'}
        autoComplete="off"
      />
      {error && <Alert severity="error" sx={{ py: 0.5, fontSize: 13, borderRadius: '8px' }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ py: 0.5, fontSize: 13, borderRadius: '8px' }}>{success}</Alert>}
      <Box sx={{ display: 'flex', gap: 1 }}>
        {bin && (
          <Button disabled={locked || Boolean(pending.current)} onClick={() => { setBin(null); setError(null); }}>
            Change Problem Bin
          </Button>
        )}
        {onExit && (
          <Button disabled={locked || Boolean(pending.current)} onClick={onExit}>{exitLabel}</Button>
        )}
      </Box>
    </Box>
  );
}
