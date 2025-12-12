# **📘 10-UI-Module-Folder-Structure-Guide.md**

**LaSyncro UI Platform — Canonical Module Folder Structure Specification**
**Version:** 2.0 (Expanded, Full-Length, CI-Aligned)
**Status:** 🔐 Locked — Authoritative
**Owner:** UI Platform Architecture (LaSyncro Core Team)
**Audience:** Module authors, UI library maintainers, runtime/core contributors, CI maintainers

---

# **0. Why This Document Exists**

LaSyncro is a multi-module, multi-tenant UI platform where business modules ("order-nexus", "sku-os", "specter", etc.) are:

* loaded dynamically at runtime
* versioned independently
* tested via contract tests
* validated by CI against a central runtime API
* required to adhere to strict host expectations

**Folder structure is not a stylistic choice.**
It is a *contractual boundary* between:

* Module authors
* UI runtime
* Navigation system
* Dynamic route registry
* Entitlement system
* Intelligent feature-level composition (Specter, SKU-OS, InsightCore)
* CI contract-test harness

This document defines **exactly how every UI module must be structured** to be allowed into the LaSyncro ecosystem.

---

# **1. Core Principles**

Every rule in this document serves one or more of the following:

## **1.1 Predictability**

The host must be able to infer:

* the module’s entrypoint
* routes
* navigation items
* lifecycle hooks

…without using reflection, heuristics, or scanning the filesystem.

## **1.2 Isolation**

Modules must:

* compile independent of the host
* fail fast when incorrect
* avoid polluting other modules
* expose only a small, explicit API surface

## **1.3 Testability**

CI must be able to:

* run contract tests against any individual module
* verify that the module conforms to runtime expectations
* ensure runtime compatibility before merge

## **1.4 Incremental scalability**

Modules will grow.
LaSyncro itself will grow.
This directory layout must survive years of feature expansion without rewrites.

---

# **2. Canonical Structure (MANDATORY)**

Every UI module **must** follow:

```
modules/
  <module-id>/
    src/
      ModuleEntry.ts
      index.ts
      lifecycle.ts

      routes/
        index.ts
        <feature>Route.ts      (optional)
        <feature>Routes.ts     (optional)

      navigation/
        index.ts               (required)
        <feature>NavItem.ts    (optional)

      ui/
        components/
        pages/
        widgets/               (optional)
        forms/                 (optional)

      state/
        queries/
        mutations/
        atoms/                 (for jotai/zustand if used)
        selectors/             (optional)

      api/
        client.ts              (module-scoped API client)
        services/              (domain logic)

      domain/
        types/
        entities/
        dto/
        validators/

      assets/
        images/
        icons/
        translations/

      __tests__/               (dev-local ONLY, not CI authoritative)

    tsconfig.json
    package.json
    README.md
```

### **2.1 Mandatory Files**

| File                        | Purpose                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| **ModuleEntry.ts**          | Module entrypoint exporting the canonical interface consumed by the host runtime. Required. |
| **lifecycle.ts**            | Optional but recommended. Provides `onLoad`, `onUnload`, subscriptions, warmups.            |
| **src/navigation/index.ts** | Source of truth for navigation items.                                                       |
| **src/routes/index.ts**     | Source of truth for module routes.                                                          |
| **README.md**               | Must describe module purpose, domain, exported API surfaces.                                |

---

# **3. High-Level Diagram**

```
modules/order-nexus/
└── src
    ├── ModuleEntry.ts      # required export: ModuleDescriptor
    ├── lifecycle.ts        # runtime lifecycle hooks
    ├── routes/
    │    └── index.ts       # route descriptors for registry
    ├── navigation/
    │    └── index.ts       # nav items for left-hand menu
    ├── ui/
    │    ├── pages/
    │    └── components/
    ├── state/
    ├── api/
    ├── domain/
    ├── assets/
    └── __tests__/          # optional, NOT authoritative
```

---

# **4. Test Placement Policy (MANDATORY, FINAL)**

This is the single most important refinement in this document.

## **4.1 All authoritative test suites live under `tests/` at the repo root**

```
tests/
  unit/
  contract/
  integration/
  e2e/
  fixtures/
  scripts/
```

### Why?

Because:

* CI test discovery must be deterministic
* modules can be versioned independently
* contract tests cannot live inside modules
* cross-module integration tests require a shared root
* test runners (Jest/Vitest/Cypress) should not deep-scan module folders

This ensures:

* *scalability*
* *reduces duplication*
* *avoids CI surprises*

## **4.2 Module-local tests are optional and non-authoritative**

`modules/<id>/src/__tests__/` is allowed for:

* developer-local smoke tests
* story-based visual tests
* rapid iteration tests

CI will **not** run these unless explicitly imported from the main `tests/` tree.

## **4.3 Contract Test Requirements**

Every module must pass a test in:

```
tests/contract/<module-id>.contract.test.ts
```

This test must:

* require the module entrypoint either from:

  * actual compiled output (`modules/<id>/dist/ModuleEntry`)
  * OR a stub fixture in `tests/fixtures/stubs/<id>-ModuleEntry.js`
* validate:

  * routes
  * nav items
  * lifecycle consistency
  * idempotency of registration
  * schema of the ModuleDescriptor

## **4.4 Example Test Layout**

