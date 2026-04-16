// apps/backend/src/api/members/members.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireRole } from '../../middleware/require-role.middleware.js';
import { createMember, listMembers, updateMemberRole, updateMyCurrencyPreference } from './members.controller.js';

/**
 * MEMBERS ROUTES (WM-31)
 * ----------------------
 * Shop member management for owner/admin.
 * Registered at /api/v1/members in express.ts.
 *
 * Role guard: owner + admin only.
 * Will migrate to action-level entitlements in WM-19.
 */
const router = Router();

// List all active shop members
router.get('/', authenticateToken, requireRole(['owner', 'admin']), listMembers);

// Update a member's role
router.patch('/:userId/role', authenticateToken, requireRole(['owner', 'admin']), updateMemberRole);

// Create a new shop member and send invite email
router.post('/', authenticateToken, requireRole(['owner', 'admin']), createMember);

// Update own display currency + locale preference (self-service, all roles)
router.patch('/me/currency', authenticateToken, updateMyCurrencyPreference);

export default router;