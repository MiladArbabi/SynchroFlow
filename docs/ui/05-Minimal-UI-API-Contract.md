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

The host supplies a small, stable `HostApi` to modules during registration. For exact types, prefer the canonical TypeScript definitions in `modules/shared/src/ui-contracts.ts`. The minimal runtime surface is shown below (paraphrased):

```ts
// See modules/shared/src/ui-contracts.ts for the authoritative source
interface HostApi {
  // read-only snapshots
  getThemeSnapshot(): ThemeSnapshot;
  getEntitlements(): EntitlementSnapshot | null;
  getUserSnapshot(): UserSnapshot;

  // navigation
  navigate(path: string, opts?: { replace?: boolean; state?: any }): void;
  resolveRoutePathById?(routeId: string): string | null; // optional helper

  // runtime registry
  registerRoute(route: RuntimeRouteDescriptor): void;
  unregisterRoute(routeId: string): void;
  addNavItem(item: NavItemDescriptor): void;
  removeNavItem(navId: string): void;
  getRegisteredRoutes(): RuntimeRouteDescriptor[];

  // UI helpers
  openModal(modalId: string, payload?: any): void;
  openDrawer(drawerId: string, payload?: any): void;
  showToast(message: string, opts?: ToastOptions): void;

  // telemetry & logging
  telemetry(event: TelemetryEvent): void;

  // event bus
  publishEvent(name: string, payload?: any): void;
  subscribeEvent(name: string, handler: (p?: any) => void): () => void;
}
Design notes

The HostApi should be resilient: calling any of these methods when the host does not implement them must be a no-op (no throw).

Breaking changes require semver-major and a migration plan.

---

## 3. Module registration contract (module → host)

**Authoritative types:** `modules/shared/src/ui-contracts.ts` (importable).

Modules must export:
- `descriptor` (object matching `ModuleDescriptor`), and
- `register(hostApi: HostApi): ModuleRegistration`.

Minimal shapes (see types file for exact interfaces):

interface ModuleDescriptor {
  id: string;
  version: string;
  displayName: string;
  mountPath?: string;
  entitlements?: string[];
  lazy?: boolean;
}

interface ModuleRegistration {
  mount: React.ComponentType<ModuleLayoutProps>;
  onMount?: (ctx: MountContext) => Promise<void>|void;
  onActivate?: (ctx: ActivateContext) => Promise<void>|void;
  onDeactivate?: (ctx: ActivateContext) => Promise<void>|void;
  onUnmount?: (ctx: MountContext) => Promise<void>|void;
}

Rules

register() must be synchronous and idempotent (returns ModuleRegistration quickly). Heavy initialization goes into onMount.

Host validates module descriptor on load (shape and required fields). If invalid, host rejects/load-fails with a clear error.

---

## 4. Routing & nav registration

Minimal `RuntimeRouteDescriptor` (authoritative in `ui-contracts.ts`):

interface RuntimeRouteDescriptor {
  id: string;
  name?: string;
  path: string; // absolute or relative to mountPath - host normalizes
  component: React.ComponentType<any>;
  requiredModuleId?: string;
  requiredFlagId?: string;
  upgradeRoute?: string | null;
  meta?: Record<string, any>;
  order?: number;
}
NavItemDescriptor:

interface NavItemDescriptor {
  id: string;
  label: string;
  path?: string;
  icon?: React.ReactNode;
  requiredModuleId?: string;
  order?: number;
}
Host responsibilities:

Normalize and merge dynamic routes with static descriptor routes.

Enforce entitlements on navigation and route resolution.

Expose getRegisteredRoutes() for introspection and tests.

Note: When modules call registerRoute() the host should apply guards and build the final route table; modules should not manipulate host router internals directly.

---

## 5. Entitlements & gating primitives

- Modules declare `entitlements` in their descriptor.
- Host enforces gating prior to mounting/activation.
- Host provides a canonical `GatedPlaceholder` component; modules should use it when entitlements are missing.

Gated placeholder props (see `ui-contracts.ts`):

interface GatedPlaceholderProps {
  routeName: string;
  missingModules?: string[];
  missingFlags?: string[];
  upgradeRoute?: string | null;
  backRoute?: string;
}

Behavior: GatedPlaceholder must show missing entitlement reasons and an optional CTA. Modules must not implement ad-hoc gating UI without review.

---

## 6. Canonical UI primitives (approved list + minimal props)

Modules MUST prefer these host-provided primitives. These are the minimal props each primitive must support; implementations may accept additional props.

### Core primitives (host-provided)

- `Button`  
  `({ children: React.ReactNode, onClick?: () => void, variant?: 'primary'|'secondary'|'ghost', size?: 'sm'|'md'|'lg', disabled?: boolean })`

- `Input`  
  `({ value: string, onChange: (v: string) => void, name?: string, placeholder?: string, type?: string, label?: string, required?: boolean })`

- `Select`  
  `({ value: any, onChange: (v: any) => void, options: Array<{ value: any; label: string }>, label?: string, placeholder?: string })`

- `Checkbox`  
  `({ checked: boolean, onChange: (checked: boolean) => void, label?: string })`

- `RadioGroup`  
  `({ value: any, onChange: (v: any) => void, options: Array<{ value: any; label: string }> })`

- `DataGrid`  
  `(must support: columns: Column[], rows: Row[], pagination?: PaginationProps, onRowClick?: (row: Row) => void)`

- `Card`  
  `(props: { title?: string; actions?: React.ReactNode; children?: React.ReactNode })`

- `Modal`  
  `({ open: boolean, onClose: () => void, title?: string, size?: 'sm'|'md'|'lg' })`

- `Toast`  
  `({ message: string, type?: 'info'|'success'|'warning'|'error' })`

- `GatedPlaceholder`  
  `(see GatedPlaceholderProps above)`

- `PageHeader`  
  `({ title: string, breadcrumbs?: Array<{label:string,path?:string}>, actions?: React.ReactNode })`

- `ContextPanel`  
  `(slide-over panel primitive with open/onClose props)`

- `Icon`  
  `(consistent icon wrapper helper)`

### Layout primitives

- `ModuleLayout` wrapper (slot contract defined in UI Layout Contract)
- `HeaderSlot`, `ContentSlot`, `SidePanelSlot`, `FooterSlot`

### Data & UX primitives

- `AsyncBoundary` / `SuspenseFallback` — standardized loading skeletons
- `ErrorBoundary` — standard error surface
- `ConfirmDialog` — standard confirm UI for destructive flows

**Enforcement**
- Modules must use these primitives (import path `ui-component/*`).
- Any deviation must be documented and approved by UI Platform.

---

## 7. Theme & design token usage rules

- Host theme (MUI Theme) is authoritative. Modules must *read* theme values; they must not provide a nested ThemeProvider that overrides host settings.
- Modules may request `themeHints` during registration (host may honor them) but MUST NOT mutate the host theme.
- Use token names from `docs/ui/03-Design-Tokens-Contract.md`; map those to `theme.palette`, `theme.spacing`, etc.
- CSS variables must be prefixed `--lsyncro-` and scoped to module root selectors.

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
