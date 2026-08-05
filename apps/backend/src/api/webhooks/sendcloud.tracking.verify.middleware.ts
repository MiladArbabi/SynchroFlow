// WM-40 — Sendcloud Tracking Webhook Verification
//
// Resolves the target shop from an opaque URL token (mirrors
// shop_display_tokens: hash-only storage, raw shown once), then
// verifies the HMAC-SHA256 signature over the raw request body using
// that shop's own webhook_secret (each merchant has their own
// Sendcloud account and configures this secret themselves).
//
// Token resolution is necessarily cross-tenant — shop_id is unknown
// until the token is looked up. shop_carrier_webhook_tokens uses the
// split-policy pattern for exactly this reason (RLS_blueprint.md §4).
// No FOR UPDATE — plain SELECT only (see RLS_blueprint.md §7,
// "FOR UPDATE silently returns zero rows under cross-tenant split
// policies").

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { resolveCarrierWebhookToken } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { decrypt } from '../../security/encryption.service.js';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function verifySendcloudTrackingWebhook(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const rawTokenParam = req.params.token;
    const rawToken = Array.isArray(rawTokenParam) ? rawTokenParam[0] : rawTokenParam;
    if (!rawToken) {
      return res.status(400).json({ error: 'Missing webhook token' });
    }

    const tokenHash = hashToken(rawToken);

    // Cross-tenant lookup — no tenant context set yet
    const tokenRow = await resolveCarrierWebhookToken(tokenHash, 'sendcloud');

    if (!tokenRow) {
      return res.status(404).json({ error: 'Unknown webhook token' });
    }

    const shopId = tokenRow.shop_id;
    const settings = await withTenant(shopId, (trx) =>
      trx('shop_carrier_settings')
        .where({ shop_id: shopId, carrier_code: 'sendcloud', is_active: true })
        .first()
    );

    if (!settings?.webhook_secret) {
      console.error('[SENDCLOUD_WEBHOOK_NO_SECRET]', { shopId });
      return res.status(500).json({ error: 'Webhook secret not configured for this shop' });
    }

    const secret = decrypt(settings.webhook_secret, 'wms.carrier.sendcloud.webhook');

    const rawSignature = req.headers['sendcloud-signature'];
    const signature = Array.isArray(rawSignature) ? rawSignature[0] : rawSignature;

    if (!signature) {
      return res.status(400).json({ error: 'Missing Sendcloud-Signature header' });
    }

    const rawBody = (req as any).rawBody;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      return res.status(400).json({ error: 'Missing raw request body' });
    }

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const sig = Buffer.from(signature.trim(), 'utf8');
    const exp = Buffer.from(expected, 'utf8');

    if (sig.length !== exp.length || !crypto.timingSafeEqual(sig, exp)) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    // Attach for the adapter — avoids re-deriving shopId downstream
    (req as any).resolvedShopId = shopId;

    // Non-blocking heartbeat — mirrors display token last_seen_at pattern
    withTenant(shopId, (trx) =>
      trx('shop_carrier_webhook_tokens')
        .where({ id: tokenRow.id, shop_id: shopId })
        .update({ last_seen_at: new Date() })
    )
      .catch((err: any) => console.error('[SENDCLOUD_WEBHOOK_HEARTBEAT_FAILED]', err?.message));

    return next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[SENDCLOUD_WEBHOOK_VERIFY_FAILED]', { error: message });
    return res.status(500).json({ error: 'Webhook verification failed' });
  }
}
