// apps/frontend/src/activation/hooks/useSyncStatus.ts

/**
 * useSyncStatus
 * --------------------------------------------------
 * Responsibility:
 * - Poll backend sync status
 * - Provide latest { status, counts }
 * - Handle lifecycle + cleanup
 *
 * NOTE:
 * - No UI logic here
 * - No step orchestration
 * - Safe to reuse across flows
 */

/**
 * WARNING:
 * This hook assumes a single mount.
 * If used in multiple components simultaneously,
 * it will create duplicate polling loops.
 *
 * If reuse expands → refactor to singleton polling.
 */

import { useEffect, useRef, useState } from 'react';
import { axiosInstance } from 'api/axiosConfig';

export interface SyncCounts {
  orders: number;
  variants: number;
  customers: number;
}

export interface SyncProgress {
  current: number;
  total: number;
  percentage: number;
}

export interface SyncStatusResponse {
  status: string;
  counts: SyncCounts;
  progress?: SyncProgress; // optional → backward safe
}

const POLL_INTERVAL_MS = 2000;

export function useSyncStatus() {
  const [status, setStatus] = useState<string>('PENDING');
  const [counts, setCounts] = useState<SyncCounts>({
    orders: 0,
    variants: 0,
    customers: 0,
  });

  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    abortRef.current = false;

    async function poll() {
      if (abortRef.current) return;

      try {
        const { data } = await axiosInstance.get<SyncStatusResponse>(
          '/api/v1/integrations/sync-status'
        );

        if (abortRef.current) return;

        // instrumentation: always track last known backend truth
        setStatus(data.status);
        if (data.counts) setCounts(data.counts);

        // instrumentation: capture backend progress if available
        if (data.progress) setProgress(data.progress);

      } catch (err) {
        // instrumentation: visible failure signal for debugging
        console.warn('[useSyncStatus] poll failed', err);
      }
    }

    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      abortRef.current = true;

      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  return {
    status,
    counts,
    progress, // expose backend progress
    };
}