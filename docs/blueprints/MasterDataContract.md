Good. We’re doing this properly.

This response locks **A. LaSyncro Master Data Contract (v1)**.
Everything here is “source of truth” for identities, shops, modules, roles and audit.
Billing, entitlements, and eventing will come **after** this in later steps.

---

# 🔒 LaSyncro Master Data Contract – v1 (Locked & Sealed)

## 0. Scope & Non-Negotiables

This blueprint **locks**:

1. **Global identity model**

   * Shops
   * Users
   * Memberships (user ↔ shop, roles)
2. **Module registration**

   * Which modules are active/connected for a shop
3. **Shared ID & enum contracts**
4. **Core DB schemas** for the “Core” service
5. **Public API contracts** for:

   * Shop registry
   * User & membership management
   * Module registration & status
6. **Audit event format**

Any change to types or schemas marked **LOCKED** requires:

* `master-data-contract v2`
* a schema + API migration plan

No ad-hoc deviation allowed.

---

## 1. Global Identity & IDs

### 1.1 ID Strategy (LOCKED)

All top-level entities:

```ts
export type ShopId = string;    // UUID v4
export type UserId = string;    // UUID v4
export type MemberId = string;  // UUID v4 (user-in-shop)
export type ModuleKey =
  | 'returnNexus'
  | 'skuOs'
  | 'wmsLite'
  | 'problemSolve'
  | 'marginCore'
  | 'orderNexus'
  | 'specter'
  | 'insightCore';
```

**Rules:**

* `ShopId`, `UserId`, `MemberId` are **never** integers.
* `ModuleKey` is the **canonical enum** for all services, UIs, and pricing.
* External systems (Shopify, etc.) are linked via **extras**, not as primary IDs.

---

## 2. Core Domain Types (Logical Model)

### 2.1 Shop

```ts
export type BillingSource = 'shopify' | 'direct' | 'hybrid';

export type ShopStatus =
  | 'active'
  | 'pending'
  | 'suspended'
  | 'closed';

export interface Shop {
  shopId: ShopId;
  primaryDomain: string;     // e.g. example.myshopify.com or custom domain
  displayName: string;

  billingSource: BillingSource;

  // External identifiers
  external: {
    shopifyShopId?: string;
    shopifyDomain?: string;
  };

  status: ShopStatus;

  createdAt: string;         // ISO
  updatedAt: string;         // ISO
}
```

### 2.2 User

```ts
export type UserStatus = 'active' | 'invited' | 'disabled';

export interface User {
  userId: UserId;
  email: string;
  name: string;
  status: UserStatus;

  // Optional: link back to Shopify staff
  external: {
    shopifyUserId?: string;
  };

  createdAt: string;
  updatedAt: string;
}
```

### 2.3 Membership (User ↔ Shop)

```ts
export type ShopRole =
  | 'shop_owner'
  | 'ops_manager'
  | 'warehouse_user'
  | 'finance_admin'
  | 'analyst'
  | 'viewer';

export interface ShopMembership {
  memberId: MemberId;
  shopId: ShopId;
  userId: UserId;

  roles: ShopRole[];   // non-empty
  isPrimaryOwner: boolean;

  createdAt: string;
  updatedAt: string;
}
```

**Rules:**

* 1 user can belong to many shops.
* Each shop must have at least **one** `isPrimaryOwner=true`.
* Roles drive authorization in **every** module.

---

### 2.4 Module Registration (Shop ↔ ModuleKey)

```ts
export type ModuleStatus =
  | 'locked'         // not active, not installed
  | 'installed'      // technically installed but not fully configured
  | 'active'         // fully active, can produce/consume data
  | 'suspended';     // explicitly disabled (billing / policy)

export type PlanId =
  | 'FREE'
  | 'PRO'
  | 'PRO_PLUS'
  | 'ELITE'
  | 'ENTERPRISE'
  | 'NONE';

export interface ModuleRegistration {
  shopId: ShopId;
  moduleKey: ModuleKey;

  status: ModuleStatus;
  planId: PlanId;               // 'NONE' if locked/uninstalled

  // Source of billing for this module instance
  billingSource: BillingSource; // must be compatible with Shop.billingSource

  // External linkage per module/app
  external: {
    shopifyAppInstallationId?: string;
  };

  createdAt: string;
  updatedAt: string;
}
```

**Rules:**

* `(shopId, moduleKey)` is **unique**.
* `status='active'` implies `planId != 'NONE'`.
* If `Shop.billingSource='shopify'`, module must have `billingSource='shopify'` (no mixing inside one shop).

