import { Router } from 'express';
import { getROOverview } from '../controllers/ro-overview.controller';

const router = Router();

/**
 * FT2 — RO Overview
 * Final path: GET /api/v1/modules/overview?shopId=...
 */
router.get('/', getROOverview);

export default router;