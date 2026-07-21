import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';
export interface ProductsModuleFT2DataProps {
    context: {
        period: {
            from: string;
            to: string;
        };
        productsObserved: number | null;
        variantsObserved: number | null;
        productsWithSkuCount: number | null;
        productsWithoutSkuCount: number | null;
        statusCounts: {
            active: number | null;
            inactive: number | null;
            archived: number | null;
        } | null;
    };
    operatorSummary?: {
        sellability: {
            sellable: number | null;
            blocked: number | null;
            blockedReasons: {
                noSku: number | null;
                noInventory: number | null;
                zeroStock: number | null;
                phantom: number | null;
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
        noSkuProducts: Array<{
            productTitle: string | null;
            variants: Array<{
                variantTitle: string | null;
            }>;
        }>;
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
                title: string | null;
                product_title: string | null;
                days_of_stock_remaining: number | null;
                estimated_stockout_date: string | null;
                velocity_per_day: number;
                suggested_reorder_qty: number | null;
            }>;
        } | null;
        inbound: {
            open_po_count: number;
            total_units_expected: number;
            total_committed_value_cents: number | null;
            overdue_pos: Array<{
                po_short_ref: string;
                supplier_name: string;
                status: string;
                expected_delivery_date: string | null;
                overdue_days: number | null;
                total_units_ordered: number;
                total_units_received: number;
                covers_stocked_out_skus: string[];
            }>;
            pending_pos: Array<{
                po_short_ref: string;
                supplier_name: string;
                status: string;
                expected_delivery_date: string | null;
                overdue_days: number | null;
                total_units_ordered: number;
                total_units_received: number;
                covers_stocked_out_skus: string[];
            }>;
        } | null;
        warehouse: {
            total_pick_bins: number;
            stocked_pick_bins: number;
            pick_zone_occupancy_pct: number | null;
            variants_with_stock_no_bin: number;
        } | null;
        finances: {
            total_margin_at_risk_per_week: number;
            active_sellers_no_cost: number;
            stocked_out_margin_variants: Array<{
                lasyncro_variant_id: string;
                sku: string | null;
                avg_sale_price: number;
                unit_cost: number;
                margin_per_unit: number;
                margin_pct: number;
                units_sold_30d: number;
                margin_lost_per_week: number;
            }>;
        } | null;
    } | null;
    dataFreshness: {
        structural: 'fresh' | 'stale' | 'unknown' | null;
        inventory: 'fresh' | 'stale' | 'unknown' | null;
        sales: 'fresh' | 'stale' | 'unknown' | null;
        fulfillment: 'fresh' | 'stale' | 'unknown' | null;
        cost: 'fresh' | 'stale' | 'unknown' | null;
    } | null;
    outcome: {
        status: 'positive' | 'negative' | 'unknown';
    } | null;
    operationalCounts: {
        productsWithInventoryCount: number | null;
        productsWithoutInventoryCount: number | null;
        skusWithSalesCount: number | null;
        totalSkusObserved: number | null;
    } | null;
    trend?: unknown;
    signals?: unknown;
    productDataIntegrity?: unknown;
    operational?: unknown;
    supply?: unknown;
    alignment?: unknown;
    dependency?: unknown;
    supplyCounts?: unknown;
    currency?: CurrencyContext;
}
export type ProductsModuleFT2Props = ProductsModuleFT2DataProps;
export default function ProductsModuleFT2(props: ProductsModuleFT2Props): import("react/jsx-runtime").JSX.Element;
