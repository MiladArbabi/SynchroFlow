import { getFinancesFt2Snapshot } from "../../services/finances-ft2.provider.js";
import { FT2DateRangePreset, resolveFt2PeriodFromPreset, getFt2Period } from "@lasyncro/backend-core/utils/ft2Period.js";


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