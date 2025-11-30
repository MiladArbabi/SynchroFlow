# ProblemCenter – Warehouse Problem-Solve & Quality Module (v1 Locked Blueprint, Conflict-Free)

> **Mission:** Be the **single source of truth** for **warehouse & product issues**, their lifecycle, evidence, root causes, and quality signals – without owning inventory, returns, or refunds.

Any change to **locked types, events, or schemas** requires:

* a versioned contract (`v2`), and
* a migration plan.

No ad-hoc edits.

---

## 0. Role, Mission & Boundaries

### 0.1 Role in LaSyncro CNS

**Module Name:** `problem-solve` (ProblemCenter)
**Role:** CNS node for **warehouse issues & quality drift**.

It:

* Receives issue **intents** from WMS-Lite flows (camera, scan, operations UI).
* Turns them into canonical issues with lifecycle & evidence.
* Emits **quality signals** to SKU OS, ReturnNexus, InsightCore, Echo Hub.

### 0.2 ProblemCenter OWNS

* **Issue taxonomy & lifecycle** for warehouse / product-side problems.

* Canonical issue model: `WmsIssue` (name kept for continuity, but owned here).

* Evidence metadata (`IssueMediaAttachment`).

* Root cause & resolution codes (internal taxonomy).

* All “quality signal” events:

  * `ProductQualityEvent` → **SKU OS**
  * `WmsIssueAnalyticsEvent` → **InsightCore**
  * `IssueTaskPayload` → **Echo Hub**
  * `ReturnQualityContextEvent` → **ReturnNexus**

* Mapping from **WMS-Lite operational events** → issues / quality.

### 0.3 ProblemCenter DOES NOT OWN

* Physical inventory or locations → **WMS-Lite**
* Returns lifecycle, refund/exchange outcomes → **ReturnNexus**
* Order-level profitability / cost-to-serve → **OrderNexus** / **MarginCore**
* Product health scores, degradation, playbooks → **SKU OS**
* Workflow orchestration & task state → **Echo Hub**
* Global analytics & dashboards → **InsightCore**

> **Boundary:**
> ProblemCenter explains *what went wrong and why in the warehouse* and publishes normalized quality signals.
> It never decides **inventory balance**, **refunds**, or **profitability**.

---

## 1. Core Types – Issues & Evidence (Locked)

### 1.1 Enums (Shared With WMS-Lite)

```ts
export type IssueType =
  | 'PRODUCT_DEFECT'
  | 'PACKAGING_DEFECT'
  | 'MISSING_ITEM'
  | 'WRONG_ITEM'
  | 'SHIPPING_DAMAGE'
  | 'LABEL_ERROR'
  | 'QUANTITY_MISMATCH'
  | 'OTHER_FULFILLMENT_ERROR';

export type IssueSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type IssueStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'RESOLVED'
  | 'CANCELLED';

export type IssueSourceStep =
  | 'RECEIVE'
  | 'STOW'
  | 'PICK'
  | 'PACK'
  | 'SHIP'
  | 'RETURN_INSPECTION'
  | 'CUSTOMER_REPORT';

export type MediaType = 'IMAGE' | 'VIDEO';
```

### 1.2 Media Attachment

```ts
export interface IssueMediaAttachment {
  mediaId: string;
  type: MediaType;
  url: string;
  capturedAt: string;   // ISO
  capturedBy: string;   // user id
}
```

### 1.3 Canonical Issue Model (Owned by ProblemCenter)

```ts
export interface WmsIssue {
  issueId: string;
  shopId: number;

  type: IssueType;
  severity: IssueSeverity;
  status: IssueStatus;

  sourceStep: IssueSourceStep;

  orderId?: string;
  productId?: string;
  binId?: string;
  shipmentId?: string;
  quantityAffected?: number;

  title: string;
  description?: string;
  media: IssueMediaAttachment[];

  rootCauseCode?: string;      // 'SUPPLIER_DEFECT', 'PICK_ERROR', etc.
  resolutionCode?: string;     // 'SCRAPPED', 'RESHELVED', 'RETURN_TO_SUPPLIER', ...
  resolutionNotes?: string;

  createdBy: string;
  createdAt: string;           // ISO
  updatedAt: string;           // ISO
  resolvedAt?: string;         // ISO
}
```

