// apps/backend/src/api/products/products.controller.ts
import { Request, Response } from 'express';
import { getProducts } from './products.service.js';

export const fetchProducts = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string | undefined;

    /**
     * TENANT IDENTITY ENFORCEMENT
     * ---------------------------
     * shopId must be injected from authenticated request context.
     */
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(401).json({
        error: 'Unauthorized: missing shop context',
      });
    }

    const result = await getProducts(shopId, page, limit, search);
    res.json(result);
  } catch (error: any) {
    console.error('Failed to fetch products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
};