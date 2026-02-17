import { Request, Response } from 'express';
import { WebhookRouter } from './webhookRouter.js';
import db from '@lasyncro/backend-core/db.js';

export async function replayWebhook(
  req: Request,
  res: Response
) {
  const { externalEventId } = req.params;

  const record = await db('integration_webhook_events')
    .where({ external_event_id: externalEventId })
    .first();

  if (!record) {
    return res.status(404).json({ error: 'Webhook not found' });
  }

  // Reconstruct minimal envelope
  await WebhookRouter.dispatch({
    integration: record.integration,
    eventId: record.external_event_id,
    eventType: record.event_type,
    rawPayload: record.payload,
    shopId: record.shop_id ?? undefined,
    verified: true,
    receivedAt: new Date(),
  });

  return res.json({ status: 'replay_triggered' });
}