> **Note:**
> This model lives in ProblemCenter. WMS-Lite only sends **intents** (`WmsIssueIntentEvent`) and references existing issueIds when needed; it does not store canonical issues.

---

## 2. DB Schema – ProblemCenter (Locked)

```sql
CREATE TABLE ps_issues (
  issue_id VARCHAR(64) PRIMARY KEY,
  shop_id INTEGER NOT NULL,

  type VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL,

  source_step VARCHAR(32) NOT NULL,

  order_id VARCHAR(64),
  product_id VARCHAR(64),
  bin_id VARCHAR(64),
  shipment_id VARCHAR(64),
  quantity_affected INTEGER,

  title VARCHAR(255) NOT NULL,
  description TEXT,

  root_cause_code VARCHAR(64),
  resolution_code VARCHAR(64),
  resolution_notes TEXT,

  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_ps_issues_shop_status
  ON ps_issues (shop_id, status);

CREATE INDEX idx_ps_issues_shop_type
  ON ps_issues (shop_id, type);

CREATE TABLE ps_issue_media (
  media_id VARCHAR(64) PRIMARY KEY,
  issue_id VARCHAR(64) NOT NULL REFERENCES ps_issues(issue_id) ON DELETE CASCADE,
  media_type VARCHAR(16) NOT NULL,
  url TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  captured_by VARCHAR(64) NOT NULL
);

CREATE INDEX idx_ps_issue_media_issue
  ON ps_issue_media (issue_id);

CREATE TABLE ps_issue_events (
  id BIGSERIAL PRIMARY KEY,
  issue_id VARCHAR(64) NOT NULL REFERENCES ps_issues(issue_id) ON DELETE CASCADE,
  shop_id INTEGER NOT NULL,
  event_type VARCHAR(64) NOT NULL,  -- 'STATUS_CHANGED', 'ROOT_CAUSE_SET', etc.
  from_status VARCHAR(16),
  to_status VARCHAR(16),
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by VARCHAR(64) NOT NULL
);

CREATE INDEX idx_ps_issue_events_issue
  ON ps_issue_events (issue_id);
```

---

## 3. Public APIs – ProblemCenter

All endpoints are shop-scoped and require appropriate roles (`ROLE_WMS_USER`, `ROLE_WMS_ADMIN`, or similar).

### 3.1 Report Issue (Direct API)

```http
POST /api/problem-solve/v1/issues/report
Authorization: Bearer <JWT>
Content-Type: application/json
```

```ts
export interface IssueReportRequest {
  shopId: number;
  type: IssueType;
  severity: IssueSeverity;
  sourceStep: IssueSourceStep;

  orderId?: string;
  productId?: string;
  binId?: string;
  shipmentId?: string;
  quantityAffected?: number;

  title: string;
  description?: string;

  media?: Array<{ tempUploadId: string }>;
}

export interface IssueReportResponse {
  issue: WmsIssue;
}
```

**Rules:**

* At least one of `orderId | productId | binId` must be present.
* Status is initialized to `'OPEN'`.

This is used by internal UIs or other modules that want to report an issue directly (bypassing WMS-Lite).

### 3.2 Transition Issue

```http
POST /api/problem-solve/v1/issues/:issueId/transition
Authorization: Bearer <JWT>
```

```ts
export interface IssueTransitionRequest {
  status?: IssueStatus;
  rootCauseCode?: string;
  resolutionCode?: string;
  resolutionNotes?: string;
}

export interface IssueTransitionResponse {
  issue: WmsIssue;
}
```

Allowed status transitions:

* `OPEN` → `IN_PROGRESS` | `CANCELLED`
* `IN_PROGRESS` → `BLOCKED` | `RESOLVED`
* `BLOCKED` → `IN_PROGRESS` | `CANCELLED`
* `RESOLVED` / `CANCELLED` → **terminal**

Invalid transitions → 400 `InvalidStatusTransition`.

### 3.3 List Issues

```http
GET /api/problem-solve/v1/issues?shopId=...&status=&type=&orderId=&productId=
Authorization: Bearer <JWT>
```

Returns paginated `WmsIssue[]`.

---

## 4. Integration: WMS-Lite ↔ ProblemCenter

