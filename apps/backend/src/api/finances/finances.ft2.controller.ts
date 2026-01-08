import { getFinancesFt2Snapshot } from 'api-src/services/finances-ft2.provider';
import { getFt2Period } from 'api-src/utils/ft2Period';

export async function financesFt2Controller(req: any, res: any) {
  const shopId = req.user?.shopId;

  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const period = getFt2Period();

  const snapshot = await getFinancesFt2Snapshot({
    shopId,
    period,
  });

  return res.json(snapshot);
}