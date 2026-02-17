import { Router } from 'express';
import {
  getUserState,
  getOnboardingProgress,
  updateUserMode,
  getUserProductCosts,
  updateUserProductCosts,
  updateUserState,
} from './user-state.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';

const router = Router();

router.get('/state', authenticateToken, getUserState);
router.get('/onboarding-progress', authenticateToken, getOnboardingProgress);
router.put('/mode', authenticateToken, updateUserMode);
router.get('/product-costs', authenticateToken, getUserProductCosts);
router.post('/product-costs', authenticateToken, updateUserProductCosts);
router.patch('/state', authenticateToken, updateUserState);

export default router;