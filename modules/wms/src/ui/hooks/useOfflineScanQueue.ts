// modules/wms/src/ui/hooks/useOfflineScanQueue.ts
import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * PICK SCAN SUBMISSION HOOK (WM-24; online-only since SF-PICK-ASSIGN-01 C008)
 * --------------------------------------------------------------------------
 * Pick v1 requires a working backend connection (owner decision). submitScan
 * never writes to IndexedDB; a scan is confirmed only by the server.
 *
 * SF-PICK-ASSIGN-01 C009 — historical (pre-C008) entries in the IndexedDB
 * 'scan-queue' store are reconciled HERE, through the caller's authenticated
 * httpPost, after authenticated startup (mount), reconnection ('online') and
 * window focus. sw.js no longer replays anything.
 *
 * An entry is sent only when its origin and requester can be established:
 *   - same-origin POST to PICK_SCAN_PATH, body a JSON object with a non-empty
 *     pick_batch_id and pick_claim_generation. The server fence requires the
 *     authenticated user to be the batch owner AND the generation (a random
 *     UUID rotated on every claim/takeover) to be current, so only the
 *     original claimant under the same claim can have it accepted;
 *   - never evaluated by the server, or marked 401 by the old token-less
 *     service worker. Any other recorded refusal is never resent.
 * Everything else is left exactly as stored.
 *
 * C010 (REVIEW-006 F2) — an entry that is neither replayable nor a recorded
 * server refusal (typically a pre-C008 scan without pick_claim_generation) is
 * "unconfirmed": whether it was recorded is unknown. It is never submitted and
 * never modified; it leaves the device only through reviewUnconfirmedScan,
 * after the server has durably recorded the operator's review (with the
 * original request) at UNCONFIRMED_REVIEW_PATH.
 *
 * Outcomes: 2xx or PICK_SCAN_ALREADY_RECORDED by the requester → removed;
 * other server refusals (4xx) → kept, marked `rejected`, shown for review;
 * 401 → paused until the next trigger, entry untouched; network / 5xx /
 * 408 / 429 → kept untouched, bounded backoff retry; anything else → kept
 * untouched. One reconciler at a time across tabs (Web Locks when available,
 * otherwise one per tab) and each entry is re-read before it is sent.
 */

const DB_NAME = 'lasyncro-wms';
const STORE_NAME = 'scan-queue';
export const PICK_SCAN_PATH = '/api/v1/wms/pick/scan';
export const UNCONFIRMED_REVIEW_PATH = '/api/v1/wms/pick/unconfirmed-scan-review';
const RECONCILE_LOCK = 'lasyncro-wms-pick-scan-reconcile';
/** Bounded automatic retries after a transient failure (then wait for a trigger). */
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

