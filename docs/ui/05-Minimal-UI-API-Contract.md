# Minimal UI API Contract + Canonical Primitives (A2)

**Status:** Draft — Minimal runtime API and canonical primitive list required for Module-first UI.

**Purpose:**  
Provide the smallest, stable surface (runtime + component primitives) modules depend on so UI teams can implement module UIs independently, consistently and safely. This contract intentionally focuses on *must-have* APIs and a canonical set of UI primitives (approved components) that guarantee visual and behavioral consistency across LaSyncro.

---

## Table of contents

1. Principles
2. Minimal runtime API (host → modules)
3. Module registration contract (module → host)
4. Routing & nav registration
5. Entitlements & gating primitives
6. Canonical UI primitives (approved list + minimal props)
7. Theme & design token usage rules
8. Component extension rules (how to add new primitives)
9. Testing & CI contract
10. File layout & examples
11. Backwards-compatibility & governance

---

## 1. Principles (short)

* Keep the host ↔ module boundary small and explicit.
* Modules use host APIs; never mutate host internals.
* Modules use approved primitives for consistent UX.
* All additions to the API or primitives must be reviewed and versioned.

---

## 2. Minimal runtime API (host → modules)

Host exposes a small `HostApi` object available when modules register:

```ts
interface HostApi {
  // Read-only snapshots
  getThemeSnapshot(): ThemeSnapshot;
  getEntitlements(): EntitlementSnapshot | null;
  getUserSnapshot(): UserSnapshot;

  // Navigation / routing
  navigate(path: string, opts?: { replace?: boolean; state?: any }): void;
  resolveRoutePathById(routeId: string): string | null;

  // Module runtime registry helpers
  registerRoute(route: RuntimeRouteDescriptor): void;
  unregisterRoute(routeId: string): void;
  addNavItem(nav: NavItemDescriptor): void;
  removeNavItem(navId: string): void;
  getRegisteredRoutes(): RuntimeRouteDescriptor[];

  // UI & UX helpers
  openModal(modalId: string, payload?: any): void;
  openDrawer(drawerId: string, payload?: any): void;
  showToast(message: string, opts?: ToastOptions): void;

  // Telemetry & logging
  telemetry(event: TelemetryEvent): void;

  // Event bus
  publishEvent(name: string, payload?: any): void;
  subscribeEvent(name: string, handler: (p?: any) => void): () => void;
}
````

**Design notes:** host API functions should be resilient (no thrown errors for no-op) and stable (semver-major required for breaking changes).

---

## 3. Module registration contract (module → host)

A module must export a `register(hostApi: HostApi): ModuleRegistration` function and `ModuleDescriptor`.

Minimal shapes:

```ts
interface ModuleDescriptor {
  id: string;
  version: string; // semver
  displayName: string;
  mountPath?: string;
  entitlements?: string[]; // required entitlements
  lazy?: boolean;
}

