import { Router } from 'express';
import { financesFt2Controller } from './finances.ft2.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';

const router = Router();

router.get('/ft2', authenticateToken, financesFt2Controller);

export default router;