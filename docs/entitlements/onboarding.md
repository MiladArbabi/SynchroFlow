# 🚀 Entitlements Onboarding – As-Is Developer Guide

This document explains **how entitlements are introduced and consumed today**, based strictly on **implemented code paths and scan-verified behavior**.

It is an **As-Is guide**, not a roadmap, framework, or future design.

---

## Scope (As-Is Only)

This document covers:
- How backend entitlements are granted
- How frontend gating consumes entitlements
- How modules, flags, routes, and widgets are wired together
- How to verify entitlement behavior

This document explicitly does **not** define:
- Lifecycle authority (FT0 / FT1 / FT2)
- Billing, plans, subscriptions, or pricing
- Upgrade logic or commercial rules
- Usage limits or quotas
- Future entitlement engines or APIs

---

## 1. Mental Model (As Implemented)

All entitlement-based access flows from **one backend snapshot**:

```ts
EntitlementSnapshot = {
  modules: string[];
  flags: string[];
}
````

### Authority split:

* **Backend** decides which entitlements exist
* **Frontend** decides how those entitlements affect visibility and access

No component is allowed to infer entitlements on its own.

---

## 2. Granting a Module Entitlement (Backend)

A **module entitlement** is a string inserted into the database.

### Where this happens

```
shop_module_entitlements
```

Columns (as implemented):

* `shop_id`
* `module_key`
* `flag_key` (nullable)
* `source`

### Default grant (FT0)

Executed automatically via:

```
EntitlementsService.grantDefaultFreeTierForShop(shopId)
```

No enums, registries, or module catalogs exist at the backend layer.

---

### Adding a module entitlement manually

```sql
INSERT INTO shop_module_entitlements (shop_id, module_key, flag_key)
VALUES (123, 'analytics', NULL);
```

That is the **only required backend action**.

---

## 3. Consuming Module Entitlements (Frontend)

The frontend retrieves entitlements via:

```
GET /api/v1/entitlements/me
```

Exposed through:

```
EntitlementsProvider
```

Which provides:

```ts
hasModule(moduleId)
hasFlag(flagId)
```

No frontend code mutates entitlements.

---

## 4. Gating Routes with Entitlements

Routes live in:

```
apps/frontend/src/routes.tsx
```

Routes may declare:

```ts
requiredModuleId?: string;
requiredFlagId?: string;
```

Example:

```ts
{
  key: "analytics",
  route: "/analytics",
  component: <AnalyticsPage />,
  requiredModuleId: "analytics",
}
```

### Enforcement:

* Hidden from navigation if not allowed
* Deep links redirected via `ProtectedRoute`

---

## 5. Gating Navigation

Navigation filtering is derived from routes.

Flow:

```
routes → filterRoutesByEntitlements → MenuList
```

No navigation item may declare entitlements independently.

---

## 6. Gating Widgets

Widgets are declared centrally in:

```
apps/frontend/src/components/widgets/widget-registry.tsx
```

Widgets may declare:

```ts
requiredModuleId?: string;
requiredFlagId?: string;
requiresPaidPlan?: boolean;
```

### Important clarification

⚠️ `requiresPaidPlan` is a **frontend-only heuristic**.
It is **not backed by billing or entitlements**.

Widgets are filtered exclusively inside:

```
useWidgetRegistry()
```

Widgets themselves contain **no entitlement logic**.

---

## 7. Granting and Using Flags

Flags are **strings**, not enums.

### Backend grant

```sql
INSERT INTO shop_module_entitlements (shop_id, module_key, flag_key)
VALUES (123, 'analytics', 'beta-charts');
```

Flags are returned as part of the entitlement snapshot.

### Frontend usage

Flags may gate:

* Widgets
* Routes
* Experimental UI

Example:

```ts
requiredFlagId: "beta-charts"
```

---

## 8. Verifying Entitlements

### Backend

Call:

```
GET /api/v1/entitlements/me
```

Verify:

* `shopId`
* `modules[]`
* `flags[]`

---

### Frontend

Inspect:

```ts
useEntitlements()
```

Common causes of gating failure:

* Typos in module or flag IDs
* Grant applied to wrong shop
* Route/widget declares incorrect requirement

---

## 9. Tests Covering Entitlements

Current tests validate **access projection**, not business logic.

Backend:

* `entitlements.service.test.ts`
* `entitlements.controller.test.ts`
* `integration.controller.test.ts`

Frontend:

* `ProtectedRoute.entitlements.test.tsx`
* `MenuList.entitlements.test.tsx`
* `widget-registry.test.tsx`

---

## 10. Summary

* Entitlements are **simple strings**
* Backend grants them via DB rows
* Frontend consumes them declaratively
* No lifecycle, billing, or plan authority exists here
* All access behavior is deterministic and test-covered

---

## 🔒 As-Is Contract Seal

This document reflects **scan-verified, implemented behavior only**.

Any change requires:

1. Code scans
2. Explicit diffs
3. A documented amendment

Forward-looking intent is intentionally excluded.

---