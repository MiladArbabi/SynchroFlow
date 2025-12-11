# UI Layout Contract — Modules-as-Domains (Option C)

**Status:** Draft — Module-first layout contract for LaSyncro

**Purpose:**
This document defines the *UI Layout Contract* for LaSyncro's module-first architecture. It prescribes interfaces, lifecycle, layout slots, theming rules, routing & registration APIs, entitlements gating, testing requirements, and migration guidance. The goal is to enable independent, robust, and consistent UI modules that can be developed, tested, deployed, and iterated in parallel while remaining visually and functionally aligned with the LaSyncro shell.

---

## Table of contents

1. Scope & Goals
2. High-level architecture
3. Module layout contract (surface + slots)
4. Module registration API (runtime)
5. Lifecycle hooks
6. Routing contract
7. Theming & styling rules
8. State, data & global context access
9. Entitlements & gating
10. Performance & lazy-loading
11. UX consistency rules
12. Accessibility & i18n
13. Testing & contract verification
14. File structure & repo placement convention
15. Migration checklist (from Page-first to Module-first)
16. Appendices: examples & snippets

---

## 1. Scope & Goals

* Enable each product module (OrderNexus, Specter, InsightCore, SKU-OS, WMS-Lite, ReturnNexus, ProblemCenter) to own its UI surface while relying on a small, stable host contract.
* Reduce cross-module coupling and make modules replaceable/upgradeable.
* Ensure consistent look & feel via global theme + module-level design tokens.
* Provide clear runtime APIs so modules can register mount points, routes, navigation entries and declare entitlements.

## 2. High-level architecture

* **Host Shell (LaSyncro app):** Provides ThemeProvider, global stores (user, entitlements), SSO/auth plumbing, top-nav, global side nav placement, runtime module registry and mount points.
* **Module (Module-as-domain):** Self-contained package exposing:

  * `ModuleDescriptor` (metadata & contract)
  * `ModuleLayout` (React component adhering to layout slots)
  * `moduleEntry` registration function (called by host at startup or lazy-load time)
* **Registry:** Runtime in host that tracks available modules, active modules, entitlements, and mounts them into shell mount points.

## 3. Module layout contract (surface + slots)

Every module MUST export a `ModuleLayout` component which accepts the host-provided props and renders using the prescribed slots.

### 3.1 Required slots

* `HeaderSlot` — small area that appears below global header when module is active; used for module-level title, actions, breadcrumbs.
* `ContentSlot` — main scrollable content area where pages and panels render.
* `SidePanelSlot` — optional right/left side panel for contextual controls (collapsible).
* `ContextPanel` — attachable slide-over panel for deep interactions (task/detail view).
* `FooterSlot` — optional module-scoped footer (rare; avoid unless necessary).

### 3.2 Props contract for ModuleLayout

```ts
interface ModuleLayoutProps {
  moduleId: string;
  host: {
    theme: ThemeSnapshot; // read-only snapshot
    entitlements: EntitlementSnapshot | null;
    user: UserSnapshot;
    navigate: (path: string) => void; // host navigation helper
    openGlobalModal: (id: string, payload?: any) => void;
  };
}
```

* Modules must not mutate `host` objects.
* All interactions with host (navigation, modals, telemetry) should go through `host` functions rather than reaching into the host internals.

## 4. Module registration API (runtime)

Host exposes a single `registerModule()` function used at startup or at dynamic load time.

### 4.1 `ModuleDescriptor` shape

```ts
interface ModuleDescriptor {
  id: string; // unique module id
  version: string; // semver
  displayName: string;
  icon?: React.ReactNode;
  mountPath?: string; // e.g. '/orders'
  routes?: RouteDescriptor[]; // module-provided routes
  requiredModules?: string[]; // dependencies
  requiredFlags?: string[]; // feature flags
  entitlements?: string[]; // modules required entitlement ids
  lazy?: boolean; // host hint
  register: (hostApi: HostApi) => ModuleRegistration; // entrypoint
}
```

### 4.2 Host API passed to modules

```ts
interface HostApi {
  getThemeSnapshot: () => ThemeSnapshot;
  getEntitlements: () => EntitlementSnapshot | null;
  navigate: (path: string) => void;
  registerRoute: (route: RouteDescriptor) => void;
  addNavItem: (navItem: NavItemDescriptor) => void;
  telemetry: (event: TelemetryEvent) => void;
  openModal: (modalId: string, payload?: any) => void;
}
```

### 4.3 Registration return value

Module's `register` returns `ModuleRegistration` with mount component and lifecycle hooks (see Section 5).

