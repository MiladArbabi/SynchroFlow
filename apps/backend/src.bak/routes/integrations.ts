// apps/backend/src/routes/integrations.ts
import { Router } from 'express';

const router = Router();

// TODO: Implement integration routes in future issues
router.get('/', (req, res) => {
  res.json({ message: 'Integrations route - to be implemented' });
});

export default router;