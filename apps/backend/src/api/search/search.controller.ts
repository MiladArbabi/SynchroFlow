import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import { searchOperationalEntities } from './search.service.js';

export async function httpGlobalSearch(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.status(200).json({ results: [] });

  try {
    const results = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return searchOperationalEntities(trx, shopId, q);
    });

    return res.status(200).json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[GLOBAL_SEARCH_FAILED]', { shopId, q, error: message });
    return res.status(500).json({ error: 'Failed to search' });
  }
}
