/**
 * GH-1160: deterministic first FT2 entry, before mapping or opening counts.
 *
 * Prerequisite: a NEW tenant provisioned by the real Shopify install route.
 * This helper never duplicates install bootstrap or resets an existing shop.
 * Call with DEV_SEED_MODE=first_entry in development/test to suppress the
 * canonical FT0 materializer's outbound email. No argv/process lifecycle here.
 *
 * Offline boundaries: credentials and an empty completed Shopify sync stand in
 * for OAuth/network ingestion. materializeFT0Completion and the existing FT2
 * projection handler replace asynchronous sync/Aha/confirmation orchestration
 * and eligibility evaluation. They own lifecycle durability and audit writes;
 * no lifecycle snapshot is hand-inserted. No catalog, orders, physical stock,
 * operational snapshots, or opening-count cohort are fabricated.
 */
import bcrypt from 'bcrypt';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { resolveFoundingOwner } from '../services/founding-owner.service.js';
import { materializeFT0Completion } from '../services/ft0-completion-materializer.service.js';
import { handleLifecycleFT2Confirmed } from '../projection/handlers/lifecycle.ft2_confirmed.js';
import { persistShopifyAdminCredentials } from '../services/shopify/shopifyAdminCredential.repository.js';
import { SHOPIFY_REQUIRED_SCOPE_STRING } from '../services/shopify/shopifyScopes.js';

export async function seedFirstEntry(
  shopId: number,
  owner: { email: string; password: string }
) {
  if (!['development', 'test'].includes(process.env.NODE_ENV ?? '') ||
      process.env.DEV_SEED_MODE !== 'first_entry') {
    throw new Error('FIRST_ENTRY_REQUIRES_LOCAL_FIRST_ENTRY_SEED_MODE');
  }
  if (!Number.isInteger(shopId) || shopId <= 0 ||
      !owner.email.trim() || owner.password.length < 8) {
    throw new Error('FIRST_ENTRY_INVALID_INPUT');
  }

  const passwordHash = await bcrypt.hash(owner.password, 10);
  return withTenant(shopId, async (trx) => {
    const settings = await trx('shop_wms_settings')
      .where({ shop_id: shopId }).forUpdate().first();
    const warehouses = await trx('warehouses').where({ shop_id: shopId });
    const locations = await trx('warehouse_locations').where({ shop_id: shopId });
    const rootLocationCode = `WH-${shopId}-ROOT`;
    const warehouse = warehouses[0];
    if (settings?.bootstrap_model !== 'reconcile_opening_expectation_v2' ||
        settings.opening_inventory_reconciliation_started_at ||
        warehouses.length !== 1 || !warehouse.is_default || !warehouse.active ||
        warehouse.root_location_code !== rootLocationCode ||
        locations.length !== 1 || locations[0].type !== 'warehouse' ||
        !locations[0].active || locations[0].parent_location_code !== null ||
        locations[0].location_code !== rootLocationCode ||
        locations[0].warehouse_id !== warehouse.warehouse_id) {
      throw new Error('FIRST_ENTRY_REQUIRES_FRESH_ROOT_ONLY_INSTALL');
    }

    for (const table of [
      'integrations', 'shopify_app_installations', 'user_lifecycle_snapshot',
      'products', 'orders', 'inventory_movements', 'inventory_truth',
      'inventory_recount_tasks',
      'daily_operational_brief_snapshot', 'revenue_projection_daily', 'ft0_state', 'ft2_state',
    ]) {
      if (await trx(table).where({ shop_id: shopId }).first()) {
        throw new Error(`FIRST_ENTRY_REQUIRES_EMPTY_TABLE: ${table}`);
      }
    }

    // FIRST_ENTRY_REVENUE_UNITS_INDIRECT_SCOPE:
    // order_revenue_units has no shop_id. Tenant ownership is inherited
    // from its parent order, matching the canonical schema/RLS contract.
    const revenueUnit = await trx('order_revenue_units as ru')
      .join(
        'orders as o',
        'o.lasyncro_order_id',
        'ru.lasyncro_order_id'
      )
      .where('o.shop_id', shopId)
      .first('ru.lasyncro_order_id');

    if (revenueUnit) {
      throw new Error(
        'FIRST_ENTRY_REQUIRES_EMPTY_TABLE: order_revenue_units'
      );
    }

    const ownerId = await resolveFoundingOwner(shopId, trx);
    const membership = await trx('shop_memberships')
      .where({ shop_id: shopId, user_id: ownerId, role: 'owner' })
      .whereNull('revoked_at').first();
    const user = await trx('users').where({ shop_id: shopId, id: ownerId }).first();
    const subscription = await trx('shop_subscriptions').where({ shop_id: shopId }).first();
    if (!membership || user?.entry_channel !== 'shopify_app_store' ||
        subscription?.billing_provider !== 'shopify') {
      throw new Error('FIRST_ENTRY_REQUIRES_SHOPIFY_INSTALL_OWNER');
    }

    const shop = await trx('shops').where({ id: shopId }).first('name');
    const eventTime = new Date();
    await trx('users').where({ id: ownerId, shop_id: shopId }).update({
      email: owner.email.trim().toLowerCase(),
      password_hash: passwordHash,
      first_name: 'First',
      last_name: 'Entry',
      email_verified_at: eventTime,
      shopify_connected: true,
    });
    const [installation] = await trx('shopify_app_installations').insert({
      shop_id: shopId,
      shop_domain: shop.name,
      scopes: SHOPIFY_REQUIRED_SCOPE_STRING,
    }).returning('id');
    // Offline placeholders are expired: canonical consumers must never send them.
    await persistShopifyAdminCredentials(trx, installation.id, shopId, {
      accessToken: 'offline-first-entry-no-network',
      refreshToken: 'offline-first-entry-no-network-refresh',
      accessExpiresAt: new Date(0),
      refreshExpiresAt: new Date(0),
      grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING,
    });
    await trx('integrations').insert({
      shop_id: shopId,
      platform: 'shopify',
      platform_shop_name: shop.name,
      sync_status: 'COMPLETED',
      sync_last_error: null,
      updated_at: eventTime,
    });

    await materializeFT0Completion({
      shopId, trx, eventTime, foundingOwnerUserId: ownerId,
      completionReason: { fixture: 'first_entry', orders: 0, authoritativeEmptySync: true },
    });
    const [event] = await trx('domain_events').insert({
      shop_id: shopId,
      event_type: 'lifecycle/ft2_confirmed',
      external_event_id: `internal:lifecycle/ft2_confirmed:${shopId}`,
      event_time: eventTime,
      event_version: 1,
      event_payload: {
        user_id: ownerId,
        evaluator_version: 'first-entry-fixture',
        evaluation_snapshot: { fixture: 'first_entry', bypassedEligibilityEvaluation: true },
      },
    }).returning('*');
    await handleLifecycleFT2Confirmed({
      domainEvent: event, domain_event_id: event.id, canonicalEventTime: eventTime, trx,
    });

    return { shopId, ownerId, warehouseId: warehouse.warehouse_id, rootLocationCode };
  });
}
