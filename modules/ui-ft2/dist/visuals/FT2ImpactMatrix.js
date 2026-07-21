import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Fragment } from 'react';
import { Box, Typography } from '@mui/material';
export function FT2ImpactMatrix({ xLabels, yLabels, cells, }) {
    if (!xLabels ||
        !yLabels ||
        !cells ||
        xLabels.length === 0 ||
        yLabels.length === 0) {
        return (_jsx(Box, { "data-testid": "ft2-empty-state", sx: { width: '100%', height: '100%' } }));
    }
    const cellMap = new Map();
    cells.forEach((cell) => {
        cellMap.set(`${cell.x}::${cell.y}`, cell.value);
    });
    return (_jsxs(Box, { sx: {
            display: 'grid',
            gridTemplateColumns: `auto repeat(${xLabels.length}, 1fr)`,
            gap: 1,
        }, children: [_jsx(Box, {}), xLabels.map((x) => (_jsx(Typography, { variant: "caption", children: x }, x))), yLabels.map((y) => (_jsxs(Fragment, { children: [_jsx(Typography, { variant: "caption", children: y }), xLabels.map((x) => {
                        const value = cellMap.get(`${x}::${y}`) ?? null;
                        return (_jsx(Box, { "data-testid": "ft2-impact-cell", sx: {
                                border: '1px solid rgba(0,0,0,0.12)',
                                minHeight: 24,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }, children: _jsx(Typography, { variant: "caption", children: value ?? '—' }) }, `${x}-${y}`));
                    })] }, y)))] }));
}
//# sourceMappingURL=FT2ImpactMatrix.js.map