import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { httpGlobalSearch } from './search.controller.js';

const router = Router();

router.get('/', authenticateToken, httpGlobalSearch);

export default router;
