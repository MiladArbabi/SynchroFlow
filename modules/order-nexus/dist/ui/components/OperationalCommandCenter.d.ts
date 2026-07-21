/**
 * OperationalCommandCenter
 * ------------------------
 * Primary decision surface for operational control.
 *
 * RULES:
 * - No charts
 * - No historical views
 * - Only actionable, prioritized information
 *
 * DATA SOURCE:
 * - operationalControl snapshot (backend authoritative)
 */
import { FC } from 'react';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';
type Props = {
    operationalControl: {
        total_at_risk_revenue: number;
        sla_breach_24h_revenue: number;
        top_blocking_type: string;
        revenue_blocked_inventory: number;
        revenue_blocked_customer: number;
        revenue_blocked_operational: number;
    };
    /**
     * ACTION HOOKS
     * -------------
     * Must trigger operational workflows.
     */
    onDriverClick?: (driver: string) => void;
    onBreakdownClick?: (type: string) => void;
    onUrgencyClick?: () => void;
    /** CURRENCY LAYER 3 — pass from EntitlementsContext, never hardcode */
    currency?: CurrencyContext;
};
export declare const OperationalCommandCenter: FC<Props>;
export {};
