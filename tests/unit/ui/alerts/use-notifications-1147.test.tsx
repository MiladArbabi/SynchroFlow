import fs from 'fs';
import path from 'path';
import React from 'react';
import {
  act,
  renderHook,
  waitFor,
} from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';

import { axiosInstance } from 'api/axiosConfig';
import {
  NOTIFICATION_PREFERENCES_QUERY_KEY,
  PUSH_STATUS_QUERY_KEY,
  RECENT_NOTIFICATIONS_QUERY_KEY,
  useMarkNotificationClicked,
  useMarkNotificationRead,
  useNotificationConditions,
  useNotificationPreferences,
  usePushStatus,
  useRecentNotifications,
  useUpdateNotificationPreferences,
} from 'pages/alerts/useNotifications';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: jest.fn(),
    patch: jest.fn(),
  },
}));

const mockedGet = axiosInstance.get as jest.Mock;
const mockedPatch = axiosInstance.patch as jest.Mock;

const ID = '11111111-1111-4111-8111-111111111111';

const RECENT = {
  notifications: [
    {
      id: ID,
      condition_key: 'orders_cannot_be_fulfilled',
      urgency: 'critical',
      title: 'Orders cannot be fulfilled',
      message: '3 orders need attention.',
      context: {},
      action: {
        route: '/orders',
        label: 'Review orders',
      },
      state: 'unread',
      created_at: '2026-09-23T10:00:00.000Z',
      read_at: null,
      clicked_at: null,
    },
  ],
  unread_count: 1,
};

