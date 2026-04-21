// apps/backend/src/services/permissions/permissionSettings.service.ts
//
// PERMISSION SETTINGS SERVICE (WM-19 v2)
// ----------------------------------------
// Reads and updates shop_role_permissions.
// Called by the settings API — owner only.
//
// Invariants:
//   - LOCKED_ACTIONS cannot be modified — enforced here, not at DB level
//   - owner role permissions cannot be revoked — owner always has full access
//   - Unknown actions rejected — must exist in ACTION_ROLE_MAP
//   - Cache invalidated on every successful write
//
// Called by:
//   GET  /api/v1/settings/permissions
//   PATCH /api/v1/settings/permissions

import db from '@lasyncro/backend-core/db.js';
import { ACTION_ROLE_MAP } from '../../middleware/require-action.middleware.js';
import { invalidatePermissionCache } from './permissionCache.service.js';

export const ROLES = ['owner', 'admin', 'operator'] as const;
export type Role = typeof ROLES[number];

/**
 * Actions that cannot be modified via settings UI.
 * Owner always retains these regardless of shop config.
 */
export const LOCKED_ACTIONS = new Set([
  'members:write',
  'members:remove',
  'billing:write',
  'shopify-billing:write',
  'wms:settings:write',
]);

export interface PermissionRow {
  action: string;
  role: Role;
  granted: boolean;
  locked: boolean;
}

export interface PermissionMatrix {
  actions: {
    action: string;
    domain: string;
    label: string;
    permissions: Record<Role, { granted: boolean; locked: boolean }>;
  }[];
}

/**
 * Human-readable labels for actions — used by the settings UI.
 */
const ACTION_LABELS: Record<string, { label: string; domain: string }> = {
  'suppliers:read':         { label: 'View suppliers',            domain: 'Suppliers' },
  'suppliers:write':        { label: 'Manage suppliers',          domain: 'Suppliers' },
  'po:read':                { label: 'View purchase orders',      domain: 'Purchase Orders' },
  'po:write':               { label: 'Create purchase orders',    domain: 'Purchase Orders' },
  'po:receive':             { label: 'Receive shipments',         domain: 'Purchase Orders' },
  'po:status':              { label: 'Update PO status',          domain: 'Purchase Orders' },
  'receive-job:create':     { label: 'Open receive session',      domain: 'Receiving' },
  'receive-job:read':       { label: 'View receive sessions',     domain: 'Receiving' },
  'receive-job:inspect':    { label: 'Inspect received units',    domain: 'Receiving' },
  'receive-job:close':      { label: 'Close receive session',     domain: 'Receiving' },
  'receive-job:exception':  { label: 'Report receive exception',  domain: 'Receiving' },
  'wms:read':               { label: 'View WMS',                  domain: 'Warehouse' },
  'wms:batch:release':      { label: 'Release pick batches',      domain: 'Warehouse' },
  'wms:batch:claim':        { label: 'Claim pick batches',        domain: 'Warehouse' },
  'wms:pick:scan':          { label: 'Pick scan',                 domain: 'Warehouse' },
  'wms:pack:scan':          { label: 'Pack scan',                 domain: 'Warehouse' },
  'wms:stow:claim':         { label: 'Claim stow tasks',          domain: 'Warehouse' },
  'wms:stow:confirm':       { label: 'Confirm stow',              domain: 'Warehouse' },
  'wms:stow:location':      { label: 'Assign stow location',      domain: 'Warehouse' },
  'wms:exception:report':   { label: 'Report WMS exception',      domain: 'Warehouse' },
  'wms:ship:confirm':       { label: 'Confirm shipment',          domain: 'Warehouse' },
  'wms:settings:write':     { label: 'WMS settings',              domain: 'Warehouse' },
  'floor-planning:read':    { label: 'View floor plan',           domain: 'Floor Planning' },
  'floor-planning:write':   { label: 'Edit floor plan',           domain: 'Floor Planning' },
  'overview:read':          { label: 'View overview',             domain: 'Overview' },
  'morning-brief:read':     { label: 'View morning brief',        domain: 'Overview' },
  'members:read':           { label: 'View team members',         domain: 'Team' },
  'members:write':          { label: 'Manage member roles',       domain: 'Team' },
  'members:remove':         { label: 'Remove members',            domain: 'Team' },
  'billing:read':           { label: 'View billing',              domain: 'Billing' },
  'billing:write':          { label: 'Manage subscription',       domain: 'Billing' },
  'shopify-billing:read':   { label: 'View Shopify billing',      domain: 'Billing' },
  'shopify-billing:write':  { label: 'Manage Shopify billing',    domain: 'Billing' },
};

