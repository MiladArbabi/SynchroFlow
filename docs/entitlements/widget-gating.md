# 🧩 Widget Gating – v2 (Entitlements, Plan Gating & Registry Rules)

This document explains how **widgets** are gated, displayed, hidden, sorted, and activated in the SynchroFlow frontend using the shared entitlement model:

```
EntitlementSnapshot = { modules: string[], flags: string[] }
```

Widget gating integrates with:

* Free-tier enforcement (FT0)
* Route/nav entitlement gating (#883)
* Plan-aware registry filtering (free / premium / enterprise)
* Mode-aware prioritization (survival / growth / architect)

---

# 1. Widget Registry Structure

All widgets are defined centrally in:

```
apps/frontend/src/components/widgets/widget-registry.tsx
```

Each widget definition includes:

```ts
export interface WidgetDefinition extends WidgetContentProps {
  component: React.ComponentType<WidgetContentProps>;
  priority: 'critical' | 'high' | 'medium' | 'low';
  requiresPaidPlan: boolean;
  dataProcessing: 'light' | 'medium' | 'heavy';

  // NEW (Slice #883)
  requiredModuleId?: string;
  requiredFlagId?: string;
}
```

These fields drive:

* FT0 gating
* Premium gating
* Module gating
* Feature-flag rollout gating

---

# 2. WidgetContentProps (What Widgets Receive)

Widgets implement:

```ts
interface WidgetContentProps {
  id: string;
  title: string;
  businessContext: {...};
  metricConfig: {...};
  intelligenceLevel: 'L1' | 'L2' | 'L3' | 'L4';
  currentValue: number;
  format: 'number' | 'currency' | 'percentage';
  isLoading: boolean;
  isEmpty: boolean;

  // Optional presentation/event props...
}
```

This ensures every widget in the registry is:

* Self-contained
* Declarative
* Capable of receiving any computed or fetched data from its shell

---

# 3. How Widget Gating Works (Core Filtering Algorithm)

Widgets pass through **three layers** of filtering:

## **Layer 1 — User Mode Filtering**

```ts
detected_mode: 'survival' | 'growth' | 'architect'
```

Widgets are grouped by mode in the registry:

```ts
WIDGET_REGISTRY.survival
WIDGET_REGISTRY.growth
WIDGET_REGISTRY.architect
```

Only widgets for the detected mode are considered.

---

## **Layer 2 — Plan Filtering**

```ts
requiresPaidPlan: boolean
```

* Free users (FT0) → hide all paid widgets automatically.
* Premium/Enterprise → show paid widgets if other conditions pass.

This connects pricing → entitlements → visual display.

---

## **Layer 3 — Entitlement Filtering (NEW, #883)**

A widget may require:

```ts
requiredModuleId
requiredFlagId
```

The check is enforced via the shared model:

```ts
widget.requiredModuleId && !modules.includes(widget.requiredModuleId)
widget.requiredFlagId   && !flags.includes(widget.requiredFlagId)
```

Widgets are only shown when **all** requirements pass.

---

# 4. Filtering Logic (`useWidgetRegistry()`)

`apps/frontend/src/components/widgets/useWidgetRegistry.ts` performs the full gating pipeline:

```ts
const widgets = getWidgetsForUser(userConfig)
  .filter(w => !w.requiresPaidPlan || plan !== "free")
  .filter(w => !w.requiredModuleId || hasModule(w.requiredModuleId))
  .filter(w => !w.requiredFlagId || hasFlag(w.requiredFlagId))
```

The UI layer is completely declarative:

* No widget contains entitlement logic
* No widget contains plan logic
* Widgets remain portable, reusable components

---

# 5. Widget Sorting (Mode Prioritization)

For **survival mode**, widgets are sorted by:

```
critical → high → medium → low
```

This ensures the dashboard surfaces the most important signals first for distressed merchants.

Growth and Architect modes rely on future optimized registries.

---

# 6. FT0 Behavior Summary

A Free-Tier (FT0) merchant sees:

### **Available widgets (default modules + no paid plan requirements):**

* Cash Flow
* Inventory Alerts
* Order Metrics
* Top Products
* Sales by Traffic Source

### **Unavailable / Hidden:**

* Advanced Analytics widget (requires `advanced-analytics` module)
* Any L4 or specialized widget requiring:

  * paid plan
  * module not in FT0
  * entitlement flag not granted

Widget gating happens silently — FT0 users don’t see “locked” stubs.

---

# 7. Relationship to Routes & Navigation (NEW CROSS-REFERENCE)

Widget gating uses the **same entitlement model** as:

* **Route gating** (via `requiredModuleId` in routes.tsx)
* **Navigation gating** (Sidenav → MenuList)

This guarantees:

* If you grant a shop `analytics`, both navigation items and widgets appear.
* If you remove a module, everything disappears consistently.

One source of truth → three enforcement layers.

---

# 8. Adding a New Widget (Developer Playbook)

To add a new gated widget:

### Step 1 — Create the component:

```
MyNewWidget.tsx
```

### Step 2 — Add it to the registry:

```ts
{
  id: "reorder-predictions",
  title: "Reorder Predictions",
  component: ReorderWidget,
  intelligenceLevel: "L2",
  priority: "high",
  requiresPaidPlan: false,
  requiredModuleId: "sku-os",   // optional
  requiredFlagId: "beta-reorder", // optional
  currentValue: 0,
  format: "number",
  isLoading: false,
  isEmpty: false,
  businessContext: {...},
  metricConfig: {...}
}
```

### Step 3 — Verify entitlements match backend module/flag IDs.

### Step 4 — No additional UI work required

`useWidgetRegistry()` handles gating automatically.

### Step 5 — Write the corresponding unit test:

```
tests/unit/ui/components/widget-registry.test.tsx
```

---

# 9. Tests

Widget gating is validated in:

* `tests/unit/ui/components/widget-registry.test.tsx`
* `tests/unit/ui/entitlements/EntitlementsContext.test.tsx`
* `tests/unit/ui/components/ProtectedRoute.entitlements.test.tsx`

They confirm:

* Paid widgets hidden for FT0 plan
* Gated widgets hidden unless module/flag present
* Widgets sorted correctly
* Fallback behavior consistent with mode & plan rules

---

# 10. Summary

Widget gating is now:

* Declarative
* Composable
* Consistent with backend capabilities
* Aligned with routing and navigation rules
* Backed by unit tests
* Ready for FT1/FT2 expansion

It is powered by a **single entitlement model** that the entire SynchroFlow frontend uses to control visibility, access, and premium upgrades.

---