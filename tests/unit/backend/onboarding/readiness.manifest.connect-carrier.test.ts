// tests/unit/backend/onboarding/readiness.manifest.connect-carrier.test.ts
//
// DB-free structural coverage for the "Connect your shipping carrier"
// SETUP task in the WMS onboarding manifest. Pure object inspection —
// MODULE_ONBOARDING_MANIFESTS is a static array, no DB access.

import { MODULE_ONBOARDING_MANIFESTS } from 'api-src/onboarding/readiness.manifest';

describe('WMS onboarding manifest — connect-carrier task', () => {
  const wmsManifest = MODULE_ONBOARDING_MANIFESTS.find((m) => m.moduleId === 'wms');
  const task = wmsManifest?.tasks.find((t) => t.id === 'connect-carrier');

  it('includes wms.carrierConfigured in requiredSignals', () => {
    expect(wmsManifest?.requiredSignals).toContain('wms.carrierConfigured');
  });

  it('defines the connect-carrier task as optional', () => {
    expect(task).toBeDefined();
    expect(task?.required).toBe(false);
  });

  it('gates completion on wms.carrierConfigured === true', () => {
    expect(task?.completionRules).toEqual([
      { signal: 'wms.carrierConfigured', expectedValue: true }
    ]);
  });

  it('navigates to /settings/carriers', () => {
    expect(task?.action).toEqual({ type: 'navigate', target: '/settings/carriers' });
  });

  it('does not force wms module readiness to depend on carrier setup', () => {
    // isReady is computed only from required:true tasks (readiness.service.ts).
    // connect-carrier being optional means adding it must not add a new
    // required-task obligation.
    const requiredTaskIds = wmsManifest?.tasks.filter((t) => t.required).map((t) => t.id) ?? [];
    expect(requiredTaskIds).not.toContain('connect-carrier');
  });
});
