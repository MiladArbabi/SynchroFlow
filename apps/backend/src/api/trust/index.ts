// apps/backend/src/api/trust/index.ts
import { Router } from 'express';
import trustFt2Routes from './trust.ft2.routes';

const router = Router();

router.use('/', trustFt2Routes);

export default router;
