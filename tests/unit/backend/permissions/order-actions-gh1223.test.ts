// GH-1223 / TIER-08 — canonical Orders write actions in the role→action catalog.
//
// Ratified contract:
//   orders:execute                 — owner/admin allow, operator deny, LOCKED
//   orders:shipping-address:write  — owner/admin allow, operator deny, LOCKED
//
// The shipping correction is a distinct action — it must not reuse
// orders:execute. DB-free: db.js is mocked (no query is issued by the catalog
// constants), following openingInventoryCutover.controller.test.ts.

jest.mock('@lasyncro/backend-core/db.js', () => ({
  __esModule: true,
  default: {},
}));

import { ACTION_ROLE_MAP } from 'api-src/middleware/require-action.middleware';
import { LOCKED_ACTIONS } from 'api-src/services/permissions/permissionSettings.service';

describe('GH-1223 — canonical Orders write actions', () => {
  it('orders:execute is owner/admin only', () => {
    expect(ACTION_ROLE_MAP['orders:execute']).toEqual(['owner', 'admin']);
  });

  it('orders:shipping-address:write is owner/admin only', () => {
    expect(ACTION_ROLE_MAP['orders:shipping-address:write']).toEqual(['owner', 'admin']);
  });

  it('both Orders write actions are LOCKED (never shop-configurable)', () => {
    expect(LOCKED_ACTIONS.has('orders:execute')).toBe(true);
    expect(LOCKED_ACTIONS.has('orders:shipping-address:write')).toBe(true);
  });
});
