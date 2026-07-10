import { Router } from 'express';
import {
  getUserState,
  getOnboardingProgress,
  updateUserMode,
  updateUserProfile,
  getUserProductCosts,
  updateUserProductCosts,
  updateUserState,
  dismissSpotlight,
  getActivationEvents,
  getOnboardingFlags,
  dismissChecklist,
} from './user-state.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';

const router = Router();

router.get('/state', authenticateToken, getUserState);
router.get('/onboarding-progress', authenticateToken, getOnboardingProgress);
router.put('/mode', authenticateToken, updateUserMode);
router.get('/product-costs', authenticateToken, getUserProductCosts);
router.post('/product-costs', authenticateToken, updateUserProductCosts);
router.patch('/state', authenticateToken, updateUserState);
router.patch('/profile', authenticateToken, updateUserProfile);

router.post('/spotlight/:key/dismiss', authenticateToken, dismissSpotlight);
router.get('/activation-events', authenticateToken, getActivationEvents);
router.get('/onboarding-flags', authenticateToken, getOnboardingFlags);
router.post('/checklist/dismiss', authenticateToken, dismissChecklist);

export default router;