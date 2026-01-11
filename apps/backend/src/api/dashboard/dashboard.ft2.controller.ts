import { Request, Response } from 'express';

export function getDashboardFt2Snapshot(_req: Request, res: Response) {
  res.status(200).json({
    observationWindow: null,
    coverage: null,
    systemHealth: null,
  });
}