## 5. Lifecycle hooks

Modules may implement lifecycle hooks for the host to call:

```ts
interface ModuleRegistration {
  mount: React.ComponentType<ModuleLayoutProps>;
  onMount?: (context: MountContext) => Promise<void> | void;
  onActivate?: (context: ActivateContext) => Promise<void> | void; // when brought into focus
  onDeactivate?: (context: ActivateContext) => Promise<void> | void;
  onUnmount?: (context: MountContext) => Promise<void> | void;
}
```

* `onMount`: run once when module code is loaded and mounted (e.g. setup local store, start subscriptions)
* `onActivate`: called when module becomes the active view (e.g. user navigates to it)
* `onDeactivate`: when module loses focus but remains mounted
* `onUnmount`: final cleanup when module unloaded

## 6. Routing contract

* Modules SHOULD declare their public routes via `routes` in descriptor or call `registerRoute` during `register()`.
* Routes MUST use host's `navigate()` for cross-module navigation.
* Host must provide route-level guard that checks entitlements before resolving a module route.
* Modules MUST support being mounted at a path base (i.e. their routes are relative to `mountPath`).

## 7. Theming & styling rules

* **Single source of truth:** Host theme (MUI ThemeProvider) remains authoritative.
* **Module theme hints:** Modules may declare `themeHints` (preferred spacing scale, required component variants) but must *not* replace the host theme.
* **Component usage:** Use `ui-component` primitives provided by host. If a module needs a custom component, it should live inside module's `ui/` folder and documented.
* **CSS isolation:** Modules should avoid global CSS; prefer CSS-in-JS or CSS modules scoped to module. Use CSS variables only under a `--lsyncro-` prefix.
* **Overrides:** If a module needs to override host component styles, it must register a *scoped* override via host API — these are temporary and require approval.

## 8. State, data & global context access

* **Local state:** Modules should use local state (React state, or module-scoped store like Zustand/RTK Query). Avoid writing to host global state except through explicit host APIs.
* **Fetching data:** Use standard host data API or module-provided API clients. Respect host rate-limits and caching strategies.
* **Subscriptions & events:** Use the Host `EventBus` to publish/subscribe to cross-cutting events. Modules must deregister on unmount.

## 9. Entitlements & gating

* Each module descriptor MUST declare `entitlements` it requires.
* Host enforces gating before mounting. If entitlements missing, host shows upgrade CTA or a gated placeholder content.
* Modules must be resilient to `entitlements === null` (unknown) — show loading skeleton rather than failing.

## 10. Performance & lazy-loading

* Modules SHOULD be lazy-loaded (code-splitting) unless critical to core UX.
* Avoid loading heavy assets on mount. Provide progressive loading skeletons.
* Respect `onMount` async behavior; host should support timeouts and fallback UIs.

## 11. UX consistency rules

* Use `ui-component` primitives for consistent controls (Button, Input, DataGrid, Card).
* Follow spacing, typography and color tokens from host theme.
* Global header behavior: modules must not alter host header layout. Use `HeaderSlot` for module-specific header additions (actions, breadcrumbs).
* Interaction surfaces (confirmations, toasts) MUST use host-provided primitives so messaging and placement is consistent.

## 12. Accessibility & i18n

* Must pass WCAG 2.1 AA checks for module UI surfaces.
* All user-facing strings must be i18n-ready (use host i18n provider/context).
* Use semantic HTML and proper ARIA attributes for widgets.

## 13. Testing & contract verification

* Each module MUST provide a small test-suite that verifies contract compliance:

  * `ModuleDescriptor` shape validation test.
  * Mount/unmount lifecycle test (unit/integration).
  * Accessibility smoke test (axe or similar).
  * Storybook stories for each layout slot and primary workflows.
* Host must provide a `contract-test` harness that modules can run in CI to validate runtime compatibility.

## 14. File structure & repo placement convention

Suggested layout inside monorepo (example):

```
/modules
  /order-nexus
    /src
      /ui
        ModuleDescriptor.ts
        ModuleEntry.tsx
        ModuleLayout.tsx
        /components
        /hooks
      /tests
      package.json
```

* `ModuleEntry.tsx` should export a single `register` function invoked by host.
* `ModuleDescriptor.ts` exports the metadata JSON/TS object.

## 15. Migration checklist (from Page-first to Module-first)

