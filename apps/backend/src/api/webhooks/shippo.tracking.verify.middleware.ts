// WM-40 (Shippo) — Tracking webhook verification.
//
// Different from Sendcloud's path-segment token + HMAC scheme:
// Shippo's own webhook security docs describe a simpler self-generated
// token model — embed a token as a URL query parameter when registering
// the webhook, Shippo echoes it back on every call. No HMAC secret to
// provision or store; the token match IS the authentication.
//
// Shop resolution is still cross-tenant (token → shop_id unknown until
// looked up) — same split-policy table (shop_carrier_webhook_tokens),
// same no-FOR-UPDATE discipline as the Sendcloud middleware.

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import db from '@lasyncro/backend-core/db.js';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function verifyShippoTrackingWebhook(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const rawTokenParam = req.query.token;
    const rawToken = Array.isArray(rawTokenParam) ? rawTokenParam[0] : rawTokenParam;

    if (!rawToken || typeof rawToken !== 'string') {
      return res.status(400).json({ error: 'Missing webhook token' });
    }

    const tokenHash = hashToken(rawToken);

    const tokenRow = await db('shop_carrier_webhook_tokens')
      .where({ token_hash: tokenHash, carrier_code: 'shippo' })
      .first();

    if (!tokenRow) {
      return res.status(404).json({ error: 'Unknown webhook token' });
    }

    const shopId = tokenRow.shop_id;
    await db.raw(`SET app.current_tenant = '${shopId}'`);

    (req as any).resolvedShopId = shopId;

    db('shop_carrier_webhook_tokens')
      .where({ id: tokenRow.id })
      .update({ last_seen_at: new Date() })
      .catch((err: any) => console.error('[SHIPPO_WEBHOOK_HEARTBEAT_FAILED]', err?.message));

    return next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[SHIPPO_WEBHOOK_VERIFY_FAILED]', { error: message });
    return res.status(500).json({ error: 'Webhook verification failed' });
  }
}