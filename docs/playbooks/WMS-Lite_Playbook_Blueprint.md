# laSyncro WMS-Lite Blueprint

**Ledger Sovereignty · Deterministic Projection · Execution Intelligence**

This is the formal contract for:

* `inventory_movements` (ledger)
* `inventory_truth` (projection)
* SKU movement semantics
* Reservation model
* Execution-layer obligations

No ambiguity. No inference. No Shopify imitation.

---

# I. SYSTEM ROLE DEFINITION

laSyncro is **not** a warehouse system.

It is:

> A deterministic inventory CNS (central nervous system).

It:

* Records economic movement.
* Projects mathematical stock state.
* Emits execution signals.
* Never blocks physical reality.
* Never mutates history.

---

# II. CORE ARCHITECTURE

```
inventory_movements  (append-only ledger)
          ↓
rebuildInventoryProjectionforShop(order.shop_id)
          ↓
inventory_truth      (deterministic projection)
          ↓
computeObligationFlags()
          ↓
order_fulfillment_status (execution signals)
```

Each layer has a strict contract.

---

# III. LAYER 1 — LEDGER (inventory_movements)

## 1. Nature

Append-only.
Immutable.
Event-sourced.

### Hard Rules

* ❌ No UPDATE
* ❌ No DELETE
* ❌ No negative protection
* ❌ No oversell prevention
* ❌ No availability logic
* ❌ No fulfillment inference

---

## 2. Movement Semantics (Economic Truth)

### Inbound

| movement_type             | quantity_delta | Meaning                 |
| ------------------------- | -------------- | ----------------------- |
| inbound_purchase          | +N             | Physical stock received |
| refund_return             | +N             | Customer returned item  |
| manual_adjustment         | ±N             | Operator correction     |
| reconciliation_correction | ±N             | Deterministic fix       |

---

### Outbound

| movement_type | quantity_delta | Meaning        |
| ------------- | -------------- | -------------- |
| sale          | -N             | Committed sale |
| damage        | -N             | Lost/damaged   |
| shrinkage     | -N             | Inventory loss |

---

### Reservation Layer (Execution Intent)

| movement_type       | quantity_delta | Meaning      |
| ------------------- | -------------- | ------------ |
| reservation_hold    | +N             | Soft hold    |
| reservation_release | -N             | Release hold |

Important:

* Reservation is NOT sale.
* Reservation affects availability only.
* Reservation never affects on_hand.

---

## 3. Sign Contract (Non-Negotiable)

```
Inbound physical → positive
Outbound physical → negative

reservation_hold → positive
reservation_release → negative
```

If you invert signs, projection breaks.

---

## 4. Ledger Guarantees

* Fully replayable.
* Deterministic.
* Auditable.
* Economically complete.

---

# IV. LAYER 2 — PROJECTION (inventory_truth)

This is NOT a stored source of truth.
It is a cached materialization of ledger math.

---

## 1. Deterministic Math

For each:

```
(shop_id, lasyncro_variant_id, location_code)
```

Compute:

### On Hand

```
SUM(
  inbound_purchase
+ refund_return
+ manual_adjustment
+ reconciliation_correction
+ sale (already negative)
+ damage (negative)
+ shrinkage (negative)
)
```

Result → on_hand_quantity

---

### Reserved

```
SUM(
  reservation_hold
+ reservation_release (negative)
)
```

Result → reserved_quantity

---

### Available

```
available_quantity = on_hand_quantity - reserved_quantity
```

No logic. No clamping. No max(0).

Pure math.

---

## 2. Projection Invariants

* available can be:

  * > 0 → executable
  * = 0 → stockout
  * < 0 → oversell

Oversell is allowed.
Oversell is information.
Oversell is not a bug.

---

## 3. Projection Rebuild

`rebuildInventoryProjectionForShop(order.shop_id)`:

* Deletes affected shops
* Re-aggregates entire ledger
* Inserts fresh projection rows

Must be:

