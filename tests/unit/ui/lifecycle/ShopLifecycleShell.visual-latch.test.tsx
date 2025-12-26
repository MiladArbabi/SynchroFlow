//tests/unit/ui/lifecycle/ShopLifecycleShell.visual-latch.test.tsx
import React from 'react';
import { renderWithTheme } from 'test-utils';
import { act, screen } from '@testing-library/react';
import { ShopLifecycleShell } from 'lifecycle/ShopLifecycleShell';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';
import { ShopLifecyclePhase } from 'lifecycle/types';

/* ------------------------------------------------------------------ */
/* Mocks                                                              */
/* ------------------------------------------------------------------ */

let mockStatus: string = 'NOT_FOUND';
let mockIsLoading = false;
let mockShopId: number | null = 1;
let mockFt1Complete = false;

jest.mock('contexts/IntegrationContext', () => ({
  useIntegrationSyncStatus: () => ({
    status: mockStatus,
    isLoading: mockIsLoading,
  }),
}));

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockShopId ? { shop_id: mockShopId } : null,
  }),
}));

jest.mock('lifecycle/useOnboardingReadiness', () => ({
  useOnboardingReadiness: () => ({
    data: {
      ft1: {
        isComplete: mockFt1Complete,
        blockingModules: [],
        readyModules: [],
      },
    },
  }),
}));

/* ------------------------------------------------------------------ */
/* Test probe                                                         */
/* ------------------------------------------------------------------ */

function PhaseProbe() {
  const { phase } = useShopLifecycle();
  return <div data-testid="phase">{phase}</div>;
}

/* ------------------------------------------------------------------ */
/* Tests                                                              */
/* ------------------------------------------------------------------ */

describe('ShopLifecycleShell – visual phase latching (RED)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Mock performance.now to work with jest timers
    jest.spyOn(performance, 'now').mockImplementation(() => Date.now());
    mockStatus = 'NOT_FOUND';
    mockIsLoading = false;
    mockShopId = 1;
    mockFt1Complete = false;
    });

    afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks(); // This restores performance.now
    });

  test('monotonic latch: phase must never regress once FT1 is reached', () => {
    const { rerender } = renderWithTheme(
      <ShopLifecycleShell>
        <PhaseProbe />
      </ShopLifecycleShell>
    );

    // FT_MINUS_ONE
    expect(screen.getByTestId('phase').textContent)
      .toBe<'FT_MINUS_ONE'>('FT_MINUS_ONE');

    // Move to FT0
    act(() => {
      mockStatus = 'SYNCING_PRODUCTS';
      rerender(
        <ShopLifecycleShell>
          <PhaseProbe />
        </ShopLifecycleShell>
      );
    });

    const phaseAfterFt0 =
      screen.getByTestId('phase').textContent as ShopLifecyclePhase;

    expect(['FT0_SYNCING', 'FT0_PREPARING']).toContain(phaseAfterFt0);

    // Jump to FT1
    act(() => {
      mockStatus = 'COMPLETED';
      mockFt1Complete = true;
      rerender(
        <ShopLifecycleShell>
          <PhaseProbe />
        </ShopLifecycleShell>
      );
    });

    act(() => {
      jest.runAllTimers();
    });

    expect(screen.getByTestId('phase').textContent)
      .toBe<'FT1_READY'>('FT1_READY');

    // Backend regresses (loading / refetch)
    act(() => {
      mockStatus = 'NOT_FOUND';
      rerender(
        <ShopLifecycleShell>
          <PhaseProbe />
        </ShopLifecycleShell>
      );
    });

    // ❌ MUST NOT go backward
    expect(screen.getByTestId('phase').textContent)
      .toBe<'FT1_READY'>('FT1_READY');
  });

  test('forces FT0 once when backend jumps directly to FT1', () => {
    mockStatus = 'COMPLETED';
    mockFt1Complete = true;

    renderWithTheme(
      <ShopLifecycleShell>
        <PhaseProbe />
      </ShopLifecycleShell>
    );

    // First paint must NOT be FT1
    const firstPhase =
      screen.getByTestId('phase').textContent as ShopLifecyclePhase;

    expect(firstPhase).not.toBe('FT1_READY');
    expect(['FT0_SYNCING', 'FT0_PREPARING']).toContain(firstPhase);

    act(() => {
      jest.runAllTimers();
    });

    expect(screen.getByTestId('phase').textContent)
      .toBe<'FT1_READY'>('FT1_READY');
  });

  test('enforces minimum FT0 dwell before FT1 promotion', () => {
  const VISUAL_MIN_MS = 1400;
  
  // Capture the rerender function
  const { rerender } = renderWithTheme(
    <ShopLifecycleShell>
      <PhaseProbe />
    </ShopLifecycleShell>
  );

  // Enter FT0 with rerender
  act(() => {
    mockStatus = 'SYNCING_PRODUCTS';
    rerender(
      <ShopLifecycleShell>
        <PhaseProbe />
      </ShopLifecycleShell>
    );
  });

  // Immediately complete with rerender
  act(() => {
    mockStatus = 'COMPLETED';
    mockFt1Complete = true;
    rerender(
      <ShopLifecycleShell>
        <PhaseProbe />
      </ShopLifecycleShell>
    );
  });

  // Before dwell expires → still FT0
  act(() => {
    jest.advanceTimersByTime(VISUAL_MIN_MS - 100);
  });

  expect(['FT0_SYNCING', 'FT0_PREPARING']).toContain(
    screen.getByTestId('phase').textContent
  );

  // After dwell → FT1 allowed
  act(() => {
    jest.advanceTimersByTime(200);
  });

  expect(screen.getByTestId('phase').textContent)
    .toBe<'FT1_READY'>('FT1_READY');
});

  test('refresh in FT1 must never flash FT_MINUS_ONE', () => {
    mockStatus = 'COMPLETED';
    mockFt1Complete = true;

    const { rerender } = renderWithTheme(
      <ShopLifecycleShell>
        <PhaseProbe />
      </ShopLifecycleShell>
    );

    act(() => {
      jest.runAllTimers();
    });

    expect(screen.getByTestId('phase').textContent)
      .toBe<'FT1_READY'>('FT1_READY');

    // Simulate refetch/loading
    act(() => {
      mockIsLoading = true;
      rerender(
        <ShopLifecycleShell>
          <PhaseProbe />
        </ShopLifecycleShell>
      );
    });

    // ❌ must stay FT1
    expect(screen.getByTestId('phase').textContent)
      .toBe<'FT1_READY'>('FT1_READY');
  });
});
