// apps/backend/src/api/analytics/analytics.ft2.controller.ts
import { Request, Response } from 'express';
import { getAnalyticsFt2Snapshot } from 'api-src/services/analytics-ft2.provider';
import {
  getFt2Period,
  resolveFt2PeriodFromPreset,
  FT2DateRangePreset,
} from 'api-src/utils/ft2Period';

export async function analyticsFt2Controller(req: Request, res: Response) {
  const shopId = (req as any).user?.shopId;

  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const preset = req.query.preset as FT2DateRangePreset | undefined;

  const period = preset
    ? preset === 'custom'
      ? resolveFt2PeriodFromPreset({
          preset: 'custom',
          from: String(req.query.from),
          to: String(req.query.to),
        })
      : resolveFt2PeriodFromPreset({ preset })
    : getFt2Period();

  const snapshot = await getAnalyticsFt2Snapshot({
    shopId,
    period,
  });

  return res.json(snapshot);
}
