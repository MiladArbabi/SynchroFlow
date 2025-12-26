## 🔁 Shop Lifecycle — Runtime Sequence (Mermaid)

```mermaid
sequenceDiagram
    autonumber
    participant UI as App Boot
    participant IP as IntegrationProvider
    participant BE as Backend
    participant UIH as useIntegration()
    participant SLS as ShopLifecycleShell
    participant OR as useOnboardingReadiness
    participant LS as localStorage

    %% --------------------------------------------------
    %% App Boot
    %% --------------------------------------------------

    UI->>IP: Mount IntegrationProvider
    IP->>BE: GET /integrations/sync-status
    IP-->>UIH: bootState = BOOTING

    %% --------------------------------------------------
    %% Integration Resolution
    %% --------------------------------------------------

    alt Integration EXISTS
        BE-->>IP: { status: PENDING | SYNCING_* }
        IP->>IP: bootResolved = true
        IP-->>UIH: existence=EXISTS, syncStatus=SYNCING

        UIH-->>SLS: integration snapshot
        SLS->>SLS: resolvedPhase = FT0_SYNCING

    else Integration NOT FOUND
        BE-->>IP: 404
        IP->>IP: bootResolved = true
        IP-->>UIH: existence=NONE

        UIH-->>SLS: integration snapshot
        SLS->>LS: clear FT1 seal
        SLS->>SLS: resolvedPhase = FT_MINUS_ONE
    end

    %% --------------------------------------------------
    %% Sync Completion
    %% --------------------------------------------------

    BE-->>IP: { status: COMPLETED }
    IP-->>UIH: syncStatus = COMPLETED
    UIH-->>SLS: sync completed

    SLS->>OR: fetch onboarding readiness
    OR-->>SLS: ft1.isComplete = false
    SLS->>SLS: resolvedPhase = FT0_PREPARING
    SLS->>SLS: enforce VISUAL_FT0_MIN_MS

    %% --------------------------------------------------
    %% FT1 Readiness
    %% --------------------------------------------------

    OR-->>SLS: ft1.isComplete = true
    SLS->>LS: persist FT1 seal
    SLS->>SLS: resolvedPhase = FT1_READY
    SLS->>SLS: latch FT1 (absorbing)

    %% --------------------------------------------------
    %% Auth Churn / Refresh
    %% --------------------------------------------------

    BE-->>IP: 401 / 403
    IP->>IP: preserve lastExistence + lastSync
    IP-->>UIH: unchanged snapshot
    UIH-->>SLS: no lifecycle change

    %% --------------------------------------------------
    %% Integration Removal (Hard Reset)
    %% --------------------------------------------------

    BE-->>IP: 404
    IP-->>UIH: existence = NONE
    UIH-->>SLS: integration removed
    SLS->>LS: remove FT1 seal
    SLS->>SLS: reset refs
    SLS->>SLS: phase = FT_MINUS_ONE
```

---

## 🔒 What This Diagram Guarantees

* **No UI flicker**
* **FT1 is absorbing**
* **Auth churn is ignored**
* **Integration deletion is the only reset**
* **FT0 minimum dwell is enforced**
* **Lifecycle cannot regress accidentally**

---

## 🧠 Mental Model (One Sentence)

> IntegrationProvider stabilizes reality → useIntegration exposes facts → ShopLifecycleShell enforces time, order, and irreversibility.

---