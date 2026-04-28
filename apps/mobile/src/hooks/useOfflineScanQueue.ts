// apps/mobile/src/hooks/useOfflineScanQueue.ts
import { useRef, useCallback, useState } from 'react';
import { apiClient } from '@lasyncro/mobile-core';

/**
 * OFFLINE SCAN QUEUE (mobile)
 * ---------------------------
 * Queues barcode scan confirmations locally when offline.
 * Flushes automatically when connectivity is restored.
 */

export type ScanQueueEntry = {
  deviceEventId: string;
  url: string;
  body: Record<string, unknown>;
};

export function useOfflineScanQueue() {
  const queue = useRef<ScanQueueEntry[]>([]);
  const flushing = useRef(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [isOnline, setIsOnline] = useState(true);

  const flush = useCallback(async () => {
    if (flushing.current || queue.current.length === 0) return;
    flushing.current = true;
    while (queue.current.length > 0) {
      const entry = queue.current[0];
      try {
        await apiClient.post(entry.url, entry.body);
        queue.current.shift();
        setQueuedCount(queue.current.length);
      } catch {
        setIsOnline(false);
        break;
      }
    }
    flushing.current = false;
    if (queue.current.length === 0) setIsOnline(true);
  }, []);

  const submitScan = useCallback(async (entry: ScanQueueEntry) => {
    try {
      await apiClient.post(entry.url, entry.body);
      setIsOnline(true);
    } catch {
      setIsOnline(false);
      queue.current.push(entry);
      setQueuedCount(queue.current.length);
      setTimeout(() => void flush(), 5_000);
    }
  }, [flush]);

  return { submitScan, isOnline, queuedCount, flush };
}