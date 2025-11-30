// packages/api/src/api/ops-intel/ops-intel.controller.ts
import { Request, Response } from 'express';
import * as opsIntelService from './ops-intel.service';

/**
 * @route   GET /api/v1/ops-intel/summary
 * @desc    Provides summary data for the dashboard/A-Opex widget.
 * @access  Private
 */
export const httpGetOpsIntelSummary = async (req: Request, res: Response) => {
  try {
    const summaryData = await opsIntelService.getOpsIntelSummary();
    res.status(200).json(summaryData);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to fetch ops-intel summary: ${message}` });
  }
};