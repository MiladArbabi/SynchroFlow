# Shop Lifecycle – Sequence Diagrams

---

## 1. High-Level Responsibility Flow

```
Backend ──▶ IntegrationProvider ──▶ useIntegration()
                                       │
                                       ▼
                              ShopLifecycleShell
                                       │
                                       ▼
                             ShopLifecycleContext
                                       │
                                       ▼
                                   UI
```

**Key rule**

* IntegrationProvider = *structural truth*
* ShopLifecycleShell = *visual & experiential truth*

No arrows go backward.

---

## 2. Cold Start → FT1_READY (Happy Path)

### Scenario

* User logs in
* Integration exists
* Sync runs
* Onboarding completes
* FT1 reached and sealed

### Sequence

```
User opens app
│
├─▶ IntegrationProvider mounts
│     ├─ bootState = BOOTING
│     ├─ existence = null
│     └─ syncState = null
│
├─▶ useIntegration()
│     └─ bootResolved = false
│
├─▶ ShopLifecycleShell
│     └─ resolvedPhase = FT_MINUS_ONE
│
├─▶ Backend: GET /integrations/sync-status
│
├─▶ IntegrationProvider receives data
│     ├─ existence = EXISTS
│     ├─ syncState = SYNCING
│     └─ bootState = READY
│
├─▶ useIntegration()
│     ├─ bootResolved = true
│     ├─ existence = EXISTS
│     └─ syncStatus = SYNCING
│
├─▶ ShopLifecycleShell
│     ├─ resolvedPhase = FT0_SYNCING
│     └─ ft0EnteredAt = now()
│
├─▶ Backend reports COMPLETED
│
├─▶ IntegrationProvider
│     └─ syncState = COMPLETED
│
├─▶ useOnboardingReadiness()
│     └─ ft1.isComplete = true
│
├─▶ ShopLifecycleShell
│     ├─ waits VISUAL_FT0_MIN_MS
│     ├─ sets latchedPhase = FT1_READY
│     └─ persists FT1 seal
│
└─▶ UI renders FT1 (locked)
```

**Important**

* FT1 is **not** allowed instantly
* FT0 always appears at least once
* FT1 is sealed only after backend confirmation

---

## 3. Refresh While in FT1 (No Flicker Path)

### Scenario

* User refreshes page
* Integration API refetches
* Possibly transient states occur

### Sequence

```
User refreshes page
│
├─▶ IntegrationProvider mounts
│     ├─ bootState = BOOTING
│     └─ no data yet
│
├─▶ ShopLifecycleShell
│     ├─ reads FT1 seal from localStorage
│     └─ latchedPhase forced to FT1_READY
│
├─▶ UI immediately renders FT1
│
├─▶ Backend refetch occurs
│     ├─ maybe returns SYNCING
│     ├─ maybe returns NOT_FOUND briefly
│
├─▶ IntegrationProvider absorbs churn
│     └─ preserves last known truth
│
└─▶ ShopLifecycleShell
      └─ ignores regressions (PHASE_RANK)
```

**Why FT_MINUS_ONE never flashes**

* FT1 seal is checked *before* integration state
* Latched FT1 is absorbing
* Integration is no longer authoritative post-FT1

---

## 4. Auth Churn (401 / 403)

### Scenario

* Token refresh
* Temporary auth failure
* Backend returns 401

### Sequence

```
IntegrationProvider receives 401
│
├─▶ DOES NOT reset state
│
├─▶ Preserves:
│     ├─ lastExistence
│     └─ lastSyncState
│
├─▶ useIntegration()
│     └─ continues reporting stable values
│
└─▶ ShopLifecycleShell
      └─ no lifecycle change
```

**Result**

* No FT regression
* No empty loaders
* No lifecycle reset

---

## 5. Integration Removed (Hard Reset Path)

### Scenario

* User deletes integration
* Backend returns 404

### Sequence

```
Backend: integration deleted
│
├─▶ IntegrationProvider receives 404
│     ├─ existence = NONE
│     ├─ syncState = null
│     └─ bootState = READY
│
├─▶ useIntegration()
│     ├─ existence = NONE
│     └─ syncStatus = IDLE
│
├─▶ ShopLifecycleShell effect
│     ├─ detects existence === NONE
│     ├─ clears FT1 seal
│     ├─ resets refs
│     └─ sets latchedPhase = FT_MINUS_ONE
│
└─▶ UI shows clean empty state
```

**Critical distinction**

* This is a **real structural change**
* Only case where FT1 is allowed to disappear

---

## 6. Why the Empty Loader Used to Flash (and Now Can’t)

### Old (Broken)

```
Integration loading
│
├─▶ UI sees "unknown"
├─▶ renders FT_MINUS_ONE
├─▶ backend resolves
├─▶ renders FT0
├─▶ resolves again
├─▶ renders FT1
```

### New (Fixed)

```
Integration loading
│
├─▶ bootResolved = false
├─▶ ShopLifecycleShell defers meaning
├─▶ FT1 seal overrides
└─▶ No intermediate visual states
```

**Key structural fix**

* `bootResolved` explicitly modeled
* Nullable internal state hidden
* Lifecycle logic centralized

---

## 7. Final Mental Model (Burn This In)

```
Integration answers: "What exists?"
Lifecycle answers:   "What is the user experiencing?"
Readiness answers:   "What is complete?"
```

They **never collapse into one another**.

---

## 8. Status

✅ Lifecycle is deterministic
✅ Visual regression impossible
✅ Auth churn neutralized
✅ Backend volatility absorbed

---

Below is a **strict, executable mental model** of the lifecycle as a **state machine**.
This is not a conceptual sketch — it maps **1:1 to the code paths** you now have.

I’ll give you:

1. **Canonical state machine (visual lifecycle)**
2. **Transition table (guards + triggers)**
3. **Absorbing / irreversible states**
4. **Invalid transitions (explicitly forbidden)**
5. **Why this machine cannot flicker**

---