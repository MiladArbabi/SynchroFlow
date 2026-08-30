// modules/floor-planning/src/ui/components/PrintPreviewPanel.tsx

/**
 * PrintPreviewPanel — Barcodes tab right panel.
 *
 * Renders a first-sheet visual preview for any printable code and owns the
 * reviewer-visible print status machine. Data-shape agnostic since
 * SHOP-REV-01m cycle 2: callers map their rows to PrintableLabel and supply
 * their own format list, so the same panel serves both the Locations and
 * Products sub-tabs without forking.
 *
 * SHOP-REVIEW-BARCODE-PRINT-05 — reviewer-safe printing:
 *   - Print sends EVERY selected id (was: first sheet only). The server PDF
 *     paginates; this panel's visual grid stays a "sheet 1 of M" preview and
 *     says so.
 *   - The caller's onBatchPrint returns a PrintSubmitResult. On a browser
 *     fallback the returned Blob is kept in panel state and rendered as
 *     durable "Open printable PDF" / "Download PDF" controls — the basic
 *     browser path never depends on a delayed window.open. A best-effort
 *     auto-open is attempted but its failure cannot strand the reviewer.
 *   - Every branch has a visible status: PREPARING / BROWSER_READY /
 *     QZ_DISPATCHED / ERROR. Console logging is supplemental only.
 *   - Empty selection disables the Print button (the handler keeps a guard).
 *
 * Barcode type is Code128 for all formats.
 *
 * PRINT-02: format geometry here is duplicated server-side in
 * warehouseLabelPdf.SHEET_FORMATS and productLabelPdf.PRODUCT_FORMATS,
 * kept in sync by comment only. Drift means the preview lies about the
 * printed sheet. (Carried DEFER for this issue.)
 */

import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Radio,
  RadioGroup,
  FormControlLabel,
  Button,
  Divider,
} from '@mui/material';
import { Printer, ExternalLink, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import JsBarcode from 'jsbarcode';

export interface LabelFormat {
  id: string;
  label: string;
  labelsPerSheet: number;
  columns: number;
  labelWidthMm: number;
  labelHeightMm: number;
  paperSize: 'A4' | '4x6' | '1x2' | 'thermal';
}

/**
 * One printable label, decoupled from any particular row shape.
 *
 * `id` is the batch-print lookup key — location_code for locations,
 * lasyncro_variant_id for products. It is deliberately separate from `code`:
 * httpBatchPrintProductBarcodes looks variants up by id, not by barcode.
 */
export interface PrintableLabel {
  id: string;
  code: string;
  caption: string;
}

/**
 * SHOP-REVIEW-BARCODE-PRINT-05 — why QZ silent dispatch did not happen.
 * Mirrors PrintFallbackReason in apps/frontend/src/utils/qzPrint.ts. Kept as a
 * local type so the module has no dependency on the host app.
 */
export type PrintFallbackReason =
  | 'no_default_printer'
  | 'qz_unavailable'
  | 'qz_failed';

/**
 * Outcome of a caller's batch-print submission. The caller owns the HTTP call
 * and the (optional) QZ dispatch; the panel owns the resulting UI.
 *   dispatched — QZ Tray accepted the job for `printerName`
 *   browser    — a printable PDF exists; render durable Open/Download controls
 *   empty      — server had nothing printable in the selection (400/404)
 *   error      — any other failure; message is already UI-safe if present
 */
export type PrintSubmitResult =
  | { outcome: 'dispatched'; printerName: string }
  | { outcome: 'browser'; blob: Blob; reason: PrintFallbackReason }
  | { outcome: 'empty' }
  | { outcome: 'error'; message?: string };

type PrintStatus = 'idle' | 'preparing' | 'browser_ready' | 'qz_dispatched' | 'error';

/** Pixels per mm at 96dpi screen resolution */
const MM_TO_PX = 96 / 25.4;

interface BarcodeSVGProps {
  value: string;
  widthMm: number;
  heightMm: number;
}

function BarcodeSVG({ value, widthMm, heightMm }: BarcodeSVGProps) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, {
        format:      'CODE128',
        width:       1.2,
        height:      Math.max(20, heightMm * MM_TO_PX * 0.45),
        displayValue: true,
        fontSize:    8,
        margin:      2,
        background:  'transparent',
      });
    } catch (e) {
      console.warn('[PrintPreviewPanel] JsBarcode failed for value:', value, e);
    }
  }, [value, heightMm]);

  return (
    <svg
      ref={ref}
      style={{ width: '100%', height: 'auto', display: 'block' }}
    />
  );
}

