// WM-40 — Carrier webhook token CRUD.
// Mirrors shop_display_tokens' controller pattern exactly (hash-only
// storage, raw token returned once at creation/rotation, revocable).
import { Request, Response } from 'express';
import crypto from 'crypto';
import db from '@lasyncro/backend-core/db.js';
import { encrypt } from '../../security/encryption.service.js';

function generateWebhookToken(shopId: number): { raw: string; hash: string } {
  const raw = `${shopId}_${crypto.randomBytes(32).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

export const httpCreateCarrierWebhookToken = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
    const { carrier_code } = req.body;
    if (!carrier_code) return res.status(400).json({ error: 'carrier_code required' });

    await db.raw(`SET "app.current_tenant" = '${shopId}'`);
    const { raw, hash } = generateWebhookToken(shopId);

    const [token] = await db('shop_carrier_webhook_tokens')
      .insert({ shop_id: shopId, carrier_code, token_hash: hash })
      .onConflict(['shop_id', 'carrier_code'])
      .merge({ token_hash: hash, rotated_at: new Date() })
      .returning(['id', 'carrier_code', 'created_at']);

    return res.status(201).json({
      id: token.id,
      carrier_code: token.carrier_code,
      raw_token: raw,
      created_at: token.created_at,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[CARRIER_WEBHOOK_TOKEN_CREATE_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};

export const httpGetCarrierWebhookToken = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
    const { carrier_code } = req.query;

    await db.raw(`SET "app.current_tenant" = '${shopId}'`);
    const token = await db('shop_carrier_webhook_tokens')
      .where({ shop_id: shopId, carrier_code: carrier_code ?? 'sendcloud' })
      .select('id', 'carrier_code', 'created_at', 'rotated_at', 'last_seen_at')
      .first();

    return res.json({ token: token ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[CARRIER_WEBHOOK_TOKEN_GET_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};

export const httpRotateCarrierWebhookToken = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.params;

    await db.raw(`SET "app.current_tenant" = '${shopId}'`);
    const { raw, hash } = generateWebhookToken(shopId);

    const updated = await db('shop_carrier_webhook_tokens')
      .where({ id, shop_id: shopId })
      .update({ token_hash: hash, rotated_at: new Date() })
      .returning(['id', 'carrier_code']);

    if (!updated.length) return res.status(404).json({ error: 'TOKEN_NOT_FOUND' });
    return res.json({ id, raw_token: raw, carrier_code: updated[0].carrier_code });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[CARRIER_WEBHOOK_TOKEN_ROTATE_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};

export const httpRevokeCarrierWebhookToken = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.params;

    await db.raw(`SET "app.current_tenant" = '${shopId}'`);
    const deleted = await db('shop_carrier_webhook_tokens').where({ id, shop_id: shopId }).delete();
    if (!deleted) return res.status(404).json({ error: 'TOKEN_NOT_FOUND' });
    return res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[CARRIER_WEBHOOK_TOKEN_REVOKE_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};

export const httpSetCarrierWebhookSecret = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
    const { carrierCode } = req.params;
    const { webhook_secret } = req.body;

    if (!webhook_secret || typeof webhook_secret !== 'string' || !webhook_secret.trim()) {
      return res.status(400).json({ error: 'webhook_secret required' });
    }

    await db.raw(`SET "app.current_tenant" = '${shopId}'`);

    const encrypted = encrypt(webhook_secret.trim());

    const updated = await db('shop_carrier_settings')
      .where({ shop_id: shopId, carrier_code: carrierCode })
      .update({ webhook_secret: encrypted, updated_at: new Date() });

    if (!updated) {
      return res.status(404).json({ error: 'CARRIER_NOT_CONNECTED' });
    }

    return res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[CARRIER_WEBHOOK_SECRET_SET_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};