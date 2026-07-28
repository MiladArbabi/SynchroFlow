import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// modules/shared/src/ui/IsometricCanvas.tsx
/**
 * IsometricCanvas — 2.5D isometric SVG floor plan renderer (Phase 3)
 * -------------------------------------------------------------------
 * Pure SVG isometric projection — no Three.js dependency.
 * Read-only surface — editing remains in 2D mode.
 *
 * Coordinate system (world → screen):
 *   screenX = (worldX - worldY) * TILE_W / 2  + originX
 *   screenY = (worldX + worldY) * TILE_H / 2  - worldZ * LEVEL_H + originY
 *
 * Each zone renders as a 3-face isometric box:
 *   TOP   face — zone_type colour at full opacity
 *   LEFT  face — 70% opacity (shadow)
 *   RIGHT face — 50% opacity (deeper shadow)
 *
 * Frame zones (warehouse/lane/shelf) render as flat floor tiles (z=0).
 * Bins render with height = rack_levels × LEVEL_HEIGHT metres.
 *
 * Render order: painter's algorithm — sort by (x + y) ascending so
 * back zones render first and front zones paint over them correctly.
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import { Box, Typography } from '@mui/material';
// ── Constants ────────────────────────────────────────────────────────────────
const ISO_SCALE = 60; // px per metre (world scale)
const LEVEL_HEIGHT = 0.5; // metres per rack level
const TILE_W = ISO_SCALE; // width of one metre in screen px
const TILE_H = TILE_W / 2; // height of one metre in screen px (2:1 ratio)
const LEVEL_H = ISO_SCALE * 0.6; // screen px per rack level height
// Zone colours — sourced from --zone-* brand tokens (themes/index.tsx) so the
// canvas, landing page, and OAuth scene stay in lockstep. Alpha math unchanged.
const ZONE_KEYS = ['lane', 'shelf', 'warehouse', 'storage', 'pick', 'pack', 'receive', 'ship', 'returns', 'problem', 'kitting', 'quarantine'];
const FILL_A = {
    warehouse: 0.15, shelf: 0.20, lane: 0.25, storage: 0.30,
    pick: 0.35, receive: 0.35, ship: 0.35, pack: 0.40,
    returns: 0.40, problem: 0.48, kitting: 0.40, quarantine: 0.50,
};
const STROKE_A = {
    warehouse: 0.4, shelf: 0.5, lane: 0.6, storage: 0.7,
    pick: 0.9, pack: 0.9, receive: 0.9, ship: 0.9,
    returns: 0.9, problem: 1.0, kitting: 0.9, quarantine: 1.0,
};
// Keep zone colours as live CSS references so theme availability and mode changes
// are reflected without rebuilding module-level constants.
function zoneRGBVar(key) {
    return `var(--zone-${key}, 100,116,139)`;
}
const ZONE_COLORS = Object.fromEntries(ZONE_KEYS.map(k => [k, `rgba(${zoneRGBVar(k)},${FILL_A[k] ?? 0.30})`]));
const ZONE_STROKE = Object.fromEntries(ZONE_KEYS.map(k => [k, `rgba(${zoneRGBVar(k)},${STROKE_A[k] ?? 0.7})`]));
// ── Isometric projection ──────────────────────────────────────────────────────
/**
 * Project a 3D world point to 2D screen coordinates.
 * @param wx  world X (metres, rightward)
 * @param wy  world Y (metres, downward/depth)
 * @param wz  world Z (metres, upward height)
 * @param zoom current zoom level
 */
