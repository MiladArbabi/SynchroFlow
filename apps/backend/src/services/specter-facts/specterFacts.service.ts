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
// apps/backend/src/services/specter-facts/specterFacts.service.ts

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
      multiStepSessionsPresent: null,
      surfaceBreadthPresent: null,
      returningSessionsPresent: null,
      exitWithoutInteractionPresent: null,
      averageSessionDepthPresent: null,
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
      multiStepSessionsPresent: null,
      surfaceBreadthPresent: null,
      returningSessionsPresent: null,
      exitWithoutInteractionPresent: null,
      averageSessionDepthPresent: null,
      extractedAt: new Date().toISOString()
    };
  }

  const sessionsObserved = sessionsInPeriod.length;
  const exitIntentSessions =
    sessionsInPeriod.filter(s => s.exitIntent).length;

  /**
   * funnelsDetected
   * ----------------
   * Existence-only structural fact.
   *
   * Rules:
   * - true  → at least one session exposes a funnel marker
   * - false → sessions exist, but no funnel markers present
   * - null  → no sessions (handled above)
   *
   * No inference. No aggregation. No intelligence.
   */
    const funnelsDetected = sessionsInPeriod.some(
    s => s.funnelDetected === true
  );

  /**
   * averageSessionDepthPresent
   * --------------------------
   * Existence-only depth signal (FT2-safe).
   *
   * Rules:
   * - null  → no sessions OR pageViewsCount unavailable
   * - true  → at least one session has pageViewsCount >= 3
   * - false → sessions exist, but all have pageViewsCount <= 2
   *
   * No averaging. No math. No inference.
   */
  const averageSessionDepthPresent = sessionsInPeriod.some(
    s => typeof s.pageViewsCount === 'number' && s.pageViewsCount >= 3
  );

  /**
   * multiStepSessionsPresent
   * ------------------------
   * Existence-only behavioral depth fact.
   *
   * Rules:
   * - true  → at least one session has pageViewsCount > 1
   * - false → sessions exist, but all are single-step
   * - null  → no sessions or no pageViewsCount data
   *
   * No inference. No aggregation. No percentages.
   */
  const multiStepSessionsPresent = sessionsInPeriod.some(
    s => typeof s.pageViewsCount === 'number' && s.pageViewsCount > 1
  );

  /**
   * surfaceBreadthPresent
   * ---------------------
   * Existence-only surface exploration fact.
   *
   * Rules:
   * - true  → at least one session has uniquePathsCount > 1
   * - false → sessions exist, but all are single-surface
   * - null  → no sessions or no uniquePathsCount data
   *
   * No inference. No aggregation.
   */
  const surfaceBreadthPresent = sessionsInPeriod.some(
    s => typeof s.uniquePathsCount === 'number' && s.uniquePathsCount > 1
  );

  /**
   * returningSessionsPresent
   * ------------------------
   * Existence-only returning behavior fact.
   *
   * Rules:
   * - true  → at least one returning session observed
   * - false → sessions exist, none are returning
   * - null  → no sessions or no returning flag data
   *
   * No identity. No correlation.
   */
  const returningSessionsPresent = sessionsInPeriod.some(
    s => s.isReturningSession === true
  );

  /**
   * exitWithoutInteractionPresent
   * -----------------------------
   * Existence-only compound fact.
   *
   * Rules:
   * - null  → no sessions OR pageViewsCount unavailable
   * - true  → at least one session exited with <= 1 page view
   * - false → sessions exist, none match condition
   */
  const exitWithoutInteractionPresent = sessionsInPeriod.some(
    s =>
      s.exitIntent === true &&
      typeof s.pageViewsCount === 'number' &&
      s.pageViewsCount <= 1
  );

  return {
    shopId,
    period,
    sessionsObserved,
    exitIntentSessions,
    funnelsDetected,
    multiStepSessionsPresent,
    surfaceBreadthPresent,
    returningSessionsPresent,
    exitWithoutInteractionPresent,
    averageSessionDepthPresent,
    extractedAt: new Date().toISOString()
  };
}