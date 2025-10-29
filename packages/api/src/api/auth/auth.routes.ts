// packages/api/src/api/auth/auth.routes.ts
import { Router } from 'express';
import { registerUser, loginUser, refreshToken } from './auth.controller';

const router = Router();

// Wires POST /api/v1/auth/register
router.post('/register', registerUser);

// Wires POST /api/v1/auth/login
router.post('/login', loginUser);

// Wires POST /api/v1/auth/refresh_token
+router.post('/refresh_token', refreshToken);

export default router;