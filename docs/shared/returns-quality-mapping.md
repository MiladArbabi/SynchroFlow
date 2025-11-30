Here’s the full standalone file you can drop in as
`docs/shared/ReturnsQualityMapping.md` (or similar).
This is written as **the** canonical reference that all modules (ReturnNexus, WMS-Lite, SKU OS, InsightCore, MarginCore) point to.

---

````md
# Returns & Quality – Canonical Mapping (v1 Locked)

> **Mission:** Provide a **single, canonical mapping** between:
>
> - Customer-facing return reasons (`ReturnReasonCategory`)
> - Physical condition codes (`PhysicalConditionCode`)
> - Financial inspection outcomes (`InspectionResult`)
> - Root-cause categories (`IssueRootCause`)
> - Restockability & SKU OS degradation behavior
>
> so that **ReturnNexus**, **WMS-Lite**, **SKU OS**, **InsightCore**, and **MarginCore**
> stay mathematically aligned and no one “optimizes” their own mapping in isolation.

This document is **descriptive but locked** for v1.

Any change to the mappings below **requires**:

- `returns-quality-contract` v2
- `return-nexus` v2
- `wms-lite` v2
- `sku-os` v2
- `insight-core` migration for historical data

No ad-hoc edits.

---

## 0. Canonical Types (Source of Truth)

The following enums are defined in:

- `packages/shared/src/contracts/returns-quality-contract.ts`
- `wms-lite` & `ReturnNexus` blueprints

