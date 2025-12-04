// apps/backend/src/api/products/products.routes.ts
import { Router } from 'express';
import { fetchProducts } from './products.controller';
import { authenticateToken } from '../../middleware/auth.middleware';

const router = Router();

router.get('/', authenticateToken, (req, res, next) => {
  console.log('[DEBUG] Products route: GET /api/v1/products hit');
  next();
}, fetchProducts);

export default router;