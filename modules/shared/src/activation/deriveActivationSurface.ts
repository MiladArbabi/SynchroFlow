// modules/shared/src/activation/deriveActivationSurface.ts

export type GlobalPhase = 'FT-1' | 'FT0-A' | 'FT0-B' | 'FT1' | 'FT2';
export type GlobalState = 'blind' | 'syncing' | 'limited' | 'active' | 'paywalled';

export type ModuleState =
  | 'locked'
  | 'syncing'
  | 'limited'
  | 'active'
  | 'paywalled';

export interface LifecycleContext {
  lifecyclePhase: 'FT-1' | 'FT0' | 'FT1' | 'FT2';
  readinessSnapshot: any | null;
  userState: {
    user: {
      shopify_connected: boolean;
      first_insight_delivered: boolean;
    };
  };
}

export interface ActivationSession {
  hasShownFT0Modal: boolean;
}

export interface ActivationSurface {
  global: {
    phase: GlobalPhase;
    state: GlobalState;
    reason?: string;
  };

  modules: Record<
    string,
    {
      state: ModuleState;
      limits?: {
        orders?: number;
      };
      cta?: {
        type: 'connect' | 'wait' | 'upgrade';
        action: string;
      };
    }
  >;

  ux: {
    showFT0Modal: boolean;
  };
}

/**
 * Canonical activation surface derivation.
 * This is the ONLY place allowed to translate lifecycle → UX state.
 */
export function deriveActivationSurface(
  ctx: LifecycleContext,
  session: ActivationSession,
  moduleIds: string[]
): ActivationSurface {
  const connected = ctx.userState.user.shopify_connected;
  const firstInsightDelivered = ctx.userState.user.first_insight_delivered;

  // ⚠️ placeholder until monetization signals are wired
  const quotaExceeded = false;

  // ─────────────────────────────────────────────
  // FT-1 — Blind (no platform connected)
  // ─────────────────────────────────────────────
  if (!connected) {
    return {
      global: {
        phase: 'FT-1',
        state: 'blind',
        reason: 'No platform connected',
      },
      modules: buildModules(moduleIds, () => ({
        state: 'locked',
        cta: {
          type: 'connect',
          action: 'connect-store',
        },
      })),
      ux: {
        showFT0Modal: false,
      },
    };
  }

  // ─────────────────────────────────────────────
  // FT0-A — Initial sync modal (UX latch)
  // ─────────────────────────────────────────────
  if (connected && !session.hasShownFT0Modal) {
    return {
      global: {
        phase: 'FT0-A',
        state: 'syncing',
        reason: 'Initial platform connection',
      },
      modules: buildModules(moduleIds, () => ({
        state: 'syncing',
        cta: {
          type: 'wait',
          action: 'sync-in-progress',
        },
      })),
      ux: {
        showFT0Modal: true,
      },
    };
  }

  // ─────────────────────────────────────────────
  // FT0-B — Crunching (sync continues)
  // ─────────────────────────────────────────────
  if (connected && !firstInsightDelivered) {
    return {
      global: {
        phase: 'FT0-B',
        state: 'syncing',
        reason: 'Data ingestion in progress',
      },
      modules: buildModules(moduleIds, () => ({
        state: 'syncing',
      })),
      ux: {
        showFT0Modal: false,
      },
    };
  }

  // ─────────────────────────────────────────────
  // FT1 — Limited value
  // ─────────────────────────────────────────────
  if (firstInsightDelivered && !quotaExceeded) {
    return {
      global: {
        phase: 'FT1',
        state: 'limited',
        reason: 'First insight delivered',
      },
      modules: buildModules(moduleIds, (moduleId) => {
        if (moduleId === 'order-nexus') {
          return {
            state: 'limited',
            limits: { orders: 50 },
            cta: {
              type: 'upgrade',
              action: 'upgrade-to-ft2',
            },
          };
        }

        return {
          state: 'limited',
          cta: {
            type: 'upgrade',
            action: 'upgrade-to-ft2',
          },
        };
      }),
      ux: {
        showFT0Modal: false,
      },
    };
  }

  // ─────────────────────────────────────────────
  // FT2 — Paywalled
  // ─────────────────────────────────────────────
  return {
    global: {
      phase: 'FT2',
      state: 'paywalled',
      reason: 'Free tier quota exceeded',
    },
    modules: buildModules(moduleIds, () => ({
      state: 'paywalled',
      cta: {
        type: 'upgrade',
        action: 'upgrade-to-ft2',
      },
    })),
    ux: {
      showFT0Modal: false,
    },
  };
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function buildModules(
  moduleIds: string[],
  derive: (moduleId: string) => {
    state: ModuleState;
    limits?: { orders?: number };
    cta?: { type: 'connect' | 'wait' | 'upgrade'; action: string };
  }
): Record<string, any> {
  return moduleIds.reduce((acc, id) => {
    acc[id] = derive(id);
    return acc;
  }, {} as Record<string, any>);
}
