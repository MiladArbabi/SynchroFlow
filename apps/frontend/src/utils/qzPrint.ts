/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/utils/qzPrint.ts
//
// WM-47 — QZ Tray Print Dispatch
// --------------------------------
// Wraps the qz-tray npm package for silent label routing.
//
// Usage:
//   const dispatched = await printViaqz(pdfBlob, 'unit_label', axiosInstance);
//   if (!dispatched) fallback to browser dialog
//
// Flow:
//   1. Connect to QZ Tray (localhost:8182)
//   2. Fetch default printer for role from /api/v1/wms/printers/default/:role
//   3. Build QZ print config + data from PDF blob
//   4. Dispatch silently — no browser dialog
//   5. Disconnect
//
// If QZ Tray is not running or no default printer is configured for the role,
// returns false — caller opens PDF blob in browser tab as fallback.
//
// Never throws — all errors are caught and return false so the caller
// always has a working fallback path.

import qz from 'qz-tray';
import type { AxiosInstance } from 'axios';

let qzConnected = false;

async function ensureConnected(): Promise<boolean> {
  try {
    if (qz.websocket.isActive()) return true;
    await qz.websocket.connect({ retries: 1, delay: 0.5 });
    qzConnected = true;
    return true;
  } catch {
    qzConnected = false;
    return false;
  }
}

async function getDefaultPrinterName(
  role: string,
  axios: AxiosInstance
): Promise<string | null> {
  try {
    const { data } = await axios.get(`/api/v1/wms/printers/default/${role}`);
    return data?.printer?.os_printer_name ?? null;
  } catch {
    return null;
  }
}

/**
 * Attempts to print a PDF blob silently via QZ Tray.
 * Returns true if dispatched, false if QZ Tray unavailable or no printer configured.
 * Caller handles the false case by opening the blob in a browser tab.
 */
export async function printViaQz(
  pdfBlob: Blob,
  role: string,
  axios: AxiosInstance
): Promise<boolean> {
  try {
    const connected = await ensureConnected();
    if (!connected) return false;

    const printerName = await getDefaultPrinterName(role, axios);
    if (!printerName) return false;

    // Convert blob to base64
    const arrayBuffer = await pdfBlob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    const base64 = btoa(binary);

    const config = qz.configs.create(printerName);
    const data = [{
      type: 'pixel',
      format: 'pdf',
      flavor: 'base64',
      data: base64,
    }];

    await qz.print(config, data);
    return true;
  } catch (err) {
    console.warn('[QZ_PRINT_FAILED]', err);
    return false;
  }
}

/**
 * Returns true if QZ Tray is reachable on this machine.
 * Used by the settings page and onboarding prompt for status detection.
 */
export async function isQzAvailable(): Promise<boolean> {
  try {
    if (qz.websocket.isActive()) return true;
    await qz.websocket.connect({ retries: 1, delay: 0.5 });
    return true;
  } catch {
    return false;
  }
}