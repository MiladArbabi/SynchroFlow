// apps/backend/src/api/settings/shopSettings.controller.ts
//
// SRC-05a — SHOP TIMEZONE
// Read/update shops.timezone. Populated from Shopify's ianaTimezone at OAuth,
// overridable here. Writing through this endpoint flips timezone_source to
// 'manual' so a later re-install cannot clobber the merchant's choice.
//
// Validation uses Intl rather than a hardcoded list: the IANA database changes
// (zones split, rename, get added), and a stale allowlist would reject a valid
// zone the merchant's warehouse actually sits in.

import { Request, Response } from 'express';
import type { Knex } from 'knex';
import db from '@lasyncro/backend-core/db.js';
import { resolveShopifyAdminCredentialForConsumer, type ShopifyAdminCredentialConsumerResult } from '../../services/shopify/shopifyAdminCredentialConsumer.service.js';
import { createShopifyGraphQLClient } from '../../services/shopify/shopifyClient.service.js';

function isValidIanaZone(zone: string): boolean {
  try {
    // Throws RangeError on an unknown zone — the runtime's own IANA data is
    // the source of truth, not a list we would have to maintain.
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export async function httpGetShopTimezone(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const row = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return trx('shops')
        .where({ id: shopId })
        .select('timezone', 'timezone_source')
        .first();
    });

    if (!row) return res.status(404).json({ error: 'Shop not found' });

    return res.json({
      timezone:        row.timezone,
      timezone_source: row.timezone_source,
      // Surfaced so the UI can offer "use my device timezone" without the
      // merchant having to know what their IANA zone string is.
      detected_default: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  } catch (err) {
    console.error('[shop-settings] httpGetShopTimezone failed', err);
    return res.status(500).json({ error: 'Failed to fetch shop timezone' });
  }
}

export async function httpPatchShopTimezone(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { timezone } = req.body ?? {};

  if (typeof timezone !== 'string' || !timezone.trim()) {
    return res.status(400).json({ error: 'timezone is required' });
  }
  if (!isValidIanaZone(timezone)) {
    return res.status(400).json({ error: `Unknown timezone: ${timezone}` });
  }

  try {
    let updated = 0;
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      updated = await trx('shops')
        .where({ id: shopId })
        // Flipping to 'manual' is the whole point: it tells the OAuth path to
        // leave this value alone from now on.
        .update({ timezone, timezone_source: 'manual' });
    });

    if (!updated) return res.status(404).json({ error: 'Shop not found' });

    return res.json({ timezone, timezone_source: 'manual' });
  } catch (err) {
    console.error('[shop-settings] httpPatchShopTimezone failed', err);
    return res.status(500).json({ error: 'Failed to update shop timezone' });
  }
}


// -----------------------------------------------------------------------
// FULFILLMENT SLA (tier-independent)
// -----------------------------------------------------------------------
// Fulfillment SLA is a general operational setting, not a Growth-tier
// intelligence feature, so it must be reachable regardless of the shop's
// commercial tier. It lives in shop_operational_settings alongside fields
// still owned by the growth-gated /api/v1/modules/cashflow/settings
// endpoint (daily_cpt_local, monthly_overhead_amount, starting_cash_balance,
// starting_cash_balance_set_at). This controller only ever reads/writes
// fulfillment_sla_hours — those other columns remain exclusively owned by
// the cashflow settings controller and must never be touched here.

export async function httpGetFulfillmentSla(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const row = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return trx('shop_operational_settings')
        .where('shop_id', shopId)
        .select('fulfillment_sla_hours')
        .first();
    });

    return res.status(200).json({
      fulfillment_sla_hours: row?.fulfillment_sla_hours ?? 24,
    });
  } catch (err) {
    console.error('[shop-settings] httpGetFulfillmentSla failed', err);
    return res.status(500).json({ error: 'Failed to fetch fulfillment SLA' });
  }
}

export async function httpPatchFulfillmentSla(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { fulfillment_sla_hours } = req.body ?? {};

  const val = Number(fulfillment_sla_hours);
  if (
    fulfillment_sla_hours === undefined ||
    fulfillment_sla_hours === null ||
    isNaN(val) ||
    !Number.isInteger(val) ||
    val < 1 ||
    val > 720
  ) {
    return res.status(400).json({ error: 'fulfillment_sla_hours must be between 1 and 720' });
  }

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      await trx('shop_operational_settings')
        .insert({ shop_id: shopId, fulfillment_sla_hours: val })
        .onConflict('shop_id')
        .merge({ fulfillment_sla_hours: val, updated_at: trx.fn.now() });
    });

    return res.status(200).json({ fulfillment_sla_hours: val });
  } catch (err) {
    console.error('[shop-settings] httpPatchFulfillmentSla failed', err);
    return res.status(500).json({ error: 'Failed to update fulfillment SLA' });
  }
}


