// apps/backend/src/api/customers/customers.routes.ts
import { Router } from 'express';
import { getCustomerDetails, getCustomerList } from './customers.controller'; 
import { httpGetCustomersFt2 } from './customers.ft2.controller';
import { authenticateToken } from 'api-src/middleware/auth.middleware';

const router = Router();

// FT2 — read-only snapshot (MUST come before :id)
router.get('/ft2', authenticateToken, httpGetCustomersFt2);

/**
* @route   GET /api/v1/customers
* @desc    Get a list of all customers for the authenticated shop
* @access  Private
*/

router.get('/', getCustomerList);

/**
 * @route   GET /api/v1/customers/:id
 * @desc    Get full customer details by ID
 * @access  Private
 */

router.get('/:id', getCustomerDetails);
 
export default router;