1. Pick a pilot module (OrderNexus or Specter). Create `ModuleDescriptor` and `ModuleLayout` that wraps existing page.
2. Implement `register()` to register routes and nav items with host runtime.
3. Move module-local components into the module `ui/` folder and update imports.
4. Replace direct host context imports with `host` APIs where possible.
5. Add contract tests and required storybook stories.
6. Verify entitlements gating and lazy loading behavior in staging.
7. Iterate and onboard next module.

## 16. Appendices: examples & snippets

* Example `ModuleDescriptor` and `register()` snippet (see appendix file `examples/module-descriptor.md`).

---

## Governance & approval

* Any change to the host `HostApi` or layout slots must be versioned and go through the UI Architecture Review (owner: UI Platform). Backwards-incompatible changes require migration guides and a 2-release deprecation window.

---

*End of UI Layout Contract (Module-first)*

---

# Appendix A — ModuleDescriptor Reference

**Placement:** Append to `docs/ui/04-UI-Layout-Contract.md` under "Appendices: examples & snippets" **OR** keep as a standalone reference at `docs/ui/examples/module-descriptor-reference.md`.

**Status:** Draft

This appendix provides the canonical TypeScript interfaces and field-level guidance for `ModuleDescriptor`, `HostApi`, and `ModuleRegistration`. Use these exact shapes as the contract the host expects when a module calls `register()`.

---

## A.1 Canonical TypeScript Interfaces

> Copy-paste-ready definitions. These should be added to a shared frontend types package or placed in `modules/shared` as `ui-contracts.ts` for reuse.

```ts
// docs/ui/types/ui-contracts.ts (suggested location)
import React from 'react';

export type ModuleId = string; // kebab-case recommended, e.g. 'order-nexus'

export interface EntitlementSnapshot {
  modules: string[]; // e.g. ['platform','order-nexus']
  flags: string[];   // e.g. ['beta-analytics']
}

export interface UserSnapshot {
  id: string;
  email?: string;
  displayName?: string;
  roles?: string[];
}

export interface ThemeSnapshot {
  mode: 'light' | 'dark';
  palette?: Record<string, any>; // read-only snapshot - modules may read, not mut
}

export interface RouteDescriptor {
  id: string;          // unique within module
  path: string;        // relative path, e.g. '/orders'
  exact?: boolean;
  component: React.ComponentType<any> | React.ReactNode;
  title?: string;
  requiredModuleId?: string;
  requiredFlagId?: string;
}

export interface NavItemDescriptor {
  id: string;
  label: string;
  route: string; // absolute or host will resolve mountPath + route
  icon?: React.ReactNode;
  order?: number; // lower = earlier
  requiredModuleId?: string;
  requiredFlagId?: string;
}

export interface HostApi {
  getThemeSnapshot: () => ThemeSnapshot;
  getEntitlements: () => EntitlementSnapshot | null;
  getUserSnapshot: () => UserSnapshot;
  navigate: (path: string) => void;
  registerRoute: (route: RouteDescriptor) => void;
  addNavItem: (item: NavItemDescriptor) => void;
  telemetry: (event: { name: string; payload?: any }) => void;
  openModal: (modalId: string, payload?: any) => void;
  openGlobalModal?: (modalId: string, payload?: any) => void; // alias
  publishEvent?: (topic: string, payload?: any) => void;
}

export interface ModuleLayoutProps {
  moduleId: string;
  host: {
    theme: ThemeSnapshot;
    entitlements: EntitlementSnapshot | null;
    user: UserSnapshot;
    navigate: (path: string) => void;
    openGlobalModal: (id: string, payload?: any) => void;
  };
}

export interface ModuleRegistration {
  mount: React.ComponentType<ModuleLayoutProps> | React.ReactNode;
  onMount?: (ctx: { host: HostApi }) => Promise<void> | void;
  onActivate?: (ctx: { host: HostApi }) => Promise<void> | void;
  onDeactivate?: (ctx: { host: HostApi }) => Promise<void> | void;
  onUnmount?: (ctx: { host: HostApi }) => Promise<void> | void;
}

export interface ModuleDescriptor {
  id: ModuleId; // required, unique
  version: string; // semver
  displayName: string;
  description?: string;
  icon?: React.ReactNode;
  mountPath?: string; // e.g. '/orders'
  routes?: RouteDescriptor[]; // optional; can also call registerRoute at runtime
  requiredModules?: string[]; // runtime dependencies
  requiredFlags?: string[]; // feature flags
  entitlements?: string[]; // entitlement ids
  lazy?: boolean; // hint to host
  register: (hostApi: HostApi) => ModuleRegistration;
}
```

---

## A.2 Field-level guidance & validation rules