const SHOPIFY_LOCATIONS_QUERY = `
  query ShopifyLocations {
    locations(first: 100) {
      nodes {
        id
        name
        isActive
      }
    }
  }
`;

const SHOPIFY_LOCATION_QUERY = `
  query ShopifyLocation($id: ID!) {
    node(id: $id) {
      ... on Location {
        id
        name
        isActive
      }
    }
  }
`;

function normalizeShopifyLocationId(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;

  const match = /^gid:\/\/shopify\/Location\/(\d+)$/.exec(trimmed);
  return match?.[1] ?? null;
}

class ShopifyLocationCredentialError extends Error {
  readonly status: number;

  constructor(kind: Exclude<ShopifyAdminCredentialConsumerResult['kind'], 'READY'>) {
    super(`SHOPIFY_CREDENTIAL_${kind}`);
    this.status = kind === 'REAUTH_REQUIRED' ? 409
      : kind === 'PROVIDER_REJECTED' ? 502 : 503;
  }
}

async function loadShopifyLocationClient(shopId: number) {
  const credential = await resolveShopifyAdminCredentialForConsumer({
    shopId,
    now: new Date(),
  });
  if (credential.kind !== 'READY') {
    throw new ShopifyLocationCredentialError(credential.kind);
  }

  return createShopifyGraphQLClient({
    accessToken: credential.accessToken,
    platformShopName: credential.shopDomain,
    shopId,
  });
}

/**
 * INV-SHOPIFY-LOCATION-10
 *
 * Returns laSyncro warehouses alongside live Shopify Locations so the merchant
 * can explicitly map one Shopify Location to each physical warehouse.
 */
export async function httpGetWarehouseShopifyLocations(
  req: Request,
  res: Response
) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const warehouses = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      return trx('warehouses')
        .where({ shop_id: shopId })
        .select(
          'warehouse_id',
          'name',
          'is_default',
          'active',
          'external_location_id'
        )
        .orderBy('name', 'asc');
    });

    const client = await loadShopifyLocationClient(shopId);
    const response: any = await client.request(SHOPIFY_LOCATIONS_QUERY);

    const nodes = response?.data?.locations?.nodes;
    if (!Array.isArray(nodes)) {
      throw new Error(
        '[SHOPIFY_LOCATION_MAPPING] Shopify locations response is malformed'
      );
    }

    const shopifyLocations = nodes.map((node: any) => {
      const shopifyLocationId = normalizeShopifyLocationId(node?.id);

      if (!shopifyLocationId) {
        throw new Error(
          `[SHOPIFY_LOCATION_MAPPING] Invalid Shopify Location GID: ${String(node?.id)}`
        );
      }

      return {
        shopify_location_id: shopifyLocationId,
        name: node.name,
        is_active: node.isActive === true,
      };
    });

    return res.json({
      warehouses: warehouses.map((warehouse: any) => ({
        warehouse_id: warehouse.warehouse_id,
        name: warehouse.name,
        is_default: warehouse.is_default,
        active: warehouse.active,
        shopify_location_id: warehouse.external_location_id,
      })),
      shopify_locations: shopifyLocations,
    });
  } catch (err) {
    if (err instanceof ShopifyLocationCredentialError) {
      return res.status(err.status).json({ error: err.message });
    }

    console.error(
      '[SHOPIFY_LOCATION_MAPPING] Failed to load warehouse mappings',
      err
    );
    return res.status(500).json({
      error: 'Failed to load Shopify warehouse locations',
    });
  }
}

const OPENING_INVENTORY_MAPPING_LOCKED_RESPONSE = {
  code: 'OPENING_INVENTORY_MAPPING_LOCKED',
  error:
    'The Shopify location cannot be changed while opening inventory is in progress',
};

/**
 * GH-1179: once Opening Inventory has started, its count is scoped to the
 * warehouse's Shopify Location. The mapping is frozen until the opening
 * Shopify sync completes, and while a Shopify snapshot collection holds a
 * live lease (an expired lease can never finalize). `lock` takes the same
 * shop_wms_settings row lock as the opening start, serializing the two.
 */
