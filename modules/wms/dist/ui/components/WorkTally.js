import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Typography } from '@mui/material';
const ROWS = [
    { key: 'picking', label: 'Picking' },
    { key: 'packing', label: 'Packing' },
    { key: 'puttingAway', label: 'Putting away' },
    { key: 'receiving', label: 'Receiving' },
    { key: 'counting', label: 'Counting' },
];
export function WorkTally({ counts, countingLocked, onSelect }) {
    return (_jsx(Box, { sx: {
            display: 'flex',
            alignItems: 'stretch',
            gap: 0,
            bgcolor: 'var(--surface)',
            border: '1px solid var(--rule)',
            borderRadius: '14px',
            overflow: 'hidden',
            mb: 2.75,
        }, children: ROWS.map((row, i) => {
            const locked = row.key === 'counting' && countingLocked;
            const value = counts[row.key];
            const active = !locked && value > 0;
            return (_jsxs(Box, { component: onSelect && active ? 'button' : 'div', onClick: active && onSelect ? () => onSelect(row.key) : undefined, sx: {
                    flex: 1,
                    px: 2,
                    py: 1.75,
                    border: 'none',
                    borderLeft: i === 0 ? 'none' : '1px solid var(--rule)',
                    bgcolor: 'transparent',
                    textAlign: 'left',
                    font: 'inherit',
                    cursor: active && onSelect ? 'pointer' : 'default',
                    transition: 'background-color 120ms ease',
                    // No --surface-2 token exists in this design system; the raw
                    // rgba is deliberate rather than a fallback for a missing var.
                    '&:hover': active && onSelect
                        ? { bgcolor: 'rgba(255,255,255,0.03)' }
                        : undefined,
                }, children: [_jsx(Typography, { sx: {
                            fontSize: 11,
                            fontWeight: 400,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            color: active ? 'var(--ink-3)' : 'var(--ink-4)',
                            mb: 0.5,
                            whiteSpace: 'nowrap',
                        }, children: row.label }), _jsx(Typography, { sx: {
                            fontFamily: '"DM Mono", "SF Mono", ui-monospace, monospace',
                            fontSize: 20,
                            fontWeight: 500,
                            lineHeight: 1,
                            color: active ? 'var(--ink)' : 'var(--ink-4)',
                            opacity: active ? 1 : 0.45,
                        }, children: locked ? '—' : value })] }, row.key));
        }) }));
}
/** True when nothing anywhere is waiting — drives the "All clear" subtitle. */
export function isAllClear(counts) {
    return (counts.picking === 0 &&
        counts.packing === 0 &&
        counts.puttingAway === 0 &&
        counts.receiving === 0 &&
        counts.counting === 0);
}
//# sourceMappingURL=WorkTally.js.map