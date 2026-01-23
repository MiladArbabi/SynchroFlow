import { Router } from 'express';
import { getOverviewFt2 } from '../controllers/ro-overview.controller';

const router = Router();

/**
 * FT2 — RO Overview
 * Final path: GET /api/v1/modules/overview?shopId=...
 */
router.get('/', getOverviewFt2);

export default router;