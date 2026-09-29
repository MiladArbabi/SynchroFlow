// apps/backend/src/api/floor-planning/floor-planning.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import { meetsTier } from '../../middleware/require-entitlement.middleware.js';
import { 
  generateWarehouseLabelPdf, 
  generateWarehouseLabelSheetPdf, 
  WarehouseLabelZone
} from '../../services/wms/warehouseLabelPdf.service.js';
import {
  generateProductLabelPdf,
  generateProductLabelSheetPdf,
  ProductLabelVariant
} from '../../services/wms/productLabelPdf.service.js';
import { ensureVariantBarcode } from '../../services/wms/productBarcode.service.js';

/**
 * FLOOR PLANNING CONTROLLERS
 * ---------------------------
 * All queries are tenant-scoped via req.user.shopId + RLS current_tenant.
 *
 * warehouse_locations table exists (migration 0048).
 * variants table used for product barcode lookup.
 *
 * REV-HARD-01: barcode column present; nullable by design (override only).
 * FEAT-002: Join products table for product_title on variants query.
 */

const DOCK_FACES = ['north', 'south', 'east', 'west', 'none'] as const;
type DockFace = typeof DOCK_FACES[number];

const isDockFace = (value: unknown): value is DockFace =>
  typeof value === 'string' && (DOCK_FACES as readonly string[]).includes(value);

const isDockZoneType = (value: unknown): boolean =>
  value === 'ship' || value === 'receive';

/**
 * FP-GATE1 — spatial fields are Growth-tier.
 *
 * Routes are gated at 'starter' (see floor-planning.routes.ts header).
 * Zone create/update accept List-tab attributes and Canvas geometry in the
 * same payload, so the Growth boundary is enforced per-field here.
 *
 * Membership rationale: the List tab never sends any of these. Confirmed
 * against CreateZonePayload (useZoneManagement.ts — location_code, type,
 * parent_location_code, barcode only) and the List create form
 * (FloorPlanningModuleFT2.tsx). rack_levels is written exclusively by the
 * Canvas inspector (CanvasEditor.tsx), and is only READ elsewhere for the
 * capacity heuristic — reads are unrestricted, so guarding the write costs
 * Starter nothing. zone_type is deliberately NOT here: it's a functional
 * attribute (FP-01 chip), not geometry.
 */
const GROWTH_SPATIAL_FIELDS = [
  'position_x',
  'position_y',
  'width',
  'depth',
  'orientation',
  'rack_levels',
  'dock_face',
] as const;

/**
 * Returns true when the request was rejected (response already sent).
 *
 * Rejects rather than silently stripping: a strip would discard a
 * downgraded Growth shop's canvas edits with no signal, and would mask
 * frontend bugs. A field is "present" only when it carries a meaningful
 * value — undefined and null are no-ops, and orientation defaults to 0,
 * so 0 is not a spatial assertion either.
 */
function rejectSpatialFieldsBelowGrowth(req: Request, res: Response): boolean {
  if (meetsTier(req, 'growth')) return false;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const offending = GROWTH_SPATIAL_FIELDS.filter((field) => {
    const value = body[field];
    if (value === undefined) return false;

    // ZONE-SHAPE-01b: null explicitly restores automatic dock-face selection.
    if (field === 'dock_face') return true;

    if (value === null) return false;
    if (field === 'orientation') return value !== 0;
    return true;
  });

  if (offending.length === 0) return false;

  console.warn('[floor-planning] FP-GATE1 spatial field rejected', {
    shopId: req.user?.shopId,
    path: req.path,
    fields: offending,
  });

  res.status(403).json({
    error: 'TIER_INSUFFICIENT_FIELD',
    required: 'growth',
    current: req.user?.tier ?? 'starter',
    fields: offending,
  });
  return true;
}

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
          'warehouse_locations.dock_face',
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
          'ep.barcode',
          'v.lasyncro_barcode'
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
 * POST /api/v1/floor-planning/products/:lasyncroVariantId/print
 * ---------------------------------------------------------------
 * SHOP-REV-01g — the endpoint whose absence produced Shopify review
 * citation 2.1.1 (ref 102766). Mints the LSP- identity on demand if the
 * variant has none, then renders a scannable thermal label.
 *
 * Mint-on-demand mirrors ensureOrderWmsBarcode (SHOP-REV-01f): the
 * merchant never has to trigger generation as a separate step, and a
 * reprint returns the same barcode because the value is persisted, not
 * derived.
 *
 * variants is FORCE ROW LEVEL SECURITY (migration 0027) — every read and
 * write here must run inside the SET LOCAL tenant context or the policy
 * returns zero rows.
 */
