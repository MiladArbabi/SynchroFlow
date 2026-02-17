import { Router } from 'express';
import { financesFt2Controller } from './finances.ft2.controller.js';
import financesEpistemicController from './finances.epistemic.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';

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