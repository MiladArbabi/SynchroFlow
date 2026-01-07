import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.middleware';
import { httpGetCustomersFt2 } from './customers.ft2.controller';

const router = Router();

/**
 * Customers FT2 Routes
 * -------------------
 * Read-only FT2 truth surface.
 *
 * Final path:
 *   GET /api/v1/modules/customers/ft2
 */
router.get('/ft2', authenticateToken, httpGetCustomersFt2);

export default router;