export interface ScanQueueEntry {
  id: string;           // device_event_id — idempotency key
  url: string;
  method: string;
  body: string;         // JSON.stringify of request payload
  queuedAt: number;
  /**
   * The server refused the scan (4xx). Kept for operator review; never resent
   * (except status 401 written by the pre-C009 service worker, which was never
   * evaluated by the server); removed only on dismissal.
   */
  rejected?: { status: number; code: string | null; error: string | null; at: number };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * SF-PICK-ASSIGN-01 C008 — no HTTP answer: the scan was not confirmed (and is not queued).
 * SF-PICK-A6B-OUTCOME-TRUTH-001 — the request was sent, so the server may have
 * committed it: the outcome is unknown, never "not recorded".
 */
export const PICK_CONNECTION_LOST = 'PICK_CONNECTION_LOST';
export class PickConnectionLostError extends Error {
  readonly code = PICK_CONNECTION_LOST;
  constructor() {
    super('Connection lost — this scan may already have been recorded. Do not scan this item; Picking is paused until the server confirms the result.');
    this.name = 'PickConnectionLostError';
  }
}

async function storeRequest<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

const getAllEntries = () => storeRequest<ScanQueueEntry[]>('readonly', (s) => s.getAll());
const getEntry = (id: string) => storeRequest<ScanQueueEntry | undefined>('readonly', (s) => s.get(id));
const putEntry = (entry: ScanQueueEntry) => storeRequest<void>('readwrite', (s) => s.put(entry));
const removeEntry = (id: string) => storeRequest<void>('readwrite', (s) => s.delete(id));

/**
 * C012 (LOW-2) — a failure of this device's own scan storage (IndexedDB), as
 * opposed to the network or the server. Lets the UI say so truthfully instead
 * of reporting lost connectivity. The scan is never removed by this path.
 */
export const SCAN_QUEUE_STORAGE_FAILED = 'SCAN_QUEUE_STORAGE_FAILED';
const localStore = <T,>(p: Promise<T>): Promise<T> =>
  p.catch((cause: unknown) => {
    throw Object.assign(new Error('This device could not update its saved scans.'), { code: SCAN_QUEUE_STORAGE_FAILED, cause });
  });

/** A recorded server refusal (other than the old token-less worker's 401). */
const isServerRefused = (e: ScanQueueEntry) => Boolean(e.rejected && e.rejected.status !== 401);

/**
 * C011 (NEW-1, requirement 7) — the server checks ownership/generation before
 * its duplicate guard, so these refusals do not prove the scan was never
 * recorded. Dismissing such an entry records the audited review first.
 * C012: PICK_SCAN_OUTCOME_UNCERTAIN (the removal/reservation release already
 * exists) is the server saying outright that it may be recorded — same rule.
 */
const PICK_UNCERTAIN_CODES = new Set([
  'PICK_OWNERSHIP_REVOKED',
  'PICK_GENERATION_STALE',
  'PICK_GENERATION_REQUIRED',
  'PICK_BATCH_NOT_PICKING',
  'PICK_CUSTODY_ACK_REQUIRED',
  'PICK_SCAN_OUTCOME_UNCERTAIN',
]);
const isUncertainRefused = (e: ScanQueueEntry) =>
  isServerRefused(e) && typeof e.rejected?.code === 'string' && PICK_UNCERTAIN_CODES.has(e.rejected.code);

/**
 * Records the operator's review of an entry on the server (with the original
 * request and, C012, the refusal as this device recorded it).
 */
const recordReview = (
  httpPost: (url: string, body: Record<string, unknown>) => Promise<void>,
  entry: ScanQueueEntry,
) => httpPost(UNCONFIRMED_REVIEW_PATH, {
  device_event_id: entry.id,
  queued_at: entry.queuedAt,
  original: { url: entry.url, method: entry.method, body: entry.body },
  ...(entry.rejected ? {
    rejection: {
      status: entry.rejected.status,
      code: entry.rejected.code,
      error: typeof entry.rejected.error === 'string' ? entry.rejected.error.slice(0, 2048) : null, // server limit
      rejected_at: entry.rejected.at,
    },
  } : {}),
});

/** C010 F2 — neither replayable nor refused: its outcome cannot be established. */
export function isUnconfirmedScan(entry: ScanQueueEntry | undefined): boolean {
  return Boolean(entry) && !isServerRefused(entry!) && replayableScanBody(entry) === null;
}

/** Pending (replayable), rejected (server refusals) and unconfirmed entries. */
async function getQueueState(): Promise<{ queued: number; rejected: ScanQueueEntry[]; unconfirmed: ScanQueueEntry[] }> {
  const entries = await getAllEntries();
  return {
    queued: entries.filter((e) => replayableScanBody(e) !== null).length,
    rejected: entries.filter(isServerRefused),
    unconfirmed: entries.filter(isUnconfirmedScan),
  };
}

/** The parsed scan body when the entry may be replayed by this app, else null. */
export function replayableScanBody(entry: ScanQueueEntry | undefined): Record<string, unknown> | null {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.rejected && entry.rejected.status !== 401) return null;
  if (typeof entry.method !== 'string' || entry.method.toUpperCase() !== 'POST') return null;
  if (typeof entry.url !== 'string') return null;
  try {
    const origin = window.location.origin;
    const url = new URL(entry.url, origin);
    if (url.origin !== origin || url.pathname !== PICK_SCAN_PATH || url.search) return null;
  } catch {
    return null;
  }
  let body: unknown;
  try { body = JSON.parse(entry.body); } catch { return null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { pick_batch_id, pick_claim_generation } = body as Record<string, unknown>;
  if (typeof pick_batch_id !== 'string' || pick_batch_id.length === 0) return null;
  if (typeof pick_claim_generation !== 'string' || pick_claim_generation.length === 0) return null;
  return body as Record<string, unknown>;
}

type HttpErrorShape = { response?: { status?: unknown; data?: Record<string, unknown> } };
type RunResult = 'done' | 'transient' | 'auth' | 'busy';

async function reconcileOnce(
  httpPost: (url: string, body: Record<string, unknown>) => Promise<void>
): Promise<RunResult> {
  const entries = await getAllEntries();
  for (const snapshot of entries) {
    if (!replayableScanBody(snapshot)) continue;
    // Re-read: another tab (or an old worker) may have changed it meanwhile.
    const current = await getEntry(snapshot.id);
    const body = replayableScanBody(current);
    if (!current || !body) continue;
    try {
      await httpPost(PICK_SCAN_PATH, body);
      await removeEntry(current.id);
      continue;
    } catch (err: unknown) {
      const response = (err as HttpErrorShape)?.response;
      if (!response) return 'transient';
      const status = typeof response.status === 'number' ? response.status : NaN;
      const data = response.data ?? {};
      if (status === 401) return 'auth';
      if (status >= 500 || status === 408 || status === 429) return 'transient';
      if (data.code === 'PICK_SCAN_ALREADY_RECORDED' && data.recorded_by_requester === true) {
        await removeEntry(current.id);
        continue;
      }
      if (status >= 400 && status < 500) {
        await putEntry({
          ...current,
          rejected: {
            status,
            code: typeof data.code === 'string' ? data.code : null,
            error: typeof data.error === 'string' ? data.error : null,
            at: Date.now(),
          },
        });
        continue;
      }
      // Unrecognised answer: keep untouched, do not claim it was not recorded.
      continue;
    }
  }
  return 'done';
}

let tabRun: Promise<RunResult> | null = null;

/** One reconciler at a time: across tabs via Web Locks, within a tab always. */
function reconcileExclusive(
  httpPost: (url: string, body: Record<string, unknown>) => Promise<void>
): Promise<RunResult> {
  if (tabRun) return Promise.resolve('busy');
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  // The lock manager resolves with the callback's settled value.
  const run: Promise<RunResult> = locks?.request
    ? Promise.resolve(
        locks.request(RECONCILE_LOCK, { ifAvailable: true }, (lock) =>
          lock ? reconcileOnce(httpPost) : ('busy' as const)),
      ).then((result) => result as RunResult)
    : reconcileOnce(httpPost);
  tabRun = run.finally(() => { tabRun = null; });
  return tabRun;
}

export interface UseOfflineScanQueueOptions {
  httpPost: (url: string, body: Record<string, unknown>) => Promise<void>;
}

export interface UseOfflineScanQueueResult {
  isOnline: boolean;
  queuedCount: number;
  /** SF-PICK-ASSIGN-01 — scans the server refused while they were queued. */
  rejectedScans: ScanQueueEntry[];
  /**
   * Operator has reviewed a rejected scan; removes it from the device.
   * C011/C012: a fence or outcome-uncertain refusal is removed only after the
   * server recorded the review; otherwise it rejects and the entry is kept.
   */
  dismissRejectedScan: (id: string) => Promise<void>;
  /** C010 F2 — historical scans whose outcome cannot be established. */
  unconfirmedScans: ScanQueueEntry[];
  /**
   * C010 F2 — records the operator's review on the server (audited, with the
   * original request), then removes the entry. Rejects, keeping the entry,
   * when the review is not recorded or the entry is not unconfirmed.
   */
  reviewUnconfirmedScan: (id: string) => Promise<void>;
  submitScan: (params: {
    /** Durable callers require an exact committed receipt for already-recorded responses. */
    requireExactOutcome?: boolean;
    deviceEventId: string;
    url: string;
    body: Record<string, unknown>;
  }) => Promise<void>;
}

export function useOfflineScanQueue({
  httpPost,
}: UseOfflineScanQueueOptions): UseOfflineScanQueueResult {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queuedCount, setQueuedCount] = useState(0);
  const [rejectedScans, setRejectedScans] = useState<ScanQueueEntry[]>([]);
  const [unconfirmedScans, setUnconfirmedScans] = useState<ScanQueueEntry[]>([]);
  const httpPostRef = useRef(httpPost);
  httpPostRef.current = httpPost;
  const retryRef = useRef<{ attempt: number; timer: ReturnType<typeof setTimeout> | null }>({ attempt: 0, timer: null });
  const mountedRef = useRef(true);