interface ModuleRegistration {
  mount: React.ComponentType<ModuleLayoutProps>;
  onMount?: (ctx: MountContext) => Promise<void>|void;
  onActivate?: (ctx: ActivateContext) => Promise<void>|void;
  onDeactivate?: (ctx: ActivateContext) => Promise<void>|void;
  onUnmount?: (ctx: MountContext) => Promise<void>|void;
}
```

**Rules:**

* `register()` should be idempotent.
* `moduleId` must be unique. Host must validate shape on register and reject malformed descriptors.

---

## 4. Routing & nav registration

Minimal `RuntimeRouteDescriptor`:

```ts
interface RuntimeRouteDescriptor {
  id: string;
  name: string;
  path: string; // absolute or relative to mountPath (host normalizes)
  component: React.ComponentType<any>;
  requiredModuleId?: string;
  requiredFlagId?: string;
  upgradeRoute?: string; // optional CTA
  meta?: Record<string, any>;
  order?: number;
}
```

`NavItemDescriptor`:

```ts
interface NavItemDescriptor {
  id: string;
  label: string;
  path?: string;
  icon?: React.ReactNode;
  requiredModuleId?: string;
  order?: number;
}
```

Host responsibilities:

* normalize/merge dynamic routes with static routes,
* enforce entitlements on navigation and route guards,
* expose `getRegisteredRoutes()` for UI code that needs introspection.

---

## 5. Entitlements & gating primitives

* Modules must declare `entitlements` in their descriptor.
* Host enforces gating before mounting the module route.
* If a user lacks entitlement, host renders a standard `GatedPlaceholder` component (canonical primitive) or redirects depending on the route metadata.

`GatedPlaceholder` contract (minimal props):

```ts
interface GatedPlaceholderProps {
  routeName: string;
  missingModules?: string[];
  missingFlags?: string[];
  upgradeRoute?: string | null;
  backRoute?: string;
}
```

**Behavior:** `GatedPlaceholder` shows the reason, missing entitlements and CTA to `upgradeRoute` when provided. Modules should not create their own gating UI unless approved.

---

## 6. Canonical UI primitives (approved list + minimal props)

All modules MUST prefer these host-provided primitives. Minimal prop sets shown — primitives may accept more but these are required.

### Core primitives (host-provided)

* `Button` — `({children, onClick, variant?: 'primary'|'secondary'|'ghost', size?: 'sm'|'md'|'lg', disabled?: boolean})`
* `Input` — `({value, onChange, name, placeholder, type?, label?, required?})`
* `Select` — `({value, onChange, options, label?, placeholder?})`
* `Checkbox` — `({checked, onChange, label?})`
* `RadioGroup` — `({value, onChange, options})`
* `DataGrid` — (must support: columns[], rows[], pagination, onRowClick)
* `Card` — (title?, actions?, children)
* `Modal` — (`open`, `onClose`, `title`, `size?`)
* `Toast` — (`message`, `type?: 'info'|'success'|'warning'|'error'`)
* `GatedPlaceholder` — defined above
* `PageHeader` — (`title`, `breadcrumbs?`, `actions?`)
* `ContextPanel` — (slide-over panel primitive)
* `Icon` — consistent icon primitive

### Layout primitives

* `ModuleLayout` wrapper (slot contract already in UI Layout Contract)
* `HeaderSlot`, `ContentSlot`, `SidePanelSlot`, `FooterSlot`

### Data & UX primitives

* `AsyncBoundary` / `SuspenseFallback` — standardized skeleton loading
* `ErrorBoundary` — standardized error surface
* `ConfirmDialog` — for destructive flows

**Enforcement:** Storybook previews and unit tests must use these primitives where applicable. Any deviation requires a documented rationale and UI Architecture review.

---

## 7. Theme & design token usage rules

* Host theme (MUI Theme) is authoritative.
* Modules may request `themeHints: { spacingScale?: number, preferredButtonVariant?: string }` during registration but must not override host theme.
* Use design tokens (colors, spacing, typography) from `design-tokens` contract. Map tokens to MUI theme variables.
* CSS variables must be prefixed `--lsyncro-` and scoped to module root.

---

## 8. Component extension rules

If a module needs a new primitive not in the canonical list:

1. Prototype the primitive inside the module (module-scoped).
2. Create a proposal doc that includes:

   * name, props, design mockups, accessibility considerations, tests required
3. Submit to UI Architecture Review. If approved, it gets promoted to host primitives and added to `docs/ui/` + Storybook global.

Versioning: new primitives are versioned and added with migration guidance.

---

## 9. Testing & CI contract

Every module MUST include:

* Unit tests for `ModuleDescriptor` validation and `register()` behavior.
* Storybook stories for each primitive usage and layout slot.
* Accessibility smoke tests for primary screens (axe).
* A `contract-test` file that the host CI will run to ensure runtime APIs (`registerRoute`, `navigate`, entitlements gating) work in mock host environment.

Host CI will run the host-provided `contract-test` harness; modules must pass it before merging.

---

## 10. File layout & examples

Recommended module layout:

```
/modules/<module-id>/
  src/
    ui/
      ModuleDescriptor.ts
      ModuleEntry.tsx      // exports register(hostApi)
      ModuleLayout.tsx
      /components
      /hooks
    tests/
    stories/
    package.json
```

Example `ModuleEntry.tsx` snippet:

```ts
import { HostApi, ModuleDescriptor } from 'host-types';

export const descriptor: ModuleDescriptor = {
  id: 'order-nexus',
  version: '0.1.0',
  displayName: 'Order Nexus',
  mountPath: '/orders',
  entitlements: ['order-nexus']
};

export function register(host: HostApi) {
  host.registerRoute({
    id: 'orders-list',
    name: 'Orders',
    path: '/orders',
    component: OrdersPage,
    requiredModuleId: 'order-nexus'
  });

  host.addNavItem({ id: 'orders', label: 'Orders', path: '/orders', order: 200 });

  return {
    mount: ModuleLayout,
    onMount: async () => { /* init */ }
  };
}
```

---

## 11. Backwards-compat & governance

* Changes to HostApi or primitives must be versioned and documented.
* Breaking changes require a 2-release deprecation window and migration guide.
* The UI Platform team owns primitives and the HostApi. Module teams own module-scoped components and tests.

---

## Appendix: quick checklist before coding a module UI

* [ ] ModuleDescriptor.ts exists and validated
* [ ] register(host) returns ModuleRegistration
* [ ] Routes registered via host.registerRoute
* [ ] Nav item registered via host.addNavItem
* [ ] All interactive components use canonical primitives
* [ ] Storybook stories for layout & main screens
* [ ] Contract-tests pass locally
* [ ] Accessibility smoke tests included

End of Minimal UI API Contract + canonical primitives.

---
