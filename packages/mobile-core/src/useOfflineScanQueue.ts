// packages/mobile-core/src/useOfflineScanQueue.ts
import { useRef, useCallback, useState } from 'react';
import { apiClient } from './apiClient.js';

/**
 * OFFLINE SCAN QUEUE (mobile-core)
 * ---------------------------------
 * Moved from modules/wms/src/ui/hooks/useOfflineScanQueue.ts.
 * Shared between web WMS and mobile operator app.
 *
 * Queues barcode scan confirmations locally when offline.
 * Flushes automatically when connectivity is restored.
 *
 * Idempotency: each scan has a deviceEventId (UUID) that the
 * server uses to deduplicate on replay.
 */

export type ScanQueueEntry = {
  deviceEventId: string;
  url: string;
  body: Record<string, unknown>;
};

export type UseOfflineScanQueueOptions = {
  httpPost?: (url: string, body: Record<string, unknown>) => Promise<void>;
};

export function useOfflineScanQueue(options?: UseOfflineScanQueueOptions) {
  const queue = useRef<ScanQueueEntry[]>([]);
  const flushing = useRef(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [isOnline, setIsOnline] = useState(true);

  const httpPost = options?.httpPost ?? (async (url, body) => {
    await apiClient.post(url, body);
  });

  const flush = useCallback(async () => {
    if (flushing.current || queue.current.length === 0) return;
    flushing.current = true;

    while (queue.current.length > 0) {
      const entry = queue.current[0];
      try {
        await httpPost(entry.url, entry.body);
        queue.current.shift();
        setQueuedCount(queue.current.length);
      } catch {
        // Network still unavailable — stop flushing, try again later
        setIsOnline(false);
        break;
      }
    }

    flushing.current = false;
    if (queue.current.length === 0) setIsOnline(true);
  }, [httpPost]);

  const submitScan = useCallback(async (entry: ScanQueueEntry) => {
    try {
      await httpPost(entry.url, entry.body);
      setIsOnline(true);
    } catch {
      // Offline — queue for later
      setIsOnline(false);
      queue.current.push(entry);
      setQueuedCount(queue.current.length);
      // Attempt flush after 5s
      setTimeout(() => void flush(), 5_000);
    }
  }, [httpPost, flush]);

  return { submitScan, isOnline, queuedCount, flush };
}