# Orders Overview — FT2 InfoBlock (Unified & Sealed)

**Status:** ✅ CERTIFIED / SEALED
**Phase:** FT2
**Domain:** Orders Nexus → System Grounding (L1)
**Primitive:** `InfoBlock` (Narrative Unit)

---

## 1. Purpose (Locked)

The **Orders Overview** InfoBlock exists to answer exactly one class of questions:

> **“What is the current structural state of my order system?”**

It provides **grounding truth only** — not explanation, interpretation, or guidance.

This block is intentionally:

* Count-based
* Deterministic
* Read-only
* Platform-agnostic

---

## 2. Rows (Canonical & Ordered)

The Orders Overview InfoBlock contains **exactly three rows**, in this order:

1. **Fulfilled orders**
2. **Unfulfilled orders**
3. **Orders added**

No other rows are permitted.

---

## 3. Row Semantics (Authoritative)

### 3.1 Fulfilled Orders (State-Based · L1)

**Question answered:**

> “How many orders have completed execution?”

**Definition:**

Count of canonical orders whose execution state is finalized.

**Source of truth:**

* `order_fulfillment_status`

**Inclusion rule:**

```text
status IN ('fulfilled', 'delivered')
```

**Properties:**

* Lifetime count
* Execution-backed
* Date-range invariant
* Deterministic

**Not temporal. No comparison.**

---

### 3.2 Unfulfilled Orders (State-Based · L1)

**Question answered:**

> “How many order obligations still exist right now?”

**Definition:**

Count of canonical orders that represent unresolved obligations.

**Source of truth:**

* `order_fulfillment_status`

**Inclusion rule:**

```text
status NOT IN ('fulfilled', 'delivered')
```

**Properties:**

* Lifetime count
* Obligation-based
* Date-range invariant
* Execution-backed

**Not temporal. No comparison.**

> ⚠️ Terminology note (sealed):
> **“Unfulfilled orders”** is the user-facing label.
> Internally this may be referred to as *active obligations*, but that term must **never** surface in UI.

---

### 3.3 Orders Added (Temporal Inflow · L1)

**Question answered:**

> “How many new orders were created during the selected FT2 period?”

**Definition:**

Count of canonical orders created within the FT2 date window.

**Source of truth:**

* `canonical_orders`

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

**This is the only temporal row in the block.**

---

## 4. Explicit Non-Semantics (Global, Non-Negotiable)

No row in Orders Overview may encode or imply:

* revenue, value, margin, or payment state
* velocity, growth, or performance
* backlog health or urgency
* customer intent
* operational progress
* causality or explanation
* recommendations or prioritization

If a row answers *“why”* or *“what should I do”*, it does **not** belong here.

---

## 5. Backend Query Shapes (Sealed)

### Fulfilled Orders

```sql
SELECT COUNT(*)
FROM order_fulfillment_status
WHERE shop_id = :shopId
  AND status IN ('fulfilled', 'delivered');
```

---

### Unfulfilled Orders

```sql
SELECT COUNT(*)
FROM order_fulfillment_status
WHERE shop_id = :shopId
  AND status NOT IN ('fulfilled', 'delivered');
```

---

### Orders Added

```sql
SELECT COUNT(canonical_order_id)
FROM canonical_orders
WHERE shop_id = :shopId
  AND order_created_at >= :from
  AND order_created_at <= :to;
```

---

## 6. Comparison Policy (Sealed)

Only **Orders Added** may display a comparison.

### Rules:

* Comparison is **FT2-adjacent**
* Percentage only
* Fail-closed (`null → —`)
* Uses **canonical fixed windows**
* **Not** relative to the user-selected date range

### Forbidden:

* Comparisons on fulfilled or unfulfilled orders
* Picker-relative comparisons
* Inline interpretation

---

## 7. UI Contract (Exact)

```tsx
<InfoBlock title="Orders overview">
  <InfoBlockRow
    label="Fulfilled orders"
    value={orders.fulfilled}
  />

  <InfoBlockRow
    label="Unfulfilled orders"
    value={orders.unfulfilled}
  />

  <InfoBlockRow
    label="Orders added"
    value={orders.added}
    diff={comparison.orders.added}
  />
</InfoBlock>
```

UI rules:

* `null` renders as `—`
* No derived values
* No fallback defaults
* No inference

Adapters are pipes, not brains.

---

## 8. Failure Modes (Intentional)

| Condition                | Behavior                           |
| ------------------------ | ---------------------------------- |
| No matching rows         | `0`                                |
| Query failure            | `null`                             |
| Missing execution ledger | FT2 blocked upstream               |
| Partial ingestion        | Counts reflect only canonical rows |

FT2 always prefers **absence over fabrication**.

---

## 9. Design Rationale (Why This Is Final)

This structure:

* Separates **state** from **flow**
* Eliminates semantic overload
* Matches SMB mental models *without lying*
* Prevents range-gaming and narrative instability
* Preserves FT2’s epistemic discipline

Anything more expressive belongs in **FT3**, not here.

---

## 10. Final Certification

✔ Semantic boundaries enforced
✔ Temporal vs state separation clean
✔ Deterministic queries
✔ UI contract passive and exact
✔ Comparison policy constrained
✔ No overlap with Revenue or Flow blocks

🔒 **Orders Overview (FT2) is fully sealed.**

No changes permitted without a formal contract revision.

---