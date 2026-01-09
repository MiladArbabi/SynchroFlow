// tests/unit/ui/lifecycle/reducer/lifecycleReducer.authority.test.ts
import { lifecycleReducer } from 'ui/src/lifecycle/lifecycleReducer';
import { initialLifecycleState } from 'ui/src/lifecycle/lifecycleTypes';
import type { LifecycleState } from 'ui/src/lifecycle/lifecycleTypes';

describe('lifecycleReducer — authority & invariants', () => {
  it('does not mutate state for unknown events', () => {
    const prev = initialLifecycleState;

    const next = lifecycleReducer(
      prev,
      // @ts-expect-error — intentionally invalid
      { type: 'UNKNOWN_EVENT' }
    );

    expect(next).toBe(prev);
  });

  it('never changes phase implicitly', () => {
    const prev = initialLifecycleState;

    const next = lifecycleReducer(prev, {
        type: 'BOOT_RESOLVED',
    });

    expect(next.phase).toBe(prev.phase);
 });

  it('never removes an existing phase implicitly', () => {
    const prev: LifecycleState = {
      ...initialLifecycleState,
      phase: 'FT1_READY',
      bootResolved: true,
      integrationExists: true,
      hasLatchedFT1: true,
    };

    const next = lifecycleReducer(prev, {
      // event that should not affect phase
      type: 'BOOT_RESOLVED',
    });

    expect(next.phase).toBe('FT1_READY');
  });

  it('treats FT2 as terminal authority', () => {
    const prev: LifecycleState = {
      ...initialLifecycleState,
      phase: 'FT2_READY',
      hasLatchedFT2: true,
      bootResolved: true,
      integrationExists: true,
    };

    const events = [
      { type: 'BOOT_UNRESOLVED' },
      { type: 'INTEGRATION_DELETED' },
      { type: 'SYNC_STARTED' },
      { type: 'SYNC_COMPLETED' },
      { type: 'FT1_BACKEND_COMPLETE' },
    ] as const;

    for (const event of events) {
      const next = lifecycleReducer(prev, event as any);
      expect(next.phase).toBe('FT2_READY');
      expect(next.hasLatchedFT2).toBe(true);
    }
  });

  it('returns the same object when no state change occurs', () => {
    const prev = initialLifecycleState;

    const next = lifecycleReducer(prev, {
      type: 'BOOT_UNRESOLVED',
    });

    expect(next).toBe(prev);
  });
});