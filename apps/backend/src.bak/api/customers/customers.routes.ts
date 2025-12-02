// packages/api/src/api/customers/customers.routes.ts
import { Router } from 'express';
import { getCustomerDetails, getCustomerList } from './customers.controller'; const router = Router();

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