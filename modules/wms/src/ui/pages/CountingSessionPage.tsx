// modules/wms/src/ui/pages/CountingSessionPage.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import {
  CheckCircle,
  MapPin,
  Minus,
  PackageCheck,
} from 'lucide-react';

// WMS-CTA-CONSISTENCY-34: canonical Tier-1 commit/workflow-action treatment —
// same token pair already used by the Reconcile-inventory and Create-count
// actions in WmsModuleFT2. Without this, an unstyled contained MUI button
// falls through to the theme's default primary palette (structural blue),
// which is what caused these session-progression actions to render blue
// instead of orange.
export const WMS_TIER1_ACTION_SX = {
  bgcolor: 'var(--accent)',
  color: 'var(--accent-ink)',
  '&:hover': { bgcolor: 'var(--accent-hover)' },
} as const;

// WMS-CTA-CONSISTENCY-34: neutral Tier-2 selection-only treatment for the
// finding-type and skip-reason toggle groups below. Deliberately not
// accent-filled and not MUI primary blue — these are selections, not
// commits (the commit is a separate button further down this form). Idle
// state mirrors the existing suggested-bins select-all ghost treatment in
// WmsModuleFT2; the selected state reuses the surface/stronger-rule pair
// already used for active/selected state elsewhere (e.g. the module tab
// bar's active tab) — no new token invented.
export function wmsTier2SelectionSx(selected: boolean) {
  return {
    bgcolor: selected ? 'var(--surface)' : 'transparent',
    border: `1px solid ${selected ? 'var(--rule-2)' : 'var(--rule)'}`,
    color: 'var(--ink)',
    fontWeight: selected ? 700 : 600,
  } as const;
}

export type CountingSkipReason =
  | 'bin_inaccessible'
  | 'stock_in_motion'
  | 'bin_not_found'
  | 'other';

export type CountingTask = {
  recount_task_id: string;
  label: string;
  status: 'draft' | 'dispatched' | 'claimed' | 'counting' | 'manual_review';
  scope: string;
  blind: boolean;
  assigned_to: number | null;
  claimed_by: number | null;
  created_at: string;
  claimed_at: string | null;
  /**
   * RECOUNT-CLAIM-ABANDONED-131: opaque id, fresh on every claim/reassignment
   * (migration 0163). Scopes browser-local provisional state to this specific
   * claim instance — see scanTallyStorageKey/verifiedLocationStorageKey.
   * Null on legacy/never-reassigned rows predating this column.
   */
  claim_generation: string | null;
  line_count: number;
  counted_count: number;
  /**
   * #1164: 'opening_inventory' tasks are one frozen bin each
   * (scope_location_code) and may start with zero lines. Optional for rows
   * that predate the column; absent means ordinary line-driven recount.
   */
  purpose?: 'cycle_count' | 'opening_inventory' | null;
  scope_location_code?: string | null;
};

export type CountingFindingType =
  | 'unexpected_item'
  | 'product_defect'
  | 'packaging_defect';

export type CountingFinding = {
  recount_finding_id: string;
  recount_task_id: string;
  recount_line_id: string | null;
  lasyncro_variant_id: string;
  location_code: string;
  finding_type: CountingFindingType;
  quantity: number;
  notes: string | null;
  reported_by: number | null;
  reported_at: string;
};

export type CountingLine = {
  recount_line_id: string;
  lasyncro_variant_id: string;
  location_code: string;
  counted_quantity: number | null;
  count_method: 'unit_scan' | 'bin_quantity' | null;
  scan_count: number | null;
  counted_at: string | null;
  skip_reason: CountingSkipReason | null;
  skipped_at: string | null;
  product_title: string | null;
  variant_title: string | null;
  sku: string | null;
  image_url: string | null;
};

/** #1164: the canonical line the server anchored to the opening task's bin. */
export type CountingOpeningLine = Pick<
  CountingLine,
  'recount_line_id' | 'lasyncro_variant_id' | 'location_code'
>;

export type CountingSessionPageProps = {
  task: CountingTask;
  onComplete: (finishedLabel?: string) => void;
  onFetchLines: (taskId: string) => Promise<CountingLine[]>;
  onFetchFindings: (taskId: string) => Promise<CountingFinding[]>;
  onCreateFinding: (
    taskId: string,
    params: {
      client_event_id: string;
      recount_line_id?: string | null;
      lasyncro_variant_id: string;
      location_code: string;
      finding_type: CountingFindingType;
      quantity: number;
      notes?: string;
    }
  ) => Promise<CountingFinding>;
  onClaimTask: (taskId: string) => Promise<void>;
  onResolveBarcode: (
    scannedValue: string
  ) => Promise<{ lasyncro_variant_id: string } | null>;
  onRecordCount: (
    taskId: string,
    lineId: string,
    params: {
      counted_quantity: number;
      count_method: 'unit_scan' | 'bin_quantity';
    }
  ) => Promise<void>;
  onSkipLine: (
    taskId: string,
    lineId: string,
    params: {
      skip_reason: CountingSkipReason;
      notes?: string;
    }
  ) => Promise<void>;
  onCloseTask: (taskId: string) => Promise<void>;
  /** #1164: opening_inventory discovery; the server owns location and expected quantity. */
  onCreateOpeningLine: (
    taskId: string,
    params: { lasyncro_variant_id: string }
  ) => Promise<CountingOpeningLine>;
  /** #1164: opening_inventory bin settlement; replaces onCloseTask for that purpose. */
  onCompleteOpening: (taskId: string) => Promise<void>;
};

type Phase = 'location' | 'bin';

type CountingBin = {
  location_code: string;
  lines: CountingLine[];
};

