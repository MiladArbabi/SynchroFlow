 import { Router } from 'express';
 import { financesFt2Controller } from './finances.ft2.controller';
 import { authenticateToken } from 'api-src/middleware/auth.middleware';
import { requireFt2 } from 'api-src/middleware/require-ft2.middleware';

 const router = Router();

 /**
  * FT2 read-only exposure for Finances.
  */
 router.get('/ft2', authenticateToken, requireFt2, financesFt2Controller);

 export default router;