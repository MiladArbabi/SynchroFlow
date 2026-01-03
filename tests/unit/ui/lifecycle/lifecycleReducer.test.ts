//tests/unit/ui/lifecycle/lifecycleReducer.test.ts

import { lifecycleReducer } from 'ui/src/lifecycle/lifecycleReducer';
import {
  initialLifecycleState,
  LifecycleEvent,
  LifecycleState,
} from 'ui/src/lifecycle/lifecycleTypes';

describe('lifecycleReducer (visual lifecycle invariants)', () => {
  function reduce(
    events: LifecycleEvent[],
    initial: LifecycleState = initialLifecycleState
  ): LifecycleState {
    return events.reduce(lifecycleReducer, initial);
  }

  test('bootResolved gates all meaning', () => {
    const state = reduce([
      { type: 'INTEGRATION_CREATED' },
      { type: 'SYNC_COMPLETED' },
    ]);

    expect(state.phase).toBe('FT_MINUS_ONE');
  });

  test('integration deletion is a hard reset', () => {
    const state = reduce([
      { type: 'BOOT_RESOLVED' },
      { type: 'INTEGRATION_CREATED' },
      { type: 'SYNC_COMPLETED' },
      { type: 'FT0_DWELL_ELAPSED' },
      { type: 'FT1_BACKEND_COMPLETE' },
      { type: 'INTEGRATION_DELETED' },
    ]);

    expect(state.phase).toBe('FT_MINUS_ONE');
    expect(state.hasLatchedFT1).toBe(false);
    expect(state.hasSeenFT0).toBe(false);
  });

  test('FT0 is always shown at least once', () => {
    const state = reduce([
      { type: 'BOOT_RESOLVED' },
      { type: 'INTEGRATION_CREATED' },
      { type: 'SYNC_COMPLETED' },
    ]);

    expect(state.phase).toBe('FT0_PREPARING');
    expect(state.hasSeenFT0).toBe(true);
  });

  test('FT0 dwell is enforced exactly once', () => {
    const state = reduce([
      { type: 'BOOT_RESOLVED' },
      { type: 'INTEGRATION_CREATED' },
      { type: 'SYNC_COMPLETED' },
      { type: 'FT0_DWELL_ELAPSED' },
      { type: 'FT0_DWELL_ELAPSED' }, // second fire must be ignored
    ]);

    expect(state.phase).toBe('FT0_PREPARING');
  });

  test('FT1 is absorbing while integration exists', () => {
    const state = reduce([
      { type: 'BOOT_RESOLVED' },
      { type: 'INTEGRATION_CREATED' },
      { type: 'SYNC_COMPLETED' },
      { type: 'FT0_DWELL_ELAPSED' },
      { type: 'FT1_BACKEND_COMPLETE' },
      { type: 'SYNC_STARTED' }, // should NOT regress
    ]);

    expect(state.phase).toBe('FT1_READY');
  });

  test('FT1 cannot resurrect after integration deletion', () => {
    const state = reduce([
      { type: 'BOOT_RESOLVED' },
      { type: 'INTEGRATION_CREATED' },
      { type: 'SYNC_COMPLETED' },
      { type: 'FT0_DWELL_ELAPSED' },
      { type: 'FT1_BACKEND_COMPLETE' },
      { type: 'INTEGRATION_DELETED' },
      { type: 'INTEGRATION_CREATED' },
      { type: 'SYNC_COMPLETED' },
    ]);

    expect(state.phase).toBe('FT0_PREPARING');
    expect(state.hasLatchedFT1).toBe(false);
  });

  test('no regression from COMPLETED back to SYNCING', () => {
    const state = reduce([
      { type: 'BOOT_RESOLVED' },
      { type: 'INTEGRATION_CREATED' },
      { type: 'SYNC_COMPLETED' },
      { type: 'SYNC_STARTED' },
    ]);

    expect(state.phase).toBe('FT0_PREPARING');
  });
});