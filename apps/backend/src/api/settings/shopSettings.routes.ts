// apps/backend/src/api/settings/shopSettings.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireAction } from '../../middleware/require-action.middleware.js';
import {
  httpGetShopTimezone,
  httpPatchShopTimezone,
  httpGetWarehouseShopifyLocations,
  httpPatchWarehouseShopifyLocation,
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

export default router;
