import { Router } from 'express';
import { authenticateToken } from 'api-src/middleware/auth.middleware';
import { financesFt2Controller } from './finances.ft2.controller';

const router = Router();

router.get('/ft2', authenticateToken, financesFt2Controller);

export default router;