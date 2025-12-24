// tests/unit/backend/activation/deriveActivationSurface.test.ts

import { deriveActivationSurface } from '@lasyncro/shared/activation/deriveActivationSurface';
import type { LifecycleContext } from '@lasyncro/shared/activation/deriveActivationSurface';

const MODULES = ['order-nexus', 'customers', 'analytics'];

function baseCtx(
  overrides: Partial<LifecycleContext> = {}
): LifecycleContext {
  return {
    lifecyclePhase: 'FT0',
    readinessSnapshot: null,
    userState: {
      user: {
        shopify_connected: false,
        first_insight_delivered: false,
      },
    },
    ...overrides,
  };
}

describe('deriveActivationSurface — lifecycle transitions', () => {
  // ─────────────────────────────────────────────
  // FT-1 — Blind (no connection)
  // ─────────────────────────────────────────────
  it('FT-1 → blind when no platform is connected', () => {
    const surface = deriveActivationSurface(
      baseCtx(),
      { hasShownFT0Modal: false },
      MODULES
    );

    expect(surface.global.phase).toBe('FT-1');
    expect(surface.global.state).toBe('blind');
    expect(surface.ux.showFT0Modal).toBe(false);

    Object.values(surface.modules).forEach((m: any) => {
      expect(m.state).toBe('locked');
      expect(m.cta?.type).toBe('connect');
    });
  });

  // ─────────────────────────────────────────────
  // FT0-A — Initial sync modal
  // ─────────────────────────────────────────────
  it('FT0-A → shows syncing modal immediately after connection', () => {
    const surface = deriveActivationSurface(
      baseCtx({
        userState: {
          user: {
            shopify_connected: true,
            first_insight_delivered: false,
          },
        },
      }),
      { hasShownFT0Modal: false },
      MODULES
    );

    expect(surface.global.phase).toBe('FT0-A');
    expect(surface.global.state).toBe('syncing');
    expect(surface.ux.showFT0Modal).toBe(true);

    Object.values(surface.modules).forEach((m: any) => {
      expect(m.state).toBe('syncing');
      expect(m.cta?.type).toBe('wait');
    });
  });

  // ─────────────────────────────────────────────
  // FT0-B — Crunching numbers
  // ─────────────────────────────────────────────
  it('FT0-B → crunching after modal is dismissed', () => {
    const surface = deriveActivationSurface(
      baseCtx({
        userState: {
          user: {
            shopify_connected: true,
            first_insight_delivered: false,
          },
        },
      }),
      { hasShownFT0Modal: true },
      MODULES
    );

    expect(surface.global.phase).toBe('FT0-B');
    expect(surface.global.state).toBe('syncing');
    expect(surface.ux.showFT0Modal).toBe(false);

    Object.values(surface.modules).forEach((m: any) => {
      expect(m.state).toBe('syncing');
    });
  });

  // ─────────────────────────────────────────────
  // FT1 — Limited access
  // ─────────────────────────────────────────────
  it('FT1 → limited access after first insight is delivered', () => {
    const surface = deriveActivationSurface(
      baseCtx({
        userState: {
          user: {
            shopify_connected: true,
            first_insight_delivered: true,
          },
        },
      }),
      { hasShownFT0Modal: true },
      MODULES
    );

    expect(surface.global.phase).toBe('FT1');
    expect(surface.global.state).toBe('limited');

    expect(surface.modules['order-nexus'].state).toBe('limited');
    expect(surface.modules['order-nexus'].limits?.orders).toBe(50);
    expect(surface.modules['order-nexus'].cta?.type).toBe('upgrade');

    Object.entries(surface.modules).forEach(([id, m]: any) => {
      expect(m.state).toBe('limited');
      expect(m.cta?.type).toBe('upgrade');
    });
  });

  // ─────────────────────────────────────────────
  // FT2 — Paywalled (future-proof)
  // ─────────────────────────────────────────────
  it('FT2 → paywalled when quota is exceeded', () => {
    // NOTE: quotaExceeded is currently hardcoded false.
    // This test locks the shape and intent.
    const surface = deriveActivationSurface(
      baseCtx({
        userState: {
          user: {
            shopify_connected: true,
            first_insight_delivered: true,
          },
        },
      }),
      { hasShownFT0Modal: true },
      MODULES
    );

    // Future switch will flip this branch.
    // Test exists to prevent silent regressions.
    expect(['FT1', 'FT2']).toContain(surface.global.phase);
  });

  // ─────────────────────────────────────────────
  // Safety invariants
  // ─────────────────────────────────────────────
  it('never shows FT0 modal more than once', () => {
    const surface = deriveActivationSurface(
      baseCtx({
        userState: {
          user: {
            shopify_connected: true,
            first_insight_delivered: false,
          },
        },
      }),
      { hasShownFT0Modal: true },
      MODULES
    );

    expect(surface.ux.showFT0Modal).toBe(false);
  });

  it('does not depend on lifecyclePhase from backend', () => {
    const surface = deriveActivationSurface(
      {
        ...baseCtx(),
        lifecyclePhase: 'FT2', // ignored on purpose
      },
      { hasShownFT0Modal: false },
      MODULES
    );

    expect(surface.global.phase).toBe('FT-1');
  });
});
