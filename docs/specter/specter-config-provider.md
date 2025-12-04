## **SpecterConfigProvider – State Model, Lifecycle & Contract**

This document explains how the **SpecterConfigProvider** works in the FT0 architecture, how it synchronizes with the backend, and how other UI components should interact with it.

---

# **1. Purpose of the Provider**

SpecterConfigProvider is the **single source of truth on the frontend** for:

* The shop’s Specter configuration (`businessStage`, `primarySalesChannel`, `enableOnboardingNudges`)
* Whether Specter onboarding nudges should appear
* Handling persistence of config changes (`saveConfig`)
* Error and loading state management
* First-run defaults

It abstracts away API calls and gives UI components a clean, declarative state.

---

# **2. Shape of the Context**

```ts
interface SpecterConfigContextValue {
  shopId: number | null;
  config: SpecterConfigShape | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  refresh(): void;
  saveConfig(nextConfig: SpecterConfigShape): Promise<void>;

  // Derived:
  shouldShowOnboardingNudges: boolean;
}
```

This context is consumed by:

* **SpecterOnboardingBanner**
* **SpecterConfigPanel**
* (Future) Specter Intelligence runtime

---

# **3. Initialization Flow**

When the provider mounts:

1. Check if user is authenticated (`useAuth`)
2. If not → clear config and exit
3. If authenticated → call:

```ts
fetchSpecterConfig(accessToken)
```

4. Normalize returned payload:

* If backend returns:

  ```json
  { shopId: 1, config: null }
  ```

  → treat this as **first-run**

* First-run defaults:

  ```ts
  {
    businessStage: "survival",
    primarySalesChannel: "",
    enableOnboardingNudges: true
  }
  ```

5. Store:

   * `shopId`
   * `config`
   * `error = null`
   * `isLoading = false`

---

# **4. saveConfig(nextConfig)**

This method:

1. Sets:

   ```ts
   isSaving = true;
   isLoading = true;
   error = null;
   ```
2. Calls:

```ts
upsertSpecterConfig(accessToken, nextConfig)
```

3. Updates state using returned payload, falling back to `nextConfig` if backend returns null

4. Clears loading flags on success or failure

5. Re-throws errors so UI components may provide inline error feedback

---

# **5. refresh()**

Simple forced re-fetch by bumping an internal `version` token:

```ts
setVersion(v => v + 1)
```

Used by:

* SpecterOnboardingBanner after dismissal
* Account Settings after save
* Future Specter automations

---

# **6. Derived state: shouldShowOnboardingNudges**

Derived inside the provider:

```ts
!!config?.enableOnboardingNudges
```

No component should compute this independently—this keeps UX consistent.

### **Displayed When:**

* Merchants have never configured Specter (first-run)
* Merchants haven't dismissed nudges yet

### **Hidden When:**

* `enableOnboardingNudges: false`
* User dismissed the banner
* Admin disables it via settings

---

# **7. Error Handling Philosophy**

The provider keeps errors lightweight and recoverable:

### Fetch errors:

* Displayed indirectly (e.g., fallback UI, empty state)
* Reset on next successful fetch

### Save errors:

* Stored in `error`
* Re-thrown to caller for local display
* Do not break the provider state

### Logout:

* Clears all config + errors

---

# **8. Cancellation Mechanics**

To avoid race conditions:

```ts
let cancelled = false;
```

Each fetch or save operation checks this flag before commiting state updates.

This prevents React memory leaks and ensures predictable behavior during fast navigation.

---

# **9. Guarantees the Provider Makes**

### ✓ Always returns a stable config shape

Never returns undefined fields; callers can safely destructure.

### ✓ First-run UX always works

Even before the shop has saved anything.

### ✓ Config state survives navigation

Stored at top-level context, not tied to a specific page.

### ✓ Derived `shouldShowOnboardingNudges` always matches the stored config

No duplicate logic scattered across the UI.

### ✓ All mutations go through `saveConfig`

Ensures server + UI stay in sync and consistent.

---

# **10. Future Expansion**

The provider model intentionally supports:

| Future Field        | Purpose                      |
| ------------------- | ---------------------------- |
| personaType         | Change nudge tone            |
| cadence             | How often nudges should show |
| confidenceThreshold | Impact sensitivity           |
| dismissedNudges     | Personalization memory       |
| lastSeen            | Better behavior modeling     |

Backend JSON schema allows forward-compatible changes without DB migrations.

---