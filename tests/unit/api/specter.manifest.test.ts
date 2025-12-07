// tests/unit/api/specter.manifest.test.ts
import { MODULE_ONBOARDING_MANIFESTS } from 'api-src/onboarding/readiness.manifest';

describe('Onboarding manifest – specter module', () => {
  it('includes a specter module manifest with expected signals and task', () => {
    const specter = MODULE_ONBOARDING_MANIFESTS.find(
      (m) => m.moduleId === 'specter'
    );

    expect(specter).toBeDefined();
    expect(specter?.displayName).toContain('Specter');

    expect(specter?.requiredSignals).toContain('specter.sdkInstalled');

    const taskIds = specter?.tasks.map((t) => t.id) ?? [];
    expect(taskIds).toContain('specter-sdk-installed');
  });
});
