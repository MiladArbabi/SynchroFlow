# FT0 UI Module Scaffolding & Wiring Checklist

**Audience:** Frontend / Platform Engineers
**Scope:** FT0–FT1 UI Modules
**Reference Module:** `order-nexus`
**Goal:** Ensure every UI module is **module-first**, **host-driven**, **testable**, and **migration-safe**

---

## 0. Non-Negotiable Principles (Read First)

These rules are architectural, not preferences.

1. **Modules are the source of truth**

   * Navigation
   * Routes
   * Entitlements
   * Lifecycle

2. **The host renders derived artifacts**

   * Sidenav
   * Route tree
   * Guards
   * Layouts

3. **Legacy UI is containment only**

   * No new config
   * No new routing
   * No new navigation

4. **If it’s not expressed via a module descriptor, it does not exist**

Violating any of the above means the module is **incorrectly implemented**, even if it “works”.

---

## 1. Prerequisites (Must Be True Before You Start)

Before scaffolding any new module:

* ✅ `modules/order-nexus` exists and is fully wired
* ✅ `ModuleLoader`, `registerRoute`, `registerNav`, `navBootstrap` are live
* ✅ `bootstrapNavGroups()` executes on app startup
* ✅ Runtime navigation integration tests are green
* ✅ You are **not modifying** legacy sidenav config

If any item is false → **stop immediately**.

---

## 2. Scaffolding a New Module (Canonical Way)

### 2.1 Command (Only Allowed Method)

From the **repo root**:

```bash
node scripts/scaffold-ui-module.js customers
```

### ❌ Prohibited

* Do **not** use `npm run scaffold:*`
* Do **not** hand-create folders
* Do **not** copy another module manually

The script is the contract.

---

### 2.2 Expected Directory Structure

After scaffolding, this exact structure must exist:

```
modules/customers/
├── descriptor.json
├── ModuleEntry.stub.js
├── package.json
├── tsconfig.json
└── src/
    ├── descriptor.json
    └── ui/
        ├── ModuleEntry.tsx
        ├── ModuleDescriptor.ts
        ├── index.ts
        ├── components/
        ├── layout/
        └── pages/
```

If this structure differs → **do not proceed**.

---

## 3. Wiring the Module (FT0-Correct Pattern)

### 3.1 ModuleEntry.tsx — Single Source of Truth

**Rules:**

* The host loads the descriptor
* The descriptor declares routes & nav
* The module does **not** import host files
* The host does **not** import module internals

---

### 3.2 Customers ModuleEntry (Correct, Final Pattern)

```ts
// modules/customers/src/ui/ModuleEntry.tsx

import CustomersPage from './pages/CustomersPage';

const descriptor = {
  id: 'customers',
  name: 'Customers',
  version: '0.1.0',

  navItems: [
    {
      id: 'customers',
      title: 'Customers',
      path: '/customers',
      group: 'operations',
      order: 20,
      requiredModuleId: 'customers'
    }
  ],

  routes: [
    {
      id: 'customers',
      path: '/customers',
      component: CustomersPage,
      requiredModuleId: 'customers',
      order: 100
    }
  ]
};

export default descriptor;
```

This mirrors the **Orders** module pattern.

---

## 4. Understanding `order` (Critical Concept)

### 4.1 What `order` Is

`order` is **only a sorting priority**.

* Lower number → appears earlier
* Higher number → appears later

It is **not**:

* A version
* A weight
* A ranking algorithm

---

### 4.2 Canonical Ordering Conventions

#### Navigation (within a group)

| Order | Meaning               |
| ----: | --------------------- |
|    10 | Primary (Orders)      |
|    20 | Secondary (Customers) |
|    30 | Tertiary              |
|   50+ | Optional / advanced   |

#### Routes

| Order | Meaning          |
| ----: | ---------------- |
|   100 | Primary route    |
|  200+ | Sub-routes       |
|  500+ | Hidden / utility |