const SKIP_OPTIONS: Array<{
  value: CountingSkipReason;
  label: string;
}> = [
  { value: 'bin_inaccessible', label: 'Cannot access bin' },
  { value: 'stock_in_motion', label: 'Stock is moving' },
  { value: 'bin_not_found', label: 'Cannot find bin' },
  { value: 'other', label: 'Other' },
];

function locationMatches(scanned: string, locationCode: string): boolean {
  const value = scanned.trim().toUpperCase();
  const expected = locationCode.trim().toUpperCase();
  return value === expected || value === `LOC-${expected}`;
}

function isResolved(line: CountingLine): boolean {
  return line.counted_at !== null || line.skipped_at !== null;
}

/**
 * RECOUNT-CLAIM-ABANDONED-131: keys are scoped by claim_generation, not just
 * task id — a reassignment always writes a fresh generation (migration 0163),
 * so a new claimant can never read a previous claimant's leftover local
 * state, and A -> B -> A does not collide with A's first-generation tally.
 *
 * claimGeneration is null only for a task claimed before this column existed
 * and never since reassigned (nullable, non-backfilled migration). 'legacy'
 * is a fixed sentinel for that one transitional case — not a task+user or
 * claimed_at fallback: the moment this task is ever reassigned,
 * claim_generation becomes a real (non-null) value and the key changes,
 * correctly cutting the new claimant over to fresh keys.
 */
function claimGenerationSegment(claimGeneration: string | null): string {
  return claimGeneration ?? 'legacy';
}

function scanTallyStorageKey(recountTaskId: string, claimGeneration: string | null): string {
  return `recount-scan-tally-${recountTaskId}-${claimGenerationSegment(claimGeneration)}`;
}

function verifiedLocationStorageKey(recountTaskId: string, claimGeneration: string | null): string {
  return `recount-verified-location-${recountTaskId}-${claimGenerationSegment(claimGeneration)}`;
}

/**
 * RECOUNT-CLAIM-ABANDONED-131: the pre-generation key format
 * (recount-scan-tally-${taskId} / recount-verified-location-${taskId}, no
 * generation suffix) that every session used before this migration.
 */
function legacyScanTallyStorageKey(recountTaskId: string): string {
  return `recount-scan-tally-${recountTaskId}`;
}

function legacyVerifiedLocationStorageKey(recountTaskId: string): string {
  return `recount-verified-location-${recountTaskId}`;
}

/**
 * RECOUNT-CLAIM-ABANDONED-131: one-time compatibility migration for an
 * already-active task whose provisional local state predates the
 * claim_generation column (task.claim_generation === null).
 *
 * Safe ONLY when claim_generation is null: before reassignment existed, an
 * active task could only ever have had ONE claim generation across its
 * lifetime — claim only ever happens from status='dispatched', and no
 * release/reassign/reset path existed to produce a second one. So "the old
 * task-only key" and "this task's legacy generation" are provably the same
 * data, not a guess. The moment this task is ever claimed again or
 * reassigned, claim_generation becomes a real UUID and this function is
 * never consulted again for it.
 *
 * No-op if the new key already has a value (already migrated, or this
 * session already wrote fresh state under the 'legacy' key) or if there is
 * no old value to migrate.
 */
function migrateLegacyStorageKey(oldKey: string, newKey: string): void {
  if (sessionStorage.getItem(newKey) !== null) return;
  const oldValue = sessionStorage.getItem(oldKey);
  if (oldValue === null) return;
  sessionStorage.setItem(newKey, oldValue);
  sessionStorage.removeItem(oldKey);
}

function normalizeScanTally(tally: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(tally).filter(
      ([, value]) => Number.isSafeInteger(value) && value > 0
    )
  );
}

function persistScanTally(storageKey: string, tally: Record<string, number>): void {
  const normalized = normalizeScanTally(tally);

  if (Object.keys(normalized).length === 0) {
    sessionStorage.removeItem(storageKey);
    return;
  }

  sessionStorage.setItem(storageKey, JSON.stringify(normalized));
}

function readScanTally(storageKey: string): Record<string, number> {
  const stored = sessionStorage.getItem(storageKey);
  if (!stored) return {};

  try {
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return normalizeScanTally(parsed as Record<string, number>);
  } catch {
    sessionStorage.removeItem(storageKey);
    return {};
  }
}

function filterTallyForUnresolvedLines(
  tally: Record<string, number>,
  currentLines: CountingLine[]
): Record<string, number> {
  const unresolvedLineIds = new Set(
    currentLines.filter((line) => !isResolved(line)).map((line) => line.recount_line_id)
  );

  return Object.fromEntries(
    Object.entries(normalizeScanTally(tally)).filter(([lineId]) =>
      unresolvedLineIds.has(lineId)
    )
  );
}

function removeLineFromTally(
  tally: Record<string, number>,
  recountLineId: string
): Record<string, number> {
  const next = { ...tally };
  delete next[recountLineId];
  return next;
}

/**
 * #1164: add a server-returned opening line to the session exactly once.
 * The server reuses the same line for a repeated task+variant discovery, so
 * identity is the recount_line_id.
 */
function mergeOpeningLine(
  currentLines: CountingLine[],
  created: CountingOpeningLine
): CountingLine[] {
  if (currentLines.some((line) => line.recount_line_id === created.recount_line_id)) {
    return currentLines;
  }

  return [
    ...currentLines,
    {
      recount_line_id: created.recount_line_id,
      lasyncro_variant_id: created.lasyncro_variant_id,
      location_code: created.location_code,
      counted_quantity: null,
      count_method: null,
      scan_count: null,
      counted_at: null,
      skip_reason: null,
      skipped_at: null,
      product_title: null,
      variant_title: null,
      sku: null,
      image_url: null,
    },
  ];
}

