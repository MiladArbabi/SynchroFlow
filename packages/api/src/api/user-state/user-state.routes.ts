// packages/api/src/api/user-state/user-state.routes.ts
import { Router } from 'express';
import { getUserState, updateUserMode } from './user-state.controller';
import { authenticateToken } from '../../middleware/auth.middleware';

const router = Router();

router.get('/state', authenticateToken, getUserState);
router.put('/mode', authenticateToken, updateUserMode);

export default router;