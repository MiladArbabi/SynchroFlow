import { type ReactNode } from 'react';
export interface OverviewModuleFT2DataProps {
    trust: {
        dataFreshness: 'fresh' | 'stale' | 'unknown' | null;
        syncCoverage: 'complete' | 'partial' | 'missing' | 'unknown' | null;
        crossSourceConsistency: 'consistent' | 'inconsistent' | 'unknown' | null;
        trustEligible: boolean | null;
    } | null;
    context: {
        ordersObserved: number | null;
        productsObserved: number | null;
        customersObserved: number | null;
    };
    snapshot: {
        orders: {
            revenueTotal: number | null;
            currency: string | null;
        } | null;
        products: null;
        customers: null;
    };
    alignment: {
        demandReality?: 'aligned' | 'divergent' | 'unknown';
        operationalEconomic?: 'aligned' | 'divergent' | 'unknown';
        engagementRevenue?: 'aligned' | 'divergent' | 'unknown';
    } | null;
    pulse: {
        /** Today's gross revenue. */
        revenueToday: number | null;
        /** Delta vs yesterday's gross revenue. */
        revenueDeltaVsYesterday: number | null;
        /** Revenue collected/realized today. */
        collectedRevenue: number | null;
        /** Revenue exposed but not yet lost. */
        atRiskRevenue: number | null;
        /** Revenue blocked from shipping. */
        blockedRevenue: number | null;
        /** Dominant block domain: inventory | customer | operational | none. */
        topBlockingType: string | null;
    } | null;
    userName?: string | null;
    currency?: string;
    morningBrief?: {
        signals: {
            id: string;
            priority: 1 | 2 | 3 | 4 | 5;
            title: string;
            detail: string;
            module: string;
            deepLink: string;
            revenueImpact: number | null;
            /** Short age/recency label — e.g. "14d oldest", "6 orders". Server-provided. */
            ageLabel?: string | null;
            /** Specific CTA label — e.g. "Review queue", "Reorder". Falls back to module default. */
            actionLabel?: string | null;
            /** Expandable sub-items (SKUs, orders, etc.) */
            tags?: string[];
        }[];
        hasUrgentIssues: boolean;
        generatedAt: string;
        trustWarning: boolean;
        greeting: string | null;
        summaryLine: string | null;
    } | null;
}
export type OverviewModuleFT2Props = OverviewModuleFT2DataProps & {
    onNavigate?: (deepLink: string) => void;
    onRefreshBrief?: () => void;
    onExportBrief?: () => void;
    onResolveAll?: () => void;
    /**
     * Rendered in the 75% map slot.
     * When absent the module falls back to the triage-first layout.
     * Tier gate and zone guard are resolved by the page layer — module is layout-only.
     */
    mapContent?: ReactNode;
    upgradeTeaser?: ReactNode;
};
export default function OverviewModuleFT2(props: OverviewModuleFT2Props): import("react/jsx-runtime").JSX.Element;
