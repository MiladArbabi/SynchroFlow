## **Specter Configuration API – FT0 Specification**

This document describes the backend API that powers Specter’s per-shop configuration, how it is persisted, validated, and consumed by the frontend.

---

# **1. Purpose of the API**

Specter needs a persistent configuration layer so it can:

* Remember how to address the merchant
* Control whether onboarding / coaching nudges appear
* Persist basic store metadata (business stage, primary channel)
* Bootstrap future Specter intelligence (L1–L3)

The configuration is **per-shop**, not per-user.

---

# **2. Database Schema**

Created by migration:

```
apps/backend/migrations/20251203204625_create_specter_shop_configs.ts
```

### **Table: `specter_shop_configs`**

| Column      | Type                          | Notes                          |
| ----------- | ----------------------------- | ------------------------------ |
| id          | serial PK                     |                                |
| shop_id     | integer FK → shops.id, unique |                                |
| config_json | jsonb                         | Arbitrary specter config block |
| created_at  | timestamp                     |                                |
| updated_at  | timestamp                     |                                |

### **Uniqueness guarantee**

Each shop has **at most one** config row:

```
UNIQUE(shop_id)
```

---

# **3. API Endpoints**

Both endpoints infer `shop_id` from the authenticated user.

## **GET /api/v1/specter/config**

### **Response shape**

```ts
{
  shopId: number;
  config: {
    businessStage?: string;
    primarySalesChannel?: string;
    enableOnboardingNudges?: boolean;
  } | null;
}
```

### **Behavior**

1. Authenticate user
2. Resolve their `shop_id`
3. Fetch config row
4. If no config exists → return `config: null` (first-run)
5. If found → return parsed `config_json`

### **Failure modes**

| Case                            | Status                              | Notes                    |
| ------------------------------- | ----------------------------------- | ------------------------ |
| user has no shop                | 403                                 | Should not happen in FT0 |
| row exists but config malformed | returns as-is (frontend normalizes) |                          |
| DB error                        | 500                                 |                          |

---

## **PUT /api/v1/specter/config**

### **Input**

```ts
{
  config: {
    businessStage: string;
    primarySalesChannel: string;
    enableOnboardingNudges: boolean;
  }
}
```

### **Validation rules**

* `config` **must exist**
* `config` **must be a plain object**
  (arrays, null, or primitives are rejected)

If validation fails → **400 Bad Request**

### **Upsert semantics**

Backend performs:

```
INSERT (shop_id, config_json)
ON CONFLICT (shop_id) DO UPDATE SET config_json = EXCLUDED.config_json
RETURNING *
```

This ensures:

* First save creates config
* Subsequent saves overwrite entirely
* Update remains atomic

### **Success response**

```ts
{
  shopId: 42,
  config: { ... } // persisted config
}
```

---

# **4. Access Patterns**

Specter config is read in:

* **Dashboard load**
* **SpecterOnboardingBanner**
* **SpecterConfigPanel**

Specter config is written when:

* Merchant dismisses onboarding nudges
* Merchant updates primary sales channel
* Merchant modifies business stage (future AI-driven)

---

# **5. Error Semantics**

### **GET error cases**

* DB connectivity → 500
* Missing user session → 403
* Missing shop → 403

Frontend treats 404 as “first run” in practice.

### **PUT error cases**

* Invalid JSON structure → 400
* Authorization mismatch (wrong shop) → 403
* DB failure → 500

---

# **6. Frontend Consumption Contracts**

### **SpecterConfigProvider guarantees:**

1. Null config becomes:

```ts
{
  businessStage: 'survival',
  primarySalesChannel: '',
  enableOnboardingNudges: true
}
```

(first-run safe defaults)

2. Errors are recoverable (provider resets after refresh)

3. Calling `saveConfig()` always persists the state and rehydrates provider

---

# **7. Responsibilities and Non-Responsibilities**

### **The API is responsible for:**

* Storing configuration safely
* Validating inbound payloads
* Returning consistent response shapes
* Providing a stable contract for future Specter evolution

### **Not responsible for:**

* Running intelligence models
* Emitting nudges
* Managing onboarding flows
* Rendering UI

Those live in providers, banners, and future Specter runtime.

---

# **8. Future extensions**

Expected fields inside config_json:

| Field               | Purpose                                         |
| ------------------- | ----------------------------------------------- |
| personaType         | tailor Specter tone (e.g., “coach”, “operator”) |
| confidenceThreshold | nudge aggressiveness                            |
| cadence             | how often Specter should report                 |
| lastSeen            | last time user interacted with Specter          |
| dismissals          | track rejection patterns for personalization    |

API design already supports arbitrary JSON expansion.

---

# **9. Validation Philosophy**

Specter config is intentionally **loosely typed on backend**, but **strictly shaped on frontend**.

Reason:

* Backend should preserve unknown future keys
* Frontend is where the intelligence logic lives
* Allows backward-compatible feature rollout without migrations

---
