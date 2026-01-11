# CommercialGrantEvent — v1.0 (DRAFT → SEALED)

## Purpose

Provide a **single, billing-agnostic entry point** for granting **paid capabilities** to a shop **without contaminating**:

* lifecycle
* UI
* entitlement resolution
* pricing logic
* payment providers

This contract exists to **translate commercial intent into entitlements**, nothing more.

---

## Core Invariants (Non-Negotiable)

1. **Additive only**

   * No revocation
   * No downgrades
   * No overwrites

2. **Idempotent**

   * Replaying the same event must not change state after first application

3. **Billing-agnostic**

   * No Stripe / Paddle / invoice concepts
   * No amounts
   * No plans
   * No pricing tiers

4. **Lifecycle-blind**

   * Must NOT read or infer lifecycle phase
   * Must NOT trigger lifecycle transitions

5. **Entitlement-only**

   * Writes to `shop_module_entitlements` (or future equivalent)
   * Nothing else

---

## Canonical Contract

### Event Shape

```ts
// DOMAIN CONTRACT — DO NOT COUPLE TO BILLING PROVIDERS
export interface CommercialGrantEvent {
  shopId: number;

  source: 'billing' | 'admin' | 'migration';

  grants: {
    modules?: string[]; // additive module unlocks
    flags?: string[];   // additive capability flags
  };

  metadata?: {
    externalRef?: string; // e.g. invoice_id, admin_action_id
    issuedAt?: string;    // ISO timestamp (optional)
  };
}
```

---

## Semantic Meaning (Critical)

### `shopId`

* **Target of truth**
* Entitlements are always **shop-scoped**, never user-scoped

### `source`

* **Audit-only**
* Used for traceability and future analytics
* Must NOT change behavior

### `grants.modules`

* Unlocks **entire FT2 modules**
* Example:

  * `analytics`
  * `finances`
  * `wms-lite`
  * `echo-hub`

### `grants.flags`

* Unlocks **capability-level deltas**
* Example:

  * `analytics.unbounded_history`
  * `orders.export_csv`
  * `wms.pick_pack_ship`
  * `echo.ai_autoreplies`

### `metadata`

* **Opaque**
* Stored, never interpreted
* Safe place for billing system references

---

## Processing Rules (Must Be Enforced)

When `applyCommercialGrant(event)` is called:

1. Validate shape (non-empty grants)
2. For each module:

   * Insert `(shop_id, module_key, null)`
3. For each flag:

   * Insert `(shop_id, module_key?, flag_key)`
4. Use **ON CONFLICT DO NOTHING**
5. Persist `source` + `metadata` for audit
6. Exit

That’s it.

No branching. No conditionals. No pricing logic.

---

## Explicitly Forbidden (v1.0)

🚫 Checking payment status
🚫 Reading lifecycle
🚫 Granting `paid` / `premium` meta-flags
🚫 Revoking entitlements
🚫 Calling this from frontend
🚫 Multiple grant paths

There must be **exactly one** way to grant paid access.

---

## Relationship to Existing System

| System                | Interaction                                  |
| --------------------- | -------------------------------------------- |
| `EntitlementsService` | **Consumes results**, does not decide grants |
| `FT2LatchService`     | ❌ Must NOT call this                         |
| Lifecycle             | ❌ Must NOT read paid state                   |
| Frontend              | ❌ Never calls                                |
| Billing               | ✅ Calls this (later)                         |

---

## Status

* **Drafted** ✅
* **Reviewed** ✅
* **Sealed (v1.0)** 🔒

Any future change requires:

* version bump
* migration strategy
* explicit rationale

---