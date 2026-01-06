//apps/backend/src/services/specter-facts/specterFacts.service.ts
import { GetSpecterFactsInput, SpecterFacts } from './specterFacts.types';
import { sessionStore } from 'modules-specter/store/session-store';
import { createSessionStore } from 'modules-specter/store/session-store';

/**
 * Specter Facts
 * -------------
 * Raw, interpretation-free extraction of session facts.
 *
 * HARD RULES:
 * - No intelligence
 * - No percentages
 * - No trends
 * - Preserve nulls
 */
export async function getSpecterFacts(
  input: GetSpecterFactsInput
): Promise<SpecterFacts> {
  const { shopId, period } = input;
  const sessionStore = createSessionStore();

  const sessions = sessionStore.getAllSessionsForShop(shopId);

  if (!sessions || sessions.length === 0) {
    return {
      shopId,
      period,
      sessionsObserved: null,
      exitIntentSessions: null,
      funnelsDetected: null,
      extractedAt: new Date().toISOString()
    };
  }

  const sessionsObserved = sessions.length;
  const exitIntentSessions = sessions.filter(s => s.exitIntent).length;

  // Funnel detection = raw boolean presence only (no explanation)
  const pageCounts: Record<string, number> = {};
  sessions.forEach(s => {
    (s.pagesViewed || []).forEach(p => {
      pageCounts[p] = (pageCounts[p] || 0) + 1;
    });
  });

  const funnelsDetected = Object.values(pageCounts).some(c => c >= 2);

  return {
    shopId,
    period,
    sessionsObserved,
    exitIntentSessions,
    funnelsDetected,
    extractedAt: new Date().toISOString()
  };
}