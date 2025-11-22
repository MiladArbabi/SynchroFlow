// Update packages/api/src/api/customers/customers.routes.ts - Use real service
import { Router } from 'express';
import * as customersController from './customers.controller';
import { getAllCustomers } from './customers.service';

const router = Router();

/**
 * @route   GET /api/v1/customers
 * @desc    Get a list of all customers from database
 * @access  Private
 */
router.get('/', async (req, res) => {
  try {
    const shopId = 1; // TODO: Get from authenticated user
    const customers = await getAllCustomers(shopId);
    res.status(200).json(customers);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to fetch customers list: ${message}` });
  }
});

router.get('/:id', customersController.getCustomerDetails);

export default router;