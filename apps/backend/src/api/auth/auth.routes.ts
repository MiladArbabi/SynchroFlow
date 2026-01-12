// apps/backend/src/api/auth/auth.routes.ts
import { Router } from 'express';
import { registerUser, loginUser, refreshToken, logoutUser, getDevToken } from './auth.controller';
import { testIssueAccessToken } from './auth.test.controller';

const router = Router();

// Wires POST /api/v1/auth/register
router.post('/register', registerUser);

// Wires POST /api/v1/auth/login
router.post('/login', loginUser);

if (process.env.NODE_ENV === 'test') {
  router.post('/test/issue-token', testIssueAccessToken);
}

// Wires POST /api/v1/auth/refresh_token
router.post('/refresh_token', refreshToken);

// Wires POST /api/v1/auth/logout
router.post('/logout', logoutUser);

router.get('/dev-token', getDevToken);

export default router;