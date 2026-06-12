// packages/mobile-core/src/offlineQueue.ts
//
// OFFLINE CONFIRM QUEUE — @lasyncro/mobile-core (DECISION-F)
// -----------------------------------------------------------
// Standalone service for queuing WMS scan confirmations when offline.
// Persists to AsyncStorage so queued entries survive app restart.
// Consumed by Work screens (Pick) via offlineQueue.submitScan().
//
// DESIGN:
//   submitScan()  — try live POST; on network failure, queue + retry with
//                   exponential backoff (2s → 4s → 8s → 16s → 32s → 64s).
//                   On HTTP validation failure (4xx/5xx with response),
//                   surface error to caller — do NOT queue (won't succeed on retry).
//   flush()       — drain queue; called on mount, after each live success,
//                   and on AppState 'active' (connectivity restore path).
//   subscribe()   — React components subscribe to (count, isOnline) updates.
//   enqueue()     — deduplicates by deviceEventId before persisting.
//
// RETRY STRATEGY (XPLAT-04):
//   Exponential backoff replaces blind 5s timer.
//   AppState 'active' listener in PickBriefScreen triggers flush() on foreground —
//   covers connectivity restore without requiring @react-native-community/netinfo.
//   Backoff resets to 0 after a successful drain.
//
// IDEMPOTENCY: device_event_id in each entry provides server-side deduplication.
// Duplicate enqueue calls (same deviceEventId) are silently dropped.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from './apiClient';

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueueEntry = {
  deviceEventId: string;
  url: string;
  body: Record<string, unknown>;
};

type Listener = (count: number, isOnline: boolean) => void;

// ─── Module-level singleton state ─────────────────────────────────────────────

const STORAGE_KEY  = 'ls:offline_queue';
let _flushing      = false;
let _isOnline      = true;
let _retryCount    = 0;
const MAX_RETRIES  = 6;
const BASE_DELAY   = 2_000; // ms — doubles each attempt: 2s→4s→8s→16s→32s→64s
const _listeners   = new Set<Listener>();

// ─── Internal helpers ─────────────────────────────────────────────────────────

function notify(count: number, online: boolean): void {
  _isOnline = online;
  _listeners.forEach(fn => fn(count, online));
}

function scheduleRetry(): void {
  if (_retryCount >= MAX_RETRIES) {
    // Ceiling reached — next flush triggered by AppState 'active' in consumer
    return;
  }
  const delay = BASE_DELAY * Math.pow(2, _retryCount);
  _retryCount++;
  setTimeout(() => void flush(), delay);
}

async function loadQueue(): Promise<QueueEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueueEntry[]) : [];
  } catch {
    return [];
  }
}

async function saveQueue(entries: QueueEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // non-fatal — worst case entries are replayed on next launch
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function flush(): Promise<void> {
  if (_flushing) return;
  _flushing = true;
  try {
    const entries = await loadQueue();
    while (entries.length > 0) {
      const entry = entries[0];
      try {
        await apiClient.post(entry.url, entry.body);
        entries.shift();
        await saveQueue(entries);
        notify(entries.length, true);
      } catch (err: unknown) {
        if ((err as { response?: unknown })?.response) {
          // HTTP error — server rejected; remove from queue (won't succeed on retry)
          entries.shift();
          await saveQueue(entries);
          notify(entries.length, entries.length === 0);
        } else {
          // Network error — stop, schedule exponential backoff retry
          notify(entries.length, false);
          break;
        }
      }
    }
    if (entries.length === 0) {
      _retryCount = 0; // reset backoff on successful drain
      notify(0, true);
    }
  } finally {
    _flushing = false;
  }
}

async function enqueue(entry: QueueEntry): Promise<void> {
  const entries = await loadQueue();
  if (!entries.find(e => e.deviceEventId === entry.deviceEventId)) {
    entries.push(entry);
    await saveQueue(entries);
  }
  notify(entries.length, false);
  scheduleRetry();
}

/**
 * Try a live POST.
 * - Returns undefined on success or when offline-queued (caller advances optimistically).
 * - Returns an error string on HTTP validation failure (4xx/5xx with a response body).
 */
async function submitScan(entry: QueueEntry): Promise<string | undefined> {
  try {
    await apiClient.post(entry.url, entry.body);
    void flush(); // drain any queued items now we're online
    return undefined;
  } catch (err: unknown) {
    if ((err as { response?: unknown })?.response) {
      // HTTP error — server responded; surface to caller, do not queue
      return (
        (err as { response?: { data?: { error?: string } } })
          ?.response?.data?.error ?? 'Server error.'
      );
    }
    // Network error — queue optimistically, schedule backoff retry
    await enqueue(entry);
    return undefined;
  }
}

function subscribe(fn: Listener): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

async function getCount(): Promise<number> {
  return (await loadQueue()).length;
}

export const offlineQueue = {
  submitScan,
  flush,
  enqueue,
  subscribe,
  getCount,
  get isOnline(): boolean { return _isOnline; },
};