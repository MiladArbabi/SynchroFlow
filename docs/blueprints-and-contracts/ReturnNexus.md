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

```typescript
export type ReturnId = string;
export type OrderId = string;
export type ProductId = string;
export type ShopId = number;
```

### 1.2 Return Case Status

```typescript
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

```typescript
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
> ReturnNexus MUST map each `ReturnReasonCode` to a normalized `ReturnReasonCategory` from `packages/shared/src/contracts/returns-quality-contract.ts` when emitting analytics events (`ReturnAnalyticsEvent`).

---

## 2. Return Case Data Model

```typescript
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

```typescript
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

**Rules:**

* Emitted exactly once per return case.
* Status must be `'AUTHORIZED'`.
* No customer PII.

---

## 5. Integration: WMS-Lite → ReturnNexus

### 5.1 Physical Condition Codes

```typescript
import PhysicalConditionCode from returns-quality-contract
```

### 5.2 `ReturnInspectionEvent` (Locked)

```typescript
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

**Rules:**

* WMS-Lite **never** includes refund amounts or decisions.
* ReturnNexus **must** update return status to `INSPECTED`.

---

## 6. Financial Decision Engine

**Inputs:**

* Return case data
* Inspection results from WMS-Lite
* Cost thresholds from **MarginCore**
* Product health signals from **SKU OS** (optional in v1)

**Outputs:**

* Refund / partial / deny
* Exchange decision
* Notes for CX

### 6.1 Refund Decision Contract

```typescript
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

### 6.3 Canonical Mapping: PhysicalConditionCode → InspectionResult (LOCKED)

ReturnNexus MUST use a **single deterministic mapping** between WMS-Lite `PhysicalConditionCode` quantity received → `InspectionResult` `restockable` flag.  
This mapping is canonical across LaSyncro and MUST NOT be reinterpreted, re-derived, or overridden inside ReturnNexus without a versioned contract.

#### 6.3.1 Base Mapping Table (Full Quantity Received)

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

#### 6.3.2 Quantity Rules

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

#### 6.3.3 Canonical Helper Function (Implementation Reference)

ReturnNexus MUST implement the mapping using the following logic (namespaces may vary, semantics cannot):

```typescript
mapPhysicalToInspectionResult({
  condition,
  expectedQuantity,
  receivedQuantity
}): { inspectionResult, restockable }
```

Any deviation from the above mapping constitutes a **contract violation**.

---

## 7. Events Published by ReturnNexus

### 7.1 Refund / Decision Event

```typescript
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

**Consumed by:**

* OrderNexus (order finalization)
* Shopify connectors
* CX apps
* Analytics Core

### 7.2 ReturnNexus → InsightCore (ReturnAnalyticsEvent)

> **LOCKED MAPPING NOTE (Canonical across LaSyncro):**
>
> ReturnNexus MUST emit `ReturnAnalyticsEvent` values (`reasonCategory`, `inspectionResult`, `issueRootCause`, `restockable`) strictly according to the canonical quality mapping defined in:
>
> * `packages/shared/src/contracts/returns-quality-contract.ts`
> * SKU OS degradation rules (locked in SKU OS blueprint §3)
>
> These fields are consumed by:
> * InsightCore (analytics)
> * SKU OS (product health degradation)
> * MarginCore (optional financial correlation)
>
> **ReturnNexus MUST NOT reinterpret or remap:**
> * Return reason categories  
> * Inspection result types  
> * Root-cause categories  
> * Restockability logic  
>
> Any change to these semantics **requires**:
> * returns-quality-contract v2  
> * return-nexus v2  
> * sku-os v2  
> * and a full data migration plan.
>
> This ensures SKU OS degradation, analytics dashboards, and quality reporting remain mathematically stable and comparable across all shops.

ReturnNexus emits a **row-per-return-line** analytics event **after** a refund / exchange decision has been made and the physical inspection (if required) is completed.

```typescript
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

**Rules:**

* One ReturnAnalyticsEvent per returned product line.
* Must use normalized enums from returns-quality-contract.ts.
* Must be emitted after the refund / exchange decision is final for that line.

### 7.3 ReturnNexus → OrderNexus (ReturnOutcomeEvent)