* `id`: kebab-case, short, stable. Must match backend module id if the backend also registers module presence.
* `version`: semantic versioning. Host may use to detect incompatible module releases.
* `mountPath`: leading `/` recommended. Host resolves routing as `hostBase + mountPath + route.path`.
* `routes.component`: prefer `React.lazy(() => import('./...'))` to allow host code-splitting.
* `entitlements`: must reference entitlement ids defined in `docs/entitlements` (authoritative source).
* `register`: must be idempotent and synchronous to return a `ModuleRegistration`. Async setup should be placed in `onMount`.
* `requiredModules` / `requiredFlags`: host should prevent registration if unmet (or provide graceful fallback UI).

**Validation rules (CI-contract):**

* `id`, `version`, `displayName`, `register` are required.
* `register` must return an object with a `mount` property.
* `routes` ids must be unique across the module and not clash with host-reserved ids (host will provide reserved-list).

---

## A.3 Runtime expectations

* `register()` will be called by the host with a `HostApi`. Registration should not assume the presence of entitlements — modules must check `hostApi.getEntitlements()` and show appropriate skeleton/gated views.
* `onMount` is intended for long-running initialization (e.g., open a websocket). It must be cancellable via `onUnmount`.
* Any subscriptions created by the module must be cleaned up in `onUnmount`.

---

# Examples — module-descriptor examples

**Placement:** Create `docs/ui/examples/module-descriptor.md` (or keep together in this file). The content here is copy-paste ready.

---

## Example 1 — Minimal ModuleDescriptor (OrderNexus, minimal)

```ts
// modules/order-nexus/src/ModuleEntry.ts
import React from 'react';
import { ModuleDescriptor } from 'docs/ui/types/ui-contracts';

const ModuleLayout: React.FC<any> = ({ moduleId, host }) => {
  return (
    <div>
      <h1>Order Nexus</h1>
      <p>Mounted at {moduleId}</p>
    </div>
  );
};

export const descriptor: ModuleDescriptor = {
  id: 'order-nexus',
  version: '0.1.0',
  displayName: 'Order Nexus',
  mountPath: '/orders',
  register: (host) => {
    // register a simple route
    host.registerRoute({ id: 'orders-home', path: '/', component: ModuleLayout, title: 'Orders' });

    // Optionally add nav item
    host.addNavItem({ id: 'nav-orders', label: 'Orders', route: '/orders', order: 10 });

    return { mount: ModuleLayout };
  },
};

export default descriptor;
```

**Notes:**

* This minimal example uses synchronous `register()` and registers a single route.
* `ModuleLayout` reads nothing from host except navigation when required.

---

## Example 2 — Advanced ModuleDescriptor (Specter-like)

```ts
// modules/specter/src/ModuleEntry.tsx
import React, { lazy } from 'react';
import { ModuleDescriptor } from 'docs/ui/types/ui-contracts';

const SpecterLayout = lazy(() => import('./ui/SpecterLayout'));

export const descriptor: ModuleDescriptor = {
  id: 'specter',
  version: '1.3.0',
  displayName: 'Specter (Customer Intelligence)',
  description: 'Realtime customer session & behavior signals',
  mountPath: '/specter',
  entitlements: ['specter'],
  requiredModules: ['order-nexus'],
  lazy: true,
  register: (host) => {
    // register multiple routes
    host.registerRoute({ id: 'specter-home', path: '/', component: SpecterLayout, title: 'Customer Intelligence', requiredModuleId: 'specter' });

    host.registerRoute({ id: 'specter-config', path: '/config', component: lazy(() => import('./ui/SpecterConfig')), title: 'Specter Config' });

    // nav item with entitlement gating handled by host
    host.addNavItem({ id: 'nav-specter', label: 'Customer Signals', route: '/specter', order: 20, requiredModuleId: 'specter' });

    // telemetry sample
    host.telemetry({ name: 'specter.registered', payload: { version: '1.3.0' } });

    return {
      mount: SpecterLayout,
      onMount: async ({ host: h }) => {
        // warm local cache or register to event bus
        h.publishEvent?.('specter:init', { ts: Date.now() });
      },
      onUnmount: ({ host: h }) => {
        h.publishEvent?.('specter:shutdown');
      }
    };
  }
};

export default descriptor;
```

**Notes:**

* Uses lazy imports; host should render `React.Suspense` with a skeleton.
* Declares `entitlements` and `requiredModules`. Host must gate automatically.
* Demonstrates lifecycle hooks.

---

## Negative examples (what NOT to do)