```
tests/
  unit/
    runtime/
    ui/
    components/
  contract/
    order-nexus.contract.test.ts
    sku-os.contract.test.ts
  integration/
    order-nexus/
  fixtures/
    stubs/
      order-nexus-ModuleEntry.js
  scripts/
```

---

# **5. ModuleEntry Contract Requirements**

`ModuleEntry.ts` must export:

```ts
export interface ModuleDescriptor {
  id: string;                              // MUST match folder name
  version?: string;
  routes: RouteDescriptor[];
  navigation?: NavigationItem[];
  onLoad?: () => Promise<void> | void;
  onUnload?: () => Promise<void> | void;
  exports?: Record<string, unknown>;       // optional module-to-module API
}
```

Requirements:

| Field               | Rules                                                                      |
| ------------------- | -------------------------------------------------------------------------- |
| `id`                | MUST match the folder name exactly.                                        |
| `routes`            | MUST be declared in `src/routes/index.ts`.                                 |
| `navigation`        | MUST be declared in `src/navigation/index.ts`.                             |
| `onLoad`/`onUnload` | Must be pure, sync or Promise-based. No side effects outside module scope. |
| `exports`           | Optional dictionary of functions/types for cross-module consumption.       |

---

# **6. Routes Folder Specification**

`src/routes/index.ts` must export an array of `RouteDescriptor`:

```ts
export interface RouteDescriptor {
  id: string;
  path: string;
  component: LazyExoticComponent<any> | React.FC;
  requiredModuleId?: string;
  requiredFlagId?: string;
  upgradeRoute?: string;
  order?: number;
  meta?: Record<string, any>;
}
```

Rules:

* `id` must be unique across all modules.
* `path` must start with `/`.
* `component` must be lazy-loadable or a direct React component.

---

# **7. Navigation Schema Specification**

`src/navigation/index.ts`:

```ts
export interface NavigationItem {
  id: string;
  label: string;
  icon?: ReactNode;
  path: string;
  order?: number;
  moduleId?: string;
  children?: NavigationItem[];
}
```

Rules:

* `order` is used for deterministic menu rendering.
* Navigation **must not** include conditional logic. Entitlement gating is done at runtime.

---

# **8. Lifecycle Specification**

`src/lifecycle.ts` must export:

```ts
export async function onLoad() {}
export async function onUnload() {}
```

Rules:

* Must not mutate global state.
* Must not register routes or navigation (handled by ModuleEntry).
* Pure behavior only (e.g., warm caches, prefetch data).

---

# **9. Domain Layer Requirements**

Modules must encapsulate domain logic:

```
domain/
  types/
  entities/
  validators/
  utils/
```

Rules:

* No cross-module domain imports.
* Use `@lasyncro/shared` for shared foundational types.

---

# **10. API Layer Requirements**

```
api/
  client.ts
  services/
```

Rules:

* Only the module’s API client may call backend endpoints.
* Must not use global axios instances.
* Must use entitlement tokens from the host context (not module-managed state).

---

# **11. UI Layer Requirements**

```
ui/
  components/
  pages/
  forms/
  widgets/
```

Rules:

* Must not import host-level UI primitives directly — use the approved primitives defined in `06-UI-Primitives-Contract.md`.
* Must not override layout, spacing, theme, breakpoints — must use design tokens.

---

# **12. State Layer Requirements**

```
state/
  queries/
  mutations/
  atoms/
```

Rules:

* Must not store global state.
* Must rely on the host QueryClient (React Query) provided by the runtime.

---

# **13. Asset Requirements**

```
assets/
  images/
  icons/
  translations/
```

Rules:

* Must not exceed 200kb per asset unless approved.
* Must not import from outside the module folder.

---

# **14. Module tsconfig.json Requirements**

Example:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "module": "ESNext",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

Notes:

* Must compile independently.
* Must produce `.d.ts` for host consumption.

---

# **15. Continuous Integration Expectations**

CI must validate:

| Check                      | Description                                           |
| -------------------------- | ----------------------------------------------------- |
| `npm run test:contract`    | Every module must satisfy the ModuleEntry contract.   |
| `npm run test:unit`        | Tests under `tests/unit` must pass.                   |
| `npm run build`            | Module must compile in isolation and within monorepo. |
| `tsc -b`                   | Type errors must be zero.                             |
| No missing required fields | Contract tests ensure descriptor correctness.         |

---

# **16. Anti-Patterns (Prohibited)**

❌ Module defining global state
❌ Module registering routes outside ModuleEntry
❌ Navigation items containing entitlement logic
❌ Module importing from other module folders
❌ Placing authoritative tests inside the module
❌ Using absolute imports outside aliases
❌ Runtime scanning module folders for structure

---

# **17. Fully Compliant Example**

Provided on request — can generate tailored example for `order-nexus`, `sku-os`, or `specter`.

---

# **18. Migration Checklist**

* [ ] Create required folders.
* [ ] Move local tests into `tests/unit` if meant for CI.
* [ ] Create `ModuleEntry.ts`.
* [ ] Add contract test under `tests/contract/<module-id>.contract.test.ts`.
* [ ] Run contract harness.
* [ ] Ensure module builds standalone (`tsc -p modules/<id>/tsconfig.json`).
* [ ] Ensure lazy-loaded components and routes resolve correctly.

---