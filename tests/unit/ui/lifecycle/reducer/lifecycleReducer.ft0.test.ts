// tests/unit/ui/lifecycle/reducer/lifecycleReducer.ft0.test.ts

import { lifecycleReducer } from 'ui/src/lifecycle/lifecycleReducer';
import { initialLifecycleState } from 'ui/src/lifecycle/lifecycleTypes';
import type { LifecycleState } from 'ui/src/lifecycle/lifecycleTypes';

describe('lifecycleReducer — FT0 behavior', () => {
  it('enters FT0_PREPARING when integration is created after boot', () => {
    const prev: LifecycleState = {
      ...initialLifecycleState,
      phase: 'FT_MINUS_ONE',
      bootResolved: true,
      integrationExists: false,
    };

    const next = lifecycleReducer(prev, {
      type: 'INTEGRATION_CREATED',
    });

    expect(next.phase).toBe('FT0_PREPARING');
    expect(next.hasSeenFT0).toBe(true);
    expect(next.integrationExists).toBe(true);
  });

  it('does not enter FT0 before boot is resolved', () => {
    const prev = initialLifecycleState;

    const next = lifecycleReducer(prev, {
      type: 'INTEGRATION_CREATED',
    });

    expect(next.phase).toBe('FT_MINUS_ONE');
    expect(next.hasSeenFT0).toBe(false);
  });

  it('enters FT0_SYNCING when sync starts after integration + boot', () => {
    const prev: LifecycleState = {
      ...initialLifecycleState,
      phase: 'FT_MINUS_ONE',
      bootResolved: true,
      integrationExists: true,
    };

    const next = lifecycleReducer(prev, {
      type: 'SYNC_STARTED',
    });

    expect(next.phase).toBe('FT0_SYNCING');
  });

  it('transitions from FT0_SYNCING → FT0_PREPARING on sync completion', () => {
    const prev: LifecycleState = {
      ...initialLifecycleState,
      phase: 'FT0_SYNCING',
      bootResolved: true,
      integrationExists: true,
    };

    const next = lifecycleReducer(prev, {
      type: 'SYNC_COMPLETED',
    });

    expect(next.phase).toBe('FT0_PREPARING');
    expect(next.hasSeenFT0).toBe(true);
  });

  it('never regresses back to FT0_SYNCING after sync completion', () => {
    const prev: LifecycleState = {
      ...initialLifecycleState,
      phase: 'FT0_PREPARING',
      bootResolved: true,
      integrationExists: true,
      hasSeenFT0: true,
    };

    const next = lifecycleReducer(prev, {
      type: 'SYNC_STARTED',
    });

    expect(next.phase).toBe('FT0_PREPARING');
  });

  it('FT0 dwell completion alone does not promote to FT1', () => {
    const prev: LifecycleState = {
      ...initialLifecycleState,
      phase: 'FT0_PREPARING',
      bootResolved: true,
      integrationExists: true,
      hasSeenFT0: true,
    };

    const next = lifecycleReducer(prev, {
      type: 'FT0_DWELL_ELAPSED',
    });

    expect(next.phase).toBe('FT0_PREPARING');
    expect(next.ft0DwellCompleted).toBe(true);
  });
});