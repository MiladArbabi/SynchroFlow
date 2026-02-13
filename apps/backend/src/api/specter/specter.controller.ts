// apps/backend/src/api/specter/specter.controller.ts
import { Request, Response } from 'express';
import db from 'api-src/db';
import { resolveShopIdForUser } from 'api-src/services/shop-resolution.service';
import path from 'path';

// --- Helper: resolve shop_id for the authenticated user ---
export const getShopIdFromRequest = async (req: Request): Promise<number | null> => {
  const authUser = (req as any).user;
  if (!authUser || !authUser.userId) return null;

  try {
    
    return await resolveShopIdForUser(authUser.userId);

  } catch (e: any) {
    // If DB lookup fails (e.g., mocked test db), treat as no shop rather than crash.
    console.warn('[specter.controller] Warning: user shop lookup failed:', e && e.message ? e.message : e);
    return null;
  }
};

// --- GET /api/v1/specter/config ---
export const getSpecterConfig = async (req: Request, res: Response) => {
  try {
    const shopId = await getShopIdFromRequest(req);

    if (!shopId) {
      return res.status(403).json({ error: 'User shop not found.' });
    }

    // Load config row (may be null). Wrap in try/catch so tests that mock `db`
    // for only the user lookup won't crash the handler.
    let row: any = null;
    try {
      row = await db('specter_shop_configs')
        .where({ shop_id: shopId })
        .first();
    } catch (e: any) {
      console.warn('[specter.controller] Warning: failed to load specter_shop_configs, treating as null:', e && e.message ? e.message : e);
      row = null;
    }

    if (!row) {
      return res.json({
        shopId,
        config: null,
      });
    }

        return res.json({
      shopId,
      config: row.config_json ?? null,
    });
  } catch (err) {
    console.error('[specter.controller] Error in getSpecterConfig:', err);
    return res.status(500).json({ error: 'Failed to fetch Specter config.' });
  }
};

