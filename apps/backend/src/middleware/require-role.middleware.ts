// apps/backend/src/middleware/require-role.middleware.ts
import { Request, Response, NextFunction } from 'express';

/**
 * ROLE GUARD MIDDLEWARE
 * ----------------------
 * Temporary role-based access control for WMS routes.
 * Reads from req.user.roles (string[]) set by authenticateToken.
 *
 * Superseded by action-level entitlements in WM-19 sprint.
 *
 * Usage:
 *   router.post('/batch/release', authenticateToken, requireRole(['owner', 'admin']), handler)
 *   router.post('/pick/scan', authenticateToken, requireRole(['operator', 'owner', 'admin']), handler)
 */
export function requireRole(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const roles = req.user?.roles;

    // Distinguish missing roles claim (token shape violation) from empty roles (no role assigned)
    if (!roles) {
      return res.status(401).json({
        error: 'MISSING_ROLES_CLAIM',
        action: 'LOGOUT_REQUIRED',
      });
    }

    if (roles.length === 0) {
      return res.status(403).json({
        error: 'NO_ROLE_ASSIGNED',
        action: 'CONTACT_ADMIN',
      });
    }

    const hasRole = roles.some((r) => allowedRoles.includes(r));

    if (!hasRole) {
      return res.status(403).json({
        error: 'Insufficient role',
        required: allowedRoles,
        current: roles,
      });
    }

    next();
  };
}