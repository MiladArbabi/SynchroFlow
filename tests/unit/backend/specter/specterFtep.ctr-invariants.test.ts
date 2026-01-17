import { applySpecterFtep } from 'api-src/services/specter-ftep/specterFtep.service';
import { SpecterFacts } from 'api-src/services/specter-facts/specterFacts.types';
import { SpecterIntelligence } from 'api-src/services/specter-intelligence/specterIntelligence.service';

describe('Specter FTEP — CTR exposure invariants', () => {
  const baseFacts: SpecterFacts = {
    shopId: 1,
    period: { from: '2024-01-01', to: '2024-01-31' },
    sessionsObserved: null,
    exitIntentSessions: null,
    funnelsDetected: null,
    extractedAt: 'now',
  };

  test('CTR-0: sessionsObserved null → no outcome exposed', () => {
    const intelligence: SpecterIntelligence = {
      engagement: { status: 'positive' },
      behavior: { trend: 'unknown' },
    };

    const result = applySpecterFtep({
      facts: baseFacts,
      intelligence,
    });

    expect(result.context.sessionsObserved).toBeNull();
    expect(result.outcome).toBeNull();
    expect(result.dataCoverage.sessionsPresent).toBeNull();
  });

  test('CTR-1: sessionsObserved present but engagement unknown → outcome null', () => {
    const facts: SpecterFacts = {
      ...baseFacts,
      sessionsObserved: 12,
    };

    const intelligence: SpecterIntelligence = {
      engagement: { status: 'unknown' },
      behavior: { trend: 'unknown' },
    };

    const result = applySpecterFtep({
      facts,
      intelligence,
    });

    expect(result.context.sessionsObserved).toBe(12);
    expect(result.outcome).toBeNull();
    expect(result.dataCoverage.sessionsPresent).toBe(true);
  });

  test('CTR-1: sessionsObserved present and engagement known → outcome exposed', () => {
    const facts: SpecterFacts = {
      ...baseFacts,
      sessionsObserved: 20,
      funnelsDetected: true,
    };

    const intelligence: SpecterIntelligence = {
      engagement: { status: 'negative' },
      behavior: { trend: 'volatile' },
    };

    const result = applySpecterFtep({
      facts,
      intelligence,
    });

    expect(result.context.sessionsObserved).toBe(20);
    expect(result.outcome).toEqual({ status: 'negative' });
    expect(result.signals.funnelsDetected).toBe(true);
    expect(result.dataCoverage.sessionsPresent).toBe(true);
  });
});