// apps/backend/src/api/wms/wms.analytics.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
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
    await db.raw(`SET "app.current_tenant" = '${shopId}'`);
    const [live, operators, pipeline, exceptions, cost, agingWip, throughputTrend, exceptionTrend] = await Promise.all([
      getLiveCapacity(shopId, db),
      getOperatorPerformance(shopId, days, db),
      getPipelineVelocity(shopId, days, db),
      getExceptionIntelligence(shopId, days, db),
      getCostStory(shopId, days, db),
      getAgingWip(shopId, db),
      getThroughputTrend(shopId, days, db),
      getExceptionTrend(shopId, days, db),
    ]);
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
    await db.raw(`SET "app.current_tenant" = '${shopId}'`);
    const data = await getLiveCapacity(shopId, db);
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
    await db.raw(`SET "app.current_tenant" = '${shopId}'`);
    const data = await getOperatorPerformance(shopId, days, db);
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
    await db.raw(`SET "app.current_tenant" = '${shopId}'`);
    const data = await getPipelineVelocity(shopId, days, db);
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
    await db.raw(`SET "app.current_tenant" = '${shopId}'`);
    const data = await getExceptionIntelligence(shopId, days, db);
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
    await db.raw(`SET "app.current_tenant" = '${shopId}'`);
    const data = await getCostStory(shopId, days, db);
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
    await db.raw(`SET "app.current_tenant" = '${shopId}'`);
    const data = await getActivityStream(shopId, sinceMs, db);
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
    const validated = await validateDisplayToken(token, db);
    if (!validated) return res.status(401).json({ error: 'INVALID_TOKEN' });
    const { shopId } = validated;
    await db.raw(`SET "app.current_tenant" = '${shopId}'`);
    const [live, pipeline, exceptions, zones] = await Promise.all([
      getLiveCapacity(shopId, db),
      getPipelineVelocity(shopId, 30, db),
      getExceptionIntelligence(shopId, 30, db),
      getDisplayZones(shopId, db),
    ]);
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
    const validated = await validateDisplayToken(token, db);
    if (!validated) return res.status(401).json({ error: 'INVALID_TOKEN' });
    await db('shop_display_tokens').where('id', validated.tokenId).update({ last_seen_at: new Date() });
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
    await db.raw(`SET "app.current_tenant" = '${shopId}'`);
    const { raw, hash } = generateDisplayToken(shopId);
    const [token] = await db('shop_display_tokens')
      .insert({ shop_id: shopId, token_hash: hash, label: label ?? null })
      .returning(['id', 'label', 'created_at']);
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
    await db.raw(`SET "app.current_tenant" = '${shopId}'`);
    const sixtySecondsAgo = new Date(Date.now() - 60_000);
    const tokens = await db('shop_display_tokens')
      .where('shop_id', shopId)
      .select('id', 'label', 'created_at', 'rotated_at', 'last_seen_at');
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
    await db.raw(`SET "app.current_tenant" = '${shopId}'`);
    await db('shop_display_tokens').where({ id, shop_id: shopId }).update({ label });
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
    await db.raw(`SET "app.current_tenant" = '${shopId}'`);
    const { raw, hash } = generateDisplayToken(shopId);
    const updated = await db('shop_display_tokens')
      .where({ id, shop_id: shopId })
      .update({ token_hash: hash, rotated_at: new Date() })
      .returning(['id', 'label']);
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
    await db.raw(`SET "app.current_tenant" = '${shopId}'`);
    const deleted = await db('shop_display_tokens').where({ id, shop_id: shopId }).delete();
    if (!deleted) return res.status(404).json({ error: 'TOKEN_NOT_FOUND' });
    return res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_DISPLAY_TOKEN_REVOKE_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};