// apps/backend/src/api/notifications/notifications.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

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