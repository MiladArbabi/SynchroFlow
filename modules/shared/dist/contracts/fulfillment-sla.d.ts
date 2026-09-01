export declare const DEFAULT_FULFILLMENT_SLA_HOURS = 24;
export declare const MAX_APPROACHING_SLA_LEAD_SECONDS: number;
export declare const APPROACHING_SLA_FRACTION = 0.25;
export declare function fulfillmentSlaSeconds(fulfillmentSlaHours: number | null | undefined): number;
export declare function approachingFulfillmentSlaLeadSeconds(fulfillmentSlaHours: number | null | undefined): number;
export declare function isApproachingFulfillmentSla(input: {
    ageSincePaidSeconds: number | null | undefined;
    fulfillmentSlaHours: number | null | undefined;
    isBreached?: boolean;
    isFulfilled?: boolean;
}): boolean;
//# sourceMappingURL=fulfillment-sla.d.ts.map