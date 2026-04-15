// apps/backend/src/api/overview/overview.morning-brief.controller.ts
//
// Morning Brief Controller (OVR-01)
// ----------------------------------
// Cache-first: serves from morning_brief_snapshots if fresh.
// On-demand refresh: recomputes if cache expired or force=true.
// Trust gated: returns 204 if trust not eligible.
//
// CHANGE POLICY:
//   Signal sources live in overviewMorningBrief.resolver.ts.
//   Route lives in overview.ft2.routes.ts.
//   Deep links must stay in sync with frontend router.

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import {
  computeMorningBrief,
  persistMorningBrief,
} from '../../services/overview-ft2/overviewMorningBrief.resolver.js';

export async function getMorningBrief(req: Request, res: Response) {
  const shopId = Number(req.user?.shopId);
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const force = req.query.force === 'true';

  try {
    await db.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    // --- Cache-first ---
    // Serve cached brief unless expired or force refresh requested.
    if (!force) {
      const cached = await db('morning_brief_snapshots')
        .where({ shop_id: shopId })
        .first();

      if (cached && new Date(cached.next_refresh_at) > new Date()) {
        return res.status(200).json({
          signals: cached.signals,
          hasUrgentIssues: cached.has_urgent_issues,
          generatedAt: cached.generated_at,
          trustWarning: cached.trust_warning,
          fromCache: true,
        });
      }
    }

    // --- Compute fresh ---
    const brief = await computeMorningBrief({ shopId });

    // Trust not eligible — no brief available
    if (brief === null) {
      return res.status(204).send();
    }

    // --- Persist to cache ---
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      await persistMorningBrief(shopId, brief, trx);
    });

    return res.status(200).json({
      ...brief,
      fromCache: false,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[MORNING_BRIEF_FAILED]', { shopId, error: message });
    return res.status(500).json({ error: 'Failed to compute morning brief' });
  }
}