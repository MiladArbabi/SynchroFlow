import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// RECOUNT-FRESH-NOBINS-40
//
// Distinguishes "nothing configured yet" from "nothing currently needs
// reconciliation" in the Reconcile Inventory dialog. Both states used to
// render the identical "No suggested bins right now." copy, leaving a
// merchant with zero bins no path forward and a fully-configured merchant
// no reassurance that the empty result was expected.
//
// Extracted as its own component (rather than inlined in WmsModuleFT2) so
// its DOM contract can be proven with a direct render — WmsModuleFT2's
// 30+ prop surface is unrelated to this issue.
import { Alert, Box, Button, Typography } from '@mui/material';
import { WMS_TIER1_ACTION_SX } from '../pages/CountingSessionPage';
export function RecountEmptyState({ availability, onSetupBinsClick, }) {
    // 'suggestions_available': the canvas/fallback suggestion UI owns this
    // state. 'unknown': the warehouse-grid query has not resolved yet — do
    // not guess at bin configuration before it does.
    if (availability === 'suggestions_available' || availability === 'unknown') {
        return null;
    }
    if (availability === 'no_bins_configured') {
        return (_jsxs(Box, { sx: { mb: 2 }, children: [_jsx(Alert, { severity: "info", sx: { mb: 1 }, children: "Set up your warehouse bins before creating an inventory count." }), _jsx(Typography, { sx: { fontSize: 12, color: 'var(--ink-3)', mb: 1.5 }, children: "Recounts check quantities at physical storage locations \u2014 bins, shelves, and lanes \u2014 not products in the abstract." }), _jsx(Button, { variant: "contained", onClick: onSetupBinsClick, sx: { ...WMS_TIER1_ACTION_SX, borderRadius: '6px', fontWeight: 600 }, children: "Set up bins" })] }));
    }
    return (_jsx(Alert, { severity: "info", sx: { mb: 2 }, children: "No bins currently need reconciliation." }));
}
//# sourceMappingURL=RecountEmptyState.js.map