  const refreshQueuedCount = useCallback(async () => {
    try {
      const state = await getQueueState();
      if (!mountedRef.current) return;
      setQueuedCount(state.queued);
      setRejectedScans(state.rejected);
      setUnconfirmedScans(state.unconfirmed);
    } catch {
      // IndexedDB unavailable — non-fatal
    }
  }, []);

  const reconcile = useCallback(async (source: 'trigger' | 'retry') => {
    const retry = retryRef.current;
    if (source === 'trigger') {
      retry.attempt = 0;
      if (retry.timer) { clearTimeout(retry.timer); retry.timer = null; }
    }
    let result: RunResult;
    try {
      result = await reconcileExclusive((url, body) => httpPostRef.current(url, body));
    } catch {
      result = 'transient'; // IndexedDB / lock failure — keep everything
    }
    if (!mountedRef.current) return;
    if (result === 'transient' && retry.attempt < RETRY_DELAYS_MS.length && !retry.timer) {
      const delay = RETRY_DELAYS_MS[retry.attempt];
      retry.attempt += 1;
      retry.timer = setTimeout(() => {
        retry.timer = null;
        void reconcile('retry');
      }, delay);
    }
    // 'auth': paused — resumes on the next trigger (re-login remounts; focus/online).
    await refreshQueuedCount();
  }, [refreshQueuedCount]);

