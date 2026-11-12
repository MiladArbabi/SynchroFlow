// modules/wms/src/ui/pages/PickSessionPage.tsx
import { useState, useCallback, useRef, useEffect, useMemo, type ReactNode, type RefObject } from 'react';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import { Package } from 'lucide-react';
import { useScanSourceDetector } from '../hooks/useScanSourceDetector.js';
import { WmsSessionBrief } from '../components/WmsSessionBrief.js';
import { WMS_TIER1_ACTION_SX } from './CountingSessionPage.js';
import { WmsConnectionBadge } from '../components/WmsConnectionBadge.js';
import { ExecutionSessionShell, type ExecutionProgressTone } from '../components/ExecutionSessionShell.js';
import {
  ReceiveActions,
  ReceiveCta,
  ReceiveExitSheet,
  ReceiveFactStrip,
  ReceiveFooterButton,
  ReceiveItemLine,
  ReceiveStatusLine,
  ReceiveTaskHeading,
  receiveMonoSx,
} from '../components/receive/ReceiveSessionShell';
import { IsometricCanvas } from '@lasyncro/shared/ui';
import type { OperationalMapState, WarehouseZone } from '@lasyncro/shared/ui';

/**
 * PICK SESSION PAGE — WEBAPP
 * --------------------------
 * Playbook contract: Brief → location_scan → product_scan → [qty_confirm] → finish → done
 *
 * SF-PICK-P2-UI-01 — rendered inside the shared ExecutionSessionShell to the
 * owner-approved Pick Session target. Owner decisions 4/7/8/9/12/13:
 *   - multi-unit count starts at ZERO; only the full required quantity is ever
 *     sent to /pick/scan; a lower count opens the EXISTING exception workflow
 *     with the entered count preserved (no new shortage semantics);
 *   - single unit advances only after /pick/scan resolves;
 *   - wrong scans and failures show inline and never advance or commit;
 *   - no summary review: finish is one explicit pick-complete call, and Done
 *     renders only after it succeeds. Pack-station handoff is NOT verified
 *     here (no station contract yet), so nothing claims a physical handoff.
 *
 * Per line item — two-scan confirm pattern:
 * 1. Brief        — batch summary (items, units), Start Picking CTA
 * 2. location_scan — ScanInput for bin barcode, client-side match against location_code
 * 3. product_scan  — ScanInput for product barcode, resolved via onResolveBarcode
 * 4. finish        — explicit Confirm pick complete (summary review removed, decision 7)
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

type SessionPhase = 'brief' | 'location_scan' | 'product_scan' | 'qty_confirm' | 'finish' | 'done';

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

/** Backend-confirmed outcome of one line in this session. */
interface PickResult {
  lineItem: LineItem;
  status: 'picked' | 'exception';
  exceptionType?: ExceptionType;
  /** Units the server recorded as picked (full qty, or quantity_found). */
  unitsPicked: number;
  /** Units reported missing (quantity_required − quantity_found). */
  unitsShort: number;
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


const units = (n: number) => `${n} unit${n === 1 ? '' : 's'}`;

/** Server message when present (axios-style), else the Error message, else fallback. */
function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { error?: unknown } } })?.response?.data;
  if (typeof data?.error === 'string' && data.error) return data.error;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** Large batches use the compact count only (decision 14). */
