//tests/unit/backend/specter/specterFtep.service.test.ts
import { applySpecterFtep } from 'api-src/services/specter-ftep/specterFtep.service';
import { SpecterFacts } from 'api-src/services/specter-facts/specterFacts.types';
import { SpecterIntelligence } from 'api-src/services/specter-intelligence/specterIntelligence.service';
import { getSpecterFacts } from 'api-src/services/specter-facts/specterFacts.service';
import { createSessionStore } from 'modules-specter/store/session-store';

jest.mock('modules-specter/store/session-store');

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

    expect(serialized).not.toMatch(
      /engagement|behavior|exitIntentSessions|trend|rate|percent/i
    );
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

  describe('SpecterFacts — funnelsDetected (existence-only)', () => {
    const mockStore = {
      getAllSessionsForShop: jest.fn()
    };

    beforeEach(() => {
      (createSessionStore as jest.Mock).mockReturnValue(mockStore);
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    const baseInput = {
      shopId: 1,
      period: { from: '2025-01-01', to: '2025-01-31' }
    };

    it('returns null when no sessions exist', async () => {
      mockStore.getAllSessionsForShop.mockReturnValue([]);

      const facts = await getSpecterFacts(baseInput);

      expect(facts.funnelsDetected).toBeNull();
    });

    it('returns false when sessions exist but no funnel markers present', async () => {
      mockStore.getAllSessionsForShop.mockReturnValue([
        { createdAt: '2025-01-10T10:00:00Z' },
        { createdAt: '2025-01-12T12:00:00Z' }
      ]);

      const facts = await getSpecterFacts(baseInput);

      expect(facts.sessionsObserved).toBe(2);
      expect(facts.funnelsDetected).toBe(false);
    });

    it('returns true when at least one session has funnel marker', async () => {
      mockStore.getAllSessionsForShop.mockReturnValue([
        { createdAt: '2025-01-10T10:00:00Z' },
        { createdAt: '2025-01-12T12:00:00Z', funnelDetected: true }
      ]);

      const facts = await getSpecterFacts(baseInput);

      expect(facts.sessionsObserved).toBe(2);
      expect(facts.funnelsDetected).toBe(true);
    });
    it('exposes exitIntentDetected as FT2-safe boolean', () => {
      const facts: SpecterFacts = {
        shopId: 1,
        period: { from: '2024-01-01', to: '2024-01-07' },
        sessionsObserved: 10,
        exitIntentSessions: 3,
        funnelsDetected: false,
        extractedAt: new Date().toISOString()
      };

      const intelligence: SpecterIntelligence = {
        engagement: { status: 'positive' },
        behavior: { trend: 'stable' }
      };

      const exposure = applySpecterFtep({ facts, intelligence });

      expect(exposure.signals.exitIntentDetected).toBe(true);
    });

    it('returns null exitIntentDetected when fact is missing', () => {
      const facts: SpecterFacts = {
        shopId: 1,
        period: { from: '2024-01-01', to: '2024-01-07' },
        sessionsObserved: 10,
        exitIntentSessions: null,
        funnelsDetected: null,
        extractedAt: new Date().toISOString()
      };

      const intelligence: SpecterIntelligence = {
        engagement: { status: 'unknown' },
        behavior: { trend: 'unknown' }
      };

      const exposure = applySpecterFtep({ facts, intelligence });

      expect(exposure.signals.exitIntentDetected).toBeNull();
    });

  });
});