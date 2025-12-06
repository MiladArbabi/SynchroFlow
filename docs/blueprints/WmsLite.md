# WMS-Lite – Warehouse Execution Module (v1 Locked Blueprint – Conflict-Free)

> **Mission:** Be the **single source of truth** for **physical inventory state, locations, and return inspections** from receive → stow → pick → pack → ship → return inspection – without owning issues, returns, or refunds.

Any change to **locked types, interfaces, or schemas** requires:

* A versioned contract (`v2`), and
* A migration plan.

No ad-hoc edits.

---

## 0. Role, Mission & Boundaries

### 0.1 Role in LaSyncro CNS

**Module Name:** `wms-lite` – Warehouse Execution

**Role:** Physical-world node of the CNS:

* Warehouse layout: zones, shelves, bins
* Real-time **inventory ledger** (physical quantity & locations)
* Camera-first **intake & inspection flows**
* Execution of **receive, stow, pick, pack, ship, return inspection**
* Emission of **intents & physical inspection events** to other modules

### 0.2 WMS-Lite OWNS

* Physical product registration (via phone/camera or manual)

* Warehouse layout: zones, shelves, bins

* Inventory ledger & quantity truth

* Execution of:

  * **receive**
  * **stow**
  * **pick**
  * **pack**
  * **ship**
  * **return intake & inspection flows**

* Event emission for:

  * `WmsIssueIntentEvent` (raw “something is wrong” signals) → **ProblemCenter**
  * `ReturnInspectionEvent` (physical condition) → **ReturnNexus**, **SKU OS**, **ProblemCenter**

### 0.3 WMS-Lite DOES NOT OWN

* Issue lifecycle, root causes, quality events → **ProblemCenter**
* Return authorization, policies, refunds → **ReturnNexus**
* Post-return order economics → **OrderNexus**
* Profitability or cost models → **MarginCore**
* Product health scoring → **SKU OS**
* Workflow orchestration & tasks → **Echo Hub**
* Global analytics & dashboards → **InsightCore**

> **Hard Boundary:**
> WMS-Lite handles **physical reality** and emits **intents + physical inspections**.
> ProblemCenter owns issues & quality.
> ReturnNexus owns returns lifecycle & money.
> OrderNexus owns profitability (before/after returns).

---

## 1. Core Domain Types (Locked)

### 1.1 Physical Product

```ts
export interface PhysicalProduct {
  productId: string;   // global product id, shared with SKU OS
  shopId: number;

  sku: string;
  title: string;

  barcode?: string;
  dimensions?: { width: number; height: number; length: number }; // in cm
  weight?: number; // in kg

  createdAt: string;   // ISO
}
```

### 1.2 Warehouse Layout

```ts
export interface WarehouseZone {
  zoneId: string;
  shopId: number;
  name: string;
  type: 'RECEIVE' | 'STORAGE' | 'PICKING' | 'PACKING' | 'RETURN';
  createdAt: string; // ISO
}

export interface WarehouseShelf {
  shelfId: string;
  zoneId: string;
  label: string;
  createdAt: string; // ISO
}

export interface WarehouseBin {
  binId: string;
  shelfId: string;
  label: string;

  maxWeight?: number; // optional capacity
  maxVolume?: number; // optional capacity

  createdAt: string; // ISO
}
```

### 1.3 Inventory Ledger Entry

Append-only, canonical physical inventory record.

```ts
export type InventoryMovementType =
  | 'RECEIVED'
  | 'STOWED'
  | 'PICKED'
  | 'PACKED'
  | 'SHIPPED'
  | 'RETURNED'
  | 'ADJUSTMENT';

export interface InventoryLedgerEntry {
  entryId: string;
  shopId: number;
  productId: string;

  type: InventoryMovementType;
  quantity: number;         // positive integer

  fromBinId?: string;
  toBinId?: string;

  orderId?: string;
  returnId?: string;

  createdAt: string;        // ISO
}
```

**Derived quantity for `(shopId, productId)`**:

```ts
quantityAvailable =
  sum(RECEIVED + STOWED + RETURNED + ADJUSTMENT positive deltas)
- sum(PICKED + SHIPPED + ADJUSTMENT negative deltas)
```

No direct quantity edits outside the ledger.

---

## 2. DB Schema – Core Inventory & Layout (Locked)

