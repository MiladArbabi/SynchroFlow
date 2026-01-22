# 📘 Playbook: Introducing a New Module (FT-MINUS-ONE → FT1 → FT2)

**Status:** 🔒 Canonical
**Scope:** Frontend + lifecycle + activation only
**Anti-goal:** No guessing, no inference, no “we’ll fix later”

---

## 0️⃣ Non-Negotiable Principles (Read First)

1. **Routing decides *which* surface mounts**
2. **Activation config decides *what* renders**
3. **Lifecycle decides *if* anything is allowed to exist**
4. **No synthetic IDs**
5. **No remapping**
6. **No “smart” fallbacks**

If any step violates these, stop.

---

## 1️⃣ Choose the Module Identity (Single Source of Truth)

Pick **one lowercase string**.
This string will be used **everywhere**.

Example:

```txt
trust
orders
products
customers
finances
```

🚫 Forbidden:

* `trust-data-health`
* `trust_health`
* `Trust`
* aliases or display names

> **Rule:** If it appears in a URL, it *is* the moduleId.

---

## 2️⃣ Add the Route (apps/frontend)

### File

`apps/frontend/src/lifecycle/LifecycleRouteHost.tsx`

### FT1 example

```tsx
<Route path="/trust/*" element={<TrustPage />} />
```

### FT2 example (later)

```tsx
<Route path="/trust/*" element={<TrustFT2Page />} />
```

📌 Notes:

* Pages are **thin adapters only**
* No lifecycle logic inside pages
* Pages may be empty initially (FT-MINUS-ONE)

---

## 3️⃣ Ensure Lifecycle Gate Allows the Route

### File

`apps/frontend/src/lifecycle/ShopLifecycleGate.tsx`

✅ Correct (canonical):

```ts
const rawSegment = location.pathname.split('/')[1];

/**
 * Module identity is derived directly from the first route segment.
 * No synthetic remapping is allowed.
 */
const moduleId = rawSegment;
```

🚫 Forbidden:

* remapping
* aliases
* conditionals per module
* “special cases”

---

## 4️⃣ Create the Activation Config (FT-MINUS-ONE)

### File

`apps/frontend/src/activation/configs/<module>.tsx`

Example:

```ts
export const trustDataHealthActivationConfig: ActivationSurfaceProps = {
  moduleId: 'trust',

  identity: {
    title: 'Data trust is not yet established',
    subtitle: 'The system must first observe real behavior.',
  },

  blindness: {
    subject: 'System observability',
    dimension: 'Data reliability',
    status: 'insufficient-data',
  },

  absenceProof: {
    riskStatement:
      'Missing data may be unobserved, not absent.',
  },

  valueAfterActivation: {
    outcome:
      'Trust becomes defensible only after observation.',
  },

  primaryCTA: {
    label: 'Begin trust assessment',
    actionId: 'connect-store',
  },

  trust: {
    bullets: [
      'No assumptions are made.',
      'No data is modified.',
      'Observation precedes interpretation.',
    ],
  },

  postActivation: {
    reflection: 'Trust is not granted. It is observed.',
  },
};
```

📌 Rules:

* FT-MINUS-ONE **always has a CTA**
* CTA initiates lifecycle promotion
* No guarantees, no promises, no unlocking language

---

## 5️⃣ Register the Activation Config

### File

`apps/frontend/src/activation/resolveActivationConfig.ts`

```ts
const ACTIVATION_BY_MODULE: Record<string, ActivationSurfaceProps> = {
  orders: orderNexusActivationConfig,
  products: productsActivationConfig,
  customers: customersActivationConfig,
  finances: financesActivationConfig,

  trust: trustDataHealthActivationConfig,
};
```

🚨 Hard rule:

> **Registry keys MUST equal route segment AND moduleId**

---

## 6️⃣ Ensure Activation Surface Wiring Is Intact

### Adapter (already canonical)

`ActivationSurfaceAdapter.tsx`

```ts
onActivate={() => {
  if (!surface.primaryCTA) return;
  onAction(surface.primaryCTA.actionId);
}}
```

### App shell handler

`App.tsx`

```ts
const handleActivation = (actionId: string) => {
  if (actionId === 'connect-store') {
    setIsConnectModalOpen(true);
  }
};
```

📌 Outcome:

* User click → FT0 → FT1
* UI does **not** infer lifecycle
* Backend remains authority

---

## 7️⃣ Add the Module to the Sidenav (Always Visible)

### File

`apps/frontend/src/layouts/AppLayout/SidenavContent.tsx`

Add **after main modules**:

```ts
const navItems = [
  { label: 'Orders', path: '/orders', icon: <IconShoppingCart /> },
  { label: 'Products', path: '/products', icon: <IconBox /> },
  { label: 'Customers', path: '/customers', icon: <IconUsers /> },
  { label: 'Finances', path: '/finances', icon: <IconCash /> },

  // Trust is cross-cutting and always visible
  { label: 'Trust', path: '/trust', icon: <IconShield /> },
];
```

📌 Rules:

* Trust appears in **all lifecycles**
* Never hidden
* Never entitlement-gated
* Never lifecycle-gated

---

## 8️⃣ Validation Checklist (Do Not Skip)

### FT-MINUS-ONE

* `/trust` renders ActivationSurface
* CTA clickable
* No blank screen
* No redirects

### FT0

* Sync surface shown
* No modules mounted

### FT1

* `/trust` route exists
* Module page mounts (even if empty)

### FT2

* FT2 page replaces FT1 page
* No FT1 artifacts remain

---

## 9️⃣ Common Failure Modes (Now Documented)

| Symptom                  | Root Cause                                  |
| ------------------------ | ------------------------------------------- |
| Blank screen             | `resolveActivationConfig()` returned `null` |
| Activation not rendering | moduleId mismatch                           |
| CTA does nothing         | `primaryCTA` missing                        |
| Wrong surface shown      | Synthetic remapping in lifecycle gate       |
| Trust hidden             | Incorrect sidenav logic                     |
| Lifecycle jumps          | UI inferred lifecycle                       |

---

## 🔒 Final Lock Statement

> **A module is introduced by identity, not behavior.**
> Behavior emerges only after lifecycle promotion.

This process is now **repeatable**, **auditable**, and **boring** — which is exactly what you want.

When you’re ready, the next step is:
**“Trust → FT1 backend signal contract”**
and we will do that with the same discipline.

No shortcuts.
