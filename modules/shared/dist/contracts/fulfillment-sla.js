export const DEFAULT_FULFILLMENT_SLA_HOURS = 24;
export const MAX_APPROACHING_SLA_LEAD_SECONDS = 4 * 3600;
export const APPROACHING_SLA_FRACTION = 0.25;
export function fulfillmentSlaSeconds(fulfillmentSlaHours) {
    const hours = Number.isFinite(fulfillmentSlaHours) &&
        Number(fulfillmentSlaHours) > 0
        ? Number(fulfillmentSlaHours)
        : DEFAULT_FULFILLMENT_SLA_HOURS;
    return Math.round(hours * 3600);
}
export function approachingFulfillmentSlaLeadSeconds(fulfillmentSlaHours) {
    const slaSeconds = fulfillmentSlaSeconds(fulfillmentSlaHours);
    return Math.min(MAX_APPROACHING_SLA_LEAD_SECONDS, Math.floor(slaSeconds * APPROACHING_SLA_FRACTION));
}
export function isApproachingFulfillmentSla(input) {
    if (input.isBreached ||
        input.isFulfilled ||
        input.ageSincePaidSeconds == null) {
        return false;
    }
    const slaSeconds = fulfillmentSlaSeconds(input.fulfillmentSlaHours);
    const leadSeconds = approachingFulfillmentSlaLeadSeconds(input.fulfillmentSlaHours);
    const paidAge = Number(input.ageSincePaidSeconds);
    return (paidAge >= slaSeconds - leadSeconds &&
        paidAge < slaSeconds);
}
