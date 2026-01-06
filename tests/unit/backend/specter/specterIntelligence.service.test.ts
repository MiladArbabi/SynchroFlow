//tests/unit/backend/specter/specterIntelligence.service.test.ts
import { deriveSpecterIntelligence } from 'api-src/services/specter-intelligence/specterIntelligence.service';
import { SpecterFacts } from 'api-src/services/specter-facts/specterFacts.types';

describe('SpecterIntelligence.service', () => {
  it('returns unknown when facts are missing', () => {
    const facts: SpecterFacts = {
      shopId: 1,
      period: { from: '2024-01-01', to: '2024-01-07' },
      sessionsObserved: null,
      exitIntentSessions: null,
      funnelsDetected: null,
      extractedAt: new Date().toISOString()
    };

    const intel = deriveSpecterIntelligence(facts);

    expect(intel.engagement.status).toBe('unknown');
    expect(intel.behavior.trend).toBe('unknown');
  });

  it('classifies engagement as positive when sessions exist and exit intent is low', () => {
    const facts: SpecterFacts = {
      shopId: 1,
      period: { from: '2024-01-01', to: '2024-01-07' },
      sessionsObserved: 10,
      exitIntentSessions: 1,
      funnelsDetected: true,
      extractedAt: new Date().toISOString()
    };

    const intel = deriveSpecterIntelligence(facts);

    expect(intel.engagement.status).toBe('positive');
  });

  it('classifies engagement as negative when exit intent dominates', () => {
    const facts: SpecterFacts = {
      shopId: 1,
      period: { from: '2024-01-01', to: '2024-01-07' },
      sessionsObserved: 10,
      exitIntentSessions: 8,
      funnelsDetected: false,
      extractedAt: new Date().toISOString()
    };

    const intel = deriveSpecterIntelligence(facts);

    expect(intel.engagement.status).toBe('negative');
  });

  it('does not expose raw metrics or percentages', () => {
    const facts: SpecterFacts = {
      shopId: 1,
      period: { from: '2024-01-01', to: '2024-01-07' },
      sessionsObserved: 5,
      exitIntentSessions: 2,
      funnelsDetected: false,
      extractedAt: new Date().toISOString()
    };

    const intel = deriveSpecterIntelligence(facts);
    const serialized = JSON.stringify(intel);

    expect(serialized).not.toMatch(/sessions|exit|percent|rate/i);
  });
});