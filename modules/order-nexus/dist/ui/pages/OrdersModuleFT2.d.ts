import type { FT2TemporalProps } from '@lasyncro/ui-ft2';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';
export interface OrdersModuleFT2DataProps extends FT2TemporalProps {
    orders: {
        total: number | null;
        fulfilled: number | null;
        unfulfilled: number | null;
        constrained: number | null;
    };
    revenue: {
        totalSales: number | null;
        earned: number | null;
        pending: number | null;
        blocked: number | null;
    };
    operationalControl: {
        snapshot_date: string;
        aggregate_version: number;
        realized_revenue: number;
        at_risk_revenue: number;
        total_at_risk_revenue: number;
        sla_breach_24h_revenue: number;
        top_blocking_type: string;
        blocked_revenue: number;
        revenue_leakage: number;
        avg_contribution_margin_pct: number;
        orders_at_sla_risk: number;
        aging_24h: number;
        aging_48h: number;
        aging_72h_plus: number;
        pending_fulfillment: number;
        pending_payment: number;
        exception_orders: number;
        constrained_orders: number;
        revenue_blocked_inventory: number;
        revenue_blocked_customer: number;
        revenue_blocked_operational: number;
        queue_manual_review: number;
        queue_awaiting_inventory: number;
        queue_ready_to_ship: number;
        queue_awaiting_customer: number;
        partial_fulfillment_opportunity: number;
    };
    returns?: {
        returnedRevenue: number | null;
        returnedUnits: number | null;
        affectedOrders: number | null;
    };
    obligations?: {
        totalBlockedValue: number | null;
        coverage: {
            status: 'sufficient' | 'insufficient';
        };
    };
    decision: {
        brief: {
            ready_to_ship: number;
            awaiting_customer: number;
            inventory_blocked_revenue: string | number;
            manual_review: string | number;
        } | null;
    };
    onPriorityFlag?: (orderIds: string[], flagged: boolean) => Promise<void>;
    /** Opens the shared EntityDetailModal for this order. See entity-detail-modal-playbook.md §2. */
    onOrderClick?: (orderId: string) => void;
    /**
     * Module-level export CTA.
     * Handler is owned by the app shell because export API/auth concerns live outside order-nexus.
     */
    onExport?: () => void | Promise<void>;
    operatorSummary?: {
        constraintCounts?: {
            inventory: number;
            customer: number;
            operational: number;
        };
        topBlockingType?: string | null;
        agingOrders?: Array<{
            lasyncro_order_id: string;
            externalOrderId: string | null;
            ageHours: number;
            isShippingSlaBreached: boolean;
            constraintType: string | null;
            isPriorityFlagged: boolean;
            inPickBatch: boolean;
            pickBatchStatus: string | null;
            revenue: number;
            timeToSlaBreachMinutes: number | null;
        }>;
        imminentSlaBreachers?: Array<{
            lasyncro_order_id: string;
            externalOrderId: string | null;
            minutesUntilBreach: number;
            constraintType: string | null;
            revenue: number;
        }>;
        queueCounts?: {
            readyToShip: number;
            awaitingInventory: number;
            awaitingCustomer: number;
            manualReview: number;
        };
    } | null;
    currency?: CurrencyContext;
}
export default function OrdersModuleFT2(props: OrdersModuleFT2DataProps): import("react/jsx-runtime").JSX.Element;
