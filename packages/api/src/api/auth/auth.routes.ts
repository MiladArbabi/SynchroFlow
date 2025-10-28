// packages/api/src/api/auth/auth.routes.ts
import { Router } from 'express';
import { registerUser } from './auth.controller';

const router = Router();

// Wires POST /api/v1/auth/register
router.post('/register', registerUser);

export default router;