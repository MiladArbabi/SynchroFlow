## **Specter State Machine – FT0 → L1 Intelligence Orchestration**

This document describes the **state machine** that governs Specter’s behavior — specifically how Specter decides:

* Whether to show onboarding nudges
* Whether Specter is “activated”
* How configuration interacts with intelligence
* How future intelligence stages (L1–L3) will be plugged in

This machine ensures Specter transitions **predictably** and **deterministically** across the merchant lifecycle.

---

# **1. Purpose of the State Machine**

Specter must answer three core questions on every page load:

1. **What should the merchant see right now?**

   * First-run nudge?
   * No nudge?
   * A Specter insight card?

2. **What is Specter allowed to do?**

   * Based on entitlements
   * Based on configuration
   * Based on sync readiness

3. **What is Specter preparing for next?**

   * Persona configuration
   * Intelligence calibration
   * Activation of deeper nudges

The state machine ensures these transitions occur in a controlled, predictable way.

---

# **2. State Machine Diagram**

```
                                       ┌──────────────────┐
                               ┌──────▶│   UNCONFIGURED   │─────────────┐
                               │       └──────────────────┘             │
                               │                │                       │
                               │                │ config exists         │
                               │                ▼                       │
                      Shopify  │       ┌──────────────────┐             │
                      Connect   │       │   CONFIGURED     │             │
                               │       └──────────────────┘             │
                               │                │                       │
                               │                │ nudges enabled        │
                               │                ▼                       │
                               │       ┌──────────────────┐             │
                               └────── │  SHOW_ONBOARDING │────────────┘
                                       └──────────────────┘
                                                │
                                                │ dismiss or disable
                                                ▼
                                       ┌──────────────────┐
                                       │   ACTIVE (L0)    │
                                       └──────────────────┘
                                                │
                                                │ unlock L1 module
                                                ▼
                                       ┌──────────────────┐
                                       │   ACTIVE (L1)    │
                                       └──────────────────┘
```

**Definitions:**

| State               | Meaning                                                    |
| ------------------- | ---------------------------------------------------------- |
| **UNCONFIGURED**    | No Specter config found for shopId                         |
| **CONFIGURED**      | A config exists but nudges haven’t been presented yet      |
| **SHOW_ONBOARDING** | Banner should appear on dashboard                          |
| **ACTIVE (L0)**     | Banner dismissed → Specter is active but no insights yet   |
| **ACTIVE (L1)**     | Intelligence module unlocked → Specter can generate nudges |

---

# **3. Transition Rules**

### **3.1 From UNCONFIGURED → CONFIGURED**

Happens when:

* User first visits
* No config row exists
* Provider normalizes config:

```ts
{
  primarySalesChannel: "",
  businessStage: "survival",
  enableOnboardingNudges: true
}
```

### **3.2 From CONFIGURED → SHOW_ONBOARDING**

Conditions:

* `config.enableOnboardingNudges === true`
* User is on `/dashboard`
* Shopify sync is completed (optional future upgrade)

### **3.3 From SHOW_ONBOARDING → ACTIVE (L0)**

Triggered when merchant:

* Clicks **Dismiss**
  or
* Disables nudges inside settings

Specter stores:

```ts
enableOnboardingNudges = false
```

### **3.4 From ACTIVE (L0) → ACTIVE (L1)**

Triggered by:

* Entitlement grant for module: `"specter_l1"`
* Or internal milestone: “first 30 days completed”
* Or admin override

This enables:

* Nudges based on margin
* Nudges based on inventory
* Nudges based on cashflow

---

# **4. State Determination Logic (Simplified)**

```ts
function getSpecterState(config, entitlements) {
  if (!config) return "UNCONFIGURED";

  if (config.enableOnboardingNudges) return "SHOW_ONBOARDING";

  const hasL1 = entitlements.modules.includes("specter_l1");

  return hasL1 ? "ACTIVE_L1" : "ACTIVE_L0";
}
```

---

# **5. Current FT0 Implementation Status**

| Feature                         | Status | Notes                     |
| ------------------------------- | ------ | ------------------------- |
| Normalization of missing config | ✅      | Done in provider          |
| enableOnboardingNudges toggle   | ✅      | Dismiss + settings toggle |
| Onboarding banner               | ✅      | Renders on dashboard only |
| Save config pipeline            | ✅      | With robust test suite    |
| Specter tab UI                  | ✅      | Functional and extensible |
| Specter icon & branding         | ✅      | Ghost icon added          |

---

# **6. FT1 Extensions to the State Machine**

These will require backend signals and new routes.

### **6.1 Activation Conditions for L1**

L1 unlocks when:

* Entitlement `"specter_l1"` is present
* Canonical commerce ingestion is stable
* A minimum dataset threshold is met

### **6.2 L1 Insight Delivery**

A new state:

```
ACTIVE (L1) + INSIGHT_AVAILABLE
```

Triggered by:

* OpsIntel pipeline emitting SSE events
* Specter intelligence engine publishing nudges

### **6.3 Multi-step Onboarding Flows**

Future version:

```
SHOW_ONBOARDING_STEP_1
SHOW_ONBOARDING_STEP_2
SHOW_ONBOARDING_STEP_3
...
```

Specter will guide merchants through:

* Channel verification
* Business stage selection
* Persona selection
* First insight explanation

---

# **7. How Components Implement This State Machine**

### **7.1 `SpecterConfigProvider`**

Is the **state oracle**.

* Normalizes missing config
* Computes `shouldShowOnboardingNudges`
* Exposes `configState` (future upgrade)

### **7.2 `SpecterOnboardingBanner`**

Reads:

```ts
shouldShowOnboardingNudges
config.primarySalesChannel
```

Updates:

```ts
saveConfig({ enableOnboardingNudges: false })
```

Moves merchant into **ACTIVE (L0)**.

### **7.3 `SpecterConfigPanel`**

Provides persistent control over:

* primarySalesChannel
* businessStage
* enableOnboardingNudges

### **7.4 DashboardPage**

Places the banner **before widgets**, ensuring onboarding is always visible after sync.

---

# **8. Future: Formalizing a State Machine Hook**

Eventually:

```ts
const {
  specterState,
  insights,
  nextAction,
  persona
} = useSpecterStateMachine();
```

This allows:

* Timed nudges
* Multi-step journeys
* Personalized dashboards

---

# **9. Summary**

This state machine provides Specter with:

* Clear phase transitions
* Predictable UX
* Clean separation between onboarding → activation → intelligence
* Backwards compatibility
* A stable platform for L1–L3 intelligence rollout

We now have:

* A defined contract
* Tested components
* A roadmap into spectral intelligence

---