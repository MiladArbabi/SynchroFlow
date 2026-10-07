import type { Knex } from 'knex';

// GH-1222 / TIER-07 — re-seed shop_role_permissions for the new ratified
// Warehouse management actions (0101 CHANGE POLICY: "Adding a new action →
// add to ACTION_ROLE_MAP + re-seed via migration").
//
//   wms:analytics:read           owner/admin, LOCKED
//   wms:analytics:display:write  owner/admin, LOCKED
//   wms:problem:resolve          owner/admin, LOCKED
//
// Runtime already falls back to ACTION_ROLE_MAP for keys absent from a shop's
// rows (permissionCache.isActionAllowed); this migration makes existing-shop
// state durable, auditable and consistent with the permission matrix. New
// shops are seeded by grantDefaultPermissionsForShop.
//
// Values are frozen here on purpose — a migration must not change meaning if
// ACTION_ROLE_MAP is edited later.
//
// Idempotent at the row level: onConflict(shop_id, action, role) ignore never
// overwrites an existing row.

const ACTIONS = [
  'wms:analytics:read',
  'wms:analytics:display:write',
  'wms:problem:resolve',
] as const;

const GRANTS: Record<string, boolean> = {
  owner: true,
  admin: true,
  operator: false,
};

const CHUNK_SIZE = 500;

export async function up(knex: Knex): Promise<void> {
  // shop_role_permissions has FORCE RLS keyed on app.current_tenant; a
  // cross-tenant data migration needs row_security=off, which either exposes
  // all rows to the migration role or raises (0202/0203 precedent) — never a
  // silent partial seed.
  await knex.raw(`SET LOCAL row_security = off`);

  const shops: { id: number }[] = await knex('shops').select('id');
  if (shops.length === 0) return;

  const rows: {
    shop_id: number;
    action: string;
    role: string;
    granted: boolean;
    locked: boolean;
  }[] = [];

  for (const shop of shops) {
    for (const action of ACTIONS) {
      for (const [role, granted] of Object.entries(GRANTS)) {
        rows.push({ shop_id: shop.id, action, role, granted, locked: true });
      }
    }
  }

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await knex('shop_role_permissions')
      .insert(rows.slice(i, i + CHUNK_SIZE))
      .onConflict(['shop_id', 'action', 'role'])
      .ignore();
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`SET LOCAL row_security = off`);

  // Remove ONLY the rows for the three GH-1222 actions.
  await knex('shop_role_permissions').whereIn('action', [...ACTIONS]).delete();
}