const MAX_PROGRESS_SEGMENTS = 12;

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
  // Desktop puts the map beside the task; smaller viewports keep the scan
  // controls first and the map below them (decision 12).
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const { onInputChange, detectSourceAndReset, reset: resetScanDetector } = useScanSourceDetector();
  // PICK-BATCH-IDENTITY-CONTINUITY-01: same first-8 batch token as Order Flow,
  // Batch Detail and WMS batch surfaces; display only — pickBatchId stays the full UUID.
  const batchShort = pickBatchId.slice(0, 8).toUpperCase();

  const locationInputRef  = useRef<HTMLInputElement>(null);
  const productInputRef   = useRef<HTMLInputElement>(null);
  // WEB-PICK-UNIT-01: carries LSU- unit ID from product_scan into qty_confirm path.
  const resolvedUnitIdRef = useRef<string | undefined>(undefined);
  /**
   * SF-PICK-P2 — synchronous scanner lock. React state is not an atomic lock:
   * two rapid hardware scans can arrive before a rerender. Only one resolve or
   * /pick/scan runs at a time; duplicates are dropped, never queued.
   */
  const scanInFlightRef = useRef(false);
  /**
   * C3 — synchronous guards for the two non-scan writes. React batches state,
   * so `disabled` alone cannot stop a second submit inside one update; a
   * duplicate success would run advanceOrFinish twice and skip a reservation.
   * Released on settle so a failed attempt can be retried.
   */
  const exceptionInFlightRef = useRef(false);
  const completeInFlightRef = useRef(false);

  const [phase, setPhase]               = useState<SessionPhase>(
    () => (resumePicking ? 'location_scan' : 'brief'),
  );
  /**
   * Totals on Done cover this session only when execution was resumed
   * (lineItems then hold remaining work only; B0 will supply history).
   * Set at mount OR when canonical `picking` status arrives later (C2).
   */
  const [resumedSession, setResumedSession] = useState(resumePicking);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [locationInput, setLocationInput] = useState('');
  const [productInput,  setProductInput]  = useState('');
  /** Decision 4 — multi-unit count starts at zero and is never prefilled. */
  const [qtyCount,       setQtyCount]      = useState(0);
  const [scanError,      setScanError]     = useState<string | null>(null);
  const [scanProcessing, setScanProcessing] = useState(false);
  const [lastAck,        setLastAck]       = useState<string | null>(null);
  const [exitOpen,       setExitOpen]      = useState(false);

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
  const isExecution = phase === 'location_scan' || phase === 'product_scan' || phase === 'qty_confirm';

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
    if (exitOpen || exceptionDialog) return;
    if (phase === 'location_scan') setTimeout(() => locationInputRef.current?.focus(), 50);
    if (phase === 'product_scan')  setTimeout(() => productInputRef.current?.focus(),  50);
  }, [phase, currentIndex, scanError, exitOpen, exceptionDialog]);

  // ── Advance / finish ───────────────────────────────────────
  const advanceOrFinish = useCallback(() => {
    setLocationInput('');
    setProductInput('');
    setQtyCount(0);
    setScanError(null);
    resetScanDetector();
    resolvedUnitIdRef.current = undefined; // WEB-PICK-UNIT-01: clear between items
    if (currentIndex >= lineItems.length - 1) {
      setPhase('finish');
    } else {
      setCurrentIndex(i => i + 1);
      setPhase('location_scan');
    }
  }, [currentIndex, lineItems.length, resetScanDetector]);

  // ── Resume (Brief → location_scan, already-picking batch) ──
  // One-way and Brief-only: never touches an execution phase, and never
  // pre-empts an in-flight Start Picking, whose own result decides.
  useEffect(() => {
    if (resumePicking && phase === 'brief' && !startingPickRef.current) {
      setResumedSession(true);
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
  // Client match only; the reservation's location stays authoritative at
  // /pick/scan. A mismatch changes nothing.
  const handleLocationScan = useCallback((value: string) => {
    if (!currentItem) return;
    setScanError(null);
    if (locationMatches(value, currentItem.location_code)) {
      setLastAck(null);
      setPhase('product_scan');
    } else {
      setScanError(`That label is ${value.trim().toUpperCase()}. Your location is ${currentItem.location_code} — nothing changed.`);
    }
  }, [currentItem]);

  const recordPicked = useCallback((item: LineItem) => {
    setPickResults(prev => [...prev, {
      lineItem: item, status: 'picked', unitsPicked: item.quantity, unitsShort: 0,
    }]);
    setLastAck(`${item.product_title} · ${units(item.quantity)} picked`);
  }, []);

  // ── Product scan ───────────────────────────────────────────
  const handleProductScan = useCallback(async (value: string) => {
    if (!currentItem || scanInFlightRef.current) return;
    scanInFlightRef.current = true;
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
          setQtyCount(0);
          setPhase('qty_confirm');
        } else {
          // Single unit: the scan is the pick, accepted only when /pick/scan resolves.
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
          recordPicked(currentItem);
          advanceOrFinish();
        }
      } else {
        setScanError('Wrong item — barcode does not match. Check you are at the right bin.');
      }
    } catch (err: unknown) {
      setScanError(errorMessage(err, 'Scan failed. Try again.'));
    } finally {
      scanInFlightRef.current = false;
      setScanProcessing(false);
    }
  }, [currentItem, onResolveBarcode, onConfirmScan, detectSourceAndReset, advanceOrFinish, recordPicked]);

  // ── Exception report (existing GH-1049 workflow) ───────────
  const openExceptionDialog = useCallback((prefillFound?: number) => {
    setExceptionEventId(newEventId());
    setExceptionType(null);
    // Decision 13 / F2 — a counted shortfall keeps the operator's count.
    setExceptionQty(prefillFound !== undefined ? String(prefillFound) : '');
    setExceptionNotes('');
    setExceptionError(null);
    setExceptionDialog(true);
  }, []);

  // ── Quantity confirm (multi-unit) ──────────────────────────
  // Only the FULL required quantity is ever sent; a lower count is a
  // shortfall and goes to the existing exception workflow instead.
  const handleQtyConfirm = useCallback(() => {
    if (!currentItem || scanInFlightRef.current) return;
    if (qtyCount !== currentItem.quantity) {
      openExceptionDialog(qtyCount);
      return;
    }
    scanInFlightRef.current = true;
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
        recordPicked(currentItem);
        advanceOrFinish();
      })
      .catch((err: unknown) => {
        setScanError(errorMessage(err, 'Confirm failed. Try again.'));
      })
      .finally(() => {
        scanInFlightRef.current = false;
        setScanProcessing(false);
      });
  }, [currentItem, qtyCount, onConfirmScan, detectSourceAndReset, advanceOrFinish, recordPicked, openExceptionDialog]);

  const handleReportException = useCallback(() => {
    if (!currentItem || !exceptionType || exceptionInFlightRef.current) return;
    if (QTY_REQUIRED.includes(exceptionType) && !exceptionQty.trim()) {
      setExceptionError('Enter the quantity found.');
      return;
    }
    if (NOTES_REQUIRED.includes(exceptionType) && !exceptionNotes.trim()) {
      setExceptionError('Notes are required for this exception type.');
      return;
    }
    exceptionInFlightRef.current = true;
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
        setPickResults(prev => [...prev, {
          lineItem: currentItem,
          status: 'exception',
          exceptionType,
          unitsPicked: qtyFound,
          unitsShort: currentItem.quantity - qtyFound,
        }]);
        setLastAck(`${currentItem.product_title} · ${EXCEPTION_LABELS[exceptionType].toLowerCase()} reported`);
        setExceptionDialog(false);
        setExceptionType(null);
        setExceptionQty('');
        setExceptionNotes('');
        advanceOrFinish();
      })
      .catch((err: unknown) => {
        setExceptionError(errorMessage(err, 'Exception report failed. Try again.'));
      })
      .finally(() => {
        exceptionInFlightRef.current = false;
        setExceptionProcessing(false);
      });
  }, [currentItem, exceptionType, exceptionQty, exceptionNotes, exceptionEventId, onReportException, advanceOrFinish]);

  // ── Pick complete ──────────────────────────────────────────
  // Done renders only after the backend accepts completion (decision 7).
  const handlePickComplete = useCallback(() => {
    if (completeInFlightRef.current) return;
    completeInFlightRef.current = true;
    setCompletingPick(true);
    setCompletionError(null);
    onPickComplete()
      .then(() => {
        setPhase('done');
      })
      .catch((err: unknown) => {
        setCompletionError(errorMessage(err, 'Pick complete failed. Retry when connection is restored.'));
      })
      .finally(() => {
        completeInFlightRef.current = false;
        setCompletingPick(false);
      });
  }, [onPickComplete]);

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

  if (isExecution && !currentItem) return null;

  // ── Derived presentation ───────────────────────────────────
  const n = lineItems.length;
  const unitsPicked = pickResults.reduce((sum, r) => sum + r.unitsPicked, 0);
  const unitsShort  = pickResults.reduce((sum, r) => sum + r.unitsShort, 0);
  const flaggedCount = pickResults.filter(r => r.status === 'exception').length;

  const bars: ExecutionProgressTone[] = n <= MAX_PROGRESS_SEGMENTS
    ? lineItems.map((_, index) => {
        const result = pickResults[index];
        if (result) return result.status === 'exception' ? 'flagged' : 'done';
        return isExecution && index === currentIndex ? 'current' : 'idle';
      })
    : [];

  const positionLabel = isExecution ? `Item ${currentIndex + 1} of ${n}` : `${n} of ${n} items`;
  const progressLabel = `${pickResults.length} of ${n} picked`;

  const leaveSession = () => {
    setExitOpen(false);
    onComplete();
  };

  // ── Map (orientation only; P6 owns map integration) ────────
  const mapRegion: ReactNode = isExecution ? (
    // ROUTE + MAP — orientation only; never drives session state.
    <Box
      component="section"
      aria-label="Pick route map"
      sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1 }}
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
              ...receiveMonoSx,
              fontWeight: code === currentLocationCode ? 600 : 400,
              color: code === currentLocationCode ? 'var(--accent-text)' : 'var(--ink-3)',
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
          // The canvas keeps a usable floor; the region itself stays flexible.
          minHeight: { xs: 220, md: 360 },
          position: 'relative',
          border: '1px solid var(--rule)',
          borderRadius: '12px',
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
          <Box sx={{ height: '100%', minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
            <Typography role="status" sx={{ fontSize: 12, color: 'var(--ink-4)' }}>
              Floor map unavailable. Follow the location label {currentLocationCode}.
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  ) : null;

  // ── Task column ────────────────────────────────────────────
  const productChip = currentItem ? (
    <ReceiveItemLine
      media={
        currentItem.image_url ? (
          <Box
            component="img"
            src={currentItem.image_url}
            alt=""
            sx={{ width: 48, height: 48, objectFit: 'cover', borderRadius: '10px', flexShrink: 0 }}
          />
        ) : (
          <Box sx={{ width: 48, height: 48, borderRadius: '10px', bgcolor: 'var(--bg-2)', flexShrink: 0, display: 'grid', placeItems: 'center' }}>
            <Package size={20} color="var(--ink-3)" />
          </Box>
        )
      }
      name={currentItem.variant_title ? `${currentItem.product_title} · ${currentItem.variant_title}` : currentItem.product_title}
      identity={
        <>
          {[currentItem.sku, `pick ${currentItem.quantity}`].filter(Boolean).join(' · ')}
          {(currentItem.unit_ids ?? []).length > 0 && (
            <Box component="span" sx={{ display: 'block' }}>
              {(currentItem.unit_ids ?? []).slice(0, 3).join(' · ')}
              {(currentItem.unit_ids ?? []).length > 3 ? ` +${(currentItem.unit_ids ?? []).length - 3} more` : ''}
            </Box>
          )}
        </>
      }
    />
  ) : null;

  const statusLine = (hint: ReactNode) =>
    scanError ? (
      <ReceiveStatusLine tone="error" role="alert">{scanError}</ReceiveStatusLine>
    ) : (
      <ReceiveStatusLine role="status">{lastAck ? `✓ ${lastAck}` : hint}</ReceiveStatusLine>
    );

  const scanField = (opts: {
    inputRef: RefObject<HTMLInputElement | null>;
    placeholder: string;
    value: string;
    setValue: (v: string) => void;
    submit: (v: string) => void;
  }) => (
    <TextField
      inputRef={opts.inputRef}
      fullWidth
      type="text"
      placeholder={opts.placeholder}
      disabled={scanProcessing}
      value={opts.value}
      onChange={(e) => { opts.setValue(e.target.value); onInputChange(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && opts.value.trim()) {
          const val = opts.value.trim();
          opts.setValue('');
          opts.submit(val);
        }
      }}
      autoComplete="off"
      inputProps={{ 'aria-label': opts.placeholder }}
      sx={{ '& .MuiInputBase-input': { ...receiveMonoSx, fontSize: { xs: 17, md: 20 }, py: { xs: 1.75, md: 2 } } }}
    />
  );

  let column: ReactNode = null;

  if (phase === 'location_scan' && currentItem) {
    column = (
      <>
        <ReceiveTaskHeading eyebrow="Go to location" title="Go to" accent={`${currentItem.location_code}.`} />
        {productChip}
        {scanField({
          inputRef: locationInputRef,
          placeholder: 'Scan bin barcode or type location code',
          value: locationInput,
          setValue: setLocationInput,
          submit: handleLocationScan,
        })}
        {statusLine('Scan the location label to confirm you are at the right shelf.')}
      </>
    );
  } else if (phase === 'product_scan' && currentItem) {
    column = (
      <>
        <ReceiveTaskHeading eyebrow="Scan item" title="Scan the" accent={`${currentItem.product_title.toLowerCase()}.`} />
        {productChip}
        {scanField({
          inputRef: productInputRef,
          placeholder: 'Scan product barcode or type barcode value',
          value: productInput,
          setValue: setProductInput,
          submit: (val) => { void handleProductScan(val); },
        })}
        {statusLine(
          scanProcessing
            ? 'Checking the scan…'
            : currentItem.quantity === 1
              ? 'One unit — the scan confirms the pick.'
              : `Take ${currentItem.quantity} from the shelf and scan one of them.`,
        )}
      </>
    );
  } else if (phase === 'qty_confirm' && currentItem) {
    const required = currentItem.quantity;
    const full = qtyCount === required;
    column = (
      <>
        <ReceiveTaskHeading eyebrow="Pick" title="Pick" accent={`${units(required)}.`} />
        {productChip}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '58px minmax(0,1fr) 58px', md: '76px minmax(0,1fr) 76px' }, gap: { xs: 1, md: 1.5 }, height: { xs: 58, md: 76 } }}>
          <Button
            aria-label="Remove one unit"
            disabled={scanProcessing || qtyCount <= 0}
            onClick={() => { setQtyCount(c => Math.max(0, c - 1)); setScanError(null); }}
            sx={{ borderRadius: '14px', border: '1px solid var(--rule-2)', color: 'var(--ink)', fontSize: 28, fontWeight: 300, minWidth: 0 }}
          >
            −
          </Button>
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 1, pt: { xs: 1.5, md: 2 }, borderRadius: '14px', border: '1px solid var(--rule-2)', bgcolor: 'var(--surface)' }}>
            <Box component="output" aria-label="Units counted" aria-live="polite" sx={{ fontSize: { xs: 34, md: 44 }, lineHeight: 1, color: 'var(--ink)' }}>
              {qtyCount}
            </Box>
            <Typography component="span" sx={{ fontSize: 15, color: 'var(--ink-3)' }}>of {required}</Typography>
          </Box>
          <Button
            aria-label="Add one unit"
            disabled={scanProcessing || qtyCount >= required}
            onClick={() => { setQtyCount(c => Math.min(required, c + 1)); setScanError(null); }}
            sx={{ borderRadius: '14px', border: '1px solid var(--rule-2)', color: 'var(--ink)', fontSize: 28, fontWeight: 300, minWidth: 0 }}
          >
            +
          </Button>
        </Box>
        {statusLine(
          full
            ? `That's all ${required} this order needs.`
            : `${required - qtyCount} fewer than the order needs — you'll report what happened.`,
        )}
        <ReceiveActions>
          <ReceiveCta
            tier={full ? 'primary' : 'secondary'}
            disabled={scanProcessing}
            onClick={handleQtyConfirm}
          >
            {scanProcessing ? 'Confirming…' : full ? `Confirm ${required} picked` : `Report ${qtyCount} of ${required}`}
          </ReceiveCta>
        </ReceiveActions>
      </>
    );
  } else if (phase === 'finish') {
    column = (
      <>
        <ReceiveTaskHeading
          eyebrow="Finish"
          title="All items"
          accent="processed."
          sub="Take the batch to Pack. Completion is recorded when you confirm."
        />
        <ReceiveFactStrip
          facts={[
            { label: 'Picked', value: unitsPicked },
            { label: 'Short', value: unitsShort, highlight: unitsShort > 0 },
            { label: 'Flagged', value: flaggedCount },
          ]}
        />
        {completionError ? (
          <ReceiveStatusLine tone="error" role="alert">{completionError}</ReceiveStatusLine>
        ) : (
          <ReceiveStatusLine role="status">
            {flaggedCount > 0
              ? `${flaggedCount} item${flaggedCount === 1 ? '' : 's'} reported — routed to Problem Center.`
              : 'Every item was picked in full.'}
          </ReceiveStatusLine>
        )}
        <ReceiveActions>
          <ReceiveCta disabled={completingPick} onClick={handlePickComplete}>
            {completingPick ? 'Confirming…' : 'Confirm pick complete'}
          </ReceiveCta>
        </ReceiveActions>
      </>
    );
  } else if (phase === 'done') {
    column = (
      <>
        <ReceiveTaskHeading eyebrow="Complete" eyebrowTone="ok" title="Pick" accent="complete" />
        <Box data-testid="pick-done-facts">
          <ReceiveFactStrip
            facts={[
              { label: 'Picked', value: unitsPicked },
              { label: 'Short', value: unitsShort, highlight: unitsShort > 0 },
              { label: 'Flagged', value: flaggedCount },
            ]}
          />
        </Box>
        <ReceiveStatusLine role="status">
          {resumedSession
            ? 'Batch ready for pack. Totals cover this session; picks confirmed before you resumed are not included.'
            : `${n} item${n === 1 ? '' : 's'} processed. Batch ready for pack.`}
        </ReceiveStatusLine>
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap' }}>
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
      </>
    );
  }

  return (
    <ExecutionSessionShell
      workflowLabel="PICK"
      workflowAsHeading
      testId="pick-session-shell"
      backAriaLabel="Back to pick session"
      headerAccessory={
        isOnline !== undefined ? <WmsConnectionBadge isOnline={isOnline} queuedCount={queuedCount} /> : undefined
      }
      sourceLabel={`Batch ${batchShort}`}
      positionLabel={positionLabel}
      progressLabel={progressLabel}
      bars={bars}
      onExit={phase === 'done' ? undefined : () => setExitOpen(true)}
      exitDisabled={scanProcessing || completingPick || exceptionProcessing}
      map={mapRegion}
      desktopMapLayout={isDesktop && mapRegion !== null}
      footer={
        isExecution ? (
          <ReceiveFooterButton onClick={() => openExceptionDialog()} disabled={scanProcessing}>
            Report problem
          </ReceiveFooterButton>
        ) : undefined
      }
      overlay={
        <>
          <ReceiveExitSheet
            open={exitOpen}
            eyebrow="Leave pick"
            title="Progress is"
            accent="saved."
            body={`Confirmed picks stay recorded. Batch ${batchShort} stays assigned to you — resume it from Warehouse Operations.`}
            onDismiss={() => setExitOpen(false)}
          >
            <ReceiveCta onClick={() => setExitOpen(false)}>Keep picking</ReceiveCta>
            <ReceiveCta tier="secondary" onClick={leaveSession}>Back to Warehouse</ReceiveCta>
          </ReceiveExitSheet>

          {/* EXCEPTION DIALOG — existing GH-1049 workflow, non-dismissible (Playbook §3).
              P3 owns its redesign; behaviour is unchanged here. */}
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
              {/* Miscount escape hatch — returns to the same step, count intact. */}
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
                  color: 'var(--accent-ink)',
                  '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                }}
              >
                {exceptionProcessing ? 'Reporting…' : 'Confirm Exception'}
              </Button>
            </DialogActions>
          </Dialog>
        </>
      }
    >
      {column}
    </ExecutionSessionShell>
  );
}
