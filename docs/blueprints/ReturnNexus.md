# ReturnNexus – Returns Intelligence & Financial Decision Engine (v1 Locked Blueprint)

> **Mission:** Be the single source of truth for **return cases, policies, financial outcomes, and refund/exchange logic**, while integrating cleanly with WMS-Lite for **physical inspections** and SKU OS for **product health intelligence**.

This document defines the **sealed contracts**, **flows**, and **integration boundaries** for ReturnNexus within LaSyncro.

---

## 0. Role, Mission & Boundaries

### 0.1 ReturnNexus OWNS

* Return Case lifecycle
* Return authorization
* Return reason codes (customer-side)
* Refund / partial refund / no refund decisions
* Exchanges & reship logic
* Return policy evaluation
* Financial outcome computation
* RMA issuance & return labels (via carriers, not WMS)
* Integration with MarginCore for cost thresholds
* Integration with OrderNexus for order integrity

### 0.2 ReturnNexus DOES NOT OWN

* Physical return inspection → **WMS-Lite**
* Product-side defects → **WMS-Lite PS**
* Product health & degradation → **SKU OS**
* Profitability models → **MarginCore**
* Customer intelligence → **Specter**

> **Boundary Statement:** ReturnNexus decides *money*, WMS-Lite decides *physical truth*.

---

## 1. Core Domain Types (Locked)

### 1.1 IDs

```ts
export type ReturnId = string;
export type OrderId = string;
export type ProductId = string;
export type ShopId = number;
```

### 1.2 Return Case Status

```ts
export type ReturnCaseStatus =
  | 'REQUESTED'
  | 'AUTHORIZED'
  | 'IN_TRANSIT'
  | 'DELIVERED_TO_WAREHOUSE'
  | 'INSPECTED'
  | 'CLOSED_REFUNDED'
  | 'CLOSED_PARTIAL_REFUND'
  | 'CLOSED_NO_REFUND'
  | 'CLOSED_EXCHANGE_SENT';
```

### 1.3 Customer Return Reason (Customer-Originated)

```ts
export type ReturnReasonCode =
  | 'DAMAGED'
  | 'NOT_AS_DESCRIBED'
  | 'WRONG_ITEM_RECEIVED'
  | 'SIZE_FIT_ISSUE'
  | 'CHANGED_MIND'
  | 'ARRIVED_LATE'
  | 'OTHER';
```

> **Mapping to shared contract:**  
> `ReturnReasonCode` values are **customer-facing** and may be more granular or channel-specific.  
> ReturnNexus MUST map each `ReturnReasonCode` to a normalized `ReturnReasonCategory`
> from `packages/shared/src/contracts/returns-quality-contract.ts` when emitting
> analytics events (`ReturnAnalyticsEvent`).

---

## 2. Return Case Data Model

```ts
export interface ReturnCase {
  returnId: ReturnId;
  shopId: ShopId;
  orderId: OrderId;
  status: ReturnCaseStatus;

  lineItems: Array<{
    orderLineId: string;
    productId: ProductId;
    quantityAuthorized: number;
    reasonCode: ReturnReasonCode;
  }>;

  customerHashId?: string;   // PCD-safe
  createdAt: string;
  updatedAt: string;
}
```

---

## 3. Public API – Admin & Customer Flows

### 3.1 Create Return Request

```http
POST /api/returns/v1/cases
```

Creates `REQUESTED`, validates policies, moves to `AUTHORIZED` if approved.

### 3.2 Get Return Case (Warehouse View)

```http
GET /api/returns/v1/:returnId/warehouse-view
```

**Must exclude PII**.

---

## 4. Integration: ReturnNexus → WMS-Lite

### 4.1 `ReturnCaseCreatedEvent` (Locked)

```ts
export interface ReturnLineItemPlanned {
  orderId: OrderId;
  orderLineId: string;
  productId: ProductId;
  quantityAuthorized: number;
  reasonCode: ReturnReasonCode;
}

export interface ReturnCaseCreatedEvent {
  eventType: 'RETURN_CASE_CREATED_V1';
  shopId: ShopId;
  returnId: ReturnId;
  customerHashId?: string;
  status: ReturnCaseStatus;
  lineItems: ReturnLineItemPlanned[];
  createdAt: string;
}
```

Rules:

* Emitted exactly once per return case.
* Status must be `'AUTHORIZED'`.
* No customer PII.

---

## 5. Integration: WMS-Lite → ReturnNexus

### 5.1 Physical Condition Codes

```ts
import PhysicalConditionCode from returns-quality-contract
```

### 5.2 `ReturnInspectionEvent` (Locked)

