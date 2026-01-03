//tests/unit/ui/lifecycle/lifecycleReducer.ft1-promotion.test.ts

import { lifecycleReducer } from 'ui/src/lifecycle/lifecycleReducer';
import { initialLifecycleState, LifecycleState } from 'ui/src/lifecycle/lifecycleTypes';

describe('lifecycleReducer — FT1 promotion ordering', () => {
  it('promotes to FT1_READY even if backend FT1 arrives before FT0 dwell', () => {
    let state = initialLifecycleState;

    state = lifecycleReducer(state, { type: 'BOOT_RESOLVED' });
    state = lifecycleReducer(state, { type: 'INTEGRATION_CREATED' });
    state = lifecycleReducer(state, { type: 'SYNC_COMPLETED' });

    // Backend FT1 arrives EARLY
    state = lifecycleReducer(state, { type: 'FT1_BACKEND_COMPLETE' });

    // Still FT0_PREPARING
    expect(state.phase).toBe('FT0_PREPARING');

    // Dwell completes AFTER
    state = lifecycleReducer(state, { type: 'FT0_DWELL_ELAPSED' });

    // 🔴 MUST NOW PROMOTE
    expect(state.phase).toBe('FT1_READY');
  });

  it('promotes to FT1_READY when dwell completes and backend FT1 was already true', () => {
    let state: LifecycleState = {
        ...initialLifecycleState,
        bootResolved: true,
        integrationExists: true,
        phase: 'FT0_PREPARING',
        ft0DwellCompleted: false,
        };

    // Backend readiness restored from query / seal
    state = lifecycleReducer(state, { type: 'FT1_BACKEND_COMPLETE' });

    // Still waiting on dwell
    expect(state.phase).toBe('FT0_PREPARING');

    // Dwell completes later
    state = lifecycleReducer(state, { type: 'FT0_DWELL_ELAPSED' });

    expect(state.phase).toBe('FT1_READY');
    });

});