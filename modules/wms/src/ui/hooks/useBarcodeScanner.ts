// modules/wms/src/ui/hooks/useBarcodeScanner.ts
import { useEffect, useRef, useState, useCallback } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat, NotFoundException } from '@zxing/library';

/**
 * BARCODE SCANNER HOOK
 * ---------------------
 * Drives continuous camera-based barcode scanning for WMS pick flow.
 *
 * Features:
 * - Continuous decode loop (~100ms per frame)
 * - Multi-format: Code128, EAN-13, EAN-8, QR, DataMatrix
 * - Torch/flashlight control via MediaTrackConstraints
 * - Camera permission error surfacing
 * - Graceful cleanup on unmount
 *
 * Environmental considerations:
 * - Torch toggle for low-light warehouse conditions
 * - Continuous scan — no tap-to-scan, works one-handed
 * - NotFoundException suppressed — normal between scans
 * - onScan fires once per unique result — debounced by result value
 *
 * Usage:
 *   const { videoRef, isScanning, torchOn, toggleTorch, error } = useBarcodeScanner({ onScan })
 *   <video ref={videoRef} />
 */

export interface UseBarcodeScannnerOptions {
  onScan: (value: string) => void;
  enabled?: boolean;
}

export interface UseBarcannnerResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isScanning: boolean;
  torchSupported: boolean;
  torchOn: boolean;
  toggleTorch: () => void;
  error: string | null;
  restart: () => void;
}

const SUPPORTED_FORMATS = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
];

export function useBarcodeScanner({
  onScan,
  enabled = true,
}: UseBarcodeScannnerOptions): UseBarcannnerResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastResultRef = useRef<string | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restartKey, setRestartKey] = useState(0);

  const restart = useCallback(() => {
    lastResultRef.current = null;
    setError(null);
    setRestartKey((k) => k + 1);
  }, []);

  const toggleTorch = useCallback(async () => {
    if (!streamRef.current || !torchSupported) return;

    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;

    try {
      const newTorchState = !torchOn;
      await track.applyConstraints({
        advanced: [{ torch: newTorchState } as any],
      });
      setTorchOn(newTorchState);
    } catch {
      console.warn('[BARCODE_SCANNER] Torch toggle failed');
    }
  }, [torchOn, torchSupported]);

  useEffect(() => {
    if (!enabled || !videoRef.current) return;

    let cancelled = false;

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_FORMATS);
    hints.set(DecodeHintType.TRY_HARDER, true);

    const reader = new BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 100,
      delayBetweenScanSuccess: 1500, // prevent double-fire on same barcode
    });

    readerRef.current = reader;

    const startScanning = async () => {
      try {
        // Request back camera (environment) — standard for warehouse scanning
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        // Check torch support
        const track = stream.getVideoTracks()[0];
        const capabilities = track.getCapabilities() as any;
        setTorchSupported(!!capabilities?.torch);

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setIsScanning(true);
        setError(null);

        const controls = await reader.decodeFromStream(
          stream,
          videoRef.current!,
          (result, err) => {
            if (cancelled) return;

            if (result) {
              const text = result.getText();

              // Debounce — suppress repeated fires for same value
              if (text === lastResultRef.current) return;
              lastResultRef.current = text;

              onScan(text);

              // Reset last result after delay to allow re-scan of same item
              setTimeout(() => {
                lastResultRef.current = null;
              }, 2000);
            }

            if (err && !(err instanceof NotFoundException)) {
              // NotFoundException is normal between scans — suppress it
              console.warn('[BARCODE_SCANNER] Decode error', err.message);
            }
          }
        );

        controlsRef.current = controls;

      } catch (err: any) {
        if (cancelled) return;

        if (
          err?.name === 'NotAllowedError' ||
          err?.name === 'PermissionDeniedError'
        ) {
          setError('Camera permission denied. Please allow camera access and try again.');
        } else if (err?.name === 'NotFoundError') {
          setError('No camera found on this device.');
        } else {
          setError('Camera unavailable. Please check your device settings.');
        }

        setIsScanning(false);
        console.error('[BARCODE_SCANNER] Start failed', err?.message);
      }
    };

    startScanning();

    return () => {
      cancelled = true;
      setIsScanning(false);
      setTorchOn(false);

      controlsRef.current?.stop();
      controlsRef.current = null;

      // Stop all camera tracks
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;

      // Clean up reader
      readerRef.current = null;
    };
  }, [enabled, restartKey]); // restartKey forces full re-init on restart()

  return {
    videoRef,
    isScanning,
    torchSupported,
    torchOn,
    toggleTorch,
    error,
    restart,
  };
}