```sql
CREATE TABLE wms_products (
  shop_id INTEGER NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  sku VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  barcode VARCHAR(64),
  width_cm DECIMAL(8,2),
  height_cm DECIMAL(8,2),
  length_cm DECIMAL(8,2),
  weight_kg DECIMAL(8,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_id, product_id)
);

CREATE TABLE wms_zones (
  zone_id VARCHAR(64) PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(32) NOT NULL, -- 'RECEIVE', 'STORAGE', 'PICKING', 'PACKING', 'RETURN'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wms_shelves (
  shelf_id VARCHAR(64) PRIMARY KEY,
  zone_id VARCHAR(64) NOT NULL REFERENCES wms_zones(zone_id) ON DELETE CASCADE,
  label VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wms_bins (
  bin_id VARCHAR(64) PRIMARY KEY,
  shelf_id VARCHAR(64) NOT NULL REFERENCES wms_shelves(shelf_id) ON DELETE CASCADE,
  label VARCHAR(64) NOT NULL,
  max_weight DECIMAL(10,2),
  max_volume DECIMAL(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wms_inventory_ledger (
  entry_id VARCHAR(64) PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  type VARCHAR(32) NOT NULL,  -- InventoryMovementType
  quantity INTEGER NOT NULL,
  from_bin_id VARCHAR(64),
  to_bin_id VARCHAR(64),
  order_id VARCHAR(64),
  return_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wms_ledger_shop_product
  ON wms_inventory_ledger (shop_id, product_id, created_at);

CREATE INDEX idx_wms_ledger_order
  ON wms_inventory_ledger (shop_id, order_id);
```

> **Note:**
> There is **no issues table here**. All issue lifecycle & evidence live in **ProblemCenter** (`ps_issues`, etc.).

---

## 3. Public WMS-Lite APIs (Core Flows, v1)

### 3.1 Register Product

```http
POST /api/wms-lite/v1/products/register
Authorization: Bearer <JWT>
Content-Type: application/json
```

```ts
export interface RegisterProductRequest {
  shopId: number;
  sku: string;
  title: string;
  barcode?: string;
  dimensions?: { width: number; height: number; length: number };
  weight?: number;
}

export interface RegisterProductResponse {
  product: PhysicalProduct;
}
```

### 3.2 Create / Update Layout

```http
POST /api/wms-lite/v1/warehouse/zones
POST /api/wms-lite/v1/warehouse/shelves
POST /api/wms-lite/v1/warehouse/bins
```

Simple CRUD, shop-scoped, behind auth.

### 3.3 Receive Inventory

```http
POST /api/wms-lite/v1/inventory/receive
Authorization: Bearer <JWT>
```

```ts
export interface ReceiveInventoryRequest {
  shopId: number;
  productId: string;
  quantity: number;
  receiveZoneId: string;        // usually a 'RECEIVE' zone
}

export interface ReceiveInventoryResponse {
  ledgerEntry: InventoryLedgerEntry;
}
```

Creates a `RECEIVED` ledger entry.

### 3.4 Stow Inventory

```http
POST /api/wms-lite/v1/inventory/stow
Authorization: Bearer <JWT>
```

```ts
export interface StowInventoryRequest {
  shopId: number;
  productId: string;
  quantity: number;
  fromZoneId?: string;    // optional if from RECEIVE zone
  toBinId: string;
}

export interface StowInventoryResponse {
  ledgerEntry: InventoryLedgerEntry;
}
```

Creates a `STOWED` ledger entry.

### 3.5 Pick for Order

```http
POST /api/wms-lite/v1/inventory/pick
Authorization: Bearer <JWT>
```

```ts
export interface PickInventoryRequest {
  shopId: number;
  orderId: string;
  lineItems: Array<{
    productId: string;
    quantity: number;
    fromBinId: string;
  }>;
}

export interface PickInventoryResponse {
  ledgerEntries: InventoryLedgerEntry[];
}
```

Creates `PICKED` ledger entries for each line.

---

## 4. Problem Signals – Intents Only (ProblemCenter Owns Issues)

### 4.1 WMS-Lite → ProblemCenter: Issue Intent

