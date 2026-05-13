// apps/frontend/src/pages/products/useProductsOperatorSummary.ts
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import type { FT2DateRange } from '@lasyncro/ui-ft2';

/**
 * ProductsOperatorSummary
 * -----------------------
 * Authoritative operator summary shape for Products.
 * Maps directly to backend ProductsOperatorSummary contract.
 */
export type ProductsOperatorSummary = {
  period: { from: string; to: string };

  sellability: {
    sellable: number | null;
    blocked: number | null;
    blockedReasons: {
      noSku: number | null;
      noInventory: number | null;
      zeroStock: number | null;
    };
  };

  deadWeight: {
    noSalesCount: number | null;
  };

  drift: {
    addedThisPeriod: number | null;
  };

  topReturned: Array<{
    variantTitle: string | null;
    sku: string | null;
    unitsReturned: number;
    revenueLeakage: number;
    returnRatePct: number;
  }>;

  // Products missing product code — grouped by product name
  noSkuProducts: Array<{
    productTitle: string | null;
    variants: Array<{ variantTitle: string | null }>;
  }>;
  // null = growth tier not enabled or no velocity data yet
  demand: {
    critical_reorder_count: number;
    warning_reorder_count: number;
    stockout_count: number;
    total_inventory_value: number;
    dead_capital_value: number;
    avg_days_of_stock: number | null;
    reorder_now: Array<{
      lasyncro_variant_id: string;
      sku: string | null;
      days_of_stock_remaining: number | null;
      estimated_stockout_date: string | null;
      velocity_per_day: number;
      suggested_reorder_qty: number | null;
    }>;
  } | null;
};

/**
 * useProductsOperatorSummary
 * --------------------------
 * Fetches operator summary for Products module.
 *
 * Rules:
 * - Page-owned period
 * - Read-only
 * - Deterministic refetch on range change
 */
export function useProductsOperatorSummary(range: FT2DateRange) {
  return useQuery<ProductsOperatorSummary>({
    queryKey: [
      'products', 'operator-summary',
      range.preset,
      range.from,
      range.to,
    ],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/modules/products/operator-summary',
        {
          params: range.preset === 'custom'
            ? { preset: 'custom', from: range.from, to: range.to }
            : { preset: range.preset },
        }
      );
      return data;
    },
  });
}