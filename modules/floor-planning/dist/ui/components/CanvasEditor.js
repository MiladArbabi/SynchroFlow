import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// modules/floor-planning/src/ui/components/CanvasEditor.tsx
/**
 * CanvasEditor — 2D SVG floor plan editor (Phase 2)
 * ---------------------------------------------------
 * Three-column layout:
 *   LEFT  — ComponentPalette: draggable zone type tiles + layout templates
 *   CENTER — SVG canvas: positioned racks, pan/zoom, drag-to-reposition, metre rulers
 *   RIGHT  — RackInspector: fixed panel showing editable dimensions, stats, actions
 *
 * Coordinate system: metres from top-left origin, rendered at SCALE px/m.
 * Snap grid: 0.5m.
 * Collision: warehouse zones are frames (no collision). All other zones clamp
 * to nearest non-overlapping edge during drag and resize.
 *
 * Phase 3: same WarehouseLocation data feeds Three.js renderer unchanged.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { Box, Typography, Divider, Chip, IconButton, TextField, Dialog, DialogTitle, DialogActions, Button } from '@mui/material';
import { X, Layers, RotateCw, Copy, Trash2, Tag } from 'lucide-react';
// ── Constants ────────────────────────────────────────────────────────────────
const SCALE = 60;
const SNAP = 0.1;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3.0;
const CANVAS_W = 20;
const CANVAS_H = 15;
const RULER_SIZE = 24;
// Setup and Map share the same live semantic tokens; only face opacity differs.
function zoneRGBA(type, alpha) {
    return `rgba(var(--zone-${type}, 100,116,139),${alpha})`;
}
// FP-01: exported so FloorPlanningModuleFT2.tsx (Setup > List view) can
// reuse the same zone_type -> colour mapping as the Canvas view, instead
// of duplicating a second colour map that could drift out of sync.
export const ZONE_COLORS = {
    lane: zoneRGBA('lane', 0.12),
    warehouse: zoneRGBA('warehouse', 0.08),
    shelf: zoneRGBA('shelf', 0.10),
    pick: zoneRGBA('pick', 0.22),
    pack: zoneRGBA('pack', 0.25),
    receive: zoneRGBA('receive', 0.22),
    ship: zoneRGBA('ship', 0.22),
    returns: zoneRGBA('returns', 0.25),
    problem: zoneRGBA('problem', 0.30),
    quarantine: zoneRGBA('quarantine', 0.35),
    kitting: zoneRGBA('kitting', 0.25),
    storage: zoneRGBA('storage', 0.18),
};
export const ZONE_STROKE = {
    lane: zoneRGBA('lane', 0.50),
    warehouse: zoneRGBA('warehouse', 0.35),
    shelf: zoneRGBA('shelf', 0.45),
    pick: zoneRGBA('pick', 0.85),
    pack: zoneRGBA('pack', 0.85),
    receive: zoneRGBA('receive', 0.85),
    ship: zoneRGBA('ship', 0.85),
    returns: zoneRGBA('returns', 0.85),
    problem: zoneRGBA('problem', 1.00),
    quarantine: zoneRGBA('quarantine', 1.00),
    kitting: zoneRGBA('kitting', 0.85),
    storage: zoneRGBA('storage', 0.60),
};
// Palette items — frame zones (lane) have no collision, operational zones (bin) are clamped
const PALETTE_ITEMS = [
    { type: 'lane', label: 'Aisle', zone_type: 'pick', defaultW: 4.4, defaultD: 1.0, defaultRackLevels: null },
    { type: 'bin', label: 'Pick', zone_type: 'pick', defaultW: 1.0, defaultD: 0.5, defaultRackLevels: 3 },
    { type: 'bin', label: 'Pack', zone_type: 'pack', defaultW: 2.0, defaultD: 1.5, defaultRackLevels: 2 },
    { type: 'bin', label: 'Receive', zone_type: 'receive', defaultW: 3.0, defaultD: 3.0, defaultRackLevels: 1 },
    { type: 'bin', label: 'Ship', zone_type: 'ship', defaultW: 4.0, defaultD: 3.0, defaultRackLevels: 1 },
    { type: 'bin', label: 'Returns', zone_type: 'returns', defaultW: 3.0, defaultD: 2.0, defaultRackLevels: 1 },
    { type: 'bin', label: 'Quarantine', zone_type: 'quarantine', defaultW: 2.0, defaultD: 2.0, defaultRackLevels: 1 },
    { type: 'bin', label: 'Materials', zone_type: 'kitting', defaultW: 2.0, defaultD: 1.0, defaultRackLevels: 2 },
];
function snapV(v) {
    return Math.round(v / SNAP) * SNAP;
}
// ── ComponentPalette ─────────────────────────────────────────────────────────
function ComponentPalette({ zones, unpositionedZones, onPlace, onCreateZone, canvasCentreX, canvasCentreY }) {
    // Layout health — real checks computed from live zone state (WMS-FP-06).
    const healthIssues = [];
    const unpositioned = zones.filter((z) => z.position_x == null).length;
    if (unpositioned > 0)
        healthIssues.push(`${unpositioned} zone${unpositioned !== 1 ? 's' : ''} not placed on the floor`);
    const detachedBins = zones.filter((z) => z.type === 'bin' && z.zone_type !== 'quarantine' && z.parent_location_code == null).length;
    if (detachedBins > 0)
        healthIssues.push(`${detachedBins} bin${detachedBins !== 1 ? 's' : ''} with no parent aisle`);
    const unbarcoded = zones.filter((z) => z.type !== 'warehouse' && z.barcode == null).length;
    if (unbarcoded > 0)
        healthIssues.push(`${unbarcoded} location${unbarcoded !== 1 ? 's' : ''} without a barcode`);
    const [activeItem, setActiveItem] = useState(null);
    const [locationCode, setLocationCode] = useState('');
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState(null);
    async function handleCreate(item) {
        if (!locationCode.trim() || !onCreateZone)
            return;
        setCreating(true);
        setError(null);
        try {
            await onCreateZone({
                location_code: locationCode.trim().toUpperCase(),
                type: item.type,
                zone_type: item.zone_type,
                position_x: canvasCentreX,
                position_y: canvasCentreY,
                width: item.defaultW,
                depth: item.defaultD,
                rack_levels: item.defaultRackLevels ?? undefined,
            });
            setActiveItem(null);
            setLocationCode('');
        }
        catch (e) {
            setError(e?.response?.data?.error ?? 'Failed to create');
        }
        finally {
            setCreating(false);
        }
    }
    return (_jsxs(Box, { sx: {
            width: 160, flexShrink: 0, borderRight: '1px solid var(--rule)',
            bgcolor: 'var(--bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }, children: [_jsx(Box, { sx: { p: 1.5, borderBottom: '1px solid var(--rule)' }, children: _jsx(Typography, { sx: { fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: "Click to add" }) }), _jsx(Box, { sx: { p: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75, overflowY: 'auto' }, children: PALETTE_ITEMS.map((item) => {
                    // Frame types (lane) use type-based colour — matches canvas render
                    const colorKey = item.type === 'lane' ? 'lane' : item.zone_type;
                    const fill = ZONE_COLORS[colorKey] ?? ZONE_COLORS.storage;
                    const stroke = ZONE_STROKE[colorKey] ?? ZONE_STROKE.storage;
                    return (_jsxs(Box, { onClick: () => { setActiveItem(item.label); setLocationCode(''); setError(null); }, sx: { p: 1, borderRadius: 1.5, border: `1px solid ${activeItem === item.label ? 'var(--accent)' : stroke}`,
                            bgcolor: activeItem === item.label ? 'var(--accent-ghost)' : fill, cursor: 'pointer',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, userSelect: 'none',
                            '&:hover': { opacity: 0.8 }, transition: 'all 0.12s' }, children: [_jsx(Box, { sx: { width: '100%', height: 20, borderRadius: 0.5, border: `1px solid ${stroke}`, bgcolor: fill } }), _jsx(Typography, { sx: { fontSize: 9, fontWeight: 600, color: activeItem === item.label ? 'var(--accent)' : 'var(--ink-2)', textAlign: 'center', lineHeight: 1.2 }, children: item.label }), activeItem === item.label && (_jsxs(Box, { sx: { width: '100%', mt: 0.5 }, onClick: e => e.stopPropagation(), children: [_jsx("input", { autoFocus: true, placeholder: "Code e.g. D-1", value: locationCode, onChange: e => setLocationCode(e.target.value.toUpperCase()), onKeyDown: e => { if (e.key === 'Enter')
                                            void handleCreate(item); if (e.key === 'Escape')
                                            setActiveItem(null); }, style: { width: '100%', fontSize: 9, fontFamily: 'monospace', padding: '2px 4px', borderRadius: 3, border: '1px solid var(--rule)', background: 'var(--bg)', color: 'var(--ink)', boxSizing: 'border-box' } }), error && _jsx(Typography, { sx: { fontSize: 8, color: 'rgba(239,68,68,0.9)', mt: 0.25 }, children: error }), _jsx(Box, { onClick: () => void handleCreate(item), sx: { mt: 0.5, py: 0.25, borderRadius: 1, bgcolor: creating ? 'var(--ink-4)' : 'var(--accent)', color: '#fff', fontSize: 8, fontWeight: 600, textAlign: 'center', cursor: 'pointer' }, children: creating ? '…' : 'Add' })] }))] }, item.label));
                }) }), unpositionedZones.length > 0 && (_jsxs(_Fragment, { children: [_jsx(Divider, {}), _jsxs(Box, { sx: { p: 1.5, borderBottom: '1px solid var(--rule)' }, children: [_jsxs(Typography, { sx: { fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }, children: ["Unpositioned \u00B7 ", unpositionedZones.length] }), unpositionedZones.map((zone) => {
                                const colorKey = (zone.type === 'lane' || zone.type === 'warehouse' || zone.type === 'shelf') ? zone.type : (zone.zone_type ?? 'storage');
                                const stroke = ZONE_STROKE[colorKey] ?? ZONE_STROKE.storage;
                                const fill = ZONE_COLORS[colorKey] ?? ZONE_COLORS.storage;
                                return (_jsxs(Box, { onClick: () => onPlace(zone), title: "Click to place on canvas", sx: { display: 'flex', alignItems: 'center', gap: 0.75, py: 0.6, px: 1, mb: 0.5, borderRadius: 1,
                                        border: `1px solid ${stroke}`, bgcolor: fill, cursor: 'pointer', userSelect: 'none',
                                        '&:hover': { opacity: 0.8 }, transition: 'opacity 0.12s' }, children: [_jsx(Box, { sx: { width: 8, height: 8, borderRadius: 0.5, border: `1px solid ${stroke}`, bgcolor: fill, flexShrink: 0 } }), _jsx(Typography, { sx: { fontSize: 10, fontFamily: 'monospace', fontWeight: 600, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: zone.location_code })] }, zone.location_code));
                            })] })] })), _jsx(Divider, {}), _jsxs(Box, { sx: { p: 1.5, mt: 'auto', borderTop: '1px solid var(--rule)', bgcolor: 'var(--bg-2)' }, children: [_jsx(Typography, { sx: { fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.75 }, children: "Layout health" }), healthIssues.length === 0 ? (_jsx(Typography, { sx: { fontSize: 10, color: 'var(--ink-4)', fontStyle: 'italic', lineHeight: 1.4 }, children: "All good \u2014 no issues detected." })) : (healthIssues.map((issue, i) => (_jsxs(Box, { sx: { display: 'flex', alignItems: 'flex-start', gap: 0.5, mb: 0.5 }, children: [_jsx(Box, { sx: { width: 4, height: 4, borderRadius: '50%', bgcolor: 'var(--accent)', flexShrink: 0, mt: 0.5 } }), _jsx(Typography, { sx: { fontSize: 10, color: 'var(--ink-3)', lineHeight: 1.4 }, children: issue })] }, i))))] })] }));
}
// ── RackInspector ─────────────────────────────────────────────────────────────
function RackInspector({ zone, onClose, onUpdateZone, onDeleteZone, onPrintBarcode, onCreateZone }) {
    const zoneColor = ZONE_STROKE[zone.zone_type ?? 'storage'] ?? ZONE_STROKE.storage;
    const [saving, setSaving] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [editW, setEditW] = useState(String(zone.width ?? ''));
    const [editD, setEditD] = useState(String(zone.depth ?? ''));
    const [editX, setEditX] = useState(String(zone.position_x ?? ''));
    const [editY, setEditY] = useState(String(zone.position_y ?? ''));
    useEffect(() => {
        setEditW(String(zone.width ?? ''));
        setEditD(String(zone.depth ?? ''));
        setEditX(String(zone.position_x ?? ''));
        setEditY(String(zone.position_y ?? ''));
    }, [zone.location_code, zone.width, zone.depth, zone.position_x, zone.position_y]);
    async function commitField(field, raw) {
        const val = parseFloat(raw);
        if (isNaN(val) || !onUpdateZone)
            return;
        setSaving(true);
        try {
            await onUpdateZone(zone.location_code, { [field]: snapV(val) });
        }
        finally {
            setSaving(false);
        }
    }
    async function handleDelete() {
        if (!onDeleteZone)
            return;
        setDeleteOpen(true);
    }
    async function confirmDelete() {
        if (!onDeleteZone)
            return;
        setDeleteOpen(false);
        await onDeleteZone(zone.location_code);
        onClose();
    }
    // Duplicate: opens a Dialog so the user can set a unique code before creation.
    // location_code is the PK and immutable post-creation — must be set here.
    const [duplicateOpen, setDuplicateOpen] = useState(false);
    const [duplicateCode, setDuplicateCode] = useState('');
    const [duplicating, setDuplicating] = useState(false);
    const [duplicateError, setDuplicateError] = useState(null);
    function openDuplicate() {
        setDuplicateCode(`${zone.location_code}-COPY`);
        setDuplicateError(null);
        setDuplicateOpen(true);
    }
    async function confirmDuplicate() {
        if (!onCreateZone || !duplicateCode.trim())
            return;
        setDuplicating(true);
        setDuplicateError(null);
        try {
            await onCreateZone({
                location_code: duplicateCode.trim().toUpperCase(),
                type: zone.type,
                zone_type: zone.zone_type ?? undefined,
                position_x: (parseFloat(String(zone.position_x ?? 0)) + 1.1),
                position_y: parseFloat(String(zone.position_y ?? 0)),
                width: parseFloat(String(zone.width ?? 1)),
                depth: parseFloat(String(zone.depth ?? 0.5)),
                rack_levels: zone.rack_levels ?? undefined,
            });
            setDuplicateOpen(false);
        }
        catch {
            setDuplicateError('Code already exists or is invalid.');
        }
        finally {
            setDuplicating(false);
        }
    }
    return (_jsxs(Box, { sx: { width: 220, flexShrink: 0, borderLeft: '1px solid var(--rule)', bgcolor: 'var(--bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }, children: [_jsxs(Box, { sx: { px: 2, py: 1.5, borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [_jsx(Typography, { sx: { fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: zone.type.toUpperCase() }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.5 }, children: [_jsx(IconButton, { size: "small", title: "Duplicate zone", onClick: openDuplicate, sx: { color: 'var(--ink-4)', '&:hover': { color: 'var(--accent)' } }, children: _jsx(Copy, { size: 13 }) }), _jsx(IconButton, { size: "small", onClick: onClose, sx: { color: 'var(--ink-4)' }, children: _jsx(X, { size: 13 }) })] })] }), _jsxs(Box, { sx: { flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 2 }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.75 }, children: "Code" }), _jsx(Box, { sx: { px: 1.5, py: 1, bgcolor: 'var(--bg-2)', borderRadius: 1, border: '1px solid var(--rule)' }, children: _jsx(Typography, { sx: { fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: 'var(--ink)' }, children: zone.location_code }) })] }), zone.zone_type && (_jsxs(Box, { sx: { display: 'flex', gap: 0.75, flexWrap: 'wrap' }, children: [_jsx(Chip, { label: zone.type, size: "small", sx: { fontSize: 10, height: 20 } }), _jsx(Chip, { label: zone.zone_type, size: "small", sx: { fontSize: 10, height: 20, bgcolor: ZONE_COLORS[zone.zone_type] ?? 'transparent', color: zoneColor, border: `1px solid ${zoneColor}` } })] })), _jsx(Divider, {}), _jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }, children: "Dimensions" }), _jsx(Box, { sx: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }, children: ([
                                    { label: 'Width', field: 'width', value: editW, set: setEditW },
                                    { label: 'Depth', field: 'depth', value: editD, set: setEditD },
                                    { label: 'Position X', field: 'position_x', value: editX, set: setEditX },
                                    { label: 'Position Y', field: 'position_y', value: editY, set: setEditY },
                                ]).map(({ label, field, value, set }) => (_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 9, color: 'var(--ink-4)', mb: 0.25, fontWeight: 500 }, children: label }), _jsx(TextField, { size: "small", value: value, onChange: (e) => set(e.target.value), onBlur: () => commitField(field, value), onKeyDown: (e) => { if (e.key === 'Enter')
                                                commitField(field, value); }, disabled: saving, inputProps: { style: { fontFamily: 'monospace', fontSize: 12, padding: '4px 8px' } }, InputProps: { endAdornment: _jsx(Typography, { sx: { fontSize: 10, color: 'var(--ink-4)' }, children: "m" }) }, sx: { width: '100%' } })] }, field))) })] }), _jsx(Divider, {}), _jsxs(Box, { sx: { display: 'flex', gap: 2, alignItems: 'center' }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.5 }, children: [_jsx(Layers, { size: 12, color: "var(--ink-4)" }), _jsx(TextField, { size: "small", type: "number", defaultValue: zone.rack_levels ?? '', placeholder: "\u2014", onBlur: (e) => {
                                            const val = parseInt(e.target.value);
                                            if (!isNaN(val) && val >= 1 && val <= 20)
                                                onUpdateZone?.(zone.location_code, { rack_levels: val });
                                        }, onKeyDown: (e) => {
                                            if (e.key === 'Enter') {
                                                const val = parseInt(e.target.value);
                                                if (!isNaN(val) && val >= 1 && val <= 20)
                                                    onUpdateZone?.(zone.location_code, { rack_levels: val });
                                            }
                                        }, inputProps: { min: 1, max: 20, style: { fontFamily: 'monospace', fontSize: 11, padding: '2px 4px', width: 36 } }, sx: { '& fieldset': { border: 'none' }, '& .MuiInputBase-root': { bgcolor: 'var(--bg-2)', borderRadius: 1, border: '1px solid var(--rule)' } } }, `${zone.location_code}:${zone.rack_levels ?? 'none'}`), _jsx(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)' }, children: "levels" })] }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.5 }, children: [_jsx(RotateCw, { size: 12, color: "var(--ink-4)" }), _jsxs(Typography, { sx: { fontSize: 11, color: 'var(--ink-3)' }, children: [zone.orientation ?? 0, "\u00B0"] })] })] }), zone.barcode && (_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.75 }, children: "Barcode" }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 1, bgcolor: 'var(--bg-2)', borderRadius: 1, border: '1px solid var(--rule)' }, children: [_jsx(Tag, { size: 11, color: "var(--ink-4)" }), _jsx(Typography, { sx: { fontFamily: 'monospace', fontSize: 11, color: 'var(--ink)' }, children: zone.barcode })] })] })), zone.parent_location_code && (_jsxs(Typography, { sx: { fontSize: 10, color: 'var(--ink-4)' }, children: ["Parent: ", _jsx("span", { style: { fontFamily: 'monospace' }, children: zone.parent_location_code })] }))] }), _jsxs(Box, { sx: { p: 1.5, borderTop: '1px solid var(--rule)', display: 'flex', flexDirection: 'column', gap: 0.75 }, children: [zone.type !== 'warehouse' && (_jsxs(Box, { onClick: () => onPrintBarcode?.(zone.location_code), sx: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, py: 1, borderRadius: 1.5, bgcolor: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', '&:hover': { opacity: 0.9 }, transition: 'opacity 0.15s' }, children: [_jsx(Tag, { size: 12 }), " Print barcode"] })), _jsxs(Box, { onClick: handleDelete, sx: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, py: 0.75, borderRadius: 1.5, border: '1px solid var(--rule)', fontSize: 11, fontWeight: 500, color: 'var(--ink-3)', cursor: 'pointer', '&:hover': { borderColor: 'rgba(239,68,68,0.6)', color: 'rgba(239,68,68,0.9)' }, transition: 'all 0.15s' }, children: [_jsx(Trash2, { size: 11 }), " Delete"] })] }), _jsxs(Dialog, { open: duplicateOpen, onClose: () => setDuplicateOpen(false), children: [_jsxs(DialogTitle, { sx: { fontSize: 14 }, children: ["Duplicate ", _jsx("strong", { children: zone.location_code })] }), _jsx(Box, { sx: { px: 3, pb: 1 }, children: _jsx(TextField, { autoFocus: true, size: "small", label: "New name", value: duplicateCode, onChange: e => { setDuplicateCode(e.target.value.toUpperCase()); setDuplicateError(null); }, onKeyDown: e => { if (e.key === 'Enter')
                                confirmDuplicate(); }, error: !!duplicateError, helperText: duplicateError ?? ' ', inputProps: { style: { fontFamily: 'monospace' } }, fullWidth: true }) }), _jsxs(DialogActions, { children: [_jsx(Button, { size: "small", onClick: () => setDuplicateOpen(false), children: "Cancel" }), _jsx(Button, { size: "small", variant: "contained", onClick: confirmDuplicate, disabled: duplicating || !duplicateCode.trim(), children: duplicating ? 'Creating…' : 'Duplicate' })] })] }), _jsxs(Dialog, { open: deleteOpen, onClose: () => setDeleteOpen(false), children: [_jsxs(DialogTitle, { sx: { fontSize: 14 }, children: ["Delete ", _jsx("strong", { children: zone.location_code }), "? This cannot be undone."] }), _jsxs(DialogActions, { children: [_jsx(Button, { size: "small", onClick: () => setDeleteOpen(false), children: "Cancel" }), _jsx(Button, { size: "small", color: "error", variant: "contained", onClick: confirmDelete, children: "Delete" })] })] })] }));
}
// ── Metre ruler ───────────────────────────────────────────────────────────────
function Ruler({ length, horizontal, scale, offset: off, zoom }) {
    const step = zoom < 0.6 ? 2 : 1;
    const ticks = Math.ceil(length / step) + 1;
    const tickPx = step * scale * zoom;
    return (_jsxs("svg", { width: horizontal ? '100%' : RULER_SIZE, height: horizontal ? RULER_SIZE : '100%', style: { display: 'block', flexShrink: 0 }, children: [_jsx("rect", { width: "100%", height: "100%", fill: "var(--bg-2)" }), Array.from({ length: ticks }, (_, i) => {
                const pos = off + i * tickPx;
                if (pos < 0)
                    return null;
                const label = `${i * step}m`;
                return horizontal ? (_jsxs("g", { transform: `translate(${pos},0)`, children: [_jsx("line", { x1: "0", y1: RULER_SIZE - 6, x2: "0", y2: RULER_SIZE, stroke: "var(--rule)", strokeWidth: "1" }), _jsx("text", { x: "3", y: RULER_SIZE - 8, fontSize: "8", fill: "var(--ink-4)", fontFamily: "monospace", children: label })] }, i)) : (_jsxs("g", { transform: `translate(0,${pos})`, children: [_jsx("line", { x1: RULER_SIZE - 6, y1: "0", x2: RULER_SIZE, y2: "0", stroke: "var(--rule)", strokeWidth: "1" }), _jsx("text", { x: "2", y: "8", fontSize: "8", fill: "var(--ink-4)", fontFamily: "monospace", transform: `rotate(-90,2,8)`, children: label })] }, i));
            }), _jsx("line", { x1: horizontal ? 0 : RULER_SIZE, y1: horizontal ? RULER_SIZE : 0, x2: horizontal ? '100%' : RULER_SIZE, y2: horizontal ? RULER_SIZE : '100%', stroke: "var(--rule)", strokeWidth: "1" })] }));
}
// ── CanvasEditor ──────────────────────────────────────────────────────────────
export function CanvasEditor({ zones, onUpdateZone, onDeleteZone, onCreateZone, onPrintBarcode, onViewIn3D, }) {
    const svgRef = useRef(null);
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState({ x: 40, y: 40 });
    const [selected, setSelected] = useState(null);
    const [flipped, setFlipped] = useState(false); // angle preset: standard vs mirrored
    const [localPositions, setLocalPositions] = useState({});
    const [localSizes, setLocalSizes] = useState({});
    // Optimistic placement: zones placed this session before props re-render with new coordinates
    const [placedCoords, setPlacedCoords] = useState({});
    const [lastSaved, setLastSaved] = useState(null);
    // FP-06: mode/marquee state removed — Canvas is pan-only now. Marquee
    // selection only ever selected one zone regardless of drag area
    // (dead scaffolding, never completed to true multi-select), and
    // Select mode existed only to enable it.
    const dragRef = useRef(null);
    const panRef = useRef(null);
    const resizeRef = useRef(null);
    const savingRef = useRef(new Set());
    // FP-11: alignment guide lines, shown while dragging a frame zone
    // (warehouse/lane/shelf) if it lines up with a sibling frame zone's
    // left/center/right or top/center/bottom edge. Scoped to frame zones
    // only — they currently get zero positioning assistance (clampPosition
    // skips them entirely), unlike bins which already have collision-snap.
    // x/y are in SVG canvas coordinates (post-toSvg), null when no snap active.
    const [alignGuides, setAlignGuides] = useState({ x: null, y: null });
    // Merge prop-positioned zones with optimistically placed zones
    const positionedZones = [
        ...zones.filter(z => z.position_x != null && z.position_y != null),
        ...zones.filter(z => z.position_x == null && placedCoords[z.location_code] != null).map(z => ({
            ...z,
            position_x: placedCoords[z.location_code].x,
            position_y: placedCoords[z.location_code].y,
        })),
    ];
    // Refs for latest values — avoids stale closure captures inside useEffect mousemove handler
    const positionedZonesRef = useRef(positionedZones);
    const localSizesRef = useRef(localSizes);
    const localPositionsRef = useRef(localPositions);
    const zoomRef = useRef(zoom);
    const offsetRef = useRef(offset);
    // Sync refs synchronously on every render — avoids stale closure in mousemove handler
    positionedZonesRef.current = positionedZones;
    localSizesRef.current = localSizes;
    localPositionsRef.current = localPositions;
    zoomRef.current = zoom;
    offsetRef.current = offset;
    const unpositionedCount = zones.filter(z => z.position_x == null && !placedCoords[z.location_code]).length;
    const selectedZone = selected
        ? positionedZones.find(z => z.location_code === selected) ?? zones.find(z => z.location_code === selected)
        : null;
    const toSvg = useCallback((metres) => metres * SCALE * zoom, [zoom]);
    /**
     * Clamp position so zone (code, w, h) doesn't overlap any other zone.
     * warehouse-type zones are frames — excluded from collision.
     * Snaps dragged zone to the nearest non-overlapping edge of each blocker.
     */
    function clampPosition(code, x, y, w, h) {
        // Frame zones (warehouse/lane/shelf) move freely — only bins are collision-clamped
        const dragged = positionedZonesRef.current.find(z => z.location_code === code);
        if (dragged && (dragged.type === 'warehouse' || dragged.type === 'lane' || dragged.type === 'shelf')) {
            return { x, y };
        }
        let cx = x;
        let cy = y;
        // Multi-pass: repeat until stable or max iterations reached
        // Single-pass misses cascading overlaps at corners where two blockers meet
        for (let pass = 0; pass < 10; pass++) {
            let moved = false;
            for (const z of positionedZones) {
                // warehouse/lane/shelf are container frames — bins sit inside them, no collision
                if (z.location_code === code || z.type === 'warehouse' || z.type === 'lane' || z.type === 'shelf')
                    continue;
                const zx = localPositionsRef.current[z.location_code]?.x ?? parseFloat(String(z.position_x ?? 0));
                const zy = localPositionsRef.current[z.location_code]?.y ?? parseFloat(String(z.position_y ?? 0));
                const zw = localSizesRef.current[z.location_code]?.w ?? parseFloat(String(z.width ?? 1));
                const zh = localSizesRef.current[z.location_code]?.h ?? parseFloat(String(z.depth ?? 0.8));
                const TOL = 0.05;
                if (!(cx < zx + zw - TOL && cx + w - TOL > zx && cy < zy + zh - TOL && cy + h - TOL > zy))
                    continue;
                const snapLeft = zx - w;
                const snapRight = zx + zw;
                const snapUp = zy - h;
                const snapDown = zy + zh;
                const dLeft = Math.abs(cx - snapLeft);
                const dRight = Math.abs(cx - snapRight);
                const dUp = Math.abs(cy - snapUp);
                const dDown = Math.abs(cy - snapDown);
                const minD = Math.min(dLeft, dRight, dUp, dDown);
                if (minD === dLeft)
                    cx = snapV(Math.max(0, snapLeft));
                else if (minD === dRight)
                    cx = snapV(snapRight);
                else if (minD === dUp)
                    cy = snapV(Math.max(0, snapUp));
                else
                    cy = snapV(snapDown);
                moved = true;
            }
            if (!moved)
                break; // stable — no more overlaps
        }
        return { x: cx, y: cy };
    }
    // FP-11: alignment snap for frame zones (warehouse/lane/shelf) only.
    // Unlike clampPosition, this ignores collision and only checks whether
    // the dragged zone's edges/center line up with a sibling frame zone's
    // edges/center — the goal is visual alignment (e.g. lanes A/B/C sharing
    // the same X), not overlap prevention. Threshold is in metres, converted
    // from a fixed pixel tolerance so it feels consistent at any zoom level.
    const SNAP_PX = 6;
    function getFrameAlignmentSnap(code, x, y, w, h) {
        const tol = SNAP_PX / (SCALE * zoomRef.current);
        let snappedX = x;
        let snappedY = y;
        let guideX = null;
        let guideY = null;
        let bestDx = tol;
        let bestDy = tol;
        for (const z of positionedZonesRef.current) {
            if (z.location_code === code)
                continue;
            if (z.type !== 'warehouse' && z.type !== 'lane' && z.type !== 'shelf')
                continue;
            const zx = localPositionsRef.current[z.location_code]?.x ?? parseFloat(String(z.position_x ?? 0));
            const zy = localPositionsRef.current[z.location_code]?.y ?? parseFloat(String(z.position_y ?? 0));
            const zw = localSizesRef.current[z.location_code]?.w ?? parseFloat(String(z.width ?? 1));
            const zh = localSizesRef.current[z.location_code]?.h ?? parseFloat(String(z.depth ?? 0.8));
            // X axis: compare left/center/right of dragged zone against left/center/right of sibling
            const candidatesX = [
                { dragEdge: x, targetEdge: zx },
                { dragEdge: x, targetEdge: zx + zw },
                { dragEdge: x + w, targetEdge: zx },
                { dragEdge: x + w, targetEdge: zx + zw },
                { dragEdge: x + w / 2, targetEdge: zx + zw / 2 },
            ];
            for (const { dragEdge, targetEdge } of candidatesX) {
                const d = Math.abs(dragEdge - targetEdge);
                if (d < bestDx) {
                    bestDx = d;
                    snappedX = x + (targetEdge - dragEdge);
                    guideX = toSvg(targetEdge);
                }
            }
            // Y axis: same, top/center/bottom
            const candidatesY = [
                { dragEdge: y, targetEdge: zy },
                { dragEdge: y, targetEdge: zy + zh },
                { dragEdge: y + h, targetEdge: zy },
                { dragEdge: y + h, targetEdge: zy + zh },
                { dragEdge: y + h / 2, targetEdge: zy + zh / 2 },
            ];
            for (const { dragEdge, targetEdge } of candidatesY) {
                const d = Math.abs(dragEdge - targetEdge);
                if (d < bestDy) {
                    bestDy = d;
                    snappedY = y + (targetEdge - dragEdge);
                    guideY = toSvg(targetEdge);
                }
            }
        }
        return { x: snappedX, y: snappedY, guideX, guideY };
    }
    // FP-14: alignment snap for bins and other non-frame zones — mirrors
    // FP-11's frame alignment snap, comparing against sibling collidable
    // zones instead of frames. Runs before clampPosition, which still has
    // final say — an aligned position that would overlap a neighbor is
    // resolved by clampPosition exactly as before, so this never weakens
    // collision, it only tries alignment first.
    function getBinAlignmentSnap(code, x, y, w, h) {
        const tol = SNAP_PX / (SCALE * zoomRef.current);
        let snappedX = x;
        let snappedY = y;
        let guideX = null;
        let guideY = null;
        let bestDx = tol;
        let bestDy = tol;
        for (const z of positionedZonesRef.current) {
            if (z.location_code === code)
                continue;
            if (z.type === 'warehouse' || z.type === 'lane' || z.type === 'shelf')
                continue;
            const zx = localPositionsRef.current[z.location_code]?.x ?? parseFloat(String(z.position_x ?? 0));
            const zy = localPositionsRef.current[z.location_code]?.y ?? parseFloat(String(z.position_y ?? 0));
            const zw = localSizesRef.current[z.location_code]?.w ?? parseFloat(String(z.width ?? 1));
            const zh = localSizesRef.current[z.location_code]?.h ?? parseFloat(String(z.depth ?? 0.8));
            const candidatesX = [
                { dragEdge: x, targetEdge: zx },
                { dragEdge: x, targetEdge: zx + zw },
                { dragEdge: x + w, targetEdge: zx },
                { dragEdge: x + w, targetEdge: zx + zw },
                { dragEdge: x + w / 2, targetEdge: zx + zw / 2 },
            ];
            for (const { dragEdge, targetEdge } of candidatesX) {
                const d = Math.abs(dragEdge - targetEdge);
                if (d < bestDx) {
                    bestDx = d;
                    snappedX = x + (targetEdge - dragEdge);
                    guideX = toSvg(targetEdge);
                }
            }
            const candidatesY = [
                { dragEdge: y, targetEdge: zy },
                { dragEdge: y, targetEdge: zy + zh },
                { dragEdge: y + h, targetEdge: zy },
                { dragEdge: y + h, targetEdge: zy + zh },
                { dragEdge: y + h / 2, targetEdge: zy + zh / 2 },
            ];
            for (const { dragEdge, targetEdge } of candidatesY) {
                const d = Math.abs(dragEdge - targetEdge);
                if (d < bestDy) {
                    bestDy = d;
                    snappedY = y + (targetEdge - dragEdge);
                    guideY = toSvg(targetEdge);
                }
            }
        }
        return { x: snappedX, y: snappedY, guideX, guideY };
    }
    // FP-12: alignment snap for resizing frame zones — extends FP-11's drag
    // snap to the resize handles. Only the far edge being dragged moves
    // (near edge/position is fixed), so this checks a single edge per axis
    // against sibling frame zones, rather than the multi-candidate set
    // getFrameAlignmentSnap uses for whole-shape dragging.
    function getFrameResizeSnap(code, curX, curY, rawW, rawH, edge) {
        const tol = SNAP_PX / (SCALE * zoomRef.current);
        let snappedW = rawW;
        let snappedH = rawH;
        let guideX = null;
        let guideY = null;
        let bestDx = tol;
        let bestDy = tol;
        const checkX = edge === 'e' || edge === 'se';
        const checkY = edge === 's' || edge === 'se';
        if (!checkX && !checkY)
            return { w: snappedW, h: snappedH, guideX, guideY };
        const farX = curX + rawW;
        const farY = curY + rawH;
        for (const z of positionedZonesRef.current) {
            if (z.location_code === code)
                continue;
            if (z.type !== 'warehouse' && z.type !== 'lane' && z.type !== 'shelf')
                continue;
            const zx = localPositionsRef.current[z.location_code]?.x ?? parseFloat(String(z.position_x ?? 0));
            const zy = localPositionsRef.current[z.location_code]?.y ?? parseFloat(String(z.position_y ?? 0));
            const zw = localSizesRef.current[z.location_code]?.w ?? parseFloat(String(z.width ?? 1));
            const zh = localSizesRef.current[z.location_code]?.h ?? parseFloat(String(z.depth ?? 0.8));
            if (checkX) {
                // FP-12b: curX + zw is a *dimension* match (same width as this
                // sibling, regardless of its position) — distinct from zx/zx+zw
                // which are positional edge matches. Same candidate mechanism,
                // just one more target to check.
                for (const targetEdge of [zx, zx + zw, curX + zw]) {
                    const d = Math.abs(farX - targetEdge);
                    if (d < bestDx) {
                        bestDx = d;
                        snappedW = targetEdge - curX;
                        guideX = toSvg(targetEdge);
                    }
                }
            }
            if (checkY) {
                // FP-12b: curY + zh is a depth-match candidate (same depth as
                // this sibling lane), independent of that sibling's own position.
                for (const targetEdge of [zy, zy + zh, curY + zh]) {
                    const d = Math.abs(farY - targetEdge);
                    if (d < bestDy) {
                        bestDy = d;
                        snappedH = targetEdge - curY;
                        guideY = toSvg(targetEdge);
                    }
                }
            }
        }
        return { w: Math.max(0.5, snappedW), h: Math.max(0.5, snappedH), guideX, guideY };
    }
    // ── Drag handlers ──────────────────────────────────────────────────────────
    function onRackMouseDown(e, zone) {
        // FP-06: mode branch removed — Select mode/marquee no longer exists,
        // so zone mousedown always starts a drag (previously "pan mode" only
        // behavior) and never lets the event bubble to canvas.
        e.stopPropagation();
        setSelected(zone.location_code);
        dragRef.current = {
            locationCode: zone.location_code,
            startMouseX: e.clientX,
            startMouseY: e.clientY,
            startPosX: localPositions[zone.location_code]?.x ?? parseFloat(String(zone.position_x ?? placedCoords[zone.location_code]?.x ?? 0)),
            startPosY: localPositions[zone.location_code]?.y ?? parseFloat(String(zone.position_y ?? placedCoords[zone.location_code]?.y ?? 0)),
        };
    }
    // FP-06: marquee selection removed — it only ever selected a single
    // zone regardless of drag area (see prior mouseup comment: "Multi-select:
    // for now select first hit — group select in future sprint"). Canvas
    // is pan-only now; clicking a zone directly still selects it via
    // onRackMouseDown, unaffected by this change.
    function onCanvasMouseDown(e) {
        if (dragRef.current)
            return;
        setSelected(null);
        panRef.current = {
            startMouseX: e.clientX,
            startMouseY: e.clientY,
            startOffsetX: offset.x,
            startOffsetY: offset.y,
        };
    }
    // FP-05: keeps at least MARGIN px of canvas content visible on every side,
    // regardless of pan direction or zoom level, so the user can never scroll
    // the floor plan fully off-screen and lose track of where it went.
    const PAN_MARGIN = 100;
    function clampOffset(x, y, currentZoom) {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect)
            return { x, y };
        const cw = CANVAS_W * SCALE * currentZoom;
        const ch = CANVAS_H * SCALE * currentZoom;
        return {
            x: Math.min(rect.width - PAN_MARGIN, Math.max(PAN_MARGIN - cw, x)),
            y: Math.min(rect.height - PAN_MARGIN, Math.max(PAN_MARGIN - ch, y)),
        };
    }
    useEffect(() => {
        function onMouseMove(e) {
            // Resize — clamp to nearest blocker edge
            if (resizeRef.current) {
                const r = resizeRef.current;
                const dxM = (e.clientX - r.startMouseX) / (SCALE * zoom);
                const dyM = (e.clientY - r.startMouseY) / (SCALE * zoom);
                const rawW = snapV(Math.max(0.5, r.startW + (r.edge !== 's' ? dxM : 0)));
                const rawH = snapV(Math.max(0.5, r.startD + (r.edge !== 'e' ? dyM : 0)));
                const zone = positionedZonesRef.current.find(z => z.location_code === r.locationCode);
                const curX = localPositionsRef.current[r.locationCode]?.x ?? parseFloat(String(zone?.position_x ?? 0));
                const curY = localPositionsRef.current[r.locationCode]?.y ?? parseFloat(String(zone?.position_y ?? 0));
                // Frame zones resize freely — no collision clamping.
                // FP-12: alignment snap applied here, mirroring FP-11's drag snap.
                if (zone && (zone.type === 'warehouse' || zone.type === 'lane' || zone.type === 'shelf')) {
                    const snap = getFrameResizeSnap(r.locationCode, curX, curY, rawW, rawH, r.edge);
                    setAlignGuides({ x: snap.guideX, y: snap.guideY });
                    setLocalSizes(prev => ({ ...prev, [r.locationCode]: { w: snap.w, h: snap.h } }));
                    return;
                }
                let clampedW = rawW;
                let clampedH = rawH;
                for (const z of positionedZonesRef.current) {
                    // warehouse/lane/shelf are container frames — bins sit inside them, no collision
                    if (z.location_code === r.locationCode || z.type === 'warehouse' || z.type === 'lane' || z.type === 'shelf')
                        continue;
                    const zx = localPositionsRef.current[z.location_code]?.x ?? parseFloat(String(z.position_x ?? 0));
                    const zy = localPositionsRef.current[z.location_code]?.y ?? parseFloat(String(z.position_y ?? 0));
                    const zw = localSizesRef.current[z.location_code]?.w ?? parseFloat(String(z.width ?? 1));
                    const zh = localSizesRef.current[z.location_code]?.h ?? parseFloat(String(z.depth ?? 0.8));
                    if (zx > curX + 0.05 && curY < zy + zh - 0.05 && curY + clampedH - 0.05 > zy)
                        clampedW = Math.min(clampedW, snapV(zx - curX));
                    if (zy > curY + 0.05 && curX < zx + zw - 0.05 && curX + rawW - 0.05 > zx)
                        clampedH = Math.min(clampedH, snapV(zy - curY));
                }
                setLocalSizes(prev => ({ ...prev, [r.locationCode]: { w: Math.max(0.5, clampedW), h: Math.max(0.5, clampedH) } }));
                return;
            }
            // Drag — clamped to nearest non-overlapping position
            if (dragRef.current) {
                const d = dragRef.current;
                const dxM = (e.clientX - d.startMouseX) / (SCALE * zoom);
                const dyM = (e.clientY - d.startMouseY) / (SCALE * zoom);
                const rawX = snapV(Math.max(0, d.startPosX + dxM));
                const rawY = snapV(Math.max(0, d.startPosY + dyM));
                const zone = positionedZonesRef.current.find(z => z.location_code === d.locationCode);
                const w = localSizesRef.current[d.locationCode]?.w ?? parseFloat(String(zone?.width ?? 1));
                const h = localSizesRef.current[d.locationCode]?.h ?? parseFloat(String(zone?.depth ?? 0.8));
                // FP-11: alignment snap runs first for frame zones (lane/warehouse/
                // shelf) — clampPosition already returns {x,y} unchanged for these
                // types, so this is purely additive, never fighting the existing
                // bin collision-snap below.
                let finalX = rawX;
                let finalY = rawY;
                if (zone && (zone.type === 'warehouse' || zone.type === 'lane' || zone.type === 'shelf')) {
                    const snap = getFrameAlignmentSnap(d.locationCode, rawX, rawY, w, h);
                    finalX = snap.x;
                    finalY = snap.y;
                    setAlignGuides({ x: snap.guideX, y: snap.guideY });
                }
                else {
                    const snap = getBinAlignmentSnap(d.locationCode, rawX, rawY, w, h);
                    finalX = snap.x;
                    finalY = snap.y;
                    setAlignGuides({ x: snap.guideX, y: snap.guideY });
                }
                const { x: newX, y: newY } = clampPosition(d.locationCode, finalX, finalY, w, h);
                setLocalPositions(prev => ({ ...prev, [d.locationCode]: { x: newX, y: newY } }));
                return;
            }
            // FP-06: marquee-update branch removed along with marquee feature.
            // Pan — FP-05: clamped so the floor plan can't be dragged fully off-screen
            if (panRef.current) {
                const p = panRef.current;
                const next = clampOffset(p.startOffsetX + (e.clientX - p.startMouseX), p.startOffsetY + (e.clientY - p.startMouseY), zoom);
                setOffset(next);
            }
        }
        async function onMouseUp() {
            if (resizeRef.current) {
                const r = resizeRef.current;
                const local = localSizesRef.current[r.locationCode];
                if (local && onUpdateZone && !savingRef.current.has(r.locationCode)) {
                    savingRef.current.add(r.locationCode);
                    try {
                        await onUpdateZone(r.locationCode, { width: local.w, depth: local.h });
                        setLastSaved(new Date());
                    }
                    finally {
                        savingRef.current.delete(r.locationCode);
                    }
                }
                resizeRef.current = null;
                // FP-12: clear alignment guides on resize-end — resize returns
                // early above drag's guide-clear, so it needs its own.
                setAlignGuides({ x: null, y: null });
                return;
            }
            if (dragRef.current) {
                const d = dragRef.current;
                const local = localPositionsRef.current[d.locationCode];
                if (local && onUpdateZone && !savingRef.current.has(d.locationCode)) {
                    // Final clamp before persist — guards against any residual overlap from rapid drag
                    const zone = positionedZonesRef.current.find(z => z.location_code === d.locationCode);
                    const w = localSizesRef.current[d.locationCode]?.w ?? parseFloat(String(zone?.width ?? 1));
                    const h = localSizesRef.current[d.locationCode]?.h ?? parseFloat(String(zone?.depth ?? 0.8));
                    const { x: safeX, y: safeY } = clampPosition(d.locationCode, local.x, local.y, w, h);
                    // Update local state to reflect final safe position
                    setLocalPositions(prev => ({ ...prev, [d.locationCode]: { x: safeX, y: safeY } }));
                    savingRef.current.add(d.locationCode);
                    try {
                        await onUpdateZone(d.locationCode, { position_x: safeX, position_y: safeY });
                        setLastSaved(new Date());
                    }
                    finally {
                        savingRef.current.delete(d.locationCode);
                    }
                }
                dragRef.current = null;
            }
            // FP-11: clear alignment guides on drag-end regardless of which
            // branch fired above — avoids a stale guide line lingering after
            // the drag stops.
            setAlignGuides({ x: null, y: null });
            // FP-06: marquee-resolution block removed along with marquee feature.
            panRef.current = null;
        }
        // Native wheel listener on SVG — { passive: false } required to call preventDefault()
        // React synthetic onWheel cannot reliably prevent page scroll in all browsers
        // FP-05: clamped so wheel-panning can't scroll the floor plan fully off-screen
        function onWheel(e) {
            e.preventDefault();
            setOffset(prev => clampOffset(prev.x - (e.shiftKey ? e.deltaY : e.deltaX) * 0.8, prev.y - (e.shiftKey ? 0 : e.deltaY) * 0.8, zoom));
        }
        const svgEl = svgRef.current;
        if (svgEl)
            svgEl.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            if (svgEl)
                svgEl.removeEventListener('wheel', onWheel);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, [zoom, localPositions, localSizes, onUpdateZone]);
    // onWheel is registered as a native listener in useEffect (passive: false required)
    const canvasW = toSvg(CANVAS_W);
    const canvasH = toSvg(CANVAS_H);
    return (_jsxs(Box, { sx: { display: 'flex', width: '100%', height: 560, border: '1px solid var(--rule)', borderRadius: 2, overflow: 'hidden', bgcolor: 'var(--bg)' }, children: [_jsx(ComponentPalette, { zones: zones, unpositionedZones: zones.filter(z => z.position_x == null), onPlace: (zone) => {
                    const centreX = snapV(Math.max(0, (-offset.x + 200) / (SCALE * zoom)));
                    const centreY = snapV(Math.max(0, (-offset.y + 150) / (SCALE * zoom)));
                    setPlacedCoords(prev => ({ ...prev, [zone.location_code]: { x: centreX, y: centreY } }));
                    onUpdateZone?.(zone.location_code, { position_x: centreX, position_y: centreY });
                }, onCreateZone: onCreateZone, canvasCentreX: snapV(Math.max(0, (-offset.x + 200) / (SCALE * zoom))), canvasCentreY: snapV(Math.max(0, (-offset.y + 150) / (SCALE * zoom))) }), _jsxs(Box, { sx: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'var(--bg-2)' }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, borderBottom: '1px solid var(--rule)', bgcolor: 'var(--bg)', flexShrink: 0 }, children: [_jsxs(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: ["Floor 1 \u00B7 ", CANVAS_W * CANVAS_H, "m\u00B2 \u00B7 Top-down"] }), _jsx(Typography, { sx: { fontSize: 10, color: 'var(--ink-4)' }, children: "\u00B7" }), lastSaved && (_jsxs(Typography, { sx: { fontSize: 10, color: 'var(--ink-4)', fontStyle: 'italic' }, children: ["Saved ", Math.floor((Date.now() - lastSaved.getTime()) / 60000) < 1 ? 'just now' : `${Math.floor((Date.now() - lastSaved.getTime()) / 60000)}m ago`] })), _jsxs(Typography, { sx: { fontSize: 10, color: 'var(--ink-3)' }, children: [positionedZones.length, " components", unpositionedCount > 0 && _jsxs("span", { style: { color: 'var(--ink-4)' }, children: [" \u00B7 ", unpositionedCount, " unpositioned"] })] }), onViewIn3D && (_jsx(Box, { onClick: onViewIn3D, title: "View this layout in 3D on the Map tab", sx: { display: 'flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.4, mr: 1,
                                    border: '1px solid var(--rule)', borderRadius: 1.5, cursor: 'pointer',
                                    fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--ink-3)',
                                    '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' } }, children: "View in 3D" })), _jsxs(Box, { sx: { ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }, children: [[{ label: '−', delta: -0.15 }, { label: '+', delta: 0.15 }].map(({ label, delta }) => (_jsx(Box, { onClick: () => setZoom(z => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta))), sx: { width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--rule)', borderRadius: 1, cursor: 'pointer', fontSize: 13, color: 'var(--ink-3)', bgcolor: 'var(--bg)', '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' } }, children: label }, label))), _jsxs(Box, { sx: { px: 1, height: 22, display: 'flex', alignItems: 'center', border: '1px solid var(--rule)', borderRadius: 1, fontSize: 10, color: 'var(--ink-3)', bgcolor: 'var(--bg)', fontFamily: 'monospace', minWidth: 40, justifyContent: 'center' }, children: [Math.round(zoom * 100), "%"] }), _jsx(Box, { onClick: () => { setZoom(1); setOffset({ x: 40, y: 40 }); }, sx: { px: 1, height: 22, display: 'flex', alignItems: 'center', border: '1px solid var(--rule)', borderRadius: 1, fontSize: 10, color: 'var(--ink-3)', bgcolor: 'var(--bg)', cursor: 'pointer', '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' } }, children: "Reset" })] })] }), _jsxs(Box, { sx: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }, children: [_jsxs(Box, { sx: { display: 'flex', flexShrink: 0 }, children: [_jsx(Box, { sx: { width: RULER_SIZE, height: RULER_SIZE, bgcolor: 'var(--bg-2)', borderRight: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)', flexShrink: 0 } }), _jsx(Box, { sx: { flex: 1, overflow: 'hidden' }, children: _jsx(Ruler, { length: CANVAS_W, horizontal: true, scale: SCALE, offset: offset.x, zoom: zoom }) })] }), _jsxs(Box, { sx: { flex: 1, display: 'flex', overflow: 'hidden' }, children: [_jsx(Box, { sx: { width: RULER_SIZE, flexShrink: 0, overflow: 'hidden' }, children: _jsx(Ruler, { length: CANVAS_H, horizontal: false, scale: SCALE, offset: offset.y, zoom: zoom }) }), _jsxs(Box, { sx: { flex: 1, overflow: 'hidden', position: 'relative' }, children: [_jsxs("svg", { ref: svgRef, width: "100%", height: "100%", style: { cursor: 'grab', userSelect: 'none', display: 'block' }, onMouseDown: onCanvasMouseDown, children: [_jsxs("g", { transform: `translate(${offset.x},${offset.y})`, children: [_jsx("defs", { children: _jsx("pattern", { id: "grid-dots", x: "0", y: "0", width: SCALE * zoom * SNAP, height: SCALE * zoom * SNAP, patternUnits: "userSpaceOnUse", children: _jsx("circle", { cx: "1", cy: "1", r: "1", fill: "var(--rule)", opacity: "0.5" }) }) }), _jsx("rect", { x: "0", y: "0", width: canvasW, height: canvasH, fill: "url(#grid-dots)" }), _jsx("rect", { x: "0", y: "0", width: canvasW, height: canvasH, fill: "none", stroke: "var(--rule)", strokeWidth: "1" }), [...positionedZones].sort((a, b) => {
                                                                const order = { warehouse: 0, lane: 1, shelf: 2, bin: 3 };
                                                                return (order[a.type] ?? 3) - (order[b.type] ?? 3);
                                                            }).map((zone) => {
                                                                const lp = localPositions[zone.location_code];
                                                                const ls = localSizes[zone.location_code];
                                                                const px = toSvg(lp?.x ?? parseFloat(String(zone.position_x)));
                                                                const py = toSvg(lp?.y ?? parseFloat(String(zone.position_y)));
                                                                const pw = toSvg(ls?.w ?? parseFloat(String(zone.width ?? 1)));
                                                                const ph = toSvg(ls?.h ?? parseFloat(String(zone.depth ?? 0.8)));
                                                                // Frame types (lane/warehouse/shelf) use type-based colour regardless of zone_type
                                                                const colorKey = (zone.type === 'lane' || zone.type === 'warehouse' || zone.type === 'shelf')
                                                                    ? zone.type
                                                                    : (zone.zone_type ?? 'storage');
                                                                const fill = ZONE_COLORS[colorKey] ?? ZONE_COLORS.storage;
                                                                const stroke = ZONE_STROKE[colorKey] ?? ZONE_STROKE.storage;
                                                                const isSelected = selected === zone.location_code;
                                                                const isDragging = dragRef.current?.locationCode === zone.location_code;
                                                                const HANDLE = 6;
                                                                return (_jsxs("g", { transform: `translate(${px},${py})`, onMouseDown: (e) => onRackMouseDown(e, zone), style: { cursor: isDragging ? 'grabbing' : 'grab' }, children: [isSelected && (_jsx("rect", { x: "-2", y: "-2", width: pw + 4, height: ph + 4, rx: "5", fill: "none", stroke: "var(--accent)", strokeWidth: "2", opacity: "0.5", strokeDasharray: "4 2" })), _jsx("rect", { x: "0", y: "0", width: pw, height: ph, rx: "3", fill: fill, stroke: isSelected ? 'var(--accent)' : stroke, strokeWidth: isSelected ? 1.5 : 1, opacity: savingRef.current.has(zone.location_code) ? 0.5 : 1 }), (zone.type === 'lane' || zone.type === 'warehouse' || zone.type === 'shelf') ? (_jsxs(_Fragment, { children: [_jsx("rect", { x: "0", y: "0", width: Math.min(pw, 48), height: 14, rx: "3", fill: stroke, opacity: isSelected ? 0.9 : 0.7, style: { pointerEvents: 'none' } }), _jsx("text", { x: "6", y: "7", dominantBaseline: "middle", fontSize: "8", fontFamily: "monospace", fontWeight: 700, fill: "#fff", style: { pointerEvents: 'none', userSelect: 'none' }, children: zone.location_code })] })) : (_jsx("text", { x: pw / 2, y: ph / 2, textAnchor: "middle", dominantBaseline: "middle", fontSize: Math.max(8, Math.min(11, pw * 0.18)), fontFamily: "monospace", fontWeight: isSelected ? 700 : 500, fill: isSelected ? 'var(--accent)' : 'var(--ink-2)', style: { pointerEvents: 'none', userSelect: 'none' }, children: zone.location_code })), zone.rack_levels != null && pw > 28 && (_jsxs("text", { x: pw - 4, y: ph - 4, textAnchor: "end", dominantBaseline: "auto", fontSize: "7", fontFamily: "monospace", fill: stroke, opacity: "0.8", style: { pointerEvents: 'none' }, children: ["L", zone.rack_levels] })), isSelected && (_jsxs(_Fragment, { children: [_jsx("rect", { x: pw - HANDLE / 2, y: ph / 2 - HANDLE / 2, width: HANDLE, height: HANDLE, rx: "1", fill: "var(--bg)", stroke: "var(--accent)", strokeWidth: "1.5", style: { cursor: 'ew-resize' }, onMouseDown: (e) => { e.stopPropagation(); resizeRef.current = { locationCode: zone.location_code, edge: 'e', startMouseX: e.clientX, startMouseY: e.clientY, startW: ls?.w ?? parseFloat(String(zone.width ?? 1)), startD: ls?.h ?? parseFloat(String(zone.depth ?? 0.8)) }; } }), _jsx("rect", { x: pw / 2 - HANDLE / 2, y: ph - HANDLE / 2, width: HANDLE, height: HANDLE, rx: "1", fill: "var(--bg)", stroke: "var(--accent)", strokeWidth: "1.5", style: { cursor: 'ns-resize' }, onMouseDown: (e) => { e.stopPropagation(); resizeRef.current = { locationCode: zone.location_code, edge: 's', startMouseX: e.clientX, startMouseY: e.clientY, startW: ls?.w ?? parseFloat(String(zone.width ?? 1)), startD: ls?.h ?? parseFloat(String(zone.depth ?? 0.8)) }; } }), _jsx("rect", { x: pw - HANDLE / 2, y: ph - HANDLE / 2, width: HANDLE, height: HANDLE, rx: "1", fill: "var(--accent)", stroke: "var(--accent)", strokeWidth: "1.5", style: { cursor: 'nwse-resize' }, onMouseDown: (e) => { e.stopPropagation(); resizeRef.current = { locationCode: zone.location_code, edge: 'se', startMouseX: e.clientX, startMouseY: e.clientY, startW: ls?.w ?? parseFloat(String(zone.width ?? 1)), startD: ls?.h ?? parseFloat(String(zone.depth ?? 0.8)) }; } })] }))] }, zone.location_code));
                                                            })] }), alignGuides.x !== null && (_jsx("line", { x1: alignGuides.x + offset.x, y1: 0, x2: alignGuides.x + offset.x, y2: canvasH + offset.y, stroke: "var(--accent)", strokeWidth: "1", strokeDasharray: "4 3", style: { pointerEvents: 'none' } })), alignGuides.y !== null && (_jsx("line", { x1: 0, y1: alignGuides.y + offset.y, x2: canvasW + offset.x, y2: alignGuides.y + offset.y, stroke: "var(--accent)", strokeWidth: "1", strokeDasharray: "4 3", style: { pointerEvents: 'none' } }))] }), _jsx(Box, { sx: { position: 'absolute', bottom: 8, left: 8, display: 'flex', gap: 1, flexWrap: 'wrap', pointerEvents: 'none' }, children: Object.entries(ZONE_COLORS).map(([type, fill]) => (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.4 }, children: [_jsx(Box, { sx: { width: 8, height: 8, borderRadius: 0.4, bgcolor: fill, border: `1px solid ${ZONE_STROKE[type]}` } }), _jsx(Typography, { sx: { fontSize: 8, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: type })] }, type))) })] })] })] }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0, px: 1, borderTop: '1px solid var(--rule)', bgcolor: 'var(--bg)', flexShrink: 0, overflowX: 'auto', height: 28 }, children: [_jsx(Typography, { sx: { fontSize: 9, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--ink-4)', textTransform: 'uppercase', mr: 1, flexShrink: 0 }, children: "Tree:" }), positionedZones.filter(z => z.type === 'lane' || z.type === 'warehouse').map((z, i, arr) => (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', flexShrink: 0 }, children: [_jsx(Box, { onClick: () => setSelected(z.location_code), sx: { px: 1, py: 0.25, borderRadius: 0.75, cursor: 'pointer', fontSize: 10, fontFamily: 'monospace',
                                            fontWeight: selected === z.location_code ? 700 : 400,
                                            color: selected === z.location_code ? 'var(--accent)' : 'var(--ink-3)',
                                            bgcolor: selected === z.location_code ? 'var(--accent-ghost)' : 'transparent',
                                            '&:hover': { color: 'var(--accent)' } }, children: z.location_code }), i < arr.length - 1 && _jsx(Typography, { sx: { fontSize: 10, color: 'var(--rule)', mx: 0.25 }, children: "/" })] }, z.location_code)))] })] }), selectedZone ? (_jsx(RackInspector, { zone: selectedZone, onClose: () => setSelected(null), onUpdateZone: onUpdateZone, onDeleteZone: onDeleteZone, onPrintBarcode: onPrintBarcode, onCreateZone: onCreateZone })) : (_jsxs(Box, { sx: { width: 220, flexShrink: 0, borderLeft: '1px solid var(--rule)', bgcolor: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, p: 2 }, children: [_jsx(Box, { sx: { width: 32, height: 32, borderRadius: 1, border: '1.5px dashed var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: _jsx(Layers, { size: 14, color: "var(--ink-4)" }) }), _jsx(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)', textAlign: 'center', lineHeight: 1.4 }, children: "Click a zone to inspect and edit" })] }))] }));
}
//# sourceMappingURL=CanvasEditor.js.map