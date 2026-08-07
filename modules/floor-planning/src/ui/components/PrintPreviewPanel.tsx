// modules/floor-planning/src/ui/components/PrintPreviewPanel.tsx

/**
 * PrintPreviewPanel — Barcodes tab right panel.
 *
 * Renders a live label sheet preview for any printable code. Data-shape
 * agnostic since SHOP-REV-01m cycle 2: callers map their rows to
 * PrintableLabel and supply their own format list, so the same panel serves
 * both the Locations and Products sub-tabs without forking.
 *
 * Callers own printability filtering — for locations that is "active"
 * (REV-HARD-01), with no product equivalent — and own the format list, because
 * location labels run up to Zebra 4x6 while product labels are 30-60mm.
 *
 * Barcode type is Code128 for all formats.
 *
 * PRINT-02: format geometry here is duplicated server-side in
 * warehouseLabelPdf.SHEET_FORMATS and productLabelPdf.PRODUCT_FORMATS,
 * kept in sync by comment only. Drift means the preview lies about the
 * printed sheet.
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
import { Printer } from 'lucide-react';
import JsBarcode from 'jsbarcode';

/**
 * PrintPreviewPanel — Barcodes tab right panel.
 *
 * Renders a live label sheet preview for barcoded warehouse locations.
 * Supports 4 label formats — each controls grid layout, label dimensions,
 * and @media print page size.
 *
 * Barcode type is Code128 for all formats in Phase 1.
 * Phase 2: user-selectable barcode type per format.
 *
 * Print isolation: #lasyncro-print-sheet is the only element visible
 * during window.print() — all other app chrome is hidden via @media print.
 */

// SHOP-REV-01m cycle 2: LABEL_FORMATS moved to the caller. Location labels
// (bin/lane, up to Zebra 4x6) and product labels (30-60mm, thermal-first)
// need different format lists, and hardcoding both here would make this
// component know about its callers.
//
// PRINT-02: this geometry is duplicated in warehouseLabelPdf.SHEET_FORMATS
// and productLabelPdf.PRODUCT_FORMATS server-side, kept in sync by comment
// only. A drift means the operator's preview does not match the printed
// sheet. Consolidating into a shared package is registered, not done.
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
  // FP-16: callback prop rather than direct axios import — this module
  // lives across the modules/floor-planning <-> apps/frontend package
  // boundary, which doesn't resolve a direct import of the host app's
  // axiosInstance. FloorPlanningPage owns the actual HTTP call and
  // returns the PDF blob here for opening.
  // FP-17b: a null resolution means FloorPlanningPage already dispatched
  // the print silently via QZ Tray — nothing further to do here.
  // SHOP-REV-01m: takes ids, not codes — see PrintableLabel.
  onBatchPrint?: (ids: string[], formatId: string) => Promise<Blob | null>;
}
export function PrintPreviewPanel({ items, formats, defaultFormatId, emptyMessage, onBatchPrint }: PrintPreviewPanelProps) {
  const [formatId, setFormatId] = useState<string>(defaultFormatId);
  const format = formats.find((f) => f.id === formatId) ?? formats[0];
  // Printability filtering is the caller's job — "barcoded and active" is a
  // location concept with no product equivalent.
  const sheet = items.slice(0, format.labelsPerSheet);
  const labelPxW = format.labelWidthMm  * MM_TO_PX * 0.6; // 0.6 = previewscale
  const labelPxH = format.labelHeightMm * MM_TO_PX * 0.6;
  // FP-16: was window.print() against a #lasyncro-print-root selector
  // that never existed in the DOM (dead CSS, confirmed by full-repo grep
  // in the print-system architecture audit). Now generates a real
  // server-rendered PDF, same pattern as FP-15's single-zone print.
  async function handlePrint() {
    const codes = sheet.map((i) => i.id);
    if (codes.length === 0 || !onBatchPrint) return;
    try {
      const blob = await onBatchPrint(codes, formatId);
      if (!blob) return;
      const url = window.open(URL.createObjectURL(blob), '_blank');
      if (!url) console.warn('[FP-16] Label sheet popup blocked — check browser popup settings');
    } catch (e) {
      console.error('[FP-16] Batch print failed', e);
    }
  }

  return (
    <Box sx={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Header */}
      <Box>
        <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.5 }}>
          Print Preview
        </Typography>
        <Typography sx={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
          {format.label}
        </Typography>
      </Box>

      {/* Label sheet preview */}
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
        {sheet.length === 0 ? (
          <Box sx={{ gridColumn: `1 / -1`, py: 4, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>{emptyMessage}</Typography>
          </Box>
        ) : (
          sheet.map((item) => (
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

      {/* Label count */}
      <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
        {sheet.length} label{sheet.length !== 1 ? 's' : ''} · {Math.ceil(items.length / format.labelsPerSheet)} sheet{Math.ceil(items.length / format.labelsPerSheet) !== 1 ? 's' : ''} · CODE128 · {format.paperSize === 'A4' ? 'A4' : format.paperSize}
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
        }}
      >
        Print sheet
      </Button>
    </Box>
  );
}