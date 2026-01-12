import { deriveInitialLifecycleState } from 'ui/src/lifecycle/deriveInitialLifecycleState';

/* -------------------------------------------------------------------------- */
/* LocalStorage Mock                                                          */
/* -------------------------------------------------------------------------- */

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
});

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe('deriveInitialLifecycleState — hydration invariants', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  /* ---------------------------------------------------------------------- */
  /* FT2 — terminal hydration                                                */
  /* ---------------------------------------------------------------------- */

  test('hydrates directly to FT2_READY when FT2 seal exists', () => {
    const shopId = 42;

    localStorage.setItem(`shop:${shopId}:ft2-seen`, 'true');

    const state = deriveInitialLifecycleState(shopId);

    expect(state.phase).toBe('FT2_READY');
    expect(state.hasLatchedFT2).toBe(true);
    expect(state.hasLatchedFT1).toBe(true);
    expect(state.hasSeenFT0).toBe(true);
    expect(state.ft0DwellCompleted).toBe(true);
  });

  test('FT2 seal dominates FT1 seal during hydration', () => {
    const shopId = 42;

    localStorage.setItem(`shop:${shopId}:ft1-seen`, 'true');
    localStorage.setItem(`shop:${shopId}:ft2-seen`, 'true');

    const state = deriveInitialLifecycleState(shopId);

    expect(state.phase).toBe('FT2_READY');
    expect(state.hasLatchedFT2).toBe(true);
    expect(state.hasLatchedFT1).toBe(true);
  });

  /* ---------------------------------------------------------------------- */
  /* FT1 — sealed hydration                                                   */
  /* ---------------------------------------------------------------------- */

  test('hydrates directly to FT1_READY when FT1 seal exists', () => {
    const shopId = 42;

    localStorage.setItem(`shop:${shopId}:ft1-seen`, 'true');

    const state = deriveInitialLifecycleState(shopId);

    expect(state.phase).toBe('FT1_READY');
    expect(state.hasLatchedFT1).toBe(true);
    expect(state.hasLatchedFT2).toBe(false);
    expect(state.hasSeenFT0).toBe(true);
    expect(state.ft0DwellCompleted).toBe(true);
  });

  /* ---------------------------------------------------------------------- */
  /* No seals — FT_MINUS_ONE allowed                                          */
  /* ---------------------------------------------------------------------- */

  test('hydrates to FT_MINUS_ONE when no FT1 or FT2 seal exists', () => {
    const state = deriveInitialLifecycleState(42);

    expect(state.phase).toBe('FT_MINUS_ONE');
    expect(state.hasLatchedFT1).toBe(false);
    expect(state.hasLatchedFT2).toBe(false);
  });

  /* ---------------------------------------------------------------------- */
  /* Guardrail — shopId absence                                               */
  /* ---------------------------------------------------------------------- */

  test('returns initial lifecycle state when shopId is null', () => {
    const state = deriveInitialLifecycleState(null);

    expect(state.phase).toBe('FT_MINUS_ONE');
    expect(state.hasLatchedFT1).toBe(false);
    expect(state.hasLatchedFT2).toBe(false);
  });
});