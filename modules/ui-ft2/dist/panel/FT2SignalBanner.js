import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Typography, Button } from '@mui/material';
/**
 * FT2 SIGNAL BANNER
 * -----------------
 * Reusable operational signal surface.
 *
 * Design purpose:
 * - highlight operational incidents
 * - surface actionable system signals
 * - support rapid operator scanning
 *
 * Used across FT2 modules (orders, inventory, finance, etc).
 */
export function FT2SignalBanner({ severity = 'info', title, description, actionLabel, onAction, }) {
    const color = severity === 'critical'
        ? '#C62828'
        : severity === 'warning'
            ? '#F9A825'
            : '#1976D2';
    return (_jsxs(Box, { "data-ft2-signal-banner": true, "data-severity": severity, sx: {
            borderLeft: `4px solid ${color}`,
            borderRadius: 1,
            border: '1px solid var(--ft2-surface-divider)',
            px: 2,
            py: 1.5,
            mb: 1.5,
            background: 'var(--ft2-surface-bg)',
        }, children: [_jsx(Typography, { fontWeight: 600, children: title }), description && (_jsx(Typography, { variant: "body2", sx: { mt: 0.5 }, children: description })), actionLabel && (_jsx(Button, { size: "small", sx: { mt: 1 }, onClick: onAction, children: actionLabel }))] }));
}
//# sourceMappingURL=FT2SignalBanner.js.map