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

  it('sets direction to unknown when sessions are missing', () => {
    const facts: SpecterFacts = {
      shopId: 1,
      period: { from: '2024-01-01', to: '2024-01-07' },
      sessionsObserved: null,
      exitIntentSessions: null,
      funnelsDetected: null,
      extractedAt: new Date().toISOString()
    };

    const intel = deriveSpecterIntelligence(facts);

    expect(intel.behavior.direction).toBe('unknown');
  });

  it('sets direction to flat when sessions exist', () => {
    const facts: SpecterFacts = {
      shopId: 1,
      period: { from: '2024-01-01', to: '2024-01-07' },
      sessionsObserved: 12,
      exitIntentSessions: 3,
      funnelsDetected: false,
      extractedAt: new Date().toISOString()
    };

    const intel = deriveSpecterIntelligence(facts);

    expect(intel.behavior.direction).toBe('flat');
  });

  it('does not expose direction semantics in serialized intelligence', () => {
    const facts: SpecterFacts = {
      shopId: 1,
      period: { from: '2024-01-01', to: '2024-01-07' },
      sessionsObserved: 5,
      exitIntentSessions: 1,
      funnelsDetected: true,
      extractedAt: new Date().toISOString()
    };

    const intel = deriveSpecterIntelligence(facts);
    const serialized = JSON.stringify(intel);

    expect(serialized).not.toMatch(/increase|decrease|growth|drop|change/i);
  });

});