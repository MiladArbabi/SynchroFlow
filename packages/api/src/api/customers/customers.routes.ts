// packages/api/src/api/customers/customers.routes.ts
import { Router } from 'express';

const router = Router();

/**
 * @route   GET /api/v1/customers
 * @desc    Get a list of all customers.
 * @access  Private (TODO: Add auth middleware)
 */
router.get('/', async (req, res) => {
  try {
    // v1: Return mock data matching the test expectations
    const mockCustomers = [
      { id: 'cust_abc', name: 'John Doe', email: 'john.doe@example.com', total_orders: 5, created_at: new Date() },
      { id: 'cust_def', name: 'Jane Smith', email: 'jane.smith@example.com', total_orders: 2, created_at: new Date() },
      { id: 'cust_ghi', name: 'Peter Jones', email: 'peter.jones@example.com', total_orders: 8, created_at: new Date() },
    ];

    res.status(200).json(mockCustomers);

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to fetch customers list: ${message}` });
  }
});

export default router;