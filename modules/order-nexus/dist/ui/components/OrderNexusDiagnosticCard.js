import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// modules/order-nexus/src/ui/components/OrderNexusDiagnosticCard.tsx
import { Paper, Stack, Typography, Button, Box } from '@mui/material';
/**
 * OrderNexusDiagnosticCard
 * ------------------------
 * FT1-presentational diagnostic surface.
 *
 * Invariants:
 * - No logic
 * - No routing
 * - No lifecycle awareness
 * - One message, one optional CTA
 */
export function OrderNexusDiagnosticCard({ title, message, ctaLabel, onCtaClick, testId, }) {
    return (_jsxs(Paper, { elevation: 0, "data-testid": testId, sx: {
            display: 'flex',
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
        }, children: [_jsx(Box, { sx: {
                    width: 4,
                    bgcolor: 'info.main',
                } }), _jsxs(Stack, { spacing: 1.25, sx: { p: 2, flex: 1 }, children: [_jsx(Typography, { variant: "subtitle1", fontWeight: 600, children: title }), _jsx(Typography, { variant: "body2", color: "text.secondary", children: message }), ctaLabel && onCtaClick && (_jsx(Button, { type: "button", size: "small", variant: "contained", onClick: (e) => {
                            console.debug('[OrderNexusDiagnosticCard] CTA clicked', {
                                hasHandler: Boolean(onCtaClick),
                                eventType: e.type,
                            });
                            onCtaClick?.();
                        }, sx: { alignSelf: 'flex-start', mt: 1 }, children: ctaLabel }))] })] }));
}
//# sourceMappingURL=OrderNexusDiagnosticCard.js.map