### 4.1 WMS-Lite → ProblemCenter: Issue Intent (Single Owner of Canonical Issues)

```ts
// wms-lite → problem-solve

export interface WmsIssueIntentEvent {
  eventType: 'WMS_ISSUE_INTENT_V1';
  shopId: number;

  sourceStep: IssueSourceStep;

  orderId?: string;
  productId?: string;
  binId?: string;
  shipmentId?: string;
  quantityAffected?: number;

  suggestedType: IssueType;
  suggestedSeverity: IssueSeverity;

  title: string;
  description?: string;
  tempMediaIds?: string[]; // references to uploads in shared media service

  createdAt: string;
  createdBy: string;
}
```

**ProblemCenter responsibilities:**

* Treat this event as **idempotent** per `(shopId, eventType, createdAt, createdBy, title)` or a dedicated `intentId` if added later.

* Create a canonical `WmsIssue` (if none exists) with:

  * `type = suggestedType`
  * `severity = suggestedSeverity`
  * `sourceStep`, `orderId`, `productId`, etc.
  * Attached media from `tempMediaIds`.

* Append a `ps_issue_events` row for audit.

* Emit downstream quality events (`ProductQualityEvent`, `IssueTaskPayload`, `WmsIssueAnalyticsEvent`) as needed.

### 4.2 ProblemCenter → WMS-Lite (Optional UI Feedback)

```ts
export interface IssueStateChangedEvent {
  eventType: 'PS_ISSUE_STATE_CHANGED_V1';
  shopId: number;
  issueId: string;
  status: IssueStatus;
  severity: IssueSeverity;
  type: IssueType;
  updatedAt: string;
}
```

WMS-Lite may consume this to highlight problematic bins/products in its operational UI. It does **not** mutate issues – ProblemCenter remains source-of-truth.

---

## 5. ProblemCenter → Other Modules (Single Producer of Quality Events)

### 5.1 To SKU OS – Product Quality Degradation

```ts
// problem-solve → sku-os

export interface ProductQualityEvent {
  shopId: number;
  productId: string;

  issueType: IssueType;
  severity: IssueSeverity;
  sourceStep: IssueSourceStep;
  issueId: string;

  occurredAt: string; // ISO
}
```

**Contract:**

* This is the **only** producer of `ProductQualityEvent` in the system.
* SKU OS uses this (plus `ReturnInspectionEvent` & `ReturnAnalyticsEvent`) to degrade product health via its locked degradation mapping.

### 5.2 To ReturnNexus – Context for Bad Returns

```ts
// problem-solve → return-nexus

export interface ReturnQualityContextEvent {
  eventType: 'RETURN_QUALITY_CONTEXT_V1';
  shopId: number;
  returnId: string;
  orderId: string;

  issueIds: string[];
  summary: string;        // short human-readable explanation
  createdAt: string;      // ISO
}
```

**Rules:**

* ProblemCenter may emit this when issues are linked to a given return (via shared `orderId` / `returnId` and/or `issueIds` from `ReturnInspectionEvent`).
* ReturnNexus **does not** mutate issues; it only uses `ReturnQualityContextEvent` as context for refund/exchange decisions.

### 5.3 To Echo Hub – Work Tasks

```ts
// problem-solve → echo-hub

export interface IssueTaskPayload {
  shopId: number;
  issueId: string;
  type:
    | 'INVESTIGATE_PRODUCT_DEFECT'
    | 'CHECK_PACKING_PROCESS'
    | 'VERIFY_STOCK_LEVEL'
    | 'CONTACT_SUPPLIER'
    | 'REVIEW_SHIPPING_PACKAGING';

  severity: IssueSeverity;
  suggestedOwner: 'ops' | 'qa' | 'supplier' | 'cx';
  dueDate: string;   // ISO
  createdAt: string; // ISO
}
```

Echo Hub turns this into actionable workflows and approvals. ProblemCenter **does not** track task state; it just emits payloads.

### 5.4 To InsightCore – Analytics Events

```ts
// problem-solve → insight-core

export interface WmsIssueAnalyticsEvent {
  shopId: number;
  issueId: string;
  type: IssueType;
  severity: IssueSeverity;
  sourceStep: IssueSourceStep;
  productId?: string;
  orderId?: string;
  createdAt: string;   // ISO
  resolvedAt?: string; // ISO
}
```

