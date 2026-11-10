// modules/wms/src/ui/pages/StowSessionPage.tsx
import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Box, Typography, Button, Alert,
  TextField, useTheme, useMediaQuery, CircularProgress, IconButton, Tooltip,
} from '@mui/material';
import {
  CheckCircle,
  Package,
  ArrowLeft,
  Info,
} from 'lucide-react';
import ProblemBinScanFlow from '../components/ProblemBinScanFlow.js';
import { IsometricCanvas } from '@lasyncro/shared/ui';
import type { DestinationHighlight, OperationalMapState, WarehouseZone } from '@lasyncro/shared/ui';
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
import type {
  WmsStowTask,
  WmsStowConfirmResult,
} from './WmsModuleFT2.js';

/**
 * STOW SESSION PAGE — WEB-STOW-UNIT-01 / STOW-SPLIT-01 / STOW-UX-SCAN-RAIL-01
 * / STOW-ACTIVE-LOCATION-01
 * -----------------------------------------------------
 * Location-first flow with a mutable, sticky active bin:
 *
 *   brief → location_scan → item_scan ↺ → complete
 *
 * STOW-ACTIVE-LOCATION-01 superseded "one Stow task = one immutable
 * destination": currentTask.location_code / confirmedLocation is the
 * CURRENT / most-recently-activated destination, not a frozen one. While a
 * task is active (item_scan), scanning a different valid bin switches the
 * active destination for units confirmed AFTER that point — see
 * handleItemScan below. It does not rewrite where already-committed units
 * physically are; that exact history remains in inventory_movements /
 * inventory_units.current_location_code and is surfaced task-wide by the
 * activity panel, never bin-scoped.
 *
 * STOW-SPLIT-01 — every accepted physical-unit scan commits exactly one unit.
 * There is intentionally no quantity-confirm or review phase: the successful
 * scanner event itself is the operator's placement confirmation.
 */

export type BarcodeResolveResult = {
  lasyncro_variant_id: string;
  lasyncro_unit_id?: string;
  unit_status?: string;
};

/**
 * SF-STOW-UX-REFINEMENT-01 — exact-LSU tasks recover one specific unit, so a
 * generic product barcode is never their scan target. Mirrors the scan guard.
 */
function requiresExactUnit(task: Pick<WmsStowTask, 'trigger' | 'unit_ids'>): boolean {
  return (
    task.trigger === 'receive_recovery' ||
    (task.trigger === 'order_cancelled_mid_pick' && (task.unit_ids ?? []).length > 0)
  );
}

/**
 * The product barcode an operator may scan for this task: the server-vetted
 * external barcode (see httpGetStowTasks), never an SKU or LSP- identity, and
 * never for an exact-LSU task. Null means "scan the unit label".
 */
function scannableProductBarcode(task: Pick<WmsStowTask, 'trigger' | 'unit_ids' | 'barcode'>): string | null {
  if (requiresExactUnit(task)) return null;
  const barcode = task.barcode?.trim();
  return barcode ? barcode : null;
}

/**
 * SF-STOW-UX-LSU-VISIBILITY-01 — triggers whose unit_ids projection is scoped to
 * THIS task (httpGetStowTasks): inbound units of the task's own Receive line, the
 * one held unit of a receive recovery, and the picked, unlocated units a
 * cancellation recovery accepts. Every other trigger projects any received unit
 * of the variant shop-wide, which may belong to other tasks, so it is never
 * listed as this task's expected labels.
 */
const TASK_SCOPED_UNIT_TRIGGERS = new Set(['inbound_stock', 'receive_recovery', 'order_cancelled_mid_pick']);

/** How long Registered stays lit before the rail returns to Scan Item. */
export const STOW_REGISTERED_ACK_MS = 1500;

/** Canonical placement projection — see stow.service.ts#getStowTaskPlacements. */
export type StowPlacement = {
  lasyncro_unit_id: string;
  lasyncro_variant_id: string;
  product_title: string | null;
  variant_title: string | null;
  sku: string | null;
  location_code: string;
  operator_id: number | null;
  operator_name: string | null;
  occurred_at: string;
};

export interface StowSessionPageProps {
  initialTaskId: string;
  initialStep?: 'location' | null;
  currentUserId?: number | null;
  onComplete: () => void;
  /**
   * STOW-SESSION-TRANSITION-01 — the single source of truth for "which task
   * is active and what phase is it in", reported to the parent with the
   * EXACT task ID it applies to. This replaces the earlier `onStepChange?:
   * (step) => void`, whose implicit subject was always whatever task ID the
   * parent's own closure happened to capture — correct for a same-task step
   * change, but silently wrong the moment advanceToNext() moves the session
   * to a different task, since the parent had no way to learn the new ID.
   * Called both for a same-task phase change and for an automatic task
   * transition; the parent must persist taskId as the new canonical active
   * session identity (URL + activeSession state) on every call, never derive
   * it from a previously captured value.
   */
  onActiveTaskChange?: (taskId: string, step: 'location' | null) => void;
  onFetchTasks: () => Promise<WmsStowTask[]>;
  onResolveLocation: (scannedValue: string) => Promise<{ location_code: string } | null>;
  onAssignLocation: (taskId: string, locationCode: string) => Promise<void>;
  onClaimTask: (taskId: string) => Promise<void>;
  onResolveBarcode: (scannedValue: string) => Promise<BarcodeResolveResult | null>;
  onQuarantineStow?: (taskId: string, lsu: string, bin: string, eventId: string) => Promise<WmsStowConfirmResult>;
  /** SF-PROBLEM-BIN: shared Problem Bin resolution (not task-scoped). */
  onResolveProblemBin?: (scan: string) => Promise<{ location_code: string }>;
  onConfirmStow: (
    taskId: string,
    quantityPlaced: number,
    lasyncroUnitId?: string
  ) => Promise<WmsStowConfirmResult>;
  /** STOW-UX-SCAN-RAIL-01 — canonical current-bin activity trace, task-scoped. */
  onFetchPlacements?: (taskId: string) => Promise<StowPlacement[]>;
  /**
   * STOW-UX-01 — warehouse geometry for the orientation map. undefined or
   * unplaced means text-only directions; this page never fetches geometry.
   */
  floorZones?: WarehouseZone[];
}

// STOW-SPLIT-01 — only phases that remain reachable in the per-unit scanner
// workflow are represented. Dead quantity/review states are deliberately
// removed so UI state cannot transition back into the retired workflow.
type Phase =
  | 'brief'
  | 'item_scan'
  | 'location_scan'
  | 'complete';

type StowOperatorErrorContext = 'item_scan' | 'location_scan';

// STOW-SPLIT-01 — transient feedback is reserved for meaningful operational
// events: a committed unit, a physical bin switch, or scanner-busy protection.
// Stable location state belongs to the persistent banner instead of being
// repeated after every successful location scan.
type StowScanFeedback = {
  severity: 'success' | 'info';
  message: string;
};

function triggerLabel(trigger: string): string {
  if (trigger === 'inbound_stock') return 'Inbound receive';
  if (trigger === 'order_cancelled_mid_pick') return 'Cancelled pick';
  if (trigger === 'return_restock') return 'Return restock';
  if (trigger === 'problem_center') return 'Problem center';
  if (trigger === 'receive_recovery') return 'Receive recovery';
  return trigger.replace(/_/g, ' ');
}

