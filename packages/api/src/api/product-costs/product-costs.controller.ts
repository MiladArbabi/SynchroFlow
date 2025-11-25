import { Request, Response } from 'express';
import { getProductCost, upsertProductCost, deleteProductCost } from './product-costs.service';

export const getProductCostHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { platformProductId } = req.params;
    
    if (!platformProductId) {
      res.status(400).json({ error: 'platformProductId is required' });
      return;
    }

    const cost = await getProductCost(platformProductId);
    
    if (!cost) {
      res.status(404).json({ error: 'Product cost not found' });
      return;
    }

    res.json(cost);
  } catch (error) {
    console.error('Error fetching product cost:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const upsertProductCostHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { platformProductId } = req.params;
    const { purchase_price, landed_cost_per_unit } = req.body;

    if (!platformProductId) {
      res.status(400).json({ error: 'platformProductId is required' });
      return;
    }

    if (typeof purchase_price !== 'number' || purchase_price < 0) {
      res.status(400).json({ error: 'Valid purchase_price is required' });
      return;
    }

    if (typeof landed_cost_per_unit !== 'number' || landed_cost_per_unit < 0) {
      res.status(400).json({ error: 'Valid landed_cost_per_unit is required' });
      return;
    }

    const cost = await upsertProductCost(platformProductId, purchase_price, landed_cost_per_unit);
    res.json(cost);
  } catch (error) {
    console.error('Error upserting product cost:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteProductCostHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { platformProductId } = req.params;
    
    if (!platformProductId) {
      res.status(400).json({ error: 'platformProductId is required' });
      return;
    }

    const deleted = await deleteProductCost(platformProductId);
    
    if (!deleted) {
      res.status(404).json({ error: 'Product cost not found' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting product cost:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};