// packages/api/src/routes/dashboard.ts
import { Router } from 'express';

const router = Router();

// TODO: Implement dashboard routes in future issues
router.get('/', (req, res) => {
  res.json({ message: 'Dashboard route - to be implemented' });
});

export default router;