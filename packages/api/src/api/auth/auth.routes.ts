// packages/api/src/api/auth/auth.routes.ts
import { Router } from 'express';
import { registerUser, loginUser } from './auth.controller';

const router = Router();

// Wires POST /api/v1/auth/register
router.post('/register', registerUser);

// Wires POST /api/v1/auth/login
router.post('/login', loginUser);

export default router;