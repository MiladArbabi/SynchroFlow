import { matchesPickReceipt, type PendingPickOperation, type PickPendingDraft, type PickReceipt } from '../pickPendingRecovery.js';
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
  InputAdornment,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import { Package } from 'lucide-react';
import { useScanSourceDetector } from '../hooks/useScanSourceDetector.js';
import { WmsSessionBrief } from '../components/WmsSessionBrief.js';
import { ScanProductCard } from '../components/ScanProductCard.js';
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
import type { DestinationHighlight, WarehouseZone } from '@lasyncro/shared/ui';

/**
 * PICK SESSION PAGE — WEBAPP
 * --------------------------
 * Playbook contract: Brief → location_scan → product_scan (inline count/confirm) → finish → done
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
  /** Order-line SKU snapshot. */
  sku: string | null;
  /** SF-PICK-UX-ADAPTIVE-01-PRODUCT-IDENTITY-001 — the allocation variant's current SKU. */
  variant_sku?: string | null;
  product_title: string;
  variant_title: string | null;
  quantity: number;
  location_code: string;
  /**
   * SF-PICK-LOCATION-TRUTH-01: server verdict that location_code is an active
   * pick bin. false (e.g. the warehouse root) blocks the stop; absent = unknown,
   * the server scan gate still decides.
   */
  location_pickable?: boolean;
  /**
   * SF-PICK-LOCATION-TRUTH-01: false for unbinned (warehouse-root) stock — no
   * location scan, no map position; the product scan comes first.
   */
  location_scan_required?: boolean;
  /**
   * SF-PICK-LOCATION-TRUTH-01 / SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-001:
   * 1 when eligible labelled units are at the location (one LSU scan verifies
   * product and location; the quantity is counted), else 0. Root and bins
   * alike. The server re-checks on every write.
   */
  unit_scan_required?: number;
  /**
   * SF-PICK-UX-ADAPTIVE-01-ACTIONABLE-ID-001: one eligible LSU for this exact
   * task from the server (same eligibility as unit_scan_required). Display
   * only — never verification; other eligible LSUs remain scannable.
   */
  scan_unit_id?: string | null;
  /** WEB-PICK-UNIT-01: variant image from Shopify sync; null when not synced. */
  image_url: string | null;
  /**
   * SF-WMS-SCAN-UX-01: the variant's product barcode, shown on the product
   * scan step when the server provides it. Display only; never sent.
   */
  barcode?: string | null;
  /** WEB-PICK-UNIT-01: stowed LSU- unit IDs for this variant; null on legacy path. */
  unit_ids: string[] | null;
}

export interface ConfirmScanParams {
  device_event_id?: string;
  /** Browser recovery snapshot; stripped by the host before HTTP submission. */
  recovery_item?: LineItem;
  lasyncro_line_item_id: string;
  lasyncro_variant_id: string;
  /** INV-RES-01: exact reservation task; undefined on legacy batches. */
  reservation_allocation_id?: string;
  location_code: string;
  quantity_confirmed: number;
  scan_source?: 'camera' | 'nfc' | 'usb' | 'bt' | 'manual';
  /** WEB-PICK-UNIT-01: LSU- unit ID from resolver; undefined on legacy barcode path. */
  lasyncro_unit_id?: string;
  /** SF-PICK-LOCATION-TRUTH-01: every unit label scanned for unbinned stock. */
  lasyncro_unit_ids?: string[];
}

/** SF-PICK-LOCATION-TRUTH-01 — server-confirmed location scan. */
export interface VerifyLocationParams {
  lasyncro_line_item_id: string;
  reservation_allocation_id?: string;
  location_code: string;
  scanned_value: string;
}

export interface ReportExceptionParams {
  /** Browser recovery snapshot; stripped by the host before HTTP submission. */
  recovery_item?: LineItem;
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
  /** SF-PICK-LOCATION-TRUTH-01: unit labels scanned for the found units (unbinned stock). */
  lasyncro_unit_ids?: string[];
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
  onResolveBarcode: (scannedValue: string) => Promise<{
    lasyncro_variant_id: string;
    lasyncro_unit_id?: string;
    /** Only unit_barcode proves that this exact unit was scanned. */
    resolution_method?: string;
  } | null>;
  onConfirmScan: (params: ConfirmScanParams) => Promise<void>;
  /**
   * SF-PICK-LOCATION-TRUTH-01 — server confirmation of the location scan.
   * Resolves only when the scanned label is the allocation's pick bin; the
   * map turns green only after it resolves. Absent = client label match only.
   */
  onVerifyLocation?: (params: VerifyLocationParams) => Promise<{ location_code: string }>;
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
  /**
   * SF-PICK-ASSIGN-01 — this batch was taken over with units already picked:
   * the operator must confirm they hold those items before any scan.
   */
  custodyAckRequired?: boolean;
  unitsPickedBeforeTakeover?: number;
  onAcknowledgeCustody?: () => Promise<void>;
  /**
   * SF-PICK-ASSIGN-01 C008 — online-only Pick. After a lost connection the
   * session pauses and calls this to resume: the host re-reads ownership
   * (read-only, never a claim) and the authoritative remaining work, updates
   * `lineItems`, and resolves with them. A rejection without an HTTP answer
   * keeps the session paused; an ownership refusal ends it.
   */
  pendingOperation?: PendingPickOperation | null;
  onRecoveryConfirmed?: (receipt: PickReceipt) => void | Promise<void>;
  onRevalidateSession?: () => Promise<LineItem[] | { lineItems: LineItem[]; outcome?: PickReceipt }>;
  /**
   * SF-PICK-UX-ADAPTIVE-01-CROSS-TAB-001 — synchronous read of the durable
   * pending Pick for this shop, operator and batch (shared by every tab).
   * Throws when it cannot be read; the session then refuses scans.
   */
  onCheckPendingPick?: () => PendingPickOperation | null;

  /**
   * SF-PICK-RESUME-GENERATION-001 — opening an already-started batch (resume)
   * verifies ownership with the server before any scanner renders: the host
   * obtains the current generation through the resume-only claim (never a
   * claim or takeover). A rejection is shown as the server's refusal; it is
   * never retried automatically. Omitted: no verification gate.
   */
  onVerifyResume?: () => Promise<void>;
}

/** SF-PICK-RESUME-GENERATION-001 — truthful copy for the resume-only refusals. */
const RESUME_REFUSALS: Record<string, { title: string; description: string }> = {
  PICK_OWNERSHIP_REVOKED: {
    title: 'Batch held by another picker',
    description: 'The server reports that another picker now owns this batch. Nothing was recorded from this screen.',
  },
  PICK_BATCH_NOT_PICKING: {
    title: 'Batch is no longer being picked',
    description: 'The server reports that this batch is not in picking. Nothing was recorded from this screen.',
  },
};

/** C008 — no HTTP answer (or the host's PICK_CONNECTION_LOST): nothing was confirmed. */
function isConnectionLost(err: unknown): boolean {
  const e = err as { code?: unknown; request?: unknown; isAxiosError?: unknown; response?: { data?: { code?: unknown } } } | null;
  if (!e || typeof e !== 'object') return false;
  if (e.code === 'PICK_CONNECTION_LOST' || e.response?.data?.code === 'PICK_CONNECTION_LOST') return true;
  return (e.request !== undefined || e.isAxiosError === true) && !e.response;
}

/** A sent Pick is uncertain unless the API confirms a definitive business refusal.
 * A proxy/server error can arrive after commit, even with an HTTP response.
 * Already-recorded responses reaching this page still require reconciliation:
 * the online transport consumes only the acknowledgement attributed to us.
 */
/**
 * SF-PICK-UX-ADAPTIVE-01-PRODUCT-IDENTITY-001 — SKU shown on the Pick card: the
 * order-line snapshot when populated, otherwise the variant's current SKU,
 * otherwise none. Native Pick applies the same precedence. Never invented.
 */
export function pickDisplaySku(item: { sku?: string | null; variant_sku?: string | null }): string | null {
  return item.sku?.trim() || item.variant_sku?.trim() || null;
}