  const dismissRejectedScan = useCallback(async (id: string) => {
    try {
      const entry = await localStore(getEntry(id));
      if (entry && isUncertainRefused(entry)) {
        // The server records the review durably before anything is forgotten.
        await recordReview(httpPostRef.current, entry);
      }
      await localStore(removeEntry(id));
    } finally {
      await refreshQueuedCount();
    }
  }, [refreshQueuedCount]);

  const reviewUnconfirmedScan = useCallback(async (id: string) => {
    try {
      // C012 (UX-TRUTH-004, F-A): local storage failures are classified as
      // such (SCAN_QUEUE_STORAGE_FAILED), never as an HTTP failure.
      const entry = await localStore(getEntry(id));
      if (!entry || !isUnconfirmedScan(entry)) {
        throw new Error('This scan is not awaiting review.');
      }
      // The server records the review durably before anything is forgotten.
      await recordReview(httpPostRef.current, entry);
      await localStore(removeEntry(id));
    } finally {
      await refreshQueuedCount();
    }
  }, [refreshQueuedCount]);

  useEffect(() => {
    mountedRef.current = true;
    const onOnline = () => {
      setIsOnline(true);
      void reconcile('trigger');
    };
    const onOffline = () => setIsOnline(false);
    const onFocus = () => { void reconcile('trigger'); };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('focus', onFocus);
    void refreshQueuedCount();
    void reconcile('trigger');

    const retry = retryRef.current;
    return () => {
      mountedRef.current = false;
      if (retry.timer) { clearTimeout(retry.timer); retry.timer = null; }
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('focus', onFocus);
    };
  }, [reconcile, refreshQueuedCount]);

  /**
   * SF-PICK-ASSIGN-01 C008 — online-only Pick. Every scan is POSTed (the
   * browser's online flag never decides) and resolves only on the server's
   * acceptance, or on PICK_SCAN_ALREADY_RECORDED for this operator (the
   * authoritative answer to a retry after a lost response). No HTTP answer
   * rejects with code PICK_CONNECTION_LOST. Nothing is ever queued.
   */
  const submitScan = useCallback(
    async (params: {
      deviceEventId: string;
      /** Durable Pick recovery requires an exact receipt for a replay acknowledgement. */
      requireExactOutcome?: boolean;
      url: string;
      body: Record<string, unknown>;
    }) => {
      const { url, body } = params;
      try {
        await httpPost(url, body);
      } catch (err: unknown) {
        const response = (err as { response?: { data?: { code?: unknown; recorded_by_requester?: unknown } } })?.response;
        if (!response) throw new PickConnectionLostError();
        if (!params.requireExactOutcome && response.data?.code === 'PICK_SCAN_ALREADY_RECORDED' && response.data.recorded_by_requester === true) return;
        throw err;
      }
    },
    [httpPost]
  );

  return {
    isOnline, queuedCount, submitScan, rejectedScans, dismissRejectedScan,
    unconfirmedScans, reviewUnconfirmedScan,
  };
}
