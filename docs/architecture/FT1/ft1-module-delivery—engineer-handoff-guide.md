# FT1 Module Delivery — Engineer Handoff Guide (LOCKED)

**Audience:** Any engineer implementing FT1 for a new module
**Modules covered:** Products, Analytics, Finances (and future ones)
**Status:** 🔒 Canonical, enforced by architecture

---

## 0. What You Are Actually Building (Read First)

You are **not** “adding a page”.

You are wiring a **deterministic FT1 diagnostic surface** that spans:

```
DB → Backend signals → Readiness → Frontend adapter
   → Module scenario logic → Module UI → Activation (CTA)
```

If any layer leaks responsibility into another, the system breaks.

---

## 1. Your Deliverable Checklist (What “Done” Means)

A module is FT1-complete **only if all of the following exist**:

✅ Backend signal provider
✅ Frontend adapter
✅ Scenario resolution hook
✅ Diagnostic card UI
✅ Module FT1 page
✅ Public module exports
✅ Frontend mounting page
✅ Aha / activation adapter
✅ Tests for scenarios + UI
✅ Build passes without path hacks

If **any item is missing**, the module is **not done**.

---

## 2. Step-by-Step Implementation Order (Do Not Reorder)

### Step 1 — Define FT1 Scenarios (Module-Owned)

**Where**

```
modules/<module>/src/ui/types.ts
```

**What**
Define the **only allowed scenarios** for FT1.

Example (replace with your module’s semantics):

```ts
export type ProductsFt1Scenario =
  | 'LOADING'
  | 'NO_PRODUCTS'
  | 'LOW_SIGNAL'
  | 'HEALTHY';
```

Rules:

* Scenario names are API
* Do not invent later
* Do not rename later
* Tests depend on these strings

---

### Step 2 — Backend Signal Provider (Facts Only)

**Where**

```
apps/backend/src/onboarding/providers/<module>.provider.ts
```

**What**
Emit **raw facts**, never interpretations.

Example pattern:

```ts
return [
  { name: 'products.itemsKnown', value: boolean },
  { name: 'products.itemCount', value: number | null },
  { name: 'products.signalConfidence', value: number | null }
];
```

Hard rules:

* `null` must stay `null`
* Unknown ≠ zero
* Never emit UI states
* Never emit scenarios

---

### Step 3 — Frontend FT1 Adapter (Pure Mapping)

**Where**

```
apps/frontend/src/pages/<module>/use<Module>Ft1Adapter.ts
```

**What**
Map readiness payload → module props.

Example:

```ts
export function mapProductsFt1Props(data: any): ProductsModuleProps {
  const mod = data.modules.find(m => m.moduleId === 'products');
  const signals = mod?.signals ?? [];

  const get = (n: string) =>
    signals.find(s => s.name === n)?.value;

  const known = get('products.itemsKnown') === true;
  const raw = get('products.itemCount');

  return {
    itemCount: !known ? null : Number(raw),
    signalConfidence: get('products.signalConfidence') ?? null,
  };
}
```

Forbidden in adapters:

* ❌ Hooks
* ❌ Loading logic
* ❌ Scenario logic
* ❌ Lifecycle checks

Adapters are **pure functions**.

---

### Step 4 — Scenario Resolution Hook (Single Authority)

**Where**

```
modules/<module>/src/ui/hooks/use<Module>Ft1Scenario.ts
```

**What**
This hook decides **all scenarios**.

Example:

```ts
export function useProductsFt1Scenario(
  input: { itemCount: number | null; signalConfidence: number | null }
): ProductsFt1Scenario {

  if (input.itemCount === null) return 'LOADING';
  if (input.itemCount === 0) return 'NO_PRODUCTS';
  if (input.signalConfidence === null) return 'LOW_SIGNAL';
  return 'HEALTHY';
}
```

Rules:

* Precedence matters
* `null` always first
* No UI imports
* Fully unit-testable

---

### Step 5 — Diagnostic Card (Mirror Order-Nexus)

**Where**

```
modules/<module>/src/ui/components/<Module>DiagnosticCard.tsx
```

**Required Props (LOCKED)**

```ts
{
  title: string;
  message: string;
  ctaLabel?: string;
  onCtaClick?: () => void;
  testId?: string;
}
```

If you change this API, you must update **all modules** — otherwise don’t.

---

### Step 6 — Module FT1 Page (Deterministic UI)

**Where**

```
modules/<module>/src/ui/pages/<Module>Module.tsx
```

**What**

* Call scenario hook
* Switch on scenario
* Render exactly one card
* Emit intents only

Example pattern:

```tsx
switch (scenario) {
  case 'NO_PRODUCTS':
    return (
      <DiagnosticCard
        testId="products-ft1-no-products"
        title="No products detected"
        message="…"
        ctaLabel="Complete setup"
        onCtaClick={() => emitStart('import-products')}
      />
    );
}
```

Rules:

* No data inspection
* No routing
* No lifecycle logic
* No side effects

---

### Step 7 — Public Module Exports (Critical)

**Where**

```
modules/<module>/src/ui/index.ts
```

**Required shape**

```ts
export { default } from './pages/<Module>Module';

export { use<Module>Ft1Scenario } from './hooks/use<Module>Ft1Scenario';
export type { <Module>Ft1Scenario } from './types';
export type { <Module>UiIntent } from './intents';
```

If this is wrong:

* JSX usage breaks
* Frontend build fails
* Jest gives misleading errors

---

### Step 8 — Frontend Page (Mount Only)

**Where**

```
apps/frontend/src/pages/<Module>Page.tsx
```

**What**

* Gate by lifecycle
* Fetch readiness
* Call adapter
* Mount module

Nothing else.

```tsx
return <ProductsModule {...props} onIntent={onIntent} />;
```

---

### Step 9 — Aha / Activation Adapter

**Where**

```
apps/frontend/src/wiring/<module>AhaAdapter.ts
```

**What**

* Receive intent
* Set checklist focus
* Open checklist
* Emit analytics

Never inspect module state.

---

### Step 10 — Tests (Mandatory)

You must include:

| Test                | Location               |
| ------------------- | ---------------------- |
| Scenario resolution | module hook tests      |
| Adapter mapping     | frontend adapter tests |
| UI scenarios        | module UI tests        |
| CTA intent          | UI test                |

If tests don’t exist, FT1 is incomplete.

---

## 3. Common Failure Modes (Avoid These)

| Symptom                  | Root Cause                           |
| ------------------------ | ------------------------------------ |
| LOADING forever          | Adapter collapsed null → 0           |
| CTA missing              | Scenario is LOADING                  |
| JSX type errors          | Wrong default export                 |
| Jest passes, build fails | Module not exporting ESM             |
| Frontend imports break   | Package not built / version mismatch |

---

## 4. Mental Checklist Before You Say “Done”

Ask yourself:

* Can this module render deterministically with mocked props?
* Does `null` behave differently from `0`?
* Is there exactly **one** scenario authority?
* Can frontend remove the adapter and tests still pass?
* Does this match Order-Nexus behavior exactly?

If any answer is “no”, you are not done.

---

## 5. Final Rule (Read Twice)

> **Modules define truth.
> Frontend composes experience.
> FT1 lives at their boundary.**

This handoff is now the **reference implementation path**.
Deviating from it means re-introducing ambiguity, regressions, and untestable UI.

🔒 **Locked. Repeatable. Enforced.**
