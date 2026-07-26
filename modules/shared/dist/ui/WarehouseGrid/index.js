import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { AisleColumn } from './AisleColumn.js';
import { PickPathOverlay } from './PickPathOverlay.js';
/**
 * WarehouseGrid — reusable warehouse map component.
 *
 * Consumers: floor-planning (full/map), wms (full/heatmap+live),
 *   demand (mini/heatmap), product detail (inline/focus),
 *   order/batch detail (mini/pick), PO receiving (mini/focus).
 *
 * Grid derivation: locations are grouped into aisles by the segment
 * of location_code BEFORE the first hyphen (e.g. "A" from "A-1").
 * Bins within an aisle are sorted ASC — matches wms.controller pick sort.
 *
 * Phase 3: swap renderer prop to 'three' — props contract unchanged.
 */
/** Derive aisle label from location_code (segment before first '-') */
function aisleOf(locationCode) {
    return locationCode.split('-')[0] ?? locationCode;
}
/**
 * Group bin-type locations by aisle label.
 * WMS-OPS1: optional zoneTypes narrows which zones become columns. Functional
 * zones (pack/ship/returns/problem/quarantine/kitting/receive) are single bins
 * whose location_code has no hyphen, so aisleOf() turns each into its own
 * one-cell column — seven columns of dead space on a pick map that only walks
 * A/B/C. Undefined = no filter, preserving every other consumer's behaviour.
 */
function groupByAisle(locations, zoneTypes) {
    const map = new Map();
    for (const loc of locations) {
        if (loc.type !== 'bin')
            continue; // grid renders bins only
        if (zoneTypes && !zoneTypes.includes(loc.zone_type))
            continue;
        const aisle = aisleOf(loc.location_code);
        if (!map.has(aisle))
            map.set(aisle, []);
        map.get(aisle).push(loc);
    }
    // Sort aisles alphabetically
    return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
const CANVAS_GAP = { full: 12, mini: 8, inline: 6 };
export function WarehouseGrid({ locations, zoneTypes, occupancy, highlightedBins, pickPath, focusedBins, liveActivity, onBinSelect, mode = 'map', variant = 'full', renderer = 'svg', }) {
    const [selectedBin, setSelectedBin] = useState();
    const aisleMap = useMemo(() => groupByAisle(locations, zoneTypes), [locations, zoneTypes]);
    const highlightedSet = useMemo(() => new Set(highlightedBins ?? []), [highlightedBins]);
    const focusedSet = useMemo(() => new Set(focusedBins ?? []), [focusedBins]);
    function handleBinSelect(locationCode) {
        setSelectedBin((prev) => (prev === locationCode ? undefined : locationCode));
        onBinSelect?.(locationCode);
    }
    if (aisleMap.size === 0) {
        return (_jsx(Box, { sx: { py: 4, textAlign: 'center' }, children: _jsx(Typography, { variant: "body2", color: "text.disabled", children: "No bins configured. Add aisles and bins in Setup." }) }));
    }
    // Phase 3: renderer === 'three' → swap AisleColumn grid for ThreeRenderer
    if (renderer === 'three') {
        return (_jsx(Box, { sx: { py: 4, textAlign: 'center' }, children: _jsx(Typography, { variant: "body2", color: "text.disabled", children: "3D renderer \u2014 Phase 3 (not yet implemented)." }) }));
    }
    const gap = CANVAS_GAP[variant] ?? 12;
    // Build sorted bin map for PickPathOverlay coordinate computation
    const sortedBinMap = useMemo(() => {
        const m = new Map();
        for (const [aisle, bins] of aisleMap.entries()) {
            m.set(aisle, [...bins].sort((a, b) => a.location_code.localeCompare(b.location_code)).map(b => b.location_code));
        }
        return m;
    }, [aisleMap]);
    return (_jsxs(Box, { sx: {
            position: 'relative',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: `${gap}px`,
            overflowX: 'auto',
            overflowY: 'visible',
            py: 1,
            px: variant === 'full' ? 1 : 0,
        }, children: [[...aisleMap.entries()].map(([aisleLabel, bins]) => (_jsx(AisleColumn, { aisleLabel: aisleLabel, bins: bins, occupancy: occupancy, highlightedBins: highlightedSet, focusedBins: focusedSet, selectedBin: selectedBin, liveActivity: liveActivity, mode: mode, variant: variant, onBinSelect: handleBinSelect }, aisleLabel))), pickPath && pickPath.length > 0 && (_jsx(PickPathOverlay, { pickPath: pickPath, allBins: sortedBinMap, variant: variant }))] }));
}
