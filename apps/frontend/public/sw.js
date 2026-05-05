/**
 * WMS OFFLINE SERVICE WORKER (WM-24)
 * ------------------------------------
 * Handles Background Sync for pick scan queue.
 *
 * IndexedDB store: 'wms-scan-queue'
 * Sync tag: 'wms-pick-scan-sync'
 *
 * Each queued entry shape:
 * {
 *   id: string,           // device_event_id (uuidv5 — idempotent on server)
 *   url: string,
 *   method: string,
 *   body: string,         // JSON.stringify of request body
 *   queuedAt: number,
 * }
 *
 * Invariants:
 * - Entries are removed only on confirmed 2xx response
 * - Non-2xx (4xx) entries are discarded — not retried (bad request, not transient)
 * - 5xx entries stay in queue for next sync cycle
 * - SW never advances pick session state — that is owned by UI
 */

const DB_NAME = 'lasyncro-wms';
const STORE_NAME = 'scan-queue';
const SYNC_TAG = 'wms-pick-scan-sync';

// ── IndexedDB helpers ──────────────────────────────────────

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllEntries(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteEntry(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Sync handler ───────────────────────────────────────────

async function flushScanQueue() {
  const db = await openDb();
  const entries = await getAllEntries(db);

  for (const entry of entries) {
    try {
      const res = await fetch(entry.url, {
        method: entry.method,
        headers: { 'Content-Type': 'application/json' },
        body: entry.body,
        credentials: 'include',
      });

      if (res.ok) {
        // Confirmed — remove from queue
        await deleteEntry(db, entry.id);
        console.info('[SW] Scan synced and removed from queue', entry.id);
      } else if (res.status >= 400 && res.status < 500) {
        // Client error — discard, not retryable
        await deleteEntry(db, entry.id);
        console.warn('[SW] Scan discarded (4xx)', entry.id, res.status);
      }
      // 5xx — leave in queue, retry on next sync
    } catch (err) {
      // Network error — leave in queue
      console.warn('[SW] Scan sync failed, will retry', entry.id, err.message);
    }
  }
}

// ── SW lifecycle ───────────────────────────────────────────

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('sync', (e) => {
  if (e.tag === SYNC_TAG) {
    e.waitUntil(flushScanQueue());
  }
});

// ── Web Push Event Handler (WM-22) ─────────────────────────────────────────
//
// Handles incoming push messages from the backend notification dispatch service.
//
// Expected payload shape:
//   { title: string, body: string, url?: string, tag?: string }
//
// tag: deduplicates notifications — same tag replaces previous (e.g. alert updates)
// url: deep link opened on notification click

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'LaSyncro', body: event.data.text() };
  }

  const title = payload.title ?? 'LaSyncro';
  const options = {
    body:    payload.body ?? '',
    icon:    '/favicon.png',
    badge:   '/favicon.png',
    tag:     payload.tag ?? 'lasyncro-notification',
    data:    { url: payload.url ?? '/' },
    requireInteraction: payload.urgent === true,
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// On notification click — focus app or open deep link
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url ?? '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If app already open, focus it and navigate
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(url);
          return;
        }
      }
      // Otherwise open new window
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});