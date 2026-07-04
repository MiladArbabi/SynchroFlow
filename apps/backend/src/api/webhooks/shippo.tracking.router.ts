import './shippo.tracking.handler.js';

import { Router, Request, Response } from 'express';
import { WebhookRouter } from './webhookRouter.js';
import { ShippoWebhookAdapter } from './adapters/shippo.adapter.js';
import { verifyShippoTrackingWebhook } from './shippo.tracking.verify.middleware.js';

const router = Router();

router.post('/', verifyShippoTrackingWebhook, async (req: Request, res: Response) => {
  try {
    const envelope = ShippoWebhookAdapter.toEnvelope(req);
    await WebhookRouter.dispatch(envelope);
    return res.status(200).json({ status: 'received' });
  } catch (err: any) {
    console.error('[SHIPPO_WEBHOOK_DISPATCH_FAILED]', { error: err?.message });
    return res.status(500).json({ error: 'Dispatch failed' });
  }
});

export default router;