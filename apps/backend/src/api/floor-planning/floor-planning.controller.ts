// apps/backend/src/api/floor-planning/floor-planning.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import { generateWarehouseLabelPdf } from '../../services/wms/warehouseLabelPdf.service.js';

/**
 * FLOOR PLANNING CONTROLLERS
 * ---------------------------
 * All queries are tenant-scoped via req.user.shopId + RLS current_tenant.
 *
 * warehouse_locations table exists (migration 0048).
 * variants table used for product barcode lookup.
 *
 * FEAT-002: Add barcode column to warehouse_locations migration.
 * FEAT-002: Join products table for product_title on variants query.
 */

export async function httpGetLayout(req: Request, res: Response) {
  const shopId = req.user?.shopId;

  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // Check whether the warehouses table exists in this environment.
      // Production schema predates migration 0048's warehouses table creation —
      // the join crashes with 'relation does not exist' on prod, returning 500.
      // Fall back to null for warehouse_name when the table is absent.
      const warehousesExist = await trx.raw(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'warehouses'
        ) as exists
      `);
      const hasWarehousesTable = warehousesExist.rows[0]?.exists === true;

      const zonesQuery = trx('warehouse_locations')
        .where({ 'warehouse_locations.shop_id': shopId })
        .orderBy('warehouse_locations.location_code', 'asc')
        .select(
          'warehouse_locations.location_code',
          'warehouse_locations.type',
          'warehouse_locations.parent_location_code',
          'warehouse_locations.active',
          trx.raw(
            `(SELECT COUNT(*) FROM warehouse_locations wl2 WHERE wl2.shop_id = ? AND wl2.parent_location_code = warehouse_locations.location_code)::integer as children_count`,
            [shopId]
          ),
          'warehouse_locations.barcode',
          'warehouse_locations.position_x',
          'warehouse_locations.position_y',
          'warehouse_locations.width',
          'warehouse_locations.depth',
          'warehouse_locations.orientation',
          'warehouse_locations.rack_levels',
          'warehouse_locations.zone_type',
          'warehouse_locations.last_printed_at',
        );

      if (hasWarehousesTable) {
        // Join warehouses to resolve editable name for root warehouse node.
        // warehouse_name is non-null only on type='warehouse' rows; null on all others.
        zonesQuery
          .leftJoin('warehouses as w', function () {
            this.on('w.root_location_code', 'warehouse_locations.location_code')
                .andOn('w.shop_id', trx.raw('?', [shopId]));
          })
          .select('w.name as warehouse_name');
      } else {
        // warehouses table absent in this environment — return null for warehouse_name.
        zonesQuery.select(trx.raw('null as warehouse_name'));
      }

      const zones = await zonesQuery;

      const productBarcodes = await trx('variants as v')
        .leftJoin('external_product_identity_map as ep', function () {
          this.on('ep.lasyncro_variant_id', 'v.lasyncro_variant_id')
              .andOn('ep.shop_id', trx.raw('?', [shopId]));
        })
        .where('v.shop_id', shopId)
        .orderBy('v.created_at', 'desc')
        .leftJoin('products as p', function () {
          this.on('p.lasyncro_product_id', 'v.lasyncro_product_id')
              .andOn('p.shop_id', trx.raw('?', [shopId]));
        })
        .select(
          'v.lasyncro_variant_id',
          'v.sku',
          'p.title as product_title',
          trx.raw(`null as variant_title`),
          'ep.barcode'
        );

      return { zones, product_barcodes: productBarcodes };
    });

    return res.json(result);
  } catch (err) {
    console.error('[floor-planning] httpGetLayout failed', err);
    return res.status(500).json({ error: 'Failed to fetch floor planning layout' });
  }
}

// ISSUE-003 fix: Allows owner/admin to correct a wrong or missing barcode on a variant.
// Updates external_product_identity_map — the authoritative physical scan resolution table.
// Safe: keyed on (shop_id, lasyncro_variant_id) — one row per variant per shop.
export async function httpUpdateProductBarcode(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const lasyncroVariantId = req.params.lasyncroVariantId as string;
  const { barcode } = req.body;

  if (!barcode || typeof barcode !== 'string' || barcode.trim() === '') {
    return res.status(400).json({ error: 'barcode is required and must be a non-empty string' });
  }

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const updated = await trx('external_product_identity_map')
        .where({ lasyncro_variant_id: lasyncroVariantId, shop_id: shopId })
        .update({ barcode: barcode.trim() });

      if (updated === 0) {
        throw new Error('Variant not found in identity map');
      }
    });

    console.info('[floor-planning] barcode updated', { shopId, lasyncroVariantId, barcode });
    return res.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Variant not found in identity map') {
      return res.status(404).json({ error: err.message });
    }
    console.error('[floor-planning] httpUpdateProductBarcode failed', err);
    return res.status(500).json({ error: 'Failed to update barcode' });
  }
}

/**
 * GET /api/v1/floor-planning/grid
 * --------------------------------
 * Returns all warehouse_locations for the current shop, shaped for
 * WarehouseGrid consumption. Includes all types (warehouse/lane/shelf/bin)
 * so the grid can derive aisle groupings client-side.
 *
 * Bin occupancy is a separate endpoint (GET /grid/occupancy) to allow
 * the grid to render layout immediately while occupancy loads lazily.
 */
export async function httpGetGrid(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const locations = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return trx('warehouse_locations')
        .where({ shop_id: shopId })
        .orderBy('location_code', 'asc')
        .select(
          'location_code',
          'type',
          'parent_location_code',
          'barcode',
          'active',
          'position_x',
          'position_y',
          'width',
          'depth',
          'orientation',
          'rack_levels',
          'zone_type',
          'last_printed_at'
        );
    });

    return res.json({ locations });
  } catch (err) {
    console.error('[floor-planning] httpGetGrid failed', err);
    return res.status(500).json({ error: 'Failed to fetch grid layout' });
  }
}

/**
 * GET /api/v1/floor-planning/grid/occupancy
 * ------------------------------------------
 * Returns per-bin stock data from inventory_truth, joined to variants
 * for SKU/title context. Keyed by location_code for O(1) lookup in
 * WarehouseGrid occupancy prop.
 *
 * Loaded lazily after grid layout renders — keeps initial paint fast.
 *
 * Response shape: Record<location_code, BinOccupancy>
 *   BinOccupancy.on_hand_quantity — total units across all variants in bin
 *   BinOccupancy.variants[]       — per-variant breakdown
 */
export async function httpGetBinOccupancy(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const rows = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      return trx('inventory_truth as it')
        .where('it.shop_id', shopId)
        .where('it.on_hand_quantity', '>', 0)
        .leftJoin('variants as v', 'v.lasyncro_variant_id', 'it.lasyncro_variant_id')
        .leftJoin('products as p', function () {
          this.on('p.lasyncro_product_id', 'v.lasyncro_product_id')
              .andOn('p.shop_id', trx.raw('?', [shopId]));
        })
        .select(
          'it.location_code',
          'it.lasyncro_variant_id',
          'it.on_hand_quantity',
          'v.sku',
          'p.title as product_title'
        )
        .orderBy('it.location_code', 'asc');
    });

    // Group into Record<location_code, BinOccupancy>
    const occupancy: Record<string, {
      on_hand_quantity: number;
      variants: { lasyncro_variant_id: string; sku: string | null; product_title: string | null; on_hand_quantity: number }[];
    }> = {};

    for (const row of rows) {
      if (!occupancy[row.location_code]) {
        occupancy[row.location_code] = { on_hand_quantity: 0, variants: [] };
      }
      occupancy[row.location_code].on_hand_quantity += row.on_hand_quantity;
      occupancy[row.location_code].variants.push({
        lasyncro_variant_id: row.lasyncro_variant_id,
        sku: row.sku ?? null,
        product_title: row.product_title ?? null,
        on_hand_quantity: row.on_hand_quantity,
      });
    }

    return res.json({ occupancy });
  } catch (err) {
    console.error('[floor-planning] httpGetBinOccupancy failed', err);
    return res.status(500).json({ error: 'Failed to fetch bin occupancy' });
  }
}

/**
 * GET /api/v1/floor-planning/bin/:locationCode/log
 * -------------------------------------------------
 * Returns a merged activity timeline for a specific bin location.
 * Sources:
 *   - inventory_movements — all stock deltas at this location
 *   - pick_scan_log       — all pick scans at this location (with operator)
 *
 * Merged and sorted by occurred_at DESC, last 50 events.
 *
 * operator_id/triggered_by are nullable — populated by traceability sprint
 * writers update. NULL = pre-traceability or system-driven movement.
 *
 * TRACEABILITY SPRINT: wire operator_id into writers listed in 0107 migration.
 */
export async function httpGetBinLog(req: Request, res: Response) {
  const shopId       = req.user?.shopId;
  const locationCode = req.params.locationCode;

  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
  if (!locationCode) return res.status(400).json({ error: 'locationCode required' });

  try {
    const events = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // Stock movements at this bin
      const movements = await trx('inventory_movements as im')
        .where({ 'im.shop_id': shopId, 'im.location_code': locationCode })
        .leftJoin('variants as v', 'v.lasyncro_variant_id', 'im.lasyncro_variant_id')
        .leftJoin('users as u', 'u.id', 'im.operator_id')
        .orderBy('im.occurred_at', 'desc')
        .limit(50)
        .select(
          'im.lasyncro_inventory_movement_id as id',
          'im.movement_type',
          'im.quantity_delta',
          'im.occurred_at as event_at',
          'im.triggered_by',
          'im.reference_type',
          'im.reference_id',
          'v.sku',
          trx.raw(`u.first_name || ' ' || u.last_name as operator_name`),
          trx.raw(`'movement' as event_source`)
        );

      // Pick scans at this bin
      const picks = await trx('pick_scan_log as psl')
        .where({ 'psl.shop_id': shopId, 'psl.location_code': locationCode })
        .leftJoin('variants as v', 'v.lasyncro_variant_id', 'psl.lasyncro_variant_id')
        .leftJoin('users as u', 'u.id', 'psl.scanned_by')
        .orderBy('psl.scanned_at', 'desc')
        .limit(50)
        .select(
          'psl.scan_id as id',
          trx.raw(`'pick_scan' as movement_type`),
          trx.raw(`-psl.quantity_confirmed as quantity_delta`),
          'psl.scanned_at as event_at',
          trx.raw(`'pick_scan' as triggered_by`),
          trx.raw(`'pick_batch' as reference_type`),
          'psl.pick_batch_id as reference_id',
          'v.sku',
          trx.raw(`u.first_name || ' ' || u.last_name as operator_name`),
          trx.raw(`'pick_scan' as event_source`)
        );

      // Merge + sort by event_at DESC, cap at 50
      return [...movements, ...picks]
        .sort((a, b) => new Date(b.event_at).getTime() - new Date(a.event_at).getTime())
        .slice(0, 50);
    });

    return res.json({ location_code: locationCode, events });
  } catch (err) {
    console.error('[floor-planning] httpGetBinLog failed', err);
    return res.status(500).json({ error: 'Failed to fetch bin log' });
  }
}

/**
 * GET /api/v1/floor-planning/bin/:locationCode/stats
 * ---------------------------------------------------
 * Returns pick activity stats for a bin:
 *   picks_7d     — confirmed pick scans at this location in last 7 days
 *   last_pick_at — timestamp of most recent pick scan
 *   last_pick_by — operator name of most recent pick
 *
 * Source: pick_scan_log (immutable, tenant-scoped).
 * Used by: bin detail panel (picks 7D, last pick fields).
 *
 * TRACEABILITY SPRINT: extend with stow_tasks for last stow signal.
 */
export async function httpGetBinStats(req: Request, res: Response) {
  const shopId       = req.user?.shopId;
  const locationCode = req.params.locationCode;

  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
  if (!locationCode) return res.status(400).json({ error: 'locationCode required' });

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const since7d  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000);
      const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const [picks7d, lastPick, reorderSignals] = await Promise.all([
        trx('pick_scan_log')
          .where({ shop_id: shopId, location_code: locationCode, status: 'confirmed' })
          .where('scanned_at', '>=', since7d)
          .count('scan_id as count')
          .first(),

        trx('pick_scan_log as psl')
          .where({ 'psl.shop_id': shopId, 'psl.location_code': locationCode })
          .leftJoin('users as u', 'u.id', 'psl.scanned_by')
          .orderBy('psl.scanned_at', 'desc')
          .first()
          .select(
            'psl.scanned_at as last_pick_at',
            trx.raw(`TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) as last_pick_by`)
          ),

        /**
         * Reorder signal per variant at this bin:
         * days_of_stock = available_quantity / velocity_per_day (30d)
         * velocity_per_day = units_sold_30d / 30
         * Null if no sales velocity.
         */
        trx('inventory_truth as it')
          .where({ 'it.shop_id': shopId, 'it.location_code': locationCode })
          .where('it.available_quantity', '>', 0)
          .leftJoin(
            // shop_id must use trx.raw binding — Knex subqueries don't inherit SET LOCAL RLS context
              trx('order_revenue_units as oru')
                .where('oru.created_at', '>=', since30d)
                .groupBy('oru.lasyncro_variant_id')
                .select(
                  'oru.lasyncro_variant_id',
                  trx.raw('SUM(oru.quantity) as units_sold_30d')
                )
                .as('vel'),
            'vel.lasyncro_variant_id',
            'it.lasyncro_variant_id'
          )
          .select(
            'it.lasyncro_variant_id',
            'it.available_quantity',
            trx.raw('COALESCE(vel.units_sold_30d, 0) as units_sold_30d'),
            trx.raw(`
              CASE
                WHEN COALESCE(vel.units_sold_30d, 0) > 0
                THEN ROUND(it.available_quantity / (COALESCE(vel.units_sold_30d, 0)::float / 30))
                ELSE NULL
              END as days_of_stock
            `)
          ),
      ]);

      // Aggregate reorder signal: take the minimum days_of_stock across all variants in this bin
      const minDaysOfStock = reorderSignals
        .map((r: any) => r.days_of_stock !== null ? Number(r.days_of_stock) : null)
        .filter((d: number | null) => d !== null)
        .reduce((min: number | null, d: number) => min === null || d < min ? d : min, null);

      return {
        picks_7d:        Number(picks7d?.count ?? 0),
        last_pick_at:    lastPick?.last_pick_at ?? null,
        last_pick_by:    lastPick?.last_pick_by || null,
        reorder_in_days: minDaysOfStock,
      };
    });

    return res.json({ location_code: locationCode, ...result });
  } catch (err) {
    console.error('[floor-planning] httpGetBinStats failed', err);
    return res.status(500).json({ error: 'Failed to fetch bin stats' });
  }
}

/**
 * GET /api/v1/floor-planning/variant/:variantId/bins
 * ---------------------------------------------------
 * Returns location_codes where this variant has stock.
 * Used by: alert deep-links, future product detail page.
 * Source: inventory_truth (available_quantity > 0).
 */
export async function httpGetVariantBins(req: Request, res: Response) {
  const shopId    = req.user?.shopId;
  const variantId = req.params.variantId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const rows = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return trx('inventory_truth')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId })
        .where('available_quantity', '>', 0)
        .orderBy('location_code', 'asc')
        .select('location_code', 'available_quantity');
    });
    return res.json({ variant_id: variantId, bins: rows });
  } catch (err) {
    console.error('[floor-planning] httpGetVariantBins failed', err);
    return res.status(500).json({ error: 'Failed to fetch variant bins' });
  }
}

/**
 * POST /api/v1/floor-planning/zones
 * ----------------------------------
 * Creates a new warehouse location (aisle/lane/bin/shelf).
 * location_code must be unique per shop.
 * parent_location_code must exist if provided.
 *
 * Body: { location_code, type, parent_location_code?, barcode? }
 */
export async function httpCreateZone(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { 
    location_code, 
    type, 
    parent_location_code, 
    barcode, 
    position_x, 
    position_y, 
    width, 
    depth, 
    orientation, 
    rack_levels, 
    zone_type 
  } = req.body;

  if (!location_code || typeof location_code !== 'string' || !location_code.trim()) {
    return res.status(400).json({ error: 'location_code is required' });
  }
  if (!['warehouse', 'lane', 'shelf', 'bin'].includes(type)) {
    return res.status(400).json({ error: 'type must be warehouse | lane | shelf | bin' });
  }

  try {
    const warehouseId = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      let resolvedWarehouseId: string;

      if (parent_location_code) {
        const normalizedParentCode = parent_location_code.trim().toUpperCase();

        const parent = await trx('warehouse_locations')
          .where({
            shop_id: shopId,
            location_code: normalizedParentCode,
          })
          .select('warehouse_id')
          .first();

        if (!parent?.warehouse_id) {
          throw new Error(`Parent location not found: ${parent_location_code}`);
        }

        // Child ownership is inherited from its physical parent.
        resolvedWarehouseId = parent.warehouse_id;
      } else {
        const defaultWarehouse = await trx('warehouses')
          .where({
            shop_id: shopId,
            is_default: true,
            active: true,
          })
          .select('warehouse_id')
          .first();

        if (!defaultWarehouse?.warehouse_id) {
          throw new Error('Default warehouse not found');
        }

        // Root-level zones remain attached to the current default warehouse
        // until the warehouse selector supplies explicit context.
        resolvedWarehouseId = defaultWarehouse.warehouse_id;
      }

      await trx('warehouse_locations').insert({
        shop_id: shopId,
        warehouse_id: resolvedWarehouseId,
        location_code: location_code.trim().toUpperCase(),
        type,
        parent_location_code: parent_location_code?.trim().toUpperCase() ?? null,
        barcode: barcode?.trim() ?? null,
        active: true,
        position_x: position_x ?? null,
        position_y: position_y ?? null,
        width: width ?? null,
        depth: depth ?? null,
        orientation: orientation ?? 0,
        rack_levels: rack_levels ?? null,
        zone_type: zone_type ?? 'storage',
      });

      return resolvedWarehouseId;
    });

    console.info('[floor-planning] zone created', {
      shopId,
      warehouseId,
      locationCode: location_code.trim().toUpperCase(),
      type,
    });
    return res.status(201).json({ success: true, location_code: location_code.trim().toUpperCase() });
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `Location code already exists: ${location_code}` });
    }
    
    if (err.message?.includes('Parent location not found')) {
      return res.status(400).json({ error: err.message });
    }

    if (err.message === 'Default warehouse not found') {
      return res.status(409).json({ error: 'WAREHOUSE_NOT_CONFIGURED' });
    }

    console.error('[floor-planning] httpCreateZone failed', {
      shopId,
      locationCode: location_code,
      error: err instanceof Error ? err.message : err,
    });
    return res.status(500).json({ error: 'Failed to create zone' });
  }
}

/**
 * PATCH /api/v1/floor-planning/zones/:locationCode
 * -------------------------------------------------
 * Updates a zone's active status, barcode, or parent.
 * location_code itself is immutable (it's the PK).
 *
 * Body: { active?, barcode?, parent_location_code? }
 */
export async function httpUpdateZone(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const locationCode = req.params.locationCode;
  const { 
    active, 
    barcode, 
    parent_location_code, 
    position_x, 
    position_y, 
    width, 
    depth, 
    orientation, 
    rack_levels, 
    zone_type 
  } = req.body;

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const updates: Record<string, unknown> = { updated_at: new Date() };
      if (active !== undefined)               updates.active = active;
      if (barcode !== undefined)              updates.barcode = barcode?.trim() ?? null;
      if (parent_location_code !== undefined) updates.parent_location_code = parent_location_code?.trim() ?? null;
      if (position_x !== undefined)           updates.position_x = position_x ?? null;
      if (position_y !== undefined)           updates.position_y = position_y ?? null;
      if (width !== undefined)                updates.width = width ?? null;
      if (depth !== undefined)                updates.depth = depth ?? null;
      if (orientation !== undefined)          updates.orientation = orientation ?? 0;
      if (rack_levels !== undefined)          updates.rack_levels = rack_levels ?? null;
      if (zone_type !== undefined)            updates.zone_type = zone_type ?? null;

      const updated = await trx('warehouse_locations')
        .where({ shop_id: shopId, location_code: locationCode })
        .update(updates);

      if (updated === 0) throw new Error('Zone not found');
    });

    return res.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Zone not found') return res.status(404).json({ error: err.message });
    if (err.code === '23505') return res.status(409).json({ error: 'Barcode already assigned to another location' });
    console.error('[floor-planning] httpUpdateZone failed', err);
    return res.status(500).json({ error: 'Failed to update zone' });
  }
}

/**
 * DELETE /api/v1/floor-planning/zones/:locationCode
 * --------------------------------------------------
 * Deletes a zone. Blocked if zone is a warehouse root (parent_location_code IS NULL)
 * or has inventory. Children deletion is blocked by ON DELETE RESTRICT — parent must be
 * emptied before removal. Root lifecycle belongs to Settings › Warehouse (ISS-236).
 */
export async function httpDeleteZone(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const locationCode = req.params.locationCode;

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      // Block delete of warehouse root — lifecycle belongs to Settings › Warehouse (ISS-236)
      const location = await trx('warehouse_locations')
        .where({ shop_id: shopId, location_code: locationCode })
        .select('parent_location_code')
        .first();
      if (!location) throw new Error('Zone not found');
      if (location.parent_location_code === null) {
        throw new Error('Cannot delete the warehouse root. Manage warehouses in Settings › Warehouse.');
      }
      // Block delete if bin has stock
      const stock = await trx('inventory_truth')
        .where({ shop_id: shopId, location_code: locationCode })
        .where('on_hand_quantity', '>', 0)
        .first();

      if (stock) {
        throw new Error('Cannot delete a location with stock. Move or adjust inventory first.');
      }

      const deleted = await trx('warehouse_locations')
        .where({ shop_id: shopId, location_code: locationCode })
        .delete();

      if (deleted === 0) throw new Error('Zone not found');
    });

    console.info('[floor-planning] zone deleted', { shopId, locationCode });
    return res.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Zone not found') return res.status(404).json({ error: err.message });
    if (err.message?.includes('Cannot delete')) return res.status(409).json({ error: err.message });
    console.error('[floor-planning] httpDeleteZone failed', err);
    return res.status(500).json({ error: 'Failed to delete zone' });
  }
}

// FP-15: now generates and returns a real PDF label instead of only
// updating last_printed_at. Previously this button gave false confidence
// that a physical label was produced when nothing was ever rendered.
export async function httpPrintBarcode(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
  const { locationCode } = req.params;
  try {
    const { updated, childBinCodes } = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      const updated = await trx('warehouse_locations')
        .where({ shop_id: shopId, location_code: locationCode })
        .update({ last_printed_at: trx.fn.now() })
        .returning(['location_code', 'last_printed_at', 'type', 'zone_type']);

      let childBinCodes: string[] = [];
      if (updated[0]?.type === 'lane') {
        const children = await trx('warehouse_locations')
          .where({ shop_id: shopId, parent_location_code: locationCode })
          .orderBy('location_code')
          .select('location_code');
        childBinCodes = children.map((c) => c.location_code);
      }
      return { updated, childBinCodes };
    });

    if (!Array.isArray(updated) || !updated.length) return res.status(404).json({ error: 'Zone not found' });

    const pdfBuffer = await generateWarehouseLabelPdf(updated[0], childBinCodes);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${updated[0].location_code}.pdf"`);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('[floor-planning] httpPrintBarcode failed', err);
    return res.status(500).json({ error: 'Failed to generate label' });
  }
}