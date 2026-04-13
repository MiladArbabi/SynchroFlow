// apps/backend/src/api/members/members.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import bcrypt from 'bcrypt';
import { sendOperatorInviteEmail } from '../../services/email/email.service.js';

/**
 * MEMBERS CONTROLLER
 * ------------------
 * Owner/admin API for shop member management (WM-31).
 *
 * All queries are RLS-scoped via app.current_tenant.
 * Role changes update BOTH users.role and shop_memberships.role
 * to keep them in sync until users.role is deprecated (WM-19).
 *
 * Source of truth for JWT roles: shop_memberships.role
 * (resolved at login/refresh via shop-resolution.service.ts)
 */

/**
 * GET /api/v1/members
 * Returns all active shop members with their role.
 * Restricted to owner/admin (enforced in routes).
 */
export const listMembers = async (req: Request, res: Response) => {
  try {
    const shopId = req.user!.shopId;

    const members = await db('shop_memberships as sm')
      .join('users as u', 'u.id', 'sm.user_id')
      .where('sm.shop_id', shopId)
      .whereNull('sm.revoked_at')
      .select(
        'u.id as user_id',
        'u.email',
        'u.first_name',
        'u.last_name',
        'sm.role',
        'sm.created_at as member_since',
      );

    return res.json({ members });
  } catch (err) {
    console.error('[MEMBERS] listMembers failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * PATCH /api/v1/members/:userId/role
 * Updates role for a shop member.
 *
 * Syncs both shop_memberships.role and users.role atomically.
 * users.role will be deprecated in WM-19 — sync kept until then.
 *
 * Body: { role: 'owner' | 'admin' | 'operator' }
 */
export const updateMemberRole = async (req: Request, res: Response) => {
  const shopId = req.user!.shopId;
  const rawUserId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const targetUserId = parseInt(rawUserId, 10);
  const { role } = req.body;

  const VALID_ROLES = ['owner', 'admin', 'operator'] as const;
  type Role = typeof VALID_ROLES[number];

  if (typeof role !== 'string' || !VALID_ROLES.includes(role as Role)) {
    return res.status(400).json({
      error: 'INVALID_ROLE',
      allowed: VALID_ROLES,
    });
  }

  if (!Number.isInteger(targetUserId)) {
    return res.status(400).json({ error: 'INVALID_USER_ID' });
  }

  // Prevent self-demotion (owner demoting themselves locks them out)
  if (targetUserId === req.user!.userId) {
    return res.status(400).json({ error: 'SELF_ROLE_CHANGE_FORBIDDEN' });
  }

  try {
    await db.transaction(async (trx) => {
      // 1. Verify target is an active member of this shop
      const membership = await trx('shop_memberships')
        .where({ shop_id: shopId, user_id: targetUserId })
        .whereNull('revoked_at')
        .first('id');

      if (!membership) {
        // Throw to trigger rollback and return 404 outside
        throw Object.assign(new Error('MEMBER_NOT_FOUND'), { statusCode: 404 });
      }

      // 2. Update shop_memberships.role (source of truth for JWT)
      await trx('shop_memberships')
        .where({ id: membership.id })
        .update({ role, updated_at: new Date() });

      // 3. Sync users.role — kept in sync until WM-19 deprecates it
      await trx('users')
        .where({ id: targetUserId })
        .update({ role, updated_at: new Date() });
    });

    console.info('[MEMBERS] Role updated', {
      shopId,
      targetUserId,
      newRole: role,
      updatedBy: req.user!.userId,
    });

    return res.json({ success: true, userId: targetUserId, role });
  } catch (err: any) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: 'MEMBER_NOT_FOUND' });
    }
    console.error('[MEMBERS] updateMemberRole failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /api/v1/members
 * Creates a new shop member, sends invite email with credentials.
 *
 * - Generates a temporary password (not stored in plain text)
 * - Creates user + membership in a single transaction
 * - Email delivery is non-fatal: user is created regardless
 *
 * Body: { email, first_name, last_name, role }
 */
export const createMember = async (req: Request, res: Response) => {
  const shopId = req.user!.shopId!;
  const creatorUserId = req.user!.userId;

  const { email, first_name, last_name, role } = req.body;

  const VALID_ROLES = ['owner', 'admin', 'operator'] as const;
  type Role = typeof VALID_ROLES[number];

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'MISSING_EMAIL' });
  }

  if (typeof role !== 'string' || !(VALID_ROLES as readonly string[]).includes(role)) {
    return res.status(400).json({ error: 'INVALID_ROLE', allowed: VALID_ROLES });
  }

  try {
    // Check email not already in use
    const existing = await db('users').where({ email: email.toLowerCase() }).first('id');
    if (existing) {
      return res.status(409).json({ error: 'EMAIL_ALREADY_IN_USE' });
    }

    // Resolve shop name + creator name for invite email
    const shop = await db('shops').where({ id: shopId }).first('name');
    const creator = await db('users').where({ id: creatorUserId }).first('first_name', 'last_name', 'email');
    const invitedByName = creator
      ? `${creator.first_name ?? ''} ${creator.last_name ?? ''}`.trim() || creator.email
      : 'Your team admin';

    // Generate temporary password
    const temporaryPassword = crypto.randomUUID().slice(0, 12);
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    let newUser: { id: number; email: string };

    await db.transaction(async (trx) => {
      // 1. Create user (shop_id = existing shop, NOT a new shop)
      const [created] = await trx('users')
        .insert({
          shop_id: shopId,
          email: email.toLowerCase(),
          password_hash: passwordHash,
          first_name: first_name ?? null,
          last_name: last_name ?? null,
          role: role as Role,
        })
        .returning(['id', 'email']);

      newUser = created;

      // 2. Create membership
      await trx('shop_memberships').insert({
        shop_id: shopId,
        user_id: created.id,
        role: role as Role,
      });
    });

    console.info('[MEMBERS] Member created', {
      shopId,
      newUserId: newUser!.id,
      role,
      createdBy: creatorUserId,
    });

    // 3. Send invite email — non-fatal
    try {
      await sendOperatorInviteEmail({
        toEmail: email.toLowerCase(),
        firstName: first_name ?? 'there',
        temporaryPassword,
        invitedByName,
        shopName: shop?.name ?? 'your shop',
        role,
      });
    } catch (emailErr) {
      console.error('[MEMBERS] Invite email failed (non-fatal):', emailErr);
    }

    return res.status(201).json({
      success: true,
      user_id: newUser!.id,
      email: newUser!.email,
      role,
    });
  } catch (err) {
    console.error('[MEMBERS] createMember failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};