1. **Directly mutate host internals.** Example: `window.__HOST_STORE__.user = ...` — forbidden. Use HostApi.
2. **Assume synchronous entitlements.** Do not throw if `host.getEntitlements()` returns `null`.
3. **Attach global CSS without prefix.** Avoid global selectors; use CSS-in-JS or module-scoped CSS.
4. **Return `register()` that performs heavy async setup and never returns a mount** — `register()` must return quickly and synchronously; async setup goes in `onMount`.

---

## Validation checklist (for module authors)

* [ ] `id` follows kebab-case and matches backend module id if present.
* [ ] `version` present and semver.
* [ ] `displayName` present.
* [ ] `register` returns an object containing `mount`.
* [ ] `routes` (if provided) have unique `id` values.
* [ ] `entitlements` reference valid IDs from `docs/entitlements`.
* [ ] All user strings are i18n-ready.
* [ ] Tests: mount/unmount, descriptor shape unit test present.

---

## Suggested file placement & commit guidance

* **Module entry file:** `modules/<module-name>/src/ModuleEntry.tsx` or `ModuleEntry.ts` exporting the `ModuleDescriptor` as default or named export `descriptor`.
* **Shared types:** `modules/shared/src/ui-contracts.ts` or `packages/ui-contracts/src/index.ts` (preferred) so host and modules import the same TS types.
* **Examples:** `docs/ui/examples/module-descriptor.md` (create from this file)

**Suggested commit message:** `docs(ui): add ModuleDescriptor reference + examples (Appendix A)`

---

## Migration note

When migrating existing page-first code into module-first:

1. Create a thin `ModuleLayout` that wraps the old page and exposes the required `ModuleLayoutProps` signature.
2. Implement `register()` to call `host.registerRoute` with the existing page component (wrapped with lazy import).
3. Move module-local components into `modules/<module>/src/ui/` and update relative imports.
4. Add a contract test verifying `ModuleDescriptor` shape.

---

*End of Appendix A & Examples

---

# Appendix A — ModuleDescriptor Reference

**Placement:** Append to `docs/ui/04-UI-Layout-Contract.md` under "Appendices: examples & snippets" **OR** keep as a standalone reference at `docs/ui/examples/module-descriptor-reference.md`.

**Status:** Draft

This appendix provides the canonical TypeScript interfaces and field-level guidance for `ModuleDescriptor`, `HostApi`, and `ModuleRegistration`. Use these exact shapes as the contract the host expects when a module calls `register()`.

---

## A.1 Canonical TypeScript Interfaces

> Copy-paste-ready definitions. These should be added to a shared frontend types package or placed in `modules/shared` as `ui-contracts.ts` for reuse.

```ts
// docs/ui/types/ui-contracts.ts (suggested location)
import React from 'react';

export type ModuleId = string; // kebab-case recommended, e.g. 'order-nexus'

export interface EntitlementSnapshot {
  modules: string[]; // e.g. ['platform','order-nexus']
  flags: string[];   // e.g. ['beta-analytics']
}

export interface UserSnapshot {
  id: string;
  email?: string;
  displayName?: string;
  roles?: string[];
}

export interface ThemeSnapshot {
  mode: 'light' | 'dark';
  palette?: Record<string, any>; // read-only snapshot - modules may read, not mut
}

export interface RouteDescriptor {
  id: string;          // unique within module
  path: string;        // relative path, e.g. '/orders'
  exact?: boolean;
  component: React.ComponentType<any> | React.ReactNode;
  title?: string;
  requiredModuleId?: string;
  requiredFlagId?: string;
}

export interface NavItemDescriptor {
  id: string;
  label: string;
  route: string; // absolute or host will resolve mountPath + route
  icon?: React.ReactNode;
  order?: number; // lower = earlier
  requiredModuleId?: string;
  requiredFlagId?: string;
}

export interface HostApi {
  getThemeSnapshot: () => ThemeSnapshot;
  getEntitlements: () => EntitlementSnapshot | null;
  getUserSnapshot: () => UserSnapshot;
  navigate: (path: string) => void;
  registerRoute: (route: RouteDescriptor) => void;
  addNavItem: (item: NavItemDescriptor) => void;
  telemetry: (event: { name: string; payload?: any }) => void;
  openModal: (modalId: string, payload?: any) => void;
  openGlobalModal?: (modalId: string, payload?: any) => void; // alias
  publishEvent?: (topic: string, payload?: any) => void;
}

export interface ModuleLayoutProps {
  moduleId: string;
  host: {
    theme: ThemeSnapshot;
    entitlements: EntitlementSnapshot | null;
    user: UserSnapshot;
    navigate: (path: string) => void;
    openGlobalModal: (id: string, payload?: any) => void;
  };
}

export interface ModuleRegistration {
  mount: React.ComponentType<ModuleLayoutProps> | React.ReactNode;
  onMount?: (ctx: { host: HostApi }) => Promise<void> | void;
  onActivate?: (ctx: { host: HostApi }) => Promise<void> | void;
  onDeactivate?: (ctx: { host: HostApi }) => Promise<void> | void;
  onUnmount?: (ctx: { host: HostApi }) => Promise<void> | void;
}

export interface ModuleDescriptor {
  id: ModuleId; // required, unique
  version: string; // semver
  displayName: string;
  description?: string;
  icon?: React.ReactNode;
  mountPath?: string; // e.g. '/orders'
  routes?: RouteDescriptor[]; // optional; can also call registerRoute at runtime
  requiredModules?: string[]; // runtime dependencies
  requiredFlags?: string[]; // feature flags
  entitlements?: string[]; // entitlement ids
  lazy?: boolean; // hint to host
  register: (hostApi: HostApi) => ModuleRegistration;
}
```