// RECOUNT-CLAIM-ABANDONED-131: stable copy for a stale session — the old
// claimant's tab is still open after an owner/admin reassigned this task.
// Deliberately does not say "discarded" or "committed": the local tally is
// still sitting in this browser's sessionStorage, untouched — it simply can
// no longer be submitted from this session.
const OWNERSHIP_CHANGED_MESSAGE =
  'This count was reassigned. Your session is no longer active.';

function errorMessage(error: unknown, fallback: string): string {
  const response = (
    error as { response?: { data?: { error?: string; code?: string } } }
  )?.response?.data;

  // RECOUNT_OWNERSHIP_CHANGED is the one stable code the backend emits for
  // this case (inventoryRecount.controller.ts's recountErrorCode) — matched
  // on the code, not by pattern-matching the underlying English message.
  if (response?.code === 'RECOUNT_OWNERSHIP_CHANGED') {
    return OWNERSHIP_CHANGED_MESSAGE;
  }

  if (response?.error) return response.error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export default function CountingSessionPage({
  task,
  onComplete,
  onFetchLines,
  onFetchFindings,
  onCreateFinding,
  onClaimTask,
  onResolveBarcode,
  onRecordCount,
  onSkipLine,
  onCloseTask,
  onCreateOpeningLine,
  onCompleteOpening,
}: CountingSessionPageProps) {
  const theme = useTheme();
  const locationInputRef = useRef<HTMLInputElement>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>('location');
  const [lines, setLines] = useState<CountingLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [locationInput, setLocationInput] = useState('');
  const [scanInput, setScanInput] = useState('');
  const [scanTally, setScanTally] = useState<Record<string, number>>({});
  const tallyStorageKey = useMemo(
    () => scanTallyStorageKey(task.recount_task_id, task.claim_generation),
    [task.recount_task_id, task.claim_generation]
  );
  const verifiedLocationKey = useMemo(
    () => verifiedLocationStorageKey(task.recount_task_id, task.claim_generation),
    [task.recount_task_id, task.claim_generation]
  );

  const [activeBinCode, setActiveBinCode] = useState<string | null>(null);
  const [skipTargetId, setSkipTargetId] = useState<string | null>(null);
  const [skipReason, setSkipReason] = useState<CountingSkipReason | null>(null);
  const [skipNotes, setSkipNotes] = useState('');

  // RECOUNT-EXCEPTIONS-80: findings describe physical observations only.
  // They never alter counted quantity or inventory truth.
  const [, setFindings] = useState<CountingFinding[]>([]);
  const [findingDraft, setFindingDraft] = useState<{
    client_event_id: string;
    line: CountingLine | null;
    lasyncro_variant_id: string;
    location_code: string;
    finding_type: CountingFindingType;
  } | null>(null);
  const [findingQuantity, setFindingQuantity] = useState('1');
  const [findingNotes, setFindingNotes] = useState('');

  // RECOUNT-BINLIST-62 — the domain is location-centric, not line-centric.
  // Lines arrive already sorted into walk order (RECOUNT-WALKORDER-27), so
  // grouping preserves first-appearance order rather than re-sorting: any
  // re-sort here would silently discard the lane ordering the backend built.
  // #1164: an opening_inventory task's bin is its frozen scope location,
  // not something discovered from its (possibly empty) line set.
  const isOpening = task.purpose === 'opening_inventory';
  const openingBinCode = isOpening
    ? task.scope_location_code?.trim() || null
    : null;

  const bins = useMemo<CountingBin[]>(() => {
    const order: string[] = [];
    const grouped = new Map<string, CountingLine[]>();

    if (openingBinCode) {
      grouped.set(openingBinCode, []);
      order.push(openingBinCode);
    }

    for (const line of lines) {
      const existing = grouped.get(line.location_code);

      if (existing) {
        existing.push(line);
      } else {
        grouped.set(line.location_code, [line]);
        order.push(line.location_code);
      }
    }

    return order.map((code) => ({
      location_code: code,
      lines: grouped.get(code) ?? [],
    }));
  }, [lines, openingBinCode]);

  const unresolvedLines = useMemo(
    () => lines.filter((line) => !isResolved(line)),
    [lines]
  );

  const activeBin =
    bins.find((bin) => bin.location_code === activeBinCode) ?? null;

  const activeBinResolved = activeBin
    ? activeBin.lines.filter(isResolved).length
    : 0;

  const activeBinLinesResolved = Boolean(
    activeBin && activeBinResolved === activeBin.lines.length
  );

  // #1164: an opening bin is finished only by explicit completion — zero
  // resolved of zero discovered lines is not a completed bin, and scanning
  // stays open for further discovery.
  const activeBinComplete = isOpening ? false : activeBinLinesResolved;

  const binsComplete = isOpening
    ? 0
    : bins.filter((bin) => bin.lines.every(isResolved)).length;

  const activeBinNumber = activeBin
    ? bins.findIndex((bin) => bin.location_code === activeBin.location_code) + 1
    : 0;
  const isLocationPhase = phase === 'location';
  const isCountPhase = phase === 'bin';

  const firstOpenBin = (fromIndex = 0): CountingBin | null => {
    for (let index = fromIndex; index < bins.length; index += 1) {
      if (bins[index].lines.some((line) => !isResolved(line))) {
        return bins[index];
      }
    }
    return null;
  };

  const updateScanTally = (
    updater: (previous: Record<string, number>) => Record<string, number>
  ) => {
    setScanTally((previous) => {
      const next = normalizeScanTally(updater(previous));
      persistScanTally(tallyStorageKey, next);
      return next;
    });
  };

  const clearLineScanTally = (recountLineId: string) => {
    updateScanTally((previous) => removeLineFromTally(previous, recountLineId));
  };

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);

      // RECOUNT-CLAIM-ABANDONED-131: one-time compatibility migration, must
      // run before either storage key below is read. Only ever applies to a
      // task claimed before the claim_generation column existed and never
      // since reassigned — see migrateLegacyStorageKey's own comment for why
      // that makes this safe.
      if (task.claim_generation === null) {
        migrateLegacyStorageKey(
          legacyScanTallyStorageKey(task.recount_task_id),
          tallyStorageKey
        );
        migrateLegacyStorageKey(
          legacyVerifiedLocationStorageKey(task.recount_task_id),
          verifiedLocationKey
        );
      }

      try {
        const loaded = await onFetchLines(task.recount_task_id);
        const loadedFindings = await onFetchFindings(task.recount_task_id);

        setLines(loaded);
        setFindings(loadedFindings);

        const restoredTally = filterTallyForUnresolvedLines(
          readScanTally(tallyStorageKey),
          loaded
        );
        setScanTally(restoredTally);
        persistScanTally(tallyStorageKey, restoredTally);

        // RECOUNT-RESUME-POSITION-72: reopening an in-progress count should
        // resume at its first unresolved bin instead of restarting at brief.
        // Location confirmation is intentionally required again after refresh.
        if (task.status === 'claimed' || task.status === 'counting') {
          const nextUnresolvedLine = loaded.find((line) => !isResolved(line));
          const nextActiveBinCode =
            openingBinCode ??
            nextUnresolvedLine?.location_code ??
            loaded[loaded.length - 1]?.location_code ??
            null;
          const savedVerifiedLocation = sessionStorage.getItem(verifiedLocationKey);
          const locationStillVerified =
            nextActiveBinCode !== null && savedVerifiedLocation === nextActiveBinCode;

          if (savedVerifiedLocation && !locationStillVerified) {
            sessionStorage.removeItem(verifiedLocationKey);
          }

          setActiveBinCode(nextActiveBinCode);
          // #1164: an opening bin always needs its location verified — having
          // no unresolved lines does not mean the bin was physically visited.
          setPhase(
            (!openingBinCode && !nextUnresolvedLine) || locationStillVerified
              ? 'bin'
              : 'location'
          );
        }
      } catch (loadError) {
        setError(
          errorMessage(
            loadError,
            'Failed to load this count. Return to Warehouse and try again.'
          )
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [task.recount_task_id, onFetchLines, onFetchFindings, tallyStorageKey, verifiedLocationKey, openingBinCode]);

  useEffect(() => {
    if (phase === 'location') {
      setTimeout(() => locationInputRef.current?.focus(), 50);
    }
    if (phase === 'bin') {
      setTimeout(() => scanInputRef.current?.focus(), 50);
    }
  }, [phase, activeBinCode]);

  const handleStart = async () => {
    if (submitting || loading) return;

    setSubmitting(true);
    setError(null);

    try {
      if (task.status === 'dispatched') {
        await onClaimTask(task.recount_task_id);
      }

      const next = firstOpenBin();
      const nextActiveBinCode =
        openingBinCode ??
        next?.location_code ??
        bins[bins.length - 1]?.location_code ??
        null;
      const savedVerifiedLocation = sessionStorage.getItem(verifiedLocationKey);
      const locationStillVerified =
        nextActiveBinCode !== null && savedVerifiedLocation === nextActiveBinCode;

      if (savedVerifiedLocation && !locationStillVerified) {
        sessionStorage.removeItem(verifiedLocationKey);
      }

      setActiveBinCode(nextActiveBinCode);
      setPhase(
        (!openingBinCode && !next) || locationStillVerified ? 'bin' : 'location'
      );
    } catch (startError) {
      setError(
        errorMessage(
          startError,
          'Failed to start this count. Return to Warehouse and try again.'
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  const autoStartedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (autoStartedForRef.current === task.recount_task_id) return;
    autoStartedForRef.current = task.recount_task_id;
    void handleStart();
  }, [loading, task.recount_task_id]);

  const handleLocation = () => {
    if (!activeBin) {
      setError('No location is active. Return to Warehouse and try again.');
      return;
    }

    if (!locationMatches(locationInput, activeBin.location_code)) {
      setError(`Wrong bin. Go to ${activeBin.location_code}.`);
      return;
    }

    setError(null);
    setLocationInput('');
    sessionStorage.setItem(verifiedLocationKey, activeBin.location_code);
    setPhase('bin');
  };

  // A scan does not commit anything on its own -- unlike stow, a count needs a
  // quantity. The scan only identifies which row the operator is standing in
  // front of and moves focus into that row's input.
  const handleScan = async () => {
    const scanned = scanInput.trim();

    if (!activeBin || !scanned || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const resolved = await onResolveBarcode(scanned);

      if (!resolved) {
        setError('Barcode not recognised. Try again.');
        return;
      }

      const match = activeBin.lines.find(
        (line) => line.lasyncro_variant_id === resolved.lasyncro_variant_id
      );

      if (!match && isOpening) {
        // #1164: opening inventory has no expectation to be "unexpected"
        // against — a known variant found in the bin becomes a count line.
        // The server anchors it to the task bin; the scan counts one unit.
        const created = await onCreateOpeningLine(task.recount_task_id, {
          lasyncro_variant_id: resolved.lasyncro_variant_id,
        });

        let refreshed: CountingLine[] | null = null;
        try {
          refreshed = await onFetchLines(task.recount_task_id);
        } catch {
          // The line exists server-side; keep counting from local state.
        }

        setLines((previous) => mergeOpeningLine(refreshed ?? previous, created));
        updateScanTally((previous) => ({
          ...previous,
          [created.recount_line_id]: (previous[created.recount_line_id] ?? 0) + 1,
        }));
        setScanInput('');
        setTimeout(() => scanInputRef.current?.focus(), 50);
        return;
      }

      if (!match) {
        // A resolved barcode physically observed in this bin is evidence,
        // even when the recount line set did not expect it here.
        setFindingDraft({
          client_event_id: crypto.randomUUID(),
          line: null,
          lasyncro_variant_id: resolved.lasyncro_variant_id,
          location_code: activeBin.location_code,
          finding_type: 'unexpected_item',
        });
        setFindingQuantity('1');
        setFindingNotes('');
        setScanInput('');
        return;
      }

      updateScanTally((previous) => ({
        ...previous,
        [match.recount_line_id]: (previous[match.recount_line_id] ?? 0) + 1,
      }));
      setScanInput('');
      setTimeout(() => scanInputRef.current?.focus(), 50);
    } catch (scanError) {
      setError(
        errorMessage(scanError, 'Barcode could not be resolved. Try again.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolveLine = async (
    line: CountingLine,
    quantity: number
  ): Promise<boolean> => {
    if (submitting) return false;

    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      setError('Enter a valid whole-number quantity.');
      return false;
    }

    setSubmitting(true);
    setError(null);

    try {
      await onRecordCount(task.recount_task_id, line.recount_line_id, {
        counted_quantity: quantity,
        count_method: 'unit_scan',
      });

      setLines((previous) =>
        previous.map((entry) =>
          entry.recount_line_id === line.recount_line_id
            ? {
                ...entry,
                counted_quantity: quantity,
                count_method: 'unit_scan',
                counted_at: new Date().toISOString(),
                skip_reason: null,
                skipped_at: null,
              }
            : entry
        )
      );

      clearLineScanTally(line.recount_line_id);
      setTimeout(() => scanInputRef.current?.focus(), 50);
      return true;
    } catch (countError) {
      setError(
        errorMessage(
          countError,
          'Count could not be saved. Check the connection and try again.'
        )
      );
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleFinishBin = async () => {
    if (!activeBin || submitting) return;

    for (const line of activeBin.lines) {
      if (isResolved(line)) continue;

      const ok = await handleResolveLine(
        line,
        scanTally[line.recount_line_id] ?? 0
      );

      if (!ok) break;
    }
  };

  const handleSkip = async () => {
    if (!skipTargetId || !skipReason || submitting) return;

    if (skipReason === 'other' && !skipNotes.trim()) {
      setError('Add a short note for Other.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await onSkipLine(task.recount_task_id, skipTargetId, {
        skip_reason: skipReason,
        ...(skipNotes.trim() ? { notes: skipNotes.trim() } : {}),
      });

      setLines((previous) =>
        previous.map((entry) =>
          entry.recount_line_id === skipTargetId
            ? {
                ...entry,
                counted_quantity: null,
                counted_at: null,
                skip_reason: skipReason,
                skipped_at: new Date().toISOString(),
              }
            : entry
        )
      );

      clearLineScanTally(skipTargetId);
      setSkipTargetId(null);
      setSkipReason(null);
      setSkipNotes('');
      setTimeout(() => scanInputRef.current?.focus(), 50);
    } catch (skipError) {
      setError(
        errorMessage(skipError, 'This item could not be skipped. Try again.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleNextBin = () => {
    if (!activeBin) return;

    const currentIndex = bins.findIndex(
      (bin) => bin.location_code === activeBin.location_code
    );

    const next = firstOpenBin(currentIndex + 1) ?? firstOpenBin(0);

    setError(null);
    setLocationInput('');
    setScanInput('');
    sessionStorage.removeItem(verifiedLocationKey);

    if (!next) {
      setPhase('bin');
      return;
    }

    setActiveBinCode(next.location_code);
    setPhase('location');
  };

  const handleSaveFinding = async () => {
    if (!findingDraft || submitting) return;

    const rawQuantity = findingQuantity.trim();

    if (!/^\d+$/.test(rawQuantity)) {
      setError('Enter a positive whole-number quantity.');
      return;
    }

    const quantity = Number(rawQuantity);

    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      setError('Enter a positive whole-number quantity.');
      return;
    }

    if (
      findingDraft.line?.counted_quantity !== null &&
      findingDraft.line?.counted_quantity !== undefined &&
      quantity > findingDraft.line.counted_quantity
    ) {
      setError('Defect quantity cannot exceed the physical quantity counted.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const created = await onCreateFinding(task.recount_task_id, {
        client_event_id: findingDraft.client_event_id,
        recount_line_id: findingDraft.line?.recount_line_id ?? null,
        lasyncro_variant_id: findingDraft.lasyncro_variant_id,
        location_code: findingDraft.location_code,
        finding_type: findingDraft.finding_type,
        quantity,
        ...(findingNotes.trim() ? { notes: findingNotes.trim() } : {}),
      });

      setFindings((previous) => [...previous, created]);
      setFindingDraft(null);
      setFindingQuantity('1');
      setFindingNotes('');

      setTimeout(() => scanInputRef.current?.focus(), 50);
    } catch (findingError) {
      setError(
        errorMessage(
          findingError,
          'This physical finding could not be saved. Try again.'
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleFinish = async () => {
    if (unresolvedLines.length > 0 || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      // The operator session deliberately ignores review/variance details.
      // Blind counting ends with a simple acknowledgement that the task
      // reached the server.
      await onCloseTask(task.recount_task_id);
      sessionStorage.removeItem(tallyStorageKey);
      sessionStorage.removeItem(verifiedLocationKey);
      setScanTally({});
      onComplete(task.label);
    } catch (closeError) {
      setError(
        errorMessage(closeError, 'Count could not be finished. Try again.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  // #1164: explicit operator completion of a verified opening bin — the
  // physical-truth boundary. Never routed through the generic close.
  const handleCompleteOpening = async () => {
    if (!activeBin || unresolvedLines.length > 0 || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      await onCompleteOpening(task.recount_task_id);
      sessionStorage.removeItem(tallyStorageKey);
      sessionStorage.removeItem(verifiedLocationKey);
      setScanTally({});
      onComplete(task.label);
    } catch (completeError) {
      setError(
        errorMessage(completeError, 'This bin could not be completed. Try again.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ p: '30px 24px', maxWidth: 720, mx: 'auto' }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
          <CircularProgress size={26} />
        </Box>
      </Box>
    );
  }

  const renderRow = (line: CountingLine) => {
    const counted = line.counted_at !== null;
    const skipped = line.skipped_at !== null;
    const resolved = counted || skipped;

    return (
      <Box
        key={line.recount_line_id}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          py: 0.75,
          borderBottom: '1px solid var(--rule)',
          opacity: resolved ? 0.5 : 1,
        }}
      >
        <Box
          sx={{
            width: 32,
            height: 32,
            flexShrink: 0,
            borderRadius: '4px',
            bgcolor: 'var(--surface-2, var(--surface))',
            border: '1px solid var(--rule)',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {line.image_url ? (
            <Box
              component="img"
              src={line.image_url}
              alt=""
              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <PackageCheck size={14} color="var(--ink-4)" />
          )}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: 12,
              lineHeight: 1.35,
              color: 'var(--ink)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {line.product_title ?? 'Product'}
            {line.variant_title && line.variant_title !== 'Default Title'
              ? ` · ${line.variant_title}`
              : ''}
          </Typography>

          <Typography
            sx={{
              fontSize: 11,
              lineHeight: 1.35,
              fontFamily: '"DM Mono", "SF Mono", ui-monospace, monospace',
              color: 'var(--ink-4)',
            }}
          >
            {line.sku ?? 'No SKU'}
          </Typography>
        </Box>

        {counted && (
          <Typography
            sx={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', width: 72, textAlign: 'right' }}
          >
            {line.counted_quantity}
          </Typography>
        )}

        {counted && Number(line.counted_quantity) > 0 && (
          <Button
            size="small"
            variant="text"
            onClick={() => {
              setError(null);
              setFindingDraft({
                client_event_id: crypto.randomUUID(),
                line,
                lasyncro_variant_id: line.lasyncro_variant_id,
                location_code: line.location_code,
                finding_type: 'product_defect',
              });
              setFindingQuantity('1');
              setFindingNotes('');
            }}
            disabled={submitting}
            sx={{ minWidth: 'auto', px: 0.75, fontSize: 11 }}
          >
            Report defect
          </Button>
        )}

        {skipped && (
          <Typography
            sx={{ fontSize: 11, color: 'var(--ink-3)', width: 72, textAlign: 'right' }}
          >
            Skipped
          </Typography>
        )}

        {!resolved && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            {(scanTally[line.recount_line_id] ?? 0) > 0 && (
              <Button
                size="small"
                onClick={() =>
                  updateScanTally((previous) => ({
                    ...previous,
                    [line.recount_line_id]: Math.max(
                      0,
                      (previous[line.recount_line_id] ?? 0) - 1
                    ),
                  }))
                }
                disabled={submitting}
                aria-label="Undo last scan"
                sx={{ minWidth: 24, px: 0.25 }}
              >
                <Minus size={13} />
              </Button>
            )}

            <Typography
              sx={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--ink)',
                minWidth: 20,
                textAlign: 'right',
              }}
            >
              {scanTally[line.recount_line_id] ?? 0}
            </Typography>

            {(scanTally[line.recount_line_id] ?? 0) === 0 && (
              <Button
                size="small"
                variant="contained"
                onClick={() => void handleResolveLine(line, 0)}
                disabled={submitting}
                sx={{ ...WMS_TIER1_ACTION_SX, minWidth: 'auto', px: 0.75, fontSize: 11 }}
              >
                None here
              </Button>
            )}

            <Button
              size="small"
              variant="text"
              onClick={() => {
                setError(null);
                setSkipReason(null);
                setSkipNotes('');
                setSkipTargetId(line.recount_line_id);
              }}
              disabled={submitting}
              sx={{ minWidth: 'auto', px: 0.5, fontSize: 11 }}
            >
              Can't count
            </Button>
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Box sx={{ p: '30px 24px', maxWidth: 720, mx: 'auto' }}>
      <Box sx={{ mb: 3 }}>
        <Typography
          sx={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', mb: 0.5 }}
        >
          {task.label}
        </Typography>

        <Typography
          sx={{
            fontSize: 26,
            fontWeight: 700,
            color: 'var(--ink)',
            lineHeight: 1.1,
          }}
        >
          Count inventory
        </Typography>

        <Typography
          sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)', mt: 0.75 }}
        >
          {binsComplete} of {bins.length}{' '}
          {bins.length === 1 ? 'bin' : 'bins'} counted
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: '10px' }}>
          {error}
        </Alert>
      )}

      {activeBin && (
        <Box
          sx={{
            bgcolor: 'var(--surface)',
            border: '1px solid var(--rule)',
            borderRadius: '14px',
            p: 2.25,
          }}
        >
          <Box sx={{ mb: 1.5 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Bin {activeBinNumber} of {bins.length}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {/* #1164: an opening bin starts with nothing discovered, not
                    with zero expected items. */}
                {isOpening && activeBin.lines.length === 0
                  ? 'No items discovered yet'
                  : `${activeBinResolved} of ${activeBin.lines.length} items`}
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={isCountPhase ? 100 : 0}
              sx={{
                borderRadius: 1,
                height: 3,
                bgcolor: 'action.hover',
                '& .MuiLinearProgress-bar': { bgcolor: 'var(--accent)' },
              }}
            />
          </Box>

          <Paper
            variant="outlined"
            sx={{ mb: 1.5, p: 2, borderRadius: 2, bgcolor: 'background.default' }}
          >
            <Box sx={{ position: 'relative', height: 100 }}>
              <Box
                sx={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 19,
                  height: 3,
                  bgcolor: 'action.disabledBackground',
                  borderRadius: 1,
                  overflow: 'hidden',
                }}
              >
                <Box
                  sx={{
                    height: '100%',
                    width: isCountPhase ? '66%' : '0%',
                    bgcolor: theme.palette.success.main,
                    borderRadius: 1,
                    transition: 'width 0.55s ease',
                  }}
                />
              </Box>

              <Box sx={{ position: 'absolute', left: 'calc(33% - 20px)', top: 0, width: 40 }}>
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    bgcolor: isLocationPhase ? 'var(--accent)' : theme.palette.success.main,
                    border: `2.5px solid ${isLocationPhase ? 'var(--accent)' : theme.palette.success.main}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background 0.3s, border-color 0.3s',
                    ...(isLocationPhase && {
                      '@keyframes countNodePulse': {
                        '0%': { boxShadow: '0 0 0 0 rgba(255,107,43,0.55)' },
                        '70%': { boxShadow: '0 0 0 10px rgba(255,107,43,0)' },
                        '100%': { boxShadow: '0 0 0 0 rgba(255,107,43,0)' },
                      },
                      animation: 'countNodePulse 1.3s ease-out infinite',
                    }),
                  }}
                >
                  {isLocationPhase ? (
                    <MapPin size={18} color="white" />
                  ) : (
                    <CheckCircle size={18} color="white" />
                  )}
                </Box>
              </Box>
              <Box sx={{ position: 'absolute', left: 'calc(33% - 50px)', top: 48, width: 100, textAlign: 'center' }}>
                <Typography
                  sx={{
                    fontSize: 9,
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.07em',
                    color: isLocationPhase ? 'var(--ink)' : theme.palette.success.main,
                    mb: 0.5,
                    transition: 'color 0.3s',
                  }}
                >
                  {isLocationPhase ? 'Scan Location' : '✓ Confirmed'}
                </Typography>
                <Typography sx={{ fontSize: 13, fontWeight: 500, fontFamily: 'monospace', color: 'text.primary' }}>
                  {activeBin.location_code}
                </Typography>
              </Box>

              <Box sx={{ position: 'absolute', left: 'calc(66% - 20px)', top: 0, width: 40 }}>
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    bgcolor: isLocationPhase ? 'background.paper' : 'var(--accent)',
                    border: `2.5px solid ${isLocationPhase ? theme.palette.divider : 'var(--accent)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background 0.3s, border-color 0.3s',
                    ...(isCountPhase && {
                      '@keyframes countNodePulse': {
                        '0%': { boxShadow: '0 0 0 0 rgba(255,107,43,0.55)' },
                        '70%': { boxShadow: '0 0 0 10px rgba(255,107,43,0)' },
                        '100%': { boxShadow: '0 0 0 0 rgba(255,107,43,0)' },
                      },
                      animation: 'countNodePulse 1.3s ease-out infinite',
                    }),
                  }}
                >
                  <PackageCheck
                    size={18}
                    color={isLocationPhase ? 'var(--ink-3)' : 'white'}
                  />
                </Box>
              </Box>
              <Box sx={{ position: 'absolute', left: 'calc(66% - 50px)', top: 48, width: 100, textAlign: 'center' }}>
                <Typography
                  sx={{
                    fontSize: 9,
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.07em',
                    color: isLocationPhase ? 'text.disabled' : 'var(--ink)',
                    mb: 0.5,
                    transition: 'color 0.3s',
                  }}
                >
                  {isLocationPhase ? 'Up next' : 'Count Contents'}
                </Typography>
                <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'text.primary', lineHeight: 1.3 }}>
                  {activeBin.lines.length} {activeBin.lines.length === 1 ? 'item' : 'items'}
                </Typography>
              </Box>
            </Box>
          </Paper>

          {isLocationPhase && (
            <Box>
              <TextField
                inputRef={locationInputRef}
                fullWidth
                value={locationInput}
                onChange={(event) =>
                  setLocationInput(event.target.value.toUpperCase())
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleLocation();
                }}
                placeholder="Scan bin barcode"
                disabled={submitting}
                autoComplete="off"
                inputProps={{ autoComplete: 'off' }}
              />

              <Button
                variant="contained"
                onClick={handleLocation}
                disabled={!locationInput.trim() || submitting}
                sx={{ ...WMS_TIER1_ACTION_SX, mt: 1.5 }}
              >
                Confirm bin
              </Button>
            </Box>
          )}

          {isCountPhase && (
            <Box>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  mb: 1.25,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <MapPin size={17} color="var(--accent)" />
                  <Typography
                    sx={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}
                  >
                    {activeBin.location_code}
                  </Typography>
                </Box>

                <Button
                  variant="text"
                  size="small"
                  onClick={() => onComplete()}
                  disabled={submitting}
                  sx={{ minWidth: 'auto', px: 0, fontSize: 11, textTransform: 'none' }}
                >
                  Leave count
                </Button>
              </Box>

              {/* RECOUNT-LEAVE-SEMANTICS-138: tally and verified-location
                  already persist in sessionStorage across leave/re-entry —
                  this just makes that existing durability visible so the
                  operator doesn't hesitate before leaving. */}
              <Typography
                sx={{
                  fontSize: 11,
                  color: 'var(--ink-4)',
                  textAlign: 'right',
                  mb: 1.25,
                }}
              >
                Progress is saved automatically.
              </Typography>

              <TextField
                inputRef={scanInputRef}
                fullWidth
                size="small"
                value={scanInput}
                onChange={(event) => setScanInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleScan();
                }}
                placeholder="Scan product barcode"
                disabled={submitting || activeBinComplete}
                autoComplete="off"
                inputProps={{ autoComplete: 'off' }}
                sx={{ mb: 1.25 }}
              />

              <Box sx={{ borderTop: '1px solid var(--rule)' }}>
                {activeBin.lines.map(renderRow)}
              </Box>

              {isOpening ? (
                activeBinLinesResolved ? (
                  <Button
                    variant="contained"
                    onClick={() => void handleCompleteOpening()}
                    disabled={submitting}
                    sx={{ ...WMS_TIER1_ACTION_SX, mt: 2 }}
                  >
                    {activeBin.lines.length === 0 ? 'Confirm bin is empty' : 'Complete bin'}
                  </Button>
                ) : (
                  <Button
                    variant="contained"
                    onClick={() => void handleFinishBin()}
                    disabled={submitting}
                    sx={{ ...WMS_TIER1_ACTION_SX, mt: 2 }}
                  >
                    Done With This Bin
                  </Button>
                )
              ) : activeBinComplete ? (
                firstOpenBin() ? (
                  <Button
                    variant="contained"
                    onClick={handleNextBin}
                    disabled={submitting}
                    sx={{ ...WMS_TIER1_ACTION_SX, mt: 2 }}
                  >
                    Next Bin
                  </Button>
                ) : (
                  <Button
                    variant="contained"
                    onClick={() => void handleFinish()}
                    disabled={submitting}
                    sx={{ ...WMS_TIER1_ACTION_SX, mt: 2 }}
                  >
                    Finish Count
                  </Button>
                )
              ) : (
                <Button
                  variant="contained"
                  onClick={() => void handleFinishBin()}
                  disabled={submitting}
                  sx={{ ...WMS_TIER1_ACTION_SX, mt: 2 }}
                >
                  Done With This Bin
                </Button>
              )}
            </Box>
          )}
        </Box>
      )}

      <Dialog
        open={findingDraft !== null}
        onClose={() => {
          if (!submitting) {
            setFindingDraft(null);
            setError(null);
          }
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {findingDraft?.finding_type === 'unexpected_item'
            ? 'Unexpected item found'
            : 'Report defective stock'}
        </DialogTitle>

        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Typography
            sx={{ fontSize: 13, color: 'var(--ink-3)', mb: 2 }}
          >
            {findingDraft?.finding_type === 'unexpected_item'
              ? `This item is not expected at ${findingDraft.location_code}. Record what you physically found.`
              : 'Keep these units in the physical count. Record only the units that are defective.'}
          </Typography>

          {findingDraft?.line && (
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <Button
                variant="outlined"
                onClick={() =>
                  setFindingDraft((previous) =>
                    previous
                      ? { ...previous, finding_type: 'product_defect' }
                      : previous
                  )
                }
                disabled={submitting}
                sx={wmsTier2SelectionSx(findingDraft.finding_type === 'product_defect')}
              >
                Product defect
              </Button>

              <Button
                variant="outlined"
                onClick={() =>
                  setFindingDraft((previous) =>
                    previous
                      ? { ...previous, finding_type: 'packaging_defect' }
                      : previous
                  )
                }
                disabled={submitting}
                sx={wmsTier2SelectionSx(findingDraft.finding_type === 'packaging_defect')}
              >
                Packaging defect
              </Button>
            </Box>
          )}

          <TextField
            fullWidth
            label="Quantity"
            value={findingQuantity}
            onChange={(event) => {
              setFindingQuantity(event.target.value);
              setError(null);
            }}
            disabled={submitting}
            inputProps={{
              inputMode: 'numeric',
              pattern: '[0-9]*',
            }}
          />

          <TextField
            fullWidth
            multiline
            minRows={2}
            value={findingNotes}
            onChange={(event) => setFindingNotes(event.target.value)}
            placeholder="Optional note"
            disabled={submitting}
            sx={{ mt: 2 }}
          />

          {findingDraft?.line && (
            <Typography
              sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 1 }}
            >
              Physically counted: {findingDraft.line.counted_quantity}
            </Typography>
          )}
        </DialogContent>

        <DialogActions>
          <Button
            onClick={() => {
              setFindingDraft(null);
              setError(null);
            }}
            disabled={submitting}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={() => void handleSaveFinding()}
            disabled={submitting || !findingQuantity.trim()}
            sx={WMS_TIER1_ACTION_SX}
          >
            {submitting ? 'Saving…' : 'Record finding'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={skipTargetId !== null}
        onClose={() => {
          if (!submitting) setSkipTargetId(null);
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Why can’t this item be counted?</DialogTitle>

        <DialogContent>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr',
              gap: 1,
              pt: 0.5,
            }}
          >
            {SKIP_OPTIONS.map((option) => (
              <Button
                key={option.value}
                variant="outlined"
                onClick={() => {
                  setSkipReason(option.value);
                  setError(null);
                }}
                disabled={submitting}
                sx={{ ...wmsTier2SelectionSx(skipReason === option.value), justifyContent: 'flex-start' }}
              >
                {option.label}
              </Button>
            ))}
          </Box>

          {skipReason === 'other' && (
            <TextField
              fullWidth
              multiline
              minRows={2}
              value={skipNotes}
              onChange={(event) => setSkipNotes(event.target.value)}
              placeholder="What prevented the count?"
              disabled={submitting}
              sx={{ mt: 2 }}
            />
          )}
        </DialogContent>

        <DialogActions>
          <Button
            onClick={() => setSkipTargetId(null)}
            disabled={submitting}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={() => void handleSkip()}
            disabled={
              !skipReason ||
              submitting ||
              (skipReason === 'other' && !skipNotes.trim())
            }
            sx={WMS_TIER1_ACTION_SX}
          >
            {submitting ? 'Saving…' : 'Skip item'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
