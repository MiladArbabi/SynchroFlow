/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/utils/qzPrint.ts
//
// WM-47 / SHOP-REVIEW-BARCODE-PRINT-05 — QZ Tray print dispatch
// ------------------------------------------------------------------
// Wraps the qz-tray npm package for silent label routing. QZ Tray is an
// OPTIONAL acceleration path — every caller MUST have a working browser-PDF
// fallback, and this module never throws.
//
// Result contract (SHOP-REVIEW-BARCODE-PRINT-05):
//   printViaQz() returns a discriminated PrintDispatchResult so the UI can tell
//   a real silent dispatch ({ status: 'dispatched', printerName }) apart from
//   the three fallback reasons ({ status: 'fallback', reason }). No QZ /
//   Axios / SQL internals ever reach the UI.
//
// Ordering (SHOP-REVIEW-BARCODE-PRINT-05):
//   The configured default printer for the role is looked up FIRST. If none is
//   configured the QZ websocket connection is NOT attempted at all — a reviewer
//   with no printer setup should not incur a pointless localhost:8182 failure
//   before browser printing.
//
// Connection lifecycle: the websocket is intentionally left open between prints
// — repeated warehouse label printing legitimately reuses it. No
// disconnect-after-every-print, no certificate/signature work here.

import qz from 'qz-tray';
import type { AxiosInstance } from 'axios';

/**
 * Why QZ silent dispatch did not happen. Stable, machine-readable, UI-safe.
 *   no_default_printer — no default printer is configured for the role
 *   qz_unavailable     — QZ Tray is not running / not reachable
 *   qz_failed          — QZ Tray was reachable but the print call failed
 */
export type PrintFallbackReason =
  | 'no_default_printer'
  | 'qz_unavailable'
  | 'qz_failed';

export type PrintDispatchResult =
  | { status: 'dispatched'; printerName: string }
  | { status: 'fallback'; reason: PrintFallbackReason };

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
 *
 * Returns `{ status: 'dispatched', printerName }` only when QZ Tray actually
 * accepted the job. In every other case returns `{ status: 'fallback', reason }`
 * and the caller MUST render its durable browser-PDF recovery. Never throws.
 */
export async function printViaQz(
  pdfBlob: Blob,
  role: string,
  axios: AxiosInstance
): Promise<PrintDispatchResult> {
  // 1. Configured printer first — no printer means no reason to touch QZ.
  const printerName = await getDefaultPrinterName(role, axios);
  if (!printerName) return { status: 'fallback', reason: 'no_default_printer' };

  // 2. QZ Tray reachable?
  const connected = await ensureConnected();
  if (!connected) return { status: 'fallback', reason: 'qz_unavailable' };

  // 3. Dispatch.
  try {
    const arrayBuffer = await pdfBlob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    const base64 = btoa(binary);

    const config = qz.configs.create(printerName);
    const data = [{
      type: 'pixel',
      format: 'pdf',
      flavor: 'base64',
      data: base64,
    }];

    await qz.print(config, data);
    return { status: 'dispatched', printerName };
  } catch (err) {
    console.warn('[QZ_PRINT_FAILED]', err);
    return { status: 'fallback', reason: 'qz_failed' };
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
