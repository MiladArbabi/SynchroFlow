// packages/api/src/api/products/products.controller.ts
import { Request, Response } from 'express';
import { getProducts } from './products.service';

export const fetchProducts = async (req: Request, res: Response) => {
  console.log('[DEBUG] fetchProducts controller called');
  try {
    console.log('[DEBUG] Calling getProducts service...');
    const products = await getProducts();
    console.log(`[DEBUG] Retrieved ${products.length} products from database`);
    res.json(products);
  } catch (error: any) {
    console.error('[DEBUG] Failed to fetch products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
};