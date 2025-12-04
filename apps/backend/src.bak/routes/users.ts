// apps/backend/src/routes/users.ts
import { Router } from 'express';

const router = Router();

// TODO: Implement user routes in future issues
router.get('/', (req, res) => {
  res.json({ message: 'Users route - to be implemented' });
});

export default router;