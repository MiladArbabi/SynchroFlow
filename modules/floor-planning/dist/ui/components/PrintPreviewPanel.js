import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// modules/floor-planning/src/ui/components/PrintPreviewPanel.tsx
import { useEffect, useRef, useState } from 'react';
import { Box, Typography, Paper, Radio, RadioGroup, FormControlLabel, Button, Divider, } from '@mui/material';
import { Printer } from 'lucide-react';
import JsBarcode from 'jsbarcode';
const LABEL_FORMATS = [
    { id: 'avery-5160', label: 'Avery 5160 · 24/sheet', labelsPerSheet: 24, columns: 3, labelWidthMm: 66, labelHeightMm: 25, paperSize: 'A4' },
    { id: 'avery-5163', label: 'Avery 5163 · 10/sheet · large', labelsPerSheet: 10, columns: 2, labelWidthMm: 101, labelHeightMm: 51, paperSize: 'A4' },
    { id: 'zebra-4x6', label: 'Zebra 4×6 thermal', labelsPerSheet: 1, columns: 1, labelWidthMm: 101, labelHeightMm: 152, paperSize: '4x6' },
    { id: 'dymo-1x2', label: 'Dymo 1×2.125', labelsPerSheet: 1, columns: 1, labelWidthMm: 25, labelHeightMm: 54, paperSize: '1x2' },
];
/** Pixels per mm at 96dpi screen resolution */
const MM_TO_PX = 96 / 25.4;
function BarcodeSVG({ value, widthMm, heightMm }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current || !value)
            return;
        try {
            JsBarcode(ref.current, value, {
                format: 'CODE128',
                width: 1.2,
                height: Math.max(20, heightMm * MM_TO_PX * 0.45),
                displayValue: true,
                fontSize: 8,
                margin: 2,
                background: 'transparent',
            });
        }
        catch (e) {
            console.warn('[PrintPreviewPanel] JsBarcode failed for value:', value, e);
        }
    }, [value, heightMm]);
    return (_jsx("svg", { ref: ref, style: { width: '100%', height: 'auto', display: 'block' } }));
}
export function PrintPreviewPanel({ selectedZones }) {
    const [formatId, setFormatId] = useState('avery-5160');
    const format = LABEL_FORMATS.find((f) => f.id === formatId) ?? LABEL_FORMATS[0];
    const barcoded = selectedZones.filter((z) => z.barcode !== null && z.active);
    const sheet = barcoded.slice(0, format.labelsPerSheet);
    const labelPxW = format.labelWidthMm * MM_TO_PX * 0.6; // 0.6 = preview scale
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
    return (_jsxs(Box, { sx: { width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.5 }, children: "Print Preview" }), _jsx(Typography, { sx: { fontSize: 16, fontWeight: 600, color: 'var(--ink)' }, children: format.label })] }), _jsx(Paper, { variant: "outlined", sx: {
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: 'var(--surface)',
                    display: 'grid',
                    gridTemplateColumns: `repeat(${format.columns}, 1fr)`,
                    gap: '2px',
                    maxHeight: 320,
                    overflowY: 'auto',
                }, id: "lasyncro-print-sheet", children: sheet.length === 0 ? (_jsx(Box, { sx: { gridColumn: `1 / -1`, py: 4, textAlign: 'center' }, children: _jsx(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)' }, children: "No barcoded locations" }) })) : (sheet.map((zone) => (_jsxs(Box, { className: "lsy-label", sx: {
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
                    }, children: [_jsx(BarcodeSVG, { value: zone.barcode, widthMm: format.labelWidthMm, heightMm: format.labelHeightMm }), _jsx(Typography, { sx: { fontSize: 7, fontFamily: 'monospace', color: '#000', mt: 0.25, textAlign: 'center', lineHeight: 1.2 }, children: zone.location_code })] }, zone.location_code)))) }), _jsxs(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)' }, children: [sheet.length, " label", sheet.length !== 1 ? 's' : '', " \u00B7 ", Math.ceil(barcoded.length / format.labelsPerSheet), " sheet", Math.ceil(barcoded.length / format.labelsPerSheet) !== 1 ? 's' : '', " \u00B7 CODE128 \u00B7 ", format.paperSize === 'A4' ? 'A4' : format.paperSize] }), _jsx(Divider, {}), _jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }, children: "Format" }), _jsx(RadioGroup, { value: formatId, onChange: (_, v) => setFormatId(v), children: LABEL_FORMATS.map((f) => (_jsx(FormControlLabel, { value: f.id, control: _jsx(Radio, { size: "small", sx: { color: 'var(--ink-4)', '&.Mui-checked': { color: 'var(--accent)' }, py: 0.25 } }), label: _jsx(Typography, { sx: { fontSize: 12, color: 'var(--ink-3)' }, children: f.label }) }, f.id))) })] }), _jsx(Divider, {}), _jsx(Button, { fullWidth: true, onClick: handlePrint, startIcon: _jsx(Printer, { size: 15 }), sx: {
                    bgcolor: 'var(--accent)',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: 13,
                    py: 1.25,
                    borderRadius: 1.5,
                    textTransform: 'none',
                    '&:hover': { bgcolor: 'var(--accent-hover)' },
                }, children: "Print sheet" })] }));
}
//# sourceMappingURL=PrintPreviewPanel.js.map