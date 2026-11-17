// packages/mobile-core/src/offlineQueue.ts
//
// OFFLINE CONFIRM QUEUE — @lasyncro/mobile-core (DECISION-F)
// -----------------------------------------------------------
// Standalone service for queuing WMS scan confirmations when offline.
// Persists to AsyncStorage so queued entries survive app restart.
// SF-PICK-ASSIGN-01 C008: Pick is online-only. PickBriefScreen submits through
// submitScanOnline(), which never queues. The queue now holds only historical
// (pre-C008) entries, which flush() still reconciles when connected.
//
// DESIGN:
//   submitScanWithDetail() — try live POST; on a connectivity failure, persist
//                   the scan to the queue. An HTTP answer is surfaced to the
//                   caller, never queued.
//   flush()       — drain queue; called on mount, after each live success,
//                   on AppState 'active' and by the retry timer.
//   subscribe()   — listeners receive (count, isOnline, rejectedCount, status).
//
// SF-PICK-ASSIGN-01 INVARIANTS
//   1. Every accepted scan stays durably queued, is synchronized, or is kept in
//      the rejected list for operator review. Nothing is dropped silently.
//   2. Fail closed on storage (C006, REVIEW-004 HIGH-1/2). A scan is reported
//      queued only after its write succeeded; otherwise the caller gets
//      OFFLINE_QUEUE_WRITE_FAILED and the screen does not advance. A failed or
//      unparseable read is an error, never "empty": no write follows a failed
//      read, corrupt raw data is left in place and copied to a quarantine key,
//      and no "synced" state is reported. If an update after a request cannot
//      be persisted, the last durable state stands and status.storageError is
//      set; the entry is simply processed again later.
//   3. Ordering of a refusal: the rejected list is written before the entry
//      leaves the queue; an entry already present in the rejected list is only
//      removed from the queue, never re-sent.
//
// ANSWER HANDLING (per queued entry; the HTTP request is never made under the lock)
//   2xx ................................ delivered → removed
//   no HTTP response ................... connectivity → kept, retried; no window
//   401 ................................ authentication → kept; queue PAUSED (no
//                                         timer) until the next flush trigger
//                                         (foreground, live success); never rejected
//   408, 429, 5xx ...................... transient server answer → kept; the first
//                                         one starts a durable 10-minute window
//                                         (firstServerErrorAt). 429 waits at least
//                                         Retry-After (capped). Past the window →
//                                         rejected 'server_error_retries_exhausted'
//   409 PICK_SCAN_ALREADY_RECORDED ..... authoritative server evidence (C006
//        recorded_by_requester=true      MEDIUM-3): this operator's scan for this
//                                         task is committed → reconciled, removed
//   409 PICK_SCAN_ALREADY_RECORDED ..... recorded by another operator → rejected
//        recorded_by_requester≠true      'already_recorded_by_other' (do not re-scan)
//   409 PICK_SCAN_OUTCOME_UNCERTAIN .... rejected 'outcome_uncertain' (do not re-scan)
//   other 4xx (incl. ownership 409) .... rejected 'refused'
//
// CONCURRENCY: every read-modify-write of either key runs under one promise-
// chain mutex. The empty-queue decision, the retry timer and the notification
// are made inside that same critical section, as is enqueue's persist + timer,
// so a scan enqueued around a drain's empty decision always has a live retry
// (MEDIUM-1). flush() is single-flight.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from './apiClient';

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueueEntry = {
  deviceEventId: string;
  url: string;
  body: Record<string, unknown>;
  /** Epoch ms of the first transient server answer (408/429/5xx); connectivity and 401 never set it. */
  firstServerErrorAt?: number;
  /** Transient server answers received for this entry (diagnostic only). */
  serverErrorAttempts?: number;
};

export type RejectedReason =
  | 'refused'
  | 'server_error_retries_exhausted'
  | 'already_recorded_by_other'
  | 'outcome_uncertain';

export type RejectedQueueEntry = QueueEntry & {
  status: number;
  code: string | null;
  error: string | null;
  rejectedAt: number;
  reason: RejectedReason;
};

export type SubmitScanError = { status: number; code: string | null; error: string };

