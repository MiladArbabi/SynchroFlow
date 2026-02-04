# Revenue Overview — FT2 InfoBlock (Unified & Sealed)

**Status:** ✅ CERTIFIED / SEALED
**Phase:** FT2
**Domain:** Orders Nexus → Revenue Grounding (L1)
**Primitive:** `InfoBlock` (Narrative Unit)

---

## 1. Purpose (Locked)

The **Revenue Overview** InfoBlock exists to answer exactly one class of questions:

> **“How much sales value is structurally available, resolved, or unresolved within this period?”**

It exposes **availability-based revenue only**.

This block is intentionally:

* Aggregate-only
* Temporal (window-bound)
* Execution-aware (coverage-gated)
* Read-only
* Non-financial (no profit, no payment, no margin)

---

## 2. Rows (Canonical & Ordered)

The Revenue Overview InfoBlock contains **exactly three rows**, in this order:

1. **Total sales**
2. **Earned revenue**
3. **Pending revenue**

No other rows are permitted.

> ⚠️ **Blocked revenue is explicitly excluded** and belongs to **Obligation Overview**.

---

## 3. Row Semantics (Authoritative)

### 3.1 Total Sales (Temporal · L1)

**Question answered:**

> “How much sales value was generated in this period?”

**Definition:**

Sum of sales value from canonical orders within the FT2 date window.

**Source of truth:**

* `canonical_orders.total_price`

**Time column:**

* `order_created_at`

**Inclusion rule:**

```sql
order_created_at >= :from AND order_created_at <= :to
```

**Properties:**

* Temporal
* Window-bound
* Execution-agnostic
* Deterministic

This value **always renders**, regardless of execution coverage.

---

### 3.2 Earned Revenue (Execution-Derived · Coverage-Gated)

**Question answered:**

> “How much of that sales value is no longer at execution risk?”

**Definition:**

Portion of Total Sales whose orders are execution-complete.

**Source of truth:**

* `canonical_orders.total_price`
* `order_fulfillment_status`

**Inclusion rule:**

```text
status IN ('fulfilled', 'delivered')
```

**Properties:**

* Temporal
* Execution-derived
* Coverage-gated
* Deterministic

**Visibility rule:**

* Shown **only if** `executionCoverage === 'sufficient'`
* Otherwise renders as `—`

---

### 3.3 Pending Revenue (Execution-Derived · Coverage-Gated)

**Question answered:**

> “How much sales value is still unresolved but expected?”

**Definition:**

Portion of Total Sales tied to orders not yet execution-complete.

**Source of truth:**

* `canonical_orders.total_price`
* `order_fulfillment_status`

**Inclusion rule:**

```text
status NOT IN ('fulfilled', 'delivered')
```

**Properties:**

* Temporal
* Execution-derived
* Coverage-gated
* Deterministic

**Visibility rule:**

* Shown **only if** `executionCoverage === 'sufficient'`
* Otherwise renders as `—`

---

## 4. Explicit Non-Semantics (Global, Non-Negotiable)

No row in Revenue Overview may encode or imply:

* profit, margin, or cost
* payment, settlement, or cash flow
* blocked, disputed, or constrained value
* causes, attribution, or responsibility
* operational urgency
* recommendations or prioritization

If a value answers *“why”* or *“what should I do”*, it does **not** belong here.

---

## 5. Backend Query Shapes (Sealed)

### Total Sales

```sql
SELECT SUM(total_price)
FROM canonical_orders
WHERE shop_id = :shopId
  AND order_created_at >= :from
  AND order_created_at <= :to;
```

---

### Earned vs Pending Allocation

```sql
SELECT
  SUM(o.total_price) FILTER (WHERE f.status IN ('fulfilled','delivered')) AS earned,
  SUM(o.total_price) FILTER (WHERE f.status NOT IN ('fulfilled','delivered')) AS pending
FROM canonical_orders o
JOIN order_fulfillment_status f
  ON o.canonical_order_id = f.canonical_order_id
WHERE o.shop_id = :shopId;
```

> Allocation is **order-level only**.
> Partial fulfillment is **explicitly unsupported** in FT2.

---

## 6. Coverage Policy (Sealed)

Revenue Overview exposes an explicit epistemic gate:

```ts
executionCoverage: 'sufficient' | 'insufficient'
```

### Rules:

* `totalSales` → always visible
* `earned`, `pending` → visible **only if sufficient**
* Insufficient coverage → fail closed (`null → —`)

Coverage is **observational**, not inferential.

---

## 7. UI Contract (Exact)

```tsx
<InfoBlock title="Revenue overview">
  <InfoBlockRow
    label="Total sales"
    value={revenue.totalSales}
  />

  <InfoBlockRow
    label="Earned revenue"
    value={
      revenue.executionCoverage === 'sufficient'
        ? revenue.earned
        : null
    }
  />

  <InfoBlockRow
    label="Pending revenue"
    value={
      revenue.executionCoverage === 'sufficient'
        ? revenue.pending
        : null
    }
  />
</InfoBlock>
```

UI rules:

* `null` renders as `—`
* No derived math
* No inferred fallback
* No attribution labels
* Formatting only (no logic)

---

## 8. Temporal vs State Boundary (Explicit)

| Block               | Nature         | Date-Range Sensitive |
| ------------------- | -------------- | -------------------- |
| Revenue Overview    | Temporal flow  | ✅ Yes                |
| Orders Overview     | State counts   | ❌ No (except inflow) |
| Obligation Overview | Lifetime state | ❌ No                 |

This distinction is **intentional and sealed**.

---

## 9. Failure Modes (Intentional)

| Condition                    | Behavior                      |
| ---------------------------- | ----------------------------- |
| No matching orders           | `0`                           |
| Missing fulfillment coverage | earned/pending → `—`          |
| Partial ingestion            | Reflects only canonical truth |
| Execution ambiguity          | Fail closed                   |

FT2 always prefers **epistemic honesty over completeness**.

---

## 10. Design Rationale (Why This Is Final)

This structure:

* Separates **value flow** from **value friction**
* Prevents temporal/state confusion
* Matches SMB intuition without collapsing domains
* Survives SKU complexity and data fragmentation
* Eliminates spreadsheet reconciliation behavior

Anything more expressive belongs in **FT3**, not here.

---

## 11. Final Certification

✔ Temporal semantics sealed
✔ Execution coverage explicit
✔ No obligation leakage
✔ No financial inference
✔ UI contract passive and exact
✔ Backend invariants verified against live data

🔒 **Revenue Overview (FT2) is fully sealed.**

No changes permitted without a formal contract revision.

---