const visuallyHiddenSx = {
  position: 'absolute',
  width: 1,
  height: 1,
  p: 0,
  m: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

/** STOW-UX-SCAN-RAIL-01 — visual shortening only; full LSU stays accessible
 * via the `title` attribute on the element rendering this string. */
function shortenLsu(lasyncroUnitId: string): string {
  return lasyncroUnitId.length > 13
    ? `${lasyncroUnitId.slice(0, 10)}…`
    : lasyncroUnitId;
}

function formatPlacementTimestamp(occurredAt: string): string {
  return new Date(occurredAt).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * STOW-SPLIT-01 — backend errors are diagnostic evidence, not operator copy.
 *
 * Keep the exact technical reason in the browser console for engineering
 * diagnosis, but translate anything rendered in the workflow into:
 *   1. what happened in warehouse terms, and
 *   2. what the operator should do next.
 *
 * Unknown backend text must never leak directly into the scanner UI.
 */
function getStowOperatorError(
  err: unknown,
  context: StowOperatorErrorContext
): string {
  const responseError =
    (err as { response?: { data?: { error?: unknown } } })
      ?.response?.data?.error;

  const technicalMessage =
    typeof responseError === 'string'
      ? responseError
      : err instanceof Error
        ? err.message
        : 'Unknown stow error';

  // Engineering detail remains available without exposing implementation
  // language such as service names, database state or internal error codes.
  console.error('[STOW_UI_OPERATION_FAILED]', {
    context,
    error: technicalMessage,
  });

  const reason = technicalMessage.toLowerCase();

  // SF-STOW-SAD-PATH-01 S1 — opt-in hard capacity. Item scan also accepts a
  // location scan (STOW-ACTIVE-LOCATION-01), so the task and scanning context
  // stay as they are and the operator can switch bins directly.
  if (reason.includes('location_capacity_exceeded')) {
    const fullLocation =
      (err as { response?: { data?: { location_code?: unknown } } })
        ?.response?.data?.location_code;
    return typeof fullLocation === 'string' && fullLocation
      ? `Location ${fullLocation} is full. Scan another storage location.`
      : 'This location is full. Scan another storage location.';
  }

  if (reason.includes('stow_destination_structural')) {
    return 'This rack uses shelf or bin positions. Scan a position label to continue.';
  }
  if (reason.includes('stow_destination_inactive')) {
    return 'This location is inactive. Scan another active location.';
  }
  if (reason.includes('stow_destination_not_found')) {
    return 'Bin not recognised. Scan the bin label again.';
  }


  if (
    reason.includes('unauthorized') ||
    reason.includes('session')
  ) {
    return 'Your session has expired. Sign in again, then reopen Stow.';
  }

  if (
    reason.includes('no active stow task') ||
    reason.includes('task not found') ||
    reason.includes('task not in progress') ||
    reason.includes('not assignable')
  ) {
    return 'This stow task is no longer available. Return to Stow and reopen the task.';
  }

  if (
    reason.includes('owned by different operator') ||
    reason.includes('different operator')
  ) {
    return 'Another operator is already working this stow task. Return to Stow and choose another task.';
  }

  if (
    reason.includes('wrong product') ||
    reason.includes('does not match this stow task')
  ) {
    return 'Wrong product. Scan a unit that matches this stow task.';
  }

  if (
    reason.includes('wrong unit') ||
    reason.includes('lsu mismatch') ||
    // SF-STOW-UX-LSU-VISIBILITY-01 — confirmStow's code is INBOUND_LSU_MISMATCH
    // (underscore), which previously fell through to the generic message.
    reason.includes('lsu_mismatch') ||
    reason.includes('specific unit')
  ) {
    return 'Wrong unit. Scan the LSU shown for this stow task.';
  }

  if (
    reason.includes('physical unit not resolved') ||
    reason.includes('no physical units resolved')
  ) {
    return 'No available unit was found for this scan. Scan the LSU label or check that the unit is still waiting to be stowed.';
  }

  if (
    reason.includes('no active location') ||
    reason.includes('scan a bin barcode first')
  ) {
    return 'Scan a bin barcode first, then scan the unit.';
  }

  if (
    reason.includes('location not found') ||
    reason.includes('location not recognised')
  ) {
    return 'Bin not recognised. Scan the bin label again.';
  }

  if (
    reason.includes('invalid_restow_destination') ||
    reason.includes('not an active bin')
  ) {
    return 'This location cannot receive the unit. Scan another active storage bin.';
  }

  if (
    reason.includes('source equals destination') ||
    reason.includes('source and destination must differ')
  ) {
    return 'This unit is already at that location. Scan a different destination bin.';
  }

  if (
    reason.includes('barcode not recognised') ||
    reason.includes('no variant found')
  ) {
    return 'Barcode not recognised. Check the label and scan it again.';
  }

  // STOW-SPLIT-01 — fallback is intentionally actionable and generic.
  // Technical implementation details remain only in the console above.
  return context === 'location_scan'
    ? 'That bin could not be activated. Scan the bin label again or choose another active bin.'
    : 'That scan could not be completed. Check the unit label and try again.';
}

// ── Scan input ────────────────────────────────────────────────────────────────
function ScanInput({ hint, onSubmit, error, disabled = false, focusRequest = 0 }: {
  hint: string;
  onSubmit: (value: string) => void;
  error?: string | null;
  disabled?: boolean;
  /** Bumped by the page to return a hardware scanner's keystrokes here. */
  focusRequest?: number;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // A disabled input loses focus, so re-enabling after each saved scan must
    // take it back or the next hardware scan has nowhere to land. The timeout
    // lets a closing dialog restore its own focus first.
    if (disabled) return;
    inputRef.current?.focus({ preventScroll: true });
    const timer = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
    return () => clearTimeout(timer);
  }, [disabled, focusRequest]);
  useEffect(() => {
    if (error) setTimeout(() => inputRef.current?.focus(), 50);
  }, [error]);

  const handleSubmit = () => {
    // STOW-SPLIT-01 — never start another physical scanner action while the
    // previous one is still being saved. The page-level lock remains the
    // authoritative guard; disabling the input also makes that state visible.
    if (disabled) return;

    const val = value.trim();
    if (val) {
      onSubmit(val);
      setValue('');
    }
  };

  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
      <TextField
        inputRef={inputRef}
        fullWidth
        placeholder={hint}
        inputProps={{ 'aria-label': hint, autoCapitalize: 'off', spellCheck: false }}
        sx={{ '& .MuiInputBase-root': { minHeight: 56, borderRadius: '12px', bgcolor: 'var(--surface)' } }}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
        }}
        helperText={
          disabled
            ? 'Saving scan…'
            : 'Scanner auto-submits · manual entry: press Enter'
        }
        autoComplete="off"
      />

      {value.trim() && (
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={disabled}
          sx={{
            bgcolor: 'var(--accent)',
            color: 'var(--accent-ink)',
            borderRadius: '12px',
            fontWeight: 600,
            minHeight: 56,
            flexShrink: 0,
          }}
        >
          Scan
        </Button>
      )}
    </Box>
  );
}

// ── Floor map helpers (STOW-UX-01) ────────────────────────────────────────────
/**
 * Same "is there a floor?" semantic as GH-1176 hasOperationalFloor: the
 * bootstrapped warehouse root never counts. undefined (grid unresolved or
 * denied) and an unplaced floor both fall back to text-only directions.
 */
function hasPlacedFloor(zones: WarehouseZone[] | undefined): boolean {
  return Boolean(
    zones?.some(
      (zone) =>
        zone.type !== 'warehouse' &&
        zone.position_x != null &&
        zone.position_y != null,
    ),
  );
}

/**
 * Ancestors of a location, outermost first, read from the shop's own geometry.
 * Codes are never parsed: their format belongs to the merchant. The warehouse
 * root adds no direction and is left out. Empty when geometry is unavailable.
 */
function describeLocationPath(
  locationCode: string,
  zones: WarehouseZone[] | undefined,
): string[] {
  if (!zones) return [];
  const byCode = new Map(zones.map((zone) => [zone.location_code, zone]));
  const path: string[] = [];
  const seen = new Set<string>([locationCode]);
  let parentCode = byCode.get(locationCode)?.parent_location_code ?? null;
  while (parentCode && !seen.has(parentCode)) {
    seen.add(parentCode);
    const parent = byCode.get(parentCode);
    if (!parent || parent.type === 'warehouse') break;
    path.unshift(parentCode);
    parentCode = parent.parent_location_code;
  }
  return path;
}

/**
 * Orientation only: the destination is lit, nothing here can change session state.
 * SF-STOW-UX-REFINEMENT-01 — a scanned destination lights its whole geometry
 * green as an open bin; an unscanned suggestion gets a restrained orange. The
 * whole rack is lit because levels are geometry, not addresses.
 */
function StowFloorMap({
  zones,
  destinationCode,
  destinationConfirmed,
  destinationOnMap,
  placements,
}: {
  zones: WarehouseZone[];
  destinationCode: string | null;
  destinationConfirmed: boolean;
  destinationOnMap: boolean;
  placements: StowPlacement[];
}) {
  const stateByLocation = useMemo(() => {
    const states: Record<string, OperationalMapState> = {};
    // Committed placements keep their ORIGINAL bins lit after a destination switch.
    for (const placement of placements) states[placement.location_code] = 'healthy';
    return states;
  }, [placements]);
  const destinationHighlight = useMemo<DestinationHighlight | null>(
    () =>
      destinationCode && destinationOnMap
        ? { locationCode: destinationCode, tone: destinationConfirmed ? 'confirmed' : 'suggested' }
        : null,
    [destinationCode, destinationOnMap, destinationConfirmed],
  );
  const inspectable = useMemo(
    () => new Set(destinationCode ? [destinationCode] : []),
    [destinationCode],
  );

  return (
    <Box
      component="section"
      id="stow-warehouse-map"
      aria-label="Warehouse map"
      sx={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--rule)',
        borderRadius: '12px',
        bgcolor: 'var(--bg-2)',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          flex: 1,
          minHeight: { xs: 240, md: 360, lg: 'min(56vh, 560px)' },
          position: 'relative',
        }}
      >
        <IsometricCanvas
          zones={zones}
          selectedLocationCode={destinationOnMap ? destinationCode : null}
          inspectableLocationCodes={inspectable}
          operationalStateByLocation={stateByLocation}
          destinationHighlight={destinationHighlight}
          showLegend={false}
          showControls={false}
          disablePan
          autoFit
        />
      </Box>
      {destinationCode && (
        <Typography role="status" sx={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', px: 1.5, py: 1, borderTop: '1px solid var(--rule)' }}>
          {destinationOnMap
            ? `${destinationConfirmed ? 'Destination' : 'Suggested bin'} ${destinationCode} is highlighted on the map.`
            : `Destination ${destinationCode} is not placed on this map. Follow its bin label.`}
        </Typography>
      )}
    </Box>
  );
}

type StowBarTone = 'done' | 'current' | 'idle';

const STOW_BAR_COLOR: Record<StowBarTone, string> = {
  done: 'var(--good-ink)',
  current: 'var(--ink)',
  idle: 'var(--rule)',
};

/**
 * Same grammar as ReceiveSessionShell (header, one task column, footer), local
 * to Stow because that shell's workflow pill is fixed to RECEIVE. Presentation
 * only: it owns no session state. One DOM for every viewport.
 */