export function isUncertainPickOutcome(err: unknown): boolean {
  if (isConnectionLost(err)) return true;
  const response = (err as { response?: { status?: unknown; data?: { code?: unknown; error?: unknown } } } | null)?.response;
  const code = response?.data?.code;
  if (code === 'PICK_SCAN_OUTCOME_UNCERTAIN' || code === 'PICK_SCAN_ALREADY_RECORDED') return true;
  const status = response?.status;
  return !(typeof status === 'number' && [400, 401, 403, 404, 409, 422].includes(status)
    && typeof response?.data?.error === 'string' && response.data.error.length > 0);
}

/** SF-PICK-A6B — sent, no answer: the server may have recorded it. Never "not recorded", never a re-scan. */
const UNCERTAIN_SCAN_MESSAGE =
  'Confirmation pending — this scan may already have been recorded. Do not scan this item; Picking checks with the server before continuing.';
/** SF-PICK-A6B — the connection failed before the scan was sent (barcode lookup): confirmed nothing recorded.
 *  Keeps the underlying cause visible (GH-1241 H1: a lookup failure is reported as a failure). */
const notSentScanMessage = (cause: string) =>
  `Connection lost (${cause}) — this scan was not sent, so nothing was recorded. Picking resumes when the connection is back.`;

/** Recovery probe cadence while paused (in addition to the browser's online event). */
const RECONNECT_PROBE_MS = 5_000;

/**
 * SF-WMS-SCAN-UX-01 — Brief steps from the batch's own stops: a bin-scan
 * instruction only when a stop is a bin; root (unbinned) stock is product-only.
 */
export function pickBriefSteps(items: readonly Pick<LineItem, 'location_scan_required' | 'unit_scan_required'>[]): string[] {
  const binStops = items.filter((li) => li.location_scan_required !== false).length;
  const rootStops = items.length - binStops;
  const labelled = items.some((li) => (li.unit_scan_required ?? 0) > 0);
  const steps =
    rootStops === 0
      ? ['At each stop, scan the bin label, then the product.']
      : binStops === 0
        ? ['At each stop, scan the product. No bin scan.']
        : [
            'Bin stops: scan the bin label, then the product.',
            'Stops not in a bin: scan the product only.',
          ];
  if (labelled) steps.push('Labelled units: scan each unit’s label.');
  return steps;
}

