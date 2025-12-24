//apps/frontend/tests/unit/activation/useActivationSurface.test.tsx
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useActivationSurface } from 'activation/useActivationSurface';
import { axiosInstance } from 'api/axiosConfig';

import type { ActivationVerdict } from '@lasyncro/shared/activation';
import React from 'react';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: jest.fn(),
  },
}));

const mockedGet = axiosInstance.get as jest.Mock;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
}

describe('useActivationSurface', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    sessionStorage.clear();
  });

  it('returns loading state initially', async () => {
    mockedGet.mockResolvedValueOnce({ data: null });

    const { result } = renderHook(
      () => useActivationSurface(),
      { wrapper: createWrapper() }
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.surface).toBeNull();
  });

  it('derives BLOCKED_AUTH surface when verdict is NOT_AUTHENTICATED', async () => {
    const verdict: ActivationVerdict = {
      verdict: 'BLOCKED',
      reason: 'NOT_AUTHENTICATED',
      explanation: 'User not logged in',
      retryable: true,
    };

    mockedGet.mockResolvedValueOnce({ data: verdict });

    const { result } = renderHook(
      () => useActivationSurface(),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.surface).toEqual({
      state: 'BLOCKED_AUTH',
      primaryAction: { action: 'LOGIN' },
    });
  });

  it('derives SYNC_IN_PROGRESS surface when verdict is FT0_SYNCING', async () => {
    const verdict: ActivationVerdict = {
      verdict: 'PENDING',
      reason: 'FT0_SYNCING',
      explanation: 'Initial sync running',
      retryable: false,
    };

    mockedGet.mockResolvedValueOnce({ data: verdict });

    const { result } = renderHook(
      () => useActivationSurface(),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.surface).not.toBeNull();
    });

    expect(result.current.surface).toEqual({
      state: 'SYNC_IN_PROGRESS',
      progress: { phase: 'FT0' },
      ft0: {
        phase: 'SYNCING',
        isBlocking: true,
      },
    });
  });

  it('derives READY_PENDING_MODULES when entitlement is pending', async () => {
    const verdict: ActivationVerdict = {
      verdict: 'PENDING',
      reason: 'ENTITLEMENT_PENDING',
      explanation: 'Modules not yet activated',
      retryable: false,
    };

    mockedGet.mockResolvedValueOnce({ data: verdict });

    const { result } = renderHook(
      () => useActivationSurface(),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.surface).not.toBeNull();
    });

    expect(result.current.surface).toEqual({
      state: 'READY_PENDING_MODULES',
      ft0: {
        phase: 'COMPLETED',
        isBlocking: false,
      },
    });
  });

  it('derives ACTIVE surface when verdict is ACTIVE', async () => {
    const verdict: ActivationVerdict = {
      verdict: 'ACTIVE',
      activatedModules: ['dashboard'],
    };

    mockedGet.mockResolvedValueOnce({ data: verdict });

    const { result } = renderHook(
      () => useActivationSurface({ moduleId: 'dashboard' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.surface).not.toBeNull();
    });

    expect(result.current.surface).toEqual({
      state: 'ACTIVE',
      primaryAction: { action: 'GO_TO_DASHBOARD' },
      ft0: {
        phase: 'COMPLETED',
        isBlocking: false,
      },
    });
  });

  it('marks FT0 modal as seen when dismissFT0Modal is called', async () => {
    const verdict: ActivationVerdict = {
      verdict: 'PENDING',
      reason: 'FT0_SYNCING',
      explanation: 'Initial sync running',
      retryable: false,
    };

    mockedGet.mockResolvedValueOnce({ data: verdict });

    const { result } = renderHook(
      () => useActivationSurface(),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.surface).not.toBeNull();
    });

    result.current.dismissFT0Modal();

    expect(sessionStorage.getItem('ft0-syncing-shown')).toBe('true');
  });
});
