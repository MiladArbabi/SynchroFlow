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

  const allSessions = sessionStore.getAllSessionsForShop(shopId);

  if (!allSessions || allSessions.length === 0) {
    return {
      shopId,
      period,
      sessionsObserved: null,
      exitIntentSessions: null,
      funnelsDetected: null,
      extractedAt: new Date().toISOString()
    };
  }

  const fromTs = Date.parse(period.from);
  const toTs = Date.parse(period.to);

  const sessionsInPeriod = allSessions.filter((s: any) => {
    if (!s.createdAt) return false;
    const createdTs = Date.parse(s.createdAt);
    return createdTs >= fromTs && createdTs <= toTs;
  });

  if (sessionsInPeriod.length === 0) {
    return {
      shopId,
      period,
      sessionsObserved: null,
      exitIntentSessions: null,
      funnelsDetected: null,
      extractedAt: new Date().toISOString()
    };
  }

  const sessionsObserved = sessionsInPeriod.length;
  const exitIntentSessions = sessionsInPeriod.filter(s => s.exitIntent).length;

  return {
    shopId,
    period,
    sessionsObserved,
    exitIntentSessions,
    funnelsDetected: null,
    extractedAt: new Date().toISOString()
  };
}