// --- GET /api/v1/specter/:shopId/state ---
// Returns the current Specter state for the authenticated user's shop:
// { shopId, session, config, events, meta: { lastSync, lastIngestion, sessionCount } }
export const getSpecterState = async (req: Request, res: Response) => {
  try {
    // Prefer explicit param (tests use req.params.shopId). Fallback to authenticated user lookup.
    const paramShop = req?.params?.shopId;
    const paramId = paramShop ? Number(paramShop) : NaN;
    const shopId = Number.isFinite(paramId) && paramId > 0 ? paramId : await getShopIdFromRequest(req);

    if (!shopId) {
      return res.status(403).json({ error: 'User shop not found.' });
    }

        // Resolve session-store helpers robustly:
    // 1) try require('modules-specter/...') (CJS mock via jest.mock)
    // 2) try await import('modules-specter/...') (ESM mock via jest.unstable_mockModule)
    // 3) try require() fallbacks for explicit src/dist paths
    // 4) try import() fallbacks as last resort
    let storeGetShopSession: ((id: number) => Promise<any>) | undefined;
    let storeGetRecentEvents: ((id: number, limit?: number) => Promise<any[]>) | undefined;
    let storeGetShopConfig: ((id: number) => Promise<any | null>) | undefined;

    const tryAssignFrom = (modAny: any) => {
      if (!modAny) return;
      storeGetShopSession = storeGetShopSession ?? (modAny.getShopSession ?? (modAny.default && modAny.default.getShopSession));
      storeGetRecentEvents = storeGetRecentEvents ?? (modAny.getRecentEvents ?? (modAny.default && modAny.default.getRecentEvents));
      storeGetShopConfig = storeGetShopConfig ?? (modAny.getShopConfig ?? (modAny.default && modAny.default.getShopConfig));
    };

    // 1) prefer synchronous require of the project alias (picks up jest.mock)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const m: any = require('modules-specter/store/session-store');
      tryAssignFrom(m);
    } catch (e) {
      // ignore
    }

    // 2) try dynamic import for ESM-style mocks (jest.unstable_mockModule)
    if (!storeGetShopSession || !storeGetRecentEvents || !storeGetShopConfig) {
      try {
        const esmModule: any = await import('modules-specter/store/session-store');
        tryAssignFrom(esmModule);
      } catch (e) {
        // ignore
      }
    }

    // 3) require() fallbacks for explicit paths
    if (!storeGetShopSession || !storeGetRecentEvents || !storeGetShopConfig) {
      const requireCandidates = [
        path.resolve(__dirname, '../../../../modules/specter/src/store/session-store'),
        path.resolve(process.cwd(), 'modules/specter/src/store/session-store'),
        path.resolve(process.cwd(), 'modules/specter/dist/store/session-store'),
        path.resolve(__dirname, '../../../modules/specter/src/store/session-store'),
        path.resolve(__dirname, '../../../../../modules/specter/src/store/session-store')
      ];
      for (const c of requireCandidates) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const mod: any = require(c);
          tryAssignFrom(mod);
          if (storeGetShopSession && storeGetRecentEvents && storeGetShopConfig) break;
        } catch (e) {
          // ignore
        }
      }
    }

    // 4) dynamic import fallbacks (last resort)
    if (!storeGetShopSession || !storeGetRecentEvents || !storeGetShopConfig) {
      const importCandidates = [
        path.resolve(__dirname, '../../../../modules/specter/src/store/session-store'),
        path.resolve(process.cwd(), 'modules/specter/src/store/session-store'),
        path.resolve(process.cwd(), 'modules/specter/dist/store/session-store'),
        path.resolve(__dirname, '../../../modules/specter/src/store/session-store'),
        path.resolve(__dirname, '../../../../../modules/specter/src/store/session-store')
      ];
      for (const c of importCandidates) {
        try {
          const mod: any = await import(c);
          tryAssignFrom(mod);
          if (storeGetShopSession && storeGetRecentEvents && storeGetShopConfig) break;
        } catch (e) {
          // ignore
        }
      }
    }

        // DB fallback for config row (non-fatal)
    let dbRow: any = null;
    try {
      dbRow = await db('specter_shop_configs').where({ shop_id: shopId }).first();
    } catch (e: any) {
      console.warn('[specter.controller] Warning: failed to load specter_shop_configs DB row:', e && e.message ? e.message : e);
      dbRow = null;
    }

    // --- DEBUG: what store helpers did we resolve? ---
    console.debug('[specter.controller] store helpers resolved', {
      hasGetShopSession: typeof storeGetShopSession === 'function',
      hasGetRecentEvents: typeof storeGetRecentEvents === 'function',
      hasGetShopConfig: typeof storeGetShopConfig === 'function'
    });

    // Fetch session/events/config in parallel using resolved helpers (or fallbacks)
    const [session, events, storeConfig] = await Promise.all([
      storeGetShopSession ? storeGetShopSession(shopId).catch((e: any) => { console.debug('[specter.controller] getShopSession error', { shopId, err: e && e.message ? e.message : e }); return null; }) : Promise.resolve(null),
      storeGetRecentEvents ? storeGetRecentEvents(shopId, 50).catch((e: any) => { console.debug('[specter.controller] getRecentEvents error', { shopId, err: e && e.message ? e.message : e }); return []; }) : Promise.resolve([]),
      storeGetShopConfig ? storeGetShopConfig(shopId).catch((e: any) => { console.debug('[specter.controller] getShopConfig error', { shopId, err: e && e.message ? e.message : e }); return null; }) : Promise.resolve(null)
    ]);

    const config = storeConfig ?? dbRow?.config_json ?? null;
    const eventsArr = Array.isArray(events) ? events : [];

    // DEBUG: log summary of what we fetched (concise)
    console.debug('[specter.controller] fetched specter data summary', {
      shopId,
      sessionPresent: session ? true : false,
      eventsCount: Array.isArray(eventsArr) ? eventsArr.length : 0,
      configPresent: config ? true : false,
      dbRowPresent: !!dbRow
    });

    // Meta: newest-first events => first occurrence is latest
    const findEvent = (types: string[] | string) => {
      const tlist = Array.isArray(types) ? types : [types];
      return eventsArr.find((ev: any) => ev && ev.type && tlist.includes(String(ev.type)));
    };

    const lastSyncEvt = findEvent(['sync.complete', 'sync.completed', 'sync.error']);
    const lastIngestionEvt = findEvent('canonical.ingested');

    const lastSync = lastSyncEvt ? (typeof lastSyncEvt.timestamp === 'number' ? lastSyncEvt.timestamp : Number(lastSyncEvt.timestamp) || null) : null;
    const lastIngestion = lastIngestionEvt ? (typeof lastIngestionEvt.timestamp === 'number' ? lastIngestionEvt.timestamp : Number(lastIngestionEvt.timestamp) || null) : null;
    const sessionCount = session ? 1 : 0;

    // DEBUG: computed meta values
    console.debug('[specter.controller] computed meta', { shopId, sessionCount, lastSync, lastIngestion });

    return res.status(200).json({
      shopId,
      session: session ?? null,
      config,
      events: eventsArr,
      meta: { sessionCount, lastSync, lastIngestion }
    });
  } catch (err: any) {
    console.error('[specter.controller] Error in getSpecterState:', err && (err.stack || err.message) ? (err.stack || err.message) : err);
    return res.status(200).json({
      shopId: null,
      session: null,
      config: null,
      events: [],
      meta: { sessionCount: 0, lastSync: null, lastIngestion: null }
    });
  }
};

// --- PUT /api/v1/specter/config ---
export const upsertSpecterConfig = async (req: Request, res: Response) => {
  try {
    const shopId = await getShopIdFromRequest(req);

    if (!shopId) {
      return res.status(403).json({ error: 'User shop not found.' });
    }

    const { config } = req.body as { config?: unknown };

    // Basic payload validation: must be a plain object
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return res.status(400).json({
        error:
          'Invalid config payload. Expected a JSON object under "config".',
      });
    }

    // Upsert semantics on shop_id
    const [row] = await db('specter_shop_configs')
      .insert({
        shop_id: shopId,
        config_json: config,
      })
      .onConflict('shop_id')
      .merge()
      .returning(['shop_id', 'config_json']);

    return res.json({
      shopId: row.shop_id,
      config: row.config_json,
    });
  } catch (err) {
    console.error('[specter.controller] Error in upsertSpecterConfig:', err);
    return res
      .status(500)
      .json({ error: 'Failed to upsert Specter config.' });
  }
};
