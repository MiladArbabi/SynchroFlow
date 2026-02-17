// apps/backend/src/api/overview/overview.ft2.controller.ts
import { Request, Response } from 'express';
import { getOverviewFt2Snapshot } from '../../services/overview-ft2/overviewFt2.resolver.js';

export async function getOverviewFt2(
  req: Request,
  res: Response
) {
  const shopId = Number(req.user?.shopId);

  const snapshot = await getOverviewFt2Snapshot({ shopId });

  if (snapshot === null) {
    res.status(204).send();
    return;
  }

  res.status(200).json(snapshot);
}