const PREFERENCES = {
  schema_version: 2 as const,
  urgency: 'important_critical' as const,
  channels: {
    in_app: true as const,
    push: true,
    email: false,
  },
  quiet_hours: {
    enabled: false,
    start: '22:00',
    end: '07:00',
    allow_critical: true,
  },
  daily_summary: 'off' as const,
  conditions: {},
};

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({
    children,
  }: {
    children: React.ReactNode;
  }) {
    return (
      <QueryClientProvider client={client}>
        {children}
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GH-1147 — notification frontend seam', () => {
  it('fetches Recent from the notification-history endpoint', async () => {
    mockedGet.mockResolvedValueOnce({ data: RECENT });

    const { result } = renderHook(
      () => useRecentNotifications(),
      { wrapper: wrapperFor(makeClient()) },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockedGet).toHaveBeenCalledWith(
      '/api/v1/notifications/recent',
    );
    expect(result.current.data).toEqual(RECENT);
  });

  it('passes an explicit Recent limit without inventing filters', async () => {
    mockedGet.mockResolvedValueOnce({ data: RECENT });

    const { result } = renderHook(
      () => useRecentNotifications({ limit: 25 }),
      { wrapper: wrapperFor(makeClient()) },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockedGet).toHaveBeenCalledWith(
      '/api/v1/notifications/recent?limit=25',
    );
  });

  it('supports lifecycle gating without issuing a request', async () => {
    renderHook(
      () => useRecentNotifications({ enabled: false }),
      { wrapper: wrapperFor(makeClient()) },
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('discovers conditions from the canonical notification catalog', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        conditions: [
          {
            key: 'orders_cannot_be_fulfilled',
            area: 'fulfillment',
            merchantLabel: 'Orders cannot be fulfilled',
            urgency: 'critical',
            defaultEnabled: true,
            criticalInAppProtection: true,
            action: {
              route: '/orders',
              label: 'Review orders',
            },
          },
        ],
      },
    });

    const { result } = renderHook(
      () => useNotificationConditions(),
      { wrapper: wrapperFor(makeClient()) },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockedGet).toHaveBeenCalledWith(
      '/api/v1/notifications/conditions',
    );
    expect(result.current.data?.[0]?.merchantLabel).toBe(
      'Orders cannot be fulfilled',
    );
  });

  it('reads normalized notification preferences', async () => {
    mockedGet.mockResolvedValueOnce({
      data: { preferences: PREFERENCES },
    });

    const { result } = renderHook(
      () => useNotificationPreferences(),
      { wrapper: wrapperFor(makeClient()) },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockedGet).toHaveBeenCalledWith(
      '/api/v1/members/me/preferences',
    );
    expect(result.current.data).toEqual(PREFERENCES);
  });

  it('reads push registered destination status without subscription secrets', async () => {
    const status = {
      registered_destination_count: 1,
      has_registered_destination: true,
      web_count: 1,
      expo_count: 0,
    };
    mockedGet.mockResolvedValueOnce({ data: status });

    const { result } = renderHook(
      () => usePushStatus(),
      { wrapper: wrapperFor(makeClient()) },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockedGet).toHaveBeenCalledWith(
      '/api/v1/notifications/push-status',
    );
    expect(result.current.data).toEqual(status);
    expect(JSON.stringify(result.current.data)).not.toMatch(
      /endpoint|p256dh|auth|expo_push_token/,
    );
  });

  it('supports push-status lifecycle gating without issuing a request', async () => {
    renderHook(
      () => usePushStatus({ enabled: false }),
      { wrapper: wrapperFor(makeClient()) },
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('marks a notification read and refreshes Recent', async () => {
    const client = makeClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    mockedPatch.mockResolvedValueOnce({
      data: {
        notification: {
          ...RECENT.notifications[0],
          state: 'read',
          read_at: '2026-09-23T10:01:00.000Z',
        },
      },
    });

    const { result } = renderHook(
      () => useMarkNotificationRead(),
      { wrapper: wrapperFor(client) },
    );

    await act(async () => {
      await result.current.mutateAsync(ID);
    });

    expect(mockedPatch).toHaveBeenCalledWith(
      `/api/v1/notifications/recent/${ID}/read`,
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: RECENT_NOTIFICATIONS_QUERY_KEY,
    });
  });

  it('marks a notification clicked and refreshes Recent', async () => {
    const client = makeClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    mockedPatch.mockResolvedValueOnce({
      data: {
        notification: {
          ...RECENT.notifications[0],
          state: 'clicked',
          read_at: '2026-09-23T10:01:00.000Z',
          clicked_at: '2026-09-23T10:01:00.000Z',
        },
      },
    });

    const { result } = renderHook(
      () => useMarkNotificationClicked(),
      { wrapper: wrapperFor(client) },
    );

    await act(async () => {
      await result.current.mutateAsync(ID);
    });

    expect(mockedPatch).toHaveBeenCalledWith(
      `/api/v1/notifications/recent/${ID}/click`,
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: RECENT_NOTIFICATIONS_QUERY_KEY,
    });
  });

  it('patches canonical preferences and updates their cache', async () => {
    const client = makeClient();

    mockedPatch.mockResolvedValueOnce({
      data: {
        preferences: {
          ...PREFERENCES,
          channels: {
            ...PREFERENCES.channels,
            email: true,
          },
        },
      },
    });

    const { result } = renderHook(
      () => useUpdateNotificationPreferences(),
      { wrapper: wrapperFor(client) },
    );

    await act(async () => {
      await result.current.mutateAsync({
        channels: { email: true },
      });
    });

    expect(mockedPatch).toHaveBeenCalledWith(
      '/api/v1/members/me/preferences',
      { channels: { email: true } },
    );

    expect(
      client.getQueryData(NOTIFICATION_PREFERENCES_QUERY_KEY),
    ).toEqual({
      ...PREFERENCES,
      channels: {
        ...PREFERENCES.channels,
        email: true,
      },
    });
  });

  it('exports a focused cache key for push registered destination status', () => {
    expect(PUSH_STATUS_QUERY_KEY).toEqual([
      'notifications',
      'push-status',
    ]);
  });

  it('is notification-only and never depends on operational alert endpoints', () => {
    const source = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../../apps/frontend/src/pages/alerts/useNotifications.ts',
      ),
      'utf8',
    );

    expect(source).toContain('/api/v1/notifications/recent');
    expect(source).toContain('/api/v1/members/me/preferences');

    expect(source).not.toMatch(/\/api\/v1\/alerts(?:\/|\?|['"`])/);
    expect(source).not.toMatch(/acknowledge/i);
    expect(source).not.toMatch(/snooze/i);
    expect(source).not.toMatch(/resolve/i);
    expect(source).not.toMatch(/refetchInterval/);
  });
});