---

## 3. DB Schema – Master Data (LOCKED)

This is the canonical schema for the **Core / Identity service**.

### 3.1 `core_shops`

```sql
CREATE TABLE core_shops (
  shop_id UUID PRIMARY KEY,
  primary_domain TEXT NOT NULL,
  display_name TEXT NOT NULL,

  billing_source TEXT NOT NULL CHECK (billing_source IN ('shopify', 'direct', 'hybrid')),
  status TEXT NOT NULL CHECK (status IN ('active', 'pending', 'suspended', 'closed')),

  external_shopify_shop_id TEXT,
  external_shopify_domain TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_core_shops_primary_domain
  ON core_shops (primary_domain);
```

### 3.2 `core_users`

```sql
CREATE TABLE core_users (
  user_id UUID PRIMARY KEY,
  email CITEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'invited', 'disabled')),

  external_shopify_user_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.3 `core_shop_memberships`

```sql
CREATE TABLE core_shop_memberships (
  member_id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES core_shops(shop_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES core_users(user_id) ON DELETE CASCADE,

  roles TEXT[] NOT NULL, -- array of ShopRole enum values
  is_primary_owner BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_core_shop_memberships_shop_user
  ON core_shop_memberships (shop_id, user_id);

CREATE INDEX idx_core_shop_memberships_user
  ON core_shop_memberships (user_id);

-- At most one primary owner per shop (enforced by app logic; DB optional)
```

### 3.4 `core_module_registrations`

```sql
CREATE TABLE core_module_registrations (
  shop_id UUID NOT NULL REFERENCES core_shops(shop_id) ON DELETE CASCADE,
  module_key TEXT NOT NULL, -- ModuleKey
  status TEXT NOT NULL CHECK (status IN ('locked', 'installed', 'active', 'suspended')),
  plan_id TEXT NOT NULL,     -- PlanId
  billing_source TEXT NOT NULL CHECK (billing_source IN ('shopify', 'direct', 'hybrid')),

  external_shopify_app_installation_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (shop_id, module_key)
);
```

---

## 4. Shared Enums (Global)

These are **canonical** O(1) enums used everywhere.

```ts
// modules/module-key.ts
export type ModuleKey =
  | 'returnNexus'
  | 'skuOs'
  | 'wmsLite'
  | 'problemSolve'
  | 'marginCore'
  | 'orderNexus'
  | 'specter'
  | 'insightCore';

// roles/roles.ts
export type ShopRole =
  | 'shop_owner'
  | 'ops_manager'
  | 'warehouse_user'
  | 'finance_admin'
  | 'analyst'
  | 'viewer';

// plans/plan-id.ts
export type PlanId =
  | 'FREE'
  | 'PRO'
  | 'PRO_PLUS'
  | 'ELITE'
  | 'ENTERPRISE'
  | 'NONE';
```

**Rule:**
Any module needing new roles / module keys / plan IDs must go through **v2**.

---

## 5. Core Public APIs (Identity & Modules)

All under: **`/api/core/v1`**

### 5.1 Get Shop Context (for any authenticated request)

```http
GET /api/core/v1/shop-context
Authorization: Bearer <JWT>
```

**Response:**

```ts
export interface ShopContextResponse {
  shop: Shop;
  memberships: ShopMembership[];
  modules: ModuleRegistration[];
}
```

* This powers the Hub sidenav, entitlements pre-fetch, etc.

---

### 5.2 Shops API

#### 5.2.1 Get Shop by ID

```http
GET /api/core/v1/shops/:shopId
Authorization: Bearer <JWT>
```

Returns `Shop`. Access controlled: must be a member.

#### 5.2.2 List Shops for Current User

```http
GET /api/core/v1/my/shops
Authorization: Bearer <JWT>
```

```ts
export interface MyShopsResponse {
  shops: Array<{
    shop: Shop;
    roles: ShopRole[];
  }>;
}
```

---

### 5.3 Users & Memberships

#### 5.3.1 Invite User to Shop

```http
POST /api/core/v1/shops/:shopId/memberships
Authorization: Bearer <JWT with role shop_owner or ops_manager>
Content-Type: application/json
```

```ts
export interface InviteMemberRequest {
  email: string;
  name: string;
  roles: ShopRole[];
}

export interface InviteMemberResponse {
  user: User;
  membership: ShopMembership;
}
```

Semantics:

* Creates `User` if not exists; `status='invited'`.
* Sends invite (out of scope here).
* Creates membership row.

#### 5.3.2 Update Membership Roles

```http
PATCH /api/core/v1/memberships/:memberId
Authorization: Bearer <JWT with shop_owner>
```

```ts
export interface UpdateMembershipRequest {
  roles?: ShopRole[];
  isPrimaryOwner?: boolean;
}

export interface UpdateMembershipResponse {
  membership: ShopMembership;
}
```

Business rules:

* Cannot remove last `shop_owner` or last `isPrimaryOwner=true`.
* Cannot demote oneself if last owner.

---

### 5.4 Module Registration API

#### 5.4.1 List Module Registrations for Shop

```http
GET /api/core/v1/shops/:shopId/modules
Authorization: Bearer <JWT>
```

Returns:

```ts
export interface ListModulesResponse {
  modules: ModuleRegistration[];
}
```

#### 5.4.2 Upsert Module Registration (Admin)

> This is the **only entrypoint** for modules’ status/plan changes.

```http
PUT /api/core/v1/shops/:shopId/modules/:moduleKey
Authorization: Bearer <JWT with finance_admin or shop_owner>
Content-Type: application/json
```

```ts
export interface UpsertModuleRegistrationRequest {
  status?: ModuleStatus;   // 'active' | 'installed' | 'locked' | 'suspended'
  planId?: PlanId;
  billingSource?: BillingSource;
  external?: {
    shopifyAppInstallationId?: string | null;
  };
}

export interface UpsertModuleRegistrationResponse {
  module: ModuleRegistration;
}
```

**Business rules:**

* If `status='active'` ⇒ `planId != 'NONE'`.
* If `Shop.billingSource='shopify'` ⇒ `billingSource` must be `'shopify'`.
* If module-specific billing webhooks fire, they **call this endpoint**.

---

## 6. Audit Events (Global)

All write operations in Core must emit an **AuditEvent**.

### 6.1 Type

```ts
export type AuditAction =
  | 'SHOP_CREATED'
  | 'SHOP_UPDATED'
  | 'USER_CREATED'
  | 'USER_INVITED'
  | 'USER_UPDATED'
  | 'MEMBERSHIP_CREATED'
  | 'MEMBERSHIP_UPDATED'
  | 'MODULE_REGISTRATION_UPDATED';

export interface AuditEvent {
  eventId: string;         // UUID
  shopId?: ShopId;         // optional for user-level events
  actorUserId?: UserId;    // may be null for system/webhook actions
  action: AuditAction;
  entityType: 'shop' | 'user' | 'membership' | 'module_registration';
  entityId: string;        // shopId / userId / memberId / (shopId:moduleKey)

  payload: Record<string, any>; // non-PII diff snapshot
  createdAt: string;       // ISO
}
```

### 6.2 DB Schema

```sql
CREATE TABLE core_audit_events (
  event_id UUID PRIMARY KEY,
  shop_id UUID,
  actor_user_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_core_audit_events_shop
  ON core_audit_events (shop_id, created_at);
```

---

## 7. Ownership & Service Boundaries

* **Core Service (this spec):**

  * Owns `core_shops`, `core_users`, `core_shop_memberships`, `core_module_registrations`, `core_audit_events`.
  * Provides `/api/core/v1/*`.

* **All Other Modules:**

  * Treat Core as **read-only**:

    * Query shop, user, modules, roles.
    * Never own these tables.
  * For plan/activation changes:

    * Always go through `/api/core/v1/shops/:shopId/modules/:moduleKey`.

---

## 8. Versioning & Migration Rules

* This is `master-data-contract v1`.
* Any change to:

  * `Shop`, `User`, `ShopMembership`, `ModuleRegistration`,
  * Shared enums (`ModuleKey`, `PlanId`, `ShopRole`),
  * DB schemas above,
  * `/api/core/v1` signatures,

…requires:

1. Creating `master-data-contract v2` doc.
2. Explicit migration steps (schema, data, API).
3. Backward compatibility windows for dependent services.

No team is allowed to “just add a column” to these tables.

---

## 9. How This Connects to Next Docs

With this Master Data Contract locked, the next specs will hook into it:

* **Billing Contract**

  * Attaches billing state to `Shop` & `ModuleRegistration`.
* **Entitlements Engine**

  * Reads `ModuleRegistration.planId` + pricing JSON to compute entitlements.
* **Eventing Backbone**

  * Uses `shopId`, `moduleKey`, `userId` from this contract in every event.
* **Auth & Permissions**

  * Uses `User` + `ShopMembership.roles` as principals for all actions.