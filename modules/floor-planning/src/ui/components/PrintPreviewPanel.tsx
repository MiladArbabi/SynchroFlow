// modules/floor-planning/src/ui/components/PrintPreviewPanel.tsx
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
import type { WarehouseZone } from '../pages/FloorPlanningModuleFT2.js';

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

interface LabelFormat {
  id: string;
  label: string;
  labelsPerSheet: number;
  columns: number;
  labelWidthMm: number;
  labelHeightMm: number;
  paperSize: 'A4' | '4x6' | '1x2';
}

const LABEL_FORMATS: LabelFormat[] = [
  { id: 'avery-5160', label: 'Avery 5160 · 24/sheet',  labelsPerSheet: 24, columns: 3, labelWidthMm: 66,  labelHeightMm: 25,  paperSize: 'A4'  },
  { id: 'avery-5163', label: 'Avery 5163 · 10/sheet · large', labelsPerSheet: 10, columns: 2, labelWidthMm: 101, labelHeightMm: 51,  paperSize: 'A4'  },
  { id: 'zebra-4x6',  label: 'Zebra 4×6 thermal',      labelsPerSheet: 1,  columns: 1, labelWidthMm: 101, labelHeightMm: 152, paperSize: '4x6' },
  { id: 'dymo-1x2',   label: 'Dymo 1×2.125',           labelsPerSheet: 1,  columns: 1, labelWidthMm: 25,  labelHeightMm: 54,  paperSize: '1x2' },
];

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
  selectedZones: WarehouseZone[];
}

export function PrintPreviewPanel({ selectedZones }: PrintPreviewPanelProps) {
  const [formatId, setFormatId] = useState<string>('avery-5160');
  const format = LABEL_FORMATS.find((f) => f.id === formatId) ?? LABEL_FORMATS[0];

  const barcoded = selectedZones.filter((z) => z.barcode !== null && z.active);
  const sheet    = barcoded.slice(0, format.labelsPerSheet);

  const labelPxW = format.labelWidthMm  * MM_TO_PX * 0.6; // 0.6 = preview scale
  const labelPxH = format.labelHeightMm * MM_TO_PX * 0.6;

  function handlePrint() {
    // Inject print styles scoped to this sheet — removed after print
    const style = document.createElement('style');
    style.id = '__lsy-print-style';
    style.innerHTML = `
      @media print {
        @page { size: ${format.paperSize === 'A4' ? 'A4' : format.paperSize === '4x6' ? '4in 6in' : '1in 2.125in'} portrait; margin: 8mm; }
        body > *:not(#lasyncro-print-root) { display: none !important; }
        #lasyncro-print-root > *:not(#lasyncro-print-sheet) { display: none !important; }
        #lasyncro-print-sheet {
          display: grid !important;
          grid-template-columns: repeat(${format.columns}, 1fr);
          gap: 2mm;
          padding: 0;
        }
        #lasyncro-print-sheet .lsy-label {
          border: 0.2mm solid #ccc;
          padding: 2mm;
          break-inside: avoid;
        }
      }
    `;
    document.head.appendChild(style);
    window.print();
    setTimeout(() => document.getElementById('__lsy-print-style')?.remove(), 1000);
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
            <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>No barcoded locations</Typography>
          </Box>
        ) : (
          sheet.map((zone) => (
            <Box
              key={zone.location_code}
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
                value={zone.barcode!}
                widthMm={format.labelWidthMm}
                heightMm={format.labelHeightMm}
              />
              <Typography sx={{ fontSize: 7, fontFamily: 'monospace', color: '#000', mt: 0.25, textAlign: 'center', lineHeight: 1.2 }}>
                {zone.location_code}
              </Typography>
            </Box>
          ))
        )}
      </Paper>

      {/* Label count */}
      <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
        {sheet.length} label{sheet.length !== 1 ? 's' : ''} · {Math.ceil(barcoded.length / format.labelsPerSheet)} sheet{Math.ceil(barcoded.length / format.labelsPerSheet) !== 1 ? 's' : ''} · CODE128 · {format.paperSize === 'A4' ? 'A4' : format.paperSize}
      </Typography>

      <Divider />

      {/* Format selector */}
      <Box>
        <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
          Format
        </Typography>
        <RadioGroup value={formatId} onChange={(_, v) => setFormatId(v)}>
          {LABEL_FORMATS.map((f) => (
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