// apps/backend/src/onboarding/readiness.router.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { OnboardingReadinessService } from './readiness.service.js';

const router = Router();
const service = new OnboardingReadinessService();

router.get('/readiness', authenticateToken, async (req, res) => {
  try {
    const user = (req as any).user;

    const shopId =
      user?.shopId !== undefined
        ? Number(user.shopId)
        : req.query.shopId
        ? Number(req.query.shopId)
        : undefined;

    const userId =
      user?.userId !== undefined ? Number(user.userId) : undefined;

    if (!shopId) {
      return res.status(400).json({ error: 'Shop ID missing' });
    }

    if (!userId) {
      return res
        .status(401)
        .json({ error: 'Unauthorized: User ID missing in token' });
    }

    const snapshot = await service.getSnapshot({ shopId, userId });

    res.json(snapshot);
  } catch (error: any) {
    console.error('[OnboardingReadiness] Error:', error);
    res.status(500).json({ error: 'Failed to compute onboarding readiness' });
  }
});

export default router;
