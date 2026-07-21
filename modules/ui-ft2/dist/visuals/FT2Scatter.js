import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Typography } from '@mui/material';
export function FT2Scatter({ points, xLabel, yLabel, }) {
    const validPoints = points?.filter((p) => p.x !== null && p.y !== null) ?? [];
    if (!validPoints.length) {
        return (_jsx(Box, { "data-testid": "ft2-empty-state", sx: { width: '100%', height: '100%' } }));
    }
    return (_jsxs(Box, { sx: { width: '100%', height: '100%' }, children: [(xLabel || yLabel) && (_jsxs(Box, { sx: { mb: 1 }, children: [xLabel && (_jsx(Typography, { variant: "caption", "data-testid": "ft2-x-axis-label", children: xLabel })), yLabel && (_jsx(Typography, { variant: "caption", "data-testid": "ft2-y-axis-label", children: yLabel }))] })), _jsx(Box, { sx: {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, 6px)',
                    gap: '6px',
                }, children: validPoints.map((_, i) => (_jsx(Box, { "data-testid": "ft2-scatter-point", sx: {
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        backgroundColor: 'currentColor',
                    } }, i))) })] }));
}
//# sourceMappingURL=FT2Scatter.js.map