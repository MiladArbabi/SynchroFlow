/**
 * @jest-environment jsdom
*/
import { renderHook } from '@testing-library/react';
import { useLifecycleEffects } from 'ui/src/lifecycle/lifecycleEffects';
import { initialLifecycleState } from 'ui/src/lifecycle/lifecycleTypes';

beforeEach(() => {
  Object.defineProperty(global, 'localStorage', {
    value: {
      setItem: jest.fn(),
      getItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn(),
    },
    writable: true,
  });
});

describe('useLifecycleEffects — FT2 persistence', () => {
  it('persists FT2 seal in localStorage', () => {
    const setItemSpy = jest.spyOn(global.localStorage, 'setItem');

    renderHook(() =>
      useLifecycleEffects({
        state: {
          ...initialLifecycleState,
          phase: 'FT2_READY',
          hasLatchedFT2: true,
          bootResolved: true,
          integrationExists: true,
        },
        dispatch: jest.fn(),
        shopId: 1,
      })
    );

    expect(setItemSpy).toHaveBeenCalledWith(
      'shop:1:ft2-seen',
      'true'
    );
  });
});