/** SF-PICK-ASSIGN-01 — the server refused a write because this session no longer owns the batch. */
const OWNERSHIP_LOST_CODES = new Set([
  'PICK_OWNERSHIP_REVOKED', 'PICK_GENERATION_STALE', 'PICK_GENERATION_REQUIRED', 'PICK_BATCH_NOT_PICKING',
]);
function pickOwnershipCode(err: unknown): string | null {
  const code = (err as { response?: { data?: { code?: unknown } } })?.response?.data?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * SF-PICK-UX-ADAPTIVE-01-FINALIZE-001 — the server says this batch is already
 * pick_complete (a previous completion request committed but its answer was lost).
 */
function isCommittedPickCompletion(err: unknown): boolean {
  const data = (err as { response?: { data?: { code?: unknown; status?: unknown } } })?.response?.data;
  return data?.code === 'PICK_BATCH_NOT_PICKING' && data?.status === 'pick_complete';
}

/** SF-PICK-LOCATION-TRUTH-01 — the server refused the scanned unit labels; nothing was recorded. */
function isUnitIdentityRefusal(err: unknown): boolean {
  return pickOwnershipCode(err)?.startsWith('PICK_UNIT_IDENTITY_') ?? false;
}
/** The server's authoritative label count from an identity refusal, if any. */
function unitsRequiredFrom(err: unknown): number | null {
  const n = (err as { response?: { data?: { units_required?: unknown } } })?.response?.data?.units_required;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
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

/** SF-PICK-LOCATION-TRUTH-01 — short copy for a stop that is not a pick bin. */
function blockedLocationMessage(code: string): string {
  return `${code} is not a pick bin. Stow this stock into a pick bin, then use Report problem.`;
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
  lineItems: sourceLineItems,
  onComplete,
  onResolveBarcode,
  onConfirmScan,
  onVerifyLocation,
  onReportException,
  onPickComplete,
  onStartPacking,
  onStartPicking,
  resumePicking = false,
  floorZones,
  isOnline,
  queuedCount = 0,
  custodyAckRequired = false,
  unitsPickedBeforeTakeover = 0,
  onAcknowledgeCustody,
  onRevalidateSession,
  onVerifyResume,
  pendingOperation,
  onRecoveryConfirmed,
  onCheckPendingPick,
}: PickSessionPageProps) {
  const [reconciledItems, setReconciledItems] = useState<LineItem[] | null>(null);
  const lineItems = reconciledItems ?? sourceLineItems;
  const pendingDraftRef = useRef<PickPendingDraft | null>(pendingOperation ?? null);
  const restoredIds = pendingOperation?.body.lasyncro_unit_ids ?? (pendingOperation?.body.lasyncro_unit_id ? [pendingOperation.body.lasyncro_unit_id] : []);
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
  // SF-PICK-UX-ADAPTIVE-01-QUANTITY-UX-001 — the quantity field owns the keyboard once the count is active.
  const qtyInputRef       = useRef<HTMLInputElement>(null);
  // WEB-PICK-UNIT-01: carries LSU- unit ID from product_scan into qty_confirm path.
  const resolvedUnitIdRef = useRef<string | undefined>(pendingOperation?.body.lasyncro_unit_id);
  // SF-PICK-LOCATION-TRUTH-01: unit labels scanned for the current unbinned item.
  const scannedUnitIdsRef = useRef<string[]>(restoredIds);
  const [scannedUnitCount, setScannedUnitCount] = useState(restoredIds.length);
  // The server's label count after an identity refusal (read-time count was stale).
  const [unitsRequiredOverride, setUnitsRequiredOverride] = useState<number | null>(null);
  const resetScannedUnits = useCallback(() => {
    scannedUnitIdsRef.current = [];
    setScannedUnitCount(0);
  }, []);
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
    () => (pendingOperation ? 'product_scan' : resumePicking ? 'location_scan' : 'brief'),
  );
  /**
   * Totals on Done cover this session only when execution was resumed
   * (lineItems then hold remaining work only; B0 will supply history).
   * Set at mount OR when canonical `picking` status arrives later (C2).
   */
  const [resumedSession, setResumedSession] = useState(resumePicking);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [locationInput, setLocationInput] = useState('');
  // SF-PICK-LOCATION-TRUTH-01: the task key whose location the server confirmed.
  const [verifiedLocationKey, setVerifiedLocationKey] = useState<string | null>(null);
  const [locationChecking, setLocationChecking] = useState(false);
  const [productInput,  setProductInput]  = useState('');
  /** Decision 4 — multi-unit count starts at zero and is never prefilled. */
  const [qtyCount,       setQtyCount]      = useState(0);
  const [scanError,      setScanError]     = useState<string | null>(pendingOperation ? UNCERTAIN_SCAN_MESSAGE : null);
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

  // SF-PICK-ASSIGN-01 — ownership loss is terminal for this session; custody
  // acknowledgement gates every write after a takeover of partly picked work.
  const [ownershipLost, setOwnershipLost] = useState(false);
  const [custodyAckPendingLocal, setCustodyAckPendingLocal] = useState(false);
  const [custodyAckDone, setCustodyAckDone] = useState(false);
  const [custodyAcking, setCustodyAcking] = useState(false);
  const [custodyAckError, setCustodyAckError] = useState<string | null>(null);
  const custodyAckNeeded = !custodyAckDone && (custodyAckRequired || custodyAckPendingLocal);
  /** True when the error was an ownership refusal and has been handled here. */
  const absorbOwnershipError = useCallback((err: unknown): boolean => {
    const code = pickOwnershipCode(err);
    if (code && OWNERSHIP_LOST_CODES.has(code)) {
      setOwnershipLost(true);
      return true;
    }
    if (code === 'PICK_CUSTODY_ACK_REQUIRED') {
      setCustodyAckDone(false);
      setCustodyAckPendingLocal(true);
      return true;
    }
    return false;
  }, []);

  // C008 — online-only Pick: a lost connection pauses every scan until the
  // server answers again. The ref is the synchronous gate for the handlers.
  const [connectionLost, setConnectionLost] = useState(Boolean(pendingOperation));
  const connectionLostRef = useRef(Boolean(pendingOperation));
  const pauseForConnection = useCallback(() => {
    connectionLostRef.current = true;
    setConnectionLost(true);
  }, []);
  // SF-PICK-A6B-OUTCOME-TRUTH-001 — a confirmation that was SENT but got no
  // answer has an unknown outcome. It stays unresolved (scanning paused) until
  // the server's authoritative remaining work says whether it was recorded.
  const uncertainScanRef = useRef<{ allocationKey: string; title: string } | null>(pendingOperation ? { allocationKey: pendingOperation.item.reservation_allocation_id ?? pendingOperation.item.lasyncro_line_item_id, title: pendingOperation.item.product_title } : null);
  const pauseAfterLostConnection = useCallback((item: LineItem | undefined, sent: boolean, err: unknown) => {
    pauseForConnection();
    if (sent && item) {
      uncertainScanRef.current = { allocationKey: item.reservation_allocation_id ?? item.lasyncro_line_item_id, title: item.product_title };
      setScanError(UNCERTAIN_SCAN_MESSAGE);
    } else {
      setScanError(notSentScanMessage(errorMessage(err, 'no answer from the server')));
    }
  }, [pauseForConnection]);

  // SF-PICK-UX-ADAPTIVE-01-CROSS-TAB-001 — another tab of this operator holds an
  // unresolved Pick for this batch (or the durable fence cannot be read). The
  // block is synchronous and lifts only after a fresh server read (below).
  const [otherTabBlock, setOtherTabBlock] = useState<'pending' | 'unreadable' | null>(null);
  const otherTabBlockRef = useRef(false);
  const checkPendingRef = useRef(onCheckPendingPick);
  checkPendingRef.current = onCheckPendingPick;
  const durableBlockReason = useCallback((): 'pending' | 'unreadable' | null => {
    const check = checkPendingRef.current;
    if (!check) return null;
    try {
      const durable = check();
      // Our own write-ahead entry (sent, or restored after refresh) is fenced by this tab's own recovery.
      return durable && durable.requestId !== pendingDraftRef.current?.body.device_event_id ? 'pending' : null;
    } catch {
      return 'unreadable';
    }
  }, []);
  /** Synchronous gate run before accepting every scan or Pick write. */
  const blockedByOtherTab = useCallback((): boolean => {
    const reason = durableBlockReason();
    if (reason) {
      otherTabBlockRef.current = true;
      setOtherTabBlock(reason);
    }
    return otherTabBlockRef.current;
  }, [durableBlockReason]);
  const scanBlocked = connectionLost || otherTabBlock !== null;

  const currentItem = connectionLost && pendingDraftRef.current ? pendingDraftRef.current.item : lineItems[currentIndex];
  const totalUnits  = lineItems.reduce((sum, li) => sum + li.quantity, 0);
  const isExecution = phase === 'location_scan' || phase === 'product_scan' || phase === 'qty_confirm';

  // SF-PICK-LOCATION-TRUTH-01 — the map lights exactly one place: the current
  // stop's allocated pick bin. Orange while pending, green only after the
  // server confirmed the scan. Unbinned (warehouse-root) stock and any
  // non-pick-bin target are never lit; other route stops are never lit
  // either, so the map can never point somewhere the instruction does not.
  const currentKey = currentItem ? (currentItem.reservation_allocation_id ?? currentItem.lasyncro_line_item_id) : null;
  const currentLocationBlocked = currentItem?.location_pickable === false;
  const currentUnbinned = currentItem?.location_scan_required === false && !currentLocationBlocked;
  const unitsToIdentify = currentItem && !currentLocationBlocked
    // SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-001 — one label verifies the
    // product/location; the rest of the quantity is counted (server-settled).
    ? Math.min(1, Math.max(0, unitsRequiredOverride ?? currentItem.unit_scan_required ?? 0))
    : 0;
  const currentLocationCode = currentItem && !currentLocationBlocked && !currentUnbinned ? currentItem.location_code : null;
  const locationVerified = currentKey != null && verifiedLocationKey === currentKey;
  const destinationHighlight = useMemo<DestinationHighlight | null>(
    () =>
      currentLocationCode
        ? { locationCode: currentLocationCode, tone: locationVerified ? 'confirmed' : 'suggested' }
        : null,
    [currentLocationCode, locationVerified],
  );
  const inspectableCodes = useMemo(
    () => new Set(currentLocationCode ? [currentLocationCode] : []),
    [currentLocationCode],
  );

  // ── Focus management ───────────────────────────────────────
  useEffect(() => {
    if (exitOpen || exceptionDialog) return;
    if (phase === 'location_scan') setTimeout(() => locationInputRef.current?.focus(), 50);
    if (phase === 'product_scan' && !scanProcessing) setTimeout(() => productInputRef.current?.focus(), 50);
    // QUANTITY-UX-001 — once identity is verified the count is the active step: typed digits go to the
    // quantity field, never the scanner. Re-focus only if focus is not already in the quantity field.
    if (phase === 'qty_confirm' && !scanProcessing) {
      setTimeout(() => {
        const qty = qtyInputRef.current;
        if (qty && document.activeElement !== qty) { qty.focus(); qty.select(); }
        else if (!qty) productInputRef.current?.focus();
      }, 50);
    }
  }, [phase, currentIndex, scanError, exitOpen, exceptionDialog, scanProcessing]);

  // SF-PICK-LOCATION-TRUTH-01 — unbinned stock has no location to scan: the
  // product scan is the first step, wherever the session enters the stop.
  useEffect(() => {
    if (phase === 'location_scan' && currentUnbinned) setPhase('product_scan');
  }, [phase, currentUnbinned]);

  // ── Advance / finish ───────────────────────────────────────
  const advanceOrFinish = useCallback(() => {
    pendingDraftRef.current = null;
    setLocationInput('');
    setProductInput('');
    setQtyCount(0);
    setScanError(null);
    resetScanDetector();
    resetScannedUnits();
    setUnitsRequiredOverride(null);
    resolvedUnitIdRef.current = undefined; // WEB-PICK-UNIT-01: clear between items
    if (currentIndex >= lineItems.length - 1) {
      setPhase('finish');
    } else {
      setCurrentIndex(i => i + 1);
      setPhase('location_scan');
    }
  }, [currentIndex, lineItems.length, resetScanDetector, resetScannedUnits]);

  // ── Resume (Brief → location_scan, already-picking batch) ──
  // One-way and Brief-only: never touches an execution phase, and never
  // pre-empts an in-flight Start Picking, whose own result decides.
  useEffect(() => {
    if (resumePicking && phase === 'brief' && !startingPickRef.current) {
      setResumedSession(true);
      setPhase('location_scan');
    }
  }, [resumePicking, phase]);

  // ── Resume verification (SF-PICK-RESUME-GENERATION-001) ────
  // A resumed session (never one started through Start Picking) stays locked
  // until the server confirms this operator owns the batch. Runs once per
  // explicit attempt: a refusal is final for this session; only a request
  // that got no answer offers an explicit Retry.
  const [resumeGate, setResumeGate] = useState<'idle' | 'verifying' | 'verified' | 'refused' | 'unanswered'>('idle');
  const [resumeRefusal, setResumeRefusal] = useState<{ code: string | null; message: string } | null>(null);
  const resumeGateActive = resumedSession && onVerifyResume !== undefined && !pendingOperation;
  const verifyResume = useCallback(async () => {
    if (!onVerifyResume) return;
    setResumeGate('verifying');
    setResumeRefusal(null);
    try {
      await onVerifyResume();
      setResumeGate('verified');
    } catch (err) {
      const code = pickOwnershipCode(err);
      setResumeRefusal({ code, message: errorMessage(err, 'Could not verify your Pick session.') });
      setResumeGate(isConnectionLost(err) ? 'unanswered' : 'refused');
    }
  }, [onVerifyResume]);
  useEffect(() => {
    if (resumeGateActive && resumeGate === 'idle') void verifyResume();
  }, [resumeGateActive, resumeGate, verifyResume]);

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
      // SF-PICK-ASSIGN-01 — the claim answers with a readable reason (held by
      // an active picker, reserved for someone else, …); prefer it.
      setStartError(errorMessage(err, 'Could not start picking. Try again.'));
    } finally {
      startingPickRef.current = false;
      setStartingPick(false);
    }
  }, [onStartPicking]);

  // ── Location scan ──────────────────────────────────────────
  // Client match only; the reservation's location stays authoritative at
  // /pick/scan. A mismatch changes nothing.
  // SF-PICK-LOCATION-TRUTH-01: with onVerifyLocation the server confirms the
  // label against the allocation's pick bin before the stop turns green.
  const handleLocationScan = useCallback(async (value: string) => {
    if (!currentItem || connectionLostRef.current || locationChecking || blockedByOtherTab()) return;
    setScanError(null);
    if (currentItem.location_pickable === false) {
      setScanError(blockedLocationMessage(currentItem.location_code));
      return;
    }
    const key = currentItem.reservation_allocation_id ?? currentItem.lasyncro_line_item_id;
    if (!onVerifyLocation) {
      if (locationMatches(value, currentItem.location_code)) {
        setLastAck(null);
        setPhase('product_scan');
      } else {
        setScanError(`Wrong location (${value.trim().toUpperCase()}). Scan ${currentItem.location_code}.`);
      }
      return;
    }
    setLocationChecking(true);
    try {
      await onVerifyLocation({
        lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
        reservation_allocation_id: currentItem.reservation_allocation_id ?? undefined,
        location_code: currentItem.location_code,
        scanned_value: value,
      });
      setVerifiedLocationKey(key);
      setLastAck(null);
      setPhase('product_scan');
    } catch (err) {
      setScanError(errorMessage(err, `Location not confirmed. Scan ${currentItem.location_code} again.`));
    } finally {
      setLocationChecking(false);
    }
  }, [currentItem, onVerifyLocation, locationChecking]);

  const recordPicked = useCallback((item: LineItem) => {
    setPickResults(prev => [...prev, {
      lineItem: item, status: 'picked', unitsPicked: item.quantity, unitsShort: 0,
    }]);
    setLastAck(`${item.product_title} · ${units(item.quantity)} picked`);
  }, []);

  // ── Product scan ───────────────────────────────────────────
  const handleProductScan = useCallback(async (value: string) => {
    if (!currentItem || scanInFlightRef.current || connectionLostRef.current || blockedByOtherTab()) return;
    scanInFlightRef.current = true;
    setScanProcessing(true);
    setScanError(null);
    let sent = false;
    try {
      const scannedValue = value.trim();

      // SF-PICK-LOCATION-TRUTH-01 — labelled units (root or bin): each unit is
      // identified by its own label; never inferred or auto-selected.
      const identified = scannedUnitIdsRef.current;
      if (unitsToIdentify > 0 && identified.length >= unitsToIdentify) {
        setScanError('All required labels are scanned. Confirm the pick.');
        return;
      }
      if (unitsToIdentify > identified.length) {
        const unit = await onResolveBarcode(scannedValue);
        // EAN/SKU/LSP resolutions can carry a server-selected candidate.
        // Only the resolver's exact-unit method is operator identity evidence.
        const unitId = unit?.resolution_method === 'unit_barcode' ? unit.lasyncro_unit_id : undefined;
        if (!unitId) {
          setScanError('Scan the unit label on the item.');
          return;
        }
        if (!unit || unit.lasyncro_variant_id !== currentItem.lasyncro_variant_id) {
          setScanError('Wrong item — label does not match.');
          return;
        }
        if (identified.includes(unitId)) {
          setScanError('Label already scanned.');
          return;
        }
        const next = [...identified, unitId];
        scannedUnitIdsRef.current = next;
        setScannedUnitCount(next.length);
        if (next.length < unitsToIdentify) return;
        if (currentItem.quantity > 1) {
          // Multi-unit picks always require explicit confirmation. Only the
          // server-verified unlabelled remainder can be entered as a count.
          setQtyCount(next.length);
          setPhase('qty_confirm');
          return;
        }
        if (blockedByOtherTab()) return; // re-read after the barcode lookup await
        sent = true;
        const params: ConfirmScanParams = {
          lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
          lasyncro_variant_id:   currentItem.lasyncro_variant_id,
          reservation_allocation_id:
            currentItem.reservation_allocation_id ?? undefined,
          location_code:         currentItem.location_code,
          quantity_confirmed:    currentItem.quantity,
          scan_source:           detectSourceAndReset(),
          lasyncro_unit_ids:     next,
          device_event_id: newEventId(), recovery_item: currentItem,
        };
        pendingDraftRef.current = { kind: 'pick', body: params, item: currentItem };
        await onConfirmScan(params);
        recordPicked(currentItem);
        advanceOrFinish();
        return;
      }

      const result = await onResolveBarcode(scannedValue);

      if (result?.lasyncro_variant_id === currentItem.lasyncro_variant_id) {
        if (result.resolution_method === 'unit_barcode' && !result.lasyncro_unit_id) {
          setScanError('Scan the unit label on the item.');
          return;
        }
        if (currentItem.quantity > 1 && result.resolution_method === 'unit_barcode') {
          setScanError('Scan the product barcode. Unit picking requires server-confirmed label requirements.');
          return;
        }
        const resolvedUnitId = result.resolution_method === 'unit_barcode'
          ? result.lasyncro_unit_id
          : undefined;

        resolvedUnitIdRef.current = resolvedUnitId;

        if (currentItem.quantity > 1 && phase !== 'qty_confirm') {
          setQtyCount(0);
          setPhase('qty_confirm');
        } else if (currentItem.quantity === 1) {
          // Single unit: the scan is the pick, accepted only when /pick/scan resolves.
          if (blockedByOtherTab()) return; // re-read after the barcode lookup await
          sent = true;
          const params: ConfirmScanParams = {
            lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
            lasyncro_variant_id:   currentItem.lasyncro_variant_id,
            reservation_allocation_id:
              currentItem.reservation_allocation_id ?? undefined,
            location_code:         currentItem.location_code,
            quantity_confirmed:    currentItem.quantity,
            scan_source:           detectSourceAndReset(),
            lasyncro_unit_id:      resolvedUnitId,
            device_event_id: newEventId(), recovery_item: currentItem,
          };
          pendingDraftRef.current = { kind: 'pick', body: params, item: currentItem };
          await onConfirmScan(params);
          recordPicked(currentItem);
          advanceOrFinish();
        }
      } else {
        setScanError('Wrong item — barcode does not match. Check you are at the right bin.');
      }
    } catch (err: unknown) {
      if (sent && isUncertainPickOutcome(err)) {
        pauseAfterLostConnection(currentItem, true, err);
        return;
      }
      pendingDraftRef.current = null;
      if (isUnitIdentityRefusal(err)) {
        resetScannedUnits();
        const n = unitsRequiredFrom(err);
        if (n !== null) setUnitsRequiredOverride(n);
      } else if (sent && currentItem.quantity === 1
        && !OWNERSHIP_LOST_CODES.has(pickOwnershipCode(err) ?? '')) {
        // A definitive refusal did not pick this item. Q1 has no Confirm
        // control: discard its pending identity so the operator can rescan.
        // Unknown network outcomes stay pending for server revalidation.
        resetScannedUnits();
        resolvedUnitIdRef.current = undefined;
      }
      if (isConnectionLost(err)) pauseAfterLostConnection(currentItem, sent, err);
      else if (!absorbOwnershipError(err)) setScanError(errorMessage(err, 'Scan failed. Try again.'));
    } finally {
      scanInFlightRef.current = false;
      setScanProcessing(false);
    }
  }, [currentItem, phase, unitsToIdentify, onResolveBarcode, onConfirmScan, detectSourceAndReset, advanceOrFinish, recordPicked, absorbOwnershipError, pauseAfterLostConnection, resetScannedUnits]);

  // ── Exception report (existing GH-1049 workflow) ───────────
  const openExceptionDialog = useCallback((prefillFound?: number) => {
    if (connectionLostRef.current || blockedByOtherTab()) return;
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
    if (!currentItem || scanInFlightRef.current || connectionLostRef.current || blockedByOtherTab()) return;
    if (scannedUnitIdsRef.current.length < unitsToIdentify) {
      setScanError('Scan the unit label before confirming.');
      return;
    }
    if (!Number.isInteger(qtyCount) || qtyCount < scannedUnitIdsRef.current.length || qtyCount < 0 || qtyCount > currentItem.quantity) {
      setScanError('Enter a whole quantity between the scanned labels and the required quantity.');
      return;
    }
    if (qtyCount !== currentItem.quantity) {
      openExceptionDialog(qtyCount);
      return;
    }
    scanInFlightRef.current = true;
    setScanProcessing(true);
    setScanError(null);
    const params: ConfirmScanParams = {
      device_event_id: newEventId(), recovery_item: currentItem,
      lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
      lasyncro_variant_id:   currentItem.lasyncro_variant_id,
      reservation_allocation_id:
        currentItem.reservation_allocation_id ?? undefined,
      location_code:         currentItem.location_code,
      quantity_confirmed:    currentItem.quantity,
      scan_source:           detectSourceAndReset(),
      ...(unitsToIdentify > 0
        ? { lasyncro_unit_ids: scannedUnitIdsRef.current }
        : { lasyncro_unit_id: resolvedUnitIdRef.current }),
    };
    pendingDraftRef.current = { kind: 'pick', body: params, item: currentItem };
    onConfirmScan(params)
      .then(() => {
        recordPicked(currentItem);
        advanceOrFinish();
      })
      .catch((err: unknown) => {
        if (isUncertainPickOutcome(err)) {
          pauseAfterLostConnection(currentItem, true, err);
          return;
        }
        pendingDraftRef.current = null;
        if (isUnitIdentityRefusal(err)) {
          resetScannedUnits();
          const n = unitsRequiredFrom(err);
          if (n !== null) setUnitsRequiredOverride(n);
          setQtyCount(0);
          setPhase('product_scan');
        }
        if (isConnectionLost(err)) pauseAfterLostConnection(currentItem, true, err);
        else if (!absorbOwnershipError(err)) setScanError(errorMessage(err, 'Confirm failed. Try again.'));
      })
      .finally(() => {
        scanInFlightRef.current = false;
        setScanProcessing(false);
      });
  }, [currentItem, qtyCount, unitsToIdentify, onConfirmScan, detectSourceAndReset, advanceOrFinish, recordPicked, openExceptionDialog, absorbOwnershipError, pauseAfterLostConnection, resetScannedUnits]);

  // ── C008 — automatic recovery after a lost connection ──────
  // Only a server answer ends the pause: the host re-reads ownership and the
  // remaining work; the session then resumes at a fresh location scan.
  const resumeInFlightRef = useRef(false);
  // SF-PICK-A6B-RECONNECT-RECOVERY-002 — the server answered but could not
  // confirm the session yet: still paused, but no longer "waiting for connection".
  const [resumeUnconfirmed, setResumeUnconfirmed] = useState(false);
  /** SF-PICK-A6B-OWNERSHIP-TRUTH-003 F1 — product title of a sent-but-unanswered scan when ownership was lost. */
  const [uncertainAtOwnershipLoss, setUncertainAtOwnershipLoss] = useState<string | null>(null);
  const tryResume = useCallback(async () => {
    if (!connectionLostRef.current || resumeInFlightRef.current || !onRevalidateSession) return;
    resumeInFlightRef.current = true;
    try {
      const result = await onRevalidateSession();
      const fresh = Array.isArray(result) ? result : result.lineItems;
      const receipt = Array.isArray(result) ? undefined : result.outcome;
      const pending = pendingDraftRef.current;
      if (!Array.isArray(fresh)) throw new Error('Pick confirmation remains pending.');
      if (uncertainScanRef.current && (!pending || !receipt || !matchesPickReceipt(pending, receipt, pickBatchId))) {
        setResumeUnconfirmed(true);
        setScanError(UNCERTAIN_SCAN_MESSAGE);
        return; // a stale successful read is still unresolved
      }
      if (pending && receipt) {
        await onRecoveryConfirmed?.(receipt);
        setPickResults(prev => [...prev, {
          lineItem: pending.item, status: pending.kind === 'pick' ? 'picked' : 'exception',
          exceptionType: pending.kind === 'exception' ? pending.body.exception_type : undefined,
          unitsPicked: receipt.quantity_confirmed!, unitsShort: pending.item.quantity - receipt.quantity_confirmed!,
        }]);
      }
      const remaining = pending ? fresh.filter(li => (li.reservation_allocation_id ?? li.lasyncro_line_item_id) !==
        (pending.item.reservation_allocation_id ?? pending.item.lasyncro_line_item_id)) : fresh;
      setReconciledItems(remaining);
      connectionLostRef.current = false;
      setConnectionLost(false);
      setResumeUnconfirmed(false);
      setLocationInput('');
      setProductInput('');
      setQtyCount(0);
      setScanError(null);
      resetScanDetector();
      resetScannedUnits();
      setUnitsRequiredOverride(null);
      resolvedUnitIdRef.current = undefined;
      // Remaining work only from here on (same rule as a resumed session).
      setResumedSession(true);
      setCurrentIndex(0);
      // SF-PICK-A6B — resolve an unknown outcome from the server's remaining work
      // (confirmed allocations are excluded). The client never resends it.
      const uncertain = uncertainScanRef.current;
      uncertainScanRef.current = null;
      pendingDraftRef.current = null;
      setLastAck(uncertain ? `Connection restored — ${uncertain.title} was recorded.` : 'Connection restored');
      setPhase(remaining.length > 0 ? 'location_scan' : 'finish');
    } catch (err: unknown) {
      if (isConnectionLost(err)) {                       // still (or again) disconnected
        // SF-PICK-A6B-OWNERSHIP-TRUTH-003 F2 — an earlier inconclusive answer no
        // longer describes the state; the uncertain outcome stays unresolved.
        setResumeUnconfirmed(false);
        return;
      }
      if (absorbOwnershipError(err)) {
        // SF-PICK-A6B-OWNERSHIP-TRUTH-003 F1 — the sent scan's outcome is still
        // unknown; the ownership brief must not claim it was not recorded.
        setUncertainAtOwnershipLoss(uncertainScanRef.current?.title ?? null);
        connectionLostRef.current = false;
        setConnectionLost(false);
        setResumeUnconfirmed(false);
        return;
      }
      // Any other answer: stay paused (outcome still unknown) and retry.
      setResumeUnconfirmed(true);
    } finally {
      resumeInFlightRef.current = false;
    }
  }, [onRevalidateSession, onRecoveryConfirmed, pickBatchId, absorbOwnershipError, resetScanDetector, resetScannedUnits]);

  // SF-PICK-A6B-RECONNECT-RECOVERY-002 — a lost response never fires `online`,
  // so the probe is the only recovery path. The host re-renders (board polling)
  // with fresh callbacks far more often than the probe cadence; the probe reads
  // the latest tryResume through a ref so its interval is never reset by them.
  const tryResumeRef = useRef(tryResume);
  tryResumeRef.current = tryResume;
  useEffect(() => {
    if (!connectionLost) return;
    const onOnline = () => { void tryResumeRef.current(); };
    window.addEventListener('online', onOnline);
    const probe = window.setInterval(onOnline, RECONNECT_PROBE_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(probe);
    };
  }, [connectionLost]);

  // SF-PICK-UX-ADAPTIVE-01-CROSS-TAB-001 — the other tab's Pick left the durable
  // fence (server-confirmed, exact receipt or definitive refusal). This tab's
  // allocations may be stale: re-read ownership and the authoritative remaining
  // work, then restore scanning for unfinished work only. No answer → stay blocked.
  const otherTabRefreshInFlightRef = useRef(false);
  const refreshAfterOtherTab = useCallback(async () => {
    if (!otherTabBlockRef.current || otherTabRefreshInFlightRef.current || connectionLostRef.current) return;
    const reason = durableBlockReason();
    if (reason) { setOtherTabBlock(reason); return; }
    if (!onRevalidateSession) return; // no authoritative re-read available: stay blocked
    otherTabRefreshInFlightRef.current = true;
    try {
      const result = await onRevalidateSession();
      const fresh = Array.isArray(result) ? result : result.lineItems;
      if (!Array.isArray(fresh)) return;
      const again = durableBlockReason();
      if (again) { setOtherTabBlock(again); return; } // a new pending appeared during the read
      setReconciledItems(fresh);
      setLocationInput('');
      setProductInput('');
      setQtyCount(0);
      setScanError(null);
      resetScanDetector();
      resetScannedUnits();
      setUnitsRequiredOverride(null);
      resolvedUnitIdRef.current = undefined;
      setExceptionDialog(false);
      setCurrentIndex(0);
      setResumedSession(true);
      setPhase(p => (p === 'location_scan' || p === 'product_scan' || p === 'qty_confirm' || p === 'finish'
        ? (fresh.length > 0 ? 'location_scan' : 'finish') : p));
      setLastAck('Pick confirmed in another tab — remaining work refreshed.');
      otherTabBlockRef.current = false;
      setOtherTabBlock(null);
    } catch (err: unknown) {
      if (absorbOwnershipError(err)) {
        otherTabBlockRef.current = false;
        setOtherTabBlock(null);
      }
      // Otherwise (no answer, or any other refusal): stay blocked and retry.
    } finally {
      otherTabRefreshInFlightRef.current = false;
    }
  }, [durableBlockReason, onRevalidateSession, absorbOwnershipError, resetScanDetector, resetScannedUnits]);
  const refreshAfterOtherTabRef = useRef(refreshAfterOtherTab);
  refreshAfterOtherTabRef.current = refreshAfterOtherTab;
  // Another tab's write-ahead/clear fires `storage` here immediately; the probe
  // covers a missed event. Neither replaces the synchronous per-scan gate.
  useEffect(() => {
    const onStorage = () => { if (!blockedByOtherTab()) return; void refreshAfterOtherTabRef.current(); };
    window.addEventListener('storage', onStorage);
    onStorage();
    return () => window.removeEventListener('storage', onStorage);
  }, [blockedByOtherTab]);
  useEffect(() => {
    if (!otherTabBlock) return;
    const probe = window.setInterval(() => { void refreshAfterOtherTabRef.current(); }, RECONNECT_PROBE_MS);
    return () => window.clearInterval(probe);
  }, [otherTabBlock]);

  const handleReportException = useCallback(() => {
    if (!currentItem || !exceptionType || exceptionInFlightRef.current || connectionLostRef.current || blockedByOtherTab()) return;
    if (QTY_REQUIRED.includes(exceptionType) && !exceptionQty.trim()) {
      setExceptionError('Enter the quantity found.');
      return;
    }
    if (NOTES_REQUIRED.includes(exceptionType) && !exceptionNotes.trim()) {
      setExceptionError('Notes are required for this exception type.');
      return;
    }
    const qtyFound = exceptionType === 'short_pick' ? (parseInt(exceptionQty, 10) || 0) : 0;
    // SF-PICK-LOCATION-TRUTH-01 — found units carry the labels already
    // scanned (root or bin); nothing is inferred for the rest.
    const foundUnitIds = qtyFound > 0 ? scannedUnitIdsRef.current : [];
    if (foundUnitIds.length > qtyFound) {
      setExceptionError(`You scanned ${foundUnitIds.length} labels. Enter at least ${foundUnitIds.length} found.`);
      return;
    }

    exceptionInFlightRef.current = true;
    setExceptionProcessing(true);
    setExceptionError(null);

    /**
     * GH-1049 — one report carries the whole physical truth: which allocation,
     * what was expected, what was actually found. The server creates the
     * linked Problem Center task in the same transaction; the client must not
     * mint a second incident.
     */
    const params: ReportExceptionParams = {
      recovery_item: currentItem,
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
      ...(foundUnitIds.length > 0 ? { lasyncro_unit_ids: foundUnitIds } : {}),
    };
    pendingDraftRef.current = { kind: 'exception', body: params, item: currentItem };
    onReportException(params)
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
        if (isUncertainPickOutcome(err)) {
          setExceptionDialog(false);
          pauseAfterLostConnection(currentItem, true, err);
          return;
        }
        pendingDraftRef.current = null;
        if (absorbOwnershipError(err)) {
          setExceptionDialog(false);
          return;
        }
        setExceptionError(errorMessage(err, 'Exception report failed. Try again.'));
      })
      .finally(() => {
        exceptionInFlightRef.current = false;
        setExceptionProcessing(false);
      });
  }, [currentItem, exceptionType, exceptionQty, exceptionNotes, exceptionEventId, onReportException, advanceOrFinish, absorbOwnershipError, pauseAfterLostConnection]);

  // ── Pick complete ──────────────────────────────────────────
  // SF-PICK-UX-ADAPTIVE-01-FINALIZE-001 — the existing pick-complete operation is
  // called automatically, once, when the last Pick outcome has been settled by the
  // server (phase 'finish'). Done renders only after the backend accepts it. A
  // retry after a lost answer is answered authoritatively: the server's ownership
  // fence refuses a second completion with PICK_BATCH_NOT_PICKING + status
  // 'pick_complete', which means this batch's completion is already committed.
  const handlePickComplete = useCallback(() => {
    if (completeInFlightRef.current || blockedByOtherTab()) return;
    completeInFlightRef.current = true;
    setCompletingPick(true);
    setCompletionError(null);
    Promise.resolve()
      .then(() => onPickComplete())
      .then(() => {
        setPhase('done');
      })
      .catch((err: unknown) => {
        if (isCommittedPickCompletion(err)) {
          setPhase('done');
          return;
        }
        if (!absorbOwnershipError(err)) {
          setCompletionError(errorMessage(err, 'Pick complete failed. Retry when connection is restored.'));
        }
      })
      .finally(() => {
        completeInFlightRef.current = false;
        setCompletingPick(false);
      });
  }, [onPickComplete, absorbOwnershipError]);

  // FINALIZE-001 — automatic, single-flight finalization when the last outcome is settled.
  // One automatic attempt per entry into 'finish'; a failure waits for an explicit Retry.
  const autoFinalizeArmedRef = useRef(true);
  useEffect(() => {
    if (phase !== 'finish') { autoFinalizeArmedRef.current = true; return; }
    if (!autoFinalizeArmedRef.current || connectionLost || otherTabBlock !== null || ownershipLost) return;
    autoFinalizeArmedRef.current = false;
    handlePickComplete();
  }, [phase, connectionLost, otherTabBlock, ownershipLost, handlePickComplete]);

  // SF-PICK-ASSIGN-01 — custody acknowledgement, then a fresh location scan.
  const handleAcknowledgeCustody = useCallback(async () => {
    setCustodyAcking(true);
    setCustodyAckError(null);
    try {
      await onAcknowledgeCustody?.();
      setCustodyAckDone(true);
      setCustodyAckPendingLocal(false);
      setLocationInput('');
      setProductInput('');
      setQtyCount(0);
      setScanError(null);
      resolvedUnitIdRef.current = undefined;
      setPhase('location_scan');
    } catch (err: unknown) {
      if (!absorbOwnershipError(err)) setCustodyAckError(errorMessage(err, 'Could not confirm. Try again.'));
    } finally {
      setCustodyAcking(false);
    }
  }, [onAcknowledgeCustody, absorbOwnershipError]);

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
        facts={[
          { label: 'Action', value: 'Brief' },
          { label: 'Lines', value: String(lineItems.length) },
          { label: 'Units', value: String(totalUnits) },
          { label: 'Next', value: 'Start picking' },
        ]}
        steps={pickBriefSteps(lineItems)}
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

  // SF-PICK-ASSIGN-01 — this session no longer owns the batch. Nothing else
  // renders: no scanner, no stale location context, no further writes.
  if (ownershipLost) {
    const confirmedUnits = String(pickResults.reduce((n, r) => n + r.unitsPicked, 0));
    // SF-PICK-A6B-OWNERSHIP-TRUTH-003 F1 — a sent scan with no answer may already
    // be recorded: never "nothing else was recorded", never a re-scan.
    const uncertainTitle = uncertainAtOwnershipLoss;
    return (
      <WmsSessionBrief
        eyebrow={`Batch ${batchShort}`}
        title="Batch reassigned"
        description={uncertainTitle
          ? `Another picker now owns this batch. Your confirmed picks are kept. Your last scan (${uncertainTitle}) got no answer from the server — ${uncertainTitle} may already have been recorded.`
          : 'Another picker now owns this batch. Your confirmed picks are kept and nothing else was recorded.'}
        facts={uncertainTitle
          ? [
              { label: 'Status', value: 'No longer yours' },
              { label: 'Confirmed picks this session', value: confirmedUnits },
              { label: 'Last scan', value: 'Outcome unknown' },
            ]
          : [
              { label: 'Status', value: 'No longer yours' },
              { label: 'Picked this session', value: confirmedUnits },
            ]}
        steps={uncertainTitle
          ? [
              'Stop scanning this batch.',
              `Tell your supervisor the last scan (${uncertainTitle}) may already be recorded, so they can check it.`,
              'Hand any items you already picked, including that one, to the new picker or your supervisor.',
            ]
          : [
              'Stop scanning this batch.',
              'Hand any items you already picked to the new picker or your supervisor.',
            ]}
        primaryAction={
          <Button
            variant="contained"
            size="large"
            onClick={() => onComplete()}
            sx={{ ...WMS_TIER1_ACTION_SX, borderRadius: '6px', fontWeight: 600 }}
          >
            Back to Warehouse
          </Button>
        }
      />
    );
  }

  // SF-PICK-RESUME-GENERATION-001 — resumed session not yet verified: no
  // scanner, no location context, no writes. The server's answer decides.
  if (isExecution && resumeGateActive && resumeGate !== 'verified') {
    const backAction = (
      <Button
        variant={resumeGate === 'refused' ? 'contained' : 'text'}
        size={resumeGate === 'refused' ? 'large' : 'small'}
        onClick={() => onComplete()}
        sx={resumeGate === 'refused'
          ? { ...WMS_TIER1_ACTION_SX, borderRadius: '6px', fontWeight: 600 }
          : { minWidth: 'auto', px: 0, fontSize: 11, textTransform: 'none' }}
      >
        Back to Warehouse
      </Button>
    );
    if (resumeGate === 'refused') {
      const known = resumeRefusal?.code ? RESUME_REFUSALS[resumeRefusal.code] : undefined;
      return (
        <WmsSessionBrief
          eyebrow={`Batch ${batchShort}`}
          title={known?.title ?? 'Pick session not resumed'}
          description={known?.description ?? resumeRefusal?.message ?? 'Could not verify your Pick session.'}
          facts={[{ label: 'Status', value: 'Not resumed' }]}
          steps={['Stop scanning this batch.', 'Check with your supervisor before picking it again.']}
          primaryAction={backAction}
        />
      );
    }
    return (
      <WmsSessionBrief
        eyebrow={`Batch ${batchShort}`}
        title={resumeGate === 'unanswered' ? 'Could not verify your Pick session' : 'Checking your Pick session'}
        description={resumeGate === 'unanswered'
          ? 'No answer from the server, so scanning stays locked. Nothing was recorded.'
          : 'Confirming with the server that this batch is still yours. Scanning unlocks when it answers.'}
        facts={[{ label: 'Status', value: resumeGate === 'unanswered' ? 'Not verified' : 'Verifying' }]}
        steps={['Do not scan yet.']}
        primaryAction={resumeGate === 'unanswered' ? (
          <Button
            variant="contained"
            size="large"
            onClick={() => void verifyResume()}
            sx={{ ...WMS_TIER1_ACTION_SX, borderRadius: '6px', fontWeight: 600 }}
          >
            Retry
          </Button>
        ) : (
          <CircularProgress size={24} aria-label="Verifying Pick session" />
        )}
        secondaryAction={backAction}
      />
    );
  }

  // SF-PICK-ASSIGN-01 — taken over with units already picked: confirm the
  // tote before any write; scanning then restarts at a fresh location scan.
  if (isExecution && custodyAckNeeded) {
    return (
      <WmsSessionBrief
        eyebrow={`Batch ${batchShort}`}
        title="Confirm picked items"
        description={`${units(unitsPickedBeforeTakeover)} of this batch were already picked by the previous picker. Their picks are kept.`}
        facts={[
          { label: 'Already picked', value: units(unitsPickedBeforeTakeover) },
          { label: 'Next', value: 'Scan location' },
        ]}
        steps={[
          'Collect the tote or picked items from the previous picker.',
          'Confirm you have them, then scan the next location label.',
        ]}
        error={custodyAckError}
        primaryAction={
          <Button
            variant="contained"
            size="large"
            onClick={() => void handleAcknowledgeCustody()}
            disabled={custodyAcking}
            startIcon={custodyAcking ? <CircularProgress size={16} color="inherit" /> : undefined}
            sx={{ ...WMS_TIER1_ACTION_SX, borderRadius: '6px', fontWeight: 600 }}
          >
            I have the picked items
          </Button>
        }
        secondaryAction={
          <Button
            variant="text"
            size="small"
            onClick={() => onComplete()}
            disabled={custodyAcking}
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
  const n = Math.max(lineItems.length, connectionLost && pendingDraftRef.current ? 1 : 0);
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
        {/* QUANTITY-UX-001 — the map is drawn only for the current allocation's real bin with
            canonical geometry; root (unbinned) or geometry-less stops get a truthful text fallback,
            so no other bin is ever presented as the destination. */}
        {floorZones && floorZones.length > 0 && currentLocationCode && floorZones.some(z => z.location_code === currentLocationCode) ? (
          <IsometricCanvas
            zones={floorZones}
            selectedLocationCode={currentLocationCode}
            inspectableLocationCodes={inspectableCodes}
            destinationHighlight={destinationHighlight}
            showLegend={false}
            showControls={false}
            disablePan
            autoFit
          />
        ) : (
          <Box sx={{ height: '100%', minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
            <Typography role="status" sx={{ fontSize: 12, color: 'var(--ink-4)' }}>
              {currentUnbinned
                ? 'Not in a bin — no map position. Scan the product.'
                : `Floor map position unavailable. Follow the location label ${currentItem?.location_code ?? ''}.`}
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
      // SF-WMS-SCAN-UX-01 — quantity only. Stowed LSU ids are never listed here:
      // the operator scans the unit in hand; nothing is preselected.
      identity={`Quantity: ${currentItem.quantity}`}
    />
  ) : null;

  // SF-WMS-SCAN-UX-01 — shared product information for the scan steps. Values
  // are the task's own server data and the labels actually scanned.
  const scannedIds = scannedUnitIdsRef.current.slice(0, scannedUnitCount);
  const productCard = (stageLabel?: string) => currentItem ? (
    <ScanProductCard
      stage={unitsToIdentify > 0 ? 'units' : 'product'}
      stageLabel={stageLabel}
      productTitle={currentItem.product_title}
      variantTitle={currentItem.variant_title}
      imageUrl={currentItem.image_url}
      barcode={currentItem.barcode}
      sku={pickDisplaySku(currentItem)}
      quantity={currentItem.quantity}
      unitsRequired={unitsToIdentify}
      scanUnitId={currentItem.scan_unit_id ?? null}
      barcodeAccepted={phase === 'qty_confirm' && unitsToIdentify === 0}
      scannedUnitIds={scannedIds}
      testId="pick-product-card"
    />
  ) : null;

  const statusLine = (hint: ReactNode) =>
    scanError ? (
      <ReceiveStatusLine tone="error" role="alert">{scanError}</ReceiveStatusLine>
    ) : lastAck || hint ? (
      <ReceiveStatusLine role="status">{lastAck ? `✓ ${lastAck}` : hint}</ReceiveStatusLine>
    ) : null;

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
      disabled={scanProcessing || locationChecking || scanBlocked}
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
  // SF-PICK-LOCATION-TRUTH-01 — unbinned stock renders its product scan at once.
  const viewPhase: SessionPhase = phase === 'location_scan' && currentUnbinned ? 'product_scan' : phase;

  if (viewPhase === 'location_scan' && currentItem) {
    // SF-PICK-LOCATION-TRUTH-01 — the target code is the instruction. A stop
    // that is not a pick bin fails closed: no scan field, one correction path.
    const locationHeading = (
      <Typography
        component="h2"
        data-testid="pick-target-location"
        data-location-state={currentLocationBlocked ? 'blocked' : locationVerified ? 'confirmed' : 'pending'}
        sx={{
          ...receiveMonoSx,
          m: 0,
          textAlign: 'center',
          fontSize: { xs: 34, md: 44 },
          fontWeight: 600,
          lineHeight: 1.1,
          letterSpacing: '0.02em',
          wordBreak: 'break-all',
          color: currentLocationBlocked ? 'var(--critical-ink)' : locationVerified ? 'var(--good-ink)' : 'var(--accent)',
        }}
      >
        {currentItem.location_code}
      </Typography>
    );
    column = currentLocationBlocked ? (
      <>
        {locationHeading}
        {productChip}
        <ReceiveStatusLine tone="error" role="alert">{blockedLocationMessage(currentItem.location_code)}</ReceiveStatusLine>
      </>
    ) : (
      <>
        {locationHeading}
        {productChip}
        {scanField({
          inputRef: locationInputRef,
          placeholder: 'Scan location',
          value: locationInput,
          setValue: setLocationInput,
          submit: handleLocationScan,
        })}
        {scanError
          ? <ReceiveStatusLine tone="error" role="alert">{scanError}</ReceiveStatusLine>
          : lastAck ? <ReceiveStatusLine role="status">{`✓ ${lastAck}`}</ReceiveStatusLine> : null}
      </>
    );
  } else if ((viewPhase === 'product_scan' || viewPhase === 'qty_confirm') && currentItem) {
    const required = currentItem.quantity;
    const full = qtyCount === required;
    const countVisible = phase === 'qty_confirm' && unitsToIdentify < required;
    const confirmVisible = phase === 'qty_confirm' || (required > 1 && unitsToIdentify > 0);
    column = (
      <>
        {productCard()}
        {/* SCAN-INPUT-VISIBILITY-001 — qty_confirm is reached only after a valid LSU/EAN scan
            (quantity > 1): the scanner is hidden and the count owns the step. Any refusal that
            needs a rescan returns to product_scan, which shows the scanner again. */}
        {phase !== 'qty_confirm' && scanField({
          inputRef: productInputRef,
          placeholder: unitsToIdentify > 0 ? 'Scan unit label' : 'Scan product barcode',
          value: productInput,
          setValue: setProductInput,
          submit: (val) => { void handleProductScan(val); },
        })}
        {countVisible && (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '58px minmax(0,1fr) 58px', md: '76px minmax(0,1fr) 76px' }, gap: { xs: 1, md: 1.5 }, alignItems: 'center' }}>
            <Button
              aria-label="Remove one unit"
              disabled={scanProcessing || scanBlocked || qtyCount <= scannedUnitCount}
              onClick={() => { setQtyCount(c => Math.max(scannedUnitCount, c - 1)); setScanError(null); }}
              sx={{ minWidth: 0, height: 58, border: '1px solid var(--rule-2)', fontSize: 28 }}
            >−</Button>
            {/* QUANTITY-UX-001 — no floating label (it lifted the field off the buttons' centre);
                "out of N" is a fixed, non-editable adornment inside the field, outside its value. */}
            <TextField
              type="number"
              fullWidth
              value={Number.isNaN(qtyCount) ? '' : qtyCount}
              disabled={scanProcessing || scanBlocked}
              onChange={e => { setQtyCount(e.target.value === '' ? NaN : Number(e.target.value)); setScanError(null); }}
              onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
              inputRef={qtyInputRef}
              inputProps={{
                min: scannedUnitCount, max: required, step: 1, inputMode: 'numeric',
                'aria-label': 'Quantity picked', 'aria-describedby': 'pick-qty-out-of',
              }}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end" id="pick-qty-out-of" data-testid="pick-qty-out-of" sx={{ pointerEvents: 'none', userSelect: 'none' }}>
                    out of {required}
                  </InputAdornment>
                ),
              }}
              sx={{ '& .MuiInputBase-root': { height: { xs: 58, md: 58 } }, '& input': { fontSize: 20, fontVariantNumeric: 'tabular-nums' } }}
            />
            <Button
              aria-label="Add one unit"
              disabled={scanProcessing || scanBlocked || qtyCount >= required}
              onClick={() => { setQtyCount(c => Math.min(required, c + 1)); setScanError(null); }}
              sx={{ minWidth: 0, height: 58, border: '1px solid var(--rule-2)', fontSize: 28 }}
            >+</Button>
          </Box>
        )}
        {statusLine(scanProcessing ? 'Confirming…' : null)}
        {confirmVisible && (
          <ReceiveActions>
            <ReceiveCta
              tier={full ? 'primary' : 'secondary'}
              disabled={scanProcessing || scanBlocked || scannedUnitCount < unitsToIdentify}
              onClick={handleQtyConfirm}
            >
              {scanProcessing ? 'Confirming…' : full || !countVisible ? `Confirm ${required} picked` : `Report ${Number.isNaN(qtyCount) ? 0 : qtyCount} of ${required}`}
            </ReceiveCta>
          </ReceiveActions>
        )}
      </>
    );
  } else if (phase === 'finish') {
    // FINALIZE-001 — not a confirmation screen: a transient finalizing state while the
    // server completes the batch, or a recoverable error with Retry. Success is never shown here.
    column = completionError ? (
      <>
        <ReceiveStatusLine tone="error" role="alert">{completionError}</ReceiveStatusLine>
        <ReceiveActions>
          <ReceiveCta disabled={completingPick || scanBlocked} onClick={handlePickComplete}>
            {completingPick ? 'Finishing pick…' : 'Retry finishing pick'}
          </ReceiveCta>
        </ReceiveActions>
      </>
    ) : (
      <Box data-testid="pick-finalizing" aria-busy="true">
        <ReceiveStatusLine role="status">Finishing pick…</ReceiveStatusLine>
      </Box>
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
          {/* FINALIZE-001 — Pack readiness is the server's pick_complete; flagged items are named, never hidden. */}
          {resumedSession
            ? 'Batch ready for pack. Totals cover this session; picks confirmed before you resumed are not included.'
            : `${n} item${n === 1 ? '' : 's'} processed. Batch ready for pack.`}
          {flaggedCount > 0 ? ` ${flaggedCount} item${flaggedCount === 1 ? '' : 's'} reported — routed to Problem Center.` : ''}
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
          <ReceiveFooterButton onClick={() => openExceptionDialog()} disabled={scanProcessing || scanBlocked}>
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
            body={`Confirmed picks stay recorded. Batch ${batchShort} stays yours — resume it from Warehouse Operations. If it sits idle past the recovery time, a teammate may take it over.`}
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
                disabled={!exceptionType || exceptionProcessing || scanBlocked}
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
      {otherTabBlock && (
        <Alert severity="warning" role="status" aria-live="polite" sx={{ mb: 2 }} data-testid="pick-other-tab-pending">
          <Typography component="p" sx={{ fontWeight: 700 }}>Pick confirmation pending</Typography>
          <Typography component="p" sx={{ fontSize: 14 }}>
            {otherTabBlock === 'pending'
              ? 'A Pick for this batch is waiting for server confirmation in another tab. Do not scan or pick here; this tab continues when it is confirmed.'
              : 'This browser could not read the pending Pick confirmation for this batch. Do not scan or pick.'}
          </Typography>
        </Alert>
      )}
      {connectionLost && (
        // C008 — one persistent, non-modal state; no repeated alerts.
        <Alert severity="warning" role="status" aria-live="polite" sx={{ mb: 2 }} data-testid="pick-connection-lost">
          <Typography component="p" sx={{ fontWeight: 700 }}>Connection lost</Typography>
          <Typography component="p" sx={{ fontSize: 14 }}>Picking is paused. Your confirmed progress is saved.</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
            <CircularProgress size={14} />
            <Typography component="span" sx={{ fontSize: 14 }}>
              {resumeUnconfirmed
                ? 'The server could not confirm your Pick session yet. Do not scan; Picking keeps checking. If this persists, check with your supervisor.'
                : 'Waiting for connection…'}
            </Typography>
          </Box>
        </Alert>
      )}
      {column}
    </ExecutionSessionShell>
  );
}