export async function httpPrintProductBarcode(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const lasyncroVariantId = req.params.lasyncroVariantId as string;

  try {
    const variant = await db.transaction<ProductLabelVariant | null>(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const barcode = await ensureVariantBarcode(trx, shopId, lasyncroVariantId);
      if (!barcode) return null;

      const row = await trx('variants as v')
        .leftJoin('products as p', function () {
          this.on('p.lasyncro_product_id', 'v.lasyncro_product_id')
              .andOn('p.shop_id', trx.raw('?', [shopId]));
        })
        .where({ 'v.lasyncro_variant_id': lasyncroVariantId, 'v.shop_id': shopId })
        .select(
          'v.lasyncro_variant_id',
          'v.lasyncro_barcode',
          'v.sku',
          'p.title as product_title',
          'v.title as variant_title'
        )
        .first();

      return row ?? null;
    });

    if (!variant) return res.status(404).json({ error: 'Variant not found' });

    const pdfBuffer = await generateProductLabelPdf(variant);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${variant.lasyncro_barcode}.pdf"`);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('[floor-planning] httpPrintProductBarcode failed', err);
    return res.status(500).json({ error: 'Failed to generate product label' });
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
 * Response shape:
 *   occupancy: Record<location_code, BinOccupancy> — LEGACY, positive-only
 *     BinOccupancy.on_hand_quantity — total units across all variants in bin
 *     BinOccupancy.variants[]       — per-variant breakdown
 *   inventoryInspection: Record<location_code, LocationStockDetail> — additive
 *     Every canonical inventory_truth row (positive, zero AND negative
 *     on_hand), with on_hand / available / reserved each summed from its own
 *     column; on_hand stays signed. A location absent here has no canonical
 *     truth record — it is not zero.
 *
 * Both projections come from ONE inventory_truth rowset. The legacy
 * `occupancy` keeps only on_hand > 0 rows so Overview / Floor Planning never
 * receive zero or signed rows through it.
 */
export async function httpGetBinOccupancy(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const rows = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // Canonical rowset — deliberately NOT filtered by on_hand > 0. Metadata
      // joins are LEFT so a physical row never disappears for missing SKU/titles.
      return trx('inventory_truth as it')
        .where('it.shop_id', shopId)
        .leftJoin('variants as v', 'v.lasyncro_variant_id', 'it.lasyncro_variant_id')
        .leftJoin('products as p', function () {
          this.on('p.lasyncro_product_id', 'v.lasyncro_product_id')
              .andOn('p.shop_id', trx.raw('?', [shopId]));
        })
        .select(
          'it.location_code',
          'it.lasyncro_variant_id',
          'it.on_hand_quantity',
          'it.available_quantity',
          'it.reserved_quantity',
          'v.sku',
          'v.title as variant_title',
          'p.title as product_title'
        )
        .orderBy('it.location_code', 'asc');
    });

    // Group into Record<location_code, BinOccupancy>
    const occupancy: Record<string, {
      on_hand_quantity: number;
      variants: { lasyncro_variant_id: string; sku: string | null; product_title: string | null; on_hand_quantity: number }[];
    }> = {};

    // Additive inspection projection — every canonical row, signed.
    const inventoryInspection: Record<string, {
      on_hand_quantity: number;
      available_quantity: number;
      reserved_quantity: number;
      variants: {
        lasyncro_variant_id: string;
        sku: string | null;
        product_title: string | null;
        variant_title: string | null;
        on_hand_quantity: number;
        available_quantity: number;
        reserved_quantity: number;
      }[];
    }> = {};

    for (const row of rows) {
      const onHand = Number(row.on_hand_quantity);
      const available = Number(row.available_quantity);
      const reserved = Number(row.reserved_quantity);

      if (!inventoryInspection[row.location_code]) {
        inventoryInspection[row.location_code] = {
          on_hand_quantity: 0,
          available_quantity: 0,
          reserved_quantity: 0,
          variants: [],
        };
      }
      const inspection = inventoryInspection[row.location_code];
      inspection.on_hand_quantity += onHand;
      inspection.available_quantity += available;
      inspection.reserved_quantity += reserved;
      inspection.variants.push({
        lasyncro_variant_id: row.lasyncro_variant_id,
        sku: row.sku ?? null,
        product_title: row.product_title ?? null,
        variant_title: row.variant_title ?? null,
        on_hand_quantity: onHand,
        available_quantity: available,
        reserved_quantity: reserved,
      });

      // Legacy projection — unchanged positive-only contract.
      if (!(row.on_hand_quantity > 0)) continue;
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

    return res.json({ occupancy, inventoryInspection });
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
 * Body: { location_code, type, parent_location_code?, barcode?, zone_type? }
 * Growth only: { position_x?, position_y?, width?, depth?, orientation?, rack_levels? }
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
    zone_type,
    dock_face
    } = req.body;

  if (!location_code || typeof location_code !== 'string' || !location_code.trim()) {
    return res.status(400).json({ error: 'location_code is required' });
  }
  if (!['warehouse', 'lane', 'shelf', 'bin'].includes(type)) {
    return res.status(400).json({ error: 'type must be warehouse | lane | shelf| bin' });
  }

  if (dock_face !== undefined && dock_face !== null && !isDockFace(dock_face)) {
    return res.status(400).json({
      error: 'dock_face must be north | south | east | west | none | null',
    });
  }

  const effectiveZoneType = zone_type ?? 'storage';

  if (dock_face !== undefined && dock_face !== null && !isDockZoneType(effectiveZoneType)) {
    return res.status(400).json({
      error: 'dock_face requires zone_type ship or receive',
    });
  }

  // FP-GATE1: Growth gate for geometry.. The List create form never sends
  // these — this is defence against crafted requests, not a UI path.
  if (rejectSpatialFieldsBelowGrowth(req, res)) return;

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
        zone_type: effectiveZoneType,
        // ZONE-SHAPE-01c-ii: a dock created without explicit direction defaults
        // to 'none' (solid, honest, merchant-changeable) rather than NULL/Auto.
        // Auto silently renders solid when geometry is ambiguous, which reads as
        // a settled choice the merchant never made. Non-dock zones must stay
        // NULL — the 0150 check constraint rejects any face on other types.
        dock_face: isDockZoneType(effectiveZoneType)
          ? (dock_face ?? 'none')
          : null,
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


type BulkActionError = Error & { statusCode?: number };

function bulkActionError(message: string, statusCode: number): BulkActionError {
  const err = new Error(message) as BulkActionError;
  err.statusCode = statusCode;
  return err;
}

function componentCodePrefix(type: string, zoneType: string | null): string | null {
  if (type === 'lane' && zoneType === 'pick') return 'AISLE';
  if (type !== 'bin') return null;

  switch (zoneType) {
    case 'pick': return 'PICK';
    case 'pack': return 'PACK';
    case 'receive': return 'RECEIVE';
    case 'ship': return 'SHIP';
    case 'problem': return 'PROBLEM';
    case 'returns': return 'RETURNS';
    case 'quarantine': return 'QUARANTINE';
    case 'kitting': return 'MATERIALS';
    default: return null;
  }
}

function nextLocationCode(prefix: string, usedCodes: Set<string>): string {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}-(\\d+)$`, 'i');
  const usedSuffixes = new Set<number>();

  for (const code of usedCodes) {
    const match = pattern.exec(code);
    if (!match) continue;

    const suffix = Number(match[1]);
    if (Number.isSafeInteger(suffix) && suffix > 0) {
      usedSuffixes.add(suffix);
    }
  }

  let suffix = 1;
  while (usedSuffixes.has(suffix)) suffix += 1;

  const code = `${prefix}-${String(suffix).padStart(2, '0')}`;
  usedCodes.add(code);
  return code;
}

/**
 * POST /api/v1/floor-planning/zones/duplicate
 *
 * Atomically duplicates a selected set using one common spatial translation.
 * Codes are derived from persisted semantic type/zone_type, never source code.
 */
export async function httpDuplicateZones(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const locationCodes = req.body?.location_codes;
  const offset = req.body?.offset;

  if (!Array.isArray(locationCodes) || locationCodes.length === 0) {
    return res.status(400).json({ error: 'location_codes must be a non-empty array' });
  }

  const normalizedCodes: string[] = [];
  const seen = new Set<string>();

  for (const value of locationCodes) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid location_code' });
    }

    const code = value.trim();
    if (seen.has(code)) {
      return res.status(400).json({ error: 'Duplicate location_code in request' });
    }

    seen.add(code);
    normalizedCodes.push(code);
  }

  if (
    !offset
    || typeof offset !== 'object'
    || typeof offset.x !== 'number'
    || !Number.isFinite(offset.x)
    || typeof offset.y !== 'number'
    || !Number.isFinite(offset.y)
  ) {
    return res.status(400).json({ error: 'offset.x and offset.y must be finite numbers' });
  }

  if (!meetsTier(req, 'growth')) {
    return res.status(403).json({
      error: 'TIER_INSUFFICIENT_FIELD',
      required: 'growth',
      current: req.user?.tier ?? 'starter',
      fields: ['position_x', 'position_y'],
    });
  }

  try {
    const created = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const sources = await trx('warehouse_locations')
        .where({ shop_id: shopId })
        .whereIn('location_code', normalizedCodes)
        .select(
          'location_code',
          'warehouse_id',
          'type',
          'parent_location_code',
          'active',
          'position_x',
          'position_y',
          'width',
          'depth',
          'orientation',
          'rack_levels',
          'zone_type',
          'dock_face',
        )
        .forUpdate();

      if (sources.length !== normalizedCodes.length) {
        throw bulkActionError('Zone not found', 404);
      }

      if (sources.some((row: { type: string }) => row.type === 'warehouse')) {
        throw bulkActionError('Warehouse root cannot be duplicated', 400);
      }

      const sourceByCode = new Map(
        sources.map((row) => [row.location_code, row] as const),
      );

      const allCodes = await trx('warehouse_locations')
        .where({ shop_id: shopId })
        .select('location_code');

      const usedCodes = new Set<string>(
        allCodes.map((row: { location_code: string }) => row.location_code),
      );

      const now = new Date();
      const result: Array<{
        source_location_code: string;
        location_code: string;
      }> = [];

      for (const sourceCode of normalizedCodes) {
        const source = sourceByCode.get(sourceCode);
        if (!source) throw bulkActionError('Zone not found', 404);

        const prefix = componentCodePrefix(source.type, source.zone_type);
        if (!prefix) {
          throw bulkActionError(
            `Unsupported component role for duplication: ${source.location_code}`,
            400,
          );
        }

        const locationCode = nextLocationCode(prefix, usedCodes);

        await trx('warehouse_locations').insert({
          shop_id: shopId,
          warehouse_id: source.warehouse_id,
          location_code: locationCode,
          type: source.type,
          parent_location_code: source.parent_location_code,
          barcode: null,
          active: source.active,
          position_x:
            source.position_x == null
              ? null
              : Number(source.position_x) + offset.x,
          position_y:
            source.position_y == null
              ? null
              : Number(source.position_y) + offset.y,
          width: source.width,
          depth: source.depth,
          orientation: source.orientation ?? 0,
          rack_levels: source.rack_levels,
          zone_type: source.zone_type,
          dock_face: source.dock_face,
          created_at: now,
          updated_at: now,
        });

        result.push({
          source_location_code: source.location_code,
          location_code: locationCode,
        });
      }

      return result;
    });

    return res.status(201).json({
      success: true,
      created,
    });
  } catch (err: unknown) {
    const statusCode =
      err instanceof Error
        ? (err as BulkActionError).statusCode
        : undefined;

    if (statusCode) {
      return res.status(statusCode).json({
        error: err instanceof Error ? err.message : 'Bulk duplicate failed',
      });
    }

    console.error('[floor-planning] httpDuplicateZones failed', err);
    return res.status(500).json({ error: 'Failed to duplicate zones' });
  }
}

/**
 * DELETE /api/v1/floor-planning/zones
 *
 * Atomically deletes a selected set after validating the complete set.
 */
export async function httpDeleteZones(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const locationCodes = req.body?.location_codes;

  if (!Array.isArray(locationCodes) || locationCodes.length === 0) {
    return res.status(400).json({ error: 'location_codes must be a non-empty array' });
  }

  const normalizedCodes: string[] = [];
  const seen = new Set<string>();

  for (const value of locationCodes) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid location_code' });
    }

    const code = value.trim();
    if (seen.has(code)) {
      return res.status(400).json({ error: 'Duplicate location_code in request' });
    }

    seen.add(code);
    normalizedCodes.push(code);
  }

  try {
    const deleted = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const locations = await trx('warehouse_locations')
        .where({ shop_id: shopId })
        .whereIn('location_code', normalizedCodes)
        .select('location_code', 'type', 'parent_location_code')
        .forUpdate();

      if (locations.length !== normalizedCodes.length) {
        throw bulkActionError('Zone not found', 404);
      }

      if (locations.some((row: { type: string }) => row.type === 'warehouse')) {
        throw bulkActionError(
          'Cannot delete the warehouse root. Manage warehouses in Settings › Warehouse.',
          409,
        );
      }

      const stocked = await trx('inventory_truth')
        .where({ shop_id: shopId })
        .whereIn('location_code', normalizedCodes)
        .where('on_hand_quantity', '>', 0)
        .first();

      if (stocked) {
        throw bulkActionError(
          'Cannot delete a location with stock. Move or adjust inventory first.',
          409,
        );
      }

      const externalChildren = await trx('warehouse_locations')
        .where({ shop_id: shopId })
        .whereIn('parent_location_code', normalizedCodes)
        .whereNotIn('location_code', normalizedCodes)
        .first('location_code', 'parent_location_code');

      if (externalChildren) {
        throw bulkActionError(
          'Cannot delete a location with dependent components outside this selection.',
          409,
        );
      }

      // Delete deepest selected descendants first so the existing
      // parent_location_code ON DELETE RESTRICT contract remains intact.
      const remaining = new Map(
        locations.map((row: {
          location_code: string;
          parent_location_code: string | null;
        }) => [row.location_code, row]),
      );

      let deletedCount = 0;

      while (remaining.size > 0) {
        const leaves = [...remaining.values()].filter(
          (candidate) =>
            ![...remaining.values()].some(
              (other) => other.parent_location_code === candidate.location_code,
            ),
        );

        if (leaves.length === 0) {
          throw bulkActionError('Invalid location hierarchy', 409);
        }

        const leafCodes = leaves.map((row) => row.location_code);

        const count = await trx('warehouse_locations')
          .where({ shop_id: shopId })
          .whereIn('location_code', leafCodes)
          .delete();

        if (count !== leafCodes.length) {
          throw bulkActionError('Zone not found', 404);
        }

        deletedCount += count;
        for (const code of leafCodes) remaining.delete(code);
      }

      return deletedCount;
    });

    return res.json({
      success: true,
      deleted,
    });
  } catch (err: unknown) {
    const statusCode =
      err instanceof Error
        ? (err as BulkActionError).statusCode
        : undefined;

    if (statusCode) {
      return res.status(statusCode).json({
        error: err instanceof Error ? err.message : 'Bulk delete failed',
      });
    }

    console.error('[floor-planning] httpDeleteZones failed', err);
    return res.status(500).json({ error: 'Failed to delete zones' });
  }
}

/**
 * PATCH /api/v1/floor-planning/zones/positions
 * -------------------------------------------------
 * Atomically updates the canvas position of multiple tenant-owned locations.
 *
 * Body:
 * {
 *   positions: Array<{
 *     location_code: string;
 *     position_x: number;
 *     position_y: number;
 *   }>
 * }
 *
 * Contract:
 * - all requested locations must belong to the authenticated shop;
 * - warehouse/root locations cannot be moved through this operation;
 * - duplicate / malformed entries are rejected before mutation;
 * - all updates commit together or roll back together.
 */

export async function httpUpdateZonePositions(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const positions = req.body?.positions;

  if (!Array.isArray(positions) || positions.length === 0) {
    return res.status(400).json({
      error: 'positions must be a non-empty array',
    });
  }

  const seen = new Set<string>();

  for (const item of positions) {
    if (!item || typeof item !== 'object') {
      return res.status(400).json({ error: 'Invalid position entry' });
    }

    const locationCode = item.location_code;
    const positionX = item.position_x;
    const positionY = item.position_y;

    if (
      typeof locationCode !== 'string'
      || locationCode.trim().length === 0
      || typeof positionX !== 'number'
      || !Number.isFinite(positionX)
      || positionX < 0
      || typeof positionY !== 'number'
      || !Number.isFinite(positionY)
      || positionY < 0
    ) {
      return res.status(400).json({ error: 'Invalid position entry' });
    }

    const normalizedCode = locationCode.trim();

    if (seen.has(normalizedCode)) {
      return res.status(400).json({
        error: 'Duplicate location_code in positions',
      });
    }

    seen.add(normalizedCode);
  }

  // Same spatial-write boundary as the single-zone Canvas update path.
  // The route capability currently requires Growth+, so this is normally
  // redundant, but preserves the field-level contract if entitlement policy
  // changes independently later.
  if (!meetsTier(req, 'growth')) {
    return res.status(403).json({
      error: 'TIER_INSUFFICIENT_FIELD',
      required: 'growth',
      current: req.user?.tier ?? 'starter',
      fields: ['position_x', 'position_y'],
    });
  }

  try {
    const updatedCount = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const requestedCodes = positions.map(
        (item: { location_code: string }) => item.location_code.trim(),
      );

      // Lock the complete requested set before mutation. Tenant scoping is
      // explicit even with RLS so a foreign location is indistinguishable
      // from a missing one.
      const existing = await trx('warehouse_locations')
        .where({ shop_id: shopId })
        .whereIn('location_code', requestedCodes)
        .select('location_code', 'type')
        .forUpdate();

      if (existing.length !== requestedCodes.length) {
        const err = new Error('Zone not found');
        (err as Error & { statusCode?: number }).statusCode = 404;
        throw err;
      }

      if (existing.some((row: { type: string }) => row.type === 'warehouse')) {
        const err = new Error('Warehouse root cannot be moved');
        (err as Error & { statusCode?: number }).statusCode = 400;
        throw err;
      }

      const now = new Date();

      for (const item of positions as Array<{
        location_code: string;
        position_x: number;
        position_y: number;
      }>) {
        const locationCode = item.location_code.trim();

        const count = await trx('warehouse_locations')
          .where({
            shop_id: shopId,
            location_code: locationCode,
          })
          .update({
            position_x: item.position_x,
            position_y: item.position_y,
            updated_at: now,
          });

        if (count !== 1) {
          const err = new Error('Zone not found');
          (err as Error & { statusCode?: number }).statusCode = 404;
          throw err;
        }
      }

      return positions.length;
    });

    return res.json({
      success: true,
      updated: updatedCount,
    });
  } catch (err: unknown) {
    const statusCode =
      err instanceof Error
        ? (err as Error & { statusCode?: number }).statusCode
        : undefined;

    if (statusCode === 404) {
      return res.status(404).json({ error: 'Zone not found' });
    }

    if (statusCode === 400) {
      return res.status(400).json({
        error: err instanceof Error
          ? err.message
          : 'Invalid position update',
      });
    }

    console.error('[floor-planning] httpUpdateZonePositions failed', err);
    return res.status(500).json({
      error: 'Failed to update zone positions',
    });
  }
}

type BoundaryRow = {
  location_code: string;
  position_x: unknown;
  position_y: unknown;
  width: unknown;
  depth: unknown;
};

const BOUNDARY_EDGE_EPSILON = 1e-6;

/**
 * GH-1176: Canvas renders a positioned component with a null width/depth at
 * 1m x 0.8m (CanvasEditor DEFAULT_COMPONENT_FOOTPRINT). Containment uses the
 * same footprint so an accepted resize can never clip a visible component.
 * Evaluation only — never persisted onto the component.
 */
const NULL_SIZE_COMPONENT_FOOTPRINT = { width: 1, depth: 0.8 } as const;

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * GH-1176 — positioned non-root components a resized warehouse root would
 * newly exclude: inside the current boundary on that axis, outside the next.
 * Growing a dimension can never be rejected. The origin is the persisted root
 * x/y, or the implicit (0,0) of a fresh root. Child edges: right = x + width,
 * bottom = y + depth, with a null size taken as NULL_SIZE_COMPONENT_FOOTPRINT.
 */
function componentsExcludedByRootResize(
  root: BoundaryRow,
  next: { width?: unknown; depth?: unknown },
  children: BoundaryRow[],
): string[] {
  const originX = finiteOrNull(root.position_x) ?? 0;
  const originY = finiteOrNull(root.position_y) ?? 0;
  const axes = [
    { next: finiteOrNull(next.width), current: finiteOrNull(root.width), start: originX, pos: 'position_x' as const, size: 'width' as const },
    { next: finiteOrNull(next.depth), current: finiteOrNull(root.depth), start: originY, pos: 'position_y' as const, size: 'depth' as const },
  ].filter((axis) => axis.next !== null);

  return children
    .filter((child) => axes.some((axis) => {
      const edge = Number(child[axis.pos])
        + (finiteOrNull(child[axis.size]) ?? NULL_SIZE_COMPONENT_FOOTPRINT[axis.size]);
      const outsideNext = edge > axis.start + (axis.next as number) + BOUNDARY_EDGE_EPSILON;
      const insideCurrent = axis.current === null || edge <= axis.start + axis.current + BOUNDARY_EDGE_EPSILON;
      return outsideNext && insideCurrent;
    }))
    .map((child) => child.location_code);
}

class WarehouseBoundaryError extends Error {
  constructor(readonly locationCodes: string[]) {
    super('WAREHOUSE_BOUNDARY_EXCLUDES_COMPONENTS');
  }
}

/**
 * PATCH /api/v1/floor-planning/zones/:locationCode
 * -------------------------------------------------
 * Updates a zone's active status, barcode, or parent.
 * location_code itself is immutable (it's the PK).
 *
 * Body: { active?, barcode?, parent_location_code?, zone_type? }
 * Growth only: { position_x?, position_y?, width?, depth?, orientation?, rack_levels? }
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
    zone_type,
    dock_face
  } = req.body;

  if (dock_face !== undefined && dock_face !== null && !isDockFace(dock_face)) {
    return res.status(400).json({
      error: 'dock_face must be north | south | east | west | none | null',
    });
  }

  // FP-GATE1: Growth gate for geometry. This is the ONLY spatial write path
  // in the module — Canvas drag/resize persists through looped PATCH calls
  // here, so this guard is the entire Growth boundary for floor planning.
  if (rejectSpatialFieldsBelowGrowth(req, res)) return;

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    const current = await trx('warehouse_locations')
      .where({ shop_id: shopId, location_code: locationCode })
      .select('location_code', 'zone_type', 'type', 'warehouse_id', 'position_x', 'position_y', 'width', 'depth')
      .forUpdate()
      .first();

    if (!current) throw new Error('Zone not found');

    // GH-1176: the warehouse root is the floor boundary. Resizing it must not
    // exclude any positioned component; components are never moved to fit.
    if (current.type === 'warehouse' && (width !== undefined || depth !== undefined)) {
      const childQuery = trx('warehouse_locations')
        .where({ shop_id: shopId })
        .whereNot('type', 'warehouse')
        .whereNotNull('position_x')
        .whereNotNull('position_y');
      if (current.warehouse_id) childQuery.where('warehouse_id', current.warehouse_id);
      const children: BoundaryRow[] = await childQuery
        .select('location_code', 'position_x', 'position_y', 'width', 'depth');

      const excluded = componentsExcludedByRootResize(current, { width, depth }, children);
      if (excluded.length > 0) throw new WarehouseBoundaryError(excluded);
    }

    const nextZoneType =
      zone_type !== undefined ? zone_type : current.zone_type;

    if (
      dock_face !== undefined &&
      dock_face !== null &&
      !isDockZoneType(nextZoneType)
    ) {
      throw new Error('dock_face requires zone_type ship or receive');
    }

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

      // ZONE-SHAPE-01b: leaving a dock zone clears stale physical dock intent.
      // Otherwise explicit null restores Auto and explicit faces persist merchant truth.
      if (zone_type !== undefined && !isDockZoneType(nextZoneType)) {
        updates.dock_face = null;
      } else if (dock_face !== undefined) {
        updates.dock_face = dock_face;
      }

      const updated = await trx('warehouse_locations')
        .where({ shop_id: shopId, location_code: locationCode })
        .update(updates);

      if (updated === 0) throw new Error('Zone not found');
    });

    return res.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Zone not found') return res.status(404).json({ error: err.message });
    if (err.message === 'dock_face requires zone_type ship or receive') {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof WarehouseBoundaryError) {
      return res.status(422).json({
        error: err.message,
        message: 'Existing mapped components would fall outside the warehouse boundary.',
        location_codes: err.locationCodes,
      });
    }
    if (err.code === '23505') return res.status(409).json({ error: 'Barcode already assigned to another location' });
    console.error('[floor-planning] httpUpdateZone failed', err);
    return res.status(500).json({ error: 'Failed to update zone' });
  }
}

/**
 * DELETE /api/v1/floor-planning/zones/:locationCode
 * --------------------------------------------------
 * Deletes a zone. Blocked if zone is a warehouse root (type = 'warehouse')
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
        .select('type')
        .first();
      if (!location) throw new Error('Zone not found');
      if (location.type === 'warehouse') {
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

// FP-16: batch print for the Barcodes tab's multi-select UI. Re-fetches
// zones by code rather than trusting client-supplied zone data — same
// principle as httpPrintBarcode. Filters to barcode-assigned + active,
// mirroring the rule PrintPreviewPanel already applied client-side for
// its preview, so what gets printed matches what was previewed.
export async function httpBatchPrintBarcodes(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
  const { locationCodes, formatId } = req.body as { locationCodes?: string[]; formatId?: string };
  if (!Array.isArray(locationCodes) || locationCodes.length === 0) {
    return res.status(400).json({ error: 'locationCodes required' });
  }
  try {
    const zones = await db.transaction<WarehouseLabelZone[]>(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      // REV-HARD-01: printability is NOT gated on `barcode`. The renderer
      // (warehouseLabelPdf.service) draws Code128 from location_code, which is
      // non-null and part of the PK — every active location is printable.
      // `barcode` is an optional merchant override for pre-existing rack labels.
      const rows = await trx('warehouse_locations')
        .where({ shop_id: shopId })
        .whereIn('location_code', locationCodes)
        .andWhere({ active: true })
        .orderBy('location_code')
        .select('location_code', 'type', 'zone_type', 'barcode');
      return rows;
    });

    if (!zones.length) return res.status(404).json({ error: 'No printable zones in selection' });

    const pdfBuffer = await generateWarehouseLabelSheetPdf(zones, formatId ?? 'avery-5160');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="warehouse-labels.pdf"');
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('[floor-planning] httpBatchPrintBarcodes failed', err);
    return res.status(500).json({ error: 'Failed to generate label sheet' });
  }
}

/**
 * POST /api/v1/floor-planning/products/print-batch
 * -------------------------------------------------
 * SHOP-REV-01m. Re-fetches variants by id rather than trusting client
 * payload — same principle as httpBatchPrintBarcodes.
 *
 * Mints LSP- for any selected variant that lacks one, so a merchant can
 * select 200 unlabelled products and get 200 labels in one action rather
 * than printing each to trigger its mint.
 * 
 * The mint loop is sequential per variant, reusing ensureVariantBarcode's
 * savepoint path rather than a bulk UPDATE. At catalog scale (50k SKUs) this
 * is the obvious optimisation target — measure before changing it.
 */
export async function httpBatchPrintProductBarcodes(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { lasyncroVariantIds, formatId } = req.body as { lasyncroVariantIds?: string[]; formatId?: string };
  if (!Array.isArray(lasyncroVariantIds) || lasyncroVariantIds.length === 0) {
    return res.status(400).json({ error: 'lasyncroVariantIds required' });
  }

  try {
    const variants = await db.transaction<ProductLabelVariant[]>(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      for (const id of lasyncroVariantIds) {
        await ensureVariantBarcode(trx, shopId, id);
      }

      const rows = await trx('variants as v')
        .leftJoin('products as p', function () {
          this.on('p.lasyncro_product_id', 'v.lasyncro_product_id')
              .andOn('p.shop_id', trx.raw('?', [shopId]));
        })
        .where('v.shop_id', shopId)
        .whereIn('v.lasyncro_variant_id', lasyncroVariantIds)
        .whereNotNull('v.lasyncro_barcode')
        .orderBy('v.sku')
        .select('v.lasyncro_variant_id', 'v.lasyncro_barcode', 'v.sku', 'p.title as product_title', 'v.title as variant_title');
      return rows as ProductLabelVariant[];
    });

    if (!variants.length) return res.status(404).json({ error: 'No printable products in selection' });

    const pdfBuffer = await generateProductLabelSheetPdf(variants, formatId ?? 'thermal-50x25');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="product-labels.pdf"');
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('[floor-planning] httpBatchPrintProductBarcodes failed', err);
    return res.status(500).json({ error: 'Failed to generate product label sheet' });
  }
}