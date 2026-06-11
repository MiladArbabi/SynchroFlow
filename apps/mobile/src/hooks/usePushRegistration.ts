// apps/mobile/src/hooks/usePushRegistration.ts
//
// MOB-PUSH-01 — Expo push token registration
// -------------------------------------------
// Requests notification permission, obtains Expo push token,
// and POSTs it to /api/v1/notifications/subscribe/expo.
// Non-fatal — a failed registration never blocks the operator.
//
// Called once on authenticated mount (AppInner).

import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { apiClient } from '@lasyncro/mobile-core';

export function usePushRegistration(isAuthenticated: boolean): void {
  useEffect(() => {
    if (!isAuthenticated) return;

    void (async () => {
      try {
        // Physical device required for push tokens
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;

        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }

        if (finalStatus !== 'granted') return; // operator declined — silent

        const tokenData = await Notifications.getExpoPushTokenAsync();

        await apiClient.post('/api/v1/notifications/subscribe/expo', {
          token:    tokenData.data,
          platform: Platform.OS,
        });

        // Android requires a notification channel
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name:      'default',
            importance: Notifications.AndroidImportance.MAX,
          });
        }
      } catch {
        // Non-fatal — operator can still work without push
      }
    })();
  }, [isAuthenticated]);
}