import { Router } from 'express';
import { 
  getUserState, 
  updateUserMode, 
  getOnboardingProgress,
  getUserProductCosts,
  updateUserProductCosts 
} from './user-state.controller';
import { authenticateToken } from '../../middleware/auth.middleware';

const router = Router();

router.get('/state', authenticateToken, getUserState);
router.get('/onboarding-progress', authenticateToken, getOnboardingProgress);
router.put('/mode', authenticateToken, updateUserMode);
router.get('/product-costs', authenticateToken, getUserProductCosts);
router.post('/product-costs', authenticateToken, updateUserProductCosts);

export default router;