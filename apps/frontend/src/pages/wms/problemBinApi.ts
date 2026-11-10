import { axiosInstance } from 'api/axiosConfig';

/**
 * SF-PROBLEM-BIN Phase A — Problem Bin quarantine HTTP adapters.
 * Server-gated (PROBLEM_BIN_QUARANTINE_ENABLED); the server refuses every call
 * while disabled. Errors propagate unchanged so ProblemBinScanFlow can keep the
 * device event id across ambiguous failures and clear it on a 4xx refusal.
 *
 * Kept out of WmsOperationsPage: that page must not own Problem Bin location
 * settings (GH-1217 contract). `problem_bin_location` here is only the scanned
 * bin of one quarantine request, never the legacy shop setting.
 */
export async function resolveProblemBin(scan: string) {
  const { data } = await axiosInstance.get('/api/v1/wms/problem-bin/resolve', { params: { scan } });
  return data;
}

/** Free Scan: no operational task. */
export async function quarantineProblemBinUnit(lsu: string, bin: string, eventId: string) {
  const { data } = await axiosInstance.post('/api/v1/wms/problem-bin/quarantine', {
    lasyncro_unit_id: lsu, problem_bin_location: bin, device_event_id: eventId,
  });
  return data;
}

/** Stow adapter: task exception accounting on the server. */
export async function quarantineStowUnit(taskId: string, lsu: string, bin: string, eventId: string) {
  const { data } = await axiosInstance.post(`/api/v1/wms/stow-tasks/${taskId}/quarantine`, {
    lasyncro_unit_id: lsu, problem_bin_location: bin, device_event_id: eventId,
  });
  return data;
}
