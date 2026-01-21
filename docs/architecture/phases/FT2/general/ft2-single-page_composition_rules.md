# 🧭 FT2 Single-Page Composition Rules

**How multiple FT2 domain surfaces coexist**

**Status:** 🔒 LOCKED
**Scope:** One FT2 page (Orders, future Finance, Fulfillment, Shipping, etc.)
**Explicitly excludes:** routing, insights logic, activation, FT1 concerns

---

## 1. Mental Model (Non-Negotiable)

> **FT2 is a flat observatory, not a hierarchy.**

The page is **not**:

* A funnel
* A workflow
* A diagnostic tree
* A narrative

It is a **single cognitive plane** where multiple truths coexist.

---

## 2. Page-Level Structure (Invariant)

An FT2 page is composed of **exactly three vertical zones**:

```
┌──────────────────────────────────┐
│ Global Controls                  │
├──────────────────────────────────┤
│ Domain Surfaces Grid              │
├──────────────────────────────────┤
│ Insights / Ops Center (placeholder)│
└──────────────────────────────────┘
```

No other zones are allowed.

---

## 3. Global Controls Zone

### Purpose

Control **time and scope only**.

### Allowed components

* FT2DateRangeBar
* (Future) global comparison toggle (off by default)

### Forbidden

❌ Filters by domain
❌ Status toggles
❌ Metrics selectors
❌ Personalization

Global controls must **not change page structure**, only data.

---

## 4. Domain Surfaces Grid (Core of FT2)

### Definition

> A **uniform grid** of domain surfaces, each following the same visual grammar.

### Grid rules

* All domain surfaces are **siblings**
* No nesting
* No prioritization
* No “main” surface

Example mental model:

```
[ Orders ]        [ Fulfillment ]
[ Shipping ]      [ Finance ]
```

Not:

```
[ Orders — MAIN ]
    ├─ Shipping
    └─ Fulfillment
```

---

## 5. Grid Geometry Rules

### Columns

* Desktop: 2 columns
* Large screens: 3 columns (optional, capped)
* Mobile: 1 column

### Rows

* Auto-flow
* Equal vertical rhythm
* No masonry

---

## 6. Surface Weight & Equality

All domain surfaces must:

* Have equal visual weight
* Use the same container style
* Share identical spacing tokens

### Forbidden

❌ Enlarging “important” domains
❌ Collapsing “less important” ones
❌ Reordering based on data

Order is **static and intentional**, not reactive.

---

## 7. Ordering Rule (Hard-Coded)

Domain order is **semantic, not dynamic**.

Recommended canonical order (example):

1. Orders
2. Fulfillment
3. Shipping
4. Finance
5. Customers (future)

Rules:

* Never reorder based on values
* Never reorder based on alerts
* Never reorder per user

If order changes → it must be a **code change**, not state.

---

## 8. Cross-Domain Alignment Placement

Alignment planes **do not get their own surfaces**.

They are:

* Rendered **inside** their related domain surface
* Visually secondary
* Textual / symbolic only (as previously defined)

Why:

* Alignment is **meta**, not a domain
* Giving it a surface elevates it incorrectly

---

## 9. Insights / Ops Center Zone (Placeholder Only)

### Current role (NOW)

> A **reserved surface** acknowledging future work.

### Rules (for now)

* Always rendered
* Always last
* Always visually subdued
* Static placeholder content allowed

### Forbidden (until future phase)

❌ Dynamic logic
❌ Alerts
❌ Actions
❌ Severity encoding

This zone exists to **protect future scope**, not to deliver value today.

---

## 10. Cognitive Load Invariant

At any moment, the user must be able to:

* See **all domain surfaces**
* Without scrolling on desktop
* Without opening drawers
* Without expanding sections

If scrolling is required → too many surfaces → split page.

---

## 11. No Cross-Surface Interaction

Domain surfaces:

* Do not react to each other
* Do not highlight each other
* Do not synchronize hover states

The **user’s brain** does the correlation — not the UI.

---

## 12. No Empty State Hijacking

If a domain has:

* `null`
* `unknown`
* `insufficient`

It still renders its surface.

Rules:

* Show `—`
* Preserve layout
* Never collapse or replace with empty state UI

Absence of data is **still information**.

---

## 13. Failure & Partial Data Rules

* One broken domain must not affect others
* Loading states must be **local**, not page-wide
* Skeletons are allowed **inside** surfaces only

No global spinners once initial snapshot resolves.

---

## 14. Explicit Anti-Patterns (Do Not Drift Here)

❌ “Overview” surface
❌ Summary banner
❌ Health dashboard
❌ Prioritized stack
❌ Alert-first layout

All of these violate FT2’s epistemic neutrality.

---

## Final Lock Statement

> **FT2 pages do not guide attention.
> They expose structure.**

The moment the page tells the user *where to look first* —
FT2 has been compromised.

🔒 **Single-page FT2 composition is now locked.**

---