---

## A.2 Field-level guidance & validation rules

* `id`: kebab-case, short, stable. Must match backend module id if the backend also registers module presence.
* `version`: semantic versioning. Host may use to detect incompatible module releases.
* `mountPath`: leading `/` recommended. Host resolves routing as `hostBase + mountPath + route.path`.
* `routes.component`: prefer `React.lazy(() => import('./...'))` to allow host code-splitting.
* `entitlements`: must reference entitlement ids defined in `docs/entitlements` (authoritative source).
* `register`: must be idempotent and synchronous to return a `ModuleRegistration`. Async setup should be placed in `onMount`.
* `requiredModules` / `requiredFlags`: host should prevent registration if unmet (or provide graceful fallback UI).

**Validation rules (CI-contract):**

* `id`, `version`, `displayName`, `register` are required.
* `register` must return an object with a `mount` property.
* `routes` ids must be unique across the module and not clash with host-reserved ids (host will provide reserved-list).

---

## A.3 Runtime expectations

* `register()` will be called by the host with a `HostApi`. Registration should not assume the presence of entitlements — modules must check `hostApi.getEntitlements()` and show appropriate skeleton/gated views.
* `onMount` is intended for long-running initialization (e.g., open a websocket). It must be cancellable via `onUnmount`.
* Any subscriptions created by the module must be cleaned up in `onUnmount`.

---

# Examples — module-descriptor examples

**Placement:** Create `docs/ui/examples/module-descriptor.md` (or keep together in this file). The content here is copy-paste ready.

---

## Example 1 — Minimal ModuleDescriptor (OrderNexus, minimal)

```ts
// modules/order-nexus/src/ModuleEntry.ts
import React from 'react';
import { ModuleDescriptor } from 'docs/ui/types/ui-contracts';

const ModuleLayout: React.FC<any> = ({ moduleId, host }) => {
  return (
    <div>
      <h1>Order Nexus</h1>
      <p>Mounted at {moduleId}</p>
    </div>
  );
};

export const descriptor: ModuleDescriptor = {
  id: 'order-nexus',
  version: '0.1.0',
  displayName: 'Order Nexus',
  mountPath: '/orders',
  register: (host) => {
    // register a simple route
    host.registerRoute({ id: 'orders-home', path: '/', component: ModuleLayout, title: 'Orders' });

    // Optionally add nav item
    host.addNavItem({ id: 'nav-orders', label: 'Orders', route: '/orders', order: 10 });

    return { mount: ModuleLayout };
  },
};

export default descriptor;
```

**Notes:**

* This minimal example uses synchronous `register()` and registers a single route.
* `ModuleLayout` reads nothing from host except navigation when required.

---

## Example 2 — Advanced ModuleDescriptor (Specter-like)

