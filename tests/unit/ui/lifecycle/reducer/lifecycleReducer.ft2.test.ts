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

  it('does not promote to FT2 if boot is not resolved', () => {
    const prev: LifecycleState = {
      ...initialLifecycleState,
      phase: 'FT1_READY',
      bootResolved: false,
      integrationExists: true,
      hasLatchedFT1: true,
    };

    const next = lifecycleReducer(prev, {
      type: 'FT2_BACKEND_COMPLETE',
    });

    expect(next.phase).toBe('FT1_READY');
    expect(next.hasLatchedFT2).toBe(false);
  });

  it('does not promote to FT2 if integration does not exist', () => {
    const prev: LifecycleState = {
      ...initialLifecycleState,
      phase: 'FT1_READY',
      bootResolved: true,
      integrationExists: false,
      hasLatchedFT1: true,
    };

    const next = lifecycleReducer(prev, {
      type: 'FT2_BACKEND_COMPLETE',
    });

    expect(next.phase).toBe('FT1_READY');
    expect(next.hasLatchedFT2).toBe(false);
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
});