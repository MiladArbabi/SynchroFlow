# ORDER-NEXUS FT2 CONTRACT AUDIT

**Scope:** `/api/v1/modules/order-nexus/ft2`
**Audit Type:** End-to-End Structural + Epistemic Integrity
**Boundary:** Database → Resolver → Controller → Adapter → UI

---

# 1. SYSTEM FLOW (CANONICAL PATH)

```
Database
  ↓
Fact Extractors (L1)
  ↓
orderNexusFt2.state.resolver.ts
  ↓
orderNexusFt2.controller.ts
  ↓
Frontend Snapshot Hook
  ↓
mapOrdersFt2Props (Adapter)
  ↓
OrdersModuleFT2
  ↓
OrdersOverviewInfoBlock
  ↓
InfoBlockRow
```

No hidden transformation layers were found.

---

# 2. FT2 CONTRACT (DECLARED INTENT)

FT2 claims:

* State-based
* Lifetime (no temporal windows)
* Deterministic
* No inference
* Observational only
* Null represents epistemic absence

The audit evaluates whether implementation honors this.

---

# 3. ORDERS DOMAIN AUDIT

## 3.1 Fulfilled Orders

Source:
`extractFulfilledOrdersCount`

Definition:

```
status IN ('fulfilled')
COUNT DISTINCT order_id
```

Properties:

* Lifetime
* State-based
* Distinct by order identity
* Null returned if no row

Integrity: VALID

---

## 3.2 Active (Unfulfilled) Orders

Source:
`extractActiveOrdersCount`

Definition:

```
status NOT IN ('fulfilled')
COUNT DISTINCT order_id
```

Properties:

* Lifetime
* State-based
* Disjoint from fulfilled
* Null returned if no row

Integrity: VALID

---

## 3.3 Total Orders

Resolver computes:

```
total = fulfilled + active
```

Mathematical validity:

Since:

```
fulfilled = status == 'fulfilled'
active = status != 'fulfilled'
```

Sets are disjoint and exhaustive.

Therefore:

```
total = fulfilled + active
```

Structural correctness: VERIFIED

---

## 3.4 Constrained Orders

Definition:

```
status != 'fulfilled'
AND inventory_block_type IS NOT NULL
COUNT DISTINCT order_id
```

Properties:

* Subset of unfulfilled
* Disjoint from fulfilled
* Lifetime
* State-based

Invariant:

```
constrained ≤ unfulfilled
```

Integrity: VERIFIED

---

# 4. REVENUE DOMAIN AUDIT

All revenue fields use identical canonical formula:

```
SUM((quantity - returned_quantity) * unit_price)
```

Properties:

* Net of returns
* State-based
* No time filter
* No lifecycle logic
* No obligation interpretation

Revenue Fields:

| Field      | Filter                           |
| ---------- | -------------------------------- |
| totalSales | none                             |
| earned     | status = fulfilled               |
| pending    | status != fulfilled              |
| blocked    | inventory_block_type IS NOT NULL |

Revenue partition logic consistent with order partition logic.

Integrity: VERIFIED

---

# 5. REFUNDS DOMAIN

Delegated to:
`extractRefundsFacts`

Not reinterpreted in resolver.

No evidence of transformation.

Integrity: PASSTHROUGH

---

# 6. FRESHNESS DOMAIN

Definition:

```
MAX(orders.updated_at)
if < 24h → recent
else stale
else unknown
```

Properties:

* State-based
* Not windowed
* Deterministic

Integrity: VALID

---

# 7. EPISTEMIC INTEGRITY AUDIT (CRITICAL)

## 7.1 Fact Extractors Return `null`

Example:

```
if (!row || row.count == null) return null;
```

This preserves epistemic absence.

Correct.

---

## 7.2 Resolver Collapses Null to Zero

Resolver does:

```
fulfilled: fulfilledOrders ?? 0
active: activeOrders ?? 0
total: (fulfilledOrders ?? 0) + (activeOrders ?? 0)
```

And for revenue:

```
sum != null ? value : 0
```

This causes:

```
null → 0
```

Meaning:

| Scenario          | Emitted Value |
| ----------------- | ------------- |
| DB empty          | 0             |
| DB failure        | 0             |
| Join failure      | 0             |
| Partial ingestion | 0             |
| True zero         | 0             |

All states collapse to identical representation.

This destroys epistemic distinction between:

* "There are zero orders"
* "We do not know if there are orders"

This violates FT2 contract principle:

> Null represents epistemic absence.

Current backend implementation does not allow null emission for core numeric fields.

Severity: HIGH

---

# 8. CONTROLLER LAYER

Controller:

```
return res.json(snapshot)
```

No mutation, no filtering.

Integrity: CLEAN

---

# 9. FRONTEND LAYER

## 9.1 Adapter

* Only converts `undefined → null`
* No computation
* Deterministic

Integrity: CLEAN

---

## 9.2 InfoBlock Rendering

`InfoBlockRow`:

```
value ?? '—'
```

Guarantees epistemic absence display.

Frontend correctly preserves null.

Frontend does NOT fabricate values.

---

# 10. CONTRACT VIOLATIONS

| ID    | Description                                    | Severity |
| ----- | ---------------------------------------------- | -------- |
| CV-01 | Resolver collapses null to 0                   | HIGH     |
| CV-02 | Snapshot cast to `as any` bypasses type safety | MEDIUM   |

No structural math violations found.

No partition inconsistencies found.

No temporal violations found.

No inference detected.

---

# 11. TRUTH CLASSIFICATION

## Structurally Correct

✔ Order counts partition correctly
✔ Constrained subset invariant holds
✔ Revenue net-of-returns invariant holds
✔ Lifetime (no time filters)

## Epistemically Relaxed

✖ Null states erased
✖ Unknown indistinguishable from zero

---

# 12. FINAL SYSTEM TRUTH ASSESSMENT

The FT2 snapshot is:

* Structurally correct
* Deterministic
* State-based
* Lifetime-consistent

But:

It is not epistemically pure.

The system always asserts certainty of zero.

It never communicates uncertainty.

Therefore:

The InfoBlock tells the truth **only if**:

* Fact extractors are guaranteed non-null under all valid states.

If not, it may present false certainty.

---

# 13. RISK CLASSIFICATION

| Domain                   | Risk   |
| ------------------------ | ------ |
| Structural math          | LOW    |
| Partition logic          | LOW    |
| Constrained invariants   | LOW    |
| Revenue aggregation      | LOW    |
| Epistemic classification | HIGH   |
| Type safety              | MEDIUM |

---

# 14. AUDIT VERDICT

The Order-Nexus FT2 contract is:

* Architecturally coherent
* Logically consistent
* Mathematically sound

But:

It violates its own epistemic doctrine by collapsing null to zero at resolver level.

No fabricated numbers detected.
But potential fabricated certainty exists.

---

# 15. RECOMMENDED NEXT ACTIONS

1. Restore null preservation in resolver.
2. Remove `as any` and enforce `OrderNexusFT2Snapshot` type.
3. Add invariant assertions for development environment.
4. Add integration test for null propagation.

---

# FINAL STATUS

Frontend: Truthful mirror.
Controller: Transparent transport.
Resolver: Structurally correct but epistemically aggressive.
Database math: Sound.

Audit complete.
