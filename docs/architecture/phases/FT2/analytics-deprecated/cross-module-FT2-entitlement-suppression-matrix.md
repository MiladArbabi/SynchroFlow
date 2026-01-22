# 🔐 Cross-Module FT2 Entitlement & Suppression Matrix

**(Truth Visibility Requires Mutual Ownership)**

**Status:** 🔒 CANONICAL • ENFORCED BY ARCHITECTURE
**Applies To:** All FT2-enabled modules
**Doctrine:** *No module may expose truth it does not own.*

---

## 0. Prime Law (Non-Negotiable)

> **No FT2 truth may be exposed unless *both* modules involved are FT2-entitled.**

There are **no exceptions**, no fallbacks, no “helpful defaults”.

If either side lacks entitlement → **truth is suppressed**.

---

## 1. Why This Matrix Exists

Without an explicit entitlement matrix:

* Modules start **querying each other’s tables**
* Analytics starts **recomputing owned truth**
* UI starts **reconstructing suppressed meaning**
* Free tiers accidentally leak paid semantics

This matrix exists to make those failures **structurally impossible**.

---

## 2. Ownership Model (Locked)

Every FT2-enabled module owns **exactly one truth domain**.

| Module    | Owns Truth About                            |
| --------- | ------------------------------------------- |
| Orders    | Order lifecycle & flow                      |
| Products  | Catalog structure & SKU topology            |
| Customers | Customer existence & continuity             |
| Finances  | Economic transactions                       |
| Analytics | **Observability aggregation & suppression** |

Analytics **never owns raw truth**.
It only observes *whether truth exists elsewhere*.

---

## 3. Entitlement Rule (Formal)

For any Analytics domain **D**:

```
Analytics may expose D
IF AND ONLY IF:
  Analytics FT2 entitlement = true
  AND
  D-module FT2 entitlement = true
```

If either side is false → **domain = null**

This rule is enforced at **Layer 1 sourcing**, not UI.

---

## 4. Canonical Entitlement Matrix

### 4.1 Analytics × Orders

| Analytics FT2 | Orders FT2 | Result in Analytics          |
| ------------- | ---------- | ---------------------------- |
| ❌             | ❌          | `orders = null`              |
| ❌             | ✅          | `orders = null`              |
| ✅             | ❌          | `orders = null`              |
| ✅             | ✅          | Orders observability exposed |

**Source of Truth:**
Orders FT2 provider (`getOrderNexusFt2Snapshot`)

**Forbidden:**

* Direct DB access to order tables
* Recomputing order counts inside Analytics

---

### 4.2 Analytics × Products

| Analytics FT2 | Products FT2 | Result in Analytics            |
| ------------- | ------------ | ------------------------------ |
| ❌             | ❌            | `products = null`              |
| ❌             | ✅            | `products = null`              |
| ✅             | ❌            | `products = null`              |
| ✅             | ✅            | Products observability exposed |

**Source of Truth:**
Products FT2 provider (`getProductsFt2Snapshot`)

**Forbidden:**

* Reading platform product tables directly
* Inferring catalog health in Analytics

---

### 4.3 Analytics × Customers

| Analytics FT2 | Customers FT2 | Result in Analytics             |
| ------------- | ------------- | ------------------------------- |
| ❌             | ❌             | `customers = null`              |
| ❌             | ✅             | `customers = null`              |
| ✅             | ❌             | `customers = null`              |
| ✅             | ✅             | Customers observability exposed |

**Source of Truth:**
Customers FT2 provider

**Forbidden:**

* Joining customers ↔ orders
* Computing engagement or churn

---

### 4.4 Analytics × Finances

| Analytics FT2 | Finances FT2 | Result in Analytics            |
| ------------- | ------------ | ------------------------------ |
| ❌             | ❌            | `finances = null`              |
| ❌             | ✅            | `finances = null`              |
| ✅             | ❌            | `finances = null`              |
| ✅             | ✅            | Finances observability exposed |

**Source of Truth:**
Finances FT2 provider

**Forbidden:**

* Revenue aggregation in Analytics
* Currency handling
* Profit inference

---

## 5. Suppression Semantics (Critical)

| Value     | Meaning                          |
| --------- | -------------------------------- |
| `null`    | **Truth intentionally withheld** |
| `unknown` | Truth exists but is ambiguous    |
| `0`       | Explicit absence                 |

**Key Rule:**
`null` at Analytics level **never means “no data”** — it means *“not permitted to see”*.

UI must render `null` as `—` with **no interpretation**.

---

## 6. Where Suppression Must Happen

Suppression is **not a UI concern**.

| Layer        | Suppression Allowed |
| ------------ | ------------------- |
| Facts        | ❌                   |
| Intelligence | ❌                   |
| **FTEP**     | ✅                   |
| Controller   | ❌                   |
| Adapter      | ❌                   |
| UI           | ❌                   |

If suppression occurs anywhere else → **architecture violation**.

---

## 7. Illegal Patterns (Explicitly Banned)

The following patterns are **architectural breaches**:

❌ Analytics querying another module’s DB tables
❌ Analytics recomputing facts already exposed via FT2
❌ UI merging multiple FT2 responses into “meaning”
❌ Adapters defaulting missing domains
❌ Controllers conditionally enriching FT2 payloads

Any of these invalidate FT2 guarantees.

---

## 8. Why Mutual Entitlement Is Non-Negotiable

Allowing Analytics to expose a domain without the domain’s FT2 entitlement would:

* Undercut monetization
* Break ownership boundaries
* Create partial truth leaks
* Enable reverse inference

Mutual entitlement ensures:

> **Truth is revealed only when its owner agrees.**

---

## 9. Future Modules (Replication Rule)

Any new FT2-enabled module must:

1. Own exactly one truth domain
2. Provide its own FT2 provider
3. Expose observability only via FTEP
4. Be explicitly added to this matrix

No entry here → **no aggregation allowed**.

---

## 10. FINAL LOCK

> Cross-module truth is not composable by default.
> It is **earned through mutual permission**.

> Analytics aggregates visibility — not data.
> FT2 enforces restraint — not insight.

This matrix is now **CANONICAL, ENFORCED, AND CLOSED**.

---