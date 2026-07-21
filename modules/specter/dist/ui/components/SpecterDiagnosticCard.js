import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// ⚠️ HARD RULE:
// This component MUST stay API-compatible with OrderNexusDiagnosticCard.
// Any prop change must be applied to BOTH.
import { Paper, Stack, Typography, Button, Box } from '@mui/material';
/**
 * SpecterDiagnosticCard
 * ---------------------
 * FT1-presentational diagnostic surface.
 *
 * MUST mirror OrderNexusDiagnosticCard exactly.
 */
export function SpecterDiagnosticCard({ title, message, ctaLabel, onCtaClick, testId, }) {
    return (_jsxs(Paper, { elevation: 0, "data-testid": testId, sx: {
            display: 'flex',
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
        }, children: [_jsx(Box, { sx: {
                    width: 4,
                    bgcolor: 'secondary.main',
                } }), _jsxs(Stack, { spacing: 1.25, sx: { p: 2, flex: 1 }, children: [_jsx(Typography, { variant: "subtitle1", fontWeight: 600, children: title }), _jsx(Typography, { variant: "body2", color: "text.secondary", children: message }), ctaLabel && onCtaClick && (_jsx(Button, { size: "small", variant: "contained", onClick: onCtaClick, sx: { alignSelf: 'flex-start', mt: 1 }, children: ctaLabel }))] })] }));
}
//# sourceMappingURL=SpecterDiagnosticCard.js.map