import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Typography } from '@mui/material';
export function FT2PeriodDisplay({ from, to, }) {
    if (!from || !to) {
        return (_jsx(Typography, { variant: "caption", color: "text.secondary", children: "Period resolved by backend" }));
    }
    return (_jsxs(Typography, { variant: "caption", color: "text.secondary", children: [from, " \u2192 ", to] }));
}
//# sourceMappingURL=FT2PeriodDisplay.js.map