```ts
// wms-lite → ProblemCenter

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

export type IssueSourceStep =
  | 'RECEIVE'
  | 'STOW'
  | 'PICK'
  | 'PACK'
  | 'SHIP'
  | 'RETURN_INSPECTION'
  | 'CUSTOMER_REPORT';

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

**Rules:**

* WMS-Lite **does not** create canonical issues.
* ProblemCenter **must** turn `WmsIssueIntentEvent` into a persisted `WmsIssue` and own lifecycle, root cause, and quality events.
* WMS-Lite is **not** a producer of `ProductQualityEvent`

---

## 5. Returns Integration Boundary (WMS-Lite ↔ ReturnNexus ↔ ProblemCenter)

### 5.1 ReturnNexus → WMS-Lite: `ReturnCaseCreatedEvent`

Locked as in ReturnNexus blueprint:

```ts
export type ReturnId = string;
export type OrderId = string;

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

export type ReturnReasonCode =
  | 'DAMAGED'
  | 'NOT_AS_DESCRIBED'
  | 'WRONG_ITEM_RECEIVED'
  | 'SIZE_FIT_ISSUE'
  | 'CHANGED_MIND'
  | 'ARRIVED_LATE'
  | 'OTHER';

export interface ReturnLineItemPlanned {
  orderId: OrderId;
  orderLineId: string;
  productId: string;
  quantityAuthorized: number;
  reasonCode: ReturnReasonCode;
}

export interface ReturnCaseCreatedEvent {
  eventType: 'RETURN_CASE_CREATED_V1';
  shopId: number;
  returnId: ReturnId;
  customerHashId?: string;
  status: ReturnCaseStatus; // must be 'AUTHORIZED'

  lineItems: ReturnLineItemPlanned[];

  createdAt: string;
}
```

WMS-Lite never decides authorization; it reacts to an **already AUTHORIZED** case.

### 5.2 WMS-Lite → ReturnNexus / SKU OS / ProblemCenter: `ReturnInspectionEvent`

```ts
import PhysicalConditionCode from returns-quality-contract

export interface ReturnInspectionLineItemResult {
  productId: string;
  orderLineId?: string;
  expectedQuantity: number;
  receivedQuantity: number;
  condition: PhysicalConditionCode;
  issueIds?: string[]; // ProblemCenter issueIds once linked (optional; v1 may be empty)
}

export type OverallInspectionOutcome =
  | 'PASS'
  | 'FAIL_PARTIAL'
  | 'FAIL';

export interface ReturnInspectionEvent {
  eventType: 'RETURN_INSPECTION_COMPLETED_V1';
  shopId: number;
  returnId: string;
  orderId: string;

  inspectedAt: string;   // ISO
  inspectedBy: string;   // WMS user id

  lineItems: ReturnInspectionLineItemResult[];
  overallOutcome: OverallInspectionOutcome;

  media?: IssueMediaAttachment[]; // from shared media contract
}
```

**Consumers:**

* **ReturnNexus** – maps `PhysicalConditionCode` to `InspectionResult` + `restockable` and drives refund/exchange.
* **ProblemCenter** – may create/attach issues from inspection context.
* **SKU OS** – uses inspection history to degrade product health (via its degradation rules).

WMS-Lite **must not** produce `InspectionResult`, `IssueRootCause`, `ProductQualityEvent` or any refund decision.

---

## 6. Integration with OrderNexus – Fulfillment Profit Signals (Inbound Only)

`FulfillmentProfitSignal` is **owned by OrderNexus** and flows **into** WMS-Lite.

```ts
// order-nexus → wms-lite

