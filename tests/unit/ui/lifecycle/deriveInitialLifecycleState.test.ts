//tests/unit/ui/lifecycle/deriveInitialLifecycleState.test.ts

import { deriveInitialLifecycleState } from 'ui/src/lifecycle/deriveInitialLifecycleState';

describe('deriveInitialLifecycleState', () => {
  beforeEach(() => {
  const store: Record<string, string> = {};

    // @ts-ignore
    global.localStorage = {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
        store[key] = value;
        },
        removeItem: (key: string) => {
        delete store[key];
        },
        clear: () => {
        Object.keys(store).forEach((k) => delete store[k]);
        },
    };
  });


  test('FT1 sealed + integration exists → FT1_READY', () => {
    localStorage.setItem('shop:1:ft1-seen', 'true');

    const state = deriveInitialLifecycleState(1, {
      integrationExists: true,
      bootResolved: true,
    });

    expect(state.phase).toBe('FT1_READY');
  });

  test('FT1 sealed but no integration → FT_MINUS_ONE', () => {
    localStorage.setItem('shop:1:ft1-seen', 'true');

    const state = deriveInitialLifecycleState(1, {
      integrationExists: false,
      bootResolved: true,
    });

    expect(state.phase).toBe('FT_MINUS_ONE');
  });

  test('FT2 sealed dominates FT1', () => {
    localStorage.setItem('shop:1:ft1-seen', 'true');
    localStorage.setItem('shop:1:ft2-seen', 'true');

    const state = deriveInitialLifecycleState(1, {
      integrationExists: true,
      bootResolved: true,
    });

    expect(state.phase).toBe('FT2_READY');
  });

  test('no seals → initial state', () => {
    const state = deriveInitialLifecycleState(1, {
      integrationExists: false,
      bootResolved: false,
    });

    expect(state.phase).toBe('FT_MINUS_ONE');
  });
});