import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type NotificationState = 'unread' | 'read' | 'clicked';

export type NotificationUrgency =
  | 'critical'
  | 'important'
  | 'informational';

export type NotificationAction = {
  route: string;
  label: string;
};

export type RecentNotification = {
  id: string;
  condition_key: string;
  urgency: NotificationUrgency;
  title: string;
  message: string;
  context: unknown;
  action: NotificationAction | null;
  state: NotificationState;
  created_at: string;
  read_at: string | null;
  clicked_at: string | null;
};

export type RecentNotificationsResponse = {
  notifications: RecentNotification[];
  unread_count: number;
};

export type NotificationPreferenceUrgency =
  | 'critical_only'
  | 'important_critical'
  | 'all';

export type NotificationDailySummary =
  | 'off'
  | 'morning'
  | 'evening';

export type NotificationConditionPreferences = {
  enabled?: boolean;
  push?: boolean;
  email?: boolean;
  threshold_minutes?: number;
};

export type NotificationPreferences = {
  schema_version: 2;
  urgency: NotificationPreferenceUrgency;
  channels: {
    in_app: true;
    push: boolean;
    email: boolean;
  };
  quiet_hours: {
    enabled: boolean;
    start: string;
    end: string;
    allow_critical: boolean;
  };
  daily_summary: NotificationDailySummary;
  conditions: Record<string, NotificationConditionPreferences>;
};

export type NotificationPreferencesPatch = {
  urgency?: NotificationPreferenceUrgency;
  channels?: {
    push?: boolean;
    email?: boolean;
  };
  quiet_hours?: Partial<NotificationPreferences['quiet_hours']>;
  daily_summary?: NotificationDailySummary;
  conditions?: Record<string, NotificationConditionPreferences>;
};

export type NotificationConditionDefinition = {
  key: string;
  area: string;
  merchantLabel: string;
  urgency: NotificationUrgency;
  defaultEnabled: boolean;
  criticalInAppProtection: boolean;
  action: NotificationAction;
};

export type NotificationConditionsResponse = {
  conditions: NotificationConditionDefinition[];
};

export type UseNotificationConditionsOptions = {
  enabled?: boolean;
};

export type UseRecentNotificationsOptions = {
  enabled?: boolean;
  limit?: number;
};

export type UseNotificationPreferencesOptions = {
  enabled?: boolean;
};

export type PushStatusResponse = {
  registered_destination_count: number;
  has_registered_destination: boolean;
  web_count?: number;
  expo_count?: number;
};

export type UsePushStatusOptions = {
  enabled?: boolean;
};

export const RECENT_NOTIFICATIONS_QUERY_KEY =
  ['notifications', 'recent'] as const;

export const NOTIFICATION_PREFERENCES_QUERY_KEY =
  ['notifications', 'preferences'] as const;

export const NOTIFICATION_CONDITIONS_QUERY_KEY =
  ['notifications', 'conditions'] as const;

export const PUSH_STATUS_QUERY_KEY =
  ['notifications', 'push-status'] as const;

export function recentNotificationsQueryKey(limit?: number) {
  return [
    ...RECENT_NOTIFICATIONS_QUERY_KEY,
    { limit: limit ?? null },
  ] as const;
}

export function useRecentNotifications(
  options: UseRecentNotificationsOptions = {},
) {
  const enabled = options.enabled ?? true;
  const { limit } = options;

  return useQuery<RecentNotificationsResponse>({
    queryKey: recentNotificationsQueryKey(limit),
    queryFn: async () => {
      const suffix =
        limit === undefined
          ? ''
          : `?limit=${encodeURIComponent(String(limit))}`;

      const { data } = await axiosInstance.get(
        `/api/v1/notifications/recent${suffix}`,
      );

      return data;
    },
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useNotificationConditions(
  options: UseNotificationConditionsOptions = {},
) {
  const enabled = options.enabled ?? true;

  return useQuery<NotificationConditionDefinition[]>({
    queryKey: NOTIFICATION_CONDITIONS_QUERY_KEY,
    queryFn: async () => {
      const { data } =
        await axiosInstance.get<NotificationConditionsResponse>(
          '/api/v1/notifications/conditions',
        );

      return data.conditions;
    },
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useNotificationPreferences(
  options: UseNotificationPreferencesOptions = {},
) {
  const enabled = options.enabled ?? true;

  return useQuery<NotificationPreferences>({
    queryKey: NOTIFICATION_PREFERENCES_QUERY_KEY,
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/members/me/preferences',
      );

      return data.preferences;
    },
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function usePushStatus(
  options: UsePushStatusOptions = {},
) {
  const enabled = options.enabled ?? true;

  return useQuery<PushStatusResponse>({
    queryKey: PUSH_STATUS_QUERY_KEY,
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/notifications/push-status',
      );

      return data;
    },
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation<RecentNotification, Error, string>({
    mutationFn: async (notificationId) => {
      const { data } = await axiosInstance.patch(
        `/api/v1/notifications/recent/${notificationId}/read`,
      );

      return data.notification;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: RECENT_NOTIFICATIONS_QUERY_KEY,
      });
    },
  });
}

export function useMarkNotificationClicked() {
  const queryClient = useQueryClient();

  return useMutation<RecentNotification, Error, string>({
    mutationFn: async (notificationId) => {
      const { data } = await axiosInstance.patch(
        `/api/v1/notifications/recent/${notificationId}/click`,
      );

      return data.notification;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: RECENT_NOTIFICATIONS_QUERY_KEY,
      });
    },
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation<
    NotificationPreferences,
    Error,
    NotificationPreferencesPatch
  >({
    mutationFn: async (patch) => {
      const { data } = await axiosInstance.patch(
        '/api/v1/members/me/preferences',
        patch,
      );

      return data.preferences;
    },
    onSuccess: (preferences) => {
      queryClient.setQueryData(
        NOTIFICATION_PREFERENCES_QUERY_KEY,
        preferences,
      );
    },
  });
}