export type QueueStatus = {
  /** Set while the device's queue storage cannot be read or written; null when healthy. */
  storageError: string | null;
  /** True after a 401: queued scans wait for valid credentials. */
  authPaused: boolean;
};

type Listener = (count: number, isOnline: boolean, rejectedCount: number, status: QueueStatus) => void;

export class QueueStorageError extends Error {
  constructor(readonly op: 'read' | 'parse' | 'write', readonly key: string, cause?: unknown) {
    super(`OFFLINE_QUEUE_STORAGE_${op.toUpperCase()}_FAILED:${key}${cause instanceof Error ? `: ${cause.message}` : ''}`);
    this.name = 'QueueStorageError';
  }
}

// ─── Constants and module state ───────────────────────────────────────────────

const STORAGE_KEY  = 'ls:offline_queue';
const REJECTED_KEY = 'ls:offline_rejected';
const SERVER_ERROR_RECOVERY_WINDOW_MS = 10 * 60_000;
const BASE_DELAY         = 2_000;
const MAX_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_AFTER_MS = 5 * 60_000;

// SF-PICK-ASSIGN-01 C011 (NEW-1) — historical scans whose recorded outcome
// cannot be established. The server checks ownership/generation BEFORE its
// duplicate guard, so a fence refusal does not prove the scan was never
// recorded, and a pre-generation entry cannot be replayed safely at all.
// Such entries leave the device only after the server durably recorded the
// operator's review (with the original scan) at PICK_REVIEW_URL.
const PICK_SCAN_PATH = '/api/v1/wms/pick/scan';
const PICK_REVIEW_URL = '/api/v1/wms/pick/unconfirmed-scan-review';
const PICK_FENCE_CODES = new Set([
  'PICK_OWNERSHIP_REVOKED',
  'PICK_GENERATION_STALE',
  'PICK_GENERATION_REQUIRED',
  'PICK_BATCH_NOT_PICKING',
  'PICK_CUSTODY_ACK_REQUIRED',
]);
export const PICK_SCAN_UNCONFIRMED_HISTORICAL = 'PICK_SCAN_UNCONFIRMED_HISTORICAL';
export const PICK_REVIEW_NOT_RECORDED = 'PICK_REVIEW_NOT_RECORDED';

export class PickReviewNotRecordedError extends Error {
  readonly code = PICK_REVIEW_NOT_RECORDED;
  constructor(readonly kind: 'offline' | 'auth' | 'server') {
    super('The review could not be recorded; the scan is kept on this device.');
    this.name = 'PickReviewNotRecordedError';
  }
}

/** A Pick scan this device may not replay: it carries no claim generation. */
function isUnreplayablePickScan(entry: QueueEntry): boolean {
  if (typeof entry.url !== 'string' || !entry.url.endsWith(PICK_SCAN_PATH)) return false;
  const generation = (entry.body as { pick_claim_generation?: unknown } | null)?.pick_claim_generation;
  return typeof generation !== 'string' || generation.length === 0;
}

/**
 * Whether this kept scan may already be recorded on the server.
 * C012: a 5xx can be answered after the scan committed, so a scan whose 5xx
 * retries ran out is uncertain too. Evaluated on read, so it covers entries
 * persisted by earlier builds as well as new ones.
 */
export function isUncertainRejected(entry: Pick<RejectedQueueEntry, 'reason' | 'code'>): boolean {
  return entry.reason === 'outcome_uncertain' ||
    entry.reason === 'server_error_retries_exhausted' ||
    (entry.code !== null && PICK_FENCE_CODES.has(entry.code));
}

export const OFFLINE_QUEUE_WRITE_FAILED = 'OFFLINE_QUEUE_WRITE_FAILED';
const WRITE_FAILED_MESSAGE =
  'This scan was not saved on the device. Keep the item and scan it again when the connection returns.';

let _rejectedCount = 0;
let _lastCount     = 0;
let _isOnline      = true;
let _status: QueueStatus = { storageError: null, authPaused: false };
let _backoffStep   = 0;
let _retryTimer: ReturnType<typeof setTimeout> | null = null;
let _flushRun: Promise<void> | null = null;
let _storageChain: Promise<unknown> = Promise.resolve();
const _listeners   = new Set<Listener>();

// ─── Storage (fail closed) ────────────────────────────────────────────────────

function withStorageLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = _storageChain.then(fn, fn);
  _storageChain = run.catch(() => undefined);
  return run;
}

async function readList<T>(key: string): Promise<T[]> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch (cause) {
    throw new QueueStorageError('read', key, cause);
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    await quarantine(key, raw);
    throw new QueueStorageError('parse', key, cause);
  }
  if (!Array.isArray(parsed)) {
    await quarantine(key, raw);
    throw new QueueStorageError('parse', key);
  }
  return parsed as T[];
}

/** FNV-1a (32-bit) + length: a stable, content-derived name for a corrupt value. Not a security hash. */
function fingerprint(raw: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16).padStart(8, '0')}-${raw.length}`;
}

/** Slots per fingerprint: room for a (rare) collision between distinct values, and a hard bound. */
const QUARANTINE_SLOTS = 4;

/**
 * Copy (never move or clear) unreadable data aside for investigation. Best effort.
 *
 * C007 (REVIEW-005 M-1): bounded. The copy is named by the value's content, not
 * the time, so retries, foreground events and further scans that re-read the
 * same corrupt value find the copy already present and write nothing. A changed
 * corrupt value gets its own copy. An existing copy is never overwritten: a slot
 * holding a different value (fingerprint collision) is skipped, and after
 * QUARANTINE_SLOTS the value is not copied (the original key still holds it).
 * Nothing is logged: the raw value can contain scan payloads.
 */
async function quarantine(key: string, raw: string): Promise<void> {
  const base = `${key}:corrupt:${fingerprint(raw)}`;
  try {
    for (let slot = 0; slot < QUARANTINE_SLOTS; slot++) {
      const qKey = slot === 0 ? base : `${base}:${slot}`;
      const existing = await AsyncStorage.getItem(qKey);
      if (existing === raw) return;                 // already preserved
      if (existing === null) {
        await AsyncStorage.setItem(qKey, raw);
        return;
      }
    }
  } catch {
    // The original key is untouched either way; a later read tries again.
  }
}

async function writeList(key: string, entries: unknown[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(entries));
  } catch (cause) {
    throw new QueueStorageError('write', key, cause);
  }
}

const loadQueue = () => readList<QueueEntry>(STORAGE_KEY);
const loadRejected = () => readList<RejectedQueueEntry>(REJECTED_KEY);

// ─── Notification and timer ───────────────────────────────────────────────────

function notify(count: number, online: boolean): void {
  _lastCount = count;
  _isOnline = online;
  const status = { ..._status };
  _listeners.forEach(fn => fn(count, online, _rejectedCount, status));
}

function setStorageError(err: unknown): void {
  _status = { ..._status, storageError: err instanceof Error ? err.message : String(err) };
}

function clearTimer(): void {
  if (_retryTimer !== null) {
    clearTimeout(_retryTimer);
    _retryTimer = null;
  }
}

function scheduleRetry(minDelay = 0): void {
  clearTimer();
  const backoff = Math.min(BASE_DELAY * Math.pow(2, _backoffStep), MAX_RETRY_DELAY_MS);
  _backoffStep = Math.min(_backoffStep + 1, 16);
  const delay = Math.max(backoff, Math.min(minDelay, MAX_RETRY_AFTER_MS));
  _retryTimer = setTimeout(() => {
    _retryTimer = null;
    void flush();
  }, delay);
}

function errorDetail(err: unknown): SubmitScanError {
  const response = (err as { response?: { status?: number; data?: { error?: unknown; code?: unknown } } })?.response;
  return {
    status: Number(response?.status ?? 0),
    code: typeof response?.data?.code === 'string' ? response.data.code : null,
    error: typeof response?.data?.error === 'string' ? response.data.error : 'Server error.',
  };
}

/** Retry-After in ms (delta-seconds or HTTP-date); 0 when absent or invalid. */
function retryAfterMs(err: unknown): number {
  const headers = (err as { response?: { headers?: Record<string, unknown> } })?.response?.headers ?? {};
  const value = headers['retry-after'] ?? headers['Retry-After'];
  if (typeof value !== 'string' && typeof value !== 'number') return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(String(value));
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
}

// ─── Answer classification ────────────────────────────────────────────────────

type Outcome =
  | { kind: 'delivered' }
  | { kind: 'offline' }
  | { kind: 'auth' }
  | { kind: 'transient'; detail: SubmitScanError; at: number; waitMs: number }
  | { kind: 'review'; detail: SubmitScanError; reason: Exclude<RejectedReason, 'server_error_retries_exhausted'> };

function classify(err: unknown): Outcome {
  if (!(err as { response?: unknown })?.response) return { kind: 'offline' };
  const detail = errorDetail(err);
  const data = (err as { response?: { data?: { recorded_by_requester?: unknown } } }).response?.data ?? {};
  if (detail.status === 401) return { kind: 'auth' };
  if (detail.code === 'PICK_SCAN_ALREADY_RECORDED') {
    return data.recorded_by_requester === true
      ? { kind: 'delivered' }
      : { kind: 'review', detail, reason: 'already_recorded_by_other' };
  }
  if (detail.code === 'PICK_SCAN_OUTCOME_UNCERTAIN') return { kind: 'review', detail, reason: 'outcome_uncertain' };
  if (detail.status === 408 || detail.status === 429 || detail.status >= 500 || detail.status < 400) {
    return { kind: 'transient', detail, at: Date.now(), waitMs: detail.status === 429 ? retryAfterMs(err) : 0 };
  }
  return { kind: 'review', detail, reason: 'refused' };
}

// ─── Drain ────────────────────────────────────────────────────────────────────

type Step = { stop: boolean; count: number };

/** Under the lock: pick the next entry, or make the empty decision (timer + notify) atomically. */
function takeHead(): Promise<QueueEntry | null> {
  return withStorageLock(async () => {
    for (;;) {
      const entries = await loadQueue();
      const head = entries[0];
      if (!head) {
        clearTimer();
        _backoffStep = 0;
        _status = { ..._status, storageError: null };
        notify(0, true);
        return null;
      }
      // Half-finished refusal from an earlier run: it is already kept for review.
      const rejected = await loadRejected();
      if (rejected.some(r => r.deviceEventId === head.deviceEventId)) {
        await writeList(STORAGE_KEY, entries.slice(1));
        continue;
      }
      // C011 (NEW-1): never replay a Pick scan without a claim generation.
      // Kept unchanged for operator review (review list first, then queue).
      if (isUnreplayablePickScan(head)) {
        const kept: RejectedQueueEntry = {
          ...head,
          status: 0,
          code: PICK_SCAN_UNCONFIRMED_HISTORICAL,
          error: 'Saved before Pick required a connection; it may already be recorded.',
          rejectedAt: Date.now(),
          reason: 'outcome_uncertain',
        };
        await writeList(REJECTED_KEY, [...rejected, kept]);
        await writeList(STORAGE_KEY, entries.slice(1));
        continue;
      }
      _rejectedCount = rejected.length;
      return head;
    }
  });
}

/** Under the lock: apply an answer to the entry it was sent for, by deviceEventId. */
function applyOutcome(sent: QueueEntry, outcome: Outcome): Promise<Step> {
  return withStorageLock(async () => {
    const entries = await loadQueue();
    const index = entries.findIndex(e => e.deviceEventId === sent.deviceEventId);
    const current = index >= 0 ? entries[index] : null;
    const remove = async () => {
      if (index < 0) return entries.length;
      const next = entries.filter((_, i) => i !== index);
      await writeList(STORAGE_KEY, next);
      return next.length;
    };
    const toReview = async (entry: QueueEntry, detail: SubmitScanError, reason: RejectedReason) => {
      const rejected = await loadRejected();
      if (!rejected.some(r => r.deviceEventId === entry.deviceEventId)) {
        rejected.push({ ...entry, ...detail, rejectedAt: Date.now(), reason });
        await writeList(REJECTED_KEY, rejected);   // first: the review copy is durable …
      }
      _rejectedCount = rejected.length;
      return remove();                              // … then it leaves the queue
    };

    switch (outcome.kind) {
      case 'delivered':
        return { stop: false, count: await remove() };
      case 'offline':
      case 'auth':
        return { stop: true, count: entries.length };
      case 'review':
        if (!current) return { stop: false, count: entries.length };
        return { stop: false, count: await toReview(current, outcome.detail, outcome.reason) };
      case 'transient': {
        if (!current) return { stop: false, count: entries.length };
        const firstServerErrorAt = current.firstServerErrorAt ?? outcome.at;
        const updated: QueueEntry = {
          ...current,
          firstServerErrorAt,
          serverErrorAttempts: (current.serverErrorAttempts ?? 0) + 1,
        };
        if (outcome.at - firstServerErrorAt > SERVER_ERROR_RECOVERY_WINDOW_MS) {
          return { stop: false, count: await toReview(updated, outcome.detail, 'server_error_retries_exhausted') };
        }
        entries[index] = updated;
        await writeList(STORAGE_KEY, entries);
        return { stop: true, count: entries.length };
      }
    }
  });
}

async function drain(): Promise<void> {
  _status = { ..._status, authPaused: false };
  for (;;) {
    let head: QueueEntry | null;
    try {
      head = await takeHead();
    } catch (err) {
      setStorageError(err);
      notify(_lastCount, _isOnline);   // never claims empty / synced
      scheduleRetry();
      return;
    }
    if (!head) return;                  // empty decision, timer and notify already done atomically

    let outcome: Outcome;
    try {
      await apiClient.post(head.url, head.body);   // the storage lock is NOT held here
      outcome = { kind: 'delivered' };
    } catch (err: unknown) {
      outcome = classify(err);
    }

    let step: Step;
    try {
      step = await applyOutcome(head, outcome);
    } catch (err) {
      // Could not persist the result: the last durable state stands and the
      // entry is processed again later (a delivered scan replays as
      // PICK_SCAN_ALREADY_RECORDED and is reconciled).
      setStorageError(err);
      notify(_lastCount, outcome.kind !== 'offline');
      scheduleRetry();
      return;
    }
    _status = { ..._status, storageError: null };

    if (outcome.kind === 'delivered') _backoffStep = 0;
    if (!step.stop) {
      notify(step.count, true);
      continue;
    }
    if (outcome.kind === 'auth') {
      clearTimer();                     // paused until credentials return
      _status = { ..._status, authPaused: true };
      notify(step.count, true);
      return;
    }
    notify(step.count, outcome.kind !== 'offline');
    scheduleRetry(outcome.kind === 'transient' ? outcome.waitMs : 0);
    return;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

function flush(): Promise<void> {
  if (_flushRun) return _flushRun;
  _flushRun = drain().finally(() => { _flushRun = null; });
  return _flushRun;
}

/** Persist a scan; resolves only after the write succeeded. Throws QueueStorageError otherwise. */
function enqueue(entry: QueueEntry): Promise<void> {
  return withStorageLock(async () => {
    const entries = await loadQueue();
    if (!entries.some(e => e.deviceEventId === entry.deviceEventId)) {
      entries.push(entry);
      await writeList(STORAGE_KEY, entries);
    }
    notify(entries.length, false);
    scheduleRetry();                    // inside the critical section: no lost wakeup
  });
}

/**
 * Try a live POST.
 * - undefined: delivered, already recorded for this operator, or durably queued.
 * - { status, code, error }: the server answered with an error, or the scan could
 *   not be saved on the device (code OFFLINE_QUEUE_WRITE_FAILED, status 0). The
 *   caller must not advance.
 */
async function submitScanWithDetail(entry: QueueEntry): Promise<SubmitScanError | undefined> {
  try {
    await apiClient.post(entry.url, entry.body);
    void flush();
    return undefined;
  } catch (err: unknown) {
    if ((err as { response?: unknown })?.response) {
      const outcome = classify(err);
      if (outcome.kind === 'delivered') {      // PICK_SCAN_ALREADY_RECORDED for this operator
        void flush();
        return undefined;
      }
      return errorDetail(err);
    }
    try {
      await enqueue(entry);
    } catch (storageErr) {
      setStorageError(storageErr);
      notify(_lastCount, false);
      return { status: 0, code: OFFLINE_QUEUE_WRITE_FAILED, error: WRITE_FAILED_MESSAGE };
    }
    return undefined;
  }
}

export const PICK_CONNECTION_LOST = 'PICK_CONNECTION_LOST';
const CONNECTION_LOST_MESSAGE = 'No connection — this scan was not recorded. Picking is paused.';

/**
 * SF-PICK-ASSIGN-01 C008 — online-only Pick (owner decision: Pick v1 requires
 * a working backend connection). The scan is confirmed only by the server:
 * - undefined: accepted (2xx), or PICK_SCAN_ALREADY_RECORDED for this operator
 *   (the authoritative answer to a retry after a lost response).
 * - { status, code, error }: any other server answer, or no answer at all
 *   (status 0, code PICK_CONNECTION_LOST). The caller must not advance.
 * Nothing is ever written to the device queue. Historical queued/rejected
 * entries are left as they are; a live success still triggers the existing
 * drain, which reconciles them through the server's ownership checks.
 */
async function submitScanOnline(entry: QueueEntry): Promise<SubmitScanError | undefined> {
  try {
    await apiClient.post(entry.url, entry.body);
  } catch (err: unknown) {
    if (!(err as { response?: unknown })?.response) {
      return { status: 0, code: PICK_CONNECTION_LOST, error: CONNECTION_LOST_MESSAGE };
    }
    if (classify(err).kind !== 'delivered') return errorDetail(err);
  }
  void flush();
  return undefined;
}

/**
 * Legacy (pre-C008) form: queues on a connectivity failure. No longer used by
 * Pick; kept because the drain contract tests seed historical entries with it.
 */
async function submitScan(entry: QueueEntry): Promise<string | undefined> {
  return (await submitScanWithDetail(entry))?.error;
}

function subscribe(fn: Listener): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

/** Queued count. Rejects (never 0) when the queue cannot be read. */
async function getCount(): Promise<number> {
  return (await loadQueue()).length;
}

/** Scans awaiting operator review. Rejects when the list cannot be read. */
async function getRejected(): Promise<RejectedQueueEntry[]> {
  const rejected = await loadRejected();
  _rejectedCount = rejected.length;
  return rejected;
}

/**
 * The operator has reviewed a scan; remove it from the device. Rejects without
 * writing on a read failure.
 *
 * C011 (NEW-1): a scan that may already be recorded (isUncertainRejected) is
 * removed only after the server durably recorded the review with the original
 * scan. Offline, 401 or any failed review → PickReviewNotRecordedError and the
 * entry is left exactly as stored. The HTTP request is never made under the lock.
 */
async function dismissRejected(deviceEventId: string): Promise<void> {
  const target = await withStorageLock(async () =>
    (await loadRejected()).find(r => r.deviceEventId === deviceEventId));
  if (target && isUncertainRejected(target)) {
    try {
      await apiClient.post(PICK_REVIEW_URL, {
        device_event_id: target.deviceEventId,
        queued_at: null,
        original: { url: target.url, method: 'POST', body: JSON.stringify(target.body) },
        // C012: the rejection as this device recorded it, kept in the audit row.
        rejection: {
          status: target.status, code: target.code,
          error: typeof target.error === 'string' ? target.error.slice(0, 2048) : null, // server limit: never 400
          reason: target.reason, rejected_at: target.rejectedAt,
        },
      });
    } catch (err: unknown) {
      const status = Number((err as { response?: { status?: unknown } })?.response?.status ?? 0);
      throw new PickReviewNotRecordedError(
        !(err as { response?: unknown })?.response ? 'offline' : status === 401 ? 'auth' : 'server',
      );
    }
  }
  const count = await withStorageLock(async () => {
    const rejected = (await loadRejected()).filter(r => r.deviceEventId !== deviceEventId);
    await writeList(REJECTED_KEY, rejected);
    _rejectedCount = rejected.length;
    // C012 (UX-TRUTH-004, F-B): the scan is removed at this point. A failed
    // re-read of the queue count must not report it as still present: keep
    // the last known count and surface the storage problem through the status.
    try {
      return (await loadQueue()).length;
    } catch (err) {
      setStorageError(err);
      return _lastCount;
    }
  });
  notify(count, _isOnline);
}

export const offlineQueue = {
  submitScanOnline,
  submitScan,
  submitScanWithDetail,
  flush,
  enqueue,
  subscribe,
  getCount,
  getRejected,
  dismissRejected,
  SERVER_ERROR_RECOVERY_WINDOW_MS,
  MAX_RETRY_DELAY_MS,
  get isOnline(): boolean { return _isOnline; },
  get status(): QueueStatus { return { ..._status }; },
};
