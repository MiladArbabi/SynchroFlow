// tests/unit/ui/lifecycle/lifecycleReducer.ft2-restore.test.ts

import { lifecycleReducer } from 'ui/src/lifecycle/lifecycleReducer';
import { initialLifecycleState } from 'ui/src/lifecycle/lifecycleTypes';

describe('lifecycleReducer — FT2 restore semantics', () => {
  it('promotes directly to FT2_READY when backend FT2 is already completed', () => {
    let state = initialLifecycleState;

    state = lifecycleReducer(state, { type: 'BOOT_RESOLVED' });
    state = lifecycleReducer(state, { type: 'INTEGRATION_CREATED' });

    // 🔴 Backend lifecycle resolver says FT2 is already complete
    state = lifecycleReducer(state, { type: 'FT2_BACKEND_COMPLETE' });

    // MUST skip FT0 + FT1 entirely
    expect(state.phase).toBe('FT2_READY');
  });
});
