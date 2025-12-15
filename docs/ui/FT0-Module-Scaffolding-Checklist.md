# FT0 UI Module Scaffolding & Wiring Checklist

**Audience:** Frontend / Platform Engineers  
**Scope:** FT0–FT1 UI Modules  
**Status:** Canonical (Customers + Products validated)  

---

## 0. Non-Negotiable Principles

1. **Modules own navigation and routing**
   - Routes
   - Sidenav items
   - Entitlements
   - Lifecycle

2. **The host renders, never defines**
   - Host derives UI from module contracts
   - No host-side nav definitions for modules

3. **Legacy UI is read-only**
   - No new entries
   - No edits for module routes
   - Must be removable without breakage

4. **If it’s not in `ModuleEntry`, it doesn’t exist**

---

## 1. Prerequisites (Must Be True)

Before scaffolding a module:

- ✅ `order-nexus`, `customers`, `products` working as references
- ✅ `ModuleLoader`, `registerRoute`, `registerNav` live
- ✅ `bootstrapNavGroups()` executed on app startup
- ✅ Runtime routes render via `getRegisteredRoutes()`
- ✅ Sidenav consumes `getNavigation()`
- ✅ No new legacy menu entries added

---

## 2. Scaffolding a New Module

### 2.1 Canonical Command

```bash
node scripts/scaffold-ui-module.js <module-id>
````

**Example:**

```bash
node scripts/scaffold-ui-module.js products
```

❌ Do NOT:

- Manually create folders
- Copy another module
- Add npm scripts

---

## 3. Required Folder Structure

```txt
modules/<module-id>/
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
        ├── pages/
        ├── components/
        └── layout/
```

If this structure is wrong → **STOP**.

---

## 4. ModuleEntry.tsx (Single Source of Truth)

### 4.1 Canonical Pattern

```ts
import ProductsPage from './pages/ProductsPage';

const descriptor = {
  id: 'products',
  name: 'Products',
  version: '0.1.0',

  navItems: [
    {
      id: 'products',
      title: 'Products',
      path: '/products',
      group: 'operations',
      order: 30,
      icon: Package,
      requiredModuleId: 'products'
    }
  ],

  routes: [
    {
      id: 'products',
      path: '/products',
      component: ProductsPage,
      requiredModuleId: 'products',
      order: 100
    }
  ]
};

export default descriptor;
```

---

## 5. Nav Groups (Hard Rules)

- ❌ Modules must NOT create groups
- ✅ Groups are defined once in `navBootstrap.ts`

**Allowed group IDs:**

- `core`
- `operations`
- `analytics`
- `settings`

If `group` is missing → nav item will NOT render.

---

## 6. Understanding `order`

### Navigation Ordering

| Order | Meaning               |
| ----: | --------------------- |
|    10 | Primary (Orders)      |
|    20 | Secondary (Customers) |
|    30 | Tertiary (Products)   |
|   50+ | Optional / Advanced   |

### Route Ordering

| Order | Meaning          |
| ----: | ---------------- |
|   100 | Primary route    |
|  200+ | Sub-routes       |
|  500+ | Hidden / utility |

---

## 7. TypeScript Boundary Rules

### ❌ Forbidden

```ts
import ProductsPage from 'apps/frontend/src/pages/ProductsPage';
```

This breaks module isolation and causes TS6059.

### ✅ Required

```txt
modules/products/src/ui/pages/ProductsPage.tsx
```

```ts
import ProductsPage from './pages/ProductsPage';
```

Modules are **self-contained build units**.

---

## 8. Routing Rules (Critical)

### Host (`App.tsx`) must include

```tsx
{getRegisteredRoutes().map(route => (
  <Route
    key={route.id}
    path={route.path}
    element={<route.component />}
  />
))}

<Route path="/products/*" element={<ModuleHost />} />
```

Without the static bridge:

- Deep links fail
- Refresh redirects to dashboard

---

## 9. Sidenav Architecture (Final Form)

- Legacy menu (`apps/frontend/src/menu-items`) = **temporary**
- Runtime nav (`registerNav`) = **source of truth**
- Duplicate entries mean legacy cleanup is incomplete

### Cleanup Rule

When a module is FT0-ready:

- ❌ Remove it from `menu-items/*`
- ✅ Let runtime nav own it entirely

---

## 10. Completion Checklist (Per Module)

- [ ] Scaffolded via script
- [ ] ModuleEntry defines nav + routes
- [ ] Nav item has group + order + icon
- [ ] Static bridge added in `App.tsx`
- [ ] Legacy sidenav entry removed
- [ ] Refresh + deep link work
- [ ] Tests green
- [ ] Module deletable in isolation

---

## 11. Definition of Done (FT0)

A module is FT0-complete when:

1. It appears once in the sidenav
2. Navigation survives refresh
3. Routing survives deep links
4. Legacy config can be deleted
5. Another engineer can repeat the process without help

---

## 12. Next Modules

Proceed **one at a time**:

1. Analytics
2. Finances
3. Account Settings

No batching. No shortcuts.

```

---
