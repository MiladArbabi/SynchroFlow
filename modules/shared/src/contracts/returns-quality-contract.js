"use strict";
// packages/shared/src/contracts/returns-quality-contract.ts
// LOCKED v1 – Returns & Quality Canonical Types
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferIssueRootCause = inferIssueRootCause;
/**
 * v1 root-cause inference – intentionally simple & deterministic.
 * Future changes require a new versioned helper or a strategy pattern.
 *
 * This helper works on the minimal ReturnInspectionSignal; ReturnNexus
 * can:
 *  1) map its own inspection + reason into ReturnInspectionSignal,
 *  2) call inferIssueRootCause(signal),
 *  3) embed the result into ReturnAnalyticsEvent.issueRootCause.
 */
function inferIssueRootCause(signal) {
    const { reasonCategory, inspectionResult } = signal;
    if (reasonCategory === 'PRODUCT_DEFECT') {
        return {
            rootCause: 'MANUFACTURING_QUALITY',
            confidence: inspectionResult === 'APPROVED_REFUND_SCRAP' ? 0.9 : 0.7
        };
    }
    if (reasonCategory === 'PACKAGING_DEFECT') {
        return {
            rootCause: 'PACKAGING_QUALITY',
            confidence: 0.8
        };
    }
    if (reasonCategory === 'DAMAGED_IN_TRANSIT') {
        return {
            rootCause: 'CARRIER_DAMAGE',
            confidence: 0.75
        };
    }
    if (reasonCategory === 'NOT_AS_DESCRIBED') {
        return {
            rootCause: 'CUSTOMER_EXPECTATIONS',
            confidence: 0.6
        };
    }
    if (reasonCategory === 'SIZE_FIT_ISSUE') {
        return {
            rootCause: 'CUSTOMER_EXPECTATIONS',
            confidence: 0.5
        };
    }
    if (reasonCategory === 'CUSTOMER_CHANGED_MIND') {
        return {
            rootCause: 'CUSTOMER_MISUSE',
            confidence: 0.6
        };
    }
    return {
        rootCause: 'UNKNOWN',
        confidence: 0.1
    };
}
//# sourceMappingURL=returns-quality-contract.js.map