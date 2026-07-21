import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// modules/wms/src/ui/components/WmsConnectionBadge.tsx
import { Box, Typography, useTheme } from '@mui/material';
import { Wifi, WifiOff } from 'lucide-react';
export function WmsConnectionBadge({ isOnline, queuedCount }) {
    const theme = useTheme();
    return (_jsxs(Box, { sx: {
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            px: 1,
            py: 0.25,
            borderRadius: 1,
            bgcolor: isOnline
                ? theme.palette.success.light + '22'
                : theme.palette.warning.light + '33',
            border: '1px solid',
            borderColor: isOnline
                ? theme.palette.success.light
                : theme.palette.warning.main,
        }, children: [isOnline ? (_jsx(Wifi, { size: 12, color: theme.palette.success.main })) : (_jsx(WifiOff, { size: 12, color: theme.palette.warning.main })), _jsx(Typography, { variant: "caption", sx: {
                    color: isOnline ? theme.palette.success.main : theme.palette.warning.main,
                    fontWeight: 600,
                    fontSize: 11,
                }, children: isOnline
                    ? 'Online'
                    : queuedCount > 0
                        ? `Offline — ${queuedCount} scan${queuedCount > 1 ? 's' : ''} queued`
                        : 'Offline' })] }));
}
//# sourceMappingURL=WmsConnectionBadge.js.map