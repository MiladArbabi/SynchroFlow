// tests/unit/ui/lifecycle/reducer/lifecycleReducer.ft1.test.ts
import { lifecycleReducer } from 'ui/src/lifecycle/lifecycleReducer';
import { initialLifecycleState } from 'ui/src/lifecycle/lifecycleTypes';
import type { LifecycleState } from 'ui/src/lifecycle/lifecycleTypes';

describe('lifecycleReducer — FT1 behavior', () => {
  it('does not enter FT1 without backend confirmation', () => {
    const prev: LifecycleState = {
      ...initialLifecycleState,
      phase: 'FT0_PREPARING',
      bootResolved: true,
      integrationExists: true,
      hasSeenFT0: true,
      ft0DwellCompleted: true,
    };

    const next = lifecycleReducer(prev, {
      type: 'SYNC_COMPLETED',
    });

    expect(next.phase).toBe('FT0_PREPARING');
    expect(next.hasLatchedFT1).toBe(false);
  });

  it('promotes to FT1_READY when backend FT1 completes and FT0 dwell is complete', () => {
    const prev: LifecycleState = {
      ...initialLifecycleState,
      phase: 'FT0_PREPARING',
      bootResolved: true,
      integrationExists: true,
      hasSeenFT0: true,
      ft0DwellCompleted: true,
    };

    const next = lifecycleReducer(prev, {
      type: 'FT1_BACKEND_COMPLETE',
    });

    expect(next.phase).toBe('FT1_READY');
    expect(next.hasLatchedFT1).toBe(true);
  });

  it('latches FT1 but remains in FT0_PREPARING when boot/integration are incomplete', () => {
    const prev: LifecycleState = {
        ...initialLifecycleState,
        phase: 'FT0_PREPARING',
        bootResolved: false,
        integrationExists: true,
    };

    const next = lifecycleReducer(prev, {
        type: 'FT1_BACKEND_COMPLETE',
    });

    expect(next.hasLatchedFT1).toBe(true);
    expect(next.phase).toBe('FT0_PREPARING');
  });

  it('latches FT1 even if promotion cannot yet occur', () => {
    const prev: LifecycleState = {
      ...initialLifecycleState,
      phase: 'FT0_PREPARING',
      bootResolved: false,
      integrationExists: false,
    };

    const next = lifecycleReducer(prev, {
      type: 'FT1_BACKEND_COMPLETE',
    });

    expect(next.hasLatchedFT1).toBe(true);
    expect(next.phase).toBe('FT0_PREPARING');
  });

  it('does not regress from FT1_READY on boot unresolved', () => {
    const prev: LifecycleState = {
      ...initialLifecycleState,
      phase: 'FT1_READY',
      bootResolved: true,
      integrationExists: true,
      hasLatchedFT1: true,
    };

    const next = lifecycleReducer(prev, {
      type: 'BOOT_UNRESOLVED',
    });

    expect(next.phase).toBe('FT1_READY');
  });

  it('does not auto-promote to FT2 from FT1 without explicit backend FT2 event', () => {
    const prev: LifecycleState = {
        ...initialLifecycleState,
        phase: 'FT1_READY',
        bootResolved: true,
        integrationExists: true,
        hasLatchedFT1: true,
    };

    const next = lifecycleReducer(prev, {
        type: 'BOOT_RESOLVED',
    });

    expect(next.phase).toBe('FT1_READY');
   });
});