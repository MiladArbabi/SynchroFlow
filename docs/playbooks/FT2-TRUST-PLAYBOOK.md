# FT2 Trust & Data Health Integration Playbook

## Purpose

This playbook defines **the single, correct way** to integrate **Trust / Data Health** into FT2 modules across the SynchroFlow SaaS.

It exists to:

* Prevent ad-hoc trust logic
* Preserve FT2 epistemic guarantees
* Ensure **consistent UI affordance** across all modules
* Make failures *silent, honest, and non-misleading*

This is not guidance. It is a **contract**.

---

## Core Principles (Non‑Negotiable)

1. **Trust is a boundary, not a message**
   Trust does not explain. It signals whether data is safe to look at.

2. **Trust is terminal**
   Trust FT2 is the final gate. It must never be downgraded, inferred, or overridden downstream.

3. **Null is epistemic absence**
   `null` does not mean bad. It means *not evaluated*.

4. **UI must not lie**
   If trust is unknown, the UI must stay silent.

---

## Canonical Architecture (Locked)

```
Backend (Trust FT2)
   ↓
Frontend Trust FT2 Snapshot (fetch‑only)
   ↓
Module Adapter (structural normalization only)
   ↓
Module UI (derives trustTone)
   ↓
FT2Surface (visual boundary)
```

Each layer has **exactly one responsibility**.

---

## Backend: Trust FT2

### Endpoint

```
GET /api/v1/modules/trust/ft2
```

### Contract

```ts
{
  trustEligible: boolean | null
}
```

### Semantics

| Value   | Meaning                 |
| ------- | ----------------------- |
| `true`  | Epistemically safe      |
| `false` | Unsafe / blocked        |
| `null`  | Unknown / not evaluable |

There is **no partial trust**.

---

## Frontend: Trust FT2 Snapshot Hook

### Location

```
apps/frontend/src/pages/trust/useTrustFt2Snapshot.ts
```

### Responsibilities

* Fetch Trust FT2
* Include authentication
* No mapping
* No inference
* Normalize all failures to `null`

### Required Transport

**MUST use `axiosInstance`** (never raw `fetch`).

Why:

* Auth headers
* Cookie forwarding
* FT2 entitlement evaluation

### Canonical Behavior

```ts
200 → return snapshot
204 → return null
!= 200 → return null
```

---

## Adapters: Structural Normalization Only

### Rule

Adapters **may normalize shape**, but must never:

* Derive UI signals
* Interpret trust meaning
* Invent positive signals

### Allowed

If a module UI expects a richer trust object, the adapter may:

* Pass `trustEligible` through unchanged
* Fill missing dimensions with `null` or `'unknown'`

### Forbidden

* Deriving `trustTone`
* Collapsing trust to booleans
* Dropping trust fields

---

## Module UI: Trust Interpretation (Local Only)

### Where

Inside the **module UI component**, not adapters and not shared UI primitives.

Example:

```
OverviewModuleFT2
OrdersModuleFT2
ProductsModuleFT2
```

### Derivation Rule (Locked)

```ts
trust === null            → no bar
trustEligible === true    → 'trusted'
trustEligible === false   → 'blocked'
trustEligible === null    → 'constrained'
```

This logic must:

* Be derived once per module
* Be applied uniformly to all surfaces in that module

---

## FT2Surface: Visual Boundary Only

### Prop

```ts
trustTone?: 'trusted' | 'constrained' | 'blocked'
```

### Rendering Rules

* Thin left border only
* Full height
* No text
* No icons
* No value coloring

### Color Tokens

Defined **only** in:

```
modules/ui-ft2/src/layout/tokens.ts
```

No module may define its own trust colors.

---

## Visual Semantics (Non‑Judgmental)

| trustTone   | Meaning              | UI         |
| ----------- | -------------------- | ---------- |
| trusted     | epistemically usable | green bar  |
| constrained | partial / unknown    | yellow bar |
| blocked     | unsafe               | red bar    |
| undefined   | not evaluated        | no bar     |

---

## Debugging Playbook

### If trust bars do NOT appear

Check **in this order**:

1. Network:

   ```
   GET /api/v1/modules/trust/ft2
   ```

   * Must be `200`
   * `401` or `403` → auth issue

2. Snapshot hook:

   * Must use `axiosInstance`
   * Must not swallow auth silently during dev

3. Adapter:

   * Must pass trust through
   * Must not derive UI signals

4. Module UI:

   * Must derive `trustTone`
   * Must pass it to `FT2Surface`

5. FT2Surface:

   * Must receive `trustTone`

If any step fails → **no bar is correct behavior**.

---

## Common Anti‑Patterns (DO NOT DO)

* ❌ Coloring values instead of surfaces
* ❌ Showing badges or warnings
* ❌ Explaining trust in text
* ❌ Inferring trust from partial data
* ❌ Using raw `fetch()` in FT2 hooks
* ❌ Computing trust in adapters

---

## Expansion Rules (Future‑Proof)

When adding Trust to a new FT2 module:

1. Import `useTrustFt2Snapshot`
2. Compose it at the page level
3. Pass trust into the adapter
4. Normalize shape if required
5. Derive `trustTone` in module UI
6. Pass `trustTone` to **all** FT2Surface instances

No shortcuts.

---

## Final Mental Model

> **FT2 does not explain reality.**
> **FT2 exposes whether reality is safe to observe.**
> **Trust is the boundary between silence and signal.**

This playbook is now the source of truth.