ReturnNexus emits a **coarse-grained order-level** outcome event so OrderNexus can record post-return economics **without** mutating the original profitability snapshot.

```typescript
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

**Rules:**

* Exactly one ReturnOutcomeEvent per returnId.
* OrderNexus MUST persist this as post-return impact in a separate table (e.g. order_return_impact) and MUST NOT overwrite order_profitability.
* If a return is re-opened or adjusted, ReturnNexus MUST emit a new ReturnOutcomeEvent with the same returnId and updated totals.

### 7.4 Backward-Compatibility Note – Returns Quality Mapping

ReturnNexus MUST treat `docs/shared/returns-quality-mapping.md` as the canonical contract for:

* Return reason category normalization
* Inspection → restockability classification
* Root-cause buckets used in analytics

Any change that:
* adds new `ReturnReasonCode`,
* changes the meaning of an existing `ReturnReasonCode`,
* adds new `PhysicalConditionCode`,
* or changes the mapping from reasons/conditions → quality buckets

MUST be done via:

1. Updating `docs/shared/returns-quality-mapping.md`, and  
2. Introducing a **versioned contract (`v2`)** for the affected enums and events.

No local "optimizations" or alternative mappings are allowed inside ReturnNexus. If behavior must differ, it MUST go through a new versioned mapping layer.

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
>   * Emit `ReturnOutcomeEvent` to OrderNexus for post-return economics, without mutating the original `order_profitability` snapshot.
>
> Any module breaking these boundaries violates the ReturnNexus blueprint.

---

## 11. Onboarding & Readiness Contract (v1)

Defines the minimum conditions under which a shop is considered "ReturnNexus-ready," the tasks a merchant must complete, and the cross-module state that ReturnNexus depends upon.

ReturnNexus does not operate as an isolated module. It requires upstream data integrity, explicit merchant configuration, and downstream event wiring to produce valid financial outcomes.

This section formalizes the "ready to process real returns" definition.

### 11.1 Readiness Summary (Single Boolean Output)

ReturnNexus is considered ready (`returnNexusReady = true`) only if **all** of the following conditions are true:

1. Platform data is available (orders, products, customers hashed).
2. A merchant-confirmed return policy exists.
3. A refund / decision strategy is configured.
4. An inspection path is configured (WMS-Lite, External Webhook, or Manual).
5. Event emission paths are healthy (ReturnAnalyticsEvent + ReturnOutcomeEvent).
6. A test return has successfully passed through the full lifecycle.

If any condition is false → ReturnNexus MUST be considered not ready and SHOULD surface onboarding tasks to guide the merchant.

### 11.2 Phase A — Platform Preconditions (Hard Dependencies)

ReturnNexus SHALL NOT attempt to process any return until platform prerequisites are satisfied.

**A1. Store Connected**

**Requires:** A connected ecommerce platform (Shopify v1).

**Signal:**
`users.shopify_connected == true`  
AND  
`integrations.sync_status == 'COMPLETED'`

**A2. Order & Product Baseline Available**

ReturnNexus depends on OrderNexus ingestion schemas for validating order integrity.

**Ingestion tables:** `orders`, `order_line_items`, `products`

**Signal:** At least 1 order and 1 product exist for the shop.

**Contract:** A return can only be created for an existing order and existing line item.

### 11.3 Phase B — Policy Configuration (Merchant-Driven)

ReturnNexus MUST NOT apply default or implicit policies. Financial outcomes must be based on explicit merchant configuration.

**B1. Base Return Policy**

A merchant must configure:

* Return window (days after delivery)
* Allowed ReturnReasonCode values
* When exchanges are allowed
* Whether proof is required (optional)
* Auto-authorization vs manual review for specific reasons

**Completion Signal:**  
`return_policies WHERE shop_id = X AND status = 'ACTIVE' LIMIT 1`

**B2. Refund Strategy Configuration**

Merchant must choose how strict or generous refund decisions should be, within boundaries of the canonical mapping.

**Configuration includes:**

* Full refund conditions
* Partial refund conditions
* No-refund conditions
* Allowable scrap/write-off thresholds
* Overrides requiring manual review

**Completion Signal:**  
`refund_decision_config WHERE shop_id = X AND version = latest`

**Locked rule:** Refund strategy MAY NOT override canonical inspection mappings (See §6.3).

### 11.4 Phase C — Inspection Readiness (Physical Truth)

ReturnNexus owns money, not physical truth. It requires a configured inspection source to determine refund eligibility.

**C1. Inspection Source Selection**

Merchant must select one of:

* `WMS_LITE`
* `EXTERNAL_WEBHOOK` (custom warehouse)
* `MANUAL_INSPECTION_UI` (light mode)

**Completion Signal:**  
`return_inspection_source WHERE shop_id = X AND status = 'ACTIVE'`

**C2. Inspection Event Validation**

ReturnNexus must verify the ability to receive and process:  
`RETURN_INSPECTION_COMPLETED_V1`

**Completion Signal:**  
A synthetic or real ReturnInspectionEvent results in:

* `return_cases.status = 'INSPECTED'`
* A valid canonical inspection mapping result

### 11.5 Phase D — Financial & Analytics Pipeline Validation

**D1. Refund Decision Output**

ReturnNexus must be able to compute: `RefundDecisionResult` and transition the case to one of:

* `CLOSED_REFUNDED`
* `CLOSED_PARTIAL_REFUND`
* `CLOSED_NO_REFUND`
* `CLOSED_EXCHANGE_SENT`

**Completion Signal:**  
A test return reaches one of the above terminal states.

**D2. Analytics Event Emission**

ReturnNexus must emit exactly one ReturnAnalyticsEvent per returned line item.

**Completion Signal:**  
Event bus receives ≥ 1 event with:

* normalized reasonCategory
* normalized inspectionResult
* restockable flag via canonical mapping

**D3. Order Economics Impact**

ReturnNexus must emit one ReturnOutcomeEvent per return, enabling OrderNexus to apply post-return economics without mutating original profitability.

**Completion Signal:**  
`order_return_impact` table (or equivalent) contains ≥ 1 record for the shop.

### 11.6 Phase E — First Real Return (Merchant Aha Moment)

The onboarding is considered fully complete when:

A real customer return is processed end-to-end:

1. `RETURN REQUESTED`
2. `AUTHORIZED` (policy evaluation)
3. `INSPECTED` (WMS or manual)
4. Refund decision computed
5. Analytics + outcome events emitted

**Completion Signal:**  
`returns_created_total >= 1` AND `refunds_issued_total >= 1` (for this shop)

ReturnNexus is now "operational", not theoretical.

### 11.7 Recommended Onboarding Task List (UI-Agnostic)

A UI MAY present the following tasks in any visual structure, but the underlying signals MUST follow this contract:

| Task | Description | Completion Signal |
|------|-------------|-------------------|
| Connect your store | Shopify / integration setup | Platform signals (A1, A2) |
| Complete initial sync | Order/product ingestion available | SyncStatus = COMPLETED |
| Configure return policy | Select return window, allowed reasons, exchanges | (B1) |
| Configure refund strategy | Strict/generous settings, thresholds | (B2) |
| Choose inspection method | WMS-Lite, webhook, or manual | (C1) |
| Run inspection test | Validate event mapping | (C2) |
| Review test refund decision | Validate decision engine | (D1) |
| Confirm analytics pipeline | Ensure ReturnAnalyticsEvent is emitted | (D2) |
| Confirm order economics pipeline | Ensure ReturnOutcomeEvent is emitted | (D3) |
| Process your first real return | Complete real return case | (E1) |

All tasks above correspond directly to blueprint obligations.

### 11.8 Failure Modes & Required Safeguards

ReturnNexus MUST refuse or warn when:

* A return is attempted before ingestion baseline exists
* No policy is configured (B1)
* No refund strategy exists (B2)
* Inspection source is undefined (C1)
* Canonical mappings are violated (6.3)

Such attempts must log: `RETURN_NEXUS_NOT_READY` with the missing readiness conditions.

### 11.9 Extensibility for Modules (SKU-OS, MarginCore, InsightCore)

While ReturnNexus v1 has minimal dependencies on SKU-OS and InsightCore, future versions MAY introduce signals from these modules.

The readiness contract MUST then be versioned:

* `returnNexusReady_v1`
* `returnNexusReady_v2` (SKU health correlation)
* `returnNexusReady_v3` (predictive return risk)

**End of §11 – Onboarding & Readiness Contract (v1)**