import { getFinancesFt2Snapshot } from 'api-src/services/finances-ft2.provider';
import {
  FT2DateRangePreset,
  getFt2Period,
  resolveFt2PeriodFromPreset,
} from 'api-src/utils/ft2Period';

export async function financesFt2Controller(req: any, res: any) {
  const shopId = req.user?.shopId;

  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const preset =
  req.query.preset as FT2DateRangePreset | undefined;

  const period = preset
    ? preset === 'custom'
      ? resolveFt2PeriodFromPreset({
          preset: 'custom',
          from: String(req.query.from),
          to: String(req.query.to),
        })
      : resolveFt2PeriodFromPreset({ preset })
    : getFt2Period();

  const snapshot = await getFinancesFt2Snapshot({
    shopId,
    period,
  });

  return res.json(snapshot);
}