import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Typography } from '@mui/material';
import { BinCell } from './BinCell.js';
const LABEL_SIZE = {
    full: 11,
    mini: 9,
    inline: 8,
};
export function AisleColumn({ aisleLabel, bins, occupancy, highlightedBins, focusedBins, selectedBin, liveActivity, mode = 'map', variant = 'full', onBinSelect, }) {
    const hasFocusSet = focusedBins && focusedBins.size > 0;
    const gap = variant === 'full' ? 6 : 4;
    return (_jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: `${gap}px` }, children: [_jsx(Typography, { sx: {
                    fontFamily: 'monospace',
                    color: 'var(--ink-4)',
                    fontSize: 10,
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    mb: 0.5,
                    userSelect: 'none',
                }, children: aisleLabel }), [...bins].sort((a, b) => a.location_code.localeCompare(b.location_code)).map((bin) => (_jsx(BinCell, { locationCode: bin.location_code, occupancy: occupancy?.[bin.location_code], isHighlighted: highlightedBins?.has(bin.location_code), isSelected: selectedBin === bin.location_code, isFocused: hasFocusSet ? focusedBins.has(bin.location_code) : undefined, isDimmed: hasFocusSet ? !focusedBins.has(bin.location_code) : undefined, liveState: liveActivity?.[bin.location_code], mode: mode, variant: variant, onClick: onBinSelect }, bin.location_code)))] }));
}
