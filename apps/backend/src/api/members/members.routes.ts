// apps/backend/src/api/members/members.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireAction } from '../../middleware/require-action.middleware.js';
import { 
    createMember, 
    listMembers, 
    updateMemberRole, 
    updateMyCurrencyPreference, 
    revokeMember, 
    getOperatorPerformance,
    getMyPreferences,
    updateMyPreferences
 } from './members.controller.js';

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
router.get('/', authenticateToken, requireAction('members:read'), listMembers);

// Update a member's role
router.patch('/:userId/role', authenticateToken, requireAction('members:write'), updateMemberRole);

// Create a new shop member and send invite email
router.post('/', authenticateToken, requireAction('members:write'), createMember);

// Update own display currency + locale preference (self-service, all roles)
router.patch('/me/currency', authenticateToken, updateMyCurrencyPreference);

// Revoke a member's shop access
router.delete('/:userId', authenticateToken, requireAction('members:write'), revokeMember);

// Operator performance metrics (owner/admin only)
router.get('/:userId/performance', authenticateToken, requireAction('members:read'), getOperatorPerformance);

// Self-service preferences (all roles)
router.get('/me/preferences', authenticateToken, getMyPreferences);
router.patch('/me/preferences', authenticateToken, updateMyPreferences);

export default router;