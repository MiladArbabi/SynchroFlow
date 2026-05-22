// apps/backend/src/api/auth/auth.routes.ts
import { Router } from 'express';
import { 
  registerUser, 
  loginUser, 
  refreshToken, 
  logoutUser, 
  getDevToken, 
  verifyEmail, 
  resendVerificationEmail,
  forgotPassword,
  resetPassword
} from './auth.controller.js';
import { testIssueAccessToken } from './auth.test.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';

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

// AUTH-007: email verification
router.get('/verify-email', verifyEmail);
// AUTH-007: requires auth — user must be logged in to resend verification
router.post('/resend-verification', authenticateToken, resendVerificationEmail);

// Forgot password / reset password
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;