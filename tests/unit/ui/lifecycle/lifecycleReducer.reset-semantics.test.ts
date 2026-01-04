//tests/unit/ui/lifecycle/lifecycleReducer.reset-semantics.test.ts

import { lifecycleReducer } from 'ui/src/lifecycle/lifecycleReducer';
import {
  initialLifecycleState,
  LifecycleState,
} from 'ui/src/lifecycle/lifecycleTypes';

describe('lifecycleReducer — reset semantics (contract-defining)', () => {
  /* -------------------------------------------------- */
  /* FT1 reset behavior                                 */
  /* -------------------------------------------------- */

  test('BOOT_UNRESOLVED does NOT regress lifecycle once FT1 is latched', () => {
    let state: LifecycleState = initialLifecycleState;

    state = lifecycleReducer(state, { type: 'BOOT_RESOLVED' });
    state = lifecycleReducer(state, { type: 'INTEGRATION_CREATED' });
    state = lifecycleReducer(state, { type: 'SYNC_COMPLETED' });
    state = lifecycleReducer(state, { type: 'FT0_DWELL_ELAPSED' });
    state = lifecycleReducer(state, { type: 'FT1_BACKEND_COMPLETE' });

    expect(state.phase).toBe('FT1_READY');
    expect(state.hasLatchedFT1).toBe(true);

    // 🔴 Reset event AFTER FT1
    state = lifecycleReducer(state, { type: 'BOOT_UNRESOLVED' });

    // Contract: FT1 is monotonic once reached
    expect(state.phase).toBe('FT1_READY');
    expect(state.hasLatchedFT1).toBe(true);
  });

  /* -------------------------------------------------- */
  /* FT2 reset behavior                                 */
  /* -------------------------------------------------- */

  test('BOOT_UNRESOLVED does NOT regress lifecycle once FT2 is latched', () => {
    let state: LifecycleState = {
      ...initialLifecycleState,
      bootResolved: true,
      integrationExists: true,
    };

    state = lifecycleReducer(state, { type: 'FT2_BACKEND_COMPLETE' });

    expect(state.phase).toBe('FT2_READY');
    expect(state.hasLatchedFT2).toBe(true);

    // 🔴 Reset event AFTER FT2
    state = lifecycleReducer(state, { type: 'BOOT_UNRESOLVED' });

    // Contract: FT2 is terminal and reset-proof
    expect(state.phase).toBe('FT2_READY');
    expect(state.hasLatchedFT2).toBe(true);
  });

  test('INTEGRATION_DELETED does NOT regress lifecycle once FT2 is latched', () => {
    let state: LifecycleState = {
      ...initialLifecycleState,
      bootResolved: true,
      integrationExists: true,
    };

    state = lifecycleReducer(state, { type: 'FT2_BACKEND_COMPLETE' });

    expect(state.phase).toBe('FT2_READY');
    expect(state.hasLatchedFT2).toBe(true);

    // 🔴 Integration removed AFTER FT2
    state = lifecycleReducer(state, { type: 'INTEGRATION_DELETED' });

    // Contract: FT2 terminality overrides integration deletion
    expect(state.phase).toBe('FT2_READY');
    expect(state.hasLatchedFT2).toBe(true);
  });
});