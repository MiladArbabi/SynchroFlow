# ActivationSurface Phase — Architecture & Usage Guide

**Status:** Canonical
**Scope:** Frontend activation & pre-integration UX
**Applies to:** All commerce modules (Orders, Customers, Products, Analytics, Finances)
**Out of scope:** FT0 onboarding, dashboards, analytics accuracy, personalization

---

## 1. Purpose

The **ActivationSurface Phase** defines how LaSyncro behaves **before any commerce integration is connected**.

This is **not an empty state** and **not onboarding**.

It is a **first-class product surface** whose goals are:

* Communicate module value before data exists
* Preview what the user will unlock
* Guide the user toward integration
* Keep modules clean, dumb, and backend-agnostic

Activation logic is **frontend-only** and intentionally **decoupled from backend readiness**.

---

## 2. Core Principles (Non-Negotiable)

1. **Modules never decide activation**

   * No module checks `hasIntegrations`
   * No module imports `ActivationSurface`
   * No module knows about Shopify, OAuth, or entitlements

2. **Activation is a shell concern**

   * Gating happens once, centrally
   * Pages are wrapped, not modified

3. **Shared UI ≠ shared logic**

   * `ActivationSurface` is dumb
   * All decisions live in the app shell

4. **One mental model**

   ```tsx
   if (!isIntegrated) {
     show ActivationSurface
   } else {
     show real page
   }
   ```

---

## 3. High-Level Architecture

```
apps/frontend
└── src
    ├── activation
    │   └── CommerceActivationGate.tsx   ← single activation gate
    │
    ├── pages
    │   ├── CustomersPage.tsx
    │   ├── OrdersPage.tsx
    │   ├── ProductsPage.tsx
    │   └── ...
    │
modules/shared
└── src
    └── ui
        └── activation
            └── ActivationSurface.tsx     ← shared UI primitive
```

---

## 4. ActivationSurface (Shared UI)

**Location:**
`modules/shared/src/ui/activation/ActivationSurface.tsx`

### Responsibilities

* Display module identity
* Render preview area
* Render integration CTA
* Nothing else

### Props

```ts
export interface ActivationSurfaceProps {
  moduleId: string;
  integrationProvider?: string;
  integrationCTA?: React.ReactNode;
}
```

### Important Constraints

* ❌ No hooks
* ❌ No context usage
* ❌ No business logic
* ❌ No routing
* ❌ No side effects

This component must remain **pure and dumb**.

---

## 5. CommerceActivationGate (Frontend Shell)

**Location:**
`apps/frontend/src/activation/CommerceActivationGate.tsx`

This is the **single source of truth** for activation behavior.

### Responsibilities

* Determine integration status
* Decide whether to show activation or live content
* Wire the integration CTA (Shopify flow)

### Implementation (current)

```tsx
export function CommerceActivationGate({
  moduleId,
  children,
}: {
  moduleId: string;
  children: React.ReactNode;
}) {
  const { hasIntegrations } = useIntegration();
  const [open, setOpen] = useState(false);

  if (!hasIntegrations) {
    return (
      <>
        <ActivationSurface
          moduleId={moduleId}
          integrationCTA={
            <ConnectStoreBanner onOpenModal={() => setOpen(true)} />
          }
        />
        <ConnectStoreModal
          isOpen={open}
          onClose={() => setOpen(false)}
        />
      </>
    );
  }

  return <>{children}</>;
}
```

### Why this lives in `apps/frontend`

* It depends on app contexts
* It wires real UX flows
* It must not leak into shared packages

---

## 6. How Pages Use Activation (Correct Pattern)

Every commerce page follows this pattern:

```tsx
import { CommerceActivationGate } from 'activation/CommerceActivationGate';

export default function CustomersPage() {
  return (
    <CommerceActivationGate moduleId="customers">
      <CustomersLiveContent />
    </CommerceActivationGate>
  );
}
```

### What this achieves

* Pages stay simple
* Activation is consistent
* Modules remain reusable
* Future changes happen in one place

---

## 7. Current Module Coverage

The following modules are **fully wired** to the ActivationSurface Phase:

* ✅ Customers
* ✅ Orders
* ✅ Products
* ✅ Analytics
* ✅ Finances

All of them:

* Show ActivationSurface when not integrated
* Show real content when integrated
* Share the same gate and UX

---

## 8. Integration CTA Strategy (Current)

* Uses existing, battle-tested components:

  * `ConnectStoreBanner`
  * `ConnectStoreModal`
* Shopify OAuth is the primary path
* Other providers are future-ready but inactive

This is **intentional**. UX refinement comes later.

---

## 9. What Is Explicitly Out of Scope (Do Not Add)

* ❌ FT0 onboarding logic
* ❌ Data previews from backend
* ❌ AI recommendations
* ❌ Dashboard personalization
* ❌ Entitlement gating per module
* ❌ “Coming soon” placeholders
* ❌ Empty tables

If it requires real data, it belongs **after activation**, not here.

---

## 10. Extension Guidelines (Next Phases)

When extending ActivationSurface Phase:

### Allowed

* Module-specific copy
* Preview widgets (static/skeleton)
* Trust & reassurance content
* Provider-aware messaging

### Must Stay True

* Gate remains single
* ActivationSurface remains dumb
* Modules remain unaware

---

## 11. Definition of “Done” for This Phase

The ActivationSurface Phase is considered **complete** when:

* All commerce modules are gated
* One gate controls behavior
* One shared surface renders UI
* Integration CTA works end-to-end
* No module contains activation logic

✅ **All of the above are now true**

---

## 12. Final Note (Lock This In)

> Activation is not a temporary step.
> It is the **first promise of the product**.

If this layer is weak:

* Users don’t integrate
* Data doesn’t matter
* Features don’t save it

If this layer is strong:

* Integration feels inevitable
* Trust is earned early
* FT0 feels like a reward

---

**This document is authoritative.
Any deviation requires explicit discussion and agreement.**

---