function project(wx, wy, wz, zoom, flipped = false) {
    const tw = TILE_W * zoom;
    const th = TILE_H * zoom;
    const lh = LEVEL_H * zoom;
    const sx = flipped ? (wy - wx) * tw / 2 : (wx - wy) * tw / 2;
    return {
        sx,
        sy: (wx + wy) * th / 2 - wz * lh,
    };
}
/** Convert 6 projected corners to SVG polygon points string */
function pts(...coords) {
    return coords.map(c => `${c.sx.toFixed(1)},${c.sy.toFixed(1)}`).join(' ');
}
function IsometricBox({ wx, wy, ww, wd, wh, colorKey, isSelected, isFrame, isDimmed, label, rackLevels, zoom, onClick, flipped, occupancyFraction, focusTone }) {
    const baseFill = ZONE_COLORS[colorKey] ?? ZONE_COLORS.storage;
    const stroke = ZONE_STROKE[colorKey] ?? ZONE_STROKE.storage;
    const selStroke = 'var(--accent)';
    // Occupancy heatmap: empty grey → low green → medium orange → high red.
    const fillOverride = occupancyFraction != null
        ? occupancyFraction >= 0.85 ? `rgba(${zoneRGBVar('quarantine')},0.75)`
            : occupancyFraction >= 0.5 ? `rgba(${zoneRGBVar('pack')},0.65)`
                : occupancyFraction > 0 ? `rgba(${zoneRGBVar('receive')},0.55)`
                    : 'rgba(100,116,139,0.25)'
        : null;
    // Focus overlays use explicit semantics instead of relying only on dimming.
    const focusFill = focusTone === 'risk'
        ? `rgba(${zoneRGBVar('quarantine')},0.72)`
        : focusTone === 'empty'
            ? 'rgba(100,116,139,0.55)'
            : null;
    // Apply the active overlay colour to the complete bin.
    const fill = focusFill ?? fillOverride ?? baseFill;
    // Per-level fill cycles dark → light → default every three levels.
    const LEVEL_ALPHA_FACTORS = [0.85, 0.55, 1.0];
    function levelFill(levelIndex) {
        const factor = LEVEL_ALPHA_FACTORS[levelIndex % 3];
        return fill.replace(/[\d.]+\)$/, m => `${Math.min(1, parseFloat(m) * factor * 2.5)})`);
    }
    // 8 corners of the box in world space → projected
    // Bottom face corners
    const b00 = project(wx, wy, 0, zoom, flipped);
    const b10 = project(wx + ww, wy, 0, zoom, flipped);
    const b11 = project(wx + ww, wy + wd, 0, zoom, flipped);
    const b01 = project(wx, wy + wd, 0, zoom, flipped);
    // Top face corners
    const t00 = project(wx, wy, wh, zoom, flipped);
    const t10 = project(wx + ww, wy, wh, zoom, flipped);
    const t11 = project(wx + ww, wy + wd, wh, zoom, flipped);
    const t01 = project(wx, wy + wd, wh, zoom, flipped);
    // Darken side faces
    const leftFill = fill.replace(/[\d.]+\)$/, m => `${Math.min(1, parseFloat(m) * 1.4)})`).replace('rgba', 'rgba').replace(/,[\d.]+\)/, `,${0.55})`);
    const rightFill = fill.replace(/,[\d.]+\)/, `,${0.40})`);
    const isFlat = wh < 0.01;
    return (
    /* Group opacity keeps top, sides, labels, and strokes in one focus state. */
    _jsxs("g", { onClick: onClick, style: { cursor: 'pointer' }, opacity: isDimmed ? 0.25 : 1, children: [_jsx("polygon", { points: pts(t00, t10, t11, t01), fill: fill, stroke: isSelected ? selStroke : stroke, strokeWidth: isSelected ? 2 : 1, opacity: isFlat ? 0.6 : 1 }), isSelected && (_jsx("polygon", { points: pts(t00, t10, t11, t01), fill: "none", stroke: selStroke, strokeWidth: "2", strokeDasharray: "4 2", opacity: "0.8" })), (() => {
                const centre = project(wx + ww / 2, wy + wd / 2, wh + 0.05, zoom, flipped);
                const fontSize = Math.max(7, Math.min(10, TILE_W * zoom * ww * 0.12));
                return (_jsx("text", { x: centre.sx, y: centre.sy, textAnchor: "middle", dominantBaseline: "middle", fontSize: fontSize, fontFamily: "monospace", fontWeight: isSelected ? 700 : 600, fill: isSelected ? 'var(--accent)' : isFrame ? `rgba(${zoneRGBVar('lane')},0.9)` : 'var(--ink)', style: { pointerEvents: 'none', userSelect: 'none' }, children: label }));
            })(), !isFlat && rackLevels != null && rackLevels > 1 && Array.from({ length: rackLevels }, (_, i) => {
                const z0 = i * LEVEL_HEIGHT;
                const z1 = (i + 1) * LEVEL_HEIGHT;
                const lFill = levelFill(i);
                const lFillDark = lFill.replace(/[\d.]+\)$/, m => `${Math.min(1, parseFloat(m) * 0.75)})`);
                // Left face slice corners
                const ll0 = project(wx, wy + wd, z0, zoom, flipped);
                const ll1 = project(wx + ww, wy + wd, z0, zoom, flipped);
                const lu0 = project(wx, wy + wd, z1, zoom, flipped);
                const lu1 = project(wx + ww, wy + wd, z1, zoom, flipped);
                // Right face slice corners
                const rl0 = project(wx + ww, wy, z0, zoom, flipped);
                const rl1 = project(wx + ww, wy + wd, z0, zoom, flipped);
                const ru0 = project(wx + ww, wy, z1, zoom, flipped);
                const ru1 = project(wx + ww, wy + wd, z1, zoom, flipped);
                return (_jsxs("g", { children: [_jsx("polygon", { points: pts(ll0, ll1, lu1, lu0), fill: lFill, stroke: stroke, strokeWidth: "0.4" }), _jsx("polygon", { points: pts(rl0, rl1, ru1, ru0), fill: lFillDark, stroke: stroke, strokeWidth: "0.4" })] }, i));
            })] }));
}
export function IsometricCanvas({ zones, onSelect, filteredCodes, highlightZoneTypes, focusedBins, focusTone, occupancy, showFloor = true, showBins = true, initialZoom = 0.9, initialOffset = { x: 420, y: 120 }, autoFit = true, fitPadding = 0.68, showLegend = true, showControls = true, disablePan = false, stations, liveActivity, packQueueCount, onUnplacedZonesClick, overlay, summaryCounts, onRefresh, }) {
    const svgRef = useRef(null);
    const [zoom, setZoom] = useState(initialZoom);
    const [offset, setOffset] = useState(initialOffset);
    const [selected, setSelected] = useState(null);
    const [flipped, setFlipped] = useState(false);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const panRef = useRef(null);
    const zoomRef = useRef(zoom);
    const offsetRef = useRef(offset);
    const sizeRef = useRef(size);
    const bboxRef = useRef(null);
    zoomRef.current = zoom;
    offsetRef.current = offset;
    sizeRef.current = size;
    // Apply zone filter rail selection; if no filter provided, show all positioned zones.
    const isFrame = (z) => z.type === 'warehouse' || z.type === 'lane' || z.type === 'shelf';
    const positionedZones = zones.filter(z => z.position_x != null && z.position_y != null &&
        (filteredCodes == null || filteredCodes.has(z.location_code)) &&
        (isFrame(z) ? showFloor : showBins));
    // FP-NULL1: unfiltered count — independent of filteredCodes/showFloor/
    // showBins so toggling display filters never changes what merchants are
    // told about their actual data completeness.
    const unplacedCount = zones.filter(z => z.position_x == null || z.position_y == null).length;
    // FP-LEGEND1: mirrors IsometricBox's fillOverride/focusFill thresholds
    // exactly — same zoneRGBVar keys, same alpha values — so the legend
    // can never show a color that doesn't match what's actually painted.
    const legendItems = (() => {
        if (overlay === 'stockout') {
            return [{ label: 'At risk · ≤3 units', rgba: `rgba(${zoneRGBVar('quarantine')},0.72)` }];
        }
        if (overlay === 'empty') {
            return [{ label: 'Empty', rgba: 'rgba(100,116,139,0.55)' }];
        }
        if (overlay === 'occupancy') {
            return [
                { label: 'Empty', rgba: 'rgba(100,116,139,0.25)' },
                { label: 'Below 50%', rgba: `rgba(${zoneRGBVar('receive')},0.55)` },
                { label: '50–85%', rgba: `rgba(${zoneRGBVar('pack')},0.65)` },
                { label: 'Hot · 85%', rgba: `rgba(${zoneRGBVar('quarantine')},0.75)` },
            ];
        }
        return null; // 'none' or omitted — no legend
    })();
    const worldBounds = useMemo(() => {
        if (positionedZones.length === 0)
            return null;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const z of positionedZones) {
            const wx = parseFloat(String(z.position_x ?? 0));
            const wy = parseFloat(String(z.position_y ?? 0));
            const ww = parseFloat(String(z.width ?? 1));
            const wd = parseFloat(String(z.depth ?? 0.5));
            if (wx < minX)
                minX = wx;
            if (wx + ww > maxX)
                maxX = wx + ww;
            if (wy < minY)
                minY = wy;
            if (wy + wd > maxY)
                maxY = wy + wd;
        }
        return { minX, maxX, minY, maxY };
    }, [positionedZones]);
    /**
     * OV-13 — apron geometry, resolved once and shared by the renderer and by
     * both fit bboxes so a station can never be painted outside the fitted view.
     *
     * Placement works in ISOMETRIC SCREEN space, not world X. Because
     *   sx = (wx - wy) * TILE_W/2      sy = (wx + wy) * TILE_H/2 - wz * LEVEL_H
     * changing world X alone moves a box diagonally — right AND down-screen —
     * which is why the old `worldBounds.minX - 4.0` anchor pushed the order pool
     * up-left INTO the PICK-0B rack column instead of beside the slab. We work in
     * the rotated basis instead:
     *   v = wx - wy  → drives screen X only
     *   u = wx + wy  → drives screen Y only
     * pin the apron a fixed gutter clear of the slab's rightmost screen edge
     * (max v), vertically centred on it (mid u), then invert back to world
     * coords. Since the gutter is applied in v, the apron column is horizontally
     * disjoint from every zone at ANY bar height, zone count, or zoom level.
     */
    const stationPlacements = useMemo(() => {
        if (!stations || !worldBounds)
            return [];
        const { minX, maxX, minY, maxY } = worldBounds;
        const vMax = maxX - minY; // slab's rightmost screen edge
        const vMin = minX - maxY; // slab's leftmost screen edge
        const uMid = (minX + minY + maxX + maxY) / 2; // slab's vertical screen centre
        const GUTTER = 2.0; // world-diagonal metres of guaranteed clear space
        const tw = 1.5, td = 0.75; // apron footprint
        const MAX_BAR_H = 2.5;
        // Mirrored view negates screen X, so "right of the slab" becomes minimum v.
        const vRight = flipped ? vMin - GUTTER - tw : vMax + GUTTER + td;
        const vLeft = flipped ? vMax + GUTTER + td : vMin - GUTTER - tw;
        return stations
            .filter(s => s.count > 0)
            .map(station => {
            // Order pool ('inbound') rides the RIGHT rail — it represents orders
            // waiting to be released to the floor, read before the floor itself.
            const v0 = station.side === 'inbound' ? vRight : vLeft;
            const u0 = uMid - (tw + td) / 2;
            // OV-13: urgentCount is an independent server count (blocked orders)
            // and can legitimately exceed the pool count. Left unclamped it gave
            // urgentFrac > 1 → negative normalH → inverted, self-intersecting
            // polygons drawn below the floor plane: the "red arch" defect.
            const urgentCount = Math.min(station.count, Math.max(0, station.urgentCount ?? 0));
            const totalBarH = Math.min(MAX_BAR_H, 0.4 + station.count * 0.06);
            const urgentH = totalBarH * (urgentCount / station.count);
            const normalH = Math.max(0, totalBarH - urgentH);
            return {
                station,
                wx: (u0 + v0) / 2,
                wy: (u0 - v0) / 2,
                tw, td, totalBarH, urgentH, normalH,
            };
        });
    }, [stations, worldBounds, flipped]);
    // Apron height and visibility track the counts, so the fit must react to
    // count changes exactly as it reacts to layout changes.
    const stationSig = stationPlacements
        .map(p => `${p.station.id}:${p.station.count}:${p.station.urgentCount ?? 0}`)
        .join('|');
    // Signature of what's drawn — refit only when the layout actually changes,
    // never on every render (so manual pan/zoom survives between changes).
    // World-space bounding box — used to anchor synthetic apron stations.
    const zoneSig = positionedZones
        .map(z => `${z.location_code}:${z.position_x},${z.position_y},${z.width},${z.depth},${z.rack_levels ?? ''}`)
        .join('|');
    // Auto-fit: centre + contain the whole warehouse in the current container.
    // Projection scales linearly with zoom and has no additive origin, so we
    // project all corners at zoom 1, take the screen-space bbox, then solve for
    // the zoom + offset that fits it with a margin.
    // Recompute projected bbox at zoom=1 whenever layout or flip changes.
    // Stored in ref so the pan event handler can read it without stale closure.
    useEffect(() => {
        if (positionedZones.length === 0) {
            bboxRef.current = null;
            return;
        }
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const z of positionedZones) {
            const wx = parseFloat(String(z.position_x ?? 0));
            const wy = parseFloat(String(z.position_y ?? 0));
            const ww = parseFloat(String(z.width ?? 1));
            const wd = parseFloat(String(z.depth ?? 0.5));
            const wh = isFrame(z) ? 0 : (z.rack_levels ?? 1) * LEVEL_HEIGHT;
            const corners = [
                [wx, wy, 0], [wx + ww, wy, 0], [wx + ww, wy + wd, 0], [wx, wy + wd, 0],
                [wx, wy, wh], [wx + ww, wy, wh], [wx + wh, wy + wd, wh], [wx, wy + wd, wh],
            ];
            for (const [px, py, pz] of corners) {
                const { sx, sy } = project(px, py, pz, 1, flipped);
                if (sx < minX)
                    minX = sx;
                if (sx > maxX)
                    maxX = sx;
                if (sy < minY)
                    minY = sy;
                if (sy > maxY)
                    maxY = sy;
            }
        }
        // OV-13: aprons are drawn but were not measured, so the clamp could park
        // them off-canvas. +0.6 m of headroom covers the count badge and label
        // text drawn above the bar top face.
        for (const p of stationPlacements) {
            const top = p.totalBarH + 0.6;
            const corners = [
                [p.wx, p.wy, 0], [p.wx + p.tw, p.wy, 0],
                [p.wx + p.tw, p.wy + p.td, 0], [p.wx, p.wy + p.td, 0],
                [p.wx, p.wy, top], [p.wx + p.tw, p.wy, top],
                [p.wx + p.tw, p.wy + p.td, top], [p.wx, p.wy + p.td, top],
            ];
            for (const [px, py, pz] of corners) {
                const { sx, sy } = project(px, py, pz, 1, flipped);
                if (sx < minX)
                    minX = sx;
                if (sx > maxX)
                    maxX = sx;
                if (sy < minY)
                    minY = sy;
                if (sy > maxY)
                    maxY = sy;
            }
        }
        bboxRef.current = { minX, maxX, minY, maxY };
    }, [zoneSig, stationSig, flipped]);
    // Painter's algorithm: sort by (position_x + position_y) ascending — back zones first
    // Painter's algorithm: ascending = back-to-front for standard view.
    // Flipped view mirrors the projection axis so sort must reverse to maintain correct occlusion.
    const sorted = [...positionedZones].sort((a, b) => {
        const da = parseFloat(String(a.position_x ?? 0)) + parseFloat(String(a.position_y ?? 0));
        const db = parseFloat(String(b.position_x ?? 0)) + parseFloat(String(b.position_y ?? 0));
        const typeOrder = { warehouse: 0, lane: 1, shelf: 2, bin: 3 };
        if (Math.abs(da - db) < 0.01)
            return (typeOrder[a.type] ?? 3) - (typeOrder[b.type] ?? 3);
        return flipped ? db - da : da - db;
    });
    function handleSelect(code) {
        const next = selected === code ? null : code;
        setSelected(next);
        onSelect?.(next);
    }
    // Clamp pan offset so at least one quarter of the active floor bbox remains visible.
    // Allows generous panning for large warehouses while preventing total content loss.
    function clampOffset(x, y, z) {
        const bbox = bboxRef.current;
        const { w, h } = sizeRef.current;
        if (!bbox || w === 0 || h === 0)
            return { x, y };
        const margin = 80; // px — minimum visible strip at each edge
        const scaledMinX = bbox.minX * z;
        const scaledMaxX = bbox.maxX * z;
        const scaledMinY = bbox.minY * z;
        const scaledMaxY = bbox.maxY * z;
        const clampedX = Math.min(w - margin - scaledMinX, Math.max(margin - scaledMaxX, x));
        const clampedY = Math.min(h - margin - scaledMinY, Math.max(margin - scaledMaxY, y));
        return { x: clampedX, y: clampedY };
    }
    function onCanvasMouseDown(e) {
        if (disablePan)
            return;
        panRef.current = { startX: e.clientX, startY: e.clientY, startOX: offset.x, startOY: offset.y };
    }
    useEffect(() => {
        function onMouseMove(e) {
            if (!panRef.current)
                return;
            const rawX = panRef.current.startOX + (e.clientX - panRef.current.startX);
            const rawY = panRef.current.startOY + (e.clientY - panRef.current.startY);
            setOffset(clampOffset(rawX, rawY, zoomRef.current));
        }
        function onMouseUp() { panRef.current = null; }
        function onWheel(e) {
            e.preventDefault();
            setOffset(prev => {
                const rawX = prev.x - (e.shiftKey ? e.deltaY : e.deltaX) * 0.8;
                const rawY = prev.y - (e.shiftKey ? 0 : e.deltaY) * 0.8;
                return clampOffset(rawX, rawY, zoomRef.current);
            });
        }
        const svgEl = svgRef.current;
        if (svgEl && !disablePan)
            svgEl.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            if (svgEl)
                svgEl.removeEventListener('wheel', onWheel);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, []);
    // Track the real rendered size of the canvas so the fit adapts to whatever
    // column / aspect ratio it lands in (Order Flow, detail embeds, etc.).
    useEffect(() => {
        const el = svgRef.current;
        if (!el)
            return;
        const ro = new ResizeObserver(entries => {
            const r = entries[0]?.contentRect;
            if (!r)
                return;
            const w = Math.round(r.width);
            const h = Math.round(r.height);
            setSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    useEffect(() => {
        if (!autoFit || size.w === 0 || size.h === 0 || positionedZones.length === 0)
            return;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const z of positionedZones) {
            const wx = parseFloat(String(z.position_x ?? 0));
            const wy = parseFloat(String(z.position_y ?? 0));
            const ww = parseFloat(String(z.width ?? 1));
            const wd = parseFloat(String(z.depth ?? 0.5));
            const wh = isFrame(z) ? 0 : (z.rack_levels ?? 1) * LEVEL_HEIGHT;
            const corners = [
                [wx, wy, 0], [wx + ww, wy, 0], [wx + ww, wy + wd, 0], [wx, wy + wd, 0],
                [wx, wy, wh], [wx + ww, wy, wh], [wx + ww, wy + wd, wh], [wx, wy + wd, wh],
            ];
            for (const [px, py, pz] of corners) {
                const { sx, sy } = project(px, py, pz, 1, flipped);
                if (sx < minX)
                    minX = sx;
                if (sx > maxX)
                    maxX = sx;
                if (sy < minY)
                    minY = sy;
                if (sy > maxY)
                    maxY = sy;
            }
        }
        // OV-13: same union as the clamp bbox — without it autoFit solves a zoom
        // that fits the slab only, and the apron gets cropped at the right edge.
        for (const p of stationPlacements) {
            const top = p.totalBarH + 0.6;
            const corners = [
                [p.wx, p.wy, 0], [p.wx + p.tw, p.wy, 0],
                [p.wx + p.tw, p.wy + p.td, 0], [p.wx, p.wy + p.td, 0],
                [p.wx, p.wy, top], [p.wx + p.tw, p.wy, top],
                [p.wx + p.tw, p.wy + p.td, top], [p.wx, p.wy + p.td, top],
            ];
            for (const [px, py, pz] of corners) {
                const { sx, sy } = project(px, py, pz, 1, flipped);
                if (sx < minX)
                    minX = sx;
                if (sx > maxX)
                    maxX = sx;
                if (sy < minY)
                    minY = sy;
                if (sy > maxY)
                    maxY = sy;
            }
        }
        const bboxW = Math.max(1, maxX - minX);
        const bboxH = Math.max(1, maxY - minY);
        const fitZoom = Math.min(2.5, Math.max(0.3, Math.min(size.w / bboxW, size.h / bboxH) * fitPadding));
        const cx = ((minX + maxX) / 2) * fitZoom;
        const cy = ((minY + maxY) / 2) * fitZoom;
        setZoom(fitZoom);
        setOffset({ x: size.w / 2 - cx, y: size.h / 2 - cy });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoFit, size.w, size.h, flipped, zoneSig]);
    return (_jsxs(Box, { sx: { display: 'flex', width: '100%', height: '100%', position: 'relative', overflow: 'hidden', bgcolor: 'var(--bg-2)' }, children: [_jsx("svg", { ref: svgRef, width: "100%", height: "100%", style: { cursor: disablePan ? 'default' : 'grab', userSelect: 'none', display: 'block' }, onMouseDown: onCanvasMouseDown, children: _jsxs("g", { transform: `translate(${offset.x},${offset.y})`, children: [sorted.map((zone) => {
                            const wx = parseFloat(String(zone.position_x ?? 0));
                            const wy = parseFloat(String(zone.position_y ?? 0));
                            const ww = parseFloat(String(zone.width ?? 1));
                            const wd = parseFloat(String(zone.depth ?? 0.5));
                            const isFrame = zone.type === 'warehouse' || zone.type === 'lane' || zone.type === 'shelf';
                            const rackLevels = zone.rack_levels ?? null;
                            const wh = isFrame ? 0 : (rackLevels ?? 1) * LEVEL_HEIGHT;
                            const colorKey = isFrame ? zone.type : (zone.zone_type ?? 'storage');
                            // Occupancy fraction: bins only. Capacity = rack_levels × 10 units (fallback 10).
                            const occ = !isFrame && occupancy ? occupancy[zone.location_code] : undefined;
                            const capacity = (zone.rack_levels ?? 1) * 10;
                            const occupancyFraction = !isFrame && occupancy
                                ? Math.min(1, (occ?.on_hand_quantity ?? 0) / capacity)
                                : undefined;
                            const activity = liveActivity?.[zone.location_code];
                            const dotPt = activity?.hasActivePick
                                ? project(wx + ww / 2, wy + wd / 2, wh + 0.35, zoom, flipped)
                                : null;
                            const packPt = !isFrame && zone.zone_type === 'pack' && (packQueueCount ?? 0) > 0
                                ? project(wx + ww + 0.3, wy + wd / 2, wh + 0.35, zoom, flipped)
                                : null;
                            return (_jsxs("g", { children: [_jsx(IsometricBox, { wx: wx, wy: wy, ww: ww, wd: wd, wh: wh, colorKey: colorKey, isSelected: selected === zone.location_code, isDimmed: !isFrame && ((highlightZoneTypes != null &&
                                            highlightZoneTypes.size > 0 &&
                                            !highlightZoneTypes.has(zone.zone_type ?? '')) ||
                                            (focusedBins != null &&
                                                zone.type === 'bin' &&
                                                !focusedBins.includes(zone.location_code))), focusTone: !isFrame &&
                                            zone.type === 'bin' &&
                                            focusedBins?.includes(zone.location_code)
                                            ? focusTone
                                            : undefined, isFrame: isFrame, label: zone.type === 'warehouse' && zone.warehouse_name ? zone.warehouse_name : zone.location_code, rackLevels: rackLevels, zoom: zoom, flipped: flipped, onClick: () => handleSelect(zone.location_code), occupancyFraction: occupancyFraction }, zone.location_code), dotPt && (_jsxs("g", { children: [_jsx("circle", { cx: dotPt.sx, cy: dotPt.sy, r: 5 * zoom, fill: activity?.status === 'packing' ? '#D9A23B' : '#4CAF7A', opacity: 0.9 }), (activity?.operatorCount ?? 0) > 1 && (_jsx("text", { x: dotPt.sx, y: dotPt.sy + 1, textAnchor: "middle", dominantBaseline: "middle", fontSize: Math.round(6 * zoom), fontWeight: "600", fill: "var(--bg)", fontFamily: "monospace", children: activity.operatorCount }))] })), packPt && (_jsxs("g", { children: [_jsxs("g", { children: [_jsx("rect", { x: packPt.sx - 5 * zoom, y: packPt.sy - 5 * zoom, width: 10 * zoom, height: 9 * zoom, rx: 1 * zoom, fill: "#D9A23B", stroke: "var(--bg)", strokeWidth: 0.75, opacity: 0.92 }), _jsx("line", { x1: packPt.sx, y1: packPt.sy - 5 * zoom, x2: packPt.sx, y2: packPt.sy + 4 * zoom, stroke: "var(--bg)", strokeWidth: 0.75, opacity: 0.6 }), _jsx("animate", { attributeName: "opacity", values: "1;0.6;1", dur: "2.6s", repeatCount: "indefinite" })] }), _jsx("text", { x: packPt.sx + 9 * zoom, y: packPt.sy + 1, textAnchor: "start", dominantBaseline: "middle", fontSize: Math.round(7 * zoom), fontWeight: "600", fill: "var(--ink)", fontFamily: "monospace", children: packQueueCount })] }))] }, zone.location_code));
                        }), stationPlacements.map(({ station, wx, wy, tw, td, totalBarH, urgentH, normalH }) => {
                            // Normal (lower) bar
                            const nb00 = project(wx, wy, 0, zoom, flipped);
                            const nb10 = project(wx + tw, wy, 0, zoom, flipped);
                            const nb11 = project(wx + tw, wy + td, 0, zoom, flipped);
                            const nb01 = project(wx, wy + td, 0, zoom, flipped);
                            const nt00 = project(wx, wy, normalH, zoom, flipped);
                            const nt10 = project(wx + tw, wy, normalH, zoom, flipped);
                            const nt11 = project(wx + tw, wy + td, normalH, zoom, flipped);
                            const nt01 = project(wx, wy + td, normalH, zoom, flipped);
                            // Urgent (upper) bar — stacked on top of normal
                            const ub00 = project(wx, wy, normalH, zoom, flipped);
                            const ub10 = project(wx + tw, wy, normalH, zoom, flipped);
                            const ub11 = project(wx + tw, wy + td, normalH, zoom, flipped);
                            const ub01 = project(wx, wy + td, normalH, zoom, flipped);
                            const ut00 = project(wx, wy, totalBarH, zoom, flipped);
                            const ut10 = project(wx + tw, wy, totalBarH, zoom, flipped);
                            const ut11 = project(wx + tw, wy + td, totalBarH, zoom, flipped);
                            const ut01 = project(wx, wy + td, totalBarH, zoom, flipped);
                            const countPt = project(wx + tw / 2, wy + td / 2, totalBarH + 0.45, zoom, flipped);
                            const labelPt = project(wx + tw / 2, wy + td / 2, totalBarH + 0.15, zoom, flipped);
                            const countColor = urgentH > 0.01 ? '#E5484D' : 'var(--accent)';
                            const accentFill = 'var(--accent)';
                            return (_jsxs("g", { style: { cursor: station.deepLink ? 'pointer' : 'default' }, onClick: () => { if (station.deepLink)
                                    onSelect?.(station.id); }, children: [normalH > 0.01 && (_jsxs(_Fragment, { children: [_jsx("polygon", { points: pts(nt01, nt11, nb11, nb01), fill: accentFill, fillOpacity: 0.45 }), _jsx("polygon", { points: pts(nt10, nb10, nb11, nt11), fill: accentFill, fillOpacity: 0.32 }), _jsx("polygon", { points: pts(nt00, nt10, nt11, nt01), fill: accentFill, fillOpacity: 0.75 })] })), urgentH > 0.01 && (_jsxs(_Fragment, { children: [_jsx("polygon", { points: pts(ut01, ut11, ub11, ub01), fill: "#E5484D", fillOpacity: 0.55 }), _jsx("polygon", { points: pts(ut10, ub10, ub11, ut11), fill: "#E5484D", fillOpacity: 0.40 }), _jsx("polygon", { points: pts(ut00, ut10, ut11, ut01), fill: "#E5484D", fillOpacity: 0.85 })] })), _jsx("text", { x: countPt.sx, y: countPt.sy, textAnchor: "middle", fontSize: Math.round(11 * zoom), fontWeight: "600", fill: countColor, fontFamily: "monospace", children: station.count }), _jsx("text", { x: labelPt.sx, y: labelPt.sy, textAnchor: "middle", fontSize: Math.round(8 * zoom), fontWeight: "400", fill: "var(--ink-3)", fontFamily: "monospace", children: station.label })] }, station.id));
                        })] }) }), showControls && _jsxs(Box, { sx: { position: 'absolute', bottom: 12, right: 12, display: 'flex', flexDirection: 'column', gap: 0.5 }, children: [[{ label: '+', delta: 0.15 }, { label: '−', delta: -0.15 }].map(({ label, delta }) => (_jsx(Box, { onClick: () => setZoom(z => Math.min(2.5, Math.max(0.3, z + delta))), sx: { width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: '1px solid var(--rule)', borderRadius: 1, cursor: 'pointer', fontSize: 16,
                            color: 'var(--ink-3)', bgcolor: 'var(--bg)', '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' } }, children: label }, label))), _jsx(Box, { onClick: () => { setZoom(0.9); setOffset({ x: 420, y: 120 }); }, sx: { px: 0.5, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: '1px solid var(--rule)', borderRadius: 1, fontSize: 9, color: 'var(--ink-4)',
                            bgcolor: 'var(--bg)', cursor: 'pointer', fontFamily: 'monospace',
                            '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' } }, children: "Reset" }), _jsx(Box, { onClick: () => { setFlipped(f => !f); setOffset({ x: 420, y: 120 }); }, title: flipped ? 'Switch to standard view' : 'Switch to mirrored view', sx: { px: 0.5, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: '1px solid var(--rule)', borderRadius: 1, fontSize: 9,
                            color: flipped ? 'var(--accent)' : 'var(--ink-4)',
                            borderColor: flipped ? 'var(--accent)' : 'var(--rule)',
                            bgcolor: 'var(--bg)', cursor: 'pointer', fontFamily: 'monospace',
                            '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' } }, children: flipped ? '↙' : '↗' }), onRefresh && (_jsx(Box, { onClick: onRefresh, title: "Refresh layout data", sx: { width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: '1px solid var(--rule)', borderRadius: 1, cursor: 'pointer', fontSize: 14,
                            color: 'var(--ink-3)', bgcolor: 'var(--bg)',
                            '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' } }, children: "\u21BB" }))] }), showLegend && legendItems && (_jsx(Box, { sx: { position: 'absolute', top: 8, right: 8, display: 'flex', flexDirection: 'column', gap: 0.5,
                    bgcolor: 'var(--bg)', border: '1px solid var(--rule)', borderRadius: 1.5, p: 1, opacity: 0.85 }, children: legendItems.map((item) => (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.75 }, children: [_jsx(Box, { sx: { width: 12, height: 12, borderRadius: 0.5, bgcolor: item.rgba, border: '1px solid var(--rule)' } }), _jsx(Typography, { sx: { fontSize: 9, fontWeight: 500, color: 'var(--ink-4)' }, children: item.label })] }, item.label))) })), summaryCounts && (_jsxs(Box, { sx: {
                    position: 'absolute', top: 8, left: 8,
                    display: 'flex', alignItems: 'center', gap: 0.75,
                    bgcolor: 'var(--bg)', border: '1px solid var(--rule)', borderRadius: 1.5,
                    px: 1.25, py: 0.75, opacity: 0.95,
                }, children: [_jsxs(Typography, { sx: {
                            fontSize: 12, fontWeight: 700,
                            color: summaryCounts.atRisk > 0 ? `rgba(${zoneRGBVar('pack')},1)` : 'var(--ink-4)',
                        }, children: [summaryCounts.atRisk, " low on stock"] }), _jsx(Typography, { sx: { fontSize: 12, color: 'var(--ink-4)' }, children: "\u00B7" }), _jsxs(Typography, { sx: {
                            fontSize: 12, fontWeight: 700,
                            color: summaryCounts.empty > 0 ? `rgba(${zoneRGBVar('quarantine')},1)` : 'var(--ink-4)',
                        }, children: [summaryCounts.empty, " out of stock"] }), _jsxs(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)', ml: 0.5 }, children: ["/ ", summaryCounts.total, " bins"] })] })), unplacedCount > 0 && (_jsx(Box, { onClick: onUnplacedZonesClick, sx: {
                    position: 'absolute', top: summaryCounts ? 44 : 8, left: 8,
                    display: 'flex', alignItems: 'center', gap: 0.5,
                    bgcolor: 'var(--bg)', border: '1px solid var(--rule)', borderRadius: 1.5,
                    px: 1, py: 0.5, opacity: 0.9,
                    cursor: onUnplacedZonesClick ? 'pointer' : 'default',
                    '&:hover': onUnplacedZonesClick ? { borderColor: 'var(--accent)' } : undefined,
                }, children: _jsxs(Typography, { sx: { fontSize: 9, fontWeight: 600, color: 'var(--ink-3)' }, children: [unplacedCount, " location", unplacedCount === 1 ? '' : 's', " not placed on the floor"] }) }))] }));
}
export function IsometricZoneView({ zone, width = 120, height = 90 }) {
    const ww = parseFloat(String(zone.width ?? 1));
    const wd = parseFloat(String(zone.depth ?? 0.5));
    const wh = (zone.rack_levels ?? 1) * LEVEL_HEIGHT;
    const isFrame = zone.type === 'warehouse' || zone.type === 'lane' || zone.type === 'shelf';
    const colorKey = isFrame ? zone.type : (zone.zone_type ?? 'storage');
    // Fixed zoom to fit zone in viewport — scale to the smaller axis
    const zoom = Math.min((width * 0.5) / ((ww + wd) * TILE_W / 2), (height * 0.6) / ((ww + wd) * TILE_H / 2 + wh * LEVEL_H));
    // Centre the box in the viewport: project the centre bottom of the bounding diamond
    const cx = width / 2;
    const cy = height * 0.65;
    // Render at world origin (0,0) then translate to centre via SVG transform
    const originPt = project(0, 0, 0, zoom);
    return (_jsx("svg", { width: width, height: height, viewBox: `0 0 ${width} ${height}`, xmlns: "http://www.w3.org/2000/svg", style: { display: 'block', overflow: 'visible' }, children: _jsx("g", { transform: `translate(${cx - originPt.sx}, ${cy - originPt.sy})`, children: _jsx(IsometricBox, { wx: 0, wy: 0, ww: ww, wd: wd, wh: wh, colorKey: colorKey, isSelected: false, isFrame: isFrame, label: zone.location_code, rackLevels: zone.rack_levels ?? null, zoom: zoom, flipped: false, onClick: () => { } }) }) }));
}
