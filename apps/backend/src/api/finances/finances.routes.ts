import { Router } from 'express';
import { financesFt2Controller } from './finances.ft2.controller';
import { authenticateToken } from 'api-src/middleware/auth.middleware';
import { requireFt2 } from 'api-src/middleware/require-ft2.middleware';
import financesEpistemicController from './finances.epistemic.controller';

 const router = Router();

 /**
  * FT2 read-only exposure for Finances.
  */
 router.get('/ft2', authenticateToken, requireFt2, financesFt2Controller);

 /**
 * Finances — Epistemic (Additive)
 * ------------------------------
 * Explicit epistemic truth surface.
 * Does NOT replace FT2.
 */
router.get(
  '/epistemic',
  authenticateToken,
  financesEpistemicController
);

 export default router;