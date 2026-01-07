# LaSyncro FT2 Features/Offerings Blueprint

**Truth-First Modular Operating System (FT2 as the Apex)**

---

## 0. Prime Directive (Non-Negotiable)

> **LaSyncro never invents truth.
> It only reveals what is instrumented, owned, and permitted.**

Everything below derives from this.

---

## 1. The Four-Layer Architecture (Mandatory for All Modules)

Every module **must** implement these layers in order.
No skipping. No collapsing. No shortcuts.

```
Persistence
   ↓
Layer 1 — Facts        (What is true)
   ↓
Layer 2 — Intelligence (What it means, internally)
   ↓
Layer 3 — FTEP         (What is allowed to escape)
   ↓
Layer 4 — UI / API     (What the user sees)
```

---

## 2. Layer Definitions (Hard Contracts)

### 🧱 Layer 1 — Facts (Canonical Truth)

**Purpose**

* Extract raw reality from persistence
* Zero interpretation
* Zero intelligence
* Zero inference

**Rules**

* Facts are *owned* by the module
* Facts are nullable
* Facts are timestamped
* Facts never cross modules directly

**Allowed**

* Counts
* Totals
* Raw states
* Physical timestamps
* Monetary figures (if module owns them)

**Forbidden**

* Percentages
* Health statuses
* Trends
* “Good / bad”
* Advice
* Any human language

**Naming**

```
{module}Facts.service.ts
{module}Facts.types.ts
```

---

### 🧠 Layer 2 — Intelligence (Internal Meaning)

**Purpose**

* Classify facts into internal signals
* Derive direction, status, or risk
* Never explain or recommend

**Rules**

* Consumes **only Facts**
* Output is **internal only**
* May degrade to `unknown`
* Deterministic mapping

**Allowed**

* Status enums
* Direction enums
* Boolean existence flags

**Forbidden**

* Strings
* Narratives
* UI labels
* Percent exposure
* Causation

**Naming**

```
{module}Intelligence.service.ts
```

---

### 🛂 Layer 3 — FTEP (Truth Exposure Policy)

**Purpose**

* Enforce what truth may leave the module
* Downgrade intelligence to observability
* Prevent leakage

**Rules**

* Intelligence NEVER leaks
* Only downgraded, factual exposure
* Entitlement-aware
* Shape-stable

**Allowed**

* Neutral observability
* Coarse outcomes
* Direction without explanation

**Forbidden**

* Intelligence objects
* Recommendations
* Confidence language
* Percent-based insights unless owned

**Naming**

```
{module}Ftep.service.ts
{module}Ftep.types.ts
```

---

### 🖥️ Layer 4 — UI / API

**Purpose**

* Render exposed truth
* Never infer
* Never backfill

**Rules**

* Adapter only
* `undefined → null`
* UI reflects uncertainty visibly

**Naming**

```
use{Module}Ft2Adapter.ts
{Module}FT2.tsx
```

---

## 3. Truth Ownership Model (Critical)

Each module owns **exactly one truth domain**.

| Module    | Owns Truth About                   |
| --------- | ---------------------------------- |
| Orders    | Transactions & fulfillment reality |
| Products  | Unit cost & SKU structure          |
| Finances  | Fees, refunds, settlements         |
| Analytics | Time & comparison semantics        |
| Customers | Relationship & identity            |
| WMS-Lite  | Physical movement                  |
| Echo Hub  | Communication state                |

> **No module may fabricate another module’s truth.**

---

## 4. Cross-Module Interaction Rules

### 4.1 Facts Never Cross Modules

Only **FTEP output** may be consumed externally.

### 4.2 Intelligence Never Crosses Boundaries

Ever.

### 4.3 Truth Improves Only When Both Sides Are Paid

| Scenario                   | Result         |
| -------------------------- | -------------- |
| Orders paid, Finances not  | Cost degraded  |
| Orders + Finances paid     | Economic truth |
| Orders + Analytics paid    | Trends visible |
| Analytics paid, Orders not | Nothing        |
| WMS paid, Orders not       | No exposure    |

---

## 5. Entitlement Model (Truth Gates)

Entitlements are **truth flow permissions**, not features.

### Example Flags

```
orders.ft2
products.ft2
finances.ft2
analytics.ft2
wms.ft2
echo.ft2
```

### Rule

> A module may only consume another module’s exposed truth if **both entitlements are present**.

---

## 6. FT2 Free vs Paid (Global Rules)

### FT2-Free

* Snapshot only
* No trends
* No comparisons
* Nulls visible
* Trust-building

### FT2-Paid

* Depth increases
* History expands
* Cross-module truth allowed (with permission)
* No new “magic”

---

## 7. Bundles (Commercial Only)

Bundles are **entitlement shortcuts**, not architectural units.

Examples:

* Operations Bundle = Orders + Products + WMS
* Economics Bundle = Orders + Products + Finances
* Scale Bundle = Orders + Customers + Echo

Internally:

* Same gates
* Same rules
* Same exposure logic

---

## 8. Testing Doctrine (Mandatory)

Every module must include:

### Layer 1 Tests

* Raw facts
* Null preservation
* No derived fields

### Layer 2 Tests

* Deterministic classification
* Unknown handling
* No fact mutation

### Layer 3 Leak-Prevention Tests

* Intelligence not exposed
* No causation language
* No percentages
* JSON string scan

### Layer 4 UI Tests

* Snapshot stability
* Null rendering
* No CTAs in FT2

---

## 9. Why This Wins

Competitors:

* Collapse layers
* Infer missing data
* Hide uncertainty
* Sell dashboards

LaSyncro:

* Preserves reality
* Makes uncertainty explicit
* Scales trust
* Aligns software with operations

---

## 10. Non-Compliance = Architecture Violation

If a future module:

* Skips layers
* Infers missing truth
* Leaks intelligence
* Couples to another module silently

It must be refactored. No exceptions.

---

## Final Lock

> **FT2 is the apex.
> Truth is the product.
> Permission is the price.**

This blueprint is now **canonical**.