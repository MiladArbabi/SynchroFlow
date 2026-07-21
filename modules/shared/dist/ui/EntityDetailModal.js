import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Dialog, DialogContent, Box, Typography, CircularProgress, IconButton, } from '@mui/material';
import { X } from 'lucide-react';
export function EntityDetailModal({ entityId, onClose, title, subtitle, headerActions, isLoading, errorMessage, children, footerActions, maxWidth = 'lg', }) {
    const open = entityId !== null;
    return (_jsxs(Dialog, { open: open, onClose: onClose, fullWidth: true, maxWidth: maxWidth, PaperProps: {
            sx: {
                bgcolor: 'var(--surface)',
                border: '1px solid var(--rule)',
                borderRadius: '14px',
                backgroundImage: 'none',
            },
        }, children: [_jsxs(Box, { sx: {
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    px: 3,
                    pt: 2.5,
                    pb: 2,
                    bgcolor: 'var(--bg-3)',
                    borderBottom: '1px solid var(--rule)',
                }, children: [_jsxs(Box, { sx: { minWidth: 0 }, children: [_jsx(Typography, { sx: { fontSize: 18, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2 }, children: title }), subtitle && (_jsx(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', mt: 0.375 }, children: subtitle }))] }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, ml: 2 }, children: [headerActions, _jsx(IconButton, { onClick: onClose, size: "small", sx: { color: 'var(--ink-4)' }, children: _jsx(X, { size: 18 }) })] })] }), _jsxs(DialogContent, { sx: { p: 3 }, children: [isLoading && (_jsx(Box, { sx: { display: 'flex', justifyContent: 'center', py: 6 }, children: _jsx(CircularProgress, { size: 28, sx: { color: 'var(--accent)' } }) })), !isLoading && errorMessage && (_jsx(Box, { sx: {
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1.5,
                            px: 2,
                            py: 1.25,
                            bgcolor: 'var(--accent-ghost)',
                            border: '1px solid var(--accent-border)',
                            borderRadius: '10px',
                        }, children: _jsx(Typography, { sx: { fontSize: 13, fontWeight: 300, color: 'var(--ink-2)' }, children: errorMessage }) })), !isLoading && !errorMessage && children] }), footerActions && (_jsx(Box, { sx: {
                    px: 3,
                    py: 2,
                    bgcolor: 'var(--bg-3)',
                    borderTop: '1px solid var(--rule)',
                }, children: footerActions }))] }));
}