interface PrintPreviewPanelProps {
  items: PrintableLabel[];
  formats: LabelFormat[];
  defaultFormatId: string;
  emptyMessage: string;
  // SHOP-REV-01m: takes ids, not codes — see PrintableLabel.
  // SHOP-REVIEW-BARCODE-PRINT-05: returns a discriminated PrintSubmitResult so
  // this panel can render a truthful, durable outcome. The caller performs the
  // HTTP call + optional QZ dispatch and never opens a browser tab itself.
  onBatchPrint?: (ids: string[], formatId: string) => Promise<PrintSubmitResult>;
}

const REASON_HINT: Record<PrintFallbackReason, string> = {
  no_default_printer: 'No printer is configured, so the labels are ready to print in your browser.',
  qz_unavailable: 'The printer app is not running, so the labels are ready to print in your browser.',
  qz_failed: 'The printer did not accept the job, so the labels are ready to print in your browser.',
};

export function PrintPreviewPanel({ items, formats, defaultFormatId, emptyMessage, onBatchPrint }: PrintPreviewPanelProps) {
  const [formatId, setFormatId] = useState<string>(defaultFormatId);
  const format = formats.find((f) => f.id === formatId) ?? formats[0];

  const [status, setStatus] = useState<PrintStatus>('idle');
  const [message, setMessage] = useState<string>('');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const pdfUrlRef = useRef<string | null>(null);
  const downloadName = format.paperSize === 'thermal' || format.paperSize === '1x2'
    ? 'product-labels.pdf'
    : 'warehouse-labels.pdf';

  // Object-URL lifecycle (SHOP-REVIEW-BARCODE-PRINT-05 §16): one live URL at a
  // time, revoked when replaced and on unmount — never on a timer.
  function setPdf(blob: Blob | null) {
    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = null;
    }
    if (blob) {
      const url = URL.createObjectURL(blob);
      pdfUrlRef.current = url;
      setPdfUrl(url);
    } else {
      setPdfUrl(null);
    }
  }
  useEffect(() => () => {
    if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    pdfUrlRef.current = null;
  }, []);

  // Selection changed → any prior outcome is stale.
  const selectionKey = items.map((i) => i.id).join('|');
  useEffect(() => {
    setStatus('idle');
    setMessage('');
    setPdf(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  const sheetCount = Math.max(1, Math.ceil(items.length / format.labelsPerSheet));
  const previewSheet = items.slice(0, format.labelsPerSheet);
  const labelPxW = format.labelWidthMm  * MM_TO_PX * 0.6; // 0.6 = preview scale
  const labelPxH = format.labelHeightMm * MM_TO_PX * 0.6;

  async function handlePrint() {
    // Defense-in-depth guard — the button is also disabled when empty.
    if (items.length === 0 || !onBatchPrint || status === 'preparing') return;
    setStatus('preparing');
    setMessage('');
    setPdf(null);
    try {
      // Send EVERY selected id — the server PDF paginates across sheets.
      const result = await onBatchPrint(items.map((i) => i.id), formatId);
      switch (result.outcome) {
        case 'dispatched':
          setStatus('qz_dispatched');
          setMessage(`Sent to ${result.printerName}`);
          break;
        case 'browser': {
          setPdf(result.blob);
          setStatus('browser_ready');
          setMessage(REASON_HINT[result.reason]);
          // Best-effort convenience open — its failure cannot strand the user
          // because the durable Open/Download controls are rendered below.
          try {
            if (pdfUrlRef.current) window.open(pdfUrlRef.current, '_blank');
          } catch { /* ignored — controls remain */ }
          break;
        }
        case 'empty':
          setStatus('error');
          setMessage('These labels are no longer available. Refresh the barcode list and try again.');
          break;
        case 'error':
        default:
          setStatus('error');
          setMessage(result.outcome === 'error' && result.message
            ? result.message
            : 'Could not prepare the labels. Please try again.');
          break;
      }
    } catch (e) {
      console.error('[PrintPreviewPanel] batch print failed', e);
      setStatus('error');
      setMessage('Could not prepare the labels. Please try again.');
    }
  }

  const emptySelection = items.length === 0;

  return (
    <Box sx={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Header */}
      <Box>
        <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.5 }}>
          Print Preview{sheetCount > 1 ? ` — sheet 1 of ${sheetCount}` : ''}
        </Typography>
        <Typography sx={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
          {format.label}
        </Typography>
      </Box>

      {/* Label sheet preview (first sheet only) */}
      <Paper
        variant="outlined"
        sx={{
          p: 1.5,
          borderRadius: 2,
          bgcolor: 'var(--surface)',
          display: 'grid',
          gridTemplateColumns: `repeat(${format.columns}, 1fr)`,
          gap: '2px',
          maxHeight: 320,
          overflowY: 'auto',
        }}
        id="lasyncro-print-sheet"
      >
        {previewSheet.length === 0 ? (
          <Box sx={{ gridColumn: `1 / -1`, py: 4, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>{emptyMessage}</Typography>
          </Box>
        ) : (
          previewSheet.map((item) => (
            <Box
              key={item.id}
              className="lsy-label"
              sx={{
                width: labelPxW,
                height: labelPxH,
                border: '1px solid var(--rule)',
                borderRadius: 0.5,
                p: 0.5,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                bgcolor: '#fff',
              }}
            >
              <BarcodeSVG
                value={item.code}
                widthMm={format.labelWidthMm}
                heightMm={format.labelHeightMm}
              />
              <Typography sx={{ fontSize: 7, fontFamily: 'monospace', color: '#000', mt: 0.25, textAlign: 'center', lineHeight: 1.2 }}>
                {item.caption}
              </Typography>
            </Box>
          ))
        )}
      </Paper>

      {/* Honest label / sheet count */}
      <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
        {items.length} label{items.length !== 1 ? 's' : ''} · {sheetCount} sheet{sheetCount !== 1 ? 's' : ''} · CODE128 · {format.paperSize === 'A4' ? 'A4' : format.paperSize}
      </Typography>

      <Divider />

      {/* Format selector */}
      <Box>
        <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
          Format
        </Typography>
        <RadioGroup value={formatId} onChange={(_, v) => setFormatId(v)}>
          {formats.map((f) => (
            <FormControlLabel
              key={f.id}
              value={f.id}
              control={<Radio size="small" sx={{ color: 'var(--ink-4)', '&.Mui-checked': { color: 'var(--accent)' }, py: 0.25 }} />}
              label={<Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>{f.label}</Typography>}
            />
          ))}
        </RadioGroup>
      </Box>

      <Divider />

      {/* Print CTA */}
      <Button
        fullWidth
        onClick={handlePrint}
        disabled={emptySelection || status === 'preparing'}
        startIcon={<Printer size={15} />}
        sx={{
          bgcolor: 'var(--accent)',
          color: '#fff',
          fontWeight: 600,
          fontSize: 13,
          py: 1.25,
          borderRadius: 1.5,
          textTransform: 'none',
          '&:hover': { bgcolor: 'var(--accent-hover)' },
          '&.Mui-disabled': { bgcolor: 'var(--rule)', color: 'var(--ink-4)' },
        }}
      >
        {status === 'preparing' ? 'Preparing…' : 'Print sheet'}
      </Button>

      {/* Reviewer-visible outcome (SHOP-REVIEW-BARCODE-PRINT-05 §7) */}
      {status === 'qz_dispatched' && (
        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start' }}>
          <CheckCircle2 size={14} color="var(--accent)" style={{ marginTop: 2, flexShrink: 0 }} />
          <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>{message}</Typography>
        </Box>
      )}

      {status === 'browser_ready' && pdfUrl && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
            Ready to print in your browser. {message}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.75 }}>
            <Button
              component="a"
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              size="small"
              startIcon={<ExternalLink size={13} />}
              sx={{ textTransform: 'none', fontSize: 12, color: 'var(--accent)' }}
            >
              Open printable PDF
            </Button>
            <Button
              component="a"
              href={pdfUrl}
              download={downloadName}
              size="small"
              startIcon={<Download size={13} />}
              sx={{ textTransform: 'none', fontSize: 12, color: 'var(--ink-3)' }}
            >
              Download PDF
            </Button>
          </Box>
        </Box>
      )}

      {status === 'error' && (
        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start' }}>
          <AlertTriangle size={14} color="var(--critical-ink)" style={{ marginTop: 2, flexShrink: 0 }} />
          <Typography sx={{ fontSize: 12, color: 'var(--critical-ink)' }}>{message}</Typography>
        </Box>
      )}

      {/* Reviewer guidance — QZ is optional (SHOP-REVIEW-BARCODE-PRINT-05 §13) */}
      <Typography sx={{ fontSize: 10.5, color: 'var(--ink-4)', lineHeight: 1.4 }}>
        Printer app optional — labels can also be opened as a PDF and printed from your browser.
      </Typography>
    </Box>
  );
}
