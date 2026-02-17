// apps/backend/src/api/products/products.routes.ts
import { Router } from 'express';
import { fetchProducts } from './products.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';

const router = Router();

router.get('/', authenticateToken, (req, res, next) => {
  console.log('[DEBUG] Products route: GET /api/v1/products hit');
  next();
}, fetchProducts);

export default router;