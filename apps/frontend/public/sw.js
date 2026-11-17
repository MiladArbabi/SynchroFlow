/**
 * LASYNCRO SERVICE WORKER
 * -----------------------
 * SF-PICK-ASSIGN-01 C009 — this worker NO LONGER replays Pick scans.
 *
 * The former Background Sync drain (WM-24) sent queued scans without the
 * Bearer token, so the backend answered 401 and the entries were marked
 * rejected and abandoned. Historical entries in IndexedDB
 * 'lasyncro-wms' / 'scan-queue' are now reconciled only by the application
 * (modules/wms/src/ui/hooks/useOfflineScanQueue.ts) through the
 * authenticated API client. This worker never opens or modifies that store.
 *
 * A 'wms-pick-scan-sync' registration made by an older page may still fire;
 * it is resolved immediately with no network request so the browser stops
 * retrying it. skipWaiting + clients.claim make this version replace an
 * older, replaying worker as soon as it is fetched.
 */

const LEGACY_PICK_SCAN_SYNC_TAG = 'wms-pick-scan-sync';

// ── SW lifecycle ───────────────────────────────────────────

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('sync', (e) => {
  if (e.tag === LEGACY_PICK_SCAN_SYNC_TAG) {
    // Deliberately a no-op: reconciliation is application-driven (C009).
    e.waitUntil(Promise.resolve());
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