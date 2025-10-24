// packages/api/src/api/ops-intel/ops-intel.routes.ts
import { Router } from 'express';

const router = Router();

/**
 * @route   GET /api/v1/ops-intel/summary
 * @desc    Provides summary data for the A-Opex widget.
 * v1 returns mock data.
 * @access  Private (TODO: Add auth middleware)
 */
router.get('/summary', async (req, res) => {
  try {
    const mockData = {
      automated_tasks: 4500,
      labor_cost_saved: 8125.75
    };
    res.status(200).json(mockData);

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to fetch ops-intel summary: ${message}` });
  }
});

export default router;