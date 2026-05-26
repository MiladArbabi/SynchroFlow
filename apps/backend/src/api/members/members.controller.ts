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
 * Role changes update shop_memberships.role — source of truth for JWT shop_roles claim.
 * users.role sync removed (WM-19).
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
 * Updates shop_memberships.role — source of truth for JWT shop_roles claim (WM-19).
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

      // users.role sync removed — WM-19 complete.
      // shop_memberships.role is the sole source of truth for JWT shop_roles claim.
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

    // --- Seat limit enforcement (MON-04) ---
    // Tier is read from JWT claim (set at login/refresh via shop_subscriptions).
    // Falls back to 'starter' (1 seat) if claim is missing — fail closed.
    const { getTierConfig, isValidTier } = await import('@lasyncro/backend-core/config/tiers.js');
    const rawTier = req.user!.tier ?? 'starter';
    const currentTier = isValidTier(rawTier) ? rawTier : 'starter';
    const { seatLimit } = getTierConfig(currentTier);

    await db.raw(`SET app.current_tenant = '${shopId}'`);
    const activeSeatCount = await db('shop_memberships')
      .where({ shop_id: shopId })
      .whereNull('revoked_at')
      .count('id as count')
      .first();

    const currentSeats = Number(activeSeatCount?.count ?? 0);

    if (currentSeats >= seatLimit) {
      console.warn('[MEMBERS] Seat limit reached', { shopId, currentSeats, seatLimit, tier: currentTier });
      return res.status(403).json({
        error: 'SEAT_LIMIT_REACHED',
        current: currentSeats,
        limit: seatLimit,
        tier: currentTier,
      });
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
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
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

/**
 * DELETE /api/v1/members/:userId
 * Revokes a shop membership — sets revoked_at, does not delete the user.
 * Owner cannot revoke themselves.
 */
export const revokeMember = async (req: Request, res: Response) => {
  const shopId = req.user!.shopId!;
  const requesterId = req.user!.userId;
  const targetUserId = Number(req.params.userId);

  if (targetUserId === requesterId) {
    return res.status(400).json({ error: 'CANNOT_REVOKE_SELF' });
  }

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      const membership = await trx('shop_memberships')
        .where({ shop_id: shopId, user_id: targetUserId })
        .whereNull('revoked_at')
        .first('id', 'role');

      if (!membership) throw Object.assign(new Error('MEMBER_NOT_FOUND'), { statusCode: 404 });
      if (membership.role === 'owner') throw Object.assign(new Error('CANNOT_REVOKE_OWNER'), { statusCode: 403 });

      await trx('shop_memberships')
        .where({ id: membership.id })
        .update({ revoked_at: new Date(), updated_at: new Date() });

      console.info('[MEMBERS] Member revoked', { shopId, targetUserId, revokedBy: requesterId });
    });

    return res.json({ success: true, userId: targetUserId });
  } catch (err: any) {
    if (err.statusCode === 404) return res.status(404).json({ error: 'MEMBER_NOT_FOUND' });
    if (err.statusCode === 403) return res.status(403).json({ error: 'CANNOT_REVOKE_OWNER' });
    console.error('[MEMBERS] revokeMember failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/v1/members/me/preferences
 * Returns notification preferences for the authenticated user.
 */
export const getMyPreferences = async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const shopId = req.user!.shopId!;

  try {
    const membership = await db('shop_memberships')
      .where({ user_id: userId, shop_id: shopId })
      .whereNull('revoked_at')
      .first('notification_preferences');

    if (!membership) return res.status(404).json({ error: 'Membership not found' });

    return res.json({ preferences: membership.notification_preferences ?? {} });
  } catch (err) {
    console.error('[MEMBERS] getMyPreferences failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/v1/members/:userId/performance
 * Returns operator performance metrics derived from completed WMS tasks.
 *
 * Metrics (all time, scoped to shop):
 * - pick_rate_uph: avg units picked per hour across completed pick batches
 * - pack_rate_uph: avg units packed per hour across completed pack batches
 * - stow_rate_uph: avg units stowed per hour across completed stow tasks
 * - batches_picked: total pick batches completed
 * - batches_packed: total pack batches completed
 * - receive_jobs_closed: total receive jobs closed
 * - dock_to_stock_hours: avg hours from receive close → last stow complete per PO
 */
export const getOperatorPerformance = async (req: Request, res: Response) => {
  const shopId = req.user!.shopId!;
  const targetUserId = Number(req.params.userId);

  try {
    const metrics = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // Pick performance
      const pickBatches = await trx('pick_batches')
        .where({ shop_id: shopId, picked_by: targetUserId })
        .whereNotNull('pick_completed_at')
        .whereNotNull('pick_claimed_at')
        .select('units_picked', 'pick_claimed_at', 'pick_completed_at');

      const pickRates = pickBatches
        .map((b: any) => {
          const hrs = (new Date(b.pick_completed_at).getTime() - new Date(b.pick_claimed_at).getTime()) / 3600000;
          return hrs > 0 ? b.units_picked / hrs : null;
        })
        .filter((r: number | null) => r !== null) as number[];

      // Pack performance
      const packBatches = await trx('pick_batches')
        .where({ shop_id: shopId, packed_by: targetUserId })
        .whereNotNull('pack_completed_at')
        .whereNotNull('pack_claimed_at')
        .select('units_packed', 'pack_claimed_at', 'pack_completed_at');

      const packRates = packBatches
        .map((b: any) => {
          const hrs = (new Date(b.pack_completed_at).getTime() - new Date(b.pack_claimed_at).getTime()) / 3600000;
          return hrs > 0 ? b.units_packed / hrs : null;
        })
        .filter((r: number | null) => r !== null) as number[];

      // Stow performance
      const stowTasks = await trx('stow_tasks')
        .where({ shop_id: shopId, claimed_by: targetUserId })
        .whereNotNull('completed_at')
        .whereNotNull('claimed_at')
        .select('quantity', 'claimed_at', 'completed_at');

      const stowRates = stowTasks
        .map((t: any) => {
          const hrs = (new Date(t.completed_at).getTime() - new Date(t.claimed_at).getTime()) / 3600000;
          return hrs > 0 ? t.quantity / hrs : null;
        })
        .filter((r: number | null) => r !== null) as number[];

      // Dock-to-stock: receive close → last stow complete per PO
      const dockToStockRows = await trx.raw(`
        SELECT
          rj.receive_job_id,
          rj.closed_at,
          MAX(st.completed_at) as last_stow_at
        FROM receive_jobs rj
        JOIN stow_tasks st ON st.po_id = rj.po_id AND st.shop_id = rj.shop_id
        WHERE rj.shop_id = ?
          AND rj.assigned_operator_id = ?
          AND rj.closed_at IS NOT NULL
          AND st.completed_at IS NOT NULL
        GROUP BY rj.receive_job_id, rj.closed_at
      `, [shopId, targetUserId]);

      const dtsHours = dockToStockRows.rows
        .map((r: any) => {
          const hrs = (new Date(r.last_stow_at).getTime() - new Date(r.closed_at).getTime()) / 3600000;
          return hrs >= 0 ? hrs : null;
        })
        .filter((h: number | null) => h !== null) as number[];

      const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

      return {
        pick_rate_uph: avg(pickRates) !== null ? Math.round(avg(pickRates)! * 10) / 10 : null,
        pack_rate_uph: avg(packRates) !== null ? Math.round(avg(packRates)! * 10) / 10 : null,
        stow_rate_uph: avg(stowRates) !== null ? Math.round(avg(stowRates)! * 10) / 10 : null,
        batches_picked: pickBatches.length,
        batches_packed: packBatches.length,
        receive_jobs_closed: dockToStockRows.rows.length,
        dock_to_stock_hours: avg(dtsHours) !== null ? Math.round(avg(dtsHours)! * 10) / 10 : null,
      };
    });

    return res.json({ userId: targetUserId, metrics });
  } catch (err: any) {
    console.error('[MEMBERS] getOperatorPerformance failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * PATCH /api/v1/members/me/preferences
 * Persists notification preferences for the authenticated user.
 * Stored as JSONB in shop_memberships.notification_preferences.
 */
export const updateMyPreferences = async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const shopId = req.user!.shopId!;

  const { push_enabled, alert_tone, alert_types } = req.body;

  const VALID_TONES = ['urgent', 'standard', 'silent'];
  if (alert_tone !== undefined && !VALID_TONES.includes(alert_tone)) {
    return res.status(400).json({ error: `alert_tone must be one of: ${VALID_TONES.join(', ')}` });
  }

  try {
    // Fetch existing prefs and merge — partial updates supported
    const membership = await db('shop_memberships')
      .where({ user_id: userId, shop_id: shopId })
      .whereNull('revoked_at')
      .first('notification_preferences');

    if (!membership) return res.status(404).json({ error: 'Membership not found' });

    const existing = membership.notification_preferences ?? {};
    const updated = {
      ...existing,
      ...(push_enabled !== undefined && { push_enabled: Boolean(push_enabled) }),
      ...(alert_tone !== undefined && { alert_tone }),
      ...(alert_types !== undefined && { alert_types: { ...existing.alert_types, ...alert_types } }),
    };

    await db('shop_memberships')
      .where({ user_id: userId, shop_id: shopId })
      .whereNull('revoked_at')
      .update({ notification_preferences: JSON.stringify(updated), updated_at: new Date() });

    console.info('[MEMBERS] Preferences updated', { userId, shopId });
    return res.json({ success: true, preferences: updated });
  } catch (err) {
    console.error('[MEMBERS] updateMyPreferences failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * PATCH /api/v1/members/me/currency
 * ----------------------------------
 * Self-service endpoint — any authenticated user updates their own
 * display_currency and locale in shop_memberships.
 *
 * Access: all roles (UI restricted to owner/admin via route guard in frontend)
 * RLS: enforced via app.current_tenant — users can only update their own membership
 *
 * Body: { displayCurrency: string, locale: string }
 */
export const updateMyCurrencyPreference = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { displayCurrency, locale } = req.body as {
      displayCurrency?: string;
      locale?: string;
    };

    if (!displayCurrency && !locale) {
      return res.status(400).json({ error: 'At least one of displayCurrency or locale is required' });
    }

    // Validate ISO 4217 currency code format (3 uppercase letters)
    if (displayCurrency && !/^[A-Z]{3}$/.test(displayCurrency)) {
      return res.status(400).json({ error: 'displayCurrency must be a valid ISO 4217 code (e.g. USD, EUR, GBP)' });
    }

    const updates: Record<string, string> = {};
    if (displayCurrency) updates.display_currency = displayCurrency;
    if (locale) updates.locale = locale;

    await db('shop_memberships')
      .where({ user_id: userId })
      .whereNull('revoked_at')
      .update(updates);

    console.info('[MEMBERS] Currency preference updated', { userId, displayCurrency, locale });

    return res.json({ success: true, displayCurrency, locale });
  } catch (err) {
    console.error('[MEMBERS] updateMyCurrencyPreference failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};