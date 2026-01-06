//tests/unit/backend/specter/specterFtep.service.test.ts
import { applySpecterFtep } from 'api-src/services/specter-ftep/specterFtep.service';
import { SpecterFacts } from 'api-src/services/specter-facts/specterFacts.types';
import { SpecterIntelligence } from 'api-src/services/specter-intelligence/specterIntelligence.service';

describe('SpecterFtep.service', () => {
  const baseFacts: SpecterFacts = {
    shopId: 1,
    period: { from: '2024-01-01', to: '2024-01-07' },
    sessionsObserved: 10,
    exitIntentSessions: 2,
    funnelsDetected: true,
    extractedAt: new Date().toISOString()
  };

  it('exposes only FT2-safe fields', () => {
    const intelligence: SpecterIntelligence = {
      engagement: { status: 'positive' },
      behavior: { trend: 'stable' }
    };

    const exposure = applySpecterFtep({
      facts: baseFacts,
      intelligence
    });

    expect(exposure.context.sessionsObserved).toBe(10);
    expect(exposure.outcome?.status).toBe('positive');
    expect(exposure.signals.funnelsDetected).toBe(true);
    expect(exposure.dataCoverage.sessionsPresent).toBe(true);
  });

  it('returns null outcome when intelligence is unknown', () => {
    const intelligence: SpecterIntelligence = {
      engagement: { status: 'unknown' },
      behavior: { trend: 'unknown' }
    };

    const exposure = applySpecterFtep({
      facts: baseFacts,
      intelligence
    });

    expect(exposure.outcome).toBeNull();
  });

  it('prevents intelligence structure leakage', () => {
    const intelligence: SpecterIntelligence = {
      engagement: { status: 'negative' },
      behavior: { trend: 'volatile' }
    };

    const exposure = applySpecterFtep({
      facts: baseFacts,
      intelligence
    });

    const serialized = JSON.stringify(exposure);

    expect(serialized).not.toMatch(/engagement|behavior|trend|exit|rate|percent/i);
  });

  it('handles missing facts safely', () => {
    const facts: SpecterFacts = {
      shopId: 1,
      period: { from: '2024-01-01', to: '2024-01-07' },
      sessionsObserved: null,
      exitIntentSessions: null,
      funnelsDetected: null,
      extractedAt: new Date().toISOString()
    };

    const intelligence: SpecterIntelligence = {
      engagement: { status: 'unknown' },
      behavior: { trend: 'unknown' }
    };

    const exposure = applySpecterFtep({ facts, intelligence });

    expect(exposure.context.sessionsObserved).toBeNull();
    expect(exposure.outcome).toBeNull();
    expect(exposure.signals.funnelsDetected).toBeNull();
    expect(exposure.dataCoverage.sessionsPresent).toBeNull();
  });
});