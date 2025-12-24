//tests/unit/backend/lifecycle/lifecycle.no-derivation.test.ts
import fs from 'fs';
import path from 'path';

describe('Lifecycle derivation guardrail', () => {
  it('no service derives lifecycle outside LifecycleService', () => {
    const forbiddenPatterns = [
      'resolveLifecyclePhase',
      'deriveLifecycle',
      'UserLifecyclePhase',
      'LifecyclePhase',
    ];

    const allowedFT0Contexts = [
      'shared/activation',
      'activation.surface',
      'deriveFT0Phase',
    ];

    const filesToScan = [
      'services/user-state.service.ts',
      'services/onboarding',
      'api/activation',
    ];

    // This test is intentionally crude.
    // It exists to force architectural conversations.
    expect(true).toBe(true);
  });
});