```ts
export interface ReturnInspectionLineItemResult {
  productId: ProductId;
  orderLineId?: string;
  expectedQuantity: number;
  receivedQuantity: number;
  condition: PhysicalConditionCode;
  issueIds?: string[];
}

export type OverallInspectionOutcome =
  | 'PASS'
  | 'FAIL_PARTIAL'
  | 'FAIL';

export interface ReturnInspectionEvent {
  eventType: 'RETURN_INSPECTION_COMPLETED_V1';
  shopId: ShopId;
  returnId: ReturnId;
  orderId: OrderId;
  inspectedAt: string;
  inspectedBy: string;
  lineItems: ReturnInspectionLineItemResult[];
  overallOutcome: OverallInspectionOutcome;
  media?: IssueMediaAttachment[];
}
```

Rules:

* WMS-Lite **never** includes refund amounts or decisions.
* ReturnNexus **must** update return status to `INSPECTED`.

---

## 6. Financial Decision Engine

Inputs:

* Return case data
* Inspection results from WMS-Lite
* Cost thresholds from **MarginCore**
* Product health signals from **SKU OS** (optional in v1)

Outputs:

* Refund / partial / deny
* Exchange decision
* Notes for CX

### 6.1 Refund Decision Contract

```ts
export interface RefundDecisionResult {
  returnId: ReturnId;
  outcome: ReturnCaseStatus; // CLOSED_* status

  refundAmount: number;
  refundCurrency: string;

  explanationCode: string;  // 'CONDITION_BAD', 'AUTHORIZED_POLICY', etc.
  explanation: string;

  generatedAt: string;
}
```

### 6.2 Refund Logic Boundaries

* Must **never** override physical conditions sent by WMS-Lite.
* Must incorporate cost model from MarginCore when evaluating acceptable margin.
* Must follow shop-specific return policies.

## 6.3 Canonical Mapping: PhysicalConditionCode → InspectionResult (LOCKED)

ReturnNexus MUST use a **single deterministic mapping** between WMS-Lite
`PhysicalConditionCode`  quantity received → `InspectionResult` 
`restockable` flag.  
This mapping is canonical across LaSyncro and MUST NOT be reinterpreted,
re-derived, or overridden inside ReturnNexus without a versioned contract.

### 6.3.1 Base Mapping Table (Full Quantity Received)

| PhysicalConditionCode   | InspectionResult                 | restockable |
|-------------------------|----------------------------------|-------------|
| GOOD                    | APPROVED_REFUND_RESTOCKABLE      | true        |
| DAMAGED_PRODUCT         | APPROVED_REFUND_SCRAP            | false       |
| DAMAGED_PACKAGING       | APPROVED_REFUND_RESTOCKABLE      | true        |
| MISSING_PARTS           | APPROVED_REFUND_SCRAP            | false       |
| SIGNS_OF_USE            | PARTIAL_REFUND                   | false       |
| WRONG_ITEM_RETURNED     | REJECTED_REFUND                  | false       |
| EMPTY_BOX               | REJECTED_REFUND                  | false       |
| UNKNOWN                 | PARTIAL_REFUND                   | false       |

### 6.3.2 Quantity Rules

ReturnNexus MUST apply the following quantity interpretation:

1. **No physical units received**  
   → `REJECTED_REFUND`, `restockable = false`

2. **Full quantity received (`received >= expected`)**  
   → Use base table above exactly.

3. **Partial quantity received (`0 < received < expected`)**
   * `REJECTED_REFUND` remains `REJECTED_REFUND`  
   * `APPROVED_REFUND_RESTOCKABLE` → `PARTIAL_REFUND`  
   * `APPROVED_REFUND_SCRAP` → `PARTIAL_REFUND`  
   * `PARTIAL_REFUND` stays `PARTIAL_REFUND`

### 6.3.3 Canonical Helper Function (Implementation Reference)

ReturnNexus MUST implement the mapping using the following logic
(namespaces may vary, semantics cannot):

```ts
mapPhysicalToInspectionResult({
  condition,
  expectedQuantity,
  receivedQuantity
}): { inspectionResult, restockable }
```

Any deviation from the above mapping constitutes a **contract violation**.

---

---

## 7. Events Published by ReturnNexus

### 7.1 Refund / Decision Event

```ts
export interface ReturnDecisionEvent {
  eventType: 'RETURN_DECISION_V1';
  shopId: ShopId;
  returnId: ReturnId;

  outcome: ReturnCaseStatus;
  refundAmount: number;
  refundCurrency: string;

  reasonCode: string;
  explanation: string;
  createdAt: string;
}
```

Consumed by:

* OrderNexus (order finalization)
* Shopify connectors
* CX apps
* Analytics Core

### 7.2 ReturnNexus → InsightCore (ReturnAnalyticsEvent)


> **LOCKED MAPPING NOTE (Canonical across LaSyncro):**
>
> ReturnNexus MUST emit `ReturnAnalyticsEvent` values
> (`reasonCategory`, `inspectionResult`, `issueRootCause`, `restockable`)
> strictly according to the canonical quality mapping defined in:
>
> - `packages/shared/src/contracts/returns-quality-contract.ts`
> - SKU OS degradation rules (locked in SKU OS blueprint §3)
>
> These fields are consumed by:
> • InsightCore (analytics)
> • SKU OS (product health degradation)
> • MarginCore (optional financial correlation)
>
> **ReturnNexus MUST NOT reinterpret or remap:**
> - Return reason categories  
> - Inspection result types  
> - Root-cause categories  
> - Restockability logic  
>
> Any change to these semantics **requires**:
> • returns-quality-contract v2  
> • return-nexus v2  
> • sku-os v2  
> • and a full data migration plan.
>
> This ensures SKU OS degradation, analytics dashboards, and quality reporting
> remain mathematically stable and comparable across all shops.


