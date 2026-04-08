// modules/wms/src/ui/components/BarcodeScanSurface.tsx
import { Box, Typography, IconButton, Alert, Button, CircularProgress } from '@mui/material';
import { Flashlight, FlashlightOff, RefreshCw } from 'lucide-react';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner.js';

/**
 * BARCODE SCAN SURFACE
 * ---------------------
 * Mobile-optimized camera viewfinder for warehouse scanning.
 *
 * Features:
 * - Full-width camera feed
 * - Targeting reticle overlay
 * - Torch toggle (low-light warehouse support)
 * - Permission/device error states with recovery
 * - Disabled state (between scans, awaiting confirmation)
 *
 * Props:
 * - onScan: called with raw scanned string value
 * - enabled: pause scanning while processing confirmation
 * - hint: instruction shown below reticle (e.g. "Scan item barcode")
 */

export interface BarcodeScanSurfaceProps {
  onScan: (value: string) => void;
  enabled?: boolean;
  hint?: string;
}

export function BarcodeScanSurface({
  onScan,
  enabled = true,
  hint = 'Point camera at barcode',
}: BarcodeScanSurfaceProps) {
  const {
    videoRef,
    isScanning,
    torchSupported,
    torchOn,
    toggleTorch,
    error,
    restart,
  } = useBarcodeScanner({ onScan, enabled });

  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        borderRadius: 3,
        overflow: 'hidden',
        bgcolor: 'black',
        aspectRatio: '4/3',
      }}
    >
      {/* CAMERA FEED */}
      <video
        ref={videoRef}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
        muted
        playsInline // critical for iOS Safari autoplay
      />

      {/* LOADING STATE */}
      {!isScanning && !error && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'rgba(0,0,0,0.7)',
            gap: 2,
          }}
        >
          <CircularProgress size={32} sx={{ color: 'white' }} />
          <Typography variant="caption" sx={{ color: 'white' }}>
            Starting camera...
          </Typography>
        </Box>
      )}

      {/* DISABLED OVERLAY — between scans */}
      {!enabled && isScanning && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            bgcolor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CircularProgress size={28} sx={{ color: 'white' }} />
        </Box>
      )}

      {/* TARGETING RETICLE */}
      {isScanning && enabled && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          {/* Corner markers */}
          {['topleft', 'topright', 'bottomleft', 'bottomright'].map((pos) => (
            <Box
              key={pos}
              sx={{
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
              }}
            />
          ))}

          {/* Scan line */}
          <Box
            sx={{
              position: 'absolute',
              left: '15%',
              right: '15%',
              height: 2,
              bgcolor: 'rgba(255,255,255,0.6)',
              boxShadow: '0 0 6px rgba(255,255,255,0.8)',
            }}
          />
        </Box>
      )}

      {/* HINT TEXT */}
      {isScanning && enabled && (
        <Box
          sx={{
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
          }}
        >
          <Typography variant="caption" sx={{ color: 'white' }}>
            {hint}
          </Typography>

          {/* TORCH TOGGLE */}
          {torchSupported && (
            <IconButton
              size="small"
              onClick={toggleTorch}
              sx={{ color: torchOn ? 'yellow' : 'white' }}
            >
              {torchOn ? <FlashlightOff size={18} /> : <Flashlight size={18} />}
            </IconButton>
          )}
        </Box>
      )}

      {/* ERROR STATE */}
      {error && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'rgba(0,0,0,0.85)',
            p: 3,
            gap: 2,
          }}
        >
          <Alert severity="error" sx={{ width: '100%' }}>
            {error}
          </Alert>
          <Button
            variant="outlined"
            size="small"
            startIcon={<RefreshCw size={14} />}
            onClick={restart}
            sx={{ color: 'white', borderColor: 'white' }}
          >
            Retry
          </Button>
        </Box>
      )}
    </Box>
  );
}