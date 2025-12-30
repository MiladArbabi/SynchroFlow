// tests/unit/backend/onboarding/readiness.signal-passthrough.test.ts

import { OnboardingReadinessService } from 'api-src/onboarding/readiness.service';
import { specterOnboardingSignalProvider } from 'api-src/onboarding/providers/specter.provider';

describe('OnboardingReadinessService – signal passthrough', () => {
  const shopId = 1234;

  it('includes provider signals for modules with empty requiredSignals', async () => {
    // Arrange
    const service = new OnboardingReadinessService();

    // Act
    const snapshot = await service.getSnapshot({ shopId });

    const specterModule = snapshot.modules.find(
      m => m.moduleId === 'specter'
    );

    // Assert
    expect(specterModule).toBeDefined();

    const signalNames = (specterModule?.signals ?? []).map(s => s.name);

    expect(signalNames).toContain('specter.sessionsKnown');
    expect(signalNames).toContain('specter.sessionCount');
    expect(signalNames).toContain('specter.signalConfidence');
  });
});
