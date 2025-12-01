// packages/shared/src/contracts/returns-quality-contract.ts
// LOCKED v1 – Returns & Quality Canonical Types

/**
 * IMPORTANT BACKWARD-COMPATIBILITY NOTE:
 *
 * - These enums (`ReturnReasonCategory`, `InspectionResult`, `IssueRootCause`)
 *   and their semantics are canonically documented in:
 *   `docs/shared/returns-quality-mapping.md`.
 *
 * - ReturnNexus, WMS-Lite, SKU OS and InsightCore all assume this mapping.
 *
 * - Any change that adds or reinterprets enum values MUST be treated as a
 *   versioned contract change (`v2`), with:
 *     1) an update to `docs/shared/returns-quality-mapping.md`, and
 *     2) coordinated changes across all consuming modules.
 *
 * Do NOT “just add one more enum value” in a local module without going
 * through this shared contract and mapping.
 */


/**
 * NOTE (LOCKED):
 *   SKU OS health degradation rules depend on the canonical mapping between:
 *     - ReturnReasonCategory
 *     - InspectionResult
 *     - IssueRootCause
 *
 *   The SKU OS blueprint defines a fixed DegradationBucket model
 *   ('NONE' | 'LOW' | 'MEDIUM' | 'HIGH') and canonical healthScoreDelta values.
 *
 *   Implementations MUST NOT reinterpret or remap these enums without a
 *   versioned breaking change (returns-quality-contract v2 + sku-os v2).
 *
 *   Any change to these enums, their semantics, or a module overriding the
 *   canonical degradation mapping is a contract violation.
*/

/**
 * High-level, normalized reason categories for analytics and quality logic.
 * Individual channels / shops can have finer-grained customer-facing reasons,
 * but MUST map them into this enum when emitting quality/return analytics.
 */
export type ReturnReasonCategory =
  | 'PRODUCT_DEFECT'
  | 'PACKAGING_DEFECT'
  | 'DAMAGED_IN_TRANSIT'
  | 'SIZE_FIT_ISSUE'
  | 'NOT_AS_DESCRIBED'
  | 'CUSTOMER_CHANGED_MIND'
  | 'OTHER';

/**
 * Outcome of the inspection + financial decision at the *line* level.
 * This is NOT the full return-case status, only the quality/finance result
 * for a specific product line.
 */
export type InspectionResult =
  | 'APPROVED_REFUND_RESTOCKABLE'
  | 'APPROVED_REFUND_SCRAP'
  | 'PARTIAL_REFUND'
  | 'REJECTED_REFUND';

/**
 * Normalized root-cause categories for quality analytics.
 * These are used by InsightCore, SKU OS, and reporting – not for policy.
 */
export type IssueRootCause =
  | 'MANUFACTURING_QUALITY'
  | 'PACKAGING_QUALITY'
  | 'FULFILLMENT_ERROR'
  | 'CARRIER_DAMAGE'
  | 'CUSTOMER_EXPECTATIONS'
  | 'CUSTOMER_MISUSE'
  | 'UNKNOWN';

/**
 * Canonical per-line inspection signal: one row per (returnId, productId) line.
 * This is the minimal shape that downstream modules can use for
 * root-cause inference and basic analytics.
 *
 * NOTE:
 * - productId is the internal numeric product identifier used in analytics
 *   (e.g. FK to products table / fact tables).
 * - refundAmount / currency are optional here because inspection may be done
 *   before the final refund is decided.
 */
export interface ReturnInspectionSignal {
  shopId: number;
  orderId: string;
  returnId: string;
  productId: number;
  quantity: number;

  reasonCategory: ReturnReasonCategory;
  inspectionResult: InspectionResult;

  // Currency + amounts at product-line level (optional in v1)
  refundAmount?: number;
  currency?: string;

  inspectedAt: string; // ISO
}

/**
 * Canonical, *final* analytics event for a single return line.
 *
 * This is what ReturnNexus emits to InsightCore once:
 *  - inspection (if required) is completed, AND
 *  - refund / exchange decision is final for that line.
 *
 * It extends the semantics of ReturnInspectionSignal by requiring
 * monetary fields and adding restockability + root-cause.
 */
export interface ReturnAnalyticsEvent {
  shopId: number;
  orderId: string;
  returnId: string;
  productId: number;
  quantity: number;

  reasonCategory: ReturnReasonCategory;
  inspectionResult: InspectionResult;
  issueRootCause: IssueRootCause;

  // Final monetary outcome for this line (required here)
  refundAmount: number;
  currency: string;

  // Whether this unit is returned to saleable stock
  restockable: boolean;

  // When the return line was financially closed (not just inspected)
  processedAt: string; // ISO
}

export interface IssueRootCauseInference {
  rootCause: IssueRootCause;
  confidence: number; // 0–1
}

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
export function inferIssueRootCause(
  signal: ReturnInspectionSignal
): IssueRootCauseInference {
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