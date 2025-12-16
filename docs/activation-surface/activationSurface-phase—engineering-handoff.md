# ActivationSurface Phase — Engineering Handoff & Execution Guide

## Purpose of This Handoff

This document enables **any engineer** to:

* Understand *what* the ActivationSurface is
* Understand *why* it exists
* Know *exactly where to start*
* Implement each module **one by one**
* Finish the phase **without redesign, re-thinking, or scope creep**

If followed strictly, this phase will end with:

* All major modules gated by a **doctrine-compliant ActivationSurface**
* A **consistent, conversion-optimized UX**
* No further architectural decisions required

---

## 1. What We Are Building (Non-Negotiable)

### ActivationSurface = Mandatory Pre-Activation Gate

The ActivationSurface is shown **whenever a module cannot yet deliver truthful value** due to missing integrations or prerequisites.

It is **not**:

* A marketing page
* A tutorial
* A feature list
* A placeholder

It **is**:

* A **decision-forcing UI**
* Designed to eliminate hesitation
* Designed to make *inaction* feel more expensive than activation

---

## 2. Source of Truth (READ THESE FIRST — IN ORDER)

All behavior and copy is already locked in docs.

### Core Doctrine (DO NOT DEVIATE)

1. `docs/activation-surface/activationSurface-doctrine.md`
2. `docs/activation-surface/activationSurface-overview.md`

These explain:

* Psychological intent
* What is allowed / forbidden
* Why this exists at all

### UI Contract (Code Must Match)

3. `docs/activation-surface/activationSurface-UI-schema.md`
4. `docs/activation-surface/activationSurfaceschema.md`

These define:

* Required slots
* Required structure
* Required sequencing

### Module-Specific Implementations

Each module already has a **finalized, doctrine-compliant copy**:

| Module                  | File                               |
| ----------------------- | ---------------------------------- |
| OrderNexus (Orders)     | `orderNexus-activationSurface.md`  |
| SKU-OS (Products)       | `skuOs-activationSurface copy.md`  |
| Specter (Customers)     | `specter-activationSurface.md`     |
| InsightCore (Analytics) | `insightCore-activationSurface.md` |
| MarginCore (Finances)   | `marginCore-activationSurface.md`  |

👉 **No copywriting is required.**
👉 **No strategy decisions remain.**

Your job is implementation only.

---

## 3. Canonical UI Component (Already Defined)

A typed, slot-based React component has already been defined:

```
ActivationSurface
├── Identity
├── Blindness
├── AbsenceProof
├── ValueAfterActivation
├── Momentum (optional)
├── PrimaryCTA
├── Trust
├── CommitmentGradient (optional)
├── PostActivation (optional)
```

### Hard Rules (Enforced by Code)

* Blindness **must** exist
* Trust **must** appear under CTA
* Only **one** primary CTA
* No feature lists
* No marketing adjectives

If something doesn’t fit into a slot, **it doesn’t belong**.

---

## 4. Where Code Lives (Frontend)

### Shared UI

```
modules/shared/src/ui/activation/
├── ActivationSurface.tsx
├── slots/
│   ├── Identity.tsx
│   ├── Blindness.tsx
│   ├── AbsenceProof.tsx
│   ├── PrimaryCTA.tsx
│   ├── Trust.tsx
│   └── ...
```

Exported via:

```
@lasyncro/shared/ui
```

### Frontend Usage

Each module gates its page via:

```
apps/frontend/src/activation/CommerceActivationGate.tsx
```

Pattern:

```tsx
if (!hasIntegration) {
  return <ActivationSurface {...config} />
}
```

---

## 5. Execution Strategy (DO NOT MULTITASK)

### Rule: One Module at a Time

Do **not** partially implement multiple modules.

Finish one → merge → move on.

---

## 6. Step-By-Step Implementation Process (Per Module)

### Step 1 — Create Config File

Create a config file per module:

```
apps/frontend/src/activation/configs/
├── orderNexus.ts
├── skuOs.ts
├── specter.ts
├── insightCore.ts
├── marginCore.ts
```

Each exports a **pure object**:

```ts
export const orderNexusActivationConfig: ActivationSurfaceProps = {
  moduleId: 'order-nexus',
  identity: { ... },
  blindness: { ... },
  absenceProof: { ... },
  valueAfterActivation: { ... },
  primaryCTA: { ... },
  trust: { ... },
  commitmentGradient: { ... },
  postActivation: { ... }
}
```

👉 Copy content **line-by-line** from the corresponding `.md` file
👉 No interpretation required

---

### Step 2 — Wire CTA to Existing Integration Flow

Use **existing, proven UX**:

* `ConnectStoreBanner`
* `ConnectStoreModal`

Example:

```tsx
primaryCTA: {
  label: 'Connect Shopify Store',
  onActivate: () => setConnectModalOpen(true)
}
```

Do **not** build new OAuth flows.

---

### Step 3 — Gate the Module Route

Example (Orders):

```tsx
<CommerceActivationGate moduleId="order-nexus">
  <OrdersPage />
</CommerceActivationGate>
```

Gate condition must be:

* Based on **real integration state**
* Never mocked
* Never optimistic

---

### Step 4 — Verify Doctrine Compliance (Checklist)

Before merging:

✅ One dominant pain
✅ Blindness is explicit
✅ Absence is visible
✅ CTA is singular
✅ Trust bullets immediately under CTA
✅ No scroll required for core message
✅ No speculative claims

If any fail → fix before merge.

---

## 7. Module Order (Recommended)

Follow this sequence to maximize momentum and reuse:

1. **OrderNexus (Orders)**
   → Sets pattern for profit blindness
2. **SKU-OS (Products)**
   → Builds on Orders integration
3. **Specter (Customers)**
   → Leverages behavioral data
4. **InsightCore (Analytics)**
   → Meta-activation, cross-module
5. **MarginCore (Finances)**
   → Admin-grade, higher friction

---

## 8. What NOT To Do (Common Failure Modes)

❌ Do not “improve” copy
❌ Do not add feature explanations
❌ Do not hide the CTA
❌ Do not add secondary CTAs
❌ Do not reuse onboarding modals
❌ Do not soften consequences
❌ Do not invent new trust claims

If you feel the urge to explain more → you’re violating the doctrine.

---

## 9. Definition of Done (This Phase Is Complete When…)

* Every core module:

  * Is gated by `ActivationSurface`
  * Uses a config object
  * Has zero empty states
* No module shows a dashboard without real data
* No activation screen contradicts another
* Copy is identical to docs
* Engineers can’t “accidentally” bypass activation

At that point, **ActivationSurface Phase is DONE**.

---

## 10. Strategic Outcome (Why This Matters)

Once completed:

* Activation becomes **inevitable**, not persuasive
* Integrations increase because uncertainty is removed
* Support tickets drop (expectation alignment)
* Onboarding becomes truthful
* Modules stop leaking credibility

This is not UI polish.
This is **system integrity enforcement**.

---

## Final Instruction to the Next Engineer

> **Do not think. Do not redesign. Do not reinterpret.**
> Read the docs. Copy the config. Wire the gate. Ship the module. Repeat.

If you do that five times, this phase ends cleanly and permanently.

---