* Idempotent
* Deterministic
* Fast
* Safe to rerun anytime

---

# V. LAYER 3 — EXECUTION INTELLIGENCE

Projection does not decide.

Execution layer interprets.

---

## 1. Obligation Classification

For each order:

```
total_available = SUM(it.available_quantity across variants in order)
```

Interpretation:

| total_available | Meaning    | inventory_block_type |
| --------------- | ---------- | -------------------- |
| > 0             | Executable | NULL                 |
| = 0             | Stockout   | 'stockout'           |
| < 0             | Oversell   | 'oversell'           |

No guessing.
No heuristics.
No partial availability inference.

---

## 2. Important Philosophy

You do NOT:

* Prevent oversell at ledger
* Block reservation writes
* Reject sale movements

You:

* Record reality
* Detect mathematical impossibility
* Emit signals

This is CNS architecture.

---

# VI. SKU MOVEMENT PLAYBOOK

## 1. Seed Opening Balance

Insert:

```
manual_adjustment +N
reference_type = 'opening_balance'
```

Then rebuild projection.

---

## 2. Place Reservation

Insert:

```
reservation_hold +N
```

Rebuild projection.
Evaluate obligations.

---

## 3. Convert Reservation → Sale

Option A (explicit):

* reservation_release -N
* sale -N

Option B (direct sale, if reservation not modeled)

Both are valid.
Consistency matters.

---

## 4. Cancel Reservation

Insert:

```
reservation_release -N
```

Never delete holds.

---

## 5. Correct Bad Entry

Never update.
Never delete.

Insert:

```
reconciliation_correction ±N
```

Ledger remains pure.

---

# VII. LOCATION STRATEGY (WMS-Lite Scope)

Each movement includes:

```
location_code
```

Projection aggregates by:

```
shop_id + variant_id + location_code
```

This allows:

* Multi-warehouse
* Root warehouse abstraction
* External WMS integration
* Future bin-level modeling

WMS-Lite does NOT:

* Track bins
* Track pick waves
* Track shipping labels
* Track receiving workflow

It tracks economic deltas only.

---

# VIII. WHAT WMS-LITE IS NOT

It is NOT:

* A picking system
* A scanning system
* A 3PL controller
* A reservation gatekeeper
* A stock validation engine

It is:

A sovereign economic inventory brain.

---

# IX. FAILURE MODES (And Why They Are Acceptable)

### Oversell

```
available < 0
```

Means:

* Orders exceed stock.
* CNS detected tension.

Correct action:

* Execution layer blocks fulfillment.
* Operator decides outcome.

System remains mathematically correct.

---

### Stockout

```
available = 0
```

Edge state.
Clear signal.
Still correct.

---

# X. GUARANTEES OF THE SYSTEM

If contracts are respected:

1. Ledger is permanent.
2. Projection is deterministic.
3. Oversell is detectable.
4. Execution is idempotent.
5. No mutation risk.
6. No ghost stock.
7. No hidden state.
8. No reconciliation drift.

---

# XI. OPERATIONAL COMMAND CHECKLIST

## Check ledger

```
SELECT movement_type, quantity_delta
FROM inventory_movements
WHERE shop_id = ?
AND lasyncro_variant_id = ?
ORDER BY occurred_at;
```

---

## Check projection

```
SELECT on_hand_quantity,
       reserved_quantity,
       available_quantity
FROM inventory_truth
WHERE shop_id = ?
AND lasyncro_variant_id = ?
AND location_code = ?;
```

---

## Check execution signal

```
SELECT lasyncro_order_id,
       inventory_block_type
FROM order_fulfillment_status
WHERE shop_id = ?;
```

---

# XII. FINAL CONTRACT

You maintain:

* Ledger purity
* Mathematical projection
* Signal-based execution

You never:

* Patch truth
* Block ledger writes
* Collapse oversell
* Infer stock

You observe.
You compute.
You classify.

That is WMS-Lite in laSyncro.

CNS architecture complete.