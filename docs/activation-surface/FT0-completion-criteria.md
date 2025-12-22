## FT0 Completion Criteria (Authoritative)

FT0 is **COMPLETED** when **ALL** of the following are true:

---

### **1️⃣ Platform Connection Exists**

**Purpose:** prove merchant intent

**Rule**

```ts
integrations.count(shop_id) >= 1
```

At least one row exists in `integrations`.

---

### **2️⃣ Initial Sync Has Completed**

**Purpose:** prove ingestion finished at least once

**Rule**

```ts
exists integration where sync_status === 'COMPLETED'
```

Not inferred. Not timed. Explicit.

---

### **3️⃣ Canonical Data Is Present**

**Purpose:** prove ingestion produced usable data

**Rules**

```ts
canonical_orders.count(shop_id) >= 1
canonical_products.count(shop_id) >= 1
```

Both are required.
Orders without products (or vice versa) is not insight-ready.

---

### **4️⃣ First Insight Has Been Delivered (Commit Latch)**

**Purpose:** prevent premature unlocks

**Rule (authoritative latch)**

```ts
users.first_insight_delivered === true
```

This is the **only** condition that:

* confirms insight readiness
* is persisted
* is user-meaningful

Signals may *suggest*.
This flag *confirms*.

---

## Summary Table

| # | Criterion               | Source                          | Type             |
| - | ----------------------- | ------------------------------- | ---------------- |
| 1 | Integration exists      | `integrations`                  | hard gate        |
| 2 | Sync completed          | `integrations.sync_status`      | hard gate        |
| 3 | Orders ingested         | `canonical_orders`              | hard gate        |
| 4 | Products ingested       | `canonical_products`            | hard gate        |
| 5 | First insight delivered | `users.first_insight_delivered` | **commit latch** |

**FT0 completes only when all five pass.**

---

## Why This Is the Right Line (No Excuses)

* Prevents “empty dashboards”
* Prevents false-positive readiness
* Aligns FT0 with **actual value delivery**
* Uses **existing persisted fields**
* Requires **zero frontend logic**
* Idempotent and auditable

---

## Explicit Non-Criteria (Intentionally Excluded)

These **do NOT block FT0**:

* Order volume thresholds
* SKU health quality
* Specter funnel richness
* Missing costs
* Mode selection
* Entitlements (FT1)

Those belong **after FT0**.

---

## Contract Statement (Final)

> **FT0 is complete when the system has successfully ingested data and delivered at least one real insight to the merchant.**

Nothing more.
Nothing less.

---