//apps/backend/src/onboarding/providers/specter.provider.ts
import {
  ReadinessSignal,
} from '@lasyncro/shared';

import type { OnboardingSignalProvider } from '../readiness.providers';
import { SPECTER_STORE_CANDIDATES } from '../readiness.providers';

// --- Specter provider: FT1 readiness ONLY ---
export const specterOnboardingSignalProvider: OnboardingSignalProvider = {
  moduleId: 'specter',

  async getSignals({ shopId }: { shopId: number }): Promise<ReadinessSignal[]> {
    let getSessionsLastNDays:
      | ((shopId: number, days?: number) => Promise<any[]>)
      | undefined;

    // Attempt to resolve Specter session store (structural check only)
    const tryAssign = (mod: any) => {
      if (!mod) return;
      getSessionsLastNDays =
        getSessionsLastNDays ??
        mod.getSessionsLastNDays ??
        mod.default?.getSessionsLastNDays;
    };

    // Try known candidates (same pattern, but minimal usage)
    for (const candidate of SPECTER_STORE_CANDIDATES) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(candidate);
        tryAssign(mod);
        if (getSessionsLastNDays) break;
      } catch {
        /* ignore */
      }
    }

    const sessionsKnown = typeof getSessionsLastNDays === 'function';

    let sessionCount: number | null = null;

    if (typeof getSessionsLastNDays === 'function') {
    const fetchSessions = getSessionsLastNDays;

    try {
        const sessions = await fetchSessions(shopId, 7);
        sessionCount = Array.isArray(sessions) ? sessions.length : 0;
    } catch {
        sessionCount = 0;
    }
    }

    return [
      {
        name: 'specter.sessionsKnown',
        value: sessionsKnown,
      },
      {
        name: 'specter.sessionCount',
        value: sessionCount,
      },
      {
        name: 'specter.signalConfidence',
        value: null, // FT1: explicitly unknown
      },
    ];
  },
};