async function isOpeningInventoryMappingLocked(
  trx: Knex.Transaction,
  shopId: number,
  lock: boolean
): Promise<boolean> {
  const query = trx('shop_wms_settings')
    .where({ shop_id: shopId })
    .select(
      'opening_inventory_reconciliation_started_at',
      'opening_inventory_shopify_synced_at'
    );

  const settings = await (lock ? query.forUpdate() : query).first();

  if (
    settings?.opening_inventory_reconciliation_started_at &&
    !settings?.opening_inventory_shopify_synced_at
  ) {
    return true;
  }

  const liveCollection = await trx('opening_inventory_shopify_snapshots')
    .where({ shop_id: shopId, status: 'collecting' })
    .where('lease_expires_at', '>', trx.fn.now())
    .first('snapshot_id');

  return Boolean(liveCollection);
}

/**
 * Persist one explicit warehouse → Shopify Location mapping.
 * null removes an existing mapping.
 */
export async function httpPatchWarehouseShopifyLocation(
  req: Request,
  res: Response
) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const warehouseId = req.params.warehouseId;

  if (
    typeof warehouseId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      warehouseId
    )
  ) {
    return res.status(400).json({
      error: 'warehouseId must be a valid UUID',
    });
  }

  const requestedLocationId = req.body?.shopify_location_id;

  let normalizedLocationId: string | null;

  if (requestedLocationId === null) {
    normalizedLocationId = null;
  } else {
    normalizedLocationId = normalizeShopifyLocationId(requestedLocationId);

    if (!normalizedLocationId) {
      return res.status(400).json({
        error: 'shopify_location_id must be a Shopify Location ID or null',
      });
    }
  }

  try {
    const lockedBeforeValidation = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return isOpeningInventoryMappingLocked(trx, shopId, false);
    });

    if (lockedBeforeValidation) {
      return res.status(409).json(OPENING_INVENTORY_MAPPING_LOCKED_RESPONSE);
    }

    if (normalizedLocationId !== null) {
      const client = await loadShopifyLocationClient(shopId);
      const gid = `gid://shopify/Location/${normalizedLocationId}`;

      const response: any = await client.request(SHOPIFY_LOCATION_QUERY, {
        variables: { id: gid },
      });

      const location = response?.data?.node;
      const confirmedId = normalizeShopifyLocationId(location?.id);

      if (confirmedId !== normalizedLocationId) {
        return res.status(400).json({
          error: 'Shopify location does not exist for this shop',
        });
      }

      if (location?.isActive !== true) {
        return res.status(400).json({
          error: 'Shopify location must be active',
        });
      }
    }

    let updatedWarehouse:
      | {
          warehouse_id: string;
          name: string;
          external_location_id: string | null;
        }
      | undefined;
    let lockedAtUpdate = false;

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // Re-check under the row lock: Opening Inventory may have started
      // while the Shopify location was being validated.
      if (await isOpeningInventoryMappingLocked(trx, shopId, true)) {
        lockedAtUpdate = true;
        return;
      }

      const rows = await trx('warehouses')
        .where({
          shop_id: shopId,
          warehouse_id: warehouseId,
        })
        .update({
          external_location_id: normalizedLocationId,
          updated_at: trx.fn.now(),
        })
        .returning([
          'warehouse_id',
          'name',
          'external_location_id',
        ]);

      updatedWarehouse = rows[0];
    });

    if (lockedAtUpdate) {
      return res.status(409).json(OPENING_INVENTORY_MAPPING_LOCKED_RESPONSE);
    }

    if (!updatedWarehouse) {
      return res.status(404).json({ error: 'Warehouse not found' });
    }

    return res.json({
      warehouse_id: updatedWarehouse.warehouse_id,
      name: updatedWarehouse.name,
      shopify_location_id: updatedWarehouse.external_location_id,
    });
  } catch (err) {
    if (err instanceof ShopifyLocationCredentialError) {
      return res.status(err.status).json({ error: err.message });
    }

    if ((err as { code?: string })?.code === '23505') {
      return res.status(409).json({
        error: 'Shopify location is already mapped to another warehouse',
      });
    }

    console.error(
      '[SHOPIFY_LOCATION_MAPPING] Failed to update warehouse mapping',
      err
    );
    return res.status(500).json({
      error: 'Failed to update Shopify warehouse location',
    });
  }
}
