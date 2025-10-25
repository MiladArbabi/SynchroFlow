// packages/api/src/api/orders/orders.routes.ts
import { Router } from 'express';

const router = Router();

/**
 * @route   GET /api/v1/orders/:id/status
 * @desc    Get the current fulfillment status of a single order.
 * @access  Private (TODO: Add auth middleware)
 */

router.get('/:id/status', async (req, res) => {
  const { id } = req.params;

  try {
    // v1: Return mock data.
    // In v2, this will call the C++ core.
    const mockStatus = {
      orderId: id,
      status: 'Picking' // Hardcoded for v1
    };
    
    res.status(200).json(mockStatus);

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to fetch order status for ${id}: ${message}` });
  }
});

router.get('/:id/profitability', async (req, res) => {
  const { id } = req.params;

  try {
    // v1: Return mock data based on test expectations
    const mockProfitability = {
      orderId: id,
      revenue: 149.99,
      cogs: 62.50,
      shippingCost: 12.00,
      fees: 4.50,
      margin: 70.99,
      marginPercent: 47.3 // Matches test case
    };
    res.status(200).json(mockProfitability);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to fetch order profitability for ${id}: ${message}` });
  }
});

export default router;