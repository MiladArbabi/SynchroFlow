Below is a **sealed, copy-paste ready blueprint** for the **Orders total** InfoBlockRow.

Place exactly as-is at:

```
docs/architecture/phases/FT2/orders-nexus/rows/orders-total.md
```

---

# Orders Total — FT2 InfoBlockRow Blueprint

**Status:** ✅ CERTIFIED / SEALED
**Phase:** FT2
**Domain:** Orders Overview → System Grounding (L1)
**Row Label:** `Orders total`

---

## 1. Semantic Definition (Locked)

**Orders total** answers **one and only one question**:

> **“How many canonical orders exist within the FT2 snapshot window?”**

This is a **structural existence count**, not an economic or execution signal.

---

## 2. Explicit Non-Semantics (Forbidden)

This row **does not** encode or imply:

* fulfillment state
* execution confidence (observed vs synthetic)
* revenue, payment, settlement, or margin
* product or SKU completeness
* eligibility, readiness, or health
* causality or trend interpretation

Any inference beyond raw existence is a contract violation.

---

## 3. Canonical Source of Truth

**Table:** `canonical_orders`

**Required invariants:**

* `canonical_order_id` **NOT NULL**
* One row = one canonical order
* Canonical identity resolved **before** FT2

Schema confirmed and enforced.

---

## 4. Temporal Semantics (Critical)

* Time column used: **`order_created_at`**
* Represents canonical business-time order creation
* FT2 snapshot window is resolved via `FT2DateRangePreset`

**This row never uses:**

* `created_at`
* update timestamps
* fulfillment or processing timestamps

---

## 5. Backend Computation Path (End-to-End)

```
Shopify / Platform Sync
   ↓
Canonical Ingestion
   ↓
canonical_orders
   ↓
extractOrderFacts (Layer 1)
   ↓
facts.ordersObserved
   ↓
OrderNexusFT2 Resolver
   ↓
FTEP (exposure only, no mutation)
   ↓
orders.total (FT2 snapshot)
   ↓
UI InfoBlockRow
```

No joins, enrichment, or intelligence intervene in this path.

---

## 6. Exact Query Shape (Authoritative)

```sql
SELECT COUNT(canonical_order_id)
FROM canonical_orders
WHERE shop_id = :shopId
  AND order_created_at >= :from
  AND order_created_at <= :to;
```

### Guarantees

* Deterministic
* Join-free
* Execution-agnostic
* Revenue-agnostic

---

## 7. Eligibility Interaction (Important)

* FT2 eligibility **does not modify** this value
* If FT2 is blocked, the module may not render
* Internally, `orders.total` remains correct and computed

Eligibility gates **exposure**, not **truth**.

---

## 8. UI Contract

```tsx
<InfoBlockRow
  label="Orders total"
  value={orders.total}
  diff={comparison.orders.total}
/>
```

* `number` → provable count
* `null` → epistemic absence only
* UI performs **zero derivation**

---

## 9. Failure Modes (Intentional)

| Condition                  | Behavior                           |
| -------------------------- | ---------------------------------- |
| No orders in window        | `0`                                |
| Query failure              | `null`                             |
| Missing canonical identity | FT2 blocked upstream               |
| Partial ingestion          | Count reflects only canonical rows |

FT2 prefers **absence over fabrication**.

---

## 10. Certification

✔ Canonical source verified
✔ Temporal semantics correct
✔ Query shape contract-compliant
✔ Eligibility interaction clean
✔ UI wiring passive and exact

🔒 **Orders total is sealed and final.**

No changes permitted without a contract revision.

---