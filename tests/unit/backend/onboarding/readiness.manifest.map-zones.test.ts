// tests/unit/backend/onboarding/readiness.manifest.map-zones.test.ts
//
// GH1176 — DB-free contract for the "Map your warehouse zones" SETUP task.
// The canonical readiness action is serialized onboarding navigation straight
// into Floor Planning Setup > Canvas, not the bare module root. Completion
// stays owned by wms.zonesConfigured.

import { MODULE_ONBOARDING_MANIFESTS } from 'api-src/onboarding/readiness.manifest';

const GH1176_MAP_ZONES_ROUTE = '/floor-planning?tab=setup&view=canvas';

describe('WMS onboarding manifest — map-zones task', () => {
  const wmsManifest = MODULE_ONBOARDING_MANIFESTS.find((m) => m.moduleId === 'wms');
  const task = wmsManifest?.tasks.find((t) => t.id === 'map-zones');

  it('GH1176: navigates to Floor Planning Setup > Canvas', () => {
    expect(task?.action).toEqual({ type: 'navigate', target: GH1176_MAP_ZONES_ROUTE });
  });

  it('GH1176 invariant: completion stays gated on wms.zonesConfigured only', () => {
    expect(task?.required).toBe(false);
    expect(task?.completionRules).toEqual([
      { signal: 'wms.zonesConfigured', expectedValue: true },
    ]);
  });
});
