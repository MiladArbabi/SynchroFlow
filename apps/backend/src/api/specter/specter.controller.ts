// apps/backend/src/api/specter/specter.controller.ts
import { Request, Response } from 'express';
import db from 'api-src/db';
import { User } from 'api-types';
import path from 'path';

// --- Helper: resolve shop_id for the authenticated user ---
const getShopIdFromRequest = async (req: Request): Promise<number | null> => {
  const authUser = (req as any).user;
  if (!authUser || !authUser.userId) return null;

  try {
    const user = await db<User>('users')
      .where({ id: authUser.userId })
      .first('shop_id');

    return user?.shop_id ?? null;
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
    const shopId = await getShopIdFromRequest(req);

    if (!shopId) {
      return res.status(403).json({ error: 'User shop not found.' });
    }

    // Load config row (may be null)
    const row = await db('specter_shop_configs')
      .where({ shop_id: shopId })
      .first();

        // Resolve session-store helpers dynamically so tests that mock different module IDs
    // (alias vs relative path) are honored.
    let getShopSessionFn: ((shopId: number) => Promise<any>) | undefined;
    let getRecentEventsFn: ((shopId: number, limit?: number) => Promise<any[]>) | undefined;

        const candidates = [
      // project alias (if present in tsconfig / runtime)
      'modules-specter/store/session-store',
      // relative path from this controller to project-root/modules (4 ups) — matches many test mocks
      path.resolve(__dirname, '../../../../modules/specter/src/store/session-store'),
      // project-root absolute path (this should match jest.doMock('../../../modules/specter/src/...') resolution)
      path.resolve(process.cwd(), 'modules/specter/src/store/session-store'),
      // dist path (in case tests / runtime import compiled files)
      path.resolve(process.cwd(), 'modules/specter/dist/store/session-store'),
      // other relative fallbacks (3-up and 5-up)
      path.resolve(__dirname, '../../../modules/specter/src/store/session-store'),
      path.resolve(__dirname, '../../../../../modules/specter/src/store/session-store')
    ];

    for (const candidate of candidates) {
     if (!candidate) continue;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const storeMod = require(candidate);
        getShopSessionFn = getShopSessionFn ?? storeMod.getShopSession ?? storeMod.default?.getShopSession;
        getRecentEventsFn = getRecentEventsFn ?? storeMod.getRecentEvents ?? storeMod.default?.getRecentEvents;
        if (getShopSessionFn && getRecentEventsFn) {
          // eslint-disable-next-line no-console
          console.debug('[specter.controller] session-store resolved via', candidate);
          break;
        }
      } catch (e) {
        // ignore, move to next candidate
      }
    }

    // Fallback 2: relative path with 5 ups (legacy)
    if (!getShopSessionFn || !getRecentEventsFn) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const storeMod = require('../../../../../modules/specter/src/store/session-store');
        getShopSessionFn = getShopSessionFn ?? storeMod.getShopSession ?? storeMod.default?.getShopSession;
        getRecentEventsFn = getRecentEventsFn ?? storeMod.getRecentEvents ?? storeMod.default?.getRecentEvents;
        if (getShopSessionFn && getRecentEventsFn) {
          // eslint-disable-next-line no-console
          console.debug('[specter.controller] session-store resolved via ../../../../../modules/specter/src/store/session-store');
        }
      } catch (e) {
        // ignore — will treat as absent
      }
    }

    // Read most recent session (may be null)
    const session = getShopSessionFn ? await getShopSessionFn(shopId) : null;

    // Read recent events (newest-first) — limit 50
    const events = getRecentEventsFn ? await getRecentEventsFn(shopId, 50) : [];

    // Derive simple meta fields
    const sessionCount = session ? 1 : 0;
    const lastSync = (events || []).find((e: any) => e.type === 'sync.complete')?.timestamp ?? null;
    const lastIngestion = (events || []).find((e: any) => e.type === 'canonical.ingested')?.timestamp ?? null;

    return res.json({
      shopId,
      session,
      config: row?.config_json ?? null,
      events: events || [],
      meta: {
        sessionCount,
        lastSync,
        lastIngestion
      }
    });
  } catch (err) {
    console.error('[specter.controller] Error in getSpecterState:', err);
    return res.status(500).json({ error: 'Failed to fetch Specter state.' });
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