```ts
// Reason categories – customer-facing
export type ReturnReasonCategory =
  | 'PRODUCT_DEFECT'
  | 'PACKAGING_DEFECT'
  | 'DAMAGED_IN_TRANSIT'
  | 'SIZE_FIT_ISSUE'
  | 'NOT_AS_DESCRIBED'
  | 'CUSTOMER_CHANGED_MIND'
  | 'OTHER';

// Financial inspection outcome – ReturnNexus
export type InspectionResult =
  | 'APPROVED_REFUND_RESTOCKABLE'
  | 'APPROVED_REFUND_SCRAP'
  | 'PARTIAL_REFUND'
  | 'REJECTED_REFUND';

// Canonical root cause – shared across modules
export type IssueRootCause =
  | 'MANUFACTURING_QUALITY'
  | 'PACKAGING_QUALITY'
  | 'FULFILLMENT_ERROR'
  | 'CARRIER_DAMAGE'
  | 'CUSTOMER_EXPECTATIONS'
  | 'CUSTOMER_MISUSE'
  | 'UNKNOWN';

// Physical condition – WMS-Lite
export type PhysicalConditionCode =
  | 'GOOD'
  | 'DAMAGED_PRODUCT'
  | 'DAMAGED_PACKAGING'
  | 'MISSING_PARTS'
  | 'SIGNS_OF_USE'
  | 'WRONG_ITEM_RETURNED'
  | 'EMPTY_BOX'
  | 'UNKNOWN';
````

> **LOCKED NOTE:**
> No module may introduce alternative enums or “slightly different” categories
> for these concepts in v1. All quality analytics, returns logic, and SKU OS
> degradation **must** be expressed in terms of these canonical values.

---

## 1. Conceptual Buckets (for Degradation & Analytics)

For SKU OS and InsightCore we group combinations into 4 **logical buckets**
(these are **conceptual buckets**, not additional enums):

1. **Quality Defect Bucket**

   * Manufacturing or packaging-related issues.
   * Signals **true product quality problems**.

2. **Fulfillment / Process Bucket**

   * Errors in pick/pack/ship, wrong item, missing parts, empty box.
   * Signals **warehouse / process issues**, not inherent product quality.

3. **Fit / Expectations Bucket**

   * Size, fit, “not as described”, customer expectations mismatch.
   * Signals **positioning / expectations / content problems**, not necessarily defective product.

4. **Customer Behavior Bucket**

   * Customer changed mind, misuse, abuse.
   * Signals **behavioral / policy** issues.

> **LOCKED NOTE:**
> SKU OS degradation rules and InsightCore quality dashboards
> assume these **four conceptual buckets** when aggregating and scoring
> return/quality behavior. Any v1 rules MUST be implementable as
> deterministic functions of:
>
> * `ReturnReasonCategory`
> * `InspectionResult`
> * `IssueRootCause`
> * `PhysicalConditionCode`

---

## 2. Canonical Mapping Table (v1)

This table describes the **intended default mapping** for v1.

* `Restockable?` is the **default** restockability intent; shops may apply stricter rules,
  but **never looser** than this without a v2 contract.
* `Degradation Bucket` is the **conceptual bucket** that SKU OS uses to adjust product health.

> This table is **normative**: ReturnNexus, SKU OS, WMS-Lite, and InsightCore
> must all behave **as if** they implement these mapping rules.

### 2.1 Product & Packaging Quality

| # | ReasonCategory   | PhysicalConditionCode           | InspectionResult                 | IssueRootCause        | Restockable?                               | Degradation Bucket    | Notes                                                                |
| - | ---------------- | ------------------------------- | -------------------------------- | --------------------- | ------------------------------------------ | --------------------- | -------------------------------------------------------------------- |
| 1 | PRODUCT_DEFECT   | DAMAGED_PRODUCT | MISSING_PARTS | APPROVED_REFUND_SCRAP            | MANUFACTURING_QUALITY | No                                         | Quality Defect        | Hard signal of true product defect; SKU OS should strongly degrade.  |
| 2 | PRODUCT_DEFECT   | DAMAGED_PRODUCT | MISSING_PARTS | APPROVED_REFUND_RESTOCKABLE      | MANUFACTURING_QUALITY | **Usually no** (optional stricter restock) | Quality Defect        | Treat as near-“scrap”: product is defective even if cosmetically ok. |
| 3 | PRODUCT_DEFECT   | GOOD | UNKNOWN                  | PARTIAL_REFUND | REJECTED_REFUND | MANUFACTURING_QUALITY | Yes                                        | Quality Defect (soft) | Edge cases; still a quality smell but weaker.                        |
| 4 | PACKAGING_DEFECT | DAMAGED_PACKAGING               | APPROVED_REFUND_RESTOCKABLE      | PACKAGING_QUALITY     | Yes                                        | Quality Defect        | Packaging issue; product usually safe to restock with re-packaging.  |
| 5 | PACKAGING_DEFECT | DAMAGED_PACKAGING               | APPROVED_REFUND_SCRAP            | PACKAGING_QUALITY     | No                                         | Quality Defect        | Packaging so bad product must be scrapped.                           |
| 6 | PACKAGING_DEFECT | GOOD                            | PARTIAL_REFUND | REJECTED_REFUND | PACKAGING_QUALITY     | Yes                                        | Quality Defect (soft) | Likely cosmetic / perception issue; soft degradation.                |

### 2.2 Carrier Damage & Fulfillment / Process Issues

| #  | ReasonCategory     | PhysicalConditionCode               | InspectionResult                 | IssueRootCause    | Restockable?   | Degradation Bucket           | Notes                                                                         |
| -- | ------------------ | ----------------------------------- | -------------------------------- | ----------------- | -------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| 7  | DAMAGED_IN_TRANSIT | DAMAGED_PRODUCT | DAMAGED_PACKAGING | APPROVED_REFUND_SCRAP            | CARRIER_DAMAGE    | No             | Fulfillment / Process        | Carrier/transport damage; SKU OS may **not** punish product quality too hard. |
| 8  | DAMAGED_IN_TRANSIT | DAMAGED_PRODUCT | DAMAGED_PACKAGING | APPROVED_REFUND_RESTOCKABLE      | CARRIER_DAMAGE    | **Usually no** | Fulfillment / Process        | Edge case: treat conservatively; do not over-degrade product.                 |
| 9  | DAMAGED_IN_TRANSIT | GOOD                                | REJECTED_REFUND | PARTIAL_REFUND | CARRIER_DAMAGE    | Yes            | Fulfillment / Process (soft) | Often expectation misalignment; mild signal.                                  |
| 10 | OTHER              | WRONG_ITEM_RETURNED | EMPTY_BOX     | PARTIAL_REFUND | REJECTED_REFUND | FULFILLMENT_ERROR | No             | Fulfillment / Process        | Strong process problem; product quality not at fault.                         |
| 11 | OTHER              | MISSING_PARTS                       | APPROVED_REFUND_RESTOCKABLE      | FULFILLMENT_ERROR | Yes            | Fulfillment / Process        | Pick/pack error; degrade process, not product quality.                        |

### 2.3 Fit, Description & Expectation Issues

| #  | ReasonCategory   | PhysicalConditionCode | InspectionResult                 | IssueRootCause        | Restockable? | Degradation Bucket        | Notes                                                                |
| -- | ---------------- | --------------------- | -------------------------------- | --------------------- | ------------ | ------------------------- | -------------------------------------------------------------------- |
| 12 | SIZE_FIT_ISSUE   | GOOD | SIGNS_OF_USE   | APPROVED_REFUND_RESTOCKABLE      | CUSTOMER_EXPECTATIONS | Yes          | Fit / Expectations        | Size/fit; SKU OS should treat as fit/positioning signal, not defect. |
| 13 | SIZE_FIT_ISSUE   | GOOD                  | REJECTED_REFUND | PARTIAL_REFUND | CUSTOMER_EXPECTATIONS | Yes          | Fit / Expectations (soft) | Often borderline policy case; still expectations-related.            |
| 14 | NOT_AS_DESCRIBED | GOOD | SIGNS_OF_USE   | APPROVED_REFUND_RESTOCKABLE      | CUSTOMER_EXPECTATIONS | Yes          | Fit / Expectations        | Content/description problem; product not defective per se.           |
| 15 | NOT_AS_DESCRIBED | DAMAGED_PRODUCT       | APPROVED_REFUND_SCRAP            | MANUFACTURING_QUALITY | No           | Quality Defect + Fit      | When “not as described” hides a real defect; degrade quality harder. |

### 2.4 Customer Behavior & Policy Issues

| #  | ReasonCategory        | PhysicalConditionCode | InspectionResult                 | IssueRootCause  | Restockable? | Degradation Bucket    | Notes                                                                |
| -- | --------------------- | --------------------- | -------------------------------- | --------------- | ------------ | --------------------- | -------------------------------------------------------------------- |
| 16 | CUSTOMER_CHANGED_MIND | GOOD                  | APPROVED_REFUND_RESTOCKABLE      | CUSTOMER_MISUSE | Yes          | Customer Behavior     | Product is fine; SKU OS should **not** degrade product quality.      |
| 17 | CUSTOMER_CHANGED_MIND | SIGNS_OF_USE          | PARTIAL_REFUND | REJECTED_REFUND | CUSTOMER_MISUSE | No           | Customer Behavior     | Abuse of policy; track at policy/customer level, not SKU quality.    |
| 18 | OTHER                 | GOOD | UNKNOWN        | REJECTED_REFUND | PARTIAL_REFUND | UNKNOWN         | Yes          | Neutral / Weak Signal | Treat as neutral in SKU OS unless pattern emerges across many cases. |

> **Implementation guidance:**
>
> * **ReturnNexus** is responsible for deciding:
>
>   * `InspectionResult`
>   * `restockable` (boolean)
>   * `IssueRootCause` (inferred using `inferIssueRootCause` helper + condition)
> * **WMS-Lite** is responsible for:
>
>   * `PhysicalConditionCode`
>   * Linking to `WmsIssue` when present (`issueIds` on inspection lines)
> * **SKU OS** is responsible for:
>
>   * Translating each line into **product health degradation intensity** based on:
>
>     * bucket (quality vs process vs expectations vs behavior)
>     * frequency & severity
>     * returns rate vs demand
> * **InsightCore** is responsible for:
>
>   * Reporting metrics grouped by **bucket**, **reasonCategory**, `IssueRootCause`,
>     and showing restockable vs scrapped volumes.

---

## 3. Module Responsibilities (Quality Mapping)

To avoid ambiguity:

### 3.1 ReturnNexus

* MUST emit `ReturnAnalyticsEvent` using:

  * `reasonCategory: ReturnReasonCategory`
  * `inspectionResult: InspectionResult`
  * `issueRootCause: IssueRootCause`
  * `restockable: boolean`

* MUST follow this mapping document when:

  * Determining `IssueRootCause` (in conjunction with `inferIssueRootCause` helper).
  * Marking `restockable` vs scrap for analytics & SKU OS inputs.

### 3.2 WMS-Lite

* MUST treat `PhysicalConditionCode` as **pure physical truth**.
* MUST NOT compute financial decisions (`InspectionResult`, `refundAmount`).
* SHOULD link condition to WMS issues, but must not change canonical enums.

### 3.3 SKU OS

* MUST interpret `ReturnAnalyticsEvent` **exactly according to this mapping**.

* MUST implement degradation rules as deterministic functions of:

  * `reasonCategory`
  * `inspectionResult`
  * `issueRootCause`
  * `restockable`
  * Historical frequency / volume

* MUST NOT invent alternate categories like “returns_bad_quality_v1” outside this mapping.

### 3.4 InsightCore

* MUST treat `reasonCategory`, `inspectionResult`, `issueRootCause`, `restockable`
  as **dimensions** in the analytics model.
* MAY define metrics like:

  * `returns_due_to_quality_defect`
  * `returns_due_to_expectations`
  * `returns_scrapped_value`
  * `returns_restocked_value`

  as long as they are **pure aggregations** of this canonical mapping.

---

## 4. Change Management (v1 → v2)

If we discover that:

* A new category is needed (e.g. rental damage, seasonal fit),
* The mapping needs to be more granular (e.g. splitting “customer misuse”),
* Shops need overrideable decomposition,

then **we do not patch v1 in place**.

Instead we:

1. Design `returns-quality-contract v2` with:

   * New/extended enums
   * Versioned mappings

2. Add:

   * `ReturnAnalyticsEventV2`
   * Extended SKU OS degradation rules
   * Migration and coexistence strategy in InsightCore

3. Deprecate v1 only after we can fully migrate.

---

**If any engineer implements logic that contradicts this mapping file,
they are no longer building on LaSyncro’s CNS; they’re building their own fork.**