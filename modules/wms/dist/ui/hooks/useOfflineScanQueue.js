// modules/wms/src/ui/hooks/useOfflineScanQueue.ts
import { useEffect, useState, useCallback } from 'react';
/**
 * OFFLINE SCAN QUEUE HOOK (WM-24)
 * --------------------------------
 * Provides offline-aware pick scan submission.
 *
 * Strategy:
 * - Online: submit directly via provided httpPost, return immediately
 * - Offline: write to IndexedDB, register Background Sync tag, return optimistically
 *
 * Background Sync (sw.js) flushes the queue when connectivity is restored.
 *
 * device_event_id is passed by caller (uuidv5 — already idempotent on server).
 * Safe to replay queued scans on reconnect — server deduplicates via onConflict.ignore().
 *
 * Usage:
 *   const { isOnline, queuedCount, submitScan } = useOfflineScanQueue({ httpPost })
 */
const DB_NAME = 'lasyncro-wms';
const STORE_NAME = 'scan-queue';
const SYNC_TAG = 'wms-pick-scan-sync';
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
async function enqueue(entry) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const req = tx.objectStore(STORE_NAME).put(entry);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}
async function getQueuedCount() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function registerSync() {
    if (!('serviceWorker' in navigator))
        return;
    const reg = await navigator.serviceWorker.ready;
    if ('sync' in reg) {
        await reg.sync.register(SYNC_TAG);
    }
}
export function useOfflineScanQueue({ httpPost, }) {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [queuedCount, setQueuedCount] = useState(0);
    // Sync queue count on mount and on online event
    const refreshQueuedCount = useCallback(async () => {
        try {
            const count = await getQueuedCount();
            setQueuedCount(count);
        }
        catch {
            // IndexedDB unavailable — non-fatal
        }
    }, []);
    useEffect(() => {
        const onOnline = () => {
            setIsOnline(true);
            refreshQueuedCount();
            // Trigger SW sync when connection is restored
            registerSync().catch(() => { });
        };
        const onOffline = () => setIsOnline(false);
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        refreshQueuedCount();
        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
        };
    }, [refreshQueuedCount]);
    const submitScan = useCallback(async (params) => {
        const { deviceEventId, url, body } = params;
        if (isOnline) {
            // Online path — direct submission
            await httpPost(url, body);
        }
        else {
            // Offline path — enqueue + Background Sync
            const entry = {
                id: deviceEventId,
                url,
                method: 'POST',
                body: JSON.stringify(body),
                queuedAt: Date.now(),
            };
            await enqueue(entry);
            await registerSync();
            setQueuedCount((c) => c + 1);
            console.info('[OFFLINE_SCAN_QUEUE] Scan queued for sync', deviceEventId);
        }
    }, [isOnline, httpPost]);
    return { isOnline, queuedCount, submitScan };
}
//# sourceMappingURL=useOfflineScanQueue.js.map