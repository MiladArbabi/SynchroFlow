// apps/frontend/src/pages/wms/useWmsLiveActivity.ts
//
// WMS LIVE ACTIVITY HOOK
// ----------------------
// Polls GET /api/v1/wms/live-activity every 15s.
// Provides picker positions, active batch progress, and stow pressure
// for the Overview live map. Closes WG-11.
// See overview-live-map-playbook.md §6.

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

/**
 * OV-142: named for pickers, carries packers too since OV-136.
 */
export interface PickerPosition {
  operator_id: string;
  location_code: string;
  /**
   * OV-132: null for packers (pack scans carry no location — OV-139) and for
   * pickers on a live batch who have not scanned a bin yet. Was typed
   * non-nullable before chunk 1, which the response never honoured.
   */
  last_scan_at: string | null;
  /**
   * OV-132: the batch's last activity. Never null on a live batch — presence
   * is derived from this, not from scan recency. Grade freshness on
   * last_scan_at where present, falling back to this when it is null.
   */
  batch_activity_at: string;
  batch_id: string;
}

export interface ActiveBatch {
  batch_id: string;
  status: 'picking' | 'packing';
  picked_lines: number;
  total_lines: number;
  total_units: number;
  units_packed: number;
}

export interface StowPendingAtLocation {
  location_code: string;
  pending_units: number;
  pending_tasks: number;
}

export interface StowPressure {
  pending_count: number;
  anchor_location: string;
  /** OV-129: per-bin breakdown — drives stow badges on the live map. */
  by_location: StowPendingAtLocation[];
}

/** OV-131: units physically at a dock, keyed by real location_code. */
export interface ReceiveAtDock {
  location_code: string;
  units: number;
}

export interface WmsLiveActivity {
  pickerPositions: PickerPosition[];
  activeBatches: ActiveBatch[];
  stowPressure: StowPressure;
  receiveAtDock: ReceiveAtDock[];
  awaitingPackUnits: number;
  /**
   * OV-132: minutes after which an operator marker renders stale (amber).
   * From shop_wms_settings.idle_alert_threshold_minutes, default 15.
   */
  staleThresholdMinutes: number;
}

export function useWmsLiveActivity(enabled = true) {
  return useQuery<WmsLiveActivity>({
    queryKey: ['wms', 'live-activity'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/wms/live-activity');
      return data;
    },
    refetchInterval: 15_000,
    staleTime: 0,
    enabled,
  });
}