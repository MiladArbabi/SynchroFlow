# 🔒 FT1 Aha → Checklist Interaction Pattern (LOCKED)

This pattern governs **all Aha panels** (Order-Nexus today, every module tomorrow).

If any part is violated, the architecture is wrong — not “temporarily imperfect”.

---

## 0️⃣ Why this exists (non-negotiable)

FT1 is about **truth → focus → action**, without:

* routing chaos
* lifecycle leaks
* UI guessing
* modules “helping” users

This pattern guarantees:

* One mental model
* One execution path
* Zero accidental coupling

---

## 1️⃣ Canonical Intent Contract (MANDATORY)

Every Aha panel **must emit exactly one intent**.

### ✅ Allowed intent shape

```ts
type START_ONBOARDING = {
  type: 'START_ONBOARDING';
  taskId?: string;
};
```

### ❌ Forbidden

* Multiple intent types
* Navigation intents
* Checklist-specific intents
* “OpenDrawer”, “GoToSetup”, etc.

> **Rule**:
> Aha panels express *why*, never *how*.

---

## 2️⃣ Aha Panel Rules (MODULE-SIDE, IMMUTABLE)

Aha components (e.g. `OrdersModule`, `OrderNexusAhaPanel`) **must**:

### MUST

* Emit `START_ONBOARDING`
* Optionally include `taskId`
* Be UI-only
* Know nothing about lifecycle, routing, drawers, FT1, or checklists

### MUST NOT

* Import routing
* Dispatch DOM events
* Open drawers
* Call checklist APIs
* Know FT phase
* Know task structure

### ✅ Correct example

```ts
props.onIntent?.({
  type: 'START_ONBOARDING',
  taskId: 'add-costs',
});
```

---

## 3️⃣ Adapter Is the ONLY Bridge (HOST-SIDE)

Every module **must** have exactly one adapter:

```
use<Module>AhaAdapter
```

This adapter is the **only place** where intent becomes behavior.

### Responsibilities (ALL REQUIRED)

1. Translate semantic intent → UI actions
2. Set FT1 checklist focus
3. Open checklist surface
4. Emit analytics

### ✅ Canonical adapter implementation

```ts
export function useOrderNexusAhaAdapter() {
  const { emit } = useUiEvents();

  return (intent: OrderNexusUiIntent) => {
    if (intent.type === 'START_ONBOARDING') {
      setFt1ChecklistFocus({
        moduleId: 'order-nexus',
        taskId: intent.taskId,
      });

      openFt1Checklist();

      emit({
        event: 'ui.intent',
        payload: {
          action: 'start_onboarding',
          surface: 'order_nexus_aha',
          moduleId: 'order-nexus',
          taskId: intent.taskId,
        },
      });
    }
  };
}
```

---

## 4️⃣ Checklist Opening Is Centralized (ABSOLUTE)

### There is **exactly one way** to open the checklist:

```ts
openFt1Checklist();
```

Implemented as:

```ts
window.dispatchEvent(
  new CustomEvent('ft1-checklist:open')
);
```

### ❌ Forbidden everywhere else

* `dispatchEvent` calls
* Drawer state manipulation
* Direct checklist imports
* Routing to `/ft1`

> If someone opens the checklist another way, it’s a bug.

---

## 5️⃣ Focus Is One-Shot (BY DESIGN)

Checklist focus **must** be:

* Stored centrally
* Consumed once
* Cleared immediately

This guarantees:

* No stale focus
* No phantom scrolling
* No cross-module bleed

### Canonical flow

```
Aha CTA
  → START_ONBOARDING(taskId)
    → setFt1ChecklistFocus(...)
      → openFt1Checklist()
        → Ft1ChecklistShell consumes + clears focus
```

---

## 6️⃣ ModuleContentHost Compatibility (IMPORTANT)

This pattern **does not bypass** lifecycle gates.

* If a module is FT1-blocked → `Ft1OnboardingGate` shows
* CTA inside the module **still works**
* Checklist opens regardless of content mounting

This is intentional.

> The checklist is **meta-UI**, not module UI.

---

## 7️⃣ Analytics Contract (LOCKED)

Every `START_ONBOARDING` intent must emit:

```ts
{
  event: 'ui.intent',
  payload: {
    action: 'start_onboarding',
    surface: '<module>_aha',
    moduleId: '<module>',
    taskId?: string
  }
}
```

No variations.

---

## 8️⃣ What This Unlocks (Strategic Payoff)

Because this is locked:

* Any module can add an Aha panel in **minutes**
* Checklist behavior is consistent forever
* You can later:

  * Swap drawer → modal
  * Add animations
  * Track intent funnels
  * Personalize focus
* Without touching **any module code**

That’s real leverage.

---

## 9️⃣ Enforcement Rule (Be ruthless)

If in the future you see:

* A module importing checklist code
* A CTA navigating routes
* A component dispatching DOM events directly
* A second onboarding intent

👉 **Reject the PR.**
No exceptions. No “just this once”.

---