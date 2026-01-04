// tests/unit/ui/lifecycle/lifecycleReducer.ft2-seal.test.ts

import { lifecycleReducer } from 'ui/src/lifecycle/lifecycleReducer';
import { initialLifecycleState } from 'ui/src/lifecycle/lifecycleTypes';

describe('lifecycleReducer — FT2 seal persistence', () => {
  it('latches FT2_READY when backend FT2 arrives and prevents regression', () => {
    let state = initialLifecycleState;

    // App boot
    state = lifecycleReducer(state, { type: 'BOOT_RESOLVED' });
    state = lifecycleReducer(state, { type: 'INTEGRATION_CREATED' });

    // Backend reports FT2 already completed
    state = lifecycleReducer(state, { type: 'FT2_BACKEND_COMPLETE' });

    // 🔴 MUST promote directly to FT2_READY
    expect(state.phase).toBe('FT2_READY');

    // Later lifecycle noise must NOT regress
    state = lifecycleReducer(state, { type: 'SYNC_STARTED' });
    state = lifecycleReducer(state, { type: 'SYNC_COMPLETED' });
    state = lifecycleReducer(state, { type: 'FT0_DWELL_ELAPSED' });

    // 🔴 MUST remain FT2_READY
    expect(state.phase).toBe('FT2_READY');
  });
});