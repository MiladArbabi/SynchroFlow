 import { Router } from 'express';
 import { financesFt2Controller } from './finances.ft2.controller';
 import { authenticateToken } from 'api-src/middleware/auth.middleware';

 const router = Router();

 /**
  * FT2 read-only exposure for Finances.
  */
 router.get('/ft2', authenticateToken, financesFt2Controller);

 export default router;