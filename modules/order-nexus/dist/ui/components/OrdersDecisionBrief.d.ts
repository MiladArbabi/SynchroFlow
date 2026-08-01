/**
 * OrdersDecisionBrief
 * -------------------
 * Pure render component.
 *
 * CONTRACT:
 * - Receives fully derived decision snapshot via props.
 * - No data fetching.
 * - No lifecycle awareness.
 * - Backend remains authoritative.
 */
export interface OrdersDecisionBriefProps {
    span?: number;
    ready_to_ship: number;
    awaiting_customer: number;
    inventory_blocked_revenue: string | number;
    manual_review: string | number;
}
export declare function OrdersDecisionBrief({ span, ready_to_ship, inventory_blocked_revenue, awaiting_customer, manual_review, }: OrdersDecisionBriefProps): import("react").JSX.Element;
