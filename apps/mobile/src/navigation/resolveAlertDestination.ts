// apps/mobile/src/navigation/resolveAlertDestination.ts
//
// STOCK-PROTECT-03 — pure alert_type -> mobile navigation destination
// decision, extracted from App.tsx's AlertFeed so it is testable without a
// React Native / Expo runtime. Zero RN/Expo/navigation dependencies.
//
// Returning null means "do not navigate." This is the contract for
// alert_type='stock_protection': no canonical mobile Sourcing/Open-PO
// destination exists yet, and a backend web route (alert.action.route) is
// not a React Navigation route — it must never be interpreted as one, and
// must never silently fall back to the generic Intelligence tab either.
// Temporary until a real mobile Stock Protection/Purchasing treatment
// surface exists.

export type MobileAlertDestination = {
  screen: 'Tasks' | 'Intelligence';
  params?: { initialTab: 'inbound' | 'outbound' | 'exceptions' };
};

const WMS_TAB_MAP: Record<string, 'inbound' | 'outbound' | 'exceptions'> = {
  wms_receive_arrived:     'inbound',
  wms_stow_pending:        'inbound',
  wms_supplier_rating:     'inbound',
  wms_batch_ready_to_pack: 'outbound',
  wms_batch_ready_to_ship: 'outbound',
  wms_batch_released:      'outbound',
  wms_receive_exception:   'exceptions',
  wms_pick_exception:      'exceptions',
  wms_pack_exception:      'exceptions',
  wms_stow_exception:      'exceptions',
};

export function resolveAlertDestination(alertType: string): MobileAlertDestination | null {
  if (alertType === 'stock_protection') return null;

  if (alertType.startsWith('wms_')) {
    return { screen: 'Tasks', params: { initialTab: WMS_TAB_MAP[alertType] ?? 'inbound' } };
  }
  if (alertType === 'stockout_risk' || alertType === 'sla_breach' || alertType === 'operational') {
    return { screen: 'Tasks', params: { initialTab: alertType === 'stockout_risk' ? 'inbound' : 'outbound' } };
  }
  return { screen: 'Intelligence' };
}
