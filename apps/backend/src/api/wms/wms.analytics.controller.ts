// apps/backend/src/api/wms/wms.analytics.controller.ts
import { Request, Response } from 'express';
import { withTenant } from '@lasyncro/backend-core/db.js';
import {
  getLiveCapacity,
  getOperatorPerformance,
  getPipelineVelocity,
  getExceptionIntelligence,
  getCostStory,
  getAgingWip,
  getThroughputTrend,
  getExceptionTrend,
  getActivityStream,
  getDisplayZones,
  validateDisplayToken,
  generateDisplayToken,
} from '../../services/wms/wmsAnalytics.service.js';

export const httpGetPickAnalytics = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 30));
    const [live, operators, pipeline, exceptions, cost, agingWip, throughputTrend, exceptionTrend] = await withTenant(shopId, (trx) => Promise.all([
     getLiveCapacity(shopId, trx),
     getOperatorPerformance(shopId, days, trx),
     getPipelineVelocity(shopId, days, trx),
     getExceptionIntelligence(shopId, days, trx),
     getCostStory(shopId, days, trx),
     getAgingWip(shopId, trx),
     getThroughputTrend(shopId, days, trx),
     getExceptionTrend(shopId, days, trx),
   ]));
    return res.json({ live, operators, pipeline, exceptions, cost, aging_wip: agingWip, throughput_trend: throughputTrend, exception_trend: exceptionTrend, days });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_ANALYTICS_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed to fetch analytics: ${message}` });
  }
};

export const httpGetLiveCapacity = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
    // ISS-RLS5: withTenant wraps SET LOCAL in a transaction so the tenant
    // context dies on commit. The previous bare SET persisted on the pooled
    // connection (pool max 5) and leaked into the next request to borrow it.
    // trx must be threaded into every service call — passing `db` here would
    // run the query on a different connection with no tenant context.
    const data = await withTenant(shopId, (trx) => getLiveCapacity(shopId, trx));
    res.set('Cache-Control', 'private, max-age=60');
    return res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_ANALYTICS_LIVE_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};

export const httpGetOperatorPerformance = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
    const days = Math.min(90, Math.max(1, parseInt(req.query.window as string) || 30));
    const data = await withTenant(shopId, (trx) => getOperatorPerformance(shopId, days, trx));
    return res.json({ operators: data, days });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_ANALYTICS_OPERATORS_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};

export const httpGetPipelineVelocity = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
    const days = Math.min(90, Math.max(1, parseInt(req.query.window as string) || 30));
    const data = await withTenant(shopId, (trx) => getPipelineVelocity(shopId, days, trx));
    return res.json({ ...data, days });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_ANALYTICS_PIPELINE_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};

export const httpGetExceptionIntelligence = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
    const days = Math.min(90, Math.max(1, parseInt(req.query.window as string) || 30));
    const data = await withTenant(shopId, (trx) => getExceptionIntelligence(shopId, days, trx));
    return res.json({ ...data, days });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_ANALYTICS_EXCEPTIONS_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};

export const httpGetCostStory = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
    const days = Math.min(90, Math.max(1, parseInt(req.query.window as string) || 30));
    const data = await withTenant(shopId, (trx) => getCostStory(shopId, days, trx));
    return res.json({ ...data, days });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_ANALYTICS_COST_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};

export const httpGetActivityStream = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
    const sinceMs = req.query.since ? Number(req.query.since) : Date.now() - 5000;
    const data = await withTenant(shopId, (trx) => getActivityStream(shopId, sinceMs, trx));
    return res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_ANALYTICS_ACTIVITY_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};

export const httpGetDisplayData = async (req: Request, res: Response) => {
  try {
    const token = req.query.token as string;
    if (!token) return res.status(401).json({ error: 'MISSING_TOKEN' });
    const validated = await validateDisplayToken(token);
    if (!validated) return res.status(401).json({ error: 'INVALID_TOKEN' });
    const { shopId } = validated;
    const [live, pipeline, exceptions, zones] = await withTenant(shopId, (trx) => Promise.all([
     getLiveCapacity(shopId, trx),
     getPipelineVelocity(shopId, 30, trx),
     getExceptionIntelligence(shopId, 30, trx),
     getDisplayZones(shopId, trx),
   ]));
    return res.json({ live, pipeline, exceptions: { top_skus: exceptions.top_skus }, zones });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_DISPLAY_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};

export const httpDisplayHeartbeat = async (req: Request, res: Response) => {
  try {
    const token = req.query.token as string;
    if (!token) return res.status(401).json({ error: 'MISSING_TOKEN' });
    const validated = await validateDisplayToken(token);
    if (!validated) return res.status(401).json({ error: 'INVALID_TOKEN' });
    await withTenant(validated.shopId, (trx) => trx('shop_display_tokens')
     .where('id', validated.tokenId)
     .update({ last_seen_at: new Date() }));
    return res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_DISPLAY_HEARTBEAT_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};

export const httpCreateDisplayToken = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
    const { label } = req.body;
    const { raw, hash } = generateDisplayToken(shopId);
    const [token] = await withTenant(shopId, (trx) => trx('shop_display_tokens')
     .insert({ shop_id: shopId, token_hash: hash, label: label ?? null })
     .returning(['id', 'label', 'created_at']));
    return res.status(201).json({ id: token.id, raw_token: raw, label: token.label, created_at: token.created_at });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_DISPLAY_TOKEN_CREATE_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};

export const httpListDisplayTokens = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
    const sixtySecondsAgo = new Date(Date.now() - 60_000);
    const tokens = await withTenant(shopId, (trx) => trx('shop_display_tokens')
     .where('shop_id', shopId)
     .select('id', 'label', 'created_at', 'rotated_at', 'last_seen_at'));
    return res.json({
      tokens: tokens.map((t: any) => ({
        ...t,
        active: t.last_seen_at ? new Date(t.last_seen_at) >= sixtySecondsAgo : false,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_DISPLAY_TOKEN_LIST_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};

export const httpPatchDisplayToken = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.params;
    const { label } = req.body;
    if (typeof label !== 'string') return res.status(400).json({ error: 'label required' });
    await withTenant(shopId, (trx) => trx('shop_display_tokens').where({ id, shop_id: shopId }).update({ label }));
    return res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_DISPLAY_TOKEN_PATCH_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};

export const httpRotateDisplayToken = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.params;
    const { raw, hash } = generateDisplayToken(shopId);
    const updated = await withTenant(shopId, (trx) => trx('shop_display_tokens')
     .where({ id, shop_id: shopId })
     .update({ token_hash: hash, rotated_at: new Date() })
     .returning(['id', 'label']));
    if (!updated.length) return res.status(404).json({ error: 'TOKEN_NOT_FOUND' });
    return res.json({ id, raw_token: raw, label: updated[0].label });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_DISPLAY_TOKEN_ROTATE_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};

export const httpRevokeDisplayToken = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.params;
    const deleted = await withTenant(shopId, (trx) => trx('shop_display_tokens').where({ id, shop_id: shopId }).delete());
    if (!deleted) return res.status(404).json({ error: 'TOKEN_NOT_FOUND' });
    return res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_DISPLAY_TOKEN_REVOKE_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};