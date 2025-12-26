# ShopLifecycle State Machine

---

## 1. States (Canonical)

```
┌───────────────┐
│ FT_MINUS_ONE  │
│ (No integration)
└───────┬───────┘
        │ integration EXISTS
        ▼
┌───────────────┐
│ FT0_SYNCING   │
│ (Sync running)
└───────┬───────┘
        │ sync COMPLETED
        ▼
┌───────────────┐
│ FT0_PREPARING │
│ (Onboarding)  │
└───────┬───────┘
        │ dwell ≥ VISUAL_FT0_MIN_MS
        │ AND readiness.ft1 === true
        ▼
┌───────────────┐
│  FT1_READY    │  ◀─── ABSORBING
│ (Activated)   │
└───────────────┘
```

---

## 2. Transition Table (Truthful to Code)

| From          | To            | Trigger                    | Guards                        |
| ------------- | ------------- | -------------------------- | ----------------------------- |
| —             | FT_MINUS_ONE  | app boot                   | default                       |
| FT_MINUS_ONE  | FT0_SYNCING   | `existence === EXISTS`     | `bootResolved === true`       |
| FT0_SYNCING   | FT0_PREPARING | `syncStatus === COMPLETED` | always                        |
| FT0_PREPARING | FT1_READY     | onboarding complete        | `elapsed ≥ VISUAL_FT0_MIN_MS` |
| ANY           | FT_MINUS_ONE  | integration removed        | `existence === NONE`          |
| FT1_READY     | FT1_READY     | anything                   | absorbing                     |

---

## 3. Absorbing State (Critical)

```
FT1_READY is ABSORBING
```

Once entered:

* ❌ cannot regress
* ❌ ignores integration churn
* ❌ ignores auth churn
* ❌ ignores backend re-fetches

**Only one exit exists**:

```
FT1_READY ──(integration removed)──▶ FT_MINUS_ONE
```

This is deliberate and enforced.

---

## 4. Guards (Why Transitions Don’t Happen Accidentally)

### Guard 1 — Boot Resolution

```ts
if (!bootResolved) {
  resolvedPhase = FT_MINUS_ONE
}
```

Prevents:

* phantom FT0
* empty loaders
* race conditions

---

### Guard 2 — Phase Rank

```ts
if (PHASE_RANK[next] < PHASE_RANK[current]) return;
```

Prevents:

* FT1 → FT0
* FT0 → FT_MINUS_ONE
* visual regressions

---

### Guard 3 — FT0 Dwell

```ts
elapsed >= VISUAL_FT0_MIN_MS
```

Prevents:

* instant FT1 jumps
* imperceptible onboarding

---

### Guard 4 — Integration Removal Reset

```ts
if (existence === NONE) {
  clear FT1 seal
  reset refs
  go to FT_MINUS_ONE
}
```

Prevents:

* “ghost FT1”
* stale dashboards

---

## 5. Invalid Transitions (Explicitly Impossible)

These **cannot happen** in your current system:

```
FT1_READY  → FT0_PREPARING   ❌
FT1_READY  → FT0_SYNCING     ❌
FT1_READY  → FT_MINUS_ONE    ❌ (unless integration deleted)
FT0_SYNCING → FT_MINUS_ONE  ❌ (unless integration deleted)
BOOTING → FT0               ❌
```

If any of these happen, it is a **bug** — not undefined behavior.

---

## 6. Where the State Machine Lives (Important)

| Layer                  | Responsibility               |
| ---------------------- | ---------------------------- |
| IntegrationProvider    | Structural facts             |
| useIntegration()       | Canonical, stable API        |
| **ShopLifecycleShell** | **State machine + latching** |
| ShopLifecycleContext   | Read-only broadcast          |

No other component is allowed to infer lifecycle state.

---

## 7. Why Flicker Is Now Impossible

Flicker requires **oscillation**.
Oscillation requires **bidirectional transitions**.

Your machine has:

* one direction
* absorbing FT1
* explicit reset only on deletion

Therefore:

```
Flicker = structurally impossible
```

Not “unlikely”.
Impossible.

---

## 8. Final Sanity Check (One-Line Truth)

> **Integration describes reality.
> Lifecycle describes experience.
> Experience is monotonic.**

---

Below is a **ready-to-paste Mermaid diagram** that exactly matches your **current production code**, **tests**, and **invariants**.

You can drop this directly into:

* Markdown docs
* GitHub README
* Architecture docs
* Mermaid Live

---

## 📊 Shop Lifecycle — State Machine (Mermaid)

```mermaid
stateDiagram-v2
    direction LR

    %% --------------------------------------------------
    %% Shop Lifecycle — Visual State Machine
    %% --------------------------------------------------

    [*] --> FT_MINUS_ONE : App boot / No integration

    FT_MINUS_ONE --> FT0_SYNCING
        : integration EXISTS
        / bootResolved === true

    FT0_SYNCING --> FT0_PREPARING
        : syncStatus === COMPLETED

    FT0_PREPARING --> FT1_READY
        : onboarding.ft1.isComplete === true
        & elapsed >= VISUAL_FT0_MIN_MS

    %% --------------------------------------------------
    %% Absorbing FT1
    %% --------------------------------------------------

    FT1_READY --> FT1_READY
        : ANY event
        / absorbing state

    %% --------------------------------------------------
    %% Hard reset on integration removal
    %% --------------------------------------------------

    FT0_SYNCING --> FT_MINUS_ONE
        : integration removed

    FT0_PREPARING --> FT_MINUS_ONE
        : integration removed

    FT1_READY --> FT_MINUS_ONE
        : integration removed
        / clear FT1 seal
        / reset lifecycle refs

    %% --------------------------------------------------
    %% State Annotations
    %% --------------------------------------------------

    note right of FT_MINUS_ONE
        No integration exists.
        No FT0 or FT1 allowed.
    end note

    note right of FT0_SYNCING
        Backend sync in progress.
        Skeletons allowed.
    end note

    note right of FT0_PREPARING
        Sync done.
        Onboarding tasks running.
        Minimum dwell enforced.
    end note

    note right of FT1_READY
        Activated shop.
        Absorbing.
        No regressions allowed.
    end note
```

---

## 🔒 Guaranteed Properties (Document-worthy)

* **FT1_READY is absorbing**
* **No phase regression is possible**
* **Auth churn does not affect lifecycle**
* **Backend refetch cannot cause flicker**
* **Integration deletion is the only reset**

---

## 📌 Exact Code Mapping

| Diagram Concept                | Code Location                             |
| ------------------------------ | ----------------------------------------- |
| `integration EXISTS`           | `useIntegration().existence === 'EXISTS'` |
| `syncStatus === COMPLETED`     | `useIntegration().syncStatus`             |
| `onboarding.ft1.isComplete`    | `useOnboardingReadiness()`                |
| `elapsed >= VISUAL_FT0_MIN_MS` | `ShopLifecycleShell`                      |
| Absorbing FT1                  | `hasEverReachedFT1Ref`                    |
| Reset on deletion              | `existence === 'NONE'`                    |

---

## 🚨 Important Note

If anyone proposes:

* “simplifying” this
* removing the dwell
* deriving lifecycle outside `ShopLifecycleShell`
* reading `IntegrationContext` directly

They are breaking the state machine.

---