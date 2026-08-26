import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
// Physical zones share one neutral base family. Zone type remains encoded by
// label, geometry and alpha hierarchy — strong colour is reserved for live
// operational state and explicit analytical overlays.
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
const ZONE_COLORS = Object.fromEntries(ZONE_KEYS.map(k => [
    k,
    `rgba(${zoneRGBVar('storage')},${FILL_A[k] ?? 0.30})`,
]));
const ZONE_STROKE = Object.fromEntries(ZONE_KEYS.map(k => [
    k,
    `rgba(${zoneRGBVar('storage')},${STROKE_A[k] ?? 0.7})`,
]));
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
function rotateScreenPoint(point, origin, angle) {
    const radians = (angle * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const dx = point.sx - origin.sx;
    const dy = point.sy - origin.sy;
    return {
        sx: origin.sx + dx * cos - dy * sin,
        sy: origin.sy + dx * sin + dy * cos,
    };
}
/**
 * OV-133: shared edge-label geometry for warehouse frames and synthetic
 * stations. The same metrics drive SVG rendering and station fit bounds so a
 * detached plate can never be clipped or drift away from its measured area.
 */
function getEdgeLabelGeometry(label, start, end, zoom) {
    const angle = (Math.atan2(end.sy - start.sy, end.sx - start.sx) * 180) / Math.PI;
    const fontSize = Math.round(8 * zoom);
    const textWidth = label.length * (fontSize * 0.6 + 0.5);
    const plateX = start.sx - 4 * zoom;
    const plateY = start.sy + 11 * zoom;
    const plateWidth = textWidth + 8 * zoom;
    const plateHeight = fontSize + 6 * zoom;
    const plateCorners = [
        { sx: plateX, sy: plateY },
        { sx: plateX + plateWidth, sy: plateY },
        { sx: plateX + plateWidth, sy: plateY + plateHeight },
        { sx: plateX, sy: plateY + plateHeight },
    ].map(point => rotateScreenPoint(point, start, angle));
    return {
        angle,
        fontSize,
        plateX,
        plateY,
        plateWidth,
        plateHeight,
        plateCorners,
    };
}
function EdgeLabelPlate({ label, start, end, zoom, }) {
    const geometry = getEdgeLabelGeometry(label, start, end, zoom);
    return (_jsxs("g", { transform: `rotate(${geometry.angle} ${start.sx} ${start.sy})`, style: { pointerEvents: 'none' }, children: [_jsx("rect", { x: geometry.plateX, y: geometry.plateY, width: geometry.plateWidth, height: geometry.plateHeight, rx: 2 * zoom, fill: "var(--ink)", opacity: 0.82 }), _jsx("text", { x: start.sx, y: geometry.plateY, dy: geometry.plateHeight / 2, textAnchor: "start", dominantBaseline: "middle", fontSize: geometry.fontSize, fontWeight: "600", fill: "var(--bg)", fontFamily: "monospace", letterSpacing: 0.5, children: label })] }));
}
/** Convert 6 projected corners to SVG polygon points string */
function pts(...coords) {
    return coords.map(c => `${c.sx.toFixed(1)},${c.sy.toFixed(1)}`).join(' ');
}
function IsometricBox({ wx, wy, ww, wd, wh, colorKey, isSelected, isHovered, isHoverDimmed, isFrame, isDimmed, dimmedOpacity, isInactive, label, rackLevels, zoom, onClick, flipped, occupancyFraction, focusTone, isCritical, dockBay, }) {
    const baseFill = ZONE_COLORS[colorKey] ?? ZONE_COLORS.storage;
    const stroke = ZONE_STROKE[colorKey] ?? ZONE_STROKE.storage;
    const selStroke = 'var(--accent)';
    const hoverStroke = 'var(--ink-2)';
    const criticalStroke = 'var(--critical-ink)';
    const faceStroke = isCritical
        ? criticalStroke
        : isHovered
            ? hoverStroke
            : stroke;
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
    // RECOUNT-CTA-33b: focusFill/fillOverride paint a saturated red/orange top
    // face (e.g. focusTone="risk"). var(--accent) is also orange, so a selected
    // label loses contrast on that fill — var(--bg) is the existing high-contrast
    // text-on-saturated-fill token already used elsewhere in this file (see the
    // problem-count badge and EdgeLabelPlate below).
    const hasColoredOverlay = focusFill != null || fillOverride != null;
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
    // ZONE-SHAPE-01: top face as 4 points normally, 8 when a dock bay is carved.
    // The notch is cut in WORLD space and projected through the same project(),
    // so `flipped` needs no special handling. Both dock zone types are flat
    // slabs (rack_levels null), so the notch in the top face is the whole shape —
    // there are no interior walls to draw.
    const BAY_ALONG = 0.40; // fraction of the wall-facing extent
    const BAY_DEEP = 0.35; // fraction of the perpendicular extent
    const topFacePoints = (() => {
        if (!dockBay)
            return [t00, t10, t11, t01];
        const p = (x, y) => project(x, y, wh, zoom, flipped);
        if (dockBay === 'north' || dockBay === 'south') {
            const bw = ww * BAY_ALONG;
            const x0 = wx + (ww - bw) / 2;
            const x1 = x0 + bw;
            const bd = wd * BAY_DEEP;
            if (dockBay === 'north') {
                // Notch bites into the wy edge.
                return [t00, p(x0, wy), p(x0, wy + bd), p(x1, wy + bd), p(x1, wy), t10, t11, t01];
            }
            // South: notch bites into the wy + wd edge.
            return [t00, t10, t11, p(x1, wy + wd), p(x1, wy + wd - bd), p(x0, wy + wd - bd), p(x0, wy + wd), t01];
        }
        const bh = wd * BAY_ALONG;
        const y0 = wy + (wd - bh) / 2;
        const y1 = y0 + bh;
        const bdx = ww * BAY_DEEP;
        if (dockBay === 'west') {
            // Notch bites into the wx edge.
            return [t00, t10, t11, t01, p(wx, y1), p(wx + bdx, y1), p(wx + bdx, y0), p(wx, y0)];
        }
        // East: notch bites into the wx + ww edge.
        return [t00, p(wx + ww, y0), p(wx + ww - bdx, y0), p(wx + ww - bdx, y1), p(wx + ww, y1), t10, t11, t01];
    })();
    // Darken side faces
    const leftFill = fill.replace(/[\d.]+\)$/, m => `${Math.min(1, parseFloat(m) * 1.4)})`).replace('rgba', 'rgba').replace(/,[\d.]+\)/, `,${0.55})`);
    const rightFill = fill.replace(/,[\d.]+\)/, `,${0.40})`);
    const isFlat = wh < 0.01;
    // OV-145: bin height already treats a missing rack_levels value as one level.
    // Apply the same fallback to the side slices so every non-flat bin is closed.
    const renderedRackLevels = Math.max(1, rackLevels ?? 1);
    return (
    /* Group opacity keeps top, sides, labels, and strokes in one focus state. */
    _jsxs("g", { onClick: onClick, style: { cursor: 'pointer' }, opacity: isDimmed
            ? (dimmedOpacity ?? 0.25)
            : isInactive
                ? 0.4
                : isHoverDimmed
                    ? 0.55
                    : 1, children: [_jsx("polygon", { points: pts(...topFacePoints), fill: fill, stroke: isSelected ? selStroke : faceStroke, strokeWidth: isSelected
                    ? 2
                    : isCritical
                        ? 1.6
                        : isHovered
                            ? 1.4
                            : 1, strokeDasharray: isInactive ? '3 2' : undefined, opacity: isFlat ? 0.6 : 1 }), isCritical && (_jsx("polygon", { points: pts(...topFacePoints), fill: criticalStroke, fillOpacity: 0.10, stroke: criticalStroke, strokeWidth: 1.2, style: { pointerEvents: 'none' } })), isSelected && (_jsx("polygon", { points: pts(...topFacePoints), fill: "none", stroke: selStroke, strokeWidth: "2", strokeDasharray: "4 2", opacity: "0.8" })), (() => {
                const centre = project(wx + ww / 2, wy + wd / 2, wh + 0.05, zoom, flipped);
                const fontSize = Math.max(7, Math.min(10, TILE_W * zoom * ww * 0.12));
                return (_jsx("text", { x: centre.sx, y: centre.sy, textAnchor: "middle", dominantBaseline: "middle", fontSize: fontSize, fontFamily: "monospace", fontWeight: isSelected ? 700 : 600, fill: isSelected ? (hasColoredOverlay ? 'var(--bg)' : 'var(--accent)') : isFrame ? `rgba(${zoneRGBVar('lane')},0.9)` : 'var(--ink)', style: { pointerEvents: 'none', userSelect: 'none' }, children: label }));
            })(), !isFlat && Array.from({ length: renderedRackLevels }, (_, i) => {
                const z0 = i * LEVEL_HEIGHT;
                const z1 = (i + 1) * LEVEL_HEIGHT;
                const lFill = levelFill(i);
                const lFillDark = lFill.replace(/[\d.]+\)$/, m => `${Math.min(1, parseFloat(m) * 0.75)})`);
                // ZONE-SHAPE-01: a dock bay cuts the slab, so the affected side face is
                // rendered as two segments with the notch's inner wall between them.
                // Only two faces are visible in this projection — the wy+wd edge (left)
                // and the wx+ww edge (right) — so a north or west bay cuts a hidden
                // face and contributes only its inner wall.
                const q = (x, y, z) => project(x, y, z, zoom, flipped);
                const bayAlongX = dockBay === 'north' || dockBay === 'south';
                const bw = bayAlongX ? ww * BAY_ALONG : wd * BAY_ALONG;
                const bd = bayAlongX ? wd * BAY_DEEP : ww * BAY_DEEP;
                const a0 = bayAlongX ? wx + (ww - bw) / 2 : wy + (wd - bw) / 2;
                const a1 = a0 + bw;
                // ZONE-SHAPE-01: the bay is a cut through the slab — no floor, no lid.
                // Only walls of the REMAINING solid are drawn, and only those facing
                // +x or +y (toward the viewer). North and west bays cut the far edges,
                // so every exposed wall faces away and nothing extra is drawn: the
                // notch in the top face alone shows the ground through the gap.
                const faces = [];
                if (dockBay === 'south') {
                    const yb = wy + wd - bd;
                    faces.push({ pts: [q(wx, wy + wd, z0), q(a0, wy + wd, z0), q(a0, wy + wd, z1), q(wx, wy + wd, z1)], fill: lFill });
                    faces.push({ pts: [q(a1, wy + wd, z0), q(wx + ww, wy + wd, z0), q(wx + ww, wy + wd, z1), q(a1, wy + wd, z1)], fill: lFill });
                    // Back of the recess, facing +y.
                    faces.push({ pts: [q(a0, yb, z0), q(a1, yb, z0), q(a1, yb, z1), q(a0, yb, z1)], fill: lFill });
                    // Only the a0 return faces +x; the a1 return faces -x and is hidden.
                    faces.push({ pts: [q(a0, yb, z0), q(a0, wy + wd, z0), q(a0, wy + wd, z1), q(a0, yb, z1)], fill: lFillDark });
                }
                else {
                    faces.push({ pts: [q(wx, wy + wd, z0), q(wx + ww, wy + wd, z0), q(wx + ww, wy + wd, z1), q(wx, wy + wd, z1)], fill: lFill });
                }
                if (dockBay === 'east') {
                    const xb = wx + ww - bd;
                    faces.push({ pts: [q(wx + ww, wy, z0), q(wx + ww, a0, z0), q(wx + ww, a0, z1), q(wx + ww, wy, z1)], fill: lFillDark });
                    faces.push({ pts: [q(wx + ww, a1, z0), q(wx + ww, wy + wd, z0), q(wx + ww, wy + wd, z1), q(wx + ww, a1, z1)], fill: lFillDark });
                    faces.push({ pts: [q(xb, a0, z0), q(xb, a1, z0), q(xb, a1, z1), q(xb, a0, z1)], fill: lFillDark });
                    faces.push({ pts: [q(xb, a0, z0), q(wx + ww, a0, z0), q(wx + ww, a0, z1), q(xb, a0, z1)], fill: lFill });
                }
                else {
                    faces.push({ pts: [q(wx + ww, wy, z0), q(wx + ww, wy + wd, z0), q(wx + ww, wy + wd, z1), q(wx + ww, wy, z1)], fill: lFillDark });
                }
                return (_jsx("g", { children: faces.map((f, fi) => (_jsx("polygon", { points: pts(...f.pts), fill: f.fill, stroke: faceStroke, strokeWidth: isCritical ? 0.8 : 0.4 }, fi))) }, i));
            })] }));
}
export function IsometricCanvas({ zones, onSelect, onZoneClick, filteredCodes, highlightZoneTypes, enableHoverFocus = false, locationPulseByCode, stationPulseById, focusedBins, focusTone, focusDimOpacity = 0.25, occupancy, showFloor = true, showBins = true, initialZoom = 0.9, initialOffset = { x: 420, y: 120 }, autoFit = true, fitPadding = 0.68, fitPhysicalFloorFirst = false, apronReserveRatio = 0.22, showLegend = true, showControls = true, showWarehouseContext = false, onWarehouseContextClick, disablePan = false, stations, liveActivity, packQueueCount, stowPending, problemByLocation, problemTaskTotal, unlocatedProblemTaskTotal, showMarkerKey = false, stowPendingTotal, receiveAtDock, receiveAtDockTotal, onUnplacedZonesClick, overlay, summaryCounts, onRefresh, }) {
    const svgRef = useRef(null);
    const [zoom, setZoom] = useState(initialZoom);
    const [offset, setOffset] = useState(initialOffset);
    const [selected, setSelected] = useState(null);
    const [hovered, setHovered] = useState(null);
    const [hoveredStationId, setHoveredStationId] = useState(null);
    // OV-HOVER-02: projected anchor of the hovered object in SVG user units.
    // Captured at hover time because the plate is an HTML sibling of the <svg>
    // and cannot reach into the scene graph. offset is added at render.
    const [hoverAnchor, setHoverAnchor] = useState(null);
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
    const warehouseContextName = zones.find(z => z.type === 'warehouse' && z.warehouse_name)?.warehouse_name ?? null;
    // ZONE-SHAPE-01: world-space extent of the physical floor. Deliberately NOT
    // bboxRef — that one projects to screen space and includes synthetic
    // stations. The isometric transform collapses wx and wy into a single sx, so
    // a screen bbox cannot answer "which building edge is this zone near", and
    // `flipped` would mirror north into south.
    const worldBox = (() => {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const z of positionedZones) {
            if (isFrame(z))
                continue;
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
        return Number.isFinite(minX) ? { minX, maxX, minY, maxY } : null;
    })();
    // ZONE-SHAPE-01b: explicit merchant dock direction is authoritative.
    // NULL/undefined keeps legacy layouts on Auto; `none` deliberately suppresses
    // the opening. Auto remains conservative at ambiguous corners rather than
    // inventing a physical warehouse direction.
    const DOCK_BAY_AMBIGUITY = 0.15;
    const dockBayFor = (z) => {
        if (z.zone_type !== 'ship' && z.zone_type !== 'receive')
            return null;
        if (z.dock_face === 'none')
            return null;
        if (z.dock_face === 'north' ||
            z.dock_face === 'south' ||
            z.dock_face === 'east' ||
            z.dock_face === 'west') {
            return z.dock_face;
        }
        if (!worldBox)
            return null;
        const w = worldBox.maxX - worldBox.minX;
        const h = worldBox.maxY - worldBox.minY;
        if (w <= 0 || h <= 0)
            return null;
        const cx = parseFloat(String(z.position_x ?? 0)) + parseFloat(String(z.width ?? 1)) / 2;
        const cy = parseFloat(String(z.position_y ?? 0)) + parseFloat(String(z.depth ?? 0.5)) / 2;
        const sides = [
            { side: 'north', d: (cy - worldBox.minY) / h },
            { side: 'south', d: (worldBox.maxY - cy) / h },
            { side: 'west', d: (cx - worldBox.minX) / w },
            { side: 'east', d: (worldBox.maxX - cx) / w },
        ];
        const candidates = sides.sort((a, b) => a.d - b.d);
        return candidates[1].d - candidates[0].d < DOCK_BAY_AMBIGUITY
            ? null
            : candidates[0].side;
    };
    // OV-HOVER-01: only an actually rendered physical bin may own hover focus.
    // This prevents stale hover state from dimming the map after filters/layout change.
    const activeHoveredCode = enableHoverFocus &&
        hovered != null &&
        positionedZones.some(z => z.type === 'bin' && z.location_code === hovered)
        ? hovered
        : null;
    // OV-HOVER-02: a physical bin outranks a rail block; only one plate at a time.
    const activePulse = activeHoveredCode != null
        ? locationPulseByCode?.[activeHoveredCode] ?? null
        : hoveredStationId != null
            ? stationPulseById?.[hoveredStationId] ?? null
            : null;
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
    // OV-136: the map marker explains one location; the key explains the
    // floor-wide meaning. Legacy callers without phase counts fall back to status.
    const operatorSummary = useMemo(() => Object.values(liveActivity ?? {}).reduce((summary, activity) => ({
        total: summary.total + activity.operatorCount,
        picking: summary.picking +
            (activity.pickingCount ??
                (activity.status === 'picking' ? activity.operatorCount : 0)),
        packing: summary.packing +
            (activity.packingCount ??
                (activity.status === 'packing' ? activity.operatorCount : 0)),
        // OV-132: legacy callers omit staleCount — absent means not stale.
        stale: summary.stale + (activity.staleCount ?? 0),
    }), { total: 0, picking: 0, packing: 0, stale: 0 }), [liveActivity]);
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
        const GUTTER = 2.0; // world-diagonal metres of clear space from the slab
        const RANK_GAP = 0.6; // OV-40: clear space between blocks on one rail
        const DEF_TW = 1.5, DEF_TD = 0.75;
        const MAX_BAR_H = 2.5;
        return stations
            // OV-40: a block with nothing in it is not information. Zero-count
            // stages are omitted entirely rather than rendered as an empty volume,
            // so the rail only ever shows stages that have work in them.
            .filter(s => s.count > 0)
            .map(station => {
            const tw = station.footprint?.tw ?? DEF_TW;
            const td = station.footprint?.td ?? DEF_TD;
            // OV-40: rank offsets each block outward along v (screen X only, per
            // the rotated-basis note above). rank 1 sits at the base gutter; each
            // further rank steps one footprint + gap further from the slab, so
            // blocks on one rail never overlap regardless of their footprints.
            // Mirrored view negates screen X, so both the base anchor and the
            // rank step invert with `flipped`.
            const rank = Math.max(1, station.rank ?? 1);
            const step = (rank - 1) * (tw + RANK_GAP);
            const outward = station.side === 'inbound' ? 1 : -1;
            const dir = flipped ? -outward : outward;
            const base = dir > 0 ? vMax + GUTTER + td : vMin - GUTTER - tw;
            const v0 = base + dir * step;
            const u0 = uMid - (tw + td) / 2;
            // OV-40: one stage, one quantity, one height. The urgent sub-bar and
            // its stackTotal/clampedUrgent arithmetic (OV-13/15/18/39) are gone —
            // they existed only to pack two stages into one volume.
            const totalBarH = Math.min(MAX_BAR_H, 0.4 + station.count * 0.06);
            return {
                station,
                wx: (u0 + v0) / 2,
                wy: (u0 - v0) / 2,
                tw, td, totalBarH,
            };
        });
    }, [stations, worldBounds, flipped]);
    // Apron height and visibility track the counts, so the fit must react to
    // count changes exactly as it reacts to layout changes.
    const stationSig = stationPlacements
        .map(p => `${p.station.id}:${p.station.label}:${p.station.side}:${p.station.rank}:${p.station.count}`)
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
                // OV-14: the far-top corner read `wx + wh` — height on the X axis. Since
                // sx = (px - py) * TILE_W/2, that corner's sx exceeded the true maxX
                // whenever wh > ww + wd (reachable at 4+ rack levels on a 1m x 0.5m bin),
                // inflating bboxRef.maxX and loosening clampOffset's left bound. Must stay
                // identical to the autoFit effect's list below — same eight corners.
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
            // OV-133: the label sits below the near edge and extends beyond the
            // footprint, so its rotated plate must participate in both fit bounds.
            const labelStart = project(p.wx, p.wy + p.td, 0, 1, flipped);
            const labelEnd = project(p.wx + p.tw, p.wy + p.td, 0, 1, flipped);
            const { plateCorners } = getEdgeLabelGeometry(p.station.label, labelStart, labelEnd, 1);
            for (const { sx, sy } of plateCorners) {
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
        onZoneClick?.(code);
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
        // Default callers still fit physical geometry + apron stations together.
        // Overview can instead reserve a dedicated rail so synthetic workflow
        // volume never dictates the scale of the physical warehouse.
        if (!fitPhysicalFloorFirst) {
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
        }
        const bboxW = Math.max(1, maxX - minX);
        const bboxH = Math.max(1, maxY - minY);
        const reservedRatio = fitPhysicalFloorFirst
            ? Math.min(0.4, Math.max(0, apronReserveRatio))
            : 0;
        const fitWidth = size.w * (1 - reservedRatio);
        const fitZoom = Math.min(2.5, Math.max(0.3, Math.min(fitWidth / bboxW, size.h / bboxH) * fitPadding));
        const cx = ((minX + maxX) / 2) * fitZoom;
        const cy = ((minY + maxY) / 2) * fitZoom;
        setZoom(fitZoom);
        setOffset({
            x: fitWidth / 2 - cx,
            y: size.h / 2 - cy,
        });
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
                            // FP-214: inactive zones are excluded from occupancy heat. A
                            // decommissioned bin colouring as 85%-full red is contradictory —
                            // it is out of service, so it reports no stock signal.
                            const occ = !isFrame && zone.active && occupancy ? occupancy[zone.location_code] : undefined;
                            const capacity = (zone.rack_levels ?? 1) * 10;
                            const occupancyFraction = !isFrame && zone.active && occupancy
                                ? Math.min(1, (occ?.on_hand_quantity ?? 0) / capacity)
                                : undefined;
                            const activity = liveActivity?.[zone.location_code];
                            const operatorCount = activity?.operatorCount ?? 0;
                            const pickingOperatorCount = activity?.pickingCount ??
                                (activity?.status === 'picking' ? operatorCount : 0);
                            const packingOperatorCount = activity?.packingCount ??
                                (activity?.status === 'packing' ? operatorCount : 0);
                            // OV-132: stale operators render amber, never hidden. Legacy
                            // callers omit staleCount — absent means not stale.
                            const staleOperatorCount = activity?.staleCount ?? 0;
                            const allStale = operatorCount > 0 && staleOperatorCount === operatorCount;
                            const operatorStatusText = [
                                pickingOperatorCount > 0
                                    ? `${pickingOperatorCount} picking`
                                    : null,
                                packingOperatorCount > 0
                                    ? `${packingOperatorCount} packing`
                                    : null,
                            ]
                                .filter(Boolean)
                                .join(', ');
                            const operatorAriaLabel = `${operatorCount} active ${operatorCount === 1 ? 'operator' : 'operators'} ` +
                                `at ${zone.location_code}` +
                                (operatorStatusText ? `: ${operatorStatusText}` : '') +
                                (staleOperatorCount > 0
                                    ? `. ${staleOperatorCount} with no recent scan`
                                    : '');
                            const dotPt = activity?.hasActivePick
                                ? project(wx + ww / 2, wy + wd / 2, wh + 0.35, zoom, flipped)
                                : null;
                            const packPt = !isFrame && zone.zone_type === 'pack' && (packQueueCount ?? 0) > 0
                                ? project(wx + ww + 0.3, wy + wd / 2, wh + 0.35, zoom, flipped)
                                : null;
                            // OV-129: stow badge sits on the bin's top face — inside the box,
                            // per the agreed split: identity stays inline, live state goes on
                            // the face. Suppressed while an operator is present so the pick
                            // dot and the badge never contend for the same anchor.
                            const stowUnits = !isFrame && zone.active ? stowPending?.[zone.location_code] : undefined;
                            // OV-129: offset toward the near-right corner of the top face —
                            // IsometricBox draws the location code at the face centre, so a
                            // badge anchored there buries the bin's identity. Bins are
                            // 3-level towers here, hence a real collision rather than a
                            // theoretical one.
                            const stowPt = (stowUnits ?? 0) > 0 && !activity?.hasActivePick
                                ? project(wx + ww * 0.85, wy + wd * 0.85, wh + 0.05, zoom, flipped)
                                : null;
                            // OV-41: problems occupy the opposite face corner from stow/dock markers.
                            // The badge counts tasks, not units: one problem-center task = one decision.
                            const problemCount = !isFrame && zone.active && zone.type === 'bin'
                                ? problemByLocation?.[zone.location_code]
                                : undefined;
                            const problemPt = (problemCount ?? 0) > 0
                                ? project(wx + ww * 0.18, wy + wd * 0.18, wh + 0.2, zoom, flipped)
                                : null;
                            // OV-131: dock zones are flat (wh = 0 for frames, low for bins), so
                            // the badge sits just above the face rather than on a tower top.
                            const dockUnits = zone.active ? receiveAtDock?.[zone.location_code] : undefined;
                            // Offset to the near corner like the stow badge — the dock face
                            // carries its own location label at centre, so 0.5 buries it.
                            // Lower lift than stow (0.15 vs 0.35) because dock zones are flat:
                            // there is no tower to clear.
                            const dockPt = (dockUnits ?? 0) > 0 && !activity?.hasActivePick
                                ? project(wx + ww * 0.82, wy + wd * 0.82, wh + 0.15, zoom, flipped)
                                : null;
                            // Warehouse identity is rendered as screen-aligned UI chrome outside the SVG
                            // geometry. Physical floor labels remain world-aligned; warehouse selection
                            // must stay readable and future-ready for multi-warehouse switching.
                            return (_jsxs("g", { onMouseEnter: enableHoverFocus && !isFrame
                                    ? () => {
                                        setHovered(zone.location_code);
                                        const a = project(wx + ww, wy, wh, zoom, flipped);
                                        const aL = project(wx, wy + wd, 0, zoom, flipped);
                                        setHoverAnchor({ x: a.sx, y: a.sy, leftX: aL.sx });
                                    }
                                    : undefined, onMouseLeave: enableHoverFocus && !isFrame
                                    ? () => {
                                        setHovered(current => current === zone.location_code ? null : current);
                                        setHoverAnchor(null);
                                    }
                                    : undefined, children: [_jsx(IsometricBox, { wx: wx, wy: wy, ww: ww, wd: wd, wh: wh, colorKey: colorKey, dockBay: dockBayFor(zone), isSelected: selected === zone.location_code, isHovered: !isFrame &&
                                            activeHoveredCode === zone.location_code, isHoverDimmed: !isFrame &&
                                            (activeHoveredCode != null || hoveredStationId != null) &&
                                            activeHoveredCode !== zone.location_code &&
                                            selected !== zone.location_code &&
                                            (problemCount ?? 0) === 0, isDimmed: !isFrame && ((highlightZoneTypes != null &&
                                            highlightZoneTypes.size > 0 &&
                                            !highlightZoneTypes.has(zone.zone_type ?? '')) ||
                                            (focusedBins != null &&
                                                zone.type === 'bin' &&
                                                !focusedBins.includes(zone.location_code))), dimmedOpacity: focusDimOpacity, focusTone: !isFrame &&
                                            zone.type === 'bin' &&
                                            focusedBins?.includes(zone.location_code)
                                            ? focusTone
                                            : undefined, isCritical: (problemCount ?? 0) > 0, isFrame: isFrame, isInactive: !zone.active, label: zone.type === 'warehouse' ? '' : zone.location_code, rackLevels: rackLevels, zoom: zoom, flipped: flipped, onClick: () => handleSelect(zone.location_code), occupancyFraction: occupancyFraction }, zone.location_code), dotPt && (_jsxs("g", { role: "img", "aria-label": operatorAriaLabel, children: [_jsx("title", { children: operatorAriaLabel }), _jsx("rect", { x: dotPt.sx - 19 * zoom, y: dotPt.sy - 6.5 * zoom, width: 38 * zoom, height: 13 * zoom, rx: 6.5 * zoom, fill: "var(--bg)", stroke: "var(--rule)", strokeWidth: 0.8 * zoom, opacity: 0.96 }), _jsx("circle", { cx: dotPt.sx - 13.5 * zoom, cy: dotPt.sy - 2.2 * zoom, r: 1.6 * zoom, fill: "var(--ink-2)" }), _jsx("rect", { x: dotPt.sx - 16 * zoom, y: dotPt.sy + 0.2 * zoom, width: 5 * zoom, height: 3.8 * zoom, rx: 1.9 * zoom, fill: "var(--ink-2)" }), _jsx("text", { x: dotPt.sx - 1.5 * zoom, y: dotPt.sy + 0.5 * zoom, textAnchor: "middle", dominantBaseline: "middle", fontSize: Math.round(6 * zoom), fontWeight: "600", fill: allStale ? '#D9A23B' : 'var(--ink-2)', fontFamily: "monospace", children: `${operatorCount} ${operatorCount === 1 ? 'op' : 'ops'}` }), pickingOperatorCount > 0 && (_jsx("circle", { cx: dotPt.sx + 14.5 * zoom, cy: packingOperatorCount > 0
                                                    ? dotPt.sy - 2.2 * zoom
                                                    : dotPt.sy, r: 1.6 * zoom, fill: "#1FA8FF" })), packingOperatorCount > 0 && (_jsx("circle", { cx: dotPt.sx + 14.5 * zoom, cy: pickingOperatorCount > 0
                                                    ? dotPt.sy + 2.2 * zoom
                                                    : dotPt.sy, r: 1.6 * zoom, fill: "#FF6B2B" }))] })), stowPt && (_jsxs("g", { style: { pointerEvents: 'none' }, children: [_jsx("rect", { x: stowPt.sx - 10 * zoom, y: stowPt.sy - 5 * zoom, width: 20 * zoom, height: 10 * zoom, rx: 2 * zoom, fill: "var(--ink)", opacity: 0.78 }), _jsxs("g", { stroke: "var(--bg)", strokeWidth: 0.9 * zoom, fill: "none", strokeLinecap: "round", children: [_jsx("line", { x1: stowPt.sx - 6 * zoom, y1: stowPt.sy - 3 * zoom, x2: stowPt.sx - 6 * zoom, y2: stowPt.sy + 0.5 * zoom }), _jsx("polyline", { points: `${stowPt.sx - 7.6 * zoom},${stowPt.sy - 1 * zoom} ${stowPt.sx - 6 * zoom},${stowPt.sy + 0.7 * zoom} ${stowPt.sx - 4.4 * zoom},${stowPt.sy - 1 * zoom}` }), _jsx("polyline", { points: `${stowPt.sx - 8.2 * zoom},${stowPt.sy + 1.6 * zoom} ${stowPt.sx - 8.2 * zoom},${stowPt.sy + 3.2 * zoom} ${stowPt.sx - 3.8 * zoom},${stowPt.sy + 3.2 * zoom} ${stowPt.sx - 3.8 * zoom},${stowPt.sy + 1.6 * zoom}` })] }), _jsx("text", { x: stowPt.sx + 3 * zoom, y: stowPt.sy, textAnchor: "middle", dominantBaseline: "middle", fontSize: Math.round(6 * zoom), fontWeight: "600", fill: "var(--bg)", fontFamily: "monospace", children: stowUnits })] })), problemPt && problemCount && (_jsxs("g", { role: "img", "aria-label": `${problemCount} open ${problemCount === 1 ? 'problem' : 'problems'} at ${zone.location_code}`, style: { pointerEvents: 'none' }, children: [_jsx("title", { children: `${problemCount} open ${problemCount === 1 ? 'problem' : 'problems'} at ${zone.location_code}` }), _jsx("rect", { x: problemPt.sx - 11 * zoom, y: problemPt.sy - 5 * zoom, width: 22 * zoom, height: 10 * zoom, rx: 2 * zoom, fill: "var(--critical-ink)", opacity: 0.92 }), _jsx("text", { x: problemPt.sx, y: problemPt.sy, textAnchor: "middle", dominantBaseline: "middle", fontSize: Math.round(6 * zoom), fontWeight: "700", fill: "var(--bg)", fontFamily: "monospace", children: `! ${problemCount}` })] })), dockPt && (_jsxs("g", { style: { pointerEvents: 'none' }, children: [_jsx("rect", { x: dockPt.sx - 10 * zoom, y: dockPt.sy - 5 * zoom, width: 20 * zoom, height: 10 * zoom, rx: 2 * zoom, fill: "var(--ink)", opacity: 0.78 }), _jsxs("g", { stroke: "var(--bg)", strokeWidth: 0.9 * zoom, fill: "none", strokeLinecap: "round", children: [_jsx("rect", { x: dockPt.sx - 8.4 * zoom, y: dockPt.sy - 0.4 * zoom, width: 5 * zoom, height: 3.8 * zoom, rx: 0.5 * zoom }), _jsx("line", { x1: dockPt.sx - 5.9 * zoom, y1: dockPt.sy - 4.2 * zoom, x2: dockPt.sx - 5.9 * zoom, y2: dockPt.sy - 1.4 * zoom }), _jsx("polyline", { points: `${dockPt.sx - 7.3 * zoom},${dockPt.sy - 2.6 * zoom} ${dockPt.sx - 5.9 * zoom},${dockPt.sy - 1.2 * zoom} ${dockPt.sx - 4.5 * zoom},${dockPt.sy - 2.6 * zoom}` })] }), _jsx("text", { x: dockPt.sx + 3 * zoom, y: dockPt.sy, textAnchor: "middle", dominantBaseline: "middle", fontSize: Math.round(6 * zoom), fontWeight: "600", fill: "var(--bg)", fontFamily: "monospace", children: dockUnits })] })), packPt && (_jsxs("g", { children: [_jsxs("g", { children: [_jsx("rect", { x: packPt.sx - 5 * zoom, y: packPt.sy - 5 * zoom, width: 10 * zoom, height: 9 * zoom, rx: 1 * zoom, fill: "#D9A23B", stroke: "var(--bg)", strokeWidth: 0.75, opacity: 0.92 }), _jsx("line", { x1: packPt.sx, y1: packPt.sy - 5 * zoom, x2: packPt.sx, y2: packPt.sy + 4 * zoom, stroke: "var(--bg)", strokeWidth: 0.75, opacity: 0.6 }), _jsx("animate", { attributeName: "opacity", values: "1;0.6;1", dur: "2.6s", repeatCount: "indefinite" })] }), _jsx("text", { x: packPt.sx + 9 * zoom, y: packPt.sy + 1, textAnchor: "start", dominantBaseline: "middle", fontSize: Math.round(7 * zoom), fontWeight: "600", fill: "var(--ink)", fontFamily: "monospace", children: packQueueCount })] }))] }, zone.location_code));
                        }), stationPlacements.map(({ station, wx, wy, tw, td, totalBarH }) => {
                            // Normal (lower) bar
                            const nb00 = project(wx, wy, 0, zoom, flipped);
                            const nb10 = project(wx + tw, wy, 0, zoom, flipped);
                            const nb11 = project(wx + tw, wy + td, 0, zoom, flipped);
                            // OV-40: one stage, one volume. The normal/urgent two-bar stack is
                            // gone — each block now carries a single quantity, so there is one
                            // base quad at z=0 and one top quad at totalBarH.
                            const b00 = project(wx, wy, 0, zoom, flipped);
                            const b10 = project(wx + tw, wy, 0, zoom, flipped);
                            const b11 = project(wx + tw, wy + td, 0, zoom, flipped);
                            const b01 = project(wx, wy + td, 0, zoom, flipped);
                            const t00 = project(wx, wy, totalBarH, zoom, flipped);
                            const t10 = project(wx + tw, wy, totalBarH, zoom, flipped);
                            const t11 = project(wx + tw, wy + td, totalBarH, zoom, flipped);
                            const t01 = project(wx, wy + td, totalBarH, zoom, flipped);
                            const ut11 = project(wx + tw, wy + td, totalBarH, zoom, flipped);
                            const ut01 = project(wx, wy + td, totalBarH, zoom, flipped);
                            const countPt = project(wx + tw / 2, wy + td / 2, totalBarH + 0.45, zoom, flipped);
                            // OV-133: station identity belongs on the near footprint edge, not over
                            // the variable-height bar. The projected endpoints also handle flipped mode.
                            const labelPt = project(wx, wy + td, 0, zoom, flipped);
                            const labelEdgePt = project(wx + tw, wy + td, 0, zoom, flipped);
                            // OV-40: tone is reinforcement only (WCAG 1.4.1). The block's label
                            // and count must stand alone for an operator who cannot tell these
                            // hues apart — which is why each stage now has its own named block
                            // rather than sharing one bar with a colour-coded sub-stack.
                            const isCritical = station.tone === 'critical';
                            const barFill = isCritical ? 'var(--critical-ink)' : 'var(--accent)';
                            const isHoveredStation = enableHoverFocus && hoveredStationId === station.id;
                            const stationStroke = isHoveredStation
                                ? 'var(--ink-2)'
                                : 'transparent';
                            const stationOpacity = activeHoveredCode != null && !isCritical ? 0.55 : 1;
                            return (_jsxs("g", { style: { cursor: station.deepLink ? 'pointer' : 'default' }, opacity: stationOpacity, onMouseEnter: enableHoverFocus
                                    ? () => {
                                        setHoveredStationId(station.id);
                                        // OV-HOVER-02: anchor on the far top corner, not the
                                        // bar centre — countPt sits mid-block, so a plate hung
                                        // off it covers the very object being pointed at.
                                        // OV-HOVER-02: anchor spans the block's projected
                                        // width — flipping mirrors around the anchor, so a
                                        // single mid-object point overlaps on either side.
                                        setHoverAnchor({
                                            x: t11.sx,
                                            y: t11.sy,
                                            leftX: b01.sx,
                                        });
                                    }
                                    : undefined, onMouseLeave: enableHoverFocus
                                    ? () => {
                                        setHoveredStationId(current => current === station.id ? null : current);
                                        setHoverAnchor(null);
                                    }
                                    : undefined, onClick: () => { if (station.deepLink)
                                    onSelect?.(station.id); }, children: [_jsx("polygon", { points: pts(t01, t11, b11, b01), fill: barFill, fillOpacity: 0.45, stroke: stationStroke, strokeWidth: isHoveredStation ? 1.1 : 0 }), _jsx("polygon", { points: pts(t10, b10, b11, t11), fill: barFill, fillOpacity: 0.32, stroke: stationStroke, strokeWidth: isHoveredStation ? 1.1 : 0 }), _jsx("polygon", { points: pts(t00, t10, t11, t01), fill: barFill, fillOpacity: 0.75, stroke: stationStroke, strokeWidth: isHoveredStation ? 1.4 : 0 }), _jsx("text", { x: countPt.sx, y: countPt.sy, textAnchor: "middle", fontSize: Math.round(11 * zoom), fontWeight: "600", fill: barFill, fontFamily: "monospace", children: station.count }), _jsx(EdgeLabelPlate, { label: station.label, start: labelPt, end: labelEdgePt, zoom: zoom })] }, station.id));
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
                            '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' } }, children: "\u21BB" }))] }), activePulse && hoverAnchor && (() => {
                const PW = 228;
                const GAP = 14;
                const ax = hoverAnchor.x + offset.x;
                const ay = hoverAnchor.y + offset.y;
                const alx = hoverAnchor.leftX + offset.x;
                const flipLeft = ax + GAP + PW > size.w - 8;
                const left = flipLeft ? Math.max(8, alx - GAP - PW) : ax + GAP;
                const estH = 46 + activePulse.rows.length * 20;
                const top = Math.max(8, Math.min(ay - estH / 2, size.h - estH - 8));
                return (_jsxs(Box, { "aria-hidden": true, sx: {
                        position: 'absolute', left, top, width: PW, zIndex: 3,
                        pointerEvents: 'none',
                        border: '1px solid var(--rule)', borderRadius: '6px',
                        bgcolor: 'var(--bg)', px: 1.25, py: 1,
                        boxShadow: '0 4px 14px rgba(0,0,0,0.28)',
                    }, children: [_jsx(Typography, { sx: { fontSize: 11, fontWeight: 600, color: 'var(--ink)', fontFamily: 'monospace' }, children: activePulse.title }), activePulse.subtitle && (_jsx(Typography, { sx: { fontSize: 10, color: 'var(--ink-3)' }, children: activePulse.subtitle })), _jsx(Box, { sx: { borderTop: '1px solid var(--rule)', mt: 0.75, pt: 0.75 }, children: activePulse.rows.map((r, i) => (_jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.25 }, children: [_jsx(Typography, { sx: { fontSize: 10, color: 'var(--ink-3)' }, children: r.label }), _jsx(Typography, { sx: {
                                            fontSize: 10, fontFamily: 'monospace', textAlign: 'right',
                                            color: r.tone === 'critical' ? 'var(--critical-ink)'
                                                : r.tone === 'warning' ? 'var(--accent)'
                                                    : r.tone === 'muted' ? 'var(--ink-3)'
                                                        : 'var(--ink)',
                                        }, children: r.value })] }, i))) })] }));
            })(), showWarehouseContext && warehouseContextName && (_jsx(Box, { onClick: onWarehouseContextClick, role: onWarehouseContextClick ? 'button' : undefined, tabIndex: onWarehouseContextClick ? 0 : undefined, onKeyDown: onWarehouseContextClick
                    ? event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onWarehouseContextClick();
                        }
                    }
                    : undefined, "aria-label": onWarehouseContextClick
                    ? `Select warehouse. Current warehouse: ${warehouseContextName}`
                    : undefined, sx: {
                    position: 'absolute',
                    top: 12,
                    left: 12,
                    zIndex: 2,
                    display: 'inline-flex',
                    alignItems: 'center',
                    px: 1.25,
                    py: 0.625,
                    border: '1px solid var(--rule)',
                    borderRadius: '6px',
                    bgcolor: 'var(--bg)',
                    color: 'var(--ink)',
                    cursor: onWarehouseContextClick ? 'pointer' : 'default',
                    '&:hover': onWarehouseContextClick
                        ? { borderColor: 'var(--accent)' }
                        : undefined,
                }, children: _jsx(Typography, { sx: {
                        fontSize: 11,
                        fontWeight: 500,
                        color: 'var(--ink)',
                    }, children: warehouseContextName }) })), showMarkerKey && (operatorSummary.total > 0 ||
                (stowPendingTotal ?? 0) > 0 ||
                (receiveAtDockTotal ?? 0) > 0 ||
                (problemTaskTotal ?? 0) > 0) && (_jsxs(Box, { sx: {
                    position: 'absolute', bottom: 12, left: 12, display: 'flex', flexDirection: 'column', gap: 0.25,
                    px: 1, py: 0.5, border: '1px solid var(--rule)', borderRadius: 1,
                    bgcolor: 'var(--bg)', opacity: 0.92,
                }, children: [(problemTaskTotal ?? 0) > 0 && (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.75 }, children: [_jsx(Typography, { "aria-hidden": true, sx: { fontSize: 11, fontWeight: 700, color: 'var(--critical-ink)', lineHeight: 1 }, children: "!" }), _jsx(Typography, { sx: { fontSize: 10, color: 'var(--ink-3)', fontFamily: 'monospace' }, children: `${problemTaskTotal} open ${problemTaskTotal === 1 ? 'problem' : 'problems'}${(unlocatedProblemTaskTotal ?? 0) > 0
                                    ? ` · ${unlocatedProblemTaskTotal} location unknown`
                                    : ''}` })] })), (receiveAtDockTotal ?? 0) > 0 && (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.75 }, children: [_jsx("svg", { width: 14, height: 12, viewBox: "0 0 14 12", "aria-hidden": true, children: _jsxs("g", { stroke: "var(--ink-3)", strokeWidth: 1, fill: "none", strokeLinecap: "round", children: [_jsx("rect", { x: 4.5, y: 6, width: 5, height: 4, rx: 0.5 }), _jsx("line", { x1: 7, y1: 1.5, x2: 7, y2: 4.5 }), _jsx("polyline", { points: "5.6,3.2 7,4.7 8.4,3.2" })] }) }), _jsx(Typography, { sx: { fontSize: 10, color: 'var(--ink-3)', fontFamily: 'monospace' }, children: `${receiveAtDockTotal} units at dock` })] })), (stowPendingTotal ?? 0) > 0 && (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.75 }, children: [_jsx("svg", { width: 14, height: 12, viewBox: "0 0 14 12", "aria-hidden": true, children: _jsxs("g", { stroke: "var(--ink-3)", strokeWidth: 1, fill: "none", strokeLinecap: "round", children: [_jsx("line", { x1: 7, y1: 2, x2: 7, y2: 6.5 }), _jsx("polyline", { points: "5.2,4.6 7,6.7 8.8,4.6" }), _jsx("polyline", { points: "4,8 4,10 10,10 10,8" })] }) }), _jsx(Typography, { sx: { fontSize: 10, color: 'var(--ink-3)', fontFamily: 'monospace' }, children: `${stowPendingTotal} units awaiting stow` })] })), operatorSummary.total > 0 && (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.75 }, children: [_jsxs("svg", { width: 14, height: 12, viewBox: "0 0 14 12", "aria-hidden": true, children: [_jsx("circle", { cx: 4, cy: 3, r: 1.5, fill: "var(--ink-3)" }), _jsx("rect", { x: 1.5, y: 5.5, width: 5, height: 4, rx: 2, fill: "var(--ink-3)" }), operatorSummary.picking > 0 && (_jsx("circle", { cx: 10.5, cy: operatorSummary.packing > 0 ? 3.5 : 6, r: 1.5, fill: "#1FA8FF" })), operatorSummary.packing > 0 && (_jsx("circle", { cx: 10.5, cy: operatorSummary.picking > 0 ? 8.5 : 6, r: 1.5, fill: "#FF6B2B" }))] }), _jsx(Typography, { sx: { fontSize: 10, color: 'var(--ink-3)', fontFamily: 'monospace' }, children: `${operatorSummary.total} active ${operatorSummary.total === 1 ? 'operator' : 'operators'}${operatorSummary.picking > 0
                                    ? ` · ${operatorSummary.picking} picking`
                                    : ''}${operatorSummary.packing > 0
                                    ? ` · ${operatorSummary.packing} packing`
                                    : ''}${operatorSummary.stale > 0
                                    ? ` · ${operatorSummary.stale} idle`
                                    : ''}` })] }))] })), showLegend && legendItems && (_jsx(Box, { sx: { position: 'absolute', top: 8, right: 8, display: 'flex', flexDirection: 'column', gap: 0.5,
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
    return (_jsx("svg", { width: width, height: height, viewBox: `0 0 ${width} ${height}`, xmlns: "http://www.w3.org/2000/svg", style: { display: 'block', overflow: 'visible' }, children: _jsx("g", { transform: `translate(${cx - originPt.sx}, ${cy - originPt.sy})`, children: _jsx(IsometricBox, { wx: 0, wy: 0, ww: ww, wd: wd, wh: wh, colorKey: colorKey, isSelected: false, isFrame: isFrame, isInactive: !zone.active, label: zone.location_code, rackLevels: zone.rack_levels ?? null, zoom: zoom, flipped: false, onClick: () => { } }) }) }));
}
