// apps/backend/src/api/notifications/notifications.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import { listNotificationConditions } from '../../services/notifications/notificationConditionRegistry.js';
import {
  listRecentNotifications,
  markNotificationClicked,
  markNotificationRead,
  NotificationHistoryInputError,
  parseNotificationId,
  parseRecentLimit,
} from './notificationHistory.service.js';

/**
 * PUSH SUBSCRIPTION CONTROLLER (WM-22)
 * --------------------------------------
 * Upserts push subscriptions for Web Push and Expo.
 *
 * Web Push subscription shape (from browser PushManager.subscribe()):
 *   { endpoint, keys: { p256dh, auth } }
 *
 * Expo subscription shape (from Expo.Notifications.getExpoPushTokenAsync()):
 *   { expo_push_token }
 *
 * Upsert strategy:
 * - Web: unique on (user_id, endpoint)
 * - Expo: unique on (user_id, expo_push_token)
 * - updated_at refreshed on conflict — keeps token alive
 */

export async function subscribeWeb(req: Request, res: Response) {
  const userId = req.user?.userId;
  const shopId = req.user?.shopId;
  if (!userId || !shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'endpoint, keys.p256dh and keys.auth are required' });
  }

  await db('push_subscriptions')
    .insert({
      shop_id: shopId,
      user_id: userId,
      device_type: 'web',
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    })
    .onConflict(['user_id', 'endpoint'])
    .merge({ p256dh: keys.p256dh, auth: keys.auth, updated_at: db.fn.now() });

  console.info('[PUSH_SUBSCRIBE_WEB]', { userId, shopId });
  return res.status(201).json({ ok: true });
}

export async function subscribeExpo(req: Request, res: Response) {
  const userId = req.user?.userId;
  const shopId = req.user?.shopId;
  if (!userId || !shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { expo_push_token } = req.body;
  if (!expo_push_token) {
    return res.status(400).json({ error: 'expo_push_token is required' });
  }

  await db('push_subscriptions')
    .insert({
      shop_id: shopId,
      user_id: userId,
      device_type: 'expo',
      expo_push_token,
    })
    .onConflict(['user_id', 'expo_push_token'])
    .merge({ updated_at: db.fn.now() });

  console.info('[PUSH_SUBSCRIBE_EXPO]', { userId, shopId });
  return res.status(201).json({ ok: true });
}

export async function unsubscribe(req: Request, res: Response) {
  const userId = req.user?.userId;
  const shopId = req.user?.shopId;
  if (!userId || !shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { endpoint, expo_push_token } = req.body;
  if (!endpoint && !expo_push_token) {
    return res.status(400).json({ error: 'endpoint or expo_push_token is required' });
  }

  const query = db('push_subscriptions').where({ shop_id: shopId, user_id: userId });
  if (endpoint) query.andWhere({ endpoint });
  if (expo_push_token) query.andWhere({ expo_push_token });
  await query.delete();

  console.info('[PUSH_UNSUBSCRIBE]', { userId, shopId });
  return res.status(204).send();
}

export async function getPushStatus(req: Request, res: Response) {
  const userId = req.user?.userId;
  const shopId = req.user?.shopId;
  if (!userId || !shopId) return res.status(401).json({ error: 'Unauthorized' });

  const [webCountRow, expoCountRow] = await Promise.all([
    db('push_subscriptions')
      .where({ shop_id: shopId, user_id: userId, device_type: 'web' })
      .whereNotNull('endpoint')
      .whereNotNull('p256dh')
      .whereNotNull('auth')
      .whereRaw("btrim(endpoint) <> ''")
      .whereRaw("btrim(p256dh) <> ''")
      .whereRaw("btrim(auth) <> ''")
      .count<{ count: string }[]>({ count: '*' })
      .first(),
    db('push_subscriptions')
      .where({ shop_id: shopId, user_id: userId, device_type: 'expo' })
      .whereNotNull('expo_push_token')
      .whereRaw("btrim(expo_push_token) <> ''")
      .count<{ count: string }[]>({ count: '*' })
      .first(),
  ]);

  const webCount = Number(webCountRow?.count ?? 0);
  const expoCount = Number(expoCountRow?.count ?? 0);
  const registeredDestinationCount = webCount + expoCount;

  return res.json({
    registered_destination_count: registeredDestinationCount,
    has_registered_destination: registeredDestinationCount > 0,
    web_count: webCount,
    expo_count: expoCount,
  });
}

export function getNotificationConditions(
  _req: Request,
  res: Response,
) {
  return res.json({
    conditions: listNotificationConditions(),
  });
}

export async function getRecentNotifications(req: Request, res: Response) {
  const userId = req.user?.userId;
  const shopId = req.user?.shopId;
  if (!userId || !shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const limit = parseRecentLimit(req.query.limit);
    const result = await listRecentNotifications({ shopId, userId, limit });
    return res.json(result);
  } catch (err) {
    if (err instanceof NotificationHistoryInputError) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[NOTIFICATIONS] getRecentNotifications failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function markRecentNotificationRead(req: Request, res: Response) {
  const userId = req.user?.userId;
  const shopId = req.user?.shopId;
  if (!userId || !shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const notification = await markNotificationRead({
      shopId,
      userId,
      notificationId: parseNotificationId(req.params.notificationId),
    });

    if (!notification) return res.status(404).json({ error: 'NOTIFICATION_NOT_FOUND' });

    return res.json({ notification });
  } catch (err) {
    if (err instanceof NotificationHistoryInputError) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[NOTIFICATIONS] markRecentNotificationRead failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function markRecentNotificationClicked(req: Request, res: Response) {
  const userId = req.user?.userId;
  const shopId = req.user?.shopId;
  if (!userId || !shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const notification = await markNotificationClicked({
      shopId,
      userId,
      notificationId: parseNotificationId(req.params.notificationId),
    });

    if (!notification) return res.status(404).json({ error: 'NOTIFICATION_NOT_FOUND' });

    return res.json({ notification });
  } catch (err) {
    if (err instanceof NotificationHistoryInputError) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[NOTIFICATIONS] markRecentNotificationClicked failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
