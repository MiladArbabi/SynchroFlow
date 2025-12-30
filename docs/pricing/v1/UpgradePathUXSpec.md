**locked v1 Upgrade Path UX Spec** for LaSyncro # 🔒 

0. Core Principles (Non-Negotiable)

1. **Single mental model:**

   * Merchant = **Shop** (Shopify shop / LaSyncro org)
   * Shop has **one plan per moduleKey** (returnNexus, sku-os, wmsLite, problemSolve, marginCore, orderNexus).
   * All UIs (Shopify + web) must show the *same truth*.

2. **Modules are always visible, but not always usable.**

   * Every module is shown in the sidenav.
   * Status drives cross-sell: `ACTIVE`, `FREE`, `LOCKED`.

3. **Three levels of gating:**

   * **Module-level gating** – module locked (not installed / plan = NONE).
   * **Plan-level gating** – module installed but feature requires higher plan.
   * **Quota-level gating** – plan OK, but they hit a usage limit (e.g., 300 returns).

4. **No dead ends.**
   Every lock MUST show:

   * *what you’d get if upgraded*
   * *what plan you need*
   * *a single primary CTA* (“Upgrade to Pro+”).

5. **Cross-sell is contextual, not random.**

   * Don’t just shout “install SKU OS”.
   * Show “You’re losing money here → SKU OS or ProblemSolve fixes that”.

---

# 1. Global UI Structure

## 1.1 Sidenav Layout (LaSyncro Hub + Embedded Shopify App)

Sidenav sections:

* **Core Intelligence**

  * OrderNexus
  * SKU OS
  * Specter (future)
  * MarginCore

* **Ops & Warehouse**

  * WMS-Lite
  * ProblemSolve
  * ReturnNexus

* **Analytics & Governance**

  * InsightCore (read-only in v1)
  * Settings & Billing

Each module item shows:

```ts
type ModuleNavStatus = 'ACTIVE' | 'FREE' | 'LOCKED';

interface ModuleNavState {
  moduleKey: 'returnNexus' | 'sku-os' | 'wmsLite' | 'problemSolve' | 'marginCore' | 'orderNexus';
  status: ModuleNavStatus;
  currentPlanId?: PricingPlanId; // 'FREE' | 'PRO' | ...
}
```

**Visual spec:**

* `ACTIVE` → colored dot + plan label badge (e.g. “Pro+”).
* `FREE` → grey dot + badge “Free (upgrade)”
* `LOCKED` → lock icon + “Install module” or “Connect module”.

Clicking:

* ACTIVE/FREE → open module dashboard.
* LOCKED → open **Module Overview & Upgrade** screen (cross-sell surface).

---

# 2. Entitlements Model (Front-End)

## 2.1 Entitlement Object

Every web/Shopify client gets:

```ts
interface ModuleEntitlement {
  moduleKey: string;
  planId: PricingPlanId | 'NONE';
  limits: Record<string, number | null>;
  featureFlags: Record<string, boolean>;
}

interface ShopEntitlements {
  shopId: string;
  modules: ModuleEntitlement[];
}
```

Front-end uses this for:

* Sidenav rendering.
* Feature gating (`requiredPlan`, `requiredFlag`, `requiredLimitKey`).
* Showing upgrade banners.

**No feature should rely on “UI checks only.”** Always also enforce on backend, but this spec is for UX.

---

# 3. Gating Patterns (How Locks Are Shown)

## 3.1 Component-Level Contract

Any feature that’s not universally available must declare:

```ts
interface FeatureGateProps {
  moduleKey: string;
  featureId: string;
  requiredPlanId?: PricingPlanId; // e.g. 'PRO_PLUS'
  requiredFeatureFlag?: string;   // e.g. 'returnIntegration'
  limitKey?: string;              // e.g. 'maxReturnsPerMonth'
  onSuccessRender: ReactNode;
}
```

`<FeatureGate>` behavior:

1. **Check entitlements**:

   * If module plan < requiredPlan → **plan-level lock**.
   * If featureFlag === false → **flag-level lock**.
   * If usage >= limits[limitKey] → **quota-level lock**.

2. Render either:

   * `onSuccessRender` (unlocked), or
   * **Feature Locked Panel**.

## 3.2 Feature Locked Panel Spec

Panel elements:

* Title: `"Unlock {FeatureName}"`
* Subtitle: short benefit: `"Automate refunds for low-risk returns and save hours per week."`
* Plan comparison chip:

  * “You’re on: Free”
  * “Required: Pro+ or higher”
