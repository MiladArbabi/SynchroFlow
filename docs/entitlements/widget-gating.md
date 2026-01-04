# 🧩 Widget Gating – As-Is (Frontend Access Filtering)

This document describes **how widgets are filtered, sorted, and rendered in the frontend**, based on **entitlements and frontend-only heuristics**, exactly as implemented today.

This is an **As-Is description**, not a policy or future design.

---

## Scope (As-Is Only)

This document covers:
- How widgets are filtered using entitlements
- How frontend heuristics influence widget visibility
- How widget ordering is determined
- How widget gating stays consistent with routes and navigation

This document explicitly does **not** define:
- Lifecycle phases (FT0 / FT1 / FT2)
- Billing, plans, or payment proof
- Usage limits or quotas
- Commercial upgrade logic
- Backend capability truth

---

## 1. Widget Registry Structure

All widgets are defined centrally in:

```

apps/frontend/src/components/widgets/widget-registry.tsx

````

Each widget is declared with metadata used **only by frontend filtering logic**.

```ts
export interface WidgetDefinition extends WidgetContentProps {
  component: React.ComponentType<WidgetContentProps>;
  priority: 'critical' | 'high' | 'medium' | 'low';

  // Frontend-only heuristic
  requiresPaidPlan: boolean;

  // Entitlement-based filters
  requiredModuleId?: string;
  requiredFlagId?: string;
}
````

No widget contains entitlement, billing, or lifecycle logic internally.

---

## 2. WidgetContentProps (What Widgets Receive)

Widgets receive presentation and data props only:

```ts
interface WidgetContentProps {
  id: string;
  title: string;
  businessContext: {...};
  metricConfig: {...};

  // Presentation hints only
  intelligenceLevel: 'L1' | 'L2' | 'L3' | 'L4';

  currentValue: number;
  format: 'number' | 'currency' | 'percentage';
  isLoading: boolean;
  isEmpty: boolean;
}
```

⚠️ `intelligenceLevel` is **purely descriptive**.
It is **not** used for gating or entitlement decisions.

---

## 3. Widget Filtering Pipeline

Widgets are filtered exclusively inside:

```
useWidgetRegistry()
```

Filtering is **declarative, deterministic, and frontend-owned**.

---

### Layer 1 — Mode Filtering (Frontend Context)

Widgets are grouped by UI mode:

```
survival
growth
architect
```

Only widgets belonging to the active mode are considered.

This is a **presentation concern only**.

---

### Layer 2 — Frontend Heuristic (`requiresPaidPlan`)

```ts
requiresPaidPlan: boolean
```

Widgets marked with `requiresPaidPlan: true` may be hidden based on frontend user context.

⚠️ **Important**

* This is **not backed by billing**
* This is **not an entitlement**
* This is **not lifecycle-aware**

It is a **UI heuristic only**.

---

### Layer 3 — Entitlement Filtering

Widgets may declare:

```ts
requiredModuleId
requiredFlagId
```

Filtering logic:

```ts
!requiredModuleId || hasModule(requiredModuleId)
!requiredFlagId   || hasFlag(requiredFlagId)
```

Widgets render **only if all declared requirements pass**.

---

## 4. Filtering Implementation (`useWidgetRegistry`)

`useWidgetRegistry()` performs all filtering in one place.

Conceptually:

```ts
widgets
  .filter(byMode)
  .filter(byFrontendHeuristics)
  .filter(byEntitlements)
```

Key invariants:

* Widgets never fetch entitlements
* Widgets never infer lifecycle
* Widgets never inspect billing state
* All gating is centralized and testable

---

## 5. Widget Sorting (Priority Only)

Within each mode, widgets are sorted by:

```
critical → high → medium → low
```

Sorting is **not influenced by entitlements**.

---

## 6. Visibility Behavior

When a widget fails any filter:

* It is **not rendered**
* No locked stub is shown
* No placeholder is mounted

Widget gating is **silent and non-disruptive**.

---

## 7. Consistency with Routes & Navigation

Widget gating uses the **same entitlement snapshot** as:

* Route gating (`requiredModuleId` in routes)
* Navigation gating (Sidenav → MenuList)

This guarantees consistency:

* If a module is granted → routes, nav items, and widgets appear
* If a module is missing → everything disappears together

One entitlement snapshot → multiple enforcement layers.

---

## 8. Adding a New Widget (As-Is Playbook)

1. Create the widget component
2. Register it in `widget-registry.tsx`
3. Declare any required module or flag
4. Optionally mark `requiresPaidPlan` (frontend heuristic)
5. Write or update unit tests

No additional wiring is required.

---

## 9. Tests

Widget gating behavior is validated by:

* `widget-registry.test.tsx`
* `EntitlementsContext.test.tsx`
* `ProtectedRoute.entitlements.test.tsx`

These tests validate **filtering correctness**, not business semantics.

---

## 10. Summary

* Widget gating is **frontend-owned**
* Entitlements are used as **access filters only**
* No lifecycle, billing, or plan truth is involved
* All logic is centralized, declarative, and test-covered
* The system is intentionally minimal and deterministic

---

## 🔒 As-Is Contract Seal

This document reflects **only implemented, scan-verified behavior**.

Any change requires:

1. Code scans
2. Explicit diffs
3. Contract amendment

Forward-looking intent is intentionally excluded.

---