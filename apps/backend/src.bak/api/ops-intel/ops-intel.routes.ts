// apps/backend/src/api/ops-intel/ops-intel.routes.ts
import { Router } from 'express';
import * as opsIntelController from './ops-intel.controller';

const router = Router();

/**
 * @route   GET /api/v1/ops-intel/summary
 * @desc    Provides summary data for the dashboard/A-Opex widget.
 * @access  Private
 */

router.get('/summary', opsIntelController.httpGetOpsIntelSummary);

export default router;