function StowSessionShell({
  sourceLabel,
  positionLabel,
  progressLabel,
  bars,
  onBack,
  onExit,
  exitDisabled,
  map,
  desktopMapLayout,
  footer,
  overlay,
  children,
}: {
  sourceLabel: string;
  positionLabel: string;
  progressLabel: string;
  bars: StowBarTone[];
  onBack?: () => void;
  onExit?: () => void;
  exitDisabled: boolean;
  map: ReactNode;
  /** Map and task as two equal panels; everything task-related stays on the right. */
  desktopMapLayout: boolean;
  footer?: ReactNode;
  overlay: ReactNode;
  children: ReactNode;
}) {
  const hasDesktopMapColumn = Boolean(map && desktopMapLayout);
  return (
    <Box
      data-testid="stow-session-shell"
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        bgcolor: 'var(--bg)',
        color: 'var(--ink)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        pb: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <Box
        component="header"
        sx={{
          flex: '0 0 auto',
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0,1fr) auto', md: '1fr auto 1fr' },
          alignItems: 'center',
          minHeight: { md: 64 },
          columnGap: 2,
          rowGap: 0.75,
          px: { xs: 2, md: 3 },
          pt: { xs: 'max(8px, env(safe-area-inset-top, 0px))', md: 0 },
          pb: { xs: 1, md: 0 },
          bgcolor: { xs: 'var(--bg)', md: 'var(--surface)' },
          borderBottom: { xs: 0, md: '1px solid var(--rule)' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, gridColumn: 1, gridRow: 1 }}>
          <Box
            component="span"
            sx={{
              fontSize: { xs: 10, md: 11 },
              fontWeight: 500,
              lineHeight: 1,
              letterSpacing: '0.12em',
              color: 'var(--accent-text)',
              bgcolor: { xs: 'transparent', md: 'var(--accent-ghost)' },
              borderRadius: '100px',
              px: { xs: 0, md: '11px' },
              py: { xs: 0, md: '6px' },
              flexShrink: 0,
            }}
          >
            STOW
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography noWrap sx={{ fontSize: { xs: 12, md: 14 }, fontWeight: 500, color: 'var(--ink)' }}>
              {sourceLabel}
            </Typography>
            {positionLabel && (
              <Typography noWrap sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
                {positionLabel}
              </Typography>
            )}
          </Box>
        </Box>
        <Box
          sx={{
            display: 'grid',
            justifyItems: { xs: 'stretch', md: 'center' },
            gap: 0.75,
            gridColumn: { xs: '1 / -1', md: 2 },
            gridRow: { xs: 2, md: 1 },
          }}
        >
          {bars.length > 0 && (
            <Box aria-hidden="true" sx={{ display: 'flex', gap: '4px', width: { xs: '100%', md: Math.min(bars.length * 56, 360) } }}>
              {bars.map((tone, index) => (
                <Box key={index} sx={{ flex: '1 1 0', height: 4, borderRadius: '2px', bgcolor: STOW_BAR_COLOR[tone] }} />
              ))}
            </Box>
          )}
          {progressLabel && (
            <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', ...receiveMonoSx }}>
              {progressLabel}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, justifySelf: 'end', gridColumn: { xs: 2, md: 3 }, gridRow: 1 }}>
          {onBack && (
            <IconButton onClick={onBack} aria-label="Back to stow session" sx={{ width: 44, height: 44 }}>
              <ArrowLeft size={18} />
            </IconButton>
          )}
          {onExit && (
            <ReceiveFooterButton
              onClick={onExit}
              disabled={exitDisabled}
              sx={{
                height: 36,
                '&:hover': { bgcolor: 'var(--bg-2)', borderColor: 'var(--rule-2)' },
              }}
            >
              Exit
            </ReceiveFooterButton>
          )}
        </Box>
      </Box>

      <Box
        component="main"
        sx={{
          flex: '1 1 auto',
          minHeight: 0,
          overflowX: 'hidden',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box
          sx={{
            width: '100%',
            maxWidth: hasDesktopMapColumn ? 1240 : { xs: '100%', md: 600 },
            m: { xs: 0, md: 'auto' },
            boxSizing: 'border-box',
            flex: { xs: '1 0 auto', md: '0 0 auto' },
            display: 'grid',
            gridTemplateColumns: hasDesktopMapColumn ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)',
            gap: { xs: 1.5, md: 4 },
            px: { xs: 2, md: 3 },
            pt: { xs: 1.5, md: 3 },
            pb: { xs: 1, md: 3 },
          }}
        >
          {hasDesktopMapColumn && (
            <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              {map}
            </Box>
          )}
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: { xs: 1.5, md: 2 },
              minWidth: 0,
              ...(hasDesktopMapColumn && {
                p: { md: 2, lg: 3 },
                justifyContent: 'space-between',
                border: '1px solid var(--rule)',
                borderRadius: '12px',
                bgcolor: 'var(--surface)',
              }),
            }}
          >
            {children}
            {!hasDesktopMapColumn && map}
          </Box>
        </Box>
      </Box>

      {footer && (
        <Box
          component="footer"
          sx={{ flex: '0 0 auto', display: 'flex', justifyContent: 'flex-end', px: 2, py: 1 }}
        >
          {footer}
        </Box>
      )}
      {overlay}
    </Box>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function StowSessionPage({
  initialTaskId,
  initialStep = null,
  currentUserId = null,
  onComplete,
  onActiveTaskChange,
  onFetchTasks,
  onResolveLocation,
  onAssignLocation,
  onClaimTask,
  onResolveBarcode,
  onConfirmStow,
  onQuarantineStow,
  onResolveProblemBin,
  onFetchPlacements,
  floorZones,
}: StowSessionPageProps) {
  const theme = useTheme();
  // Desktop keeps the map beside execution; mobile keeps the scanner first and
  // mounts the map only when the operator asks for it.
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileMapOpen, setMobileMapOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [scannerFocusRequest, setScannerFocusRequest] = useState(0);

  const [phase,            setPhase]            = useState<Phase>('brief');
  const [tasks,            setTasks]            = useState<WmsStowTask[]>([]);
  const [currentIndex,     setCurrentIndex]     = useState(0);
  const [loading,          setLoading]          = useState(true);
  const [submitting,       setSubmitting]       = useState(false);
  const [loadError,        setLoadError]        = useState<string | null>(null);
  const [submitError,      setSubmitError]      = useState<string | null>(null);

  // STOW-SPLIT-01 — success/info feedback describes the last completed physical
  // scanner action. A new scan clears it before producing its own result.
  const [scanFeedback, setScanFeedback] = useState<StowScanFeedback | null>(null);

  // STOW-SPLIT-01 — React state alone is not an atomic scanner lock because two
  // rapid hardware scans can arrive before a rerender. This ref changes
  // synchronously and guarantees that only one scanner action runs at a time.
  const scanInFlightRef = useRef(false);

  const beginScannerAction = () => {
    if (scanInFlightRef.current) {
      // Operator-facing feedback explains what happened and what to do next;
      // the duplicate scan is deliberately not sent to inventory mutation.
      setSubmitError(null);
      setScanFeedback({
        severity: 'info',
        message:
          'The previous scan is still being saved. Wait for its confirmation, then scan again.',
      });
      return false;
    }

    scanInFlightRef.current = true;
    setSubmitting(true);
    return true;
  };

  const finishScannerAction = () => {
    scanInFlightRef.current = false;
    setSubmitting(false);
  };

  const [confirmedLocation, setConfirmedLocation] = useState<string | null>(null);

  // STOW-SPLIT-01 — this count belongs to the active physical bin, not the task.
  // It persists across task advancement while the operator stays at the same
  // location and resets only when a different bin becomes active.
  const [placedHereCount, setPlacedHereCount] = useState(0);

  // Per-unit auto-commit only needs the number of physical units still required.
  // Quantity-entry, shortfall and review state belonged to the retired bulk flow.
  const [remainingQty, setRemainingQty] = useState(0);
  // SF-PROBLEM-BIN — the shared ProblemBinScanFlow owns step state and the
  // retry identity; Stow only applies its task accounting from the result.
  const [problemBinOpen, setProblemBinOpen] = useState(false);


  // STOW-UX-SCAN-RAIL-01 — the exact LSU just committed, for the rail's
  // transient "✓ ITEM / ✓ REGISTERED" acknowledgement. Cleared at the start
  // of the next scanner action alongside scanFeedback, so the two surfaces
  // never disagree about whether a "just registered" state is showing.
  const [lastConfirmedLsu, setLastConfirmedLsu] = useState<string | null>(null);
  // SF-STOW-UX-REFINEMENT-01 — Registered is a moment, not a resting state:
  // after the acknowledgement the rail returns to Scan Item on its own. The
  // active destination and scanner focus are untouched.
  useEffect(() => {
    if (!lastConfirmedLsu) return undefined;
    const timer = setTimeout(() => setLastConfirmedLsu(null), STOW_REGISTERED_ACK_MS);
    return () => clearTimeout(timer);
  }, [lastConfirmedLsu]);

  // STOW-UX-SCAN-RAIL-01 — current-bin activity trace, task-scoped. Read-only
  // canonical projection; never locally fabricated (no optimistic rows).
  const [placements, setPlacements] = useState<StowPlacement[]>([]);
  // SF-STOW-UX-LSU-VISIBILITY-01 — LSUs committed in this session, per task. Set
  // only after onConfirmStow resolves, so the expected list updates at once
  // without waiting for the placements refetch. Server truth wins on refresh:
  // unit_ids then excludes stowed units and placements list them.
  const [registeredByTask, setRegisteredByTask] = useState<Record<string, string[]>>({});
  const [placementsError, setPlacementsError] = useState<string | null>(null);

  const currentTask = tasks[currentIndex] ?? null;

  // STOW-UX-SCAN-RAIL-01 — fetch canonical placements for the active task.
  // A read failure here is a trace-outage, not an inventory-execution outage:
  // it must never block or alter Stow scanning, only the activity panel.
  const refreshPlacements = useCallback(async (taskId: string) => {
    if (!onFetchPlacements) return;
    try {
      const rows = await onFetchPlacements(taskId);
      setPlacements(rows);
      setPlacementsError(null);
    } catch (err: unknown) {
      setPlacements([]);
      setPlacementsError(
        err instanceof Error ? err.message : 'Failed to load current-bin activity.'
      );
    }
  }, [onFetchPlacements]);

  // Task-scoped: refetch whenever the active task changes (including task
  // advancement), so Task 1's activity never leaks into Task 2's panel.
  useEffect(() => {
    if (!currentTask) {
      setPlacements([]);
      setPlacementsError(null);
      return;
    }
    void refreshPlacements(currentTask.stow_task_id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTask?.stow_task_id]);

  // STOW-UX-SCAN-RAIL-01 / STOW-SESSION-TRANSITION-01 — parent adapters may
  // be recreated during normal warehouse polling/rerenders. Keep the latest
  // task-identity callback available without making callback identity a
  // session-bootstrap dependency.
  const onActiveTaskChangeRef = useRef(onActiveTaskChange);

  useEffect(() => {
    onActiveTaskChangeRef.current = onActiveTaskChange;
    // A task load outliving this session must not report identity: the parent
    // writes it to the URL, which would reopen a session the operator has left.
    return () => {
      onActiveTaskChangeRef.current = undefined;
    };
  }, [onActiveTaskChange]);

  // ── Load tasks ──────────────────────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const all = await onFetchTasks();
        const active = all.filter((task) => {
          if (task.status === 'pending') {
            return (
              task.stow_task_id === initialTaskId ||
              task.assigned_operator_id == null ||
              task.assigned_operator_id === currentUserId
            );
          }
          if (task.status === 'in_progress') {
            return (
              task.stow_task_id === initialTaskId ||
              task.claimed_by === currentUserId
            );
          }
          return false;
        });
        const tapped = active.find(t => t.stow_task_id === initialTaskId);
        const rest   = active.filter(t => t.stow_task_id !== initialTaskId);
        const ordered = tapped ? [tapped, ...rest] : active;

        setTasks(ordered);

        if (ordered.length > 0) {
          const firstTask = ordered[0];

          // STOW-SPLIT-01 — resume from committed database progress. A partially
          // completed task must not revert to its original total quantity after
          // refresh, reconnect or Fast Refresh.
          setRemainingQty(
            Math.max(
              firstTask.quantity - firstTask.quantity_placed - (firstTask.quantity_excepted ?? 0),
              0
            )
          );

          if (tapped?.status === 'in_progress') {
            if (tapped.location_code) {
              setConfirmedLocation(tapped.location_code);
              setPlacedHereCount(tapped.quantity_placed);
              setPhase('item_scan');
              onActiveTaskChangeRef.current?.(tapped.stow_task_id, null);
            } else {
              setConfirmedLocation(null);
              setSubmitError('Scan a bin barcode first, then scan the unit.');
              setPhase('location_scan');
            }
          } else if (tapped?.status === 'pending' && initialStep === 'location') {
            setConfirmedLocation(null);
            setPlacedHereCount(0);
            setPhase('location_scan');
          } else {
            setConfirmedLocation(null);
            setPlacedHereCount(0);
            setPhase('brief');
          }
        }
      } catch (err: unknown) {
        // STOW-SPLIT-01 — session bootstrap failures must preserve the concrete
        // backend or runtime reason. A generic load error hides whether the failure
        // came from authentication, permissions, networking, or malformed data.
        const message =
          (err as { response?: { data?: { error?: string } } })
            ?.response?.data?.error ??
          (err instanceof Error
            ? err.message
            : 'Failed to load stow tasks for an unknown reason.');

        setLoadError(message);
      } finally {
        setLoading(false);
      }
    })();
  // STOW-SESSION-TRANSITION-01 — initialTaskId/initialStep are intentionally
  // NOT dependencies here. They only need to drive bootstrap once, at the
  // mount that starts a session for a given task; the parent's own
  // component-identity rules guarantee a genuine new task selection remounts
  // this component fresh (see WmsModuleFT2's `activeSession?.type === 'stow'`
  // conditional render). Once mounted, advanceToNext() reports the new
  // active task to the parent via onActiveTaskChange purely so the parent
  // can persist identity (URL/activeSession) for REFRESH recovery — that
  // parent-state sync then echoes back down as a changed initialTaskId prop
  // on this already-mounted instance. Listing it as a dependency would
  // re-run this whole fetch-and-reconstruct effect on every automatic
  // advance, an extra "backend call merely for transition identity" that
  // could also stomp the tasks array ordering out from under the currentIndex
  // advanceToNext just set. currentUserId legitimately re-runs bootstrap
  // (e.g. auth resolving after mount); when it does, the closure below still
  // reads whatever initialTaskId/initialStep this render currently holds.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  // ── Advance to next task ────────────────────────────────────────────────────
  const advanceToNext = useCallback(() => {
    const next = currentIndex + 1;

    if (next >= tasks.length) {
      setPhase('complete');
      return;
    }

    const nextTask = tasks[next];

    setCurrentIndex(next);

    setRemainingQty(
      Math.max(
        nextTask.quantity - nextTask.quantity_placed - (nextTask.quantity_excepted ?? 0),
        0
      )
    );

    setScanFeedback(null);
    setSubmitError(null);
    setLastConfirmedLsu(null);

    // STOW-SESSION-TRANSITION-01 — Task B (nextTask), not Task A, becomes the
    // canonical active session identity the instant the session advances.
    // Report it BEFORE relying on local phase state alone, so the parent's
    // activeSession.taskId and the persisted URL never lag one task behind
    // what this component is actually rendering. No claim or inventory
    // mutation happens here — this call only carries identity/phase.

    // STOW-UX-SCAN-RAIL-01 — destination is sticky only within one Stow task.
    // A newly selected pending task must establish/scan its own destination.
    // Never carry the previous task's confirmed bin into the next task.
    if (nextTask.status === 'pending') {
      setConfirmedLocation(null);
      setPlacedHereCount(0);
      setPhase('location_scan');
      onActiveTaskChange?.(nextTask.stow_task_id, 'location');
      return;
    }

    // A task already owned by this operator may resume from its persisted
    // destination and committed progress.
    if (nextTask.status === 'in_progress' && nextTask.location_code) {
      setConfirmedLocation(nextTask.location_code);
      setPlacedHereCount(nextTask.quantity_placed);
      setPhase('item_scan');
      onActiveTaskChange?.(nextTask.stow_task_id, null);
      return;
    }

    // Defensive recovery for an impossible/incomplete in-progress state.
    setConfirmedLocation(null);
    setPlacedHereCount(nextTask.quantity_placed);
    setSubmitError('Scan a bin barcode first, then scan the unit.');
    setPhase('location_scan');
    onActiveTaskChange?.(nextTask.stow_task_id, 'location');
  }, [currentIndex, tasks, onActiveTaskChange]);

  // ── Node 1: Item scan ───────────────────────────────────────────────────────
  const handleItemScan = useCallback(async (scannedValue: string) => {
    if (!currentTask) {
      // STOW-SPLIT-01 — scanner input without an active task is an invalid
      // session state. Fail explicitly so the operator and logs have a concrete
      // reason instead of silently discarding a physical scan.
      throw Object.assign(new Error('No active stow task.'), {
        response: {
          data: {
            error: 'Cannot scan an item because no active stow task is loaded.',
          },
        },
      });
    }

    setSubmitError(null);
    setScanFeedback(null);
    setLastConfirmedLsu(null);

    // STOW-SPLIT-01 — every new scan starts with a clean feedback surface.
    // The previous success remains visible until this point, then this scan owns
    // the next success, bin-change message or operator-friendly error.

    // STOW-SPLIT-01 — the session uses one scanner vocabulary. A bin scan
    // always takes precedence over an item scan so the operator can change
    // physical position at any point without leaving the active workflow.
    const resolvedLocation = await onResolveLocation(scannedValue);

    if (resolvedLocation?.location_code) {
      const isSameActiveLocation =
        Boolean(confirmedLocation) &&
        resolvedLocation.location_code === confirmedLocation;

      if (isSameActiveLocation) {
        // STOW-ACTIVE-LOCATION-01 — re-scanning the already-active bin is a
        // no-op: remain active, no unnecessary claim, no unnecessary
        // location mutation.
        setScanFeedback(null);
        setPhase('item_scan');
        return;
      }

      if (confirmedLocation) {
        // STOW-ACTIVE-LOCATION-01 — supersedes the earlier "one Stow task =
        // one immutable destination" rule. stow_tasks.location_code is now
        // the CURRENT / STICKY destination: the claiming operator may switch
        // it mid-task. This never rewrites where units already committed to
        // the previous bin physically are — that exact history stays in
        // inventory_movements / inventory_units.current_location_code and
        // remains visible in the task-wide activity panel. Only units
        // confirmed AFTER this point land at the new bin. Never call
        // onClaimTask or onConfirmStow here — a bin switch alone must not
        // claim again or commit any unit.
        await onAssignLocation(
          currentTask.stow_task_id,
          resolvedLocation.location_code
        );

        setTasks(prev => prev.map((task, index) =>
          index === currentIndex
            ? { ...task, location_code: resolvedLocation.location_code }
            : task
        ));

        setConfirmedLocation(resolvedLocation.location_code);
        setScanFeedback({
          severity: 'success',
          message: `${resolvedLocation.location_code} is now active`,
        });
        setPhase('item_scan');
        return;
      }

      // No active destination yet for this task — first bin scan
      // establishes and claims it (unchanged pre-claim behavior).
      if (resolvedLocation.location_code !== currentTask.location_code) {
        await onAssignLocation(
          currentTask.stow_task_id,
          resolvedLocation.location_code
        );
      }

      await onClaimTask(currentTask.stow_task_id);

      setTasks(prev => prev.map((task, index) =>
        index === currentIndex
          ? {
              ...task,
              location_code: resolvedLocation.location_code,
              status: 'in_progress',
            }
          : task
      ));

      setConfirmedLocation(resolvedLocation.location_code);
      onActiveTaskChange?.(currentTask.stow_task_id, null);

      // STOW-SPLIT-01 — the active-bin card is the authoritative destination state.
      // A physical bin switch already updates that card and resets placedHereCount,
      // so additional transient copy would only repeat information on screen.
      setPhase('item_scan');
      return;
    }

    // Location-first is an inventory-safety rule, not just presentation.
    // Never accept a physical unit when the session has no confirmed bin.
    if (!confirmedLocation) {
      throw Object.assign(new Error('No active location.'), {
        response: {
          data: {
            error: 'Scan a bin barcode first, then scan the unit.',
          },
        },
      });
    }

    // The sticky location survives task advancement, but each new task still
    // owns its persisted destination. Synchronise that destination before any
    // unit can be committed so ledger movements use the physical active bin.
    if (currentTask.location_code !== confirmedLocation) {
      await onAssignLocation(currentTask.stow_task_id, confirmedLocation);

      setTasks(prev => prev.map((task, index) =>
        index === currentIndex
          ? {
              ...task,
              location_code: confirmedLocation,
            }
          : task
      ));
    }

    // A newly auto-advanced task may still be pending even though the operator
    // and active location are unchanged. Claim it before accepting its unit.
    await onClaimTask(currentTask.stow_task_id);

    const resolved = await onResolveBarcode(scannedValue);
    if (!resolved?.lasyncro_variant_id) {
      throw Object.assign(new Error('Barcode not recognised.'), {
        response: { data: { error: 'Barcode not recognised. Try scanning again or check the label.' } },
      });
    }
    if (resolved.lasyncro_variant_id !== currentTask.lasyncro_variant_id) {
      throw Object.assign(new Error('Wrong product.'), {
        response: { data: { error: 'Wrong product — does not match this stow task.' } },
      });
    }
    // INV-BLOCK-10b-LSU-01 — cancellation recovery is unit-specific.
    //
    // Scoped deliberately to order_cancelled_mid_pick: inbound stow units of
    // the same variant are fungible, and the receive→stow flow relies on a
    // generic product barcode resolving to any received sibling. Widening
    // this to all triggers would change that verified behaviour.
    //
    // Both LSUs of a variant share one shopify_barcode, so a generic scan
    // cannot discriminate them. unit_ids (now trigger-aware server-side)
    // is the task's declaration of which physical unit satisfies it. The
    // backend guard in confirmStow remains authoritative; this check exists
    // to fail fast at scan time with a message naming the required LSU.
    //
    // S4-5 I5 — a receive_recovery Stow recovers exactly one held LSU
    // (unit_ids = that LSU, server-side). A generic product barcode or a
    // sibling LSU never substitutes for it, and with no declared LSU the scan
    // fails closed. confirmStow re-checks the exact LSU and stays authoritative.
    const exactUnitRequired = requiresExactUnit(currentTask);
    if (
      exactUnitRequired &&
      (!resolved.lasyncro_unit_id ||
        !(currentTask.unit_ids ?? []).includes(resolved.lasyncro_unit_id))
    ) {
      throw Object.assign(new Error('Wrong unit.'), {
        response: {
          data: {
            error: `This task recovers a specific unit. Scan ${(currentTask.unit_ids ?? []).join(' or ')}.`,
          },
        },
      });
    }

    if (!resolved.lasyncro_unit_id) {
      // STOW-SPLIT-01 — the redesigned session is strictly per-unit. A variant-only
      // resolution is not enough to mutate inventory because every placement must
      // be attributable to one physical LSU and therefore one ledger identity.
      throw Object.assign(new Error('Physical unit not resolved.'), {
        response: {
          data: {
            error: 'No physical unit is available for this scan. Scan the LSU label or check the unit state.',
          },
        },
      });
    }

    // STOW-SPLIT-01 — one successful physical scan commits exactly one unit.
    // The page-level scanner lock remains active for this entire asynchronous
    // action and is released by the caller regardless of success or failure.
    const confirmResult = await onConfirmStow(
      currentTask.stow_task_id,
      1,
      resolved.lasyncro_unit_id
    );

    // STOW-SPLIT-01 — persisted backend progress is authoritative. Keep the local
    // task snapshot aligned with the committed cumulative quantity instead of
    // reconstructing progress from scanner-local decrements.
    setTasks(prev => prev.map((task, index) =>
      index === currentIndex
        ? {
            ...task,
            quantity_placed: confirmResult.quantity_placed,
            quantity_excepted: confirmResult.quantity_excepted ?? 0,
          }
        : task
    ));

    // Update UI state only after the backend transaction succeeds. Failed writes
    // must never increment either the active-bin count or task progress.
    const nextPlacedHereCount = placedHereCount + 1;
    setPlacedHereCount(nextPlacedHereCount);

    const authoritativeRemaining = Math.max(
      confirmResult.quantity_total - confirmResult.quantity_placed - (confirmResult.quantity_excepted ?? 0),
      0
    );

    // STOW-SPLIT-01 — successful feedback acknowledges the physical scan only.
    // Active location, placed-here count and remaining quantity already have
    // dedicated persistent surfaces and must not be repeated here.
    // SF-STOW-UX-REFINEMENT-01 — only an exact match with the task's vetted
    // product barcode is named; resolution_method alone proves nothing.
    const taskBarcode = scannableProductBarcode(currentTask);
    const productBarcode = taskBarcode !== null && scannedValue.trim() === taskBarcode ? taskBarcode : null;
    setScanFeedback({
      severity: 'success',
      message: `Unit placed · ${resolved.lasyncro_unit_id}${productBarcode ? ` · Barcode ${productBarcode}` : ''}`,
    });

    // STOW-UX-SCAN-RAIL-01 — drives the rail's transient ✓ ITEM / ✓ REGISTERED
    // acknowledgement; only ever set after onConfirmStow has already resolved.
    setLastConfirmedLsu(resolved.lasyncro_unit_id);
    const committedLsu = resolved.lasyncro_unit_id;
    setRegisteredByTask((prev) => ({
      ...prev,
      [currentTask.stow_task_id]: [...(prev[currentTask.stow_task_id] ?? []), committedLsu],
    }));

    if (!confirmResult.is_fully_placed) {
      setRemainingQty(authoritativeRemaining);
      setSubmitError(null);

      // Reload canonical placements so the current-bin activity panel
      // reflects this commit — never an optimistic local row. Scoped to the
      // "more units to go" branch only: when this confirm completes the
      // task (else branch), advanceToNext changes currentTask.stow_task_id,
      // which the task-scoped effect above already refetches for. Firing
      // both here would race two concurrent fetches for two different task
      // ids against the same setPlacements call.
      void refreshPlacements(currentTask.stow_task_id);

      // Unit identity is scoped to this scanner event. Once the caller releases
      // the lock, the scanner is immediately ready for the next unit or bin.
      setPhase('item_scan');
    } else {
      // STOW-SPLIT-01 — completion is decided by the committed server result.
      // Browser-local remaining state may have been reconstructed after refresh
      // and therefore must never be authoritative for warehouse completion.
      advanceToNext();
    }
  }, [
  currentTask,
  currentIndex,
  confirmedLocation,
  placedHereCount,
  remainingQty,
  advanceToNext,
  onResolveLocation,
  onAssignLocation,
  onClaimTask,
  onResolveBarcode,
  onConfirmStow,
  onActiveTaskChange,
  refreshPlacements,
]);

  // ── Node 2: Location scan ───────────────────────────────────────────────────
  const handleLocationScan = useCallback(async (scannedValue: string) => {
    if (!currentTask) {
      // STOW-SPLIT-01 — a bin must never be assigned without an identified task.
      // Throw an actionable error rather than allowing the scan to disappear.
      throw Object.assign(new Error('No active stow task.'), {
        response: {
          data: {
            error: 'Cannot activate a bin because no active stow task is loaded.',
          },
        },
      });
    }

    setSubmitError(null);
    setScanFeedback(null);

    const resolved = await onResolveLocation(scannedValue);
    if (!resolved?.location_code) {
      throw Object.assign(new Error('Location not found.'), {
        response: { data: { error: 'Location not recognised. Try scanning the bin barcode.' } },
      });
    }

    // STOW-SPLIT-01 — a claimed task may move between bins while units remain.
    if (resolved.location_code !== currentTask.location_code) {
      await onAssignLocation(currentTask.stow_task_id, resolved.location_code);
    }

    // STOW-SPLIT-01 — task-location synchronisation and physical movement are
    // separate concepts. Preserve the running count when the same active bin is
    // merely being attached to a newly advanced task.
    if (
      confirmedLocation &&
      resolved.location_code !== confirmedLocation
    ) {
      setPlacedHereCount(0);
    }

    // STOW-SPLIT-01 — claimStowTask is intentionally idempotent when the same
    // operator resumes their own in-progress task. Any other claim failure is
    // meaningful and must propagate to the scanner error UI instead of being
    // silently treated as success.
    await onClaimTask(currentTask.stow_task_id);

    setTasks(prev => prev.map((t, i) =>
      i === currentIndex
        ? {
            ...t,
            location_code: resolved.location_code,
            status: 'in_progress',
          }
        : t
    ));

    setConfirmedLocation(resolved.location_code);
    onActiveTaskChange?.(currentTask.stow_task_id, null);
    // STOW-SPLIT-01 — the active-bin card immediately reflects the newly scanned
    // destination and its reset placed-here count. Do not duplicate that state
    // with a second informational message below the scanner.

    // Activating a bin is the first operational action. Once active, the next
    // required action is scanning a physical unit.
    setPhase('item_scan');
  }, [
  currentTask,
  currentIndex,
  confirmedLocation,
  onResolveLocation,
  onAssignLocation,
  onClaimTask,
  onActiveTaskChange,
]);

  // ── Presentation (STOW-UX-01) ───────────────────────────────────────────────
  // Everything below renders session state only. Scanner handlers, task
  // ordering, claim/assign/confirm calls and resume all live above unchanged.
  const taskProgressLabel = currentTask
    ? `${currentTask.quantity_placed} / ${currentTask.quantity}`
    : '0 / 0';
  const taskPositionLabel = currentTask
    ? `Stow ${currentIndex + 1} of ${tasks.length}`
    : '';
  // Most-recently-activated bin, else the task's suggested bin (guidance only).
  const destinationCode = confirmedLocation ?? currentTask?.location_code ?? null;
  const destinationPath = destinationCode ? describeLocationPath(destinationCode, floorZones) : [];
  // Orientation serves a live task: never on loading, empty or finished screens.
  const showMap = hasPlacedFloor(floorZones) && Boolean(currentTask) && phase !== 'complete';
  const destinationOnMap = Boolean(
    destinationCode &&
    floorZones?.some(
      (zone) =>
        zone.location_code === destinationCode &&
        zone.position_x != null &&
        zone.position_y != null,
    ),
  );
  const bars: StowBarTone[] = tasks.map((_, index) =>
    phase === 'complete' || index < currentIndex
      ? 'done'
      : index === currentIndex
        ? 'current'
        : 'idle',
  );

  const leaveSession = () => {
    setExitOpen(false);
    onComplete();
  };

  const resumeScanning = () => {
    setExitOpen(false);
    setScannerFocusRequest((request) => request + 1);
  };

  const toggleMobileMap = () => {
    setMobileMapOpen((open) => !open);
    // A hardware scan must never land on the toggle: its Enter would flip the
    // map and drop the scan instead of reaching the scanner input.
    setScannerFocusRequest((request) => request + 1);
  };

  const desktopMapLayout = showMap && isDesktop;

  const mapRegion = showMap && (isDesktop || mobileMapOpen) ? (
    <StowFloorMap
      zones={floorZones ?? []}
      destinationCode={destinationCode}
      destinationConfirmed={Boolean(confirmedLocation)}
      destinationOnMap={destinationOnMap}
      placements={placements}
    />
  ) : null;

  const renderShell = (column: ReactNode, facts?: ReactNode) => (
    <StowSessionShell
      sourceLabel={currentTask ? triggerLabel(currentTask.trigger) : 'Warehouse'}
      positionLabel={taskPositionLabel}
      progressLabel={currentTask ? taskProgressLabel : ''}
      bars={bars}
      onBack={
        phase === 'item_scan' || phase === 'location_scan'
          ? () => setPhase('brief')
          : undefined
      }
      onExit={phase === 'complete' ? undefined : (currentTask ? () => setExitOpen(true) : leaveSession)}
      exitDisabled={submitting}
      map={mapRegion}
      desktopMapLayout={desktopMapLayout}
      footer={
        showMap && !isDesktop ? (
          <ReceiveFooterButton
            onClick={toggleMobileMap}
            aria-expanded={mobileMapOpen}
            aria-controls="stow-warehouse-map"
          >
            {mobileMapOpen ? 'Hide map' : 'Show map'}
          </ReceiveFooterButton>
        ) : undefined
      }
      overlay={
        <ReceiveExitSheet
          open={exitOpen}
          eyebrow="Leave stow"
          title="Progress is"
          accent="saved."
          body={
            currentTask?.status === 'in_progress'
              ? 'Exiting does not undo units already placed. Your progress remains saved.'
              : 'This task has not been claimed. It stays available in Warehouse Operations.'
          }
          onDismiss={resumeScanning}
        >
          <ReceiveCta onClick={resumeScanning}>Keep stowing</ReceiveCta>
          <ReceiveCta tier="secondary" onClick={leaveSession}>Back to Warehouse</ReceiveCta>
        </ReceiveExitSheet>
      }
    >
      {column}
      {desktopMapLayout && facts ? <Box sx={{ mt: 'auto' }}>{facts}</Box> : facts}
    </StowSessionShell>
  );

  // SF-STOW-UX-REFINEMENT-01 / SF-STOW-UX-LSU-VISIBILITY-01 — what to scan sits
  // in the item line: name → expected LSU(s) → optional barcode → secondary SKU.
  // Only task-scoped projections are listed (TASK_SCOPED_UNIT_TRIGGERS); any
  // other trigger, or a missing projection, is an inline unavailable state.
  // Registered = canonical placements for this task plus this session's
  // committed scans, so a confirmed unit leaves the list at once.
  const productBarcode = currentTask ? scannableProductBarcode(currentTask) : null;
  const registeredLsus = currentTask
    ? Array.from(new Set([
        ...placements.map((p) => p.lasyncro_unit_id),
        ...(registeredByTask[currentTask.stow_task_id] ?? []),
      ]))
    : [];
  const unitListScoped = Boolean(currentTask && TASK_SCOPED_UNIT_TRIGGERS.has(currentTask.trigger));
  const pendingLsus = unitListScoped
    ? (currentTask?.unit_ids ?? []).filter((id) => !registeredLsus.includes(id))
    : [];
  const exactUnitTask = Boolean(currentTask && requiresExactUnit(currentTask));
  const unitListUnavailable = Boolean(currentTask) && (!unitListScoped || (pendingLsus.length === 0 && remainingQty > 0));

  const itemIdentity = currentTask ? (
    <>
      {pendingLsus.length > 0 ? (
        <Box
          component="ul"
          aria-label={exactUnitTask ? 'Required unit label' : 'Expected unit labels'}
          data-testid="stow-item-lsus"
          sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}
        >
          {pendingLsus.map((lsu) => (
            <Box
              component="li"
              key={lsu}
              data-lsu={lsu}
              sx={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', letterSpacing: 0, overflowWrap: 'anywhere' }}
            >
              {lsu}
            </Box>
          ))}
        </Box>
      ) : unitListUnavailable ? (
        <Box component="span" role="note" data-testid="stow-item-lsus-unavailable" sx={{ display: 'block', color: 'var(--ink-2)' }}>
          {exactUnitTask
            ? 'Required unit label unavailable. Ask a supervisor before scanning.'
            : 'Unit labels unavailable for this task. Scan the label on each unit.'}
        </Box>
      ) : (
        <Box component="span" data-testid="stow-item-lsus-done" sx={{ display: 'block', color: 'var(--good-ink)' }}>
          All expected units registered
        </Box>
      )}
      {productBarcode ? (
        <Box component="span" data-testid="stow-item-barcode" sx={{ display: 'block', color: 'var(--ink-2)' }}>
          Barcode {productBarcode}
        </Box>
      ) : null}
      {currentTask.sku ? (
        <Box component="span" data-testid="stow-item-sku" sx={{ display: 'block', fontSize: 11 }}>
          SKU <Box component="span">{currentTask.sku}</Box>
        </Box>
      ) : null}
    </>
  ) : null;

  const itemLine = currentTask ? (
    <ReceiveItemLine
      name={currentTask.product_title ?? currentTask.variant_title ?? currentTask.sku ?? 'Item unavailable'}
      identity={itemIdentity}
      media={
        currentTask.image_url ? (
          <Box
            component="img"
            src={currentTask.image_url}
            alt=""
            sx={{ width: 44, height: 44, objectFit: 'cover', borderRadius: '8px', flexShrink: 0, border: '1px solid var(--rule)' }}
          />
        ) : (
          <Box sx={{ width: 44, height: 44, borderRadius: '8px', bgcolor: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Package size={18} aria-hidden="true" style={{ opacity: 0.5 }} />
          </Box>
        )
      }
    />
  ) : null;

  // S4-5 I5 — exact-LSU recovery guidance. The held unit was never in
  // inventory; it is credited once, only by this confirmed scan.
  const recoveryGuidance = currentTask?.trigger === 'receive_recovery' ? (
    <Box
      data-testid="stow-recovery-guidance"
      sx={{ p: 1.5, border: '1px solid var(--rule-2)', borderRadius: '10px', bgcolor: 'var(--surface)' }}
    >
      <Typography variant="caption" sx={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--ink-3)' }}>
        Required unit
      </Typography>
      <Typography variant="body2" sx={{ ...receiveMonoSx, fontWeight: 600, overflowWrap: 'anywhere' }}>
        {(currentTask.unit_ids ?? []).length > 0 ? (currentTask.unit_ids ?? []).join(', ') : 'Unavailable'}
      </Typography>
      <Typography variant="caption" sx={{ display: 'block', color: 'var(--ink-3)' }}>
        Scan an eligible storage bin, then this exact unit label. A product barcode is not accepted. Inventory is credited only when this scan is confirmed.
      </Typography>
    </Box>
  ) : null;

  const pathLine = destinationPath.length > 0 ? (
    <Box component="span" sx={{ display: 'block', ...receiveMonoSx, fontSize: 12, color: 'var(--ink-3)' }}>
      Found in {destinationPath.join(' › ')}
    </Box>
  ) : null;

  const handleStowQuarantined = (result: WmsStowConfirmResult, lsu: string, bin: string) => {
    if (!currentTask) return;
    const taskId = currentTask.stow_task_id;
    setTasks(prev => prev.map(t => t.stow_task_id === taskId ? { ...t,
      quantity_placed: result.quantity_placed, quantity_excepted: result.quantity_excepted ?? 0,
      unit_ids: (t.unit_ids ?? []).filter(id => id !== lsu) } : t));
    setRemainingQty(Math.max(0, result.quantity_total - result.quantity_placed - (result.quantity_excepted ?? 0)));
    setProblemBinOpen(false);
    setSubmitError(null);
    setScanFeedback({ severity: 'success', message: `Unit quarantined · ${lsu} · ${bin}` });
    setScannerFocusRequest(n => n + 1);
    if (result.is_fully_placed) advanceToNext();
  };

  const scanFeedbackLines = (
    <>
      {scanFeedback && (
        <ReceiveStatusLine tone={scanFeedback.severity === 'success' ? 'ok' : 'neutral'} role="status">
          {scanFeedback.message}
        </ReceiveStatusLine>
      )}
      {submitError && (
        <ReceiveStatusLine tone="error" role="alert">
          {submitError}
        </ReceiveStatusLine>
      )}
    </>
  );

  const executionFacts = currentTask ? (
    <Box
      sx={
        desktopMapLayout
          ? {
              height: '100%',
              // A half-width panel is too narrow for three equal columns: the
              // counts size to their content and a long bin code truncates. Its
              // full code stays in the page's heading or directions.
              '& > div': {
                height: '100%',
                boxSizing: 'border-box',
                gridTemplateColumns: 'minmax(0, 1fr) auto auto',
              },
              '& > div > div': { alignContent: 'center', minWidth: 0 },
              '& > div > div > span:last-of-type': {
                fontSize: 18,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
            }
          : undefined
      }
    >
      <ReceiveFactStrip
        facts={[
          { label: 'Destination', value: destinationCode ?? '—', highlight: true },
          { label: 'Quarantined', value: currentTask.quantity_excepted ?? 0 },
          { label: 'Remaining', value: remainingQty },
          { label: 'Units', value: currentTask.quantity },
        ]}
      />
    </Box>
  ) : null;

  // STOW-UX-SCAN-RAIL-01 — LOCATION -> ITEM -> REGISTERED is the single
  // primary execution rail. "items"/"complete" test ids are preserved
  // exactly (StowSessionFocusUx.test.tsx already asserts on them) even
  // though the visible copy now reads "Item" — the id is a stable contract,
  // the label is presentation.
  const justRegistered = Boolean(lastConfirmedLsu);
  const hasStartedThisTask = Boolean(currentTask && currentTask.quantity_placed > 0);
  const registeredMeta = justRegistered
    ? `${currentTask?.product_title ?? currentTask?.sku ?? 'Item'} → ${confirmedLocation ?? ''}`
    : phase === 'complete'
      ? 'Task complete'
      : currentTask
        ? `${currentTask.quantity_placed} / ${currentTask.quantity} placed`
        : 'Waiting';

  type StageState = 'active' | 'complete' | 'pending';
  // A destination already scanned stays confirmed, even when the operator
  // steps back through the brief to the bin screen.
  const locationStageState: StageState = confirmedLocation
    ? 'complete'
    : phase === 'brief' || phase === 'location_scan'
      ? 'active'
      : 'pending';
  const stages: { id: string; label: string; meta: string; state: StageState }[] = [
    {
      id: 'location',
      label: 'Location',
      // A suggestion until scanned; the confirmed destination always wins.
      meta: confirmedLocation ?? currentTask?.location_code ?? 'Scan destination',
      state: locationStageState,
    },
    {
      id: 'items',
      label: 'Scan Item',
      meta: justRegistered
        ? lastConfirmedLsu!
        : phase === 'item_scan'
          ? (hasStartedThisTask ? 'Next unit' : 'First unit')
          : phase === 'complete'
            ? 'Task complete'
            : 'Waiting',
      state: justRegistered || phase === 'complete' ? 'complete' : phase === 'item_scan' ? 'active' : 'pending',
    },
    {
      id: 'complete',
      label: 'Registered',
      meta: registeredMeta,
      // Only after onConfirmStow has resolved (justRegistered), never on
      // barcode recognition alone. Registered is never itself "active".
      state: justRegistered || phase === 'complete' ? 'complete' : 'pending',
    },
  ];

  // SF-STOW-UX-REFINEMENT-01 — one connected indicator: the active step
  // pulses orange, completed steps and the connectors behind them are green.
  const STAGE_NODE = 22;
  const stageRail = (
    <Box
      component="ol"
      aria-label="Stow progress"
      sx={{
        listStyle: 'none',
        m: 0,
        p: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        '@keyframes stowStepPulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent)' },
          '50%': { boxShadow: '0 0 0 6px color-mix(in srgb, var(--accent) 0%, transparent)' },
        },
      }}
    >
      {stages.map((stage, index) => {
        const isComplete = stage.state === 'complete';
        const isActive = stage.state === 'active';
        const tone = isComplete ? 'var(--good-ink)' : isActive ? 'var(--accent)' : 'var(--rule-2)';
        const showSwitchHint = stage.id === 'location' && isComplete && phase === 'item_scan';
        return (
          <Box
            component="li"
            key={stage.id}
            data-testid={`stow-stage-${stage.id}`}
            data-state={stage.state}
            aria-current={isActive ? 'step' : undefined}
            sx={{
              position: 'relative',
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              px: 0.5,
              // Connector to the next step: green once this step is done.
              ...(index < stages.length - 1 && {
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  top: STAGE_NODE / 2 - 1,
                  left: `calc(50% + ${STAGE_NODE / 2 + 4}px)`,
                  right: `calc(-50% + ${STAGE_NODE / 2 + 4}px)`,
                  height: 2,
                  borderRadius: 1,
                  bgcolor: isComplete ? 'var(--good-ink)' : 'var(--rule)',
                  transition: 'background-color 200ms ease',
                },
              }),
            }}
          >
            <Box
              aria-hidden="true"
              data-testid={`stow-stage-${stage.id}-node`}
              data-pulse={isActive ? 'true' : 'false'}
              sx={{
                width: STAGE_NODE,
                height: STAGE_NODE,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
                lineHeight: 1,
                color: isComplete ? 'var(--bg)' : tone,
                bgcolor: isComplete ? 'var(--good-ink)' : isActive ? 'var(--accent-ghost)' : 'transparent',
                border: '2px solid',
                borderColor: tone,
                transition: 'background-color 200ms ease, border-color 200ms ease',
                animation: isActive ? 'stowStepPulse 1.8s ease-in-out infinite' : 'none',
                '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
              }}
            >
              {isComplete ? '✓' : index + 1}
            </Box>
            <Typography
              variant="caption"
              component="div"
              sx={{
                mt: 0.5,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                fontWeight: 600,
                color: isComplete ? 'var(--good-ink)' : isActive ? 'var(--accent-text)' : 'var(--ink-3)',
              }}
            >
              {stage.label}
              {showSwitchHint && (
                <Tooltip
                  title="To switch destination, scan another bin."
                  placement="top"
                  arrow
                  enterTouchDelay={0}
                  leaveTouchDelay={3000}
                >
                  {/* Not focusable: a hardware scan must keep landing in the scanner. */}
                  <Box
                    component="span"
                    data-testid="stow-location-switch-hint"
                    sx={{ display: 'inline-flex', color: 'var(--ink-3)', cursor: 'help' }}
                  >
                    <Info size={12} aria-hidden="true" />
                  </Box>
                </Tooltip>
              )}
            </Typography>
            <Typography
              variant="caption"
              component="div"
              noWrap
              title={stage.meta}
              sx={{ maxWidth: '100%', color: 'var(--ink-3)', fontSize: 11, ...(stage.id === 'location' && receiveMonoSx) }}
            >
              {stage.meta}
            </Typography>
            {showSwitchHint && (
              // The same guidance for assistive tech, which cannot hover.
              <Box component="span" sx={visuallyHiddenSx}>
                To switch destination, scan another bin.
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );

  // STOW-UX-SCAN-RAIL-01 / STOW-ACTIVE-LOCATION-01 — canonical, server-committed
  // history of everything registered by this task. Read-only and task-wide, not
  // current-bin-only: a row placed at a bin the operator has since switched away
  // from stays here with its original location. Never an optimistic local row.
  const currentBinActivity = confirmedLocation ? (
    <Box
      data-testid="stow-bin-activity"
      sx={{
        p: 1.5,
        border: '1px solid var(--rule)',
        borderRadius: '10px',
        bgcolor: 'var(--surface)',
        maxHeight: { md: 180 },
        overflowY: { md: 'auto' },
      }}
    >
      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5 }}>
        Stow activity · {placements.length} registered
      </Typography>

      {placementsError ? (
        <Typography variant="caption" color="text.secondary">
          Activity history is unavailable right now. Stow scanning is unaffected.
        </Typography>
      ) : placements.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          No units registered here yet.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {placements.map((p) => (
            <Box key={p.lasyncro_unit_id}>
              <Typography variant="body2" fontWeight={500}>
                ✓ {p.product_title ?? p.variant_title ?? p.sku ?? 'Item'} ·{' '}
                <Box
                  component="span"
                  title={p.lasyncro_unit_id}
                  sx={{ fontFamily: 'monospace' }}
                >
                  {shortenLsu(p.lasyncro_unit_id)}
                </Box>{' '}
                registered in {p.location_code}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                by {p.operator_name ?? 'Unknown operator'} · {formatPlacementTimestamp(p.occurred_at)}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  ) : null;

  // ── BRIEF ───────────────────────────────────────────────────────────────────
  if (phase === 'brief') {
    if (loading) {
      return renderShell(
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
          <CircularProgress size={32} />
        </Box>,
      );
    }
    if (loadError) return renderShell(<Alert severity="error">{loadError}</Alert>);
    if (tasks.length === 0) return renderShell(<Alert severity="info">No stow tasks pending.</Alert>);

    // STOW-BRIEF-DECLUTTER-01 — the LOCATION/ITEM/REGISTERED rail is active
    // execution UI and deliberately does not render on Brief.
    return renderShell(
      <>
        <ReceiveTaskHeading
          eyebrow="Review task"
          title="Stow Session"
          sub="Review the selected task, then scan a destination bin to claim it."
        />
        <Box data-testid="stow-directions" sx={{ textAlign: 'center' }}>
          {destinationCode ? (
            <>
              <Typography component="div" sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                Suggested destination
              </Typography>
              <Typography component="div" sx={{ ...receiveMonoSx, fontSize: 18, fontWeight: 500, overflowWrap: 'anywhere' }}>
                {destinationCode}
              </Typography>
            </>
          ) : (
            <Typography sx={{ fontSize: 14, color: 'var(--ink-2)' }}>
              No destination yet — you choose one by scanning a bin.
            </Typography>
          )}
          {pathLine}
        </Box>
        {itemLine}
        {recoveryGuidance}
        {/* Metrics beside the action on a wide desktop; everywhere else the
            action comes first, then the metrics, as a stack. */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: desktopMapLayout ? 'minmax(0, 1fr) 208px' : 'minmax(0, 1fr)' },
            gap: { xs: 1.5, md: 2, lg: desktopMapLayout ? 1.5 : 2 },
            mt: { xs: 'auto', md: 0 },
          }}
        >
          <ReceiveCta
            onClick={() => {
              if (currentTask) onActiveTaskChange?.(currentTask.stow_task_id, 'location');
              setPhase('location_scan');
            }}
            sx={desktopMapLayout ? { gridColumn: { lg: 2 }, gridRow: { lg: 1 }, height: { lg: 'auto' }, minHeight: { lg: 56 } } : undefined}
          >
            {currentTask?.status === 'in_progress' ? 'Resume stowing' : 'Claim & start stowing'}
          </ReceiveCta>
          <Box sx={desktopMapLayout ? { gridColumn: { lg: 1 }, gridRow: { lg: 1 }, minWidth: 0 } : undefined}>
            {executionFacts}
          </Box>
        </Box>
      </>,
    );
  }

  // ── COMPLETE ─────────────────────────────────────────────────────────────────
  if (phase === 'complete') {
    return renderShell(
      <>
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <CheckCircle size={48} color="var(--good-ink)" aria-hidden="true" />
        </Box>
        <ReceiveTaskHeading
          eyebrow="Complete"
          eyebrowTone="ok"
          title="Stow complete"
          sub={`${tasks.length} SKU${tasks.length !== 1 ? 's' : ''} stowed. Inventory updated.`}
        />
        {stageRail}
        <ReceiveActions>
          <ReceiveCta onClick={onComplete}>Exit Stow</ReceiveCta>
        </ReceiveActions>
      </>,
    );
  }

  if (!currentTask) {
    // STOW-SPLIT-01 — reaching an active session phase without a task means the
    // UI state and loaded task queue have diverged. Do not render a blank screen:
    // surface the exact invariant failure so the operator knows why work stopped.
    return renderShell(
      <Alert severity="error">
        Cannot continue stowing because no active stow task is loaded.
      </Alert>,
    );
  }

  // ── ITEM SCAN (Node 1) ───────────────────────────────────────────────────────
  if (phase === 'item_scan') {
    return renderShell(
      <>
        <ReceiveTaskHeading
          eyebrow="Scan item"
          title="Scan"
          accent={hasStartedThisTask ? 'the next unit.' : 'a unit.'}
          sub={
            <Box component="span" data-testid="stow-directions">
              Placing into {destinationCode}.
              {pathLine}
            </Box>
          }
        />
        {itemLine}
        {recoveryGuidance}
        {problemBinOpen && currentTask && onQuarantineStow && onResolveProblemBin ? <ProblemBinScanFlow<WmsStowConfirmResult>
          onResolveBin={onResolveProblemBin}
          onQuarantine={(lsu, bin, eventId) => onQuarantineStow(currentTask.stow_task_id, lsu, bin, eventId)}
          onQuarantined={handleStowQuarantined}
          onExit={() => { setProblemBinOpen(false); setSubmitError(null); setScannerFocusRequest(n => n + 1); }}
          exitLabel="Continue Stow"
          disabled={submitting}
        /> : <ScanInput
          key="item_scan"
          hint="Scan item barcode (LSU- or product barcode)"
          error={submitError}
          disabled={submitting}
          focusRequest={scannerFocusRequest}
          onSubmit={(v) => {
            if (!beginScannerAction()) return;

            void handleItemScan(v)
              .catch((err: unknown) => {
                // Failed scans replace previous positive feedback with an actionable
                // operator message. Technical detail remains diagnostic only.
                setScanFeedback(null);
                const scanned = v.trim();
                const message = getStowOperatorError(err, 'item_scan');
                // SF-STOW-UX-LSU-VISIBILITY-01 — presentation only: the server
                // refused it; say why when the scan is a unit already registered.
                setSubmitError(
                  message.startsWith('Wrong unit.') && registeredLsus.includes(scanned)
                    ? `${scanned} is already registered. Scan one of the expected unit labels.`
                    : message,
                );
              })
              .finally(() => {
                finishScannerAction();
              });
          }}
        />}
        {phase === 'item_scan' && !problemBinOpen && currentTask?.quarantine_enabled && currentTask.trigger === 'inbound_stock' && onQuarantineStow && onResolveProblemBin && (
          <Button disabled={submitting} onClick={() => { setProblemBinOpen(true); setScanFeedback(null); setSubmitError(null); }}>Problem Bin</Button>
        )}
        {scanFeedbackLines}
        {stageRail}
        {currentBinActivity}
      </>,
      executionFacts,
    );
  }

  // ── LOCATION SCAN (Node 2) ───────────────────────────────────────────────────
  if (phase === 'location_scan') {
    // STOW-SPLIT-01 — location is activated before any physical item scan, and
    // the suggested bin remains guidance only until its label is scanned.
    const suggestedBin = currentTask.location_code;
    return renderShell(
      <>
        <ReceiveTaskHeading
          eyebrow={suggestedBin ? 'Suggested bin' : 'Scan location'}
          title={suggestedBin ? 'Go to' : 'Scan a'}
          accent={suggestedBin ? `${suggestedBin}.` : 'destination bin.'}
          sub={
            <Box component="span" data-testid="stow-directions">
              {suggestedBin ? 'Scan its barcode, or any active bin.' : 'Scan any active storage bin.'}
              {pathLine}
            </Box>
          }
        />
        {itemLine}
        {recoveryGuidance}
        <ScanInput
          key="location_scan"
          hint="Scan bin barcode or type location code"
          error={submitError}
          disabled={submitting}
          focusRequest={scannerFocusRequest}
          onSubmit={(v) => {
            if (!beginScannerAction()) return;

            void handleLocationScan(v)
              .catch((err: unknown) => {
                // Failed activation leaves no stale success message competing with the
                // recovery instruction shown to the operator.
                setScanFeedback(null);
                setSubmitError(getStowOperatorError(err, 'location_scan'));
              })
              .finally(() => {
                finishScannerAction();
              });
          }}
        />
        {scanFeedbackLines}
        {stageRail}
      </>,
      executionFacts,
    );
  }

  // STOW-SPLIT-01 — quantity confirmation was intentionally removed.
  // A successful unit scan already represents confirmation of quantity = 1.

  // STOW-SPLIT-01 — every supported operational phase returns above.
  // If execution reaches this point, the session state has diverged from the
  // declared workflow. Render the invariant failure instead of failing silently.
  return renderShell(
    <Alert severity="error">
      Cannot render the stow session because its workflow state is unsupported.
    </Alert>,
  );
}
