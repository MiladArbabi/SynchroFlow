// apps/backend/src/middleware/auth.middleware.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Define a type for the decoded JWT payload
interface JwtPayload {
  userId: number;
  // Add other fields if you include them in the JWT (e.g., roles)
}

// Extend the Express Request type to include the user property
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload; // Add user property to Request
    }
  }
}

export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (token == null) {
    // No token at all → hard unauthenticated
    return res.status(401).json({ error: 'Unauthorized: No token provided.' });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.error('JWT_SECRET is not set!');
    return res.status(500).json({ error: 'Internal server error: JWT secret missing.' });
  }

  jwt.verify(token, jwtSecret, (err: any, user: any) => {
    if (err) {
      // 🔒 Token is structurally invalid (tampered / wrong secret)
      if (err.name !== 'TokenExpiredError') {
        console.error('[auth] Invalid JWT:', err.message);
        return res.status(403).json({ error: 'Forbidden: Invalid token.' });
      }

      // 🟡 Token expired
      console.warn('[auth] JWT expired');
      return res.status(401).json({
        error: 'TOKEN_EXPIRED',
        refreshable: true
      });
    }

    // ✅ Valid token
    req.user = user as JwtPayload;
    return next();
  });
};