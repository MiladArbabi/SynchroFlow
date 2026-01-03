/**
 * VisualLifecycleLatch.test.tsx
 *
 * Visual lifecycle invariants (TDD):
 *
 * - FT1 is absorbing while integration exists
 * - Integration deletion is the ONLY allowed reset
 * - FT0 is always shown at least once
 * - FT0 minimum dwell is enforced
 * - bootResolved gates ALL lifecycle meaning
 * - Refresh / auth churn never causes flicker
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';

import { VisualLifecycleLatch } from 'lifecycle/VisualLifecycleLatch';

// -----------------------------------------------------------------------------
// Test setup
// -----------------------------------------------------------------------------

jest.useFakeTimers();

jest.mock('contexts/integration', () => ({
  useIntegration: jest.fn(),
}));

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { shop_id: 1 },
  }),
}));

let mockFt1Complete = false;

jest.mock('lifecycle/useOnboardingReadiness', () => ({
  useOnboardingReadiness: () => ({
    data: {
      ft1: { isComplete: mockFt1Complete },
    },
  }),
}));

import { useIntegration } from 'contexts/integration';

const mockUseIntegration = useIntegration as jest.Mock;

// -----------------------------------------------------------------------------
// Harness
// -----------------------------------------------------------------------------

function renderLatch() {
  return render(
    <VisualLifecycleLatch >
      {(phase) => <div data-testid="phase">{phase}</div>}
    </VisualLifecycleLatch>
  );
}

function setIntegrationState(
  partial: Partial<ReturnType<typeof mockUseIntegration>>
) {
  mockUseIntegration.mockReturnValue({
    bootResolved: true,
    existence: 'EXISTS',
    syncStatus: 'PENDING',
    hasIntegration: true,
    isSyncComplete: false,
    refresh: jest.fn(),
    ...partial,
  });
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('ShopLifecycleShell – visual lifecycle invariants (RED)', () => {
  beforeEach(() => {
    jest.clearAllTimers();
    localStorage.clear();
    mockFt1Complete = false;
  });

  test('bootResolved === false forces FT_MINUS_ONE regardless of backend', () => {
    setIntegrationState({
      bootResolved: false,
      existence: 'EXISTS',
      syncStatus: 'COMPLETED',
      isSyncComplete: true,
    });
    mockFt1Complete = true;

    renderLatch();

    expect(screen.getByTestId('phase')).toHaveTextContent('FT_MINUS_ONE');
  });

  test('backend jump to FT1 always synthesizes FT0 first', () => {
    setIntegrationState({
      syncStatus: 'COMPLETED',
      isSyncComplete: true,
    });
    mockFt1Complete = true;

    renderLatch();

    // First paint must be FT0
    expect(screen.getByTestId('phase')).toHaveTextContent('FT0_PREPARING');

    act(() => {
      jest.advanceTimersByTime(2500);
    });

    expect(screen.getByTestId('phase')).toHaveTextContent('FT1_READY');
  });

  test('FT0 minimum dwell is enforced before FT1 promotion', () => {
    setIntegrationState({
      syncStatus: 'SYNCING',
    });

    const { rerender } = renderLatch();
    expect(screen.getByTestId('phase')).toHaveTextContent('FT0_SYNCING');

    act(() => {
      setIntegrationState({
        syncStatus: 'COMPLETED',
        isSyncComplete: true,
      });
      mockFt1Complete = true;
    });

    expect(screen.getByTestId('phase')).toHaveTextContent('FT0_PREPARING');

    act(() => {
      jest.advanceTimersByTime(2499);
    });

    expect(screen.getByTestId('phase')).toHaveTextContent('FT0_PREPARING');

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(screen.getByTestId('phase')).toHaveTextContent('FT1_READY');
  });

  test('refresh / auth churn does not cause FT regression', () => {
    setIntegrationState({
      syncStatus: 'COMPLETED',
      isSyncComplete: true,
    });
    mockFt1Complete = true;

    const { rerender } = renderLatch();

    act(() => {
      jest.advanceTimersByTime(2500);
    });

    expect(screen.getByTestId('phase')).toHaveTextContent('FT1_READY');

    act(() => {
      setIntegrationState({
        bootResolved: false,
        existence: 'NONE',
        syncStatus: 'IDLE',
        hasIntegration: false,
        isSyncComplete: false,
      });
    });

    // FT1 must remain latched during churn
    expect(screen.getByTestId('phase')).toHaveTextContent('FT1_READY');
  });

  test('integration deletion is the ONLY allowed lifecycle reset', () => {
    setIntegrationState({
      syncStatus: 'COMPLETED',
      isSyncComplete: true,
    });
    mockFt1Complete = true;

    const { rerender } = renderLatch();

    act(() => {
      jest.advanceTimersByTime(2500);
    });

    expect(screen.getByTestId('phase')).toHaveTextContent('FT1_READY');

    act(() => {
      setIntegrationState({
        existence: 'NONE',
        syncStatus: 'IDLE',
        hasIntegration: false,
        isSyncComplete: false,
      });
    });

    expect(screen.getByTestId('phase')).toHaveTextContent('FT_MINUS_ONE');
  });

  test('FT1 seal restores FT1 synchronously on first paint (no FT_MINUS_ONE)', () => {
    localStorage.setItem('shop:1:ft1-seen', 'true');

    setIntegrationState({
        syncStatus: 'COMPLETED',
        isSyncComplete: true,
    });
    mockFt1Complete = true;

    renderLatch();

    // FIRST render must already be FT1
    expect(screen.getByTestId('phase')).toHaveTextContent('FT1_READY');
    });

    test('stale FT1 seal is removed when integration does not exist', () => {
  localStorage.setItem('shop:1:ft1-seen', 'true');

  setIntegrationState({
    existence: 'NONE',
    syncStatus: 'IDLE',
    hasIntegration: false,
    isSyncComplete: false,
  });

  renderLatch();

  expect(screen.getByTestId('phase')).toHaveTextContent('FT_MINUS_ONE');
  expect(localStorage.getItem('shop:1:ft1-seen')).toBeNull();
});

test('FT1 seal is ignored if integration does not exist', () => {
  localStorage.setItem('shop:1:ft1-seen', 'true');

  setIntegrationState({
    existence: 'NONE',
    syncStatus: 'COMPLETED',
    hasIntegration: false,
    isSyncComplete: true,
  });

  mockFt1Complete = true;

  renderLatch();

  expect(screen.getByTestId('phase')).toHaveTextContent('FT_MINUS_ONE');
});

test('cold boot without integration never shows FT0', () => {
    setIntegrationState({
        existence: 'NONE',
        syncStatus: 'IDLE',
        hasIntegration: false,
        isSyncComplete: false,
    });

    renderLatch();

    expect(screen.getByTestId('phase')).toHaveTextContent('FT_MINUS_ONE');
    });
});