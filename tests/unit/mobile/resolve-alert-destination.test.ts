// tests/unit/mobile/resolve-alert-destination.test.ts
//
// STOCK-PROTECT-03 — mobile alert routing safety contract. PERMANENT
// regression contract.
// ===========================================================================
// Pure function, zero React Native/Expo/navigation dependencies — this is
// the narrowest possible proof that alert_type='stock_protection' never
// navigates anywhere (not Intelligence, not Tasks, not an invented
// destination) while every legacy mapping is unchanged.

import { resolveAlertDestination } from '../../../apps/mobile/src/navigation/resolveAlertDestination';

describe('resolveAlertDestination — stock_protection safety', () => {
  it('stock_protection -> null: does not navigate to Intelligence, Tasks, or anywhere else', () => {
    const result = resolveAlertDestination('stock_protection');

    expect(result).toBeNull();
  });
});

describe('resolveAlertDestination — legacy mappings unchanged', () => {
  it('unknown/unrecognized alert types fall back to Intelligence (unchanged legacy behavior)', () => {
    expect(resolveAlertDestination('brand_new_signal_2027')).toEqual({ screen: 'Intelligence' });
  });

  it('stockout_risk -> Tasks/inbound (unchanged)', () => {
    expect(resolveAlertDestination('stockout_risk')).toEqual({
      screen: 'Tasks',
      params: { initialTab: 'inbound' },
    });
  });

  it('sla_breach -> Tasks/outbound (unchanged)', () => {
    expect(resolveAlertDestination('sla_breach')).toEqual({
      screen: 'Tasks',
      params: { initialTab: 'outbound' },
    });
  });

  it('operational -> Tasks/outbound (unchanged)', () => {
    expect(resolveAlertDestination('operational')).toEqual({
      screen: 'Tasks',
      params: { initialTab: 'outbound' },
    });
  });

  it.each([
    ['wms_receive_arrived', 'inbound'],
    ['wms_stow_pending', 'inbound'],
    ['wms_supplier_rating', 'inbound'],
    ['wms_batch_ready_to_pack', 'outbound'],
    ['wms_batch_ready_to_ship', 'outbound'],
    ['wms_batch_released', 'outbound'],
    ['wms_receive_exception', 'exceptions'],
    ['wms_pick_exception', 'exceptions'],
    ['wms_pack_exception', 'exceptions'],
    ['wms_stow_exception', 'exceptions'],
  ] as const)('%s -> Tasks/%s (unchanged)', (alertType, initialTab) => {
    expect(resolveAlertDestination(alertType)).toEqual({
      screen: 'Tasks',
      params: { initialTab },
    });
  });

  it('an unmapped wms_ prefix falls back to inbound (unchanged default)', () => {
    expect(resolveAlertDestination('wms_never_classified')).toEqual({
      screen: 'Tasks',
      params: { initialTab: 'inbound' },
    });
  });
});
