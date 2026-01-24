import { Request, Response } from 'express';
import { getOverviewModulesFt2Snapshot } from
  'api-src/services/overview-modules-ft2/overviewModulesFt2.resolver';

export async function getOverviewModulesFt2(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const shopId = req.user?.shopId;

    if (!shopId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const snapshot = await getOverviewModulesFt2Snapshot({ shopId });
    res.status(200).json(snapshot);
  } catch (err) {
    res.status(500).json({ error: 'Overview Modules FT2 unavailable' });
  }
}
