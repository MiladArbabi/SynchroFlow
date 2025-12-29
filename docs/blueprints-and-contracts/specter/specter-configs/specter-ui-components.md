## **Specter UI Components – Architecture, UX Flow & Integration**

This document describes the **key Specter-related UI components**, how they interact with state providers, and how they form the FT0–L1 onboarding and intelligence experience.

Components covered:

* `<SpecterOnboardingBanner />`
* `<SpecterConfigPanel />`
* `<SpecterConfigProvider />` (integration overview)
* Dashboard integration
* Account Settings integration

---

# **1. Component Overview**

## **1.1 SpecterOnboardingBanner**

### **Purpose**

A lightweight banner shown at the top of the dashboard the first time a merchant connects Shopify. It:

* Introduces Specter as their intelligence engine
* Acknowledges their **primary sales channel**
* Allows configuring Specter behavior (“Configure”)
* Allows dismissing onboarding nudges (“Dismiss”)

### **Visibility Logic**

```ts
if (!shouldShowOnboardingNudges) return null;
```

`shouldShowOnboardingNudges` comes from:

```ts
config.enableOnboardingNudges
```

Defaults to **true** for first-run merchants.

### **Configure Button**

Navigates to:

```
/account/settings?tab=specter
```

This opens the Specter tab automatically.

### **Dismiss Button**

Calls:

```ts
saveConfig({
  businessStage,
  primarySalesChannel,
  enableOnboardingNudges: false
})
```

Immediately hides the banner and persists preference.

---

## **1.2 SpecterConfigPanel**

### **Purpose**

The user-facing configuration area for Specter inside Account Settings.

Provides:

* **Primary sales channel** input
* **Enable onboarding nudges** switch
* (Future) Business Stage selection
* (Future) Persona / intelligence depth controls
* Save button

### **Initial Values**

Pulled from the provider:

```ts
config.primarySalesChannel
config.businessStage
config.enableOnboardingNudges
```

### **When the user clicks “Save”**

1. Validate the data (simple type checks)
2. Save via:

```ts
await saveConfig(updated)
```

3. Save triggers a backend upsert
4. Provider updates global config
5. The Specter banner hides (if nudges disabled)

### **Error Rendering**

Errors are not inline yet (FT0), but the panel receives `error` from context if save or fetch fails.

---

# **2. How Components Interact With the Provider**

```
+---------------------------+
|  SpecterConfigProvider   |
|---------------------------|
| shopId                   |
| config                   |
| isLoading                |
| isSaving                 |
| error                    |
| shouldShowOnboarding...  |
| refresh()                |
| saveConfig()             |
+---------------------------+
      ▲               ▲
      |               |
      | usesConfig    | calls saveConfig
      |               |
+---------------+   +----------------------+
| Onboarding    |   | SpecterConfigPanel   |
| Banner        |   |                      |
+---------------+   +----------------------+
```

### **Key Notes**

* Banner *reads* configuration and *writes* dismissals.
* ConfigPanel is the authoritative editor for all config fields.
* Both rely on the provider for persistence and global state.

---

# **3. Dashboard Integration**

In `DashboardPage.tsx`, SpecterBanner appears inside:

```tsx
<DashboardStateManager>
  <SpecterOnboardingBanner />
  <WidgetLayoutWithRegistry />
</DashboardStateManager>
```

### Why placed here?

* Banner should appear above widgets but below store connect banners.
* It becomes part of the overall dashboard state orchestration.
* Hides automatically after sync or dismissal.

### Future Enhancements (FT1)

* Specter action cards
* Insight timeline
* Persona-based nudges

---

# **4. Account Settings Integration**

The Specter tab in AccountSettingsPage:

```tsx
<Tab 
  label="Specter"
  icon={<IconComponent name="Ghost" size="small" />}
/>
```

The tab index is automatically set via URL query param:

```
/account/settings?tab=specter
```

### Why this UX works well:

* Banner → Settings feels natural
* Enables deep linking from emails, nudges, tutorials
* Users can always return to modify Specter behavior

---

# **5. UI Contract Summary**

### **What the banner expects**

| Field                           | Used For               |
| ------------------------------- | ---------------------- |
| `config.primarySalesChannel`    | Personalizing text     |
| `config.enableOnboardingNudges` | Determining visibility |
| `saveConfig()`                  | Dismissal              |

### **What the panel expects**

| Field                           | Used For                   |
| ------------------------------- | -------------------------- |
| `config.businessStage`          | Future AI persona tuning   |
| `config.primarySalesChannel`    | Merchant’s core storefront |
| `config.enableOnboardingNudges` | Banner visibility          |
| `saveConfig()`                  | Persisting changes         |

---

# **6. Future Components (FT1–FT2)**

### **Planned Enhancements**

| Component                 | Description                                 |
| ------------------------- | ------------------------------------------- |
| `SpecterPersonaSelector`  | Choose Survival/Growth/Architect AI persona |
| `SpecterImpactFeed`       | Timeline of nudges and intelligence events  |
| `SpecterConfidenceSlider` | Tune how bold Specter should be             |
| `SpecterSimulators`       | Cashflow / inventory “what if” models       |
| `SpecterGoalPlanner`      | Strategic outcomes & nudge orchestration    |

Each will plug into this provider and the new `/specter/config` API contract.

---

# **7. Responsibilities Split**

### **Frontend**

* Manages UX, component wiring, onboarding flow
* Ensures clean state and safe persistence
* Prevents duplicate logic via the provider

### **Backend**

* Stores config JSON
* Ensures multi-tenancy isolation via/shop_id
* Allows forward-compatible expansion

---
