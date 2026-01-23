// apps/backend/src/api/overview/index.ts
import { Router } from 'express';
import overviewFt2Routes from './overview.ft2.routes';

const router = Router();

/**
 * Overview API surface
 */
router.use('/', overviewFt2Routes);

export default router;