```ts
// modules/specter/src/ModuleEntry.tsx
import React, { lazy } from 'react';
import { ModuleDescriptor } from 'docs/ui/types/ui-contracts';

const SpecterLayout = lazy(() => import('./ui/SpecterLayout'));

export const descriptor: ModuleDescriptor = {
  id: 'specter',
  version: '1.3.0',
  displayName: 'Specter (Customer Intelligence)',
  description: 'Realtime customer session & behavior signals',
  mountPath: '/specter',
  entitlements: ['specter'],
  requiredModules: ['order-nexus'],
  lazy: true,
  register: (host) => {
    // register multiple routes
    host.registerRoute({ id: 'specter-home', path: '/', component: SpecterLayout, title: 'Customer Intelligence', requiredModuleId: 'specter' });

    host.registerRoute({ id: 'specter-config', path: '/config', component: lazy(() => import('./ui/SpecterConfig')), title: 'Specter Config' });

    // nav item with entitlement gating handled by host
    host.addNavItem({ id: 'nav-specter', label: 'Customer Signals', route: '/specter', order: 20, requiredModuleId: 'specter' });

    // telemetry sample
    host.telemetry({ name: 'specter.registered', payload: { version: '1.3.0' } });

    return {
      mount: SpecterLayout,
      onMount: async ({ host: h }) => {
        // warm local cache or register to event bus
        h.publishEvent?.('specter:init', { ts: Date.now() });
      },
      onUnmount: ({ host: h }) => {
        h.publishEvent?.('specter:shutdown');
      }
    };
  }
};

export default descriptor;
```

**Notes:**

* Uses lazy imports; host should render `React.Suspense` with a skeleton.
* Declares `entitlements` and `requiredModules`. Host must gate automatically.
* Demonstrates lifecycle hooks.

---

## Negative examples (what NOT to do)

1. **Directly mutate host internals.** Example: `window.__HOST_STORE__.user = ...` — forbidden. Use HostApi.
2. **Assume synchronous entitlements.** Do not throw if `host.getEntitlements()` returns `null`.
3. **Attach global CSS without prefix.** Avoid global selectors; use CSS-in-JS or module-scoped CSS.
4. **Return `register()` that performs heavy async setup and never returns a mount** — `register()` must return quickly and synchronously; async setup goes in `onMount`.

---

## Validation checklist (for module authors)

* [ ] `id` follows kebab-case and matches backend module id if present.
* [ ] `version` present and semver.
* [ ] `displayName` present.
* [ ] `register` returns an object containing `mount`.
* [ ] `routes` (if provided) have unique `id` values.
* [ ] `entitlements` reference valid IDs from `docs/entitlements`.
* [ ] All user strings are i18n-ready.
* [ ] Tests: mount/unmount, descriptor shape unit test present.

---

## Suggested file placement & commit guidance

* **Module entry file:** `modules/<module-name>/src/ModuleEntry.tsx` or `ModuleEntry.ts` exporting the `ModuleDescriptor` as default or named export `descriptor`.
* **Shared types:** `modules/shared/src/ui-contracts.ts` or `packages/ui-contracts/src/index.ts` (preferred) so host and modules import the same TS types.
* **Examples:** `docs/ui/examples/module-descriptor.md` (create from this file)

**Suggested commit message:** `docs(ui): add ModuleDescriptor reference + examples (Appendix A)`

---

## Migration note

When migrating existing page-first code into module-first:

1. Create a thin `ModuleLayout` that wraps the old page and exposes the required `ModuleLayoutProps` signature.
2. Implement `register()` to call `host.registerRoute` with the existing page component (wrapped with lazy import).
3. Move module-local components into `modules/<module>/src/ui/` and update relative imports.
4. Add a contract test verifying `ModuleDescriptor` shape.

---

*End of Appendix A & Examples — ready to be split into the desired files. If you want I can now:*

* Append the Appendix section to `docs/ui/04-UI-Layout-Contract.md` (automated edit), **or**
* Create `docs/ui/examples/module-descriptor.md` as a new file (automated create).

Tell me which of these two automated file operations you want me to perform now, or I can provide git-ready patch text for you to apply.

---

# Appendix A — Examples & Code Snippets

This appendix provides concrete, copy-paste-ready examples that implement the contracts and APIs described in the main document. Use these as reference implementations for module authors and for the host runtime integration tests.

## A.1 ModuleDescriptor (example)

```ts
// modules/order-nexus/src/ui/ModuleDescriptor.ts
export const OrderNexusDescriptor = {
  id: 'order-nexus',
  version: '0.1.0',
  displayName: 'Order Nexus',
  icon: null, // optional React node
  mountPath: '/orders',
  requiredModules: [],
  requiredFlags: [],
  entitlements: ['orders_core'],
  lazy: true,
  register: (hostApi: HostApi) => {
    return {
      mount: OrderNexusLayout,
      onMount: async (ctx) => {
        // warm local cache, register local stores
        await loadOrderModels();
        hostApi.telemetry({ event: 'module.mount', moduleId: 'order-nexus' });
      }
    };
  }
} as const;
```

## A.2 ModuleEntry / register() (example)

