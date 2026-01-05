/**
 * @jest-environment jsdom
 */

//tests/unit/ui/lifecycle/lifecycleEffects.ft1-skip-dwell.test.ts
import { renderHook, act } from '@testing-library/react';
import { useLifecycleEffects } from 'ui/src/lifecycle/lifecycleEffects';
import { LifecycleState } from 'ui/src/lifecycle/lifecycleTypes';

describe('lifecycleEffects — FT1 skips FT0 dwell', () => {
  jest.useFakeTimers();

  it('immediately skips FT0 dwell when FT1 is already latched', () => {
    const dispatch = jest.fn();

    const state: LifecycleState = {
      phase: 'FT0_PREPARING',
      bootResolved: true,
      integrationExists: true,
      hasSeenFT0: true,
      hasLatchedFT1: true,   // 🔑 critical
      hasLatchedFT2: false,
      ft0DwellCompleted: false,
    };

    renderHook(() =>
      useLifecycleEffects({
        state,
        dispatch,
        shopId: 1,
      })
    );

    // Should NOT wait for timeout
    expect(dispatch).toHaveBeenCalledWith({ type: 'FT0_DWELL_ELAPSED' });

    // Ensure timer was NOT scheduled
    act(() => {
      jest.runAllTimers();
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});