Consistency matters more than the number itself.

---

## 5. Navigation Group Rules (Hard Constraints)

### 5.1 Source of Truth

Navigation groups are **platform-owned**.

Defined **only** in:

```
apps/frontend/src/runtime/navBootstrap.ts
```

```ts
registerNavGroup({ id: 'core', label: 'Core', order: 10 });
registerNavGroup({ id: 'operations', label: 'Operations', order: 20 });
registerNavGroup({ id: 'analytics', label: 'Analytics', order: 30 });
registerNavGroup({ id: 'settings', label: 'Settings', order: 40 });
```

---

### 5.2 Module Rules

* ❌ Modules must **not** define nav groups
* ✅ Modules must reference an existing group
* ❌ Nav items without `group` are silently ignored

If a nav item does not appear → check the group first.

---

## 6. TypeScript Boundary Rule (Very Important)

### 6.1 ❌ What Breaks Isolation

```ts
import CustomersPage from 'apps/frontend/src/pages/CustomersPage';
```

This causes:

```
TS6059: File is not under rootDir
```

And breaks module isolation.

---

### 6.2 ✅ Correct Pattern

Create a module-local page:

```
modules/customers/src/ui/pages/CustomersPage.tsx
```

Optionally wrap legacy UI:

```ts
import LegacyCustomersPage from 'pages/CustomersPage';

export default function CustomersPage() {
  return <LegacyCustomersPage />;
}
```

Modules must be **self-contained build units**.

---

## 7. App Routing (Host Responsibilities)

### 7.1 Required Static Bridges (FT0)

Until full dynamic routing is complete, each top-level module requires a static bridge.

Example in `App.tsx`:

```tsx
<Route path="/orders/*" element={<ModuleHost />} />
<Route path="/customers/*" element={<ModuleHost />} />
```

This ensures:

* Deep links work
* Refresh works
* Direct URL access works

---

## 8. Entitlements (Why Customers Initially Didn’t Show)

A module **will not appear** if:

* `requiredModuleId` is set
* The entitlement snapshot does **not** include that module

Example snapshot:

```ts
effective modules:
['core_dashboard', 'order-nexus', 'shopify_integration']
```

To show Customers:

* Backend must emit `customers`
* Or temporarily remove `requiredModuleId` during FT0

This is **expected behavior**, not a bug.

---

## 9. Testing Requirements (FT0 Mandatory)

### 9.1 Required Artifacts

* `ModuleEntry.stub.js` exists
* Nav integration test passes
* Routes are registered at runtime

### 9.2 Validation Command

```bash
npx jest tests/ui/runtime/module-nav.integration.test.ts
```

If red → **stop and fix before continuing**.

---

## 10. Migration Rules (Legacy → Module)

### Allowed

* Wrapper components
* Thin adapters
* Temporary static bridges

### Not Allowed

* Editing legacy sidenav config
* Adding new routing logic to legacy files
* Refactoring legacy business logic

Migration is **containment**, not refactor.

---

## 11. Completion Checklist (Customers)

* [x] Module scaffolded via script
* [x] Descriptor is single source of truth
* [x] Nav item registered with group + order
* [x] Route registered via module
* [x] Static route bridge added
* [x] Page loads via URL & sidenav
* [x] Refresh works
* [x] Tests green
* [x] Module removable in isolation

---

## 12. Definition of “Done” (FT0)

A module is FT0-ready when:

1. Navigation works without legacy config
2. Routes resolve on refresh and deep link
3. Entitlements fully control visibility
4. CI validates its contract
5. Another engineer can add a new module **without asking questions**

---

## 13. Next Steps (Strict Order)

Only after **Customers** is fully validated:

1. Remove Customers from legacy sidenav (if present)
2. Repeat **exact same process** for:

   * Products (SKU-OS)
   * Analytics
   * Account Settings

**One module at a time. No batching. No shortcuts.**

---
