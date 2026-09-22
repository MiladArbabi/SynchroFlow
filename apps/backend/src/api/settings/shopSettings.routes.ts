// apps/backend/src/api/settings/shopSettings.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireAction } from '../../middleware/require-action.middleware.js';
import {
  httpGetShopTimezone,
  httpPatchShopTimezone,
  httpGetWarehouseShopifyLocations,
  httpPatchWarehouseShopifyLocation,
  httpGetFulfillmentSla,
  httpPatchFulfillmentSla,
} from './shopSettings.controller.js';

const router = Router();

/**
 * GET /api/v1/settings/shop/timezone
 * SRC-05a — current shop timezone, its provenance, and the caller's detected
 * zone as a suggested default.
 */
router.get(
  '/timezone',
  authenticateToken,
  requireAction('wms:settings:write'),
  httpGetShopTimezone
);

/**
 * PATCH /api/v1/settings/shop/timezone
 * Sets the timezone and marks it merchant-chosen, so OAuth re-installs stop
 * overwriting it.
 */
router.patch(
  '/timezone',
  authenticateToken,
  requireAction('wms:settings:write'),
  httpPatchShopTimezone
);


/**
 * INV-SHOPIFY-LOCATION-10
 * Read available Shopify Locations and current warehouse mappings.
 */
router.get(
  '/warehouse-shopify-locations',
  authenticateToken,
  requireAction('wms:settings:write'),
  httpGetWarehouseShopifyLocations
);

/**
 * Persist or clear one warehouse → Shopify Location mapping.
 */
router.patch(
  '/warehouses/:warehouseId/shopify-location',
  authenticateToken,
  requireAction('wms:settings:write'),
  httpPatchWarehouseShopifyLocation
);

/**
 * GET /api/v1/settings/shop/fulfillment-sla
 * Fulfillment SLA is a general operational setting (not a Growth-tier
 * intelligence feature) — deliberately tier-independent, same convention as
 * /timezone above. See also the growth-gated duplicate at
 * /api/v1/modules/cashflow/settings, which still separately owns this same
 * column for the (currently hidden) Cash Flow UI.
 */
router.get(
  '/fulfillment-sla',
  authenticateToken,
  requireAction('wms:settings:write'),
  httpGetFulfillmentSla
);

/**
 * PATCH /api/v1/settings/shop/fulfillment-sla
 */
router.patch(
  '/fulfillment-sla',
  authenticateToken,
  requireAction('wms:settings:write'),
  httpPatchFulfillmentSla
);

export default router;
