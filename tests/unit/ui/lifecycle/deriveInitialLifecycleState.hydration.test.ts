import { deriveInitialLifecycleState } from 'ui/src/lifecycle/deriveInitialLifecycleState';

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

describe('deriveInitialLifecycleState — hydration invariants', () => {
  beforeEach(() => {
    localStorage.clear();
    });

  test('FT1 sealed + integration exists → FT1_READY (no FT0 flash)', () => {
    const shopId = 42;

    localStorage.setItem(`shop:${shopId}:ft1-seen`, 'true');

    const state = deriveInitialLifecycleState(shopId, {
      bootResolved: true,
      integrationExists: true,
    });

    expect(state.phase).toBe('FT1_READY');
    expect(state.hasLatchedFT1).toBe(true);
    expect(state.hasSeenFT0).toBe(true);
    expect(state.ft0DwellCompleted).toBe(true);
  });

  test('FT1 sealed but no integration → FT_MINUS_ONE', () => {
    const shopId = 42;

    localStorage.setItem(`shop:${shopId}:ft1-seen`, 'true');

    const state = deriveInitialLifecycleState(shopId, {
      bootResolved: true,
      integrationExists: false,
    });

    expect(state.phase).toBe('FT_MINUS_ONE');
    expect(state.hasLatchedFT1).toBe(false);
  });

  test('FT2 seal dominates FT1', () => {
    const shopId = 42;

    localStorage.setItem(`shop:${shopId}:ft1-seen`, 'true');
    localStorage.setItem(`shop:${shopId}:ft2-seen`, 'true');

    const state = deriveInitialLifecycleState(shopId, {
      bootResolved: true,
      integrationExists: true,
    });

    expect(state.phase).toBe('FT2_READY');
    expect(state.hasLatchedFT2).toBe(true);
  });

  test('no seals → initial lifecycle state', () => {
    const state = deriveInitialLifecycleState(42, {
      bootResolved: true,
      integrationExists: true,
    });

    expect(state.phase).toBe('FT_MINUS_ONE');
    expect(state.hasLatchedFT1).toBe(false);
    expect(state.hasLatchedFT2).toBe(false);
  });
});
