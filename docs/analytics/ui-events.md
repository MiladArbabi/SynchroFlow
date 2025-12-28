# UI Events Analytics Contract

## Purpose

This document defines the **canonical contract** for frontend UI analytics events in LaSyncro.

The goal is to ensure:

* Signal quality
* Long-term comparability
* Zero coupling to lifecycle, entitlement, or backend state
* Vendor-agnostic instrumentation

This contract is **locked**. Changes require explicit review.

---

## Event: `ui.intent`

### Definition

Emitted when a user expresses **explicit intent to act** on a UI surface.

This is a **semantic event**, not a click log.

---

### Shape

```ts
{
  event: 'ui.intent',
  payload: {
    action: string;
    surface: string;
    moduleId?: string;
  }
}
```

---

### Payload Fields

#### `action`

A verb describing **what the user intends to do**.

Examples:

* `continue`
* `start`
* `dismiss`
* `upgrade`
* `explore`

Rules:

* Must be lowercase
* Must be stable over time
* Must describe intent, not mechanics

---

#### `surface`

Identifies **where the intent occurred**.

Examples:

* `ft1_onboarding_gate`
* `dashboard_diagnostic`
* `paywall_modal`

Rules:

* Snake_case
* Represents a conceptual surface, not a component name
* Must not encode lifecycle phase implicitly

---

#### `moduleId` (optional)

Identifies the module associated with the intent.

Examples:

* `order-nexus`
* `sku-os`
* `specter`

Rules:

* Optional
* Required only when the intent is module-scoped

---

## Explicitly Forbidden Fields

The following MUST NEVER be included in `ui.intent` payloads:

* `phase`
* `ft`
* `lifecycle`
* `entitlement`
* `plan`
* `userTier`
* `isPaid`
* `isComplete`

Rationale:
These are **derived or backend-owned concepts** and will be joined later in analytics pipelines.

Embedding them here causes:

* data drift
* double-derivation
* inconsistent reporting

---

## Design Principles

1. **Emit intent, not state**
2. **Frontend observes, backend explains**
3. **Events must be replayable years later**
4. **Analytics must survive product refactors**

---

## Enforcement

* Tests MUST assert payload shape
* Any new UI event type requires a contract update
* Violations are considered architectural regressions

---

## Status

🔒 **Locked**