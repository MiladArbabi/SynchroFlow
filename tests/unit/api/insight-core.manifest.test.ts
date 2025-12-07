// tests/unit/api/insight-core.manifest.test.ts
import { MODULE_ONBOARDING_MANIFESTS } from 'api-src/onboarding/readiness.manifest';

describe('Onboarding manifest – insight-core module', () => {
  it('includes an insight-core module manifest with base signals', () => {
    const insightCore = MODULE_ONBOARDING_MANIFESTS.find(
      (m) => m.moduleId === 'insight-core'
    );

    expect(insightCore).toBeDefined();
    expect(insightCore?.displayName).toContain('Core CNS Intelligence');

    expect(insightCore?.requiredSignals).toEqual(
      expect.arrayContaining([
        'insightCore.orderCount',
        'insightCore.productCount',
        'insightCore.baseSignalsReady'
      ])
    );

    const taskIds = insightCore?.tasks.map((t) => t.id) ?? [];
    expect(taskIds).toContain('insight-core-base-signals');
  });
});
