// packages/api/src/routes/shops.ts
import { Router } from 'express';

const router = Router();

// TODO: Implement shop routes in future issues
router.get('/', (req, res) => {
  res.json({ message: 'Shops route - to be implemented' });
});

export default router;