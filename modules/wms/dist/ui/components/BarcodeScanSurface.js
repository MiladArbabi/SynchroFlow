import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// modules/wms/src/ui/components/BarcodeScanSurface.tsx
import { Box, Typography, IconButton, Alert, Button, CircularProgress } from '@mui/material';
import { Flashlight, FlashlightOff, RefreshCw } from 'lucide-react';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner.js';
export function BarcodeScanSurface({ onScan, enabled = true, hint = 'Point camera at barcode', }) {
    const { videoRef, isScanning, torchSupported, torchOn, toggleTorch, error, restart, } = useBarcodeScanner({
        // Wrap to always tag camera as source — this surface owns camera identity
        onScan: (value) => onScan(value, 'camera'),
        enabled,
    });
    return (_jsxs(Box, { sx: {
            position: 'relative',
            width: '100%',
            borderRadius: 3,
            overflow: 'hidden',
            bgcolor: 'black',
            aspectRatio: '4/3',
        }, children: [_jsx("video", { ref: videoRef, style: {
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                }, muted: true, playsInline // critical for iOS Safari autoplay
                : true }), !isScanning && !error && (_jsxs(Box, { sx: {
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: 'rgba(0,0,0,0.7)',
                    gap: 2,
                }, children: [_jsx(CircularProgress, { size: 32, sx: { color: 'white' } }), _jsx(Typography, { variant: "caption", sx: { color: 'white' }, children: "Starting camera..." })] })), !enabled && isScanning && (_jsx(Box, { sx: {
                    position: 'absolute',
                    inset: 0,
                    bgcolor: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }, children: _jsx(CircularProgress, { size: 28, sx: { color: 'white' } }) })), isScanning && enabled && (_jsxs(Box, { sx: {
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                }, children: [['topleft', 'topright', 'bottomleft', 'bottomright'].map((pos) => (_jsx(Box, { sx: {
                            position: 'absolute',
                            width: 28,
                            height: 28,
                            borderColor: 'white',
                            borderStyle: 'solid',
                            borderWidth: 0,
                            ...(pos === 'topleft' && {
                                top: '25%', left: '15%',
                                borderTopWidth: 3, borderLeftWidth: 3,
                                borderTopLeftRadius: 4,
                            }),
                            ...(pos === 'topright' && {
                                top: '25%', right: '15%',
                                borderTopWidth: 3, borderRightWidth: 3,
                                borderTopRightRadius: 4,
                            }),
                            ...(pos === 'bottomleft' && {
                                bottom: '25%', left: '15%',
                                borderBottomWidth: 3, borderLeftWidth: 3,
                                borderBottomLeftRadius: 4,
                            }),
                            ...(pos === 'bottomright' && {
                                bottom: '25%', right: '15%',
                                borderBottomWidth: 3, borderRightWidth: 3,
                                borderBottomRightRadius: 4,
                            }),
                        } }, pos))), _jsx(Box, { sx: {
                            position: 'absolute',
                            left: '15%',
                            right: '15%',
                            height: 2,
                            bgcolor: 'rgba(255,255,255,0.6)',
                            boxShadow: '0 0 6px rgba(255,255,255,0.8)',
                        } })] })), isScanning && enabled && (_jsxs(Box, { sx: {
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    py: 1.5,
                    px: 2,
                    bgcolor: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }, children: [_jsx(Typography, { variant: "caption", sx: { color: 'white' }, children: hint }), torchSupported && (_jsx(IconButton, { size: "small", onClick: toggleTorch, sx: { color: torchOn ? 'yellow' : 'white' }, children: torchOn ? _jsx(FlashlightOff, { size: 18 }) : _jsx(Flashlight, { size: 18 }) }))] })), error && (_jsxs(Box, { sx: {
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: 'rgba(0,0,0,0.85)',
                    p: 3,
                    gap: 2,
                }, children: [_jsx(Alert, { severity: "error", sx: { width: '100%' }, children: error }), _jsx(Button, { variant: "outlined", size: "small", startIcon: _jsx(RefreshCw, { size: 14 }), onClick: restart, sx: { color: 'white', borderColor: 'white' }, children: "Retry" })] }))] }));
}
//# sourceMappingURL=BarcodeScanSurface.js.map