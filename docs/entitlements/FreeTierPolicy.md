# **MODULE FREE TIER EXPOSURE POLICY (FTEP v1.1)**

**Status:** LOCKED
**Applies to:** All CNS Modules
**Used by:** Onboarding, Entitlements, Readiness Providers, UI

---

## **1. Purpose**

The Free Tier Exposure Policy (FTEP) defines how each CNS module provides a limited, value-forward experience to Free Tier merchants.
Each module **must**:

* Provide a usable “taste” version
* Apply a predictable usage limit
* Expose gating signals to the onboarding system
* Drive upgrades via consistent UI patterns

This is a core element of the PLG strategy for LaSyncro.

---

## **2. Access State Model**

```ts
export type ModuleAccessState =
  | 'visible'              // Tab visible, module not started
  | 'free_tier_active'     // Free tier within monthly quota
  | 'free_tier_exhausted'  // Usage exceeded for current month
  | 'locked';              // Fully locked behind paid plan
```

This state controls:

* Which onboarding tasks are actionable
* Whether CTA buttons show “Open” or “Upgrade”
* Whether the module content loads or the LockedFeaturePage is shown

---

## **3. Free Tier Policy Contract**

```ts
export interface ModuleFreeTierPolicy {
  enabled: boolean;

  /**
   * Monthly usage limit for Free Tier.
   * null → unlimited (FT0 only)
   */
  maxUnits: number | null;

  /**
   * Usage metric tracked per month.
   */
  metric:
    | 'orders'
    | 'skus'
    | 'returns'
    | 'nudges'
    | 'insights'
    | 'tasks'
    | 'pos';

  /** Optional soft warning threshold (percentage of quota). */
  softWarningThreshold?: number;

  /** Where upgrade CTAs should route the user. */
  upgradeRoute: string;

  /** Human-facing paywall message. */
  lockedMessage: string;

  /** Always 'monthly' for v1.1 */
  resetPeriod: 'monthly';
}
```

---

## **4. Required Module Declaration**

Each CNS module must publish:

```ts
interface ModuleConfig {
  moduleId: ModuleId;
  freeTier: ModuleFreeTierPolicy;
}
```

This ensures consistency across onboarding, entitlements, and readiness providers.

---

## **5. Recommended Default Limits**

| Module         | Metric   | Free Tier Max | Rationale                                |
| -------------- | -------- | ------------- | ---------------------------------------- |
| OrderNexus     | orders   | 50/month      | Enough to show value, encourages upgrade |
| SKU-OS         | skus     | 5             | Stores typically have 50–500 SKUs        |
| ReturnNexus    | returns  | 3             | Lets users feel workflow                 |
| Specter        | nudges   | 1/day         | Insight teaser                           |
| InsightCore    | insights | 2/day         | High-value teaser                        |
| WMS Lite       | pos      | 1 PO/month    | Enough to demonstrate ops automation     |
| Problem Center | tasks    | 1 workflow    | Entry point to EchoHub                   |

---

## **6. Readiness Provider Requirements**

Each readiness provider must emit:

```ts
{
  name: `${moduleId}.freeTierState`,
  value: ModuleAccessState
}
{
  name: `${moduleId}.freeTierRemaining`,
  value: number | null
}
{
  name: `${moduleId}.freeTierResetsAt`,
  value: string   // ISO timestamp for next 1st of the month
}
```

The onboarding UI uses these signals to:

* Gate tasks
* Disable CTAs when exhausted
* Show “Upgrade” prompts
* Display renewal dates

---

## **7. UI Behavior Rules**

### A) When `free_tier_active`

* All tasks are actionable
* CTA chip displays based on task.action type
* Onboarding flow proceeds normally

### B) When `free_tier_exhausted`

* CTA chip becomes `Upgrade`
* Clicking CTA → `navigate('/upgrade')`
* Header badge remains red until reset

### C) When `locked`

* Entire module collapses to a one-line card
* No tasks rendered
* Shows the associated paywall message

---

## **8. Entitlements Engine Integration**

Entitlements must return:

```ts
interface ModuleEntitlement {
  moduleId: ModuleId;
  access: 'allowed' | 'free-tier' | 'locked';
  limits?: { maxUnits: number; usedUnits: number };
}
```

Final access state is derived by merging:

```
Entitlements + FreeTierPolicy + Usage
```

Order of precedence:

1. locked → overrides all others
2. free-tier-exhausted → overrides “active”
3. free-tier-active → default
4. visible → module not yet started (FT0 only)

---

## **9. Monthly Reset Policy (Locked)**

All free-tier metrics reset at:

**00:00 UTC on the 1st day of each month.**

Reset logic:

* If `(currentMonth !== usage.period)` → `usedUnits = 0`
* Implemented lazily (evaluated on each read)
* Cron job optional for future performance optimization

---

# 🔒 This is the final, approved Free Tier Exposure Policy (FTEP v1.1)

---