* 3–5 bullet points on what you’d unlock.
* Primary CTA:

  * In Shopify app: **"Upgrade in Shopify"** → hits your Billing API endpoint.
  * In web SaaS: **"Upgrade plan"** → open plan selection modal.
* Secondary CTA: `"Compare plans"` → opens pricing modal.

---

# 4. Upgrade Flows

You have **three** upgrade flows to design:

1. **Module-level activation (from LOCKED in nav).**
2. **Plan upgrade within a module (feature paywall).**
3. **Quota upgrade when hitting limits.**

---

## 4.1 Flow 1 – Module Activation (From LOCKED Nav)

**Entry point:**

* User clicks `ReturnNexus` in sidenav with status = `LOCKED`.

**Screen: “Activate ReturnNexus”**

Sections:

1. **Hero**

   * Title: “Turn returns into a profit lever.”
   * Subtext: 1–2 lines about mission.

2. **What you get (non-plan-specific)**

   * 3–4 value bullets (portal, automation, analytics).

3. **Plan strip (Free, Pro, Pro+, Elite)**

   * `Free` pre-selected.
   * Each card shows:

     * Price / month
     * Returns per month limit
     * Key “this is the main benefit” bullet
   * For Shopify, **only Free + Pro** visible by default is an option if you want to reduce complexity, but spec-wise assume all.

4. **Primary action (depending on context)**

   * If coming from Shopify app:

     * CTA: `"Install {Module} Free"` or `"Start with Pro"`
     * This calls your backend → Shopify Billing → redirect back.

   * If coming from LaSyncro Hub:

     * CTA: `"Activate ReturnNexus"`
     * Opens **choose billing context** (Shopify or direct card).

5. **Cross-sell hint**

   * A small note (not dominant):
     `"Already using SKU OS? ReturnNexus will send returns quality data straight into product health."`

**State after activation:**

* `moduleKey=returnNexus` changes from `LOCKED` → `ACTIVE`, `planId=FREE` or `PRO` etc.
* Sidenav updates; module dashboard becomes accessible.

---

## 4.2 Flow 2 – Plan Upgrade Within Module (Feature Paywall)

**Trigger:**

* User on `ReturnNexus Free` clicks “Enable Auto-Approvals”.

**Pattern: Inline Paywall Lightbox**

Content:

1. **Header**

   * `"Auto-Approvals are available on Pro+ and above."`

2. **Current vs Next Plan**

   * Current: `Free: manual approvals only`
   * Recommended: `Pro+: auto-approvals, exchanges, up to 1,000 returns/month`.

3. **Delta-focused bullets**

   * “What you unlock by upgrading” (only differences, not full table).

4. **Price summary**

   * `"Upgrade to Pro+ for $99/month"`
   * `"Estimated: <0.5% of ARR for a $2M brand."` (optional future)

5. **CTA**

   * **"Upgrade to Pro+"**
   * Secondary: “Stay on Free” (closes modal).

**Behavior:**

* After upgrade success:

  * Show success toast: `"You’re now on Pro+ — Auto-Approvals activated."`
  * Immediately enable feature and reload module context.

---

## 4.3 Flow 3 – Quota Upgrade (Hitting Limits)

This is critical for monetization.

**Example:** ReturnNexus Free hitting `maxReturnsPerMonth = 10`.

**UX:**

* When they attempt to process 11th return:

  1. **Block with clarity:**

     * `"You’ve reached the limit of 10 returns this month on the Free plan."`

  2. **Show options:**

     * `"Upgrade to Pro to process up to 300 returns/month."`
     * `"Or wait until next month to process more returns."`

  3. **Elements:**

     * Clear plan summary of Pro vs current limit.
     * CTA: `"Upgrade to Pro"`.

* **No hidden behavior**:

  * Do NOT silently drop returns.
  * Do NOT continue and hope they upgrade later.

This pattern applies across modules:

* SKU OS exceeding `maxActiveSkus`.
* WMS-Lite exceeding `maxPicksPerMonth`.
* ProblemSolve exceeding `maxIssuesPerMonth`.

---

# 5. Cross-Sell Design (Module Locking as Sales Surface)

You want the locked modules to constantly, but sanely, advertise the value of the rest of the CNS.

## 5.1 Sidenav Cross-Sell Badges

When visiting one module, the sidenav can show:

* Under ReturnNexus:
  `"SKU OS: Get alerted when returns degrade product health."` (badge “Recommended”).

* Under WMS-Lite:
  `"ProblemSolve: Turn warehouse issues into actionable tasks."`

Rules:

* Max **1 cross-sell badge** visible at a time.
* Cross-sell should reflect *data* if possible:

  * If >5% of orders are returns → show ReturnNexus.
  * If many issues exist in WMS Lite → show ProblemSolve.

## 5.2 InsightCore-Triggered Cross-Sell (Phase 2, but design-conscious now)

Inside `InsightCore` or any analytics views:

* If returns burden is high → banner:
  `"You’re refunding $X/mo. Optimize with ReturnNexus → [Install]"`
* If stockouts are frequent → `"SKU OS can prevent stockouts → [Install]"`

This is just using the locked modules as upsell paths.

---

# 6. Shopify vs Direct SaaS Experience

You’re dual-channel: Shopify App Store and LaSyncro.com.

### 6.1 Shopify App (Per-Module)

* Each Shopify app (ReturnNexus, SKU OS, WMS Lite, etc.):

  * Shows only that module’s dashboard by default.
  * Sidenav still lists other modules, but clicking them:

    * either:

      * opens “Install this module via Shopify App Store” page, or
      * opens a **LaSyncro Hub Unified view** in an iframe.

* Upgrade CTAs for that module:

  * MUST go through Shopify Billing (no direct card forms).
  * Use planId mapping to Shopify plan names.

### 6.2 LaSyncro Hub (app.lasyncro.com)

* Full multi-module layout.
* For Shopify-linked merchants:

  * Show `Billing managed in Shopify` tag.
  * Upgrade flows:

    * If module is installed as Shopify app → open Shopify Billing upgrade.
    * If module is NOT installed → either:

      * Show “Install from Shopify” CTA.
      * Or allow hybrid (but that complicates billing; better to keep per-module billing source consistent).

---

# 7. State & Edge Cases

You need explicit UX for bad states or you’ll leak frustration and churn.

## 7.1 Trial States

If you support trials:

```ts
interface PlanRuntimeState {
  planId: PricingPlanId;
  isTrial: boolean;
  trialEndsAt?: string;
}
```

UI:

* Banner: `"Pro+ trial ends in 7 days — keep Auto-Approvals by adding a payment method."`
* On trial expiry:

  * Downgrade to Free or previous paid plan.
  * Immediately re-check entitlements and show paywalls.

## 7.2 Downgrades

When downgrading:

* Show explicit **what you lose**:

  * Features
  * History depth
  * Limits
* Block downgrade if it’d create inconsistent state (e.g. they have 12,000 issues + want Free with 20 issues/month).

  * Instead, explain:

    * `"You have 12,000 active issues. To downgrade, you must archive issues or your downgrade will take effect next billing cycle with reduced functionality."`

## 7.3 Failed Billing / Cancelled Apps

* If Shopify billing fails:

  * Set module plan to `FREE` or `NONE` depending on your policy.
  * Show blocking banner:

    * `"Billing issue detected. Your plan has been downgraded to Free — some automations are disabled."`

* If app is uninstalled from Shopify:

  * Immediately mark module as `LOCKED`.
  * In Hub, show:

    * `"This module is no longer installed in Shopify. Reinstall to regain access."`

---

# 8. Tracking & Experimentation

You don’t learn anything without instrumentation.

Track at minimum:

* `upgrade_modal_viewed` (moduleKey, featureId, fromPlan, toPlanSuggested).
* `upgrade_clicked` (context: feature paywall, quota, nav, cross_sell).
* `upgrade_completed` (fromPlan, toPlan, moduleKey, channel=shopify/direct).
* `upgrade_dismissed` (reason if known: closed, “stay on current plan”).
* `quota_hit` (moduleKey, limitKey, currentPlan).

Use this to:

* Find which features drive the most upgrades (should inform pricing boundaries).
* See which modules are the best cross-sell drivers.
* Decide where to invest in UX copy and education.

---

# 9. Brutal Summary

* Every feature must declare **requiredPlan** / **requiredFlag** / **limitKey**.
* Every lock must show:

  * “What you get if you upgrade”
  * “Which plan you need”
  * “Upgrade” CTA.
* Module locking + sidenav cross-sell is how you make the CNS visible and monetizable.
* Shopify vs SaaS billing must be cleanly separated, but the **UX concept** must stay unified: one shop, multiple module plans.