import { Router } from 'express';
import { financesFt2Controller } from './finances.ft2.controller.js';
import financesEpistemicController from './finances.epistemic.controller.js';
import { httpGetMargin } from './finances.margin.controller.js';
import { httpGetSkuMargin } from './finances.margin.sku.controller.js';
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


/**
 * @route   GET /api/v1/modules/finances/margin
 * @desc    Shop margin summary + per-order margin breakdown
 * @access  Private — FT2
 */
router.get(
  '/margin',
  authenticateToken,
  requireFt2,
  httpGetMargin
);

/**
 * @route   GET /api/v1/modules/finances/margin/sku
 * @desc    Per-SKU margin breakdown aggregated from order_revenue_units
 * @access  Private — FT2, Growth tier
 */
router.get(
  '/margin/sku',
  authenticateToken,
  requireFt2,
  httpGetSkuMargin
);

 export default router;