/**
 * Returns the full permission matrix for a shop.
 * Includes all actions × all roles with granted/locked state.
 */
export async function getPermissionMatrix(shopId: number): Promise<PermissionMatrix> {
  const rows = await db('shop_role_permissions')
    .where({ shop_id: shopId })
    .select('action', 'role', 'granted', 'locked');

  // Build lookup: action:role → { granted, locked }
  const lookup: Record<string, { granted: boolean; locked: boolean }> = {};
  for (const row of rows) {
    lookup[`${row.action}:${row.role}`] = { granted: row.granted, locked: row.locked };
  }

  const actions = Object.keys(ACTION_ROLE_MAP).map((action) => {
    const meta = ACTION_LABELS[action] ?? { label: action, domain: 'Other' };
    const permissions = {} as Record<Role, { granted: boolean; locked: boolean }>;

    for (const role of ROLES) {
      const key = `${action}:${role}`;
      permissions[role] = lookup[key] ?? {
        granted: (ACTION_ROLE_MAP[action] as string[]).includes(role),
        locked: LOCKED_ACTIONS.has(action),
      };
    }

    return { action, domain: meta.domain, label: meta.label, permissions };
  });

  return { actions };
}

export interface PermissionUpdate {
  action: string;
  role: Role;
  granted: boolean;
}

/**
 * Apply a batch of permission updates for a shop.
 * Validates each update — rejects locked actions and unknown actions.
 * Invalidates Redis cache on success.
 */
export async function updatePermissions(
  shopId: number,
  updates: PermissionUpdate[]
): Promise<{ applied: number; rejected: { update: PermissionUpdate; reason: string }[] }> {
  const rejected: { update: PermissionUpdate; reason: string }[] = [];
  const valid: PermissionUpdate[] = [];

  for (const update of updates) {
    if (!ACTION_ROLE_MAP[update.action]) {
      rejected.push({ update, reason: 'UNKNOWN_ACTION' });
      continue;
    }
    if (LOCKED_ACTIONS.has(update.action)) {
      rejected.push({ update, reason: 'ACTION_LOCKED' });
      continue;
    }
    if (update.role === 'owner' && !update.granted) {
      rejected.push({ update, reason: 'OWNER_CANNOT_BE_DENIED' });
      continue;
    }
    if (!ROLES.includes(update.role)) {
      rejected.push({ update, reason: 'UNKNOWN_ROLE' });
      continue;
    }
    valid.push(update);
  }

  if (valid.length > 0) {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      for (const update of valid) {
        await trx('shop_role_permissions')
          .insert({
            shop_id: shopId,
            action: update.action,
            role: update.role,
            granted: update.granted,
            locked: false,
            updated_at: new Date(),
          })
          .onConflict(['shop_id', 'action', 'role'])
          .merge({ granted: update.granted, updated_at: new Date() });
      }
    });

    await invalidatePermissionCache(shopId);
    console.info('[permissionSettings] Updated permissions', { shopId, count: valid.length });
  }

  return { applied: valid.length, rejected };
}

/**
 * Seed default permissions for a new shop from ACTION_ROLE_MAP.
 * Called on shop creation. Idempotent via onConflict ignore.
 */
export async function grantDefaultPermissionsForShop(
  trx: any,
  shopId: number
): Promise<void> {
  const rows: { shop_id: number; action: string; role: Role; granted: boolean; locked: boolean }[] = [];

  for (const [action, roles] of Object.entries(ACTION_ROLE_MAP)) {
    for (const role of ROLES) {
      rows.push({
        shop_id: shopId,
        action,
        role,
        granted: (roles as string[]).includes(role),
        locked: LOCKED_ACTIONS.has(action),
      });
    }
  }

  await trx('shop_role_permissions')
    .insert(rows)
    .onConflict(['shop_id', 'action', 'role'])
    .ignore();
}