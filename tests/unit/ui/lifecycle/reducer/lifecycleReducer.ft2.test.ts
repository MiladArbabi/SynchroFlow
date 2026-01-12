// tests/unit/ui/lifecycle/reducer/lifecycleReducer.ft2.test.ts

import { lifecycleReducer } from 'ui/src/lifecycle/lifecycleReducer';
import { initialLifecycleState } from 'ui/src/lifecycle/lifecycleTypes';
import type { LifecycleState } from 'ui/src/lifecycle/lifecycleTypes';

describe('lifecycleReducer — FT2 behavior (terminal)', () => {
  it('does not enter FT2 without backend confirmation', () => {
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
    expect(next.hasLatchedFT2).toBe(false);
  });

  it('promotes to FT2_READY only on FT2_BACKEND_COMPLETE', () => {
    const prev: LifecycleState = {
      ...initialLifecycleState,
      phase: 'FT1_READY',
      bootResolved: true,
      integrationExists: true,
      hasLatchedFT1: true,
    };

    const next = lifecycleReducer(prev, {
      type: 'FT2_BACKEND_COMPLETE',
    });

    expect(next.phase).toBe('FT2_READY');
    expect(next.hasLatchedFT2).toBe(true);
  });

    it('promotes to FT2 regardless of boot or integration state', () => {
    const state : LifecycleState = {
      phase: 'FT1_READY',
      bootResolved: false,
      integrationExists: false,
      hasSeenFT0: false,
      hasLatchedFT1: true,
      hasLatchedFT2: false,
      ft0DwellCompleted: false,
    };

    const next = lifecycleReducer(state, {
      type: 'FT2_BACKEND_COMPLETE',
    });

    expect(next.phase).toBe('FT2_READY');
    expect(next.hasLatchedFT2).toBe(true);
  });


  it('treats FT2 as terminal and ignores subsequent events', () => {
    const prev: LifecycleState = {
      ...initialLifecycleState,
      phase: 'FT2_READY',
      bootResolved: true,
      integrationExists: true,
      hasLatchedFT1: true,
      hasLatchedFT2: true,
    };

    const next = lifecycleReducer(prev, {
      type: 'BOOT_UNRESOLVED',
    });

    expect(next).toBe(prev);
    expect(next.phase).toBe('FT2_READY');
  });

  it('does not regress FT2 on integration deletion', () => {
    const prev: LifecycleState = {
      ...initialLifecycleState,
      phase: 'FT2_READY',
      bootResolved: true,
      integrationExists: true,
      hasLatchedFT1: true,
      hasLatchedFT2: true,
    };

    const next = lifecycleReducer(prev, {
      type: 'INTEGRATION_DELETED',
    });

    expect(next).toBe(prev);
    expect(next.phase).toBe('FT2_READY');
  });

  it('does not auto-promote from FT1 without explicit FT2 backend event', () => {
    const prev: LifecycleState = {
      ...initialLifecycleState,
      phase: 'FT1_READY',
      bootResolved: true,
      integrationExists: true,
      hasLatchedFT1: true,
    };

    const next = lifecycleReducer(prev, {
      type: 'FT1_BACKEND_COMPLETE',
    });

    expect(next.phase).toBe('FT1_READY');
    expect(next.hasLatchedFT2).toBe(false);
  });

  it('returns same object for no-op events after FT2', () => {
    const prev: LifecycleState = {
      ...initialLifecycleState,
      phase: 'FT2_READY',
      bootResolved: true,
      integrationExists: true,
      hasLatchedFT1: true,
      hasLatchedFT2: true,
    };

    const next = lifecycleReducer(prev, {
      type: 'SYNC_COMPLETED',
    });

    expect(next).toBe(prev);
  });

  it('latches FT2 regardless of boot or integration state', () => {
    const initial: LifecycleState = {
      phase: 'FT_MINUS_ONE',
      bootResolved: false,
      integrationExists: false,
      hasSeenFT0: false,
      hasLatchedFT1: false,
      hasLatchedFT2: false,
      ft0DwellCompleted: false,
    };

    const next = lifecycleReducer(initial, {
      type: 'FT2_BACKEND_COMPLETE',
    });

    expect(next.phase).toBe('FT2_READY');
    expect(next.hasLatchedFT2).toBe(true);
  });

  it('does not regress once FT2 is latched', () => {
    const ft2State: LifecycleState = {
      phase: 'FT2_READY',
      bootResolved: true,
      integrationExists: true,
      hasSeenFT0: true,
      hasLatchedFT1: true,
      hasLatchedFT2: true,
      ft0DwellCompleted: true,
    };

    const next = lifecycleReducer(ft2State, {
      type: 'BOOT_UNRESOLVED',
    });

    expect(next).toEqual(ft2State);
  });
});