**Contract:**

* ProblemCenter is the **only producer** of `WmsIssueAnalyticsEvent`.
* InsightCore uses this to power:

  * Cost-of-poor-quality dashboards
  * Issue frequency by product / step / severity
  * MTTR (mean time to resolution)

---

## 6. Returns Boundary – ProblemCenter vs ReturnNexus vs WMS-Lite

### 6.1 Roles

* **WMS-Lite**

  * Executes physical flows.
  * Detects problems, sends `WmsIssueIntentEvent`.
  * Performs `ReturnInspectionEvent` (physical condition only).

* **ProblemCenter**

  * Turns WMS intents + other signals into canonical **issues**.
  * Owns issue lifecycle, root causes, resolutions.
  * Emits quality/analytics/task events.

* **ReturnNexus**

  * Owns return cases & financial decisions.
  * Uses `ReturnInspectionEvent` + `ReturnQualityContextEvent` + `ReturnAnalyticsEvent` to decide money.

### 6.2 Shared Types (Informational, Not Owned)

ProblemCenter references:

* `ReturnId`, `OrderId`, `ProductId` from shared contracts.
* `PhysicalConditionCode`/`ReturnInspectionEvent` from the WMS-Lite ↔ ReturnNexus contract.
* It must **not** redefine or reinterpret those enums; it only links issues to them via IDs.

---

## 7. Observability & SLAs

### 7.1 Metrics

```ts
const PROBLEM_SOLVE_METRICS = {
  issues: {
    issues_created_total: 'Counter',
    issues_resolved_total: 'Counter',
    issues_by_type_total: 'Counter', // labels: type, severity
    time_to_first_action_ms: 'Histogram',
    time_to_resolution_ms: 'Histogram'
  },
  integration: {
    product_quality_events_total: 'Counter',
    issue_task_payloads_total: 'Counter',
    analytics_events_total: 'Counter',
    event_publish_failures_total: 'Counter'
  }
};
```

### 7.2 Suggested SLAs

* 95% of **HIGH/CRITICAL** issues get first action within 2 hours.
* 95% of outbound events (`ProductQualityEvent`, `IssueTaskPayload`, `WmsIssueAnalyticsEvent`, `ReturnQualityContextEvent`) delivered in < 5 minutes.
* ProblemCenter remains **read-available** even when Echo Hub / SKU OS / ReturnNexus are degraded.

---

## 8. Phase 1 Scope (Locked)

### Included

* Issue model & lifecycle (`WmsIssue`)
* Media attachment metadata (not storage)
* APIs for report / transition / list
* WMS-Lite issue intent integration (`WmsIssueIntentEvent`)
* `ProductQualityEvent` for SKU OS
* `IssueTaskPayload` for Echo Hub
* `WmsIssueAnalyticsEvent` for InsightCore
* `ReturnQualityContextEvent` for ReturnNexus

### Explicitly Not Included (v1)

* Direct integration into carrier claims
* Supplier chargeback workflows
* Automated root cause classification via ML
* UX for full RCA & CAPA programs (those can be built on top)
* Any refund logic or inventory mutation

---

## 9. Developer Contract – Final Statement

> **ProblemCenter Developer Contract**
>
> Given:
>
> * Issue intents and context from WMS-Lite,
> * Warehouse events across receive → return inspection,
>
> ProblemCenter guarantees:
>
> * A single, canonical issue model (`WmsIssue`) with strict status transitions.
> * Durable recording of what went wrong, where, and how bad.
> * Emission of:
>
>   * `ProductQualityEvent` to SKU OS
>   * `IssueTaskPayload` to Echo Hub
>   * `WmsIssueAnalyticsEvent` to InsightCore
>   * `ReturnQualityContextEvent` to ReturnNexus
> * Strict separation from:
>
>   * Inventory truth (**WMS-Lite**)
>   * Refund decisions & return lifecycle (**ReturnNexus**)
>   * Profitability & cost models (**OrderNexus / MarginCore**)
>
> Any attempt to:
>
> * Encode refund logic inside ProblemCenter,
> * Mutate inventory balances here, or
> * Redefine return policy semantics,
>
> is out of contract and **not** ProblemCenter.