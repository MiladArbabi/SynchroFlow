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

export interface PickerPosition {
  operator_id: string;
  location_code: string;
  last_scan_at: string;
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

export interface WmsLiveActivity {
  pickerPositions: PickerPosition[];
  activeBatches: ActiveBatch[];
  stowPressure: StowPressure;
  awaitingPackUnits: number;
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