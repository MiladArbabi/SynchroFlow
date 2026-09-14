// tests/unit/alerts/alert-action-resolver.test.ts
//
// STOCK-PROTECT-03 Slice 3A — pure unit contract for alertActionResolver.
// PERMANENT regression contract.
// ===========================================================================
// Pure function tests only — no DB, no Express, no Knex, no network.

import {
  resolveAlertAction,
  getActionableStockProtectionTreatments,
  type CommercialActionContext,
  type AlertActionInput,
} from 'api-src/services/alerts/alertActionResolver';

const FULL_ACCESS: CommercialActionContext = {
  stockProtectionAllowed: true,
  sourcingAllowed: true,
  purchasingCoreAllowed: true,
};

const NO_ACCESS: CommercialActionContext = {
  stockProtectionAllowed: false,
  sourcingAllowed: false,
  purchasingCoreAllowed: false,
};

function baseAlert(overrides: Partial<AlertActionInput> = {}): AlertActionInput {
  return {
    alert_type: 'stock_protection',
    treatment: 'reorder_now',
    entity_type: 'variant',
    entity_id: 'variant-123',
    is_active: true,
    resolved_at: null,
    ...overrides,
  };
}

describe('getActionableStockProtectionTreatments', () => {
  it('stockProtectionAllowed=false -> []', () => {
    expect(getActionableStockProtectionTreatments({ stockProtectionAllowed: false, sourcingAllowed: true, purchasingCoreAllowed: true })).toEqual([]);
  });

  it('full access -> reorder_now, finish_reorder, receive_inbound', () => {
    expect(getActionableStockProtectionTreatments(FULL_ACCESS).sort()).toEqual(
      ['finish_reorder', 'receive_inbound', 'reorder_now'].sort(),
    );
  });

  it('stockProtectionAllowed + purchasingCoreAllowed only -> receive_inbound', () => {
    expect(getActionableStockProtectionTreatments({ stockProtectionAllowed: true, sourcingAllowed: false, purchasingCoreAllowed: true })).toEqual([
      'receive_inbound',
    ]);
  });

  it('stockProtectionAllowed + sourcingAllowed only -> reorder_now, finish_reorder', () => {
    expect(getActionableStockProtectionTreatments({ stockProtectionAllowed: true, sourcingAllowed: true, purchasingCoreAllowed: false }).sort()).toEqual(
      ['finish_reorder', 'reorder_now'].sort(),
    );
  });

  it('never includes complete_setup', () => {
    expect(getActionableStockProtectionTreatments(FULL_ACCESS)).not.toContain('complete_setup');
  });
});

describe('resolveAlertAction', () => {
  it('reorder_now + all access -> targeted Sourcing', () => {
    expect(resolveAlertAction(baseAlert({ treatment: 'reorder_now' }), FULL_ACCESS)).toEqual({
      key: 'stock_protection_reorder_now',
      label: 'Reorder now',
      route: '/suppliers-portal/sourcing?variantId=variant-123',
      module: 'suppliers-portal',
    });
  });

  it('reorder_now + stockProtectionAllowed=false -> null', () => {
    expect(
      resolveAlertAction(baseAlert({ treatment: 'reorder_now' }), { ...FULL_ACCESS, stockProtectionAllowed: false }),
    ).toBeNull();
  });

  it('reorder_now + sourcingAllowed=false -> null', () => {
    expect(
      resolveAlertAction(baseAlert({ treatment: 'reorder_now' }), { ...FULL_ACCESS, sourcingAllowed: false }),
    ).toBeNull();
  });

  it('finish_reorder + all access -> SAME route as reorder_now, distinct key/label', () => {
    const result = resolveAlertAction(baseAlert({ treatment: 'finish_reorder' }), FULL_ACCESS);
    expect(result).toEqual({
      key: 'stock_protection_finish_reorder',
      label: 'Finish reorder',
      route: '/suppliers-portal/sourcing?variantId=variant-123',
      module: 'suppliers-portal',
    });
  });

  it('finish_reorder + sourcing denied -> null', () => {
    expect(
      resolveAlertAction(baseAlert({ treatment: 'finish_reorder' }), { ...FULL_ACCESS, sourcingAllowed: false }),
    ).toBeNull();
  });

  it('receive_inbound + Stock Protection + purchasing.core -> /suppliers-portal', () => {
    expect(resolveAlertAction(baseAlert({ treatment: 'receive_inbound' }), FULL_ACCESS)).toEqual({
      key: 'stock_protection_receive_inbound',
      label: 'Receive inbound',
      route: '/suppliers-portal',
      module: 'suppliers-portal',
    });
  });

  it('receive_inbound + purchasingCoreAllowed=false -> null', () => {
    expect(
      resolveAlertAction(baseAlert({ treatment: 'receive_inbound' }), { ...FULL_ACCESS, purchasingCoreAllowed: false }),
    ).toBeNull();
  });

  it('complete_setup -> null', () => {
    expect(resolveAlertAction(baseAlert({ treatment: 'complete_setup' }), FULL_ACCESS)).toBeNull();
  });

  it('none -> null', () => {
    expect(resolveAlertAction(baseAlert({ treatment: 'none' }), FULL_ACCESS)).toBeNull();
  });

  it('unknown treatment -> null', () => {
    expect(resolveAlertAction(baseAlert({ treatment: 'some_future_treatment' }), FULL_ACCESS)).toBeNull();
  });

  it('null treatment -> null', () => {
    expect(resolveAlertAction(baseAlert({ treatment: null }), FULL_ACCESS)).toBeNull();
  });

  it('wrong entity_type -> null', () => {
    expect(resolveAlertAction(baseAlert({ entity_type: 'order' }), FULL_ACCESS)).toBeNull();
  });

  it('missing entity_id -> null', () => {
    expect(resolveAlertAction(baseAlert({ entity_id: null }), FULL_ACCESS)).toBeNull();
  });

  it('inactive -> null', () => {
    expect(resolveAlertAction(baseAlert({ is_active: false }), FULL_ACCESS)).toBeNull();
  });

  it('resolved_at != null -> null, even if is_active is still true', () => {
    expect(resolveAlertAction(baseAlert({ is_active: true, resolved_at: new Date() }), FULL_ACCESS)).toBeNull();
  });

  it('non stock_protection alert_type -> null', () => {
    expect(resolveAlertAction(baseAlert({ alert_type: 'stockout_risk' }), FULL_ACCESS)).toBeNull();
  });

  it('no access at all -> null regardless of treatment', () => {
    expect(resolveAlertAction(baseAlert({ treatment: 'reorder_now' }), NO_ACCESS)).toBeNull();
    expect(resolveAlertAction(baseAlert({ treatment: 'receive_inbound' }), NO_ACCESS)).toBeNull();
  });

  it('variantId is safely URL-encoded', () => {
    const result = resolveAlertAction(baseAlert({ entity_id: 'variant with spaces/slash' }), FULL_ACCESS);
    expect(result?.route).toBe('/suppliers-portal/sourcing?variantId=variant%20with%20spaces%2Fslash');
  });
});
