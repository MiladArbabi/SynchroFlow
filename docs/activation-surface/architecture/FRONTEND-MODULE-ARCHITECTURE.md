## 📘 FRONTEND MODULE ARCHITECTURE (AUTHORITATIVE)

### Status

**MANDATORY · ENFORCED · NON-NEGOTIABLE**

This document defines the **only allowed architecture** for UI modules in SynchroFlow.

Any deviation is considered a **bug**, not a preference.

---

## 1. Core Principle (Read This First)

> **Modules are guests.
> The Host owns navigation, activation, routing, auth, and modals.**

If a module tries to:

* route itself
* open a modal
* read auth
* decide activation

…it is violating the system.

---

## 2. High-Level Architecture

```
apps/frontend (HOST)
│
├── routing (React Router)
├── activation (CommerceActivationGate)
├── modals (ConnectStoreModal)
├── auth & integration state
│
└── modules (PLUGINS)
     ├── descriptors (metadata only)
     └── UI components (pure, dumb)
```

**One-way dependency only:**

```
modules  ──► host (NEVER)
host     ──► modules (ALLOWED)
```

---

## 3. What the Host Owns (apps/frontend)

The host application **exclusively owns**:

### 3.1 Routing

* URL definitions
* `<Route />` configuration
* `/orders`, `/customers`, etc.

📁 Example:

```
apps/frontend/src/pages/OrdersPage.tsx
```

```tsx
export default function OrdersPage() {
  return (
    <CommerceActivationGate moduleId="order-nexus">
      <ModuleHost moduleId="order-nexus" />
    </CommerceActivationGate>
  );
}
```

Modules **never** define routes.

---

### 3.2 Activation & Gating

All activation logic lives in:

```
apps/frontend/src/activation/CommerceActivationGate.tsx
```

Responsibilities:

* Read `hasIntegrations`
* Decide whether to render:

  * ActivationSurface
  * Module UI
* Own the CTA behavior
* Open `ConnectStoreModal`

Modules **never**:

* check integrations
* open modals
* redirect users

---

### 3.3 Modals (Single Source of Truth)

**There is exactly one store connection flow.**

```
ConnectStoreModal
```

Used by:

* Dashboard banner
* Activation surfaces
* Empty states

This guarantees:

* Consistent UX
* Unified analytics
* No duplicated logic

---

## 4. What Modules Are Allowed To Do

Modules are **pure UI providers**.

### 4.1 Allowed Exports

A module may export:

#### ✅ Module Descriptor

```
modules/<module>/src/ui/ModuleEntry.tsx
```

Contains:

* `id`
* `navItems`
* `navGroups`
* metadata only

Example:

```ts
const descriptor = {
  id: 'order-nexus',
  navItems: [...],
  navGroups: [...]
};

export default descriptor;
```

---

#### ✅ Pure UI Components

```
modules/order-nexus/src/ui/pages/OrdersPage.tsx
```

Rules:

* No hooks from host
* No routing
* No auth
* No modals
* No side effects

**Pure render only.**

---

### 4.2 What Modules MUST NOT Do (Hard Ban)

❌ Define routes
❌ Import from `apps/frontend`
❌ Open modals
❌ Dispatch global events
❌ Read auth or integration state
❌ Decide activation logic

If you see any of these in a module, **reject the PR**.

---

## 5. Module Loading & Rendering

### 5.1 ModuleHost (Host-owned)

```
apps/frontend/src/runtime/ModuleHost.tsx
```

Responsibilities:

* Load module descriptor via `moduleLoader`
* Select the correct UI component
* Render it

Modules never self-render.

---

## 6. Activation Surface Doctrine

Activation surfaces are **content-only**.

### ActivationSurface (shared)

```
modules/shared/src/ui/activation/ActivationSurface.tsx
```

It:

* Renders copy
* Emits intent (`actionId`)
* Does NOT decide what happens

The **host interprets the intent**.

---

## 7. Analytics & Observability

Because activation is centralized:

```ts
handleOpenConnectModal() {
  posthog.capture('connect_store_clicked', {
    source: 'activation_surface',
    moduleId
  });
}
```

This gives:

* Exact click origin
* Funnel clarity
* Zero duplication

If modules controlled this, analytics would be fragmented and wrong.

---

## 8. Why This Architecture Exists (Reality)

This architecture ensures:

* 🔒 Enforced boundaries
* 📊 Accurate analytics
* 🔁 Reusable flows
* 🧠 Predictable reasoning
* 🚀 Future FT0 → FT3 scalability

Every previous failure came from **violating these boundaries**.

---

## 9. Enforcement Rules (Non-Optional)

1. No module PR is merged without checking this document
2. Any module importing from `apps/frontend` is rejected
3. Any module opening a modal is rejected
4. All activation flows go through `CommerceActivationGate`

---

## 10. Orders Module = Reference Implementation

`order-nexus` is the **canonical example**.

All future modules must:

* match its structure
* follow its constraints
* reuse its activation pattern

If a module cannot fit this model → **the design is wrong**, not the module.

---

## 11. Final Statement

> This system works because **ownership is clear**.

The moment ownership blurs:

* bugs multiply
* UX fragments
* analytics lie
* velocity collapses

This document exists so that never happens again.

---