export interface FulfillmentProfitSignal {
  shopId: number;
  orderId: string;
  priority: 'STANDARD' | 'HIGH_PROFIT' | 'VIP' | 'LOW_MARGIN';
  notes: string[];
  recommendedServiceLevel?: 'ECONOMY' | 'STANDARD' | 'EXPRESS';
}
```

**Rules:**

* WMS-Lite treats this as an **advisory signal** for pick/pack/ship prioritization and service level.
* WMS-Lite does **not** change profit computations; it only uses this to prioritize physical work.

---

## 7. Observability & SLAs

### 7.1 Metrics (WMS-Lite Scope Only)

```ts
const WMS_CORE_METRICS = {
  inventory_movements_total: 'Counter',
  pick_latency_ms: 'Histogram',
  receive_to_stow_latency_ms: 'Histogram',
  ledger_write_latency_ms: 'Histogram',
  camera_scan_failures_total: 'Counter',
  return_cases_intake_total: 'Counter',   // from ReturnCaseCreatedEvent
  returns_inspected_total: 'Counter',     // ReturnInspectionEvent emitted
  return_inspection_time_ms: 'Histogram', // arrival → inspectedAt
  return_inspection_events_failed_total: 'Counter'
};
```

> **Issue lifecycle metrics live in ProblemCenter**, not here.

### 7.2 Suggested SLAs

* 99% of `ReturnInspectionEvent` messages published in < 5 minutes from inspection completion.
* 95% of returns delivered to warehouse inspected within 24 hours.
* Inventory ledger writes < 200 ms p95 under normal load.
* WMS-Lite remains read-available even if ProblemCenter / ReturnNexus / SKU OS are degraded.

---

## 8. Phase 1 Scope – What v1 Actually Includes

### Included (v1)

* Product registration (camera/manual)

* Layout definition: zones, shelves, bins

* Inventory ledger (receive, stow, pick, pack, ship, returned)

* Camera-first product & return-inspection capture

* Emission of:

  * `WmsIssueIntentEvent` → ProblemCenter (raw problems)
  * `ReturnInspectionEvent` → ReturnNexus / SKU OS / ProblemCenter

* Core observability for inventory & inspection flows

### Explicitly NOT Included (v1)

* Issue lifecycle, root causes, or quality events (ProblemCenter)
* Refunds, credits, or customer notifications (ReturnNexus)
* Multi-warehouse optimization, routing, wave picking
* Carrier integrations
* Auto-reshipment logic
* AI-driven root cause analysis

---

## 9. Developer Contract – Final Statement (Conflict-Free)

> **WMS-Lite Developer Contract**
>
> Given:
>
> * Products, layout, and physical movements captured via WMS-Lite
> * Returns authorized by ReturnNexus
> * Profit signals from OrderNexus
>
> WMS-Lite guarantees:
>
> * An **append-only inventory ledger** as the single source of physical quantity truth.
> * Deterministic **receive → stow → pick → pack → ship → return inspection** flows.
> * Emission of:
>
>   * `WmsIssueIntentEvent` to **ProblemCenter** (raw issue intents)
>   * `ReturnInspectionEvent` to **ReturnNexus**, **SKU OS**, **ProblemCenter**
> * Strict separation between:
>
>   * **Physical reality** (WMS-Lite)
>   * **Issues & quality** (ProblemCenter)
>   * **Return lifecycle & money** (ReturnNexus)
>   * **Profitability** (OrderNexus)

---

# 10. Onboarding & Readiness – WMS-Lite (FT0)

**Goal:** Define exactly when a shop is considered WmsLiteReady, what must be true in the physical / layout plane, the inventory ledger plane, and the returns inspection plane, and how this maps to onboarding tasks surfaced in FT0.

## 10.1 Role in FT0 & LaSyncro

WMS-Lite is the physical-world executor in LaSyncro:

It is the single source of truth for:

* Warehouse layout (zones, shelves, bins),
* Physical inventory state (quantities and locations),
* Return inspections and condition codes (via `PhysicalConditionCode`).

It feeds:

* ReturnNexus with `ReturnInspectionEvent` (physical truth for refunds),
* SKU OS with inspection history (degradation & health),
* ProblemCenter with `WmsIssueIntentEvent` (raw issue intents),
* OrderNexus indirectly, by keeping physical flows consistent with economic data.

Therefore, FT0 onboarding MUST ensure that, for any shop using WMS-Lite:

1. The warehouse layout is minimally defined.
2. The inventory ledger is actually moving (receive → stow → pick).
3. Return inspections can be performed and emitted when ReturnNexus is present.

## 10.2 Readiness Definition

We define a conceptual snapshot:

```typescript
// Conceptual contract – not implementation detail
type WmsLiteReadinessFlag =
  | 'NO_LAYOUT_DEFINED'
  | 'NO_BINS_CONFIGURED'
  | 'NO_PRODUCTS_REGISTERED'
  | 'NO_INVENTORY_LEDGER_ENTRIES'
  | 'NO_RETURN_INSPECTIONS'
  | 'NO_ISSUE_INTENTS_EMITTED'
  | 'EVENT_SINK_DEGRADED'; // downstream modules unavailable

