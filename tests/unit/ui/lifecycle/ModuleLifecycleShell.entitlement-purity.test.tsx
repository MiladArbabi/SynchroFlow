//tests/unit/ui/lifecycle/ModuleLifecycleShell.entitlement-purity.test.tsx
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { ModuleLifecycleShell } from 'lifecycle/ModuleLifecycleShell';

// --- mock entitlements ---
let mockModules: string[] = [];

jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({
    modules: mockModules,
    flags: [],
    isLoading: false,
    hasResolved: true,
    hasModule: (id: string) => mockModules.includes(id),
    hasFlag: () => false,
    refresh: jest.fn(),
    shopId: null,
    error: null,
  }),
}));

// --- mock lifecycle reducer output ---
jest.mock('lifecycle/useModuleLifecycle', () => ({
  useModuleLifecycle: () => ({
    phase: 'FT1_READY',
    isBlocked: false,
    reason: null,
  }),
}));

describe('ModuleLifecycleShell — entitlement purity (RED)', () => {
  it('does not change lifecycle output when entitlements change', () => {
    const { rerender } = render(
      <ModuleLifecycleShell moduleId="orders">
        <div data-testid="content">OK</div>
      </ModuleLifecycleShell>
    );

    const firstRender = screen.getByTestId('content');

    // mutate entitlements
    mockModules = ['orders'];

    rerender(
      <ModuleLifecycleShell moduleId="orders">
        <div data-testid="content">OK</div>
      </ModuleLifecycleShell>
    );

    const secondRender = screen.getByTestId('content');

    // lifecycle output must be identical regardless of entitlements
    expect(secondRender).toBe(firstRender);
  });
});