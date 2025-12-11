## **Specter API Contract – Backend ↔ Frontend Specification**

This document defines the **canonical API contract** between the frontend and backend for Specter configuration, onboarding logic, nudges, and future intelligence features.

It applies to:

* `/api/v1/specter/config` (GET)
* `/api/v1/specter/config` (PUT)
* Internal semantics used by `SpecterConfigProvider`
* Future endpoints planned for InsightCore, Nudges, and Persona selection.

---

# **1. Overview**

Specter is a **tenant-scoped intelligence subsystem**. Each shop has exactly **one Specter configuration JSON object**, stored in:

```
specter_shop_configs (
  shop_id PK,
  config_json JSONB NOT NULL
)
```

This config powers:

* FT0 onboarding nudges
* L1 intelligence personalization
* Future Specter capabilities (persona, goals, tutor mode, etc.)

---

# **2. GET /api/v1/specter/config**

### **Request**

```
GET /api/v1/specter/config
Authorization: Bearer <token>
```

### **Authentication**

* Requires a logged-in user.
* User must belong to a shop.
* If no shop → `403 User shop not found.`

### **Response: 200 OK**

```json
{
  "shopId": 42,
  "config": {
    "businessStage": "survival",
    "primarySalesChannel": "Shopify DTC",
    "enableOnboardingNudges": true
  }
}
```

### **Response: 200 OK when config missing**

```json
{
  "shopId": 42,
  "config": null
}
```

### **Response: 403**

```json
{ "error": "User shop not found." }
```

### **Response: 500**

```json
{ "error": "Failed to fetch Specter config." }
```

---

# **3. PUT /api/v1/specter/config**

### **Purpose**

Upsert the tenant’s Specter config.

### **Request**

```
PUT /api/v1/specter/config
Authorization: Bearer <token>
Content-Type: application/json
```

### **Payload**

```json
{
  "config": {
    "businessStage": "growth",
    "primarySalesChannel": "Amazon",
    "enableOnboardingNudges": false
  }
}
```

### **Validation Rules**

* `config` must exist
* Must be a **plain JSON object**
* Not permitted: arrays, strings, null, numerics

### **Response: 200 OK**

```json
{
  "shopId": 42,
  "config": {
    "businessStage": "growth",
    "primarySalesChannel": "Amazon",
    "enableOnboardingNudges": false
  }
}
```

### **Response: 400**

If payload is malformed:

```json
{
  "error": "Invalid config payload. Expected a JSON object under \"config\"."
}
```

### **Response: 403**

```json
{ "error": "User shop not found." }
```

### **Response: 500**

```json
{ "error": "Failed to upsert Specter config." }
```

---

# **4. Configuration Schema (SpecterConfigShape)**

This is maintained in the frontend API layer and validated implicitly by usage.

```ts
export interface SpecterConfigShape {
  businessStage: 'survival' | 'growth' | 'architect';
  primarySalesChannel: string;
  enableOnboardingNudges: boolean;

  // FT1–FT2: reserved for future expansions
  // persona?: 'default' | 'aggressive' | 'conservative';
  // intelligenceLevel?: 'L0' | 'L1' | 'L2' | 'L3';
  // goals?: { ... };
}
```

---

# **5. Server-Side Logic**

The backend controller (simplified):

```ts
// GET: returns row or null
const row = await db('specter_shop_configs')
  .where({ shop_id })
  .first();

return {
  shopId,
  config: row?.config_json ?? null
};
```

```ts
// PUT: UPSERT
await db('specter_shop_configs')
  .insert({ shop_id, config_json })
  .onConflict('shop_id')
  .merge();
```

**Important:** This is explicitly designed for *forward-compatible JSON config*.

---

# **6. Frontend Usage Contract**

The frontend uses **SpecterConfigProvider** to wrap all React components.

### Provider Responsibilities

* Fetch config on mount
* Normalize null → first-run experience
* Expose:

  ```ts
  config
  shopId
  isLoading
  isSaving
  shouldShowOnboardingNudges
  refresh()
  saveConfig()
  ```
* Guarantee consistent state updates
* Handle fetch and save errors gracefully

### Banner usage

```tsx
if (shouldShowOnboardingNudges) <SpecterOnboardingBanner />
```

### Config panel usage

```tsx
<TextField value={primarySalesChannel} … />
<Switch checked={enableOnboardingNudges} … />
<Button onClick={saveConfig}>Save</Button>
```

---

# **7. Error Conditions**

Backend may return:

| Code | Meaning                           |
| ---- | --------------------------------- |
| 403  | User does not belong to a shop    |
| 404  | No such endpoint (dev misrouting) |
| 500  | Database or server error          |

Frontend handles:

* Missing config
* Missing shopId
* Access token expiry
* Save failures
* Fetch failures

Tests cover all above conditions.

---

# **8. Future Specter API Extensions**

These planned endpoints build on the stable FT0 contract:

## **8.1 Persona & Intelligence Selection**

```
PUT /api/v1/specter/persona
{ persona: "growth-driver" }
```

## **8.2 Goals & Outcomes**

```
PUT /api/v1/specter/goals
{ selectedGoals: [...] }
```

## **8.3 Nudges Stream (real-time)**

```
GET /api/v1/specter/nudges/stream
```

SSE feed for insight events.

## **8.4 InsightCore Feed**

```
GET /api/v1/specter/insights
```

## **8.5 Configuration Diffing**

```
POST /api/v1/specter/config/validate
{ proposedConfig: {...} }
```

---

# **9. Summary**

This contract achieves:

* **Full tenant isolation** (shop_id)
* **Simple JSON-based extensibility**
* **Forward-compatible schema**
* **Stable interaction for FT0–L1 onboarding**
* **Tested reliability** (green suite for provider, panel, banner, backend)
* **Minimal coupling** between UI and API

Specter is now positioned to grow into:

* A full intelligence platform
* A nudge orchestration system
* A modular AI persona & goal engine

---