export interface WmsLiteReadinessSnapshot {
  shopId: number;
  isReady: boolean;
  flags: WmsLiteReadinessFlag[];
  lastEvaluatedAt: string; // ISO
}
```

For base FT0 (warehouse execution ready), `WmsLiteReady(shopId)` is **true** when:

1. **Minimal layout is defined**
   * At least one `wms_zones` row for each of:
     * A `RECEIVE` zone (for intake),
     * A `STORAGE` or `PICKING` zone (for holding stock),
     * A `RETURN` zone (for return intake / inspection).
   * At least one `wms_shelves` + `wms_bins` chain exists:
     * Shelf + bin mapped into `STORAGE`/`PICKING`,
     * Shelf + bin mapped into `RETURN`.

2. **At least one product is registered**
   * `wms_products` has ≥ 1 row for this shop.
   * Ideally, top SKUs by order volume or by returns risk, but v1 only requires "non-empty".

3. **Inventory ledger is active**
   * `wms_inventory_ledger` has:
     * At least one `RECEIVED` entry, and
     * At least one `STOWED` entry.
   * This proves the core flows receive → stow are wired and persisted.

4. **Pick flow is exercised at least once** (optional but recommended for v1 readiness)
   * At least one `PICKED` entry exists for this shop.
   * This validates that WMS-Lite can execute pick flows for orders.

5. **Return inspection path is functional** (only if ReturnNexus is installed)
   * If ReturnNexus is present for this shop:
     * At least one `ReturnCaseCreatedEvent` has been consumed, and
     * At least one `ReturnInspectionEvent` has been emitted.
   * If ReturnNexus is not installed, this condition is ignored for `WmsLiteReady`, and returns-related tasks are treated as locked cross-sell.

If any of **1–3 fails**, `WmsLiteReady = false`.  
**4–5** are strongly recommended; they may be treated as:

* Required for "Full Warehouse Readiness", or
* Optional milestones once basic readiness is achieved.

## 10.3 Merchant-Facing Onboarding Tasks (What FT0 Should Drive)

From the merchant's point of view, WMS-Lite onboarding should feel like:

1. **Define your basic warehouse layout**
   * **Task:** "Set up your warehouse zones and bins"
   * **Completes when:**
     * Shop has at least:
       * 1 `RECEIVE` zone,
       * 1 `STORAGE` or `PICKING` zone,
       * 1 `RETURN` zone,
     * And at least one shelf + bin exists under `STORAGE`/`PICKING`, and one under `RETURN`.
   * **UX:**
     * Simple guided UI to create zones ("Receiving", "Main Storage", "Returns"),
     * Then shelves & bins inside them.

2. **Register your key products**
   * **Task:** "Register products in WMS-Lite"
   * **Completes when:**
     * `wms_products` has ≥ 1 product for this shop (v1), or
     * Optionally, when coverage threshold is met (e.g., top N SKUs).
   * **UX:**
     * Camera-first or bulk import from Shopify,
     * Show % of orders covered by registered products (future enhancement).

3. **Receive and stow your first items**
   * **Task:** "Receive and stow inventory"
   * **Completes when:**
     * `wms_inventory_ledger` has at least:
       * One `RECEIVED` entry, and
       * One `STOWED` entry.
   * **Purpose:**
     * Proves that physical stock is actually in the ledger, not just on paper.

4. **Pick for an order from WMS-Lite** (recommended)
   * **Task:** "Pick your first order from WMS-Lite"
   * **Completes when:**
     * A `PICKED` ledger entry exists for this shop.
   * This is the bridge from "configured" → "actually running fulfillment through LaSyncro".

5. **Inspect your first return** (conditional on ReturnNexus)
   * **Task:** "Inspect a return and send results"
   * **Only shown if** ReturnNexus is installed.
   * **Completes when:**
     * At least one `ReturnInspectionEvent` has been emitted for this shop.
   * **UX:**
     * Link from ReturnNexus or the Returns view into WMS-Lite's inspection UI,
     * Show "Return inspection completed and sent to ReturnNexus".

6. **Raise your first warehouse issue** (conditional on ProblemCenter)
   * **Task:** "Send a warehouse issue to ProblemCenter"
   * **Only shown if** ProblemCenter is installed.
   * **Completes when:**
     * At least one `WmsIssueIntentEvent` has been emitted.
   * This proves the "physical → issues" pipeline is wired.

These tasks map into a "Warehouse & Returns (WMS-Lite)" collapsible section in the `OnboardingTaskListTracker`. When the module is not installed, the section can appear collapsed with a "Locked – Enable Warehouse Execution" label for cross-sell.

## 10.4 Platform-Level Preconditions (Invisible to Merchant, Critical to Readiness)

The following must be true at the platform level; they are not user tasks, but the system must refuse to mark WMS-Lite as ready if they are broken:

* **Schemas applied**
  * `wms_products`, `wms_zones`, `wms_shelves`, `wms_bins`, `wms_inventory_ledger` exist and migrations applied.
* **Event wiring for returns**
  * A consumer exists for `ReturnCaseCreatedEvent` → kicks off return intake / inspection flows.
  * A producer exists for `ReturnInspectionEvent` and is publishing to:
    * ReturnNexus,
    * SKU OS,
    * ProblemCenter (if present).
* **Event wiring for issues**
  * A producer for `WmsIssueIntentEvent` is wired to ProblemCenter event ingestion.
* **Integration with OrderNexus profit signals**
  * A consumer for `FulfillmentProfitSignal` exists (even if v1 UI only displays priority and notes).
* **Observability pipeline**
  * WMS core metrics (`inventory_movements_total`, `return_inspection_time_ms`, etc.) are being emitted through `MetricsClient` or a no-op equivalent that does not throw.

If any of these are misconfigured, `WmsLiteReadinessSnapshot.flags` must include an appropriate degradation flag (e.g. `EVENT_SINK_DEGRADED`).

## 10.5 Degradation & Soft-Readiness Rules

WMS-Lite is intentionally physically-centric and must degrade gracefully relative to other modules:

* **ReturnNexus missing / down**
  * WMS-Lite can still:
    * Register products,
    * Manage inventory ledger,
    * Run receive/stow/pick/pack/ship flows.
  * `WmsLiteReady` remains true as long as layout + ledger conditions hold.
  * Return inspection tasks are:
    * Hidden if ReturnNexus not installed, or
    * Shown as "locked" if used for cross-sell.
* **ProblemCenter missing / down**
  * WMS-Lite cannot deliver full issue/quality value, but:
    * Inventory and returns inspection still function.
  * `WmsLiteReady` is unaffected, but:
    * "Raise an issue to ProblemCenter" task is hidden or locked.
* **SKU OS missing / down**
  * WMS-Lite still emits `ReturnInspectionEvent`; those events simply won't update product health.
  * `WmsLiteReady` is unaffected; SKU OS benefits are additive.
* **OrderNexus missing / down**
  * WMS-Lite still runs physical flows.
  * Profit-aware prioritization (via `FulfillmentProfitSignal`) is disabled, but not required for base readiness.

**Rule:** `WmsLiteReady` is fundamentally about physical truth and operable flows (layout, ledger, returns inspection), not about every optional intelligence module being present.

## 10.6 Mapping to OnboardingTaskListTracker

In the global `OnboardingTaskListTracker`, WMS-Lite appears as:

**Group: Warehouse & Returns (WMS-Lite)**
**Tasks:**

1. **"Set up your warehouse zones and bins"**
   * Complete when minimal layout is satisfied (RECEIVE + STORAGE/PICKING + RETURN zones, with bins).
2. **"Register products in WMS-Lite"**
   * Complete when `wms_products` has ≥ 1 product for this shop (v1 threshold).
3. **"Receive and stow inventory"**
   * Complete when at least one `RECEIVED` and one `STOWED` ledger entry exists.
4. **"Pick your first order from WMS-Lite"** (recommended)
   * Complete when at least one `PICKED` ledger entry exists.
5. **"Inspect a return and send results"** (conditional on ReturnNexus)
   * Complete when at least one `ReturnInspectionEvent` is emitted.
6. **"Send a warehouse issue to ProblemCenter"** (conditional on ProblemCenter)
   * Complete when at least one `WmsIssueIntentEvent` is emitted.

From the onboarding engine's perspective, WMS-Lite exposes a small derived signal set (conceptually):

* `wmsLite.layoutInitialized: boolean`
* `wmsLite.productsRegisteredCount: number`
* `wmsLite.hasReceiveAndStow: boolean`
* `wmsLite.hasPickEvents: boolean`
* `wmsLite.hasReturnInspections: boolean` (if ReturnNexus installed)
* `wmsLite.hasIssueIntents: boolean` (if ProblemCenter installed)

These are sufficient to drive the FT0 UX without leaking internal schema details.
