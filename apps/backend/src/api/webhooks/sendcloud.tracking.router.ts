// Sendcloud Tracking Webhook — single entrypoint, mirrors
// shopify.webhook.router.ts's shape (verification happens in the
// mounting middleware, this router only adapts + dispatches).
import './sendcloud.tracking.handler.js';

import { Router, Request, Response } from 'express';
import { WebhookRouter } from './webhookRouter.js';
import { SendcloudWebhookAdapter } from './adapters/sendcloud.adapter.js';
import { verifySendcloudTrackingWebhook } from './sendcloud.tracking.verify.middleware.js';

const router = Router();

router.post('/:token', verifySendcloudTrackingWebhook, async (req: Request, res: Response) => {
  try {
    const envelope = SendcloudWebhookAdapter.toEnvelope(req);
    await WebhookRouter.dispatch(envelope);
    return res.status(200).json({ status: 'received' });
  } catch (err: any) {
    console.error('[SENDCLOUD_WEBHOOK_DISPATCH_FAILED]', { error: err?.message });
    return res.status(500).json({ error: 'Dispatch failed' });
  }
});

export default router;