```ts
// modules/order-nexus/src/ui/ModuleEntry.tsx
import { OrderNexusDescriptor } from './ModuleDescriptor';

export function register(hostApi: HostApi) {
  // register routes
  hostApi.registerRoute({
    path: `${OrderNexusDescriptor.mountPath}/`,
    exact: true,
    component: () => <OrderNexusLayout host={hostApiSnapshot(hostApi)} moduleId="order-nexus" />
  });

  // add navigation entry
  hostApi.addNavItem({
    id: 'orders',
    label: 'Orders',
    path: OrderNexusDescriptor.mountPath,
    icon: OrderIcon
  });

  // return the canonical registration object so host can manage lifecycle
  return OrderNexusDescriptor.register(hostApi);
}
```

> Implementation note: `hostApiSnapshot()` is a tiny helper that converts live host API to the `host` prop snapshot expected by `ModuleLayout`. Prefer providing a shallow, read-only snapshot rather than passing the live host API object directly into React props.

## A.3 HostApi quick examples (how host implements a few APIs)

```ts
// Host runtime (simplified)
const HostApiImpl: HostApi = {
  getThemeSnapshot: () => ({ palette: theme.palette, spacing: theme.spacing }),
  getEntitlements: () => currentEntitlements,
  navigate: (path) => router.navigate(path),
  registerRoute: (route) => routeRegistry.add(route),
  addNavItem: (item) => navRegistry.add(item),
  telemetry: (e) => telemetry.send(e),
  openModal: (id, payload) => modalManager.open(id, payload),
};
```

## A.4 ModuleLayout minimal example

```tsx
// modules/order-nexus/src/ui/ModuleLayout.tsx
import React from 'react';

export default function OrderNexusLayout({ moduleId, host }: ModuleLayoutProps) {
  return (
    <div data-module-id={moduleId} style={{ padding: host.theme.spacing(2) }}>
      <header>
        <h1>Orders</h1>
      </header>
      <main>
        {/* pages and nested routes here */}
      </main>
    </div>
  );
}
```

## A.5 Lifecycle usage example

```ts
// modules/order-nexus/src/ui/ModuleDescriptor.ts (excerpt)
register: (hostApi) => ({
  mount: OrderNexusLayout,
  onMount: async ({ shopId }) => { await syncLocalConfig(shopId); },
  onActivate: ({ route }) => { hostApi.telemetry({ event: 'orders.activate', route }); },
  onDeactivate: () => { /* pause polling */ },
  onUnmount: () => { /* cleanup timers */ }
})
```

## A.6 Storybook & Contract Tests

* **Storybook**: each module must provide stories for `HeaderSlot`, `ContentSlot`, `SidePanelSlot`, and the full `ModuleLayout` with mocked `host` props.

  * Path: `modules/<module>/stories/ui/ModuleLayout.stories.tsx`
* **Contract tests**: simple Jest harness that imports the module `register()` and asserts the descriptor shape and presence of `mount`.

```ts
// modules/order-nexus/src/tests/contract.spec.ts
import { register } from '../ui/ModuleEntry';
import { validateModuleDescriptor } from 'test-helpers/contract-validators';

test('module descriptor shape', async () => {
  const registration = register(mockHostApi);
  expect(validateModuleDescriptor(registration)).toBe(true);
});
```

## A.7 Contract-test harness (host-provided)

Host includes a small CLI harness used by module CI jobs:

```bash
# from repo root
node ./tools/contract-test-runner.js --module modules/order-nexus --host ./tools/mock-host.json
```

This runner boots a mocked host API, loads the module's `register()` and runs the following checks:

1. `ModuleDescriptor` fields exist and types match (id, version, mountPath, register function).
2. `register()` returns an object with `mount` (React component) and optional lifecycle hooks.
3. Module can call `registerRoute` and `addNavItem` with expected payload shapes.

## A.8 Migration example (wrapping an existing page)

```tsx
// existing pages/OrdersPage.tsx
export default function OrdersPage() { return <div>legacy orders</div>; }

// modules/order-nexus/src/ui/ModuleLayout.tsx
import OrdersPage from '../../../apps/frontend/src/pages/OrdersPage';
export default function OrderNexusLayout({ host }: ModuleLayoutProps) {
  return (<div><OrdersPage /></div>);
}
```

## A.9 Troubleshooting & notes

* **Do not** reach into host internals (redux stores, private contexts). Use `HostApi` surface only.
* Keep default exports small — prefer named exports for testability.
* Prefer `hostApi.registerRoute()` over manipulating router directly; this ensures the host can apply guards and entitlements.

---

**End of Appendix A — Examples & Code Snippets**
