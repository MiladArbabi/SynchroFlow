import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from 'react';
/**
 * PickPathOverlay — SVG polyline connecting bins in pick order.
 *
 * Coordinates are computed mathematically from grid layout constants —
 * no DOM measurement needed. This is reliable across re-renders and
 * works in both full and mini variants.
 *
 * Layout model:
 *   - Aisles are columns, sorted alphabetically left→right
 *   - Bins within an aisle are sorted ASC top→bottom
 *   - Cell size, gap, and padding are fixed per variant
 *   - Aisle header = HEADER_H px above first bin
 *
 * The SVG is absolutely positioned over the grid container.
 */
const CELL_SIZE = { full: 64, mini: 44, inline: 32 };
const CELL_GAP = { full: 6, mini: 4, inline: 3 };
const AISLE_GAP = { full: 12, mini: 8, inline: 6 };
const HEADER_H = { full: 32, mini: 26, inline: 20 };
const PADDING = { full: 8, mini: 0, inline: 0 };
const PY = { full: 4, mini: 4, inline: 4 }; // py:1 = 4px
function getBinCenter(locationCode, aisleMap, variant) {
    const aisleLabel = locationCode.split('-')[0] ?? locationCode;
    const aisleKeys = [...aisleMap.keys()];
    const aisleIndex = aisleKeys.indexOf(aisleLabel);
    if (aisleIndex === -1)
        return null;
    const bins = aisleMap.get(aisleLabel) ?? [];
    const binIndex = bins.indexOf(locationCode);
    if (binIndex === -1)
        return null;
    const cell = CELL_SIZE[variant];
    const cellGap = CELL_GAP[variant];
    const aisleG = AISLE_GAP[variant];
    const headerH = HEADER_H[variant];
    const pad = PADDING[variant];
    const py = PY[variant];
    const x = pad + aisleIndex * (cell + aisleG) + cell / 2;
    const y = py + headerH + binIndex * (cell + cellGap) + cell / 2;
    return { x, y };
}
export function PickPathOverlay({ pickPath, allBins, variant = 'full' }) {
    const points = useMemo(() => {
        return pickPath
            .map(code => getBinCenter(code, allBins, variant))
            .filter((p) => p !== null);
    }, [pickPath, allBins, variant]);
    if (points.length < 2)
        return null;
    const polylinePoints = points.map(p => `${p.x},${p.y}`).join(' ');
    // SVG dimensions — enough to cover the grid
    const aisleCount = allBins.size;
    const maxBins = Math.max(...[...allBins.values()].map(b => b.length));
    const cell = CELL_SIZE[variant];
    const cellGap = CELL_GAP[variant];
    const aisleG = AISLE_GAP[variant];
    const headerH = HEADER_H[variant];
    const pad = PADDING[variant];
    const py = PY[variant];
    const svgW = pad * 2 + aisleCount * cell + (aisleCount - 1) * aisleG;
    const svgH = py * 2 + headerH + maxBins * cell + (maxBins - 1) * cellGap;
    return (_jsxs("svg", { width: svgW, height: svgH, style: {
            position: 'absolute',
            top: 0,
            left: 0,
            pointerEvents: 'none',
            zIndex: 5,
            overflow: 'visible',
        }, children: [_jsx("polyline", { points: polylinePoints, fill: "none", stroke: "var(--accent)", strokeWidth: 2, strokeDasharray: "6 4", strokeLinecap: "round", strokeLinejoin: "round", opacity: 0.7 }), points.map((p, i) => (_jsxs("g", { children: [_jsx("circle", { cx: p.x, cy: p.y, r: variant === 'full' ? 10 : 7, fill: "var(--accent)", opacity: 0.9 }), _jsx("text", { x: p.x, y: p.y + 1, textAnchor: "middle", dominantBaseline: "middle", fill: "#fff", fontSize: variant === 'full' ? 9 : 7, fontWeight: "700", fontFamily: "monospace", children: i + 1 })] }, i)))] }));
}
