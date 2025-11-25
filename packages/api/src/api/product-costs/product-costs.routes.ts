import { Router } from 'express';
import { 
  getProductCostHandler, 
  upsertProductCostHandler, 
  deleteProductCostHandler 
} from './product-costs.controller';
import { authenticateToken } from '../../middleware/auth.middleware';

const router = Router();

router.get('/:platformProductId', authenticateToken, getProductCostHandler);
router.post('/:platformProductId', authenticateToken, upsertProductCostHandler);
router.delete('/:platformProductId', authenticateToken, deleteProductCostHandler);

export default router;