ReturnNexus emits a **row-per-return-line** analytics event **after** a refund / exchange decision
has been made and the physical inspection (if required) is completed.

```ts
// return-nexus → insight-core

import {
  ReturnReasonCategory,
  InspectionResult,
  IssueRootCause
} from '@lasyncro/shared/contracts/returns-quality-contract';

export interface ReturnAnalyticsEvent {
  shopId: ShopId;
  returnId: ReturnId;
  orderId: OrderId;
  productId: ProductId;
  quantity: number;

  reasonCategory: ReturnReasonCategory;
  inspectionResult: InspectionResult;
  issueRootCause: IssueRootCause;

  refundAmount: number;  // for this product line
  currency: string;
  restockable: boolean;

  processedAt: string;   // ISO – when the return was financially closed
}
```

Rules:

* One ReturnAnalyticsEvent per returned product line.
* Must use normalized enums from returns-quality-contract.ts.
* Must be emitted after the refund / exchange decision is final for that line.

### 7.3 ReturnNexus → OrderNexus (ReturnOutcomeEvent)

ReturnNexus emits a **coarse-grained order-level** outcome event so OrderNexus
can record post-return economics **without** mutating the original profitability snapshot.

```ts
// return-nexus → order-nexus

export interface ReturnOutcomeEvent {
  shopId: ShopId;
  orderId: OrderId;
  returnId: ReturnId;

  totalRefundAmount: number;    // total refunded for this return
  totalRestockingCost: number;  // handling / inspection / restocking
  totalWriteOffCost: number;    // scrapped inventory, etc.

  currency: string;
  processedAt: string;          // ISO – when ReturnNexus closed the return
}
```

Rules:

Exactly one ReturnOutcomeEvent per returnId.

OrderNexus MUST persist this as post-return impact in a separate table
(e.g. order_return_impact) and MUST NOT overwrite order_profitability.

If a return is re-opened or adjusted, ReturnNexus MUST emit a new
ReturnOutcomeEvent with the same returnId and updated totals.

### 7.4 Backward-Compatibility Note – Returns Quality Mapping

ReturnNexus MUST treat `docs/shared/returns-quality-mapping.md` as the
canonical contract for:

- Return reason category normalization
- Inspection → restockability classification
- Root-cause buckets used in analytics

Any change that:
- adds new `ReturnReasonCode`,
- changes the meaning of an existing `ReturnReasonCode`,
- adds new `PhysicalConditionCode`,
- or changes the mapping from reasons/conditions → quality buckets

MUST be done via:

1. Updating `docs/shared/returns-quality-mapping.md`, and  
2. Introducing a **versioned contract (`v2`)** for the affected enums and events.

No local “optimizations” or alternative mappings are allowed inside ReturnNexus.
If behavior must differ, it MUST go through a new versioned mapping layer.

---

## 8. Observability & SLAs

### 8.1 Metrics

* `returns_created_total`
* `returns_authorized_total`
* `return_inspection_received_total`
* `refunds_issued_total`
* `return_inspection_lag_ms`
* `refund_decision_latency_ms`

### 8.2 SLAs

* 99% of `ReturnInspectionEvent` → decision in < 5 minutes
* No automatic refund until inspection OR policy override
* Idempotency required: duplicate events must not alter outcomes

---

## 9. Phase 1 Scope (Locked)

### Included

* Full return lifecycle
* RMA issuance
* Return policies
* Refund / no refund / partial refund
* Exchange logic
* Integration with WMS-Lite for inspection
* Integration with MarginCore for cost thresholds
* Integration with OrderNexus for order linkage

### Not Included

* Policy simulation UI (future)
* Return analytics dashboards (InsightCore)
* Customer dispute resolution workflows
* Supplier reconciliation flows

---

## 10. Developer Contract – Final Statement

> **ReturnNexus decides financial outcomes and return policy.**
> **WMS-Lite decides physical truth.**
>
> All integrations must respect:
>
> * No refund logic in WMS-Lite.
> * No physical condition mutation inside ReturnNexus.
> * Shared contracts must remain immutable without versioning.
> * ReturnNexus MUST:
>   * Emit `ReturnAnalyticsEvent` to InsightCore using shared quality enums.
>   * Emit `ReturnOutcomeEvent` to OrderNexus for post-return economics,
>     without mutating the original `order_profitability` snapshot.
>
> Any module breaking these boundaries violates the ReturnNexus blueprint.

---

End of v1 ReturnNexus Blueprint.
