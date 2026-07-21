import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// modules/products/src/ui/components/ProductsDiagnosticCard.tsx
import { Paper, Stack, Typography, Button, Box } from '@mui/material';
/**
 * ProductsDiagnosticCard
 * ----------------------
 * FT1-presentational diagnostic surface.
 *
 * Invariants:
 * - No logic
 * - No routing
 * - No lifecycle awareness
 * - One message, one optional CTA
 */
export function ProductsDiagnosticCard({ title, message, ctaLabel, onCtaClick, testId, }) {
    return (_jsxs(Paper, { elevation: 0, "data-testid": testId, sx: {
            display: 'flex',
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
        }, children: [_jsx(Box, { sx: {
                    width: 4,
                    bgcolor: 'warning.main',
                } }), _jsxs(Stack, { spacing: 1.25, sx: { p: 2, flex: 1 }, children: [_jsx(Typography, { variant: "subtitle1", fontWeight: 600, children: title }), _jsx(Typography, { variant: "body2", color: "text.secondary", children: message }), ctaLabel && onCtaClick && (_jsx(Button, { type: "button", size: "small", variant: "contained", onClick: () => onCtaClick?.(), sx: { alignSelf: 'flex-start', mt: 1 }, children: ctaLabel }))] })] }));
}
//# sourceMappingURL=ProductsDiagnosticCard.js.map