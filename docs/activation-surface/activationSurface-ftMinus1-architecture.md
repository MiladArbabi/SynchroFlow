# ActivationSurface (FT-1 / ftMinus1) — Architecture & Contract

**Status:** 🔒 LOCKED · ENFORCED · NON-NEGOTIABLE
**Scope:** ActivationSurface layer only (pre-integration state)

---

## 1. Purpose of the ActivationSurface Layer

The ActivationSurface layer exists to solve **one problem only**:

> **When a module cannot function because no integration exists,
> the system must present a deterministic, unified activation experience.**

This layer is **FT-1 / ftMinus1**:

* Before FT0
* Before data
* Before sync
* Before value

It is **not optional** and **not module-owned**.

---

## 2. Ownership Model (Absolute)

| Concern             | Owner       |
| ------------------- | ----------- |
| Activation decision | Host        |
| Integration state   | Host        |
| Modal opening       | Host        |
| OAuth initiation    | Host        |
| Analytics           | Host        |
| UI copy structure   | Shared      |
| UI rendering        | Shared      |
| Module awareness    | ❌ Forbidden |

**Modules are activation-blind.**

---

## 3. File & Directory Map (Authoritative)

### 3.1 Shared (Contract + Renderer)

```
modules/shared/src/ui/activation/
├── ActivationSurface.tsx
```

**Role:**
Pure, stateless UI renderer + intent emitter.

---

### 3.2 Frontend Host (Decision + Wiring)

```
apps/frontend/src/activation/
├── CommerceActivationGate.tsx
├── ActivationSurfacePage.tsx
├── activationActions.ts
├── configs/
│   └── orders.tsx
```

---

### 3.3 Module (Content Only)

```
modules/order-nexus/src/ui/
├── ModuleEntry.tsx
```

---

## 4. ActivationSurface Contract (Shared Layer)

### File

```
modules/shared/src/ui/activation/ActivationSurface.tsx
```

### Responsibilities (ONLY)

* Render structured activation UI
* Enforce required slots
* Emit **activation intent** (not behavior)

### What It DOES

```ts
window.dispatchEvent(
  new CustomEvent('activation:action', {
    detail: {
      actionId: 'connect-store',
      moduleId
    }
  })
);
```

### What It DOES NOT DO ❌

* Open modals
* Check integrations
* Call APIs
* Navigate
* Know about Shopify
* Know about FT0/FT1

---

### ActivationSurfaceProps (Locked Contract)

```ts
export interface ActivationSurfaceProps {
  moduleId: string;

  identity?: { title: string };

  blindness: { content: ReactNode };

  absenceProof?: { content: ReactNode };

  valueAfterActivation?: { content: ReactNode };

  primaryCTA: {
    label: string;
    actionId: 'connect-store';
  };

  trust: {
    bullets: string[];
  };
}
```

❗ **No extra fields allowed**
❗ **No callbacks allowed**
❗ **No business logic allowed**

---

## 5. ActivationSurfacePage (Host Renderer)

### File

```
apps/frontend/src/activation/ActivationSurfacePage.tsx
```

### Role

* Canonical visual layout
* MUI-styled wrapper
* Placement rules enforcement
* CTA wiring via `onActivate`

### Important Rule

> **ActivationSurfacePage is a renderer, not a decider.**

It receives:

* `config` (ActivationSurfaceProps)
* `onActivate` (host-owned behavior)

---

## 6. CommerceActivationGate (The Brain)

### File

```
apps/frontend/src/activation/CommerceActivationGate.tsx
```

### This is the **most important file** in FT-1.

### Responsibilities

1. Read integration state
2. Decide **what renders**
3. Own CTA behavior
4. Open ConnectStoreModal
5. Enforce isolation

### Core Logic (Simplified)

```ts
if (!hasIntegrations) {
  return (
    <>
      <ActivationSurfacePage
        config={activationConfig}
        onActivate={handleOpenConnectModal}
      />
      <ConnectStoreModal />
    </>
  );
}

return <ModuleUI />;
```

### This file is the **single choke point**.

No other file is allowed to:

* decide activation
* open the modal
* override this logic

---

## 7. Activation Configs (Content Only)

### Example

```
apps/frontend/src/activation/configs/orders.tsx
```

### Role

* Provide **copy**
* Provide **structure**
* Provide **module-specific language**

### What configs may contain

* Text
* JSX fragments
* Labels

### What configs must NOT contain ❌

* onClick
* onActivate
* API calls
* Imports from services

Configs are **data**, not logic.

---

## 8. Activation Intent Flow (End-to-End)

### Step-by-step (What actually happens)

1. User visits `/orders`
2. Host route renders `<CommerceActivationGate moduleId="order-nexus" />`
3. `hasIntegrations === false`
4. `ActivationSurfacePage` renders
5. User clicks CTA
6. `onActivate()` fires
7. Host runs **pre-flight**
8. Host opens `ConnectStoreModal`
9. OAuth flow begins

### Key Insight

> **The CTA never directly opens the modal.
> The host decides whether the modal is allowed to open.**

---

## 9. Why This Architecture Works (Hard Truth)

This design prevents:

* Duplicate modals
* Inconsistent analytics
* Module-specific hacks
* Hidden side effects
* Untraceable activation paths

Every previous failure happened because:

> **Modules were allowed to think.**

They no longer are.

---

## 10. Absolute Prohibitions (Enforced)

❌ Modules importing `ConnectStoreModal`
❌ Modules opening modals
❌ Modules checking integrations
❌ ActivationSurface receiving callbacks
❌ Activation logic outside CommerceActivationGate

Violations are **architecture bugs**, not style issues.

---

## 11. Reference Implementation

The following is the **canonical FT-1 implementation**:

* `CommerceActivationGate.tsx`
* `ActivationSurface.tsx`
* `ActivationSurfacePage.tsx`
* `activation/configs/orders.tsx`

All future modules **must replicate this pattern exactly**.

---

## 12. Final Lock-In Statement

> The ActivationSurface layer is now **sealed**.

* Its API is frozen
* Its ownership is fixed
* Its responsibilities are non-negotiable

Any future change must:

1. Update this document
2. Be explicitly approved
3. Preserve host ownership

Otherwise, the system **will regress**.

---
