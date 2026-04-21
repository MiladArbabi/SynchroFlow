// apps/backend/migrations/20260421000001_0101_create_shop_role_permissions.ts
//
// shop_role_permissions (WM-19 v2)
// ---------------------------------
// Per-shop, per-role, per-action permission overrides.
//
// Design:
//   - Presence of a row = role is allowed to perform action for this shop
//   - Absence = denied (fails closed)
//   - Seeded from ACTION_ROLE_MAP defaults on shop creation
//   - Owner has all permissions and cannot be restricted (enforced in service layer)
//   - Certain actions are non-configurable (hardcoded in LOCKED_ACTIONS constant)
//
// Writers:
//   - PATCH /api/v1/settings/permissions (owner only)
//   - Shop creation seed (grantDefaultPermissionsForShop)
//
// Readers:
//   - requireAction middleware (via Redis-cached permission set)
//
// Cache:
//   - Permissions cached in Redis per shop_id (TTL: 5 minutes)
//   - Cache invalidated on any PATCH to this table
//
// CHANGE POLICY:
//   Adding a new action → add to ACTION_ROLE_MAP + re-seed via migration
//   Changing defaults → update ACTION_ROLE_MAP + add a data migration
//   Never read this table directly in route handlers — always via requireAction

import { Knex } from 'knex';
import { ACTION_ROLE_MAP } from '../src/middleware/require-action.middleware.js';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('shop_role_permissions', (table) => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    /**
     * ACTION
     * ------
     * Must match a key in ACTION_ROLE_MAP.
     * Validated at write time in the permissions service.
     */
    table.string('action', 100).notNullable();

    /**
     * ROLE
     * ----
     * One of: owner, admin, operator
     * owner permissions are always granted — rows exist for completeness/audit only.
     */
    table.string('role', 50).notNullable();

    /**
     * GRANTED
     * -------
     * true  = role can perform action for this shop
     * false = role cannot perform action (explicit deny)
     *
     * Stored explicitly rather than row-presence-only to make
     * the permission matrix readable and auditable.
     */
    table.boolean('granted').notNullable().defaultTo(true);

    /**
     * LOCKED
     * ------
     * true = permission cannot be changed via settings UI
     * Set to true for owner-only actions (billing:write, members:remove, etc.)
     * Enforced in service layer — not DB constraint.
     */
    table.boolean('locked').notNullable().defaultTo(false);

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // One row per (shop, action, role)
    table.unique(['shop_id', 'action', 'role'], 'shop_role_permissions_unique');
    table.index(['shop_id']);
    table.index(['shop_id', 'action']);
  });

  // --- RLS: tenant isolation ---
  await knex.raw(`
    ALTER TABLE shop_role_permissions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shop_role_permissions FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`DROP POLICY IF EXISTS shop_role_permissions_tenant_isolation_policy ON shop_role_permissions;`);

  await knex.raw(`
    CREATE POLICY shop_role_permissions_tenant_isolation_policy
    ON shop_role_permissions
    USING (shop_id = current_setting('app.current_tenant')::int);
  `);

  // --- Seed default permissions for all existing shops ---
  // New shops are seeded by grantDefaultPermissionsForShop on creation.
  // This seeds existing shops from ACTION_ROLE_MAP defaults.
  const shops = await knex('shops').select('id');
  if (shops.length === 0) return;

  /**
   * LOCKED ACTIONS
   * --------------
   * These cannot be changed via the settings UI.
   * owner always retains these regardless of shop config.
   */
  const LOCKED_ACTIONS = new Set([
    'members:write',
    'members:remove',
    'billing:write',
    'shopify-billing:write',
    'wms:settings:write',
  ]);

  const rows: Array<{
    shop_id: number;
    action: string;
    role: string;
    granted: boolean;
    locked: boolean;
  }> = [];

  for (const shop of shops) {
    for (const [action, roles] of Object.entries(ACTION_ROLE_MAP)) {
      for (const role of ['owner', 'admin', 'operator']) {
        rows.push({
          shop_id: shop.id,
          action,
          role,
          granted: (roles as string[]).includes(role),
          locked: LOCKED_ACTIONS.has(action),
        });
      }
    }
  }

  // Batch insert in chunks to avoid query size limits
  const CHUNK_SIZE = 500;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await knex('shop_role_permissions')
      .insert(rows.slice(i, i + CHUNK_SIZE))
      .onConflict(['shop_id', 'action', 'role'])
      .ignore();
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shop_role_permissions');
}