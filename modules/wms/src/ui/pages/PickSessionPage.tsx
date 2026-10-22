// modules/wms/src/ui/pages/PickSessionPage.tsx
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  CircularProgress,
  LinearProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  useTheme,
} from '@mui/material';
import { CheckCircle, AlertTriangle, MapPin, Package, Hash } from 'lucide-react';
import { useScanSourceDetector } from '../hooks/useScanSourceDetector.js';
import { WmsSessionBrief } from '../components/WmsSessionBrief.js';
import { WMS_TIER1_ACTION_SX } from './CountingSessionPage.js';
import { WmsConnectionBadge } from '../components/WmsConnectionBadge.js';
import { IsometricCanvas } from '@lasyncro/shared/ui';
import type { OperationalMapState, WarehouseZone } from '@lasyncro/shared/ui';

/**
 * PICK SESSION PAGE — WEBAPP
 * --------------------------
 * Playbook contract: Brief → location_scan → product_scan → summary → done
 *
 * Per line item — two-scan confirm pattern:
 * 1. Brief        — batch summary (items, units), Start Picking CTA
 * 2. location_scan — ScanInput for bin barcode, client-side match against location_code
 * 3. product_scan  — ScanInput for product barcode, resolved via onResolveBarcode
 * 4. summary       — per-line results (picked vs exception), Pick Complete CTA
 * 5. done          — success state
 *
 * Line items are pre-sorted by optimized pick route — iterate in order.
 * No camera. ScanInput pattern only (USB/BT scanner or manual + Enter).
 * Problem Center called on every exception alongside workflow exception endpoint.
 * Session persistence: ?batchId= URL param managed by WmsModuleFT2 (pendingPickBatchId prop).
 *
 * PICK-AUD-01/02 — BarcodeScanSurface + Camera removed entirely
 * PICK-AUD-03    — Brief screen added
 * PICK-AUD-04    — location_scan phase added (two-scan track per item)
 * PICK-AUD-05    — Summary screen added
 * PICK-AUD-06    — Session persistence via WmsModuleFT2 URL param (pendingPickBatchId)
 * PICK-AUD-07    — All async callbacks use .catch(), no void handler()
 * PICK-AUD-08    — No MUI color= props, sx with var(--accent) tokens throughout
 * PICK-AUD-09    — fontWeight max 600
 * PICK-AUD-10    — Full exception taxonomy from Playbook §3
 * PICK-AUD-11    — SUPERSEDED by GH-1049: the server owns Problem Center task
 *                  creation. Pick reports physical truth exactly once.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LineItem {
  lasyncro_line_item_id: string;
  lasyncro_variant_id: string;
  lasyncro_order_id: string;
  /** INV-RES-01: exact physical reservation task; null on legacy batches. */
  reservation_allocation_id?: string | null;
  sku: string | null;
  product_title: string;
  variant_title: string | null;
  quantity: number;
  location_code: string;
  /** WEB-PICK-UNIT-01: variant image from Shopify sync; null when not synced. */
  image_url: string | null;
  /** WEB-PICK-UNIT-01: stowed LSU- unit IDs for this variant; null on legacy path. */
  unit_ids: string[] | null;
}

export interface ConfirmScanParams {
  lasyncro_line_item_id: string;
  lasyncro_variant_id: string;
  /** INV-RES-01: exact reservation task; undefined on legacy batches. */
  reservation_allocation_id?: string;
  location_code: string;
  quantity_confirmed: number;
  scan_source?: 'camera' | 'nfc' | 'usb' | 'bt' | 'manual';
  /** WEB-PICK-UNIT-01: LSU- unit ID from resolver; undefined on legacy barcode path. */
  lasyncro_unit_id?: string;
}

export interface ReportExceptionParams {
  lasyncro_line_item_id: string;
  lasyncro_variant_id: string;
  /** GH-1049: exact physical pick task; undefined on legacy batches. */
  reservation_allocation_id?: string;
  exception_type: string;
  /** GH-1049: Pick clients report at the pick stage. */
  stage: 'pick';
  quantity_required: number;
  quantity_found: number;
  /** GH-1049: stable per-report id so a retry replays instead of duplicating. */
  device_event_id: string;
  notes?: string;
}

/**
 * Pack-stage exception payload.
 *
 * Pack custody is a later GH-1049 slice, so this deliberately keeps the
 * pre-GH-1049 shape and is NOT the Pick contract above — Pick alone carries
 * allocation identity, stage and a device event id today.
 */
export interface ReportPackExceptionParams {
  lasyncro_line_item_id: string;
  lasyncro_variant_id: string;
  exception_type: string;
  quantity_required: number;
  quantity_found: number;
  notes?: string;
}

export interface CreateProblemTaskParams {
  lasyncro_variant_id: string;
  quantity: number;
  exception_type: string;
  source: 'pick' | 'pack';
  /**
   * BL-05 — links the task to the pick_exceptions row it came from.
   * Without it httpResolveProblemTask cannot resolve back to the exception
   * and the batch alert never clears. Optional: PackSessionPage reports
   * standalone problems that have no pick_exception.
   */
  source_exception_id?: string;
}

export interface PickSessionPageProps {
  pickBatchId: string;
  lineItems: LineItem[];
  onComplete: () => void;
  onResolveBarcode: (scannedValue: string) => Promise<{ lasyncro_variant_id: string; lasyncro_unit_id?: string } | null>;
  onConfirmScan: (params: ConfirmScanParams) => Promise<void>;
  onReportException: (params: ReportExceptionParams) => Promise<{ pick_exception_id: string }>;
  onPickComplete: () => Promise<void>;
  /** Navigation-only handoff; physical Pack work belongs to its session. */
  onStartPacking?: (batchId: string) => void;
  /**
   * BATCH-DETAIL-HANDOFF-01 — the Brief's Start Picking is the explicit work
   * boundary. Awaited before entering location_scan; a rejection keeps the
   * operator on the Brief with a retryable error. The host decides what
   * starting means (e.g. claiming a pending batch). Omitted: no start gate.
   */
  onStartPicking?: () => Promise<void>;
  /**
   * PICK-RESUME-SEMANTICS-01 — the host's canonical batch status is exactly
   * `picking`: the batch is already started, so the session resumes execution
   * (location_scan for the first remaining line) instead of showing the
   * Brief. May turn true after mount when canonical data resolves late; it
   * only ever moves Brief → execution, so later polls never reset progress.
   */
  resumePicking?: boolean;
  /**
   * PICK-EXECUTION-SPATIAL-01B — canonical warehouse geometry for the
   * execution map. undefined = geometry not available to the host; only the
   * map degrades, never the scanner workflow.
   */
  floorZones?: WarehouseZone[];
  /** Canonical connection state; the header badge renders only when supplied. */
  isOnline?: boolean;
  queuedCount?: number;
}

type SessionPhase = 'brief' | 'location_scan' | 'product_scan' | 'qty_confirm' | 'summary' | 'done';

/**
 * GH-1049 operator taxonomy — exactly the five physical outcomes a picker can
 * report. order_cancelled is a system outcome and never operator-selectable.
 */
type ExceptionType =
  | 'item_missing'
  | 'short_pick'
  | 'product_defect'
  | 'packaging_defect'
  | 'wrong_item';

interface PickResult {
  lineItem: LineItem;
  status: 'picked' | 'exception';
  exceptionType?: ExceptionType;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const EXCEPTION_LABELS: Record<ExceptionType, string> = {
  item_missing:      'Item not found at location',
  short_pick:        'Short pick — fewer units than required',
  product_defect:    'Product defect',
  packaging_defect:  'Packaging damaged',
  wrong_item:        'Wrong item entirely',
};

const NOTES_REQUIRED: ExceptionType[] = [];
const QTY_REQUIRED: ExceptionType[] = ['short_pick'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Stable client event id for one exception report (GH-1049 idempotency). */
function newEventId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `evt-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

/** Accept LOC-A-1-3-7 or A-1-3-7 against location_code A-1-3-7 */
function locationMatches(scanned: string, locationCode: string): boolean {
  const n = scanned.trim().toUpperCase();
  const c = locationCode.trim().toUpperCase();
  return n === c || n === `LOC-${c}`;
}

/** "A-1-3-7" → "Lane A · Bin 7" */
function parseLocationLabel(code: string): string {
  const parts = code.split('-');
  if (parts.length >= 2) return `Lane ${parts[0]} · Bin ${parts[parts.length - 1]}`;
  return code;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PickSessionPage({
  pickBatchId,
  lineItems,
  onComplete,
  onResolveBarcode,
  onConfirmScan,
  onReportException,
  onPickComplete,
  onStartPacking,
  onStartPicking,
  resumePicking = false,
  floorZones,
  isOnline,
  queuedCount = 0,
}: PickSessionPageProps) {
  const theme = useTheme();
  const { onInputChange, detectSourceAndReset, reset: resetScanDetector } = useScanSourceDetector();
  // PICK-BATCH-IDENTITY-CONTINUITY-01: same first-8 batch token as Order Flow,
  // Batch Detail and WMS batch surfaces; display only — pickBatchId stays the full UUID.
  const batchShort = pickBatchId.slice(0, 8).toUpperCase();

  const locationInputRef  = useRef<HTMLInputElement>(null);
  const productInputRef   = useRef<HTMLInputElement>(null);
  const qtyInputRef       = useRef<HTMLInputElement>(null);
  // WEB-PICK-UNIT-01: carries LSU- unit ID from product_scan into qty_confirm path.
  const resolvedUnitIdRef = useRef<string | undefined>(undefined);

  const [phase, setPhase]               = useState<SessionPhase>(
    () => (resumePicking ? 'location_scan' : 'brief'),
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [locationInput, setLocationInput] = useState('');
  const [productInput,  setProductInput]  = useState('');
  const [qtyInput,       setQtyInput]      = useState('');
  const [scanError,      setScanError]     = useState<string | null>(null);
  const [scanProcessing, setScanProcessing] = useState(false);

  const [exceptionDialog,     setExceptionDialog]     = useState(false);
  const [exceptionType,       setExceptionType]       = useState<ExceptionType | null>(null);
  const [exceptionQty,        setExceptionQty]        = useState('');
  const [exceptionNotes,      setExceptionNotes]      = useState('');
  const [exceptionError,      setExceptionError]      = useState<string | null>(null);
  const [exceptionProcessing, setExceptionProcessing] = useState(false);
  /**
   * GH-1049 — stable identity for ONE operator report. Minted when the dialog
   * opens and held across retries, so a resubmit after a failed response
   * replays the same incident instead of creating a second one.
   */
  const [exceptionEventId, setExceptionEventId] = useState<string>(() => newEventId());

  const [startingPick, setStartingPick] = useState(false);
  const [startError,   setStartError]   = useState<string | null>(null);
  const startingPickRef = useRef(false);

  const [pickResults,    setPickResults]    = useState<PickResult[]>([]);
  const [completingPick, setCompletingPick] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);

  const currentItem = lineItems[currentIndex];
  const totalUnits  = lineItems.reduce((sum, li) => sum + li.quantity, 0);
  const progress    = lineItems.length > 0 ? Math.round((currentIndex / lineItems.length) * 100) : 0;
  const isLocationPhase = phase === 'location_scan';
  const isProductPhase  = phase === 'product_scan';
  const isQtyPhase      = phase === 'qty_confirm';
  const needsQtyConfirm = (currentItem?.quantity ?? 1) > 1;

  // PICK-EXECUTION-SPATIAL-01B — remaining route only: lineItems from the
  // current item on, by location, first occurrence kept. Nothing absent from
  // lineItems is ever treated as completed or visited (a resumed allocation
  // pick returns remaining work only), so no history is derived here.
  const remainingRoute = useMemo(() => {
    const seen = new Set<string>();
    const route: string[] = [];
    for (const item of lineItems.slice(currentIndex)) {
      if (!seen.has(item.location_code)) {
        seen.add(item.location_code);
        route.push(item.location_code);
      }
    }
    return route;
  }, [lineItems, currentIndex]);

  const routeStateByLocation = useMemo(
    () =>
      Object.fromEntries(
        remainingRoute.map((code) => [code, 'active' as OperationalMapState]),
      ),
    [remainingRoute],
  );

  // Orientation map, not manager inspection: only the current stop is an
  // inspection target, so it stays selected and nothing else is clickable.
  const currentLocationCode = currentItem?.location_code ?? null;
  const inspectableCodes = useMemo(
    () => new Set(currentLocationCode ? [currentLocationCode] : []),
    [currentLocationCode],
  );

  // ── Focus management ───────────────────────────────────────
  useEffect(() => {
    if (phase === 'location_scan') setTimeout(() => locationInputRef.current?.focus(), 50);
    if (phase === 'product_scan')  setTimeout(() => productInputRef.current?.focus(),  50);
    if (phase === 'qty_confirm')   setTimeout(() => qtyInputRef.current?.focus(),      50);
  }, [phase, currentIndex]);

  useEffect(() => {
    if (!scanError) return;
    if (phase === 'location_scan') setTimeout(() => locationInputRef.current?.focus(), 50);
    if (phase === 'product_scan')  setTimeout(() => productInputRef.current?.focus(),  50);
    if (phase === 'qty_confirm')   setTimeout(() => qtyInputRef.current?.focus(),      50);
  }, [scanError, phase]);

  // ── Advance / summary ──────────────────────────────────────
  const advanceOrSummary = useCallback(() => {
    if (currentIndex >= lineItems.length - 1) {
      setPhase('summary');
    } else {
      setCurrentIndex(i => i + 1);
      setLocationInput('');
      setProductInput('');
      setQtyInput('');
      setScanError(null);
      resetScanDetector();
      resolvedUnitIdRef.current = undefined; // WEB-PICK-UNIT-01: clear between items
      setPhase('location_scan');
    }
  }, [currentIndex, lineItems.length, resetScanDetector]);

  // ── Resume (Brief → location_scan, already-picking batch) ──
  // One-way and Brief-only: never touches an execution phase, and never
  // pre-empts an in-flight Start Picking, whose own result decides.
  useEffect(() => {
    if (resumePicking && phase === 'brief' && !startingPickRef.current) {
      setPhase('location_scan');
    }
  }, [resumePicking, phase]);

  // ── Start (Brief → location_scan) ──────────────────────────
  const handleStartPicking = useCallback(async () => {
    if (startingPickRef.current) return;
    startingPickRef.current = true;
    setStartingPick(true);
    setStartError(null);
    try {
      await onStartPicking?.();
      setPhase('location_scan');
    } catch (err) {
      setStartError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not start picking. Try again.',
      );
    } finally {
      startingPickRef.current = false;
      setStartingPick(false);
    }
  }, [onStartPicking]);

  // ── Location scan ──────────────────────────────────────────
  const handleLocationScan = useCallback((value: string) => {
    if (!currentItem) return;
    setScanError(null);
    if (locationMatches(value, currentItem.location_code)) {
      setPhase('product_scan');
    } else {
      setScanError(`Wrong location. Expected ${currentItem.location_code} — try again.`);
    }
  }, [currentItem]);

  // ── Product scan ───────────────────────────────────────────
  const handleProductScan = useCallback(async (value: string) => {
    if (!currentItem) return;
    setScanProcessing(true);
    setScanError(null);
try {
        const scannedValue = value.trim();
        const result = await onResolveBarcode(scannedValue);

        if (result?.lasyncro_variant_id === currentItem.lasyncro_variant_id) {
          const resolvedUnitId = scannedValue.startsWith('LSU-')
            ? result.lasyncro_unit_id
            : undefined;

          resolvedUnitIdRef.current = resolvedUnitId;

          if (currentItem.quantity > 1) {
            setPhase('qty_confirm');
          } else {
            await onConfirmScan({
              lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
              lasyncro_variant_id:   currentItem.lasyncro_variant_id,
              reservation_allocation_id:
                currentItem.reservation_allocation_id ?? undefined,
              location_code:         currentItem.location_code,
              quantity_confirmed:    currentItem.quantity,
              scan_source:           detectSourceAndReset(),
              lasyncro_unit_id:      resolvedUnitId,
            });
            setPickResults(prev => [...prev, { lineItem: currentItem, status: 'picked' }]);
            setTimeout(advanceOrSummary, 400);
        }
      } else {
        setScanError('Wrong item — barcode does not match. Check you are at the right bin.');
      }
      
    } catch (err: unknown) {
      const msg = (err as any)?.response?.data?.error ?? (err instanceof Error ? err.message : 'Scan failed. Try again.');
      setScanError(msg);
    } finally {
      setScanProcessing(false);
    }
  }, [currentItem, onResolveBarcode, onConfirmScan, detectSourceAndReset, advanceOrSummary]);

  const handleQtyConfirm = useCallback(() => {
    if (!currentItem) return;
    const entered = parseInt(qtyInput, 10);
    if (isNaN(entered) || entered <= 0) {
      setScanError('Enter a valid quantity.');
      return;
    }
    if (entered !== currentItem.quantity) {
      setScanError(`Expected ${currentItem.quantity} units — recount and try again.`);
      return;
    }
    setScanProcessing(true);
    setScanError(null);
    onConfirmScan({
      lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
      lasyncro_variant_id:   currentItem.lasyncro_variant_id,
      reservation_allocation_id:
        currentItem.reservation_allocation_id ?? undefined,
      location_code:         currentItem.location_code,
      quantity_confirmed:    currentItem.quantity,
      scan_source:           detectSourceAndReset(),
      lasyncro_unit_id:      resolvedUnitIdRef.current,
    })
      .then(() => {
        setPickResults(prev => [...prev, { lineItem: currentItem, status: 'picked' }]);
        setQtyInput('');
        setTimeout(advanceOrSummary, 400);
      })
      .catch((err: unknown) => {
        const msg = (err as any)?.response?.data?.error ?? 'Confirm failed. Try again.';
        setScanError(msg);
      })
      .finally(() => setScanProcessing(false));
  }, [currentItem, qtyInput, onConfirmScan, detectSourceAndReset, advanceOrSummary]);

  // ── Exception report ───────────────────────────────────────
  const handleReportException = useCallback(() => {
    if (!currentItem || !exceptionType) return;
    if (QTY_REQUIRED.includes(exceptionType) && !exceptionQty.trim()) {
      setExceptionError('Enter the quantity found.');
      return;
    }
    if (NOTES_REQUIRED.includes(exceptionType) && !exceptionNotes.trim()) {
      setExceptionError('Notes are required for this exception type.');
      return;
    }
    setExceptionProcessing(true);
    setExceptionError(null);
    const qtyFound = exceptionType === 'short_pick' ? (parseInt(exceptionQty, 10) || 0) : 0;

    /**
     * GH-1049 — one report carries the whole physical truth: which allocation,
     * what was expected, what was actually found. The server creates the
     * linked Problem Center task in the same transaction; the client must not
     * mint a second incident.
     */
    onReportException({
      lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
      lasyncro_variant_id:   currentItem.lasyncro_variant_id,
      reservation_allocation_id:
        currentItem.reservation_allocation_id ?? undefined,
      exception_type:        exceptionType,
      stage:                 'pick',
      quantity_required:     currentItem.quantity,
      quantity_found:        qtyFound,
      device_event_id:       exceptionEventId,
      notes:                 exceptionNotes.trim() || undefined,
    })
      .then(() => {
        setPickResults(prev => [...prev, { lineItem: currentItem, status: 'exception', exceptionType }]);
        setExceptionDialog(false);
        setExceptionType(null);
        setExceptionQty('');
        setExceptionNotes('');
        advanceOrSummary();
      })
      .catch((err: unknown) => {
        const msg = (err as any)?.response?.data?.error ?? 'Exception report failed. Try again.';
        setExceptionError(msg);
      })
      .finally(() => setExceptionProcessing(false));
  }, [currentItem, exceptionType, exceptionQty, exceptionNotes, exceptionEventId, onReportException, advanceOrSummary]);

  // ── Pick complete ──────────────────────────────────────────
  const handlePickComplete = useCallback(() => {
    setCompletingPick(true);
    setCompletionError(null);
    onPickComplete()
      .then(() => {
        setPhase('done');
      })
      .catch((err: unknown) => {
        const msg = (err as any)?.response?.data?.error ?? 'Pick complete failed. Retry when connection is restored.';
        setCompletionError(msg);
        setCompletingPick(false);
      });
  }, [onPickComplete]);

  const openExceptionDialog = useCallback(() => {
    setExceptionEventId(newEventId());
    setExceptionType(null);
    setExceptionQty('');
    setExceptionNotes('');
    setExceptionError(null);
    setExceptionDialog(true);
  }, []);

  // ── BRIEF ──────────────────────────────────────────────────
  // WMS-BRIEF-SYSTEM-01A / WAREHOUSE-SESSION-FOCUS-02A — Pick is focused from
  // its Brief onward (warehouseFocus=pick hides all app navigation), so the
  // shared WMS Brief carries an explicit non-mutating Leave pick. It routes
  // through the existing session exit (onComplete → host session exit),
  // never claims, and stays available after a failed Start Picking. Start
  // Picking remains the only claim boundary; no scanner control renders here.
  if (phase === 'brief') {
    return (
      <WmsSessionBrief
        eyebrow={`Batch ${batchShort}`}
        title="Pick Session"
        description="Items are sorted by optimized pick route."
        facts={[
          { label: 'Action', value: 'Brief' },
          { label: 'Lines', value: String(lineItems.length) },
          { label: 'Units', value: String(totalUnits) },
          { label: 'Next', value: 'Start picking' },
        ]}
        steps={[
          'For each item, scan the bin barcode first.',
          'Then scan the product barcode to confirm.',
        ]}
        error={startError}
        primaryAction={
          <Button
            variant="contained"
            size="large"
            onClick={() => void handleStartPicking()}
            disabled={startingPick}
            startIcon={startingPick ? <CircularProgress size={16} color="inherit" /> : undefined}
            sx={{
              ...WMS_TIER1_ACTION_SX,
              borderRadius: '6px',
              fontWeight: 600,
            }}
          >
            Start Picking
          </Button>
        }
        secondaryAction={
          <Button
            variant="text"
            size="small"
            onClick={() => onComplete()}
            disabled={startingPick}
            sx={{ minWidth: 'auto', px: 0, fontSize: 11, textTransform: 'none' }}
          >
            Leave pick
          </Button>
        }
      />
    );
  }

  // ── SUMMARY ────────────────────────────────────────────────
  if (phase === 'summary') {
    const pickedCount    = pickResults.filter(r => r.status === 'picked').length;
    const exceptionCount = pickResults.filter(r => r.status === 'exception').length;

    return (
      <Box sx={{ p: 2, maxWidth: 480, mx: 'auto' }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 0.5 }}>
          Pick Summary
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Review before confirming
        </Typography>

        <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
          <Paper variant="outlined" sx={{ flex: 1, borderRadius: 2, p: 1.5, textAlign: 'center' }}>
            <Typography variant="h5" fontWeight={600} color="success.main">{pickedCount}</Typography>
            <Typography variant="caption" color="text.secondary">Picked</Typography>
          </Paper>
          {exceptionCount > 0 && (
            <Paper variant="outlined" sx={{ flex: 1, borderRadius: 2, p: 1.5, textAlign: 'center' }}>
              <Typography variant="h5" fontWeight={600} color="warning.main">{exceptionCount}</Typography>
              <Typography variant="caption" color="text.secondary">Exceptions</Typography>
            </Paper>
          )}
        </Box>

        {exceptionCount > 0 && (
          <Alert icon={false} severity="warning" sx={{ mb: 2, borderRadius: 2 }}>
            {exceptionCount} item{exceptionCount > 1 ? 's' : ''} reported as exceptions — routed to Problem Center.
          </Alert>
        )}

        <Box sx={{ mb: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {pickResults.map(({ lineItem, status, exceptionType: et }) => (
            <Paper
              key={lineItem.lasyncro_line_item_id}
              variant="outlined"
              sx={{ borderRadius: 2, p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}
            >
              {status === 'picked' ? (
                <CheckCircle size={18} color={theme.palette.success.main} />
              ) : (
                <AlertTriangle size={18} color={theme.palette.warning.main} />
              )}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={500} noWrap>{lineItem.product_title}</Typography>
                {lineItem.variant_title && (
                  <Typography variant="caption" color="text.secondary">{lineItem.variant_title}</Typography>
                )}
              </Box>
              <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', display: 'block' }}>
                  {lineItem.location_code}
                </Typography>
                {status === 'exception' && et && (
                  <Typography variant="caption" color="warning.main" display="block">
                    {EXCEPTION_LABELS[et]}
                  </Typography>
                )}
              </Box>
            </Paper>
          ))}
        </Box>

        {completionError && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{completionError}</Alert>
        )}

        <Button
          variant="contained"
          fullWidth
          size="large"
          onClick={handlePickComplete}
          disabled={completingPick}
          sx={{
            borderRadius: '6px',
            fontWeight: 600,
            bgcolor: 'var(--accent)',
            '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
          }}
        >
          {completingPick ? 'Confirming…' : 'Confirm Pick Complete'}
        </Button>
      </Box>
    );
  }

  // ── DONE ───────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <Box sx={{
        height: '100dvh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        p: 3,
      }}>
        <CheckCircle size={56} color={theme.palette.success.main} />
        <Typography variant="h6" fontWeight={600} sx={{ mt: 2 }}>Pick Complete</Typography>
        <Typography sx={{ mt: 1, fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
          Batch {batchShort}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, textAlign: 'center' }}>
          {lineItems.length} items processed. Batch ready for pack.
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap', mt: 3 }}>
          <Button
            variant="contained"
            disabled={!onStartPacking}
            onClick={() => onStartPacking?.(pickBatchId)}
            sx={{ ...WMS_TIER1_ACTION_SX, borderRadius: '6px', fontWeight: 600 }}
          >
            Start packing →
          </Button>
          <Button
            variant="outlined"
            onClick={() => onComplete()}
            sx={{
              color: 'var(--accent-text)', border: '0.5px solid var(--accent-border)',
              borderRadius: '6px', fontWeight: 500,
              '&:hover': { borderColor: 'var(--accent)', bgcolor: 'var(--accent-ghost)' },
            }}
          >
            Return to Operations
          </Button>
        </Box>
      </Box>
    );
  }

  // ── INSPECT PHASES (location_scan + product_scan) ──────────
  if (!currentItem) return null;

  const variantPills = currentItem.variant_title
    ? currentItem.variant_title.split('/').map(s => s.trim()).filter(Boolean)
    : [];

  return (
    // PICK-EXECUTION-SPATIAL-01B — viewport-bound execution. Normal desktop
    // fits without scrolling (the map absorbs remaining height); a genuinely
    // short viewport scrolls vertically instead of clipping controls.
    <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflowX: 'hidden', overflowY: 'auto' }}>

      {/* SESSION HEADER — task, batch identity, progress, connection */}
      <Box component="header" sx={{ px: 2, pt: 1.5, pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.25, minWidth: 0, flexWrap: 'wrap' }}>
            <Typography component="h1" sx={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
              Pick
            </Typography>
            <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
              Batch {batchShort}
            </Typography>
            <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
              Item {currentIndex + 1} of {lineItems.length}
            </Typography>
          </Box>
          {isOnline !== undefined && (
            <WmsConnectionBadge isOnline={isOnline} queuedCount={queuedCount} />
          )}
        </Box>
        <LinearProgress
          variant="determinate"
          value={progress}
          sx={{
            borderRadius: 1, height: 3,
            bgcolor: 'action.hover',
            '& .MuiLinearProgress-bar': { bgcolor: 'var(--accent)' },
          }}
        />
      </Box>

      {/* STEP ORIENTATION BANNER */}
      <Alert
        icon={false}
        sx={{ mx: 2, mt: 1, py: 0.5, borderRadius: 2, fontSize: 12 }}
      >
        {isLocationPhase
          ? `Step 1 of ${needsQtyConfirm ? 3 : 2} — Walk to the location and scan the bin barcode.`
          : isProductPhase
          ? `Step 2 of ${needsQtyConfirm ? 3 : 2} — Find the item and scan the product barcode.`
          : 'Step 3 of 3 — Count the units and confirm the quantity.'}
      </Alert>

      {/* TRACK CARD — 2 nodes (qty=1) or 3 nodes (qty>1) */}
      <Paper
        variant="outlined"
        sx={{ mx: 2, mt: 1.5, p: 2, borderRadius: 2, bgcolor: 'background.default' }}
      >
        <Box sx={{ position: 'relative', height: 100 }}>

          {/* Background line */}
          <Box sx={{
            position: 'absolute', left: 0, right: 0, top: 19,
            height: 3, bgcolor: 'action.disabledBackground', borderRadius: 1, overflow: 'hidden',
          }}>
            <Box sx={{
              height: '100%',
              width: isLocationPhase ? '0%'
                   : isProductPhase  ? (needsQtyConfirm ? '50%' : '66%')
                   : isQtyPhase      ? '75%'
                   : '100%',
              bgcolor: theme.palette.success.main,
              borderRadius: 1,
              transition: 'width 0.55s ease',
            }} />
          </Box>

          {/* Node 1 — Location */}
          <Box sx={{ position: 'absolute', left: needsQtyConfirm ? 'calc(25% - 20px)' : 'calc(33% - 20px)', top: 0, width: 40 }}>
            <Box sx={{
              width: 40, height: 40, borderRadius: '50%',
              bgcolor: isLocationPhase ? 'var(--accent)' : theme.palette.success.main,
              border: `2.5px solid ${isLocationPhase ? 'var(--accent)' : theme.palette.success.main}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.3s, border-color 0.3s',
              ...(isLocationPhase && {
                '@keyframes pickNodePulse': {
                  '0%':   { boxShadow: '0 0 0 0 rgba(255,107,43,0.55)' },
                  '70%':  { boxShadow: '0 0 0 10px rgba(255,107,43,0)' },
                  '100%': { boxShadow: '0 0 0 0 rgba(255,107,43,0)' },
                },
                animation: 'pickNodePulse 1.3s ease-out infinite',
              }),
            }}>
              {isLocationPhase ? <MapPin size={18} color="white" /> : <CheckCircle size={18} color="white" />}
            </Box>
          </Box>
          <Box sx={{ position: 'absolute', left: needsQtyConfirm ? 'calc(25% - 50px)' : 'calc(33% - 50px)', top: 48, width: 100, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 9, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em', color: isLocationPhase ? 'var(--accent)' : theme.palette.success.main, mb: 0.5, transition: 'color 0.3s' }}>
              {isLocationPhase ? 'Scan Location' : '✓ Confirmed'}
            </Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 500, fontFamily: 'monospace', color: 'text.primary' }}>
              {currentItem.location_code}
            </Typography>
          </Box>

          {/* Node 2 — Product */}
          <Box sx={{ position: 'absolute', left: needsQtyConfirm ? 'calc(50% - 20px)' : 'calc(66% - 20px)', top: 0, width: 40 }}>
            <Box sx={{
              width: 40, height: 40, borderRadius: '50%',
              bgcolor: isLocationPhase ? 'background.paper' : isProductPhase ? 'var(--accent)' : theme.palette.success.main,
              border: `2.5px solid ${isLocationPhase ? theme.palette.divider : isProductPhase ? 'var(--accent)' : theme.palette.success.main}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.3s, border-color 0.3s',
              ...(isProductPhase && {
                '@keyframes pickNodePulse': {
                  '0%':   { boxShadow: '0 0 0 0 rgba(255,107,43,0.55)' },
                  '70%':  { boxShadow: '0 0 0 10px rgba(255,107,43,0)' },
                  '100%': { boxShadow: '0 0 0 0 rgba(255,107,43,0)' },
                },
                animation: 'pickNodePulse 1.3s ease-out infinite',
              }),
            }}>
              {isLocationPhase
                ? <Package size={18} color={theme.palette.text.disabled} />
                : isProductPhase
                ? <Package size={18} color="white" />
                : <CheckCircle size={18} color="white" />}
            </Box>
          </Box>
          <Box sx={{ position: 'absolute', left: needsQtyConfirm ? 'calc(50% - 50px)' : 'calc(66% - 50px)', top: 48, width: 100, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 9, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em', color: isLocationPhase ? 'text.disabled' : isProductPhase ? 'var(--accent)' : theme.palette.success.main, mb: 0.5, transition: 'color 0.3s' }}>
              {isLocationPhase ? 'Up next' : isProductPhase ? 'Scan Item' : '✓ Confirmed'}
            </Typography>

              <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'text.primary', lineHeight: 1.3 }} noWrap>
                {currentItem.product_title}
              </Typography>
               {(currentItem.unit_ids ?? []).length > 0 && (
                <Box sx={{ mt: 0.5, display: 'flex', justifyContent: 'center' }}>
                  <Box sx={{ fontSize: 9, px: 0.75, py: 0.25, border: '0.5px solid', borderColor: 'var(--accent)', borderRadius: '3px', fontFamily: 'monospace', color: 'var(--accent-text)', bgcolor: 'background.paper' }}>
                    {currentItem.unit_ids![0]}
                  </Box>
                </Box>
              )}
            </Box>

          {/* Node 3 — Qty confirm (only when qty > 1) */}
          {needsQtyConfirm && (
            <>
              <Box sx={{ position: 'absolute', left: 'calc(75% - 20px)', top: 0, width: 40 }}>
                <Box sx={{
                  width: 40, height: 40, borderRadius: '50%',
                  bgcolor: isQtyPhase ? 'var(--accent)' : 'background.paper',
                  border: `2.5px solid ${isQtyPhase ? 'var(--accent)' : theme.palette.divider}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.3s, border-color 0.3s',
                  ...(isQtyPhase && {
                    '@keyframes pickNodePulse': {
                      '0%':   { boxShadow: '0 0 0 0 rgba(255,107,43,0.55)' },
                      '70%':  { boxShadow: '0 0 0 10px rgba(255,107,43,0)' },
                      '100%': { boxShadow: '0 0 0 0 rgba(255,107,43,0)' },
                    },
                    animation: 'pickNodePulse 1.3s ease-out infinite',
                  }),
                }}>
                  <Hash size={18} color={isQtyPhase ? 'white' : theme.palette.text.disabled} />
                </Box>
              </Box>
              <Box sx={{ position: 'absolute', left: 'calc(75% - 50px)', top: 48, width: 100, textAlign: 'center' }}>
                <Typography sx={{ fontSize: 9, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em', color: isQtyPhase ? 'var(--accent)' : 'text.disabled', mb: 0.5, transition: 'color 0.3s' }}>
                  {isQtyPhase ? 'Confirm Qty' : 'Up next'}
                </Typography>
                <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'text.primary' }}>
                  ×{currentItem.quantity}
                </Typography>
              </Box>
            </>
          )}
          </Box>
        </Paper>

      {/* PRODUCT INFO CARD — visible during product_scan + qty_confirm phases */}
      {(isProductPhase || isQtyPhase) && (
        <Paper variant="outlined" sx={{ mx: 2, mt: 1.5, borderRadius: 2, overflow: 'hidden' }}>
          <Box sx={{ p: 1.5, display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
            {currentItem.image_url ? (
              <Box
                component="img"
                src={currentItem.image_url}
                alt={currentItem.product_title}
                sx={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }}
              />
            ) : (
              <Box sx={{ width: 56, height: 56, borderRadius: 1, bgcolor: 'action.hover', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Package size={22} color="var(--ink-4)" />
              </Box>
            )}
            {/* Details */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }} noWrap>
                {currentItem.product_title}
              </Typography>
              {currentItem.variant_title && (
                <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.25 }} noWrap>
                  {currentItem.variant_title}
                </Typography>
              )}
              {/* Location */}
              <Box sx={{ mt: 0.75, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <MapPin size={11} color="var(--accent)" />
                <Typography sx={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--accent-text)', fontWeight: 500 }}>
                  {currentItem.location_code}
                </Typography>
              </Box>
              {/* LSU- unit IDs */}
              {(currentItem.unit_ids ?? []).length > 0 && (
                <Box sx={{ mt: 0.75 }}>
                  <Typography sx={{ fontSize: 9, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: '0.07em', mb: 0.5 }}>
                    LSU- codes for this pick
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {(currentItem.unit_ids ?? []).slice(0, 6).map((id) => (
                      <Box key={id} sx={{ fontSize: 9, px: 0.75, py: 0.25, border: '0.5px solid', borderColor: 'divider', borderRadius: '3px', fontFamily: 'monospace', color: 'text.secondary', bgcolor: 'background.paper' }}>
                        {id}
                      </Box>
                    ))}
                    {(currentItem.unit_ids ?? []).length > 6 && (
                      <Box sx={{ fontSize: 9, px: 0.75, py: 0.25, border: '0.5px solid', borderColor: 'divider', borderRadius: '3px', color: 'text.disabled', bgcolor: 'background.paper' }}>
                        +{(currentItem.unit_ids ?? []).length - 6} more
                      </Box>
                    )}
                  </Box>
                </Box>
              )}
              {currentItem.sku && (
                <Typography sx={{ fontSize: 9, color: 'text.disabled', fontFamily: 'monospace', mt: 0.75 }}>
                  SKU: {currentItem.sku}
                </Typography>
              )}
            </Box>
          </Box>
        </Paper>
      )}
      
      {/* ROUTE + MAP — orientation only. Fills the remaining height (flex: 1,
          minHeight: 0) so it never pushes the scan controls below the fold;
          controls stay outside this region. */}
      <Box
        component="section"
        aria-label="Pick route map"
        sx={{ mx: 2, mt: 1.5, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1 }}
      >
        <Box
          component="ol"
          aria-label="Pick route"
          sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', rowGap: 0.5 }}
        >
          {remainingRoute.map((code) => (
            <Box
              component="li"
              key={code}
              aria-current={code === currentLocationCode ? 'location' : undefined}
              sx={{
                fontSize: 12,
                fontFamily: 'monospace',
                fontWeight: code === currentLocationCode ? 600 : 400,
                color: code === currentLocationCode ? 'var(--accent)' : 'var(--ink-3)',
                '&:not(:first-of-type)::before': {
                  content: '"→"',
                  mx: 0.75,
                  color: 'var(--ink-4)',
                },
              }}
            >
              {code}
            </Box>
          ))}
        </Box>

        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            position: 'relative',
            border: '1px solid var(--rule)',
            borderRadius: '8px',
            bgcolor: 'var(--bg-2)',
            overflow: 'hidden',
          }}
        >
          {floorZones && floorZones.length > 0 ? (
            <IsometricCanvas
              zones={floorZones}
              selectedLocationCode={currentLocationCode}
              inspectableLocationCodes={inspectableCodes}
              operationalStateByLocation={routeStateByLocation}
              showLegend={false}
              showControls={false}
              disablePan
              autoFit
            />
          ) : (
            <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
              <Typography role="status" sx={{ fontSize: 12, color: 'var(--ink-4)' }}>
                Floor map unavailable.
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* SCAN AREA */}
      <Box sx={{ mx: 2, mt: 1.5, mb: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>

        {scanError && (
          <Alert severity="error" sx={{ borderRadius: 2, py: 0.5 }}>{scanError}</Alert>
        )}

        {/* LOCATION SCAN INPUT */}
        {isLocationPhase && (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              inputRef={locationInputRef}
              fullWidth
              size="small"
              type="text"
              placeholder="Scan bin barcode or type location code"
              disabled={scanProcessing}
              value={locationInput}
              onChange={(e) => { setLocationInput(e.target.value); onInputChange(); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && locationInput.trim()) {
                  const val = locationInput.trim();
                  setLocationInput('');
                  handleLocationScan(val);
                }
              }}
              helperText="Scanner auto-submits · manual entry: press Enter"
              autoComplete="off"
            />
            {locationInput.trim() && (
              <Button
                variant="contained"
                onClick={() => {
                  const val = locationInput.trim();
                  setLocationInput('');
                  handleLocationScan(val);
                }}
                sx={{
                  bgcolor: 'var(--accent)', borderRadius: '6px', fontWeight: 600,
                  '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                  flexShrink: 0,
                }}
              >
                Scan
              </Button>
            )}
          </Box>
        )}

        {/* PRODUCT SCAN INPUT */}
        {isProductPhase && (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              inputRef={productInputRef}
              fullWidth
              size="small"
              type="text"
              placeholder="Scan product barcode or type barcode value"
              disabled={scanProcessing}
              value={productInput}
              onChange={(e) => { setProductInput(e.target.value); onInputChange(); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && productInput.trim()) {
                  const val = productInput.trim();
                  setProductInput('');
                  handleProductScan(val).catch((err: unknown) => {
                    const msg = (err as any)?.response?.data?.error ?? (err instanceof Error ? err.message : 'Scan failed.');
                    setScanError(msg);
                  });
                }
              }}
              helperText="Scanner auto-submits · manual entry: press Enter"
              autoComplete="off"
            />
            {productInput.trim() && (
              <Button
                variant="contained"
                disabled={scanProcessing}
                onClick={() => {
                  const val = productInput.trim();
                  setProductInput('');
                  handleProductScan(val).catch((err: unknown) => {
                    const msg = (err as any)?.response?.data?.error ?? (err instanceof Error ? err.message : 'Scan failed.');
                    setScanError(msg);
                  });
                }}
                sx={{
                  bgcolor: 'var(--accent)', borderRadius: '6px', fontWeight: 600,
                  '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                  flexShrink: 0,
                }}
              >
                {scanProcessing ? '…' : 'Scan'}
              </Button>
            )}
          </Box>
        )}

        {/* QTY CONFIRM INPUT */}
        {isQtyPhase && (
          <Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                inputRef={qtyInputRef}
                fullWidth
                size="small"
                type="number"
                placeholder={`Count and enter qty (expected: ${currentItem.quantity})`}
                disabled={scanProcessing}
                value={qtyInput}
                onChange={(e) => setQtyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && qtyInput.trim()) handleQtyConfirm();
                }}
                inputProps={{ min: 1 }}
                helperText={`Expected ${currentItem.quantity} unit${currentItem.quantity > 1 ? 's' : ''} — count before confirming`}
                autoComplete="off"
              />
              <Button
                variant="contained"
                disabled={scanProcessing || !qtyInput.trim()}
                onClick={handleQtyConfirm}
                sx={{
                  bgcolor: 'var(--accent)', borderRadius: '6px', fontWeight: 600,
                  '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                  flexShrink: 0,
                }}
              >
                {scanProcessing ? '…' : 'Confirm'}
              </Button>
            </Box>
          </Box>
        )}

        {/* REPORT PROBLEM */}
        <Button
          variant="outlined"
          fullWidth
          size="large"
          startIcon={<AlertTriangle size={18} />}
          onClick={openExceptionDialog}
          sx={{
            borderRadius: '6px', fontWeight: 600,
            borderColor: 'var(--accent-border)', color: 'var(--accent-text)',
            '&:hover': { borderColor: 'var(--accent)', bgcolor: 'var(--accent-ghost)' },
          }}
        >
          Report problem
        </Button>

      </Box>

      {/* EXCEPTION DIALOG — non-dismissible (Playbook §3) */}
      <Dialog open={exceptionDialog} onClose={() => undefined} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 600, fontSize: 16 }}>Report Problem</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {currentItem?.product_title}
            {currentItem?.variant_title ? ` · ${currentItem.variant_title}` : ''}
          </Typography>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mb: 2 }}>
            {(Object.keys(EXCEPTION_LABELS) as ExceptionType[]).map((type) => (
              <Button
                key={type}
                variant={exceptionType === type ? 'contained' : 'outlined'}
                fullWidth
                size="small"
                onClick={() => { setExceptionType(type); setExceptionError(null); }}
                sx={{
                  justifyContent: 'flex-start',
                  borderRadius: '6px',
                  fontWeight: exceptionType === type ? 600 : 400,
                  fontSize: 12,
                  bgcolor:     exceptionType === type ? 'var(--accent)' : 'transparent',
                  borderColor: exceptionType === type ? 'var(--accent)' : 'divider',
                  color:       exceptionType === type ? 'var(--accent-ink)' : 'text.primary',
                  '&:hover': {
                    bgcolor:     exceptionType === type ? 'var(--accent)' : 'action.hover',
                    opacity:     exceptionType === type ? 0.88 : 1,
                    borderColor: exceptionType === type ? 'var(--accent)' : 'divider',
                  },
                }}
              >
                {EXCEPTION_LABELS[type]}
              </Button>
            ))}
          </Box>

          {exceptionType && QTY_REQUIRED.includes(exceptionType) && (
            <TextField
              label="Quantity found"
              type="number"
              size="small"
              fullWidth
              value={exceptionQty}
              onChange={(e) => setExceptionQty(e.target.value)}
              inputProps={{ min: 0, max: currentItem ? currentItem.quantity - 1 : 99 }}
              sx={{ mb: 1.5 }}
            />
          )}

          {exceptionType && NOTES_REQUIRED.includes(exceptionType) && (
            <TextField
              label="Notes (required)"
              size="small"
              fullWidth
              multiline
              rows={2}
              value={exceptionNotes}
              onChange={(e) => setExceptionNotes(e.target.value)}
              sx={{ mb: 1.5 }}
            />
          )}

          {exceptionError && (
            <Alert severity="error" sx={{ borderRadius: 2 }}>{exceptionError}</Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          {/* Miscount escape hatch — ghost pill, subdued (Playbook §3) */}
          <Button
            onClick={() => setExceptionDialog(false)}
            sx={{
              color: 'text.secondary', fontWeight: 400, fontSize: 12,
              borderRadius: '6px', border: '0.5px solid var(--accent-border)',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleReportException}
            disabled={!exceptionType || exceptionProcessing}
            sx={{
              borderRadius: '6px', fontWeight: 600,
              bgcolor: 'var(--accent)',
              '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
            }}
          >
            {exceptionProcessing ? 'Reporting…' : 'Confirm Exception'}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}