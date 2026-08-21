// apps/frontend/src/api/shopSettings.ts
import { axiosInstance } from './axiosConfig';

/**
 * SRC-05a — SHOP TIMEZONE
 *
 * Shop-scoped, unlike the currency preference in members.ts which is per-user
 * and display-only. This value drives behaviour: scheduled report delivery and
 * the interpretation of daily cut-off times.
 *
 * timezone_source 'shopify' means auto-populated at install and refreshable;
 * 'manual' means the merchant chose it and OAuth will no longer overwrite it.
 */
export type ShopTimezone = {
  timezone: string;
  timezone_source: 'shopify' | 'manual';
  /** The caller's own zone, offered as a suggestion. */
  detected_default: string;
};

export async function getShopTimezone(): Promise<ShopTimezone> {
  const { data } = await axiosInstance.get('/api/v1/settings/shop/timezone');
  return data;
}

export async function updateShopTimezone(timezone: string): Promise<ShopTimezone> {
  const { data } = await axiosInstance.patch('/api/v1/settings/shop/timezone', { timezone });
  return data;
}


/**
 * INV-SHOPIFY-LOCATION-10
 * Explicit Shopify Location ↔ laSyncro warehouse mapping.
 */
export type WarehouseShopifyMapping = {
  warehouse_id: string;
  name: string;
  is_default: boolean;
  active: boolean;
  shopify_location_id: string | null;
};

export type ShopifyWarehouseLocation = {
  shopify_location_id: string;
  name: string;
  is_active: boolean;
};

export type WarehouseShopifyLocationsResponse = {
  warehouses: WarehouseShopifyMapping[];
  shopify_locations: ShopifyWarehouseLocation[];
};

export type WarehouseShopifyLocationUpdate = {
  warehouse_id: string;
  name: string;
  shopify_location_id: string | null;
};

export async function getWarehouseShopifyLocations(): Promise<WarehouseShopifyLocationsResponse> {
  const { data } = await axiosInstance.get(
    '/api/v1/settings/shop/warehouse-shopify-locations'
  );

  return data;
}

export async function updateWarehouseShopifyLocation(
  warehouseId: string,
  shopifyLocationId: string | null
): Promise<WarehouseShopifyLocationUpdate> {
  const { data } = await axiosInstance.patch(
    `/api/v1/settings/shop/warehouses/${encodeURIComponent(warehouseId)}/shopify-location`,
    {
      shopify_location_id: shopifyLocationId,
    }
  );

  return data;
}
