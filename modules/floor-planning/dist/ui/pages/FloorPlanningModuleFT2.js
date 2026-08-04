import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// modules/floor-planning/src/ui/pages/FloorPlanningModuleFT2.tsx
import { useState, useCallback, useMemo } from 'react';
import { Box, Paper, Typography, Alert, Chip, Divider, TextField, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Collapse, IconButton, Tab, Tabs, Checkbox, Button, FormControl, InputLabel, MenuItem, Select, } from '@mui/material';
import { LayoutDashboard, Tag, PackageSearch, ChevronDown, ChevronUp, Map, ScrollText, Eye, EyeOff, Trash2, Plus } from 'lucide-react';
import { ModuleErrorBoundary, ModuleLoadingSkeleton } from '@lasyncro/shared/ui';
import { PrintPreviewPanel } from '../components/PrintPreviewPanel.js';
import { BinLogDrawer } from '../components/BinLogDrawer.js';
// FP-01: shared zone_type colour map, single source of truth with Canvas.
import { ZONE_COLORS, ZONE_STROKE } from '../components/CanvasEditor.js';
import { CanvasEditor } from '../components/CanvasEditor.js';
import { IsometricCanvas } from '../components/IsometricCanvas.js';
const TYPE_LABELS = {
    warehouse: { label: 'Warehouse', color: 'primary' },
    lane: { label: 'Lane', color: 'secondary' },
    shelf: { label: 'Shelf', color: 'info' },
    bin: { label: 'Bin', color: 'warning' },
};
function ZoneCard({ zone, onDelete, onToggleActive }) {
    const type = TYPE_LABELS[zone.type] ?? { label: zone.type, color: 'default' };
    const metaParts = [];
    if (zone.parent_location_code)
        metaParts.push(`Parent: ${zone.parent_location_code}`);
    metaParts.push(zone.barcode ?? 'No barcode assigned');
    if (zone.children_count > 0) {
        metaParts.push(`${zone.children_count} child location${zone.children_count > 1 ? 's' : ''}`);
    }
    return (_jsx(Paper, { variant: "outlined", sx: { p: 1.5, mb: 1, borderRadius: 2, opacity: zone.active ? 1 : 0.5 }, children: _jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }, children: [_jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.75 }, children: [_jsx(Typography, { variant: "body2", fontWeight: 700, sx: { fontFamily: 'monospace' }, children: zone.location_code }), _jsxs(Box, { sx: { display: 'flex', gap: 1, alignItems: 'center' }, children: [!zone.active && _jsx(Chip, { label: "Inactive", size: "small", color: "default" }), _jsx(Chip, { label: type.label, size: "small", color: type.color }), zone.zone_type && (_jsx(Chip, { label: zone.zone_type, size: "small", sx: {
                                        fontSize: 10,
                                        height: 20,
                                        textTransform: 'capitalize',
                                        bgcolor: ZONE_COLORS[zone.zone_type] ?? 'transparent',
                                        color: ZONE_STROKE[zone.zone_type] ?? 'var(--ink-4)',
                                        border: `1px solid ${ZONE_STROKE[zone.zone_type] ?? 'var(--ink-4)'}`,
                                    } }))] })] }), _jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.75 }, children: [_jsxs(Box, { sx: { display: 'flex', gap: 0.5, alignItems: 'center' }, children: [_jsx(IconButton, { size: "small", title: zone.active ? 'Deactivate' : 'Activate', onClick: () => onToggleActive?.(zone.location_code, !zone.active), sx: { color: zone.active ? 'var(--accent)' : 'var(--ink-4)' }, children: zone.active ? _jsx(EyeOff, { size: 14 }) : _jsx(Eye, { size: 14 }) }), zone.parent_location_code !== null && (_jsx(IconButton, { size: "small", title: "Delete zone", onClick: () => onDelete?.(zone.location_code), sx: { color: 'var(--ink-4)', '&:hover': { color: 'error.main' } }, children: _jsx(Trash2, { size: 14 }) }))] }), _jsx(Typography, { variant: "caption", color: "text.secondary", sx: { fontFamily: 'monospace', textAlign: 'right' }, children: metaParts.map((part, i) => (_jsxs("span", { children: [i > 0 && _jsx("span", { style: { opacity: 0.5 }, children: " \u00B7 " }), part] }, i))) })] })] }) }));
}
function ProductBarcodesTable({ items, onUpdateProductBarcode, onPrintProductBarcode }) {
    const [filter, setFilter] = useState('');
    const [showUnassigned, setShowUnassigned] = useState(false);
    // Inline edit state: tracks which variant is being edited and the draft value
    const [editingId, setEditingId] = useState(null);
    const [editValue, setEditValue] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(null);
    // SHOP-REV-01i: per-row print state — a product with no supplier barcode
    // has no scannable identity until laSyncro mints one. Deliberately scoped
    // to the unassigned section: products that already carry a supplier
    // EAN/UPC scan fine and need no laSyncro label.
    const [printingId, setPrintingId] = useState(null);
    const [printError, setPrintError] = useState(null);
    async function handlePrint(lasyncroVariantId) {
        if (!onPrintProductBarcode)
            return;
        setPrintingId(lasyncroVariantId);
        setPrintError(null);
        try {
            await onPrintProductBarcode(lasyncroVariantId);
        }
        catch {
            setPrintError(lasyncroVariantId);
        }
        finally {
            setPrintingId(null);
        }
    }
    async function handleSave(lasyncroVariantId) {
        if (!editValue.trim() || !onUpdateProductBarcode)
            return;
        setSaving(true);
        setSaveError(null);
        try {
            await onUpdateProductBarcode(lasyncroVariantId, editValue.trim());
            setEditingId(null);
        }
        catch {
            setSaveError('Failed to save barcode');
        }
        finally {
            setSaving(false);
        }
    }
    const assigned = items.filter((i) => i.barcode !== null);
    const unassigned = items.filter((i) => i.barcode === null);
    const filtered = assigned.filter((i) => {
        const q = filter.toLowerCase();
        return (!q ||
            i.sku?.toLowerCase().includes(q) ||
            i.lasyncro_variant_id.toLowerCase().includes(q) ||
            i.barcode?.toLowerCase().includes(q));
    });
    return (_jsxs(Box, { children: [_jsx(TextField, { placeholder: "Filter by SKU or barcode...", size: "small", fullWidth: true, value: filter, onChange: (e) => setFilter(e.target.value), sx: { mb: 2 }, InputProps: { sx: { fontFamily: 'monospace', fontSize: 13 } } }), assigned.length === 0 && unassigned.length === 0 ? (_jsxs(Paper, { variant: "outlined", sx: { textAlign: 'center', py: 6, borderRadius: 2, borderStyle: 'dashed' }, children: [_jsx(PackageSearch, { size: 36, style: { opacity: 0.3 } }), _jsx(Typography, { variant: "body2", color: "text.secondary", sx: { mt: 2 }, children: "No product barcodes found." })] })) : (_jsxs(_Fragment, { children: [assigned.length > 0 && (_jsx(TableContainer, { component: Paper, variant: "outlined", sx: { borderRadius: 2, mb: 2 }, children: _jsxs(Table, { size: "small", children: [_jsx(TableHead, { children: _jsxs(TableRow, { children: [_jsx(TableCell, { sx: { fontWeight: 700, fontSize: 11 }, children: "LaSyncro ID" }), _jsx(TableCell, { sx: { fontWeight: 700, fontSize: 11 }, children: "SKU" }), _jsx(TableCell, { sx: { fontWeight: 700, fontSize: 11 }, children: "Supplier Barcode" }), _jsx(TableCell, { sx: { fontWeight: 700, fontSize: 11, width: 80 } })] }) }), _jsxs(TableBody, { children: [filtered.map((item) => (_jsxs(TableRow, { hover: true, children: [_jsxs(TableCell, { sx: { fontFamily: 'monospace', fontSize: 11 }, children: [item.lasyncro_variant_id.slice(0, 8), "\u2026"] }), _jsx(TableCell, { sx: { fontSize: 12 }, children: item.sku ?? _jsx(Typography, { variant: "caption", color: "text.disabled", children: "\u2014" }) }), _jsx(TableCell, { sx: { fontFamily: 'monospace', fontSize: 12, fontWeight: 700 }, children: editingId === item.lasyncro_variant_id ? (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.75 }, children: [_jsx(TextField, { size: "small", value: editValue, onChange: (e) => setEditValue(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter')
                                                                    void handleSave(item.lasyncro_variant_id); if (e.key === 'Escape')
                                                                    setEditingId(null); }, autoFocus: true, inputProps: { style: { fontFamily: 'monospace', fontSize: 12, padding: '2px 6px' } }, sx: { width: 140 }, error: !!saveError, helperText: saveError ?? undefined }), _jsx(Box, { onClick: () => void handleSave(item.lasyncro_variant_id), sx: { px: 1, py: 0.25, borderRadius: 1, bgcolor: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }, children: saving ? '…' : 'Save' }), _jsx(Box, { onClick: () => setEditingId(null), sx: { fontSize: 11, color: 'var(--ink-4)', cursor: 'pointer' }, children: "\u2715" })] })) : (item.barcode) }), _jsx(TableCell, { children: onUpdateProductBarcode && editingId !== item.lasyncro_variant_id && (_jsx(Box, { onClick: () => { setEditingId(item.lasyncro_variant_id); setEditValue(item.barcode ?? ''); setSaveError(null); }, sx: { fontSize: 10, fontWeight: 600, color: 'var(--accent)', cursor: 'pointer', letterSpacing: '0.04em', '&:hover': { textDecoration: 'underline' } }, children: "Edit" })) })] }, item.lasyncro_variant_id))), filtered.length === 0 && (_jsx(TableRow, { children: _jsx(TableCell, { colSpan: 4, sx: { textAlign: 'center', color: 'text.secondary', py: 3 }, children: "No results match your filter." }) }))] })] }) })), unassigned.length > 0 && (_jsxs(Paper, { variant: "outlined", sx: { borderRadius: 2 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5, cursor: 'pointer' }, onClick: () => setShowUnassigned((v) => !v), children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1 }, children: [_jsxs(Typography, { variant: "body2", color: "text.secondary", children: [unassigned.length, " product", unassigned.length > 1 ? 's' : '', " without barcode"] }), _jsx(Chip, { label: "No barcode", size: "small", color: "default" })] }), _jsx(IconButton, { size: "small", children: showUnassigned ? _jsx(ChevronUp, { size: 16 }) : _jsx(ChevronDown, { size: 16 }) })] }), _jsxs(Collapse, { in: showUnassigned, children: [_jsx(Divider, {}), _jsxs(Table, { size: "small", children: [_jsx(TableHead, { children: _jsxs(TableRow, { children: [_jsx(TableCell, { sx: { fontWeight: 700, fontSize: 11 }, children: "LaSyncro ID" }), _jsx(TableCell, { sx: { fontWeight: 700, fontSize: 11 }, children: "SKU" }), _jsx(TableCell, { sx: { fontWeight: 700, fontSize: 11, width: 160 } })] }) }), _jsx(TableBody, { children: unassigned.map((item) => (_jsxs(TableRow, { hover: true, children: [_jsxs(TableCell, { sx: { fontFamily: 'monospace', fontSize: 11 }, children: [item.lasyncro_variant_id.slice(0, 8), "\u2026"] }), _jsx(TableCell, { sx: { fontSize: 12 }, children: item.sku ?? _jsx(Typography, { variant: "caption", color: "text.disabled", children: "\u2014" }) }), _jsx(TableCell, { children: onPrintProductBarcode && (_jsxs(Box, { onClick: () => { if (printingId !== item.lasyncro_variant_id)
                                                                    void handlePrint(item.lasyncro_variant_id); }, sx: {
                                                                    display: 'inline-flex', alignItems: 'center', gap: 0.5,
                                                                    px: 1.25, py: 0.5,
                                                                    fontSize: 11, fontWeight: 600,
                                                                    whiteSpace: 'nowrap',
                                                                    bgcolor: printError === item.lasyncro_variant_id ? 'var(--critical-ink)' : 'var(--accent)',
                                                                    color: 'var(--accent-ink)',
                                                                    borderRadius: '6px',
                                                                    cursor: printingId === item.lasyncro_variant_id ? 'wait' : 'pointer',
                                                                    opacity: printingId === item.lasyncro_variant_id ? 0.6 : 1,
                                                                    '&:hover': { opacity: printingId === item.lasyncro_variant_id ? 0.6 : 0.88 },
                                                                }, children: [_jsx(Tag, { size: 11 }), printingId === item.lasyncro_variant_id ? 'Printing…' : printError === item.lasyncro_variant_id ? 'Retry' : 'Print label'] })) })] }, item.lasyncro_variant_id))) })] })] })] }))] }))] }));
}
// SHOP-REV-01m cycle 2: moved out of PrintPreviewPanel so products can supply
// their own list. Must match SHEET_FORMATS in warehouseLabelPdf.service.ts.
const LOCATION_LABEL_FORMATS = [
    { id: 'avery-5160', label: 'Avery 5160 · 24/sheet', labelsPerSheet: 24, columns: 3, labelWidthMm: 66, labelHeightMm: 25, paperSize: 'A4' },
    { id: 'avery-5163', label: 'Avery 5163 · 10/sheet · large', labelsPerSheet: 10, columns: 2, labelWidthMm: 101, labelHeightMm: 51, paperSize: 'A4' },
    { id: 'zebra-4x6', label: 'Zebra 4×6 thermal', labelsPerSheet: 1, columns: 1, labelWidthMm: 101, labelHeightMm: 152, paperSize: '4x6' },
    { id: 'dymo-1x2', label: 'Dymo 1×2.125', labelsPerSheet: 1, columns: 1, labelWidthMm: 25, labelHeightMm: 54, paperSize: '1x2' },
];
const FILTER_PILLS = [
    { label: 'ALL', value: 'all' },
    { label: 'BIN', value: 'bin' },
    { label: 'LANE', value: 'lane' },
    { label: 'SHELF', value: 'shelf' },
    { label: 'WAREHOUSE', value: 'warehouse' },
    { label: 'TOTE', value: 'tote' },
    { label: 'DOCK', value: 'dock' },
    { label: 'SHIP', value: 'ship' },
    { label: 'PACK', value: 'pack' },
    { label: 'RET', value: 'ret' },
    { label: 'KIT', value: 'kit' },
];
function BarcodesTab({ zones, productBarcodes, onUpdateProductBarcode, activeSubTab, onSubTabChange, onBatchPrintBarcodes, onPrintProductBarcode }) {
    const [subTab, setSubTab] = useState(activeSubTab ?? 'locations');
    const [locFilter, setLocFilter] = useState('all');
    const [locSearch, setLocSearch] = useState('');
    const [selected, setSelected] = useState(new Set());
    const toggleOne = (code) => setSelected((prev) => { const s = new Set(prev); s.has(code) ? s.delete(code) : s.add(code); return s; });
    const toggleAll = (codes) => setSelected((prev) => prev.size === codes.length ? new Set() : new Set(codes));
    const barcoded = zones.filter((z) => z.barcode !== null);
    const missing = zones.filter((z) => z.barcode === null);
    // Aisles fully labelled: lane-type zones that have a barcode assigned
    const aisles = zones.filter((z) => z.type === 'lane');
    const aislesLabelled = aisles.filter((z) => z.barcode !== null);
    const fullLabelled = aisles.length;
    const filteredZones = zones.filter((z) => {
        const matchesType = locFilter === 'all' || z.type === locFilter;
        const matchesSearch = !locSearch || z.location_code.toLowerCase().includes(locSearch.toLowerCase()) || z.barcode?.toLowerCase().includes(locSearch.toLowerCase());
        return matchesType && matchesSearch;
    });
    // SHOP-REV-01m: the barcoded + active filter moved here from inside
    // PrintPreviewPanel — it is a location concept with no product equivalent.
    const selectedZoneLabels = zones
        .filter((z) => selected.has(z.location_code) && z.barcode !== null && z.active)
        .map((z) => ({ id: z.location_code, code: z.location_code, caption: z.location_code }));
    const allFilteredCodes = filteredZones.map((z) => z.location_code);
    const allSelected = allFilteredCodes.length > 0 && allFilteredCodes.every((c) => selected.has(c));
    return (_jsxs(Box, { children: [_jsxs(Typography, { sx: { fontSize: 12, color: 'var(--ink-4)', mb: 1.5 }, children: ["Unit labels (LSU) are generated at receiving and tracked in", ' ', _jsx(Box, { component: "a", href: "/settings/warehouse", sx: { color: 'var(--accent)', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }, children: "Settings \u2192 Warehouse" }), ". Codes below locate stock (location codes) and identify products (Shopify EAN/UPC, a camera-scan fallback)."] }), _jsx(Box, { sx: { display: 'flex', gap: 1, mb: 3 }, children: ['locations', 'products'].map((st) => (_jsx(Box, { onClick: () => { setSubTab(st); onSubTabChange?.(st); }, sx: {
                        px: 2, py: 0.75, borderRadius: 1.5, cursor: 'pointer', fontSize: 13, fontWeight: 500,
                        border: '1px solid',
                        borderColor: subTab === st ? 'var(--accent)' : 'var(--rule)',
                        color: subTab === st ? 'var(--accent)' : 'var(--ink-3)',
                        bgcolor: subTab === st ? 'var(--accent-ghost)' : 'transparent',
                        transition: 'all 0.15s',
                    }, children: st === 'locations' ? `Location codes  ${zones.length}` : `Product barcodes  ${productBarcodes.length}` }, st))) }), subTab === 'locations' && (_jsxs(Box, { sx: { display: 'flex', gap: 3, alignItems: 'flex-start' }, children: [_jsxs(Box, { sx: { flex: 1, minWidth: 0 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }, children: [_jsx(TextField, { placeholder: "Filter by code or zone...", size: "small", value: locSearch, onChange: (e) => setLocSearch(e.target.value), sx: { width: 220 }, InputProps: { sx: { fontFamily: 'monospace', fontSize: 12 } } }), _jsx(Box, { sx: { display: 'flex', gap: 0.75 }, children: FILTER_PILLS.map(({ label, value }) => (_jsx(Box, { onClick: () => setLocFilter(value), sx: {
                                                px: 1.25, py: 0.4, borderRadius: 1, cursor: 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
                                                border: '1px solid',
                                                borderColor: locFilter === value ? 'var(--accent)' : 'var(--rule)',
                                                color: locFilter === value ? 'var(--accent)' : 'var(--ink-4)',
                                                bgcolor: locFilter === value ? 'var(--accent-ghost)' : 'transparent',
                                                transition: 'all 0.12s',
                                            }, children: label }, value))) })] }), _jsx(Box, { sx: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }, children: _jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: "Location codes \u00B7 Bin, shelf & zone labels \u00B7 This Floor" }) }), _jsx(Box, { sx: { display: 'flex', gap: 2, mb: 3 }, children: [
                                    { label: 'Total locations', value: zones.length, color: 'var(--ink)' },
                                    { label: 'Barcoded', value: barcoded.length, color: 'var(--accent)' },
                                    { label: 'Missing barcode', value: missing.length, color: missing.length > 0 ? 'var(--accent)' : 'var(--ink-3)' },
                                    // Shows barcoded/total aisles fraction — matches target design "6/7" format
                                    { label: 'Aisles fully labelled', value: `${aislesLabelled.length}/${aisles.length}`, color: 'var(--ink)' },
                                ].map(({ label, value, color }) => (_jsxs(Box, { sx: { flex: 1, p: 2, border: '1px solid var(--rule)', borderRadius: 2, bgcolor: 'var(--bg-2)' }, children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.5 }, children: label }), _jsx(Typography, { sx: { fontSize: 28, fontWeight: 500, color, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }, children: value })] }, label))) }), _jsx(TableContainer, { component: Paper, variant: "outlined", sx: { borderRadius: 2 }, children: _jsxs(Table, { size: "small", children: [_jsx(TableHead, { children: _jsxs(TableRow, { children: [_jsx(TableCell, { padding: "checkbox", sx: { width: 40 }, children: _jsx(Checkbox, { size: "small", checked: allSelected, indeterminate: selected.size > 0 && !allSelected, onChange: () => toggleAll(allFilteredCodes), sx: { color: 'var(--ink-4)', '&.Mui-checked': { color: 'var(--accent)' }, '&.MuiCheckbox-indeterminate': { color: 'var(--accent)' } } }) }), _jsx(TableCell, { sx: { fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: "Code" }), _jsx(TableCell, { sx: { fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: "Type" }), _jsx(TableCell, { sx: { fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: "Zone" }), _jsx(TableCell, { sx: { fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: "Barcode" }), _jsx(TableCell, { sx: { fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: "Last Printed" }), _jsx(TableCell, { sx: { fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: "Status" })] }) }), _jsx(TableBody, { children: filteredZones.length === 0 ? (_jsx(TableRow, { children: _jsx(TableCell, { colSpan: 7, sx: { textAlign: 'center', color: 'var(--ink-4)', py: 4 }, children: "No locations configured. Add zones in Setup." }) })) : (filteredZones.map((z) => (_jsxs(TableRow, { hover: true, selected: selected.has(z.location_code), onClick: () => toggleOne(z.location_code), sx: { cursor: 'pointer' }, children: [_jsx(TableCell, { padding: "checkbox", children: _jsx(Checkbox, { size: "small", checked: selected.has(z.location_code), onChange: () => toggleOne(z.location_code), onClick: (e) => e.stopPropagation(), sx: { color: 'var(--ink-4)', '&.Mui-checked': { color: 'var(--accent)' } } }) }), _jsx(TableCell, { sx: { fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }, children: z.location_code }), _jsx(TableCell, { children: _jsx(Chip, { label: TYPE_LABELS[z.type]?.label ?? z.type, size: "small", color: TYPE_LABELS[z.type]?.color ?? 'default' }) }), _jsx(TableCell, { sx: { fontSize: 11, color: 'var(--ink-3)', textTransform: 'capitalize' }, children: z.zone_type ?? z.parent_location_code ?? _jsx(Typography, { component: "span", sx: { color: 'var(--ink-4)', fontSize: 11 }, children: "\u2014" }) }), _jsx(TableCell, { sx: { fontFamily: 'monospace', fontSize: 11 }, children: z.barcode ?? _jsx(Typography, { component: "span", sx: { color: 'var(--ink-4)', fontSize: 11 }, children: "No barcode" }) }), _jsx(TableCell, { sx: { fontSize: 11, color: 'var(--ink-4)' }, children: z.last_printed_at
                                                            ? new Date(z.last_printed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                                                            : _jsx(Typography, { component: "span", sx: { color: 'var(--ink-4)', fontSize: 11, fontStyle: 'italic' }, children: "Never" }) }), _jsx(TableCell, { children: z.active
                                                            ? _jsx(Typography, { sx: { fontSize: 11, fontWeight: 600, color: 'var(--accent)' }, children: "\u2713 ACTIVE" })
                                                            : _jsx(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)' }, children: "INACTIVE" }) })] }, z.location_code)))) })] }) })] }), _jsx(Box, { sx: {
                            width: selected.size > 0 ? 260 : 0,
                            opacity: selected.size > 0 ? 1 : 0,
                            overflow: 'hidden',
                            transition: 'width 0.25s ease, opacity 0.2s ease',
                            flexShrink: 0,
                        }, children: _jsx(PrintPreviewPanel, { items: selectedZoneLabels, formats: LOCATION_LABEL_FORMATS, defaultFormatId: "avery-5160", emptyMessage: "No barcoded locations", onBatchPrint: onBatchPrintBarcodes }) })] })), subTab === 'products' && (_jsxs(Box, { children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 2 }, children: [_jsx(PackageSearch, { size: 18 }), _jsx(Typography, { variant: "subtitle1", fontWeight: 700, children: "Product Barcodes" }), _jsx(Chip, { label: productBarcodes.length, size: "small" })] }), _jsx(ProductBarcodesTable, { items: productBarcodes, onUpdateProductBarcode: onUpdateProductBarcode, onPrintProductBarcode: onPrintProductBarcode })] }))] }));
}
function FloorPlanningModuleFT2Inner({ data, isLoading, isError, gridLocations, gridOccupancy, isGridLoading, onRefresh, binLog, isBinLogLoading, onBinLogOpen, binStats, onBinSelect, variantFocusBins, onCreateZone, onDeleteZone, onPrintBarcode, onToggleZoneActive, onUpdateZone, onUpdateProductBarcode, onPrintProductBarcode, onTabChange, activeTab, activeView, onViewChange, activeSubTab, onSubTabChange, onBatchPrintBarcodes, }) {
    const zones = data?.zones ?? [];
    const productBarcodes = data?.product_barcodes ?? [];
    const [tab, setTab] = useState(activeTab ?? 'map');
    const [selectedBin, setSelectedBin] = useState();
    const [overlay, setOverlay] = useState('occupancy');
    // Default to every supported operational zone so active locations never disappear silently.
    const [zoneFilters, setZoneFilters] = useState(new Set(['pick', 'pack', 'receive', 'ship', 'returns', 'problem', 'quarantine', 'kitting', 'storage']));
    const [canvasView, setCanvasView] = useState(activeView === 'canvas');
    const [setupFilter, setSetupFilter] = useState('all');
    // Layer visibility — wired to Layers rail in Map tab.
    const [showFloor, setShowFloor] = useState(true);
    const [showBins, setShowBins] = useState(true);
    // Derive grid props from overlay selection
    const overlayGridMode = overlay === 'none' ? 'map' : overlay === 'stockout' || overlay === 'empty' ? 'focus' : 'heatmap';
    // FP-SUMMARY1: always-on counts for the headline strip, independent of
    // which overlay is currently selected — a merchant looking at Occupancy
    // should still see "3 at risk" without switching views. Same predicates
    // as overlayFocusedBins (at risk: qty > 0 && qty <= 3; empty: qty === 0)
    // but computed together rather than gated behind `overlay ===`.
    const summaryCounts = useMemo(() => {
        const bins = (gridLocations ?? []).filter(l => l.type === 'bin');
        let atRisk = 0, empty = 0;
        for (const l of bins) {
            const qty = gridOccupancy?.[l.location_code]?.on_hand_quantity ?? 0;
            if (qty === 0)
                empty;
            else if (qty <= 3)
                atRisk++;
        }
        return { atRisk, empty, total: bins.length };
    }, [gridLocations, gridOccupancy]);
    const overlayFocusedBins = useMemo(() => {
        if (overlay === 'empty') {
            return (gridLocations ?? [])
                .filter(l => l.type === 'bin' && ((gridOccupancy?.[l.location_code]?.on_hand_quantity ?? 0) === 0))
                .map(l => l.location_code);
        }
        if (overlay === 'stockout') {
            // Bins with stock but critically low — on_hand_quantity > 0 but <= 3 units
            return (gridLocations ?? [])
                .filter(l => l.type === 'bin')
                .filter(l => {
                const qty = gridOccupancy?.[l.location_code]?.on_hand_quantity ?? 0;
                return qty > 0 && qty <= 3;
            })
                .map(l => l.location_code);
        }
        return undefined;
    }, [overlay, gridLocations, gridOccupancy]);
    const filteredGridLocations = useMemo(() => 
    // Filter by zone_type — matches filter rail zone checkboxes (pick/pack/receive etc.)
    // Falls back to showing location if zone_type is null (unclassified locations)
    (gridLocations ?? []).filter(l => l.zone_type == null || zoneFilters.has(l.zone_type)), [gridLocations, zoneFilters]);
    const handleBinSelect = useCallback((lc) => {
        setSelectedBin((p) => {
            const next = p === lc ? undefined : lc;
            onBinSelect?.(next ?? '');
            return next;
        });
    }, [onBinSelect]);
    const [logOpen, setLogOpen] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [createType, setCreateType] = useState('bin');
    const [createCode, setCreateCode] = useState('');
    const [createParent, setCreateParent] = useState('');
    const [createError, setCreateError] = useState(null);
    const [creating, setCreating] = useState(false);
    const [createLoading, setCreateLoading] = useState(false);
    const binCount = (gridLocations ?? []).filter((l) => l.type === 'bin').length;
    const setupCount = zones.length;
    // Badge = location codes still MISSING a barcode (the to-do signal).
    // Never sum across barcode systems — location codes (WM-28) and product
    // codes (EAN/UPC coupling) are distinct namespaces; LSU unit labels live in Settings → Warehouse.
    const barcodesCount = zones.filter((z) => z.barcode === null).length;
    const handleCreate = async () => {
        if (!createCode.trim()) {
            setCreateError('Location code is required');
            return;
        }
        setCreating(true);
        setCreateError(null);
        try {
            await onCreateZone?.({
                location_code: createCode.trim().toUpperCase(),
                type: createType,
                parent_location_code: createParent.trim() || undefined,
            });
            setCreateCode('');
            setCreateParent('');
            setCreateOpen(false);
        }
        catch (err) {
            setCreateError(err?.response?.data?.error ?? 'Failed to create zone');
        }
        finally {
            setCreating(false);
        }
    };
    return (_jsxs(Box, { sx: { p: '32px 40px', height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'var(--bg)' }, children: [(() => {
                const now = new Date();
                const dayLabel = now.toLocaleDateString('en-GB', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
                return (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }, children: [_jsx(Box, { sx: { width: 6, height: 6, borderRadius: '50%', bgcolor: 'var(--accent)', flexShrink: 0 } }), _jsxs(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: [dayLabel, " \u00B7 Warehouse \u00B7 Floor 1"] })] }));
            })(), tab === 'map' && (() => {
                const bins = (gridLocations ?? []).filter((l) => l.type === 'bin');
                const aisles = new Set(bins
                    .filter((l) => l.zone_type !== 'quarantine' && l.parent_location_code != null)
                    .map((l) => l.parent_location_code)).size;
                const hot = Object.values(gridOccupancy ?? {}).filter((o) => o.on_hand_quantity > 0).length;
                const subLine = bins.length > 0
                    ? `${bins.length} bin${bins.length !== 1 ? 's' : ''} across ${aisles} aisle${aisles !== 1 ? 's' : ''} · ${hot} bin${hot !== 1 ? 's' : ''} with stock`
                    : 'No bins configured yet — add aisles and bins in Setup.';
                return _jsxs(_Fragment, { children: [_jsx(Typography, { sx: { fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }, children: "Floor planning today" }), _jsx(Typography, { sx: { fontSize: 13, color: 'var(--ink-3)', mt: 1, mb: 0.5 }, children: subLine })] });
            })(), tab === 'setup' && _jsxs(_Fragment, { children: [_jsx(Typography, { sx: { fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }, children: "Build your warehouse." }), _jsx(Typography, { sx: { fontSize: 13, color: 'var(--ink-3)', mt: 1, mb: 0.5 }, children: "Configure aisles, shelves, and bins. Your layout is the foundation of every pick." })] }), tab === 'setup' && !canvasView && (_jsx(Box, { sx: { display: 'flex', gap: 0.75, mb: 2, flexWrap: 'wrap' }, children: FILTER_PILLS.map(({ label, value }) => (_jsx(Box, { onClick: () => setSetupFilter(value), sx: {
                        px: 1.25, py: 0.4, borderRadius: 1, cursor: 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
                        border: '1px solid',
                        borderColor: setupFilter === value ? 'var(--accent)' : 'var(--rule)',
                        color: setupFilter === value ? 'var(--accent)' : 'var(--ink-4)',
                        bgcolor: setupFilter === value ? 'var(--accent-ghost)' : 'transparent',
                        transition: 'all 0.12s',
                    }, children: label }, value))) })), tab === 'barcodes' && (() => {
                const barcodedLocs = zones.filter((z) => z.barcode !== null).length;
                const missingLocs = zones.filter((z) => z.barcode === null).length;
                const barcodedProducts = productBarcodes.filter((p) => p.barcode !== null).length;
                const missingProducts = productBarcodes.filter((p) => p.barcode === null).length;
                // Two systems kept separate — never co-mingled into one "missing" count (WMS-FP-04).
                const subLine = zones.length > 0 || productBarcodes.length > 0
                    // SHOP-REV-01h: previously ended "Generate or import to clear."
                    // Products are not cleared by bulk generation — unit identity comes
                    // from receive (LSU-). A product without a supplier barcode gets a
                    // printable laSyncro label (LSP-) on demand instead.
                    ? `Location codes: ${barcodedLocs}/${zones.length} labelled${missingLocs > 0 ? ` · ${missingLocs} missing` : ''}  —  Product barcodes: ${barcodedProducts}/${productBarcodes.length}${missingProducts > 0 ? ` · ${missingProducts} without a supplier barcode — print a laSyncro label for these` : ''}.`
                    : 'No locations or products found. Add zones in Setup and sync products.';
                return _jsxs(_Fragment, { children: [_jsx(Typography, { sx: { fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }, children: "            Every location, every product." }), _jsx(Typography, { sx: { fontSize: 13, color: 'var(--ink-3)', mt: 1, mb: 0.5 }, children: subLine })] });
            })(), _jsx(Box, { sx: { mx: '-40px', px: '40px', bgcolor: 'var(--bg-2)', borderBottom: '1px solid var(--rule)', mb: 3 }, children: _jsxs(Tabs, { value: tab, onChange: (_, v) => { setTab(v); onTabChange?.(v); }, sx: { borderBottom: 'none' }, children: [_jsx(Tab, { icon: _jsx(Map, { size: 15 }), iconPosition: "start", value: "map", sx: { minHeight: 40, fontSize: 13 }, label: _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.75 }, children: ["Map", binCount > 0 && _jsx(Box, { component: "span", sx: { px: 0.75, borderRadius: 1, bgcolor: 'var(--accent)', color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: 1.6 }, children: binCount })] }) }), _jsx(Tab, { icon: _jsx(LayoutDashboard, { size: 15 }), iconPosition: "start", value: "setup", sx: { minHeight: 40, fontSize: 13 }, label: _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.75 }, children: ["Setup", setupCount > 0 && _jsx(Box, { component: "span", sx: { px: 0.75, borderRadius: 1, bgcolor: 'var(--accent)', color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: 1.6 }, children: setupCount })] }) }), _jsx(Tab, { icon: _jsx(Tag, { size: 15 }), iconPosition: "start", value: "barcodes", sx: { minHeight: 40, fontSize: 13 }, label: _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.75 }, children: ["Barcodes", barcodesCount > 0 && _jsx(Box, { component: "span", sx: { px: 0.75, borderRadius: 1, bgcolor: 'var(--accent)', color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: 1.6 }, children: barcodesCount })] }) })] }) }), tab === 'map' && (_jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }, children: [isGridLoading && _jsx(ModuleLoadingSkeleton, {}), !isGridLoading && (_jsxs(Box, { sx: { display: 'flex', gap: 2, flex: 1, position: 'relative', overflow: 'hidden' }, children: [_jsxs(Box, { sx: { width: 180, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2.5, height: '100%', overflowY: 'auto', pr: 0.5 }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }, children: "View Overlay" }), [
                                                { id: 'occupancy', label: 'Occupancy', sub: 'How full each bin is.' },
                                                { id: 'stockout', label: 'Stock-out risk', sub: 'Bins low on stock (≤3 units).' },
                                                { id: 'empty', label: 'Empty bins', sub: 'Available capacity.' },
                                                { id: 'none', label: 'No overlay', sub: 'Just the layout.' },
                                            ].map((o) => (_jsxs(Box, { onClick: () => setOverlay(o.id), sx: {
                                                    px: 1.5, py: 1, mb: 0.5, borderRadius: 1.5, cursor: 'pointer',
                                                    bgcolor: overlay === o.id ? 'var(--accent-ghost)' : 'transparent',
                                                    border: '1px solid',
                                                    borderColor: overlay === o.id ? 'var(--accent-border)' : 'transparent',
                                                    transition: 'all 0.12s',
                                                    '&:hover': { bgcolor: 'var(--bg-2)' },
                                                }, children: [_jsx(Typography, { sx: { fontSize: 12, fontWeight: overlay === o.id ? 700 : 500, color: overlay === o.id ? 'var(--accent)' : 'var(--ink)' }, children: o.label }), _jsx(Typography, { sx: { fontSize: 10, color: 'var(--ink-4)', lineHeight: 1.3 }, children: o.sub })] }, o.id)))] }), _jsx(Divider, {}), _jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }, children: "Filter" }), [
                                                { type: 'pick', label: 'Pick zone' },
                                                { type: 'pack', label: 'Pack zone' },
                                                { type: 'receive', label: 'Receiving' },
                                                { type: 'ship', label: 'Shipping' },
                                                { type: 'returns', label: 'Returns' },
                                                { type: 'problem', label: 'Problem area' },
                                                { type: 'quarantine', label: 'Quarantine' },
                                                { type: 'kitting', label: 'Kitting' },
                                                { type: 'storage', label: 'Storage' },
                                            ].map(({ type, label }) => {
                                                const count = (gridLocations ?? []).filter(l => l.zone_type === type).length;
                                                const active = zoneFilters.has(type);
                                                return (_jsxs(Box, { onClick: () => setZoneFilters(prev => {
                                                        const next = new Set(prev);
                                                        next.has(type) ? next.delete(type) : next.add(type);
                                                        return next;
                                                    }), sx: { display: 'flex', alignItems: 'center', gap: 1, py: 0.4, cursor: 'pointer' }, children: [_jsx(Box, { sx: {
                                                                width: 12, height: 12, borderRadius: 0.5, flexShrink: 0,
                                                                border: '1.5px solid', borderColor: active ? 'var(--accent)' : 'var(--rule)',
                                                                bgcolor: active ? 'var(--accent)' : 'transparent',
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            }, children: active && _jsx(Box, { sx: { width: 6, height: 6, bgcolor: '#fff', borderRadius: 0.25 } }) }), _jsx(Typography, { sx: { fontSize: 11, color: 'var(--ink-2)' }, children: label }), count > 0 && (_jsx(Typography, { sx: { fontSize: 10, color: 'var(--ink-4)', ml: 'auto' }, children: count }))] }, type));
                                            })] }), _jsx(Divider, {}), _jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }, children: "Layers" }), ([
                                                { label: 'Floor & grid', active: showFloor, onToggle: () => setShowFloor(p => !p) },
                                                { label: 'Bins', active: showBins, onToggle: () => setShowBins(p => !p) },
                                                { label: 'Tote markers', active: false, onToggle: undefined }, // Phase 3
                                                { label: 'Pick path', active: false, onToggle: undefined }, // Phase 3
                                            ]).map(({ label, active, onToggle }) => (_jsxs(Box, { onClick: onToggle ?? undefined, sx: { display: 'flex', alignItems: 'center', gap: 1, py: 0.4, cursor: onToggle ? 'pointer' : 'not-allowed', opacity: onToggle ? 1 : 0.4 }, children: [_jsx(Box, { sx: {
                                                            width: 12, height: 12, borderRadius: 0.5, flexShrink: 0,
                                                            border: '1.5px solid', borderColor: active ? 'var(--accent)' : 'var(--rule)',
                                                            bgcolor: active ? 'var(--accent)' : 'transparent',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        }, children: active && _jsx(Box, { sx: { width: 6, height: 6, bgcolor: '#fff', borderRadius: 0.25 } }) }), _jsx(Typography, { sx: { fontSize: 11, color: 'var(--ink-2)' }, children: label })] }, label)))] }), _jsx(Divider, {}), _jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }, children: "Surfaced Today" }), _jsx(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }, children: "Live signals in Phase 2c" })] })] }), _jsx(Box, { sx: { flex: 1, overflowX: 'auto' }, children: _jsx(IsometricCanvas, { zones: zones, onSelect: (code) => code && handleBinSelect(code), filteredCodes: new Set(filteredGridLocations.map(l => l.location_code)), 
                                    /* Each overlay owns one visual language: heatmap or semantic focus. */
                                    occupancy: overlay === 'occupancy' ? gridOccupancy : undefined, focusedBins: overlayFocusedBins, focusTone: overlay === 'stockout' ? 'risk' : overlay === 'empty' ? 'empty' : undefined, showFloor: showFloor, showBins: showBins, onUnplacedZonesClick: () => setTab('setup'), overlay: overlay, summaryCounts: summaryCounts, onRefresh: onRefresh }) }), selectedBin && (() => {
                                const occ = gridOccupancy?.[selectedBin];
                                const totalUnits = occ?.on_hand_quantity ?? 0;
                                // Capacity derived from rack_levels × estimated units per level (10).
                                // Falls back to 48 if rack_levels not set. Phase 3: use real capacity field.
                                const selectedLocation = (gridLocations ?? []).find(l => l.location_code === selectedBin);
                                const CAPACITY = selectedLocation?.rack_levels != null
                                    ? parseFloat(String(selectedLocation.rack_levels)) * 10
                                    : 48;
                                const pct = Math.min(100, Math.round((totalUnits / CAPACITY) * 100));
                                const pctColor = pct >= 85
                                    ? 'var(--accent)'
                                    : pct >= 55
                                        ? 'rgba(245,158,11,0.9)'
                                        : pct > 0
                                            ? 'rgba(34,197,94,0.9)'
                                            : 'var(--ink-4)';
                                // Aisle from parent_location_code, not string-split (consistent with WMS-FP-01/02).
                                const aisleLabel = selectedLocation?.parent_location_code ?? '—';
                                return (_jsxs(Paper, { variant: "outlined", sx: { width: 240, p: 2.5, borderRadius: 2, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.5 }, children: "BIN" }), _jsx(Typography, { sx: { fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: 'var(--ink)', lineHeight: 1.1 }, children: selectedBin }), _jsxs(Typography, { sx: { fontSize: 11, color: 'var(--ink-3)', mt: 0.25 }, children: ["Aisle ", aisleLabel] })] }), _jsx(Divider, {}), _jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }, children: "OCCUPANCY" }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'baseline', gap: 1, mb: 1 }, children: [_jsxs(Typography, { sx: { fontSize: 28, fontWeight: 500, color: pctColor, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }, children: [pct, "%"] }), _jsxs(Typography, { sx: { fontSize: 11, color: 'var(--ink-3)' }, children: [totalUnits, " of ", CAPACITY] })] }), _jsx(Box, { sx: { height: 4, borderRadius: 2, bgcolor: 'var(--bg-3)', overflow: 'hidden' }, children: _jsx(Box, { sx: { height: '100%', width: `${pct}%`, bgcolor: pctColor, borderRadius: 2, transition: 'width 0.3s ease' } }) })] }), _jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }, children: "CONTENTS" }), occ?.variants.length ? (occ.variants.map((v) => (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, p: 1, bgcolor: 'var(--bg-2)', borderRadius: 1, mb: 0.75 }, children: [_jsxs(Box, { sx: { flex: 1, minWidth: 0 }, children: [_jsx(Typography, { sx: { fontSize: 12, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: v.sku ?? v.lasyncro_variant_id.slice(0, 8) }), v.product_title && (_jsx(Typography, { sx: { fontSize: 10, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: v.product_title }))] }), _jsxs(Typography, { sx: { fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', flexShrink: 0 }, children: [v.on_hand_quantity, " units"] })] }, v.lasyncro_variant_id)))) : (_jsx(Typography, { sx: { fontSize: 12, color: 'var(--ink-4)' }, children: "Empty bin" }))] }), _jsxs(Box, { onClick: () => { onBinLogOpen?.(selectedBin); setLogOpen(true); }, sx: {
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                gap: 0.75, px: 2, py: 1, borderRadius: 1.5, cursor: 'pointer',
                                                border: '1px solid var(--accent)', color: 'var(--accent)',
                                                fontSize: 12, fontWeight: 600,
                                                transition: 'all 0.15s',
                                                '&:hover': { bgcolor: 'var(--accent)', color: '#fff' },
                                            }, children: [_jsx(ScrollText, { size: 13 }), "See logs"] }), _jsx(Divider, {}), _jsx(Box, { sx: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }, children: [
                                                {
                                                    label: 'PICKS · 7D',
                                                    value: binStats?.location_code === selectedBin
                                                        ? String(binStats.picks_7d)
                                                        : '—',
                                                },
                                                {
                                                    label: 'LAST PICK',
                                                    value: binStats?.location_code === selectedBin && binStats.last_pick_at
                                                        ? (() => {
                                                            const diff = Date.now() - new Date(binStats.last_pick_at).getTime();
                                                            const h = Math.floor(diff / 3600000);
                                                            const d = Math.floor(diff / 86400000);
                                                            return h < 24 ? `${h}h ago` : `${d}d ago`;
                                                        })()
                                                        : '—',
                                                },
                                                {
                                                    label: 'REORDER IN',
                                                    value: binStats?.location_code === selectedBin && binStats.reorder_in_days !== null
                                                        ? `${binStats.reorder_in_days}d`
                                                        : '—',
                                                },
                                                { label: 'TOTE', value: '—' }, // Phase 3 — requires tote container data model
                                            ].map(({ label, value }) => (_jsxs(Box, { sx: { p: 1, bgcolor: 'var(--bg-2)', borderRadius: 1 }, children: [_jsx(Typography, { sx: { fontSize: 9, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.25 }, children: label }), _jsx(Typography, { sx: { fontSize: 16, fontWeight: 500, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }, children: value })] }, label))) }), _jsx(Divider, {}), _jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', gap: 0.75 }, children: [_jsxs(Box, { sx: {
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75,
                                                        py: 1, borderRadius: 1.5, bgcolor: 'var(--accent)', color: '#fff',
                                                        fontSize: 11, fontWeight: 600, cursor: 'pointer',
                                                        '&:hover': { opacity: 0.9 }, transition: 'opacity 0.15s',
                                                    }, children: [_jsx(ScrollText, { size: 12 }), "Print bin label"] }), _jsxs(Box, { sx: { display: 'flex', gap: 0.75 }, children: [_jsx(Box, { sx: {
                                                                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                py: 0.75, borderRadius: 1.5, border: '1px solid var(--rule)',
                                                                fontSize: 11, fontWeight: 500, color: 'var(--ink-3)', cursor: 'pointer',
                                                                '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' }, transition: 'all 0.15s',
                                                            }, children: "Replenish" }), _jsx(Box, { sx: {
                                                                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                py: 0.75, borderRadius: 1.5, border: '1px solid var(--rule)',
                                                                fontSize: 11, fontWeight: 500, color: 'var(--ink-3)', cursor: 'pointer',
                                                                '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' }, transition: 'all 0.15s',
                                                            }, children: "Move" })] })] })] }));
                            })()] })), _jsx(BinLogDrawer, { locationCode: selectedBin ?? '', events: binLog?.events ?? [], isLoading: isBinLogLoading ?? false, open: logOpen, onClose: () => setLogOpen(false) })] })), isLoading && tab !== 'map' && _jsx(ModuleLoadingSkeleton, {}), isError && tab !== 'map' && (_jsx(Alert, { severity: "error", sx: { mb: 3 }, children: "Failed to load floor planning data. Please refresh." })), !isLoading && !isError && tab === 'setup' && (_jsx(_Fragment, { children: _jsxs(Box, { sx: { mb: 4 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 2 }, children: [_jsx(LayoutDashboard, { size: 18 }), _jsx(Typography, { variant: "subtitle1", fontWeight: 700, children: "Warehouse Zones" }), _jsx(Chip, { label: zones.length, size: "small" }), _jsxs(Box, { sx: { ml: 'auto', display: 'flex', gap: 1 }, children: [_jsx(Box, { sx: { display: 'flex', border: '1px solid var(--rule)', borderRadius: 1.5, overflow: 'hidden' }, children: [{ label: 'List', val: false }, { label: 'Canvas', val: true }].map(({ label, val }) => (_jsx(Box, { onClick: () => { setCanvasView(val); onViewChange?.(val ? 'canvas' : 'list'); }, sx: {
                                                    px: 1.5, py: 0.6, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                                                    bgcolor: canvasView === val ? 'var(--accent)' : 'transparent',
                                                    color: canvasView === val ? '#fff' : 'var(--ink-3)',
                                                    transition: 'all 0.15s',
                                                }, children: label }, label))) }), _jsxs(Box, { onClick: () => { setCreateOpen(v => !v); setCreateError(null); }, sx: { display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.75, borderRadius: 1.5, cursor: 'pointer', border: '1px solid var(--accent)', color: 'var(--accent)', fontSize: 12, fontWeight: 600, '&:hover': { bgcolor: 'var(--accent)', color: '#fff' }, transition: 'all 0.15s' }, children: [_jsx(Plus, { size: 13 }), "Add zone"] })] })] }), createOpen && (_jsxs(Paper, { variant: "outlined", sx: { p: 2, mb: 2, borderRadius: 2, bgcolor: 'var(--bg-2)' }, children: [_jsx(Typography, { sx: { fontSize: 12, fontWeight: 600, color: 'var(--ink)', mb: 1.5 }, children: "New Zone" }), _jsxs(Box, { sx: { display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-start' }, children: [_jsx(TextField, { label: "Location code", size: "small", value: createCode, onChange: e => setCreateCode(e.target.value.toUpperCase()), placeholder: "e.g. A-5", sx: { width: 160 }, inputProps: { style: { fontFamily: 'monospace' } } }), _jsxs(FormControl, { size: "small", sx: { width: 130 }, children: [_jsx(InputLabel, { children: "Type" }), _jsxs(Select, { value: createType, label: "Type", onChange: e => setCreateType(e.target.value), children: [_jsx(MenuItem, { value: "bin", children: "Bin" }), _jsx(MenuItem, { value: "lane", children: "Lane (Aisle)" }), _jsx(MenuItem, { value: "shelf", children: "Shelf" }), _jsx(MenuItem, { value: "warehouse", children: "Warehouse" })] })] }), _jsx(TextField, { label: "Parent (optional)", size: "small", value: createParent, onChange: e => setCreateParent(e.target.value.toUpperCase()), placeholder: "e.g. A", sx: { width: 160 }, inputProps: { style: { fontFamily: 'monospace' } } }), _jsx(Button, { variant: "contained", size: "small", disabled: createLoading, onClick: handleCreate, sx: { bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent-hover)' }, textTransform: 'none', fontWeight: 600, height: 40 }, children: createLoading ? 'Creating...' : 'Create' }), _jsx(Button, { size: "small", onClick: () => setCreateOpen(false), sx: { height: 40, textTransform: 'none', color: 'var(--ink-3)' }, children: "Cancel" })] }), createError && (_jsx(Typography, { sx: { fontSize: 11, color: 'var(--error, #ef4444)', mt: 1 }, children: createError }))] })), canvasView ? (_jsx(CanvasEditor, { zones: zones, onUpdateZone: onUpdateZone, onDeleteZone: onDeleteZone, onCreateZone: onCreateZone, onPrintBarcode: onPrintBarcode })) : zones.length === 0 ? (_jsxs(Paper, { variant: "outlined", sx: { textAlign: 'center', py: 6, borderRadius: 2, borderStyle: 'dashed' }, children: [_jsx(LayoutDashboard, { size: 36, style: { opacity: 0.3 } }), _jsx(Typography, { variant: "body2", color: "text.secondary", sx: { mt: 2 }, children: "No warehouse zones configured. Add your first zone above." })] })) : ((setupFilter === 'all' ? zones : zones.filter((z) => z.type === setupFilter)).map((zone) => (_jsx(ZoneCard, { zone: zone, onDelete: onDeleteZone, onToggleActive: onToggleZoneActive }, zone.location_code))))] }) })), !isLoading && !isError && tab === 'barcodes' && (_jsx(BarcodesTab, { zones: zones, productBarcodes: productBarcodes, onUpdateProductBarcode: onUpdateProductBarcode, onPrintProductBarcode: onPrintProductBarcode, activeSubTab: activeSubTab, onSubTabChange: onSubTabChange, onBatchPrintBarcodes: onBatchPrintBarcodes }))] }));
}
export default function FloorPlanningModuleFT2(props) {
    return _jsx(ModuleErrorBoundary, { moduleName: "floor-planning", children: _jsx(FloorPlanningModuleFT2Inner, { ...props }) });
}
//# sourceMappingURL=FloorPlanningModuleFT2.js.map