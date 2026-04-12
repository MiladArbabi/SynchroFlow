// apps/backend/src/services/notifications/notificationDispatch.service.ts
import webpush from 'web-push';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import db from '@lasyncro/backend-core/db.js';

/**
 * NOTIFICATION DISPATCH SERVICE (WM-22)
 * --------------------------------------
 * Single entry point for all push notifications across surfaces:
 * - Web Push (PWA desktop + mobile browser)
 * - Expo Push (React Native iOS + Android via APNs/FCM)
 *
 * Targeting logic:
 * - targetUserIds provided → notify those users only
 * - targetUserIds empty + role provided → broadcast to all users with that role in shop
 *
 * Failure contract:
 * - Per-subscription failures are logged and skipped — never throw
 * - Expired/invalid web push subscriptions (410) are deleted automatically
 * - Invalid Expo tokens are logged — cleanup to be handled by maintenance job
 *
 * VAPID keys must be set in environment:
 * - VAPID_PUBLIC_KEY
 * - VAPID_PRIVATE_KEY
 * - VAPID_MAILTO
 */

const expo = new Expo();

let vapidInitialised = false;

function ensureVapid(): void {
  if (vapidInitialised) return;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_MAILTO } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_MAILTO) {
    throw new Error('[NOTIFICATION_DISPATCH] VAPID keys not configured');
  }
  webpush.setVapidDetails(VAPID_MAILTO, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  vapidInitialised = true;
}

export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface DispatchParams {
  shopId: number;
  payload: NotificationPayload;
  /** Specific user IDs to notify. If empty, falls back to role broadcast. */
  targetUserIds?: number[];
  /** Role to broadcast to when no targetUserIds provided. */
  broadcastToRole?: 'owner' | 'admin' | 'operator';
}

export async function dispatchNotification(params: DispatchParams): Promise<void> {
  const { shopId, payload, targetUserIds, broadcastToRole } = params;

  // 1. Resolve target subscriptions
  let query = db('push_subscriptions as ps')
    .where('ps.shop_id', shopId)
    .select('ps.id', 'ps.user_id', 'ps.device_type', 'ps.endpoint', 'ps.p256dh', 'ps.auth', 'ps.expo_push_token');

  if (targetUserIds && targetUserIds.length > 0) {
    query = query.whereIn('ps.user_id', targetUserIds);
  } else if (broadcastToRole) {
    query = query
      .join('shop_memberships as sm', (join) => {
        join
          .on('sm.user_id', 'ps.user_id')
          .andOn('sm.shop_id', 'ps.shop_id');
      })
      .where('sm.role', broadcastToRole);
  } else {
    console.warn('[NOTIFICATION_DISPATCH] No target specified — skipping', { shopId });
    return;
  }

  const subscriptions = await query;

  if (subscriptions.length === 0) {
    console.info('[NOTIFICATION_DISPATCH] No subscriptions found', { shopId, targetUserIds, broadcastToRole });
    return;
  }

  // 2. Fan out to all subscriptions
  const webSubs = subscriptions.filter((s: any) => s.device_type === 'web');
  const expoSubs = subscriptions.filter((s: any) => s.device_type === 'expo');

  // ── Web Push ──────────────────────────────────────────────
  if (webSubs.length > 0) {
    try {
      ensureVapid();
    } catch (err) {
      console.error('[NOTIFICATION_DISPATCH] VAPID not configured — skipping web push', (err as Error).message);
    }

    for (const sub of webSubs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: payload.title, body: payload.body, data: payload.data ?? {} })
        );
        console.info('[WEB_PUSH_SENT]', { subscriptionId: sub.id, userId: sub.user_id });
      } catch (err: any) {
        if (err.statusCode === 410) {
          // Subscription expired — remove
          await db('push_subscriptions').where({ id: sub.id }).delete();
          console.info('[WEB_PUSH_EXPIRED_REMOVED]', { subscriptionId: sub.id });
        } else {
          console.error('[WEB_PUSH_FAILED]', { subscriptionId: sub.id, error: err.message });
        }
      }
    }
  }

  // ── Expo Push ─────────────────────────────────────────────
  if (expoSubs.length > 0) {
    const messages: ExpoPushMessage[] = expoSubs
      .filter((s: any) => Expo.isExpoPushToken(s.expo_push_token))
      .map((s: any) => ({
        to: s.expo_push_token,
        title: payload.title,
        body: payload.body,
        data: payload.data ?? {},
        sound: 'default',
      }));

    if (messages.length === 0) {
      console.warn('[NOTIFICATION_DISPATCH] No valid Expo tokens', { shopId });
    } else {
      const chunks = expo.chunkPushNotifications(messages);
      for (const chunk of chunks) {
        try {
          const receipts = await expo.sendPushNotificationsAsync(chunk);
          receipts.forEach((receipt, i) => {
            if (receipt.status === 'error') {
              console.error('[EXPO_PUSH_FAILED]', {
                token: messages[i]?.to,
                error: receipt.message,
                details: receipt.details,
              });
            }
          });
        } catch (err) {
          console.error('[EXPO_PUSH_CHUNK_FAILED]', { error: (err as Error).message });
        }
      }
    }
  }

  console.info('[NOTIFICATION_DISPATCH_COMPLETE]', {
    shopId,
    webCount: webSubs.length,
    expoCount: expoSubs.length,
  });
}