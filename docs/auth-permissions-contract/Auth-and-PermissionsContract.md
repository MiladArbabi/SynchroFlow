**LaSyncro Auth & Permissions Contract – v1 (Locked & Sealed)**

---

# 🔒 0. Scope & Non-Negotiables

This document **locks**:

1. **Actor & role model** (who is calling our APIs)
2. **JWT structure and claims** for app.laSyncro.com and Shopify apps
3. **Permission model** (what each role can do, per module)
4. **Auth flows**:

   * Shopify embedded app merchants
   * Direct SaaS (email login/SSO-ready)
   * Service-to-service calls
5. **API auth requirements** (headers, how to verify)
6. **“Who checks what”** (frontends vs backends vs Entitlements)

Any change to JWT shape, role enums, or permission semantics requires `auth-contract v2` and a migration plan. No one gets to YOLO their own token format.

---

## 1. Actors & Identity Model

### 1.1 Actor Types (LOCKED)

```ts
export type ActorType = 'shop_user' | 'system_service' | 'support_admin';
```

* `shop_user` – human user belonging to a shop/merchant org.
* `system_service` – internal service account (OrderNexus, WMS-Lite, etc.).
* `support_admin` – LaSyncro internal staff (support, ops). **Extra restrictions**.

### 1.2 User & Shop Identity (from Core)

We assume Core already has:

```ts
export type ShopId = string;   // UUID
export type UserId = string;   // UUID

export type ShopRole =
  | 'OWNER'
  | 'ADMIN'
  | 'OPS'
  | 'FINANCE'
  | 'ANALYST'
  | 'DEV';
```

Semantics:

* `OWNER` – full permissions, including billing.
* `ADMIN` – manage users, modules, but may be restricted from billing in some shops.
* `OPS` – day-to-day operations (WMS, returns, tasks).
* `FINANCE` – billing + MarginCore views.
* `ANALYST` – read-only analytics & reports.
* `DEV` – technical / integration stuff (webhooks, API keys).

Each `shop_user` may have **multiple `ShopRole`s**.

---

## 2. JWT – Access Token Contract (LOCKED)

All authenticated HTTP calls (UI or backend) to LaSyncro APIs use a JWT access token.

### 2.1 Format

* **Type:** JWT, signed with server-side key (RS256).
* **Transport:** `Authorization: Bearer <token>` header.
* **Audience:** `api.lasyncro` (for all internal APIs).

### 2.2 Claims

```ts
export interface LaSyncroAccessTokenClaims {
  // Standard JWT fields
  iss: 'auth.lasyncro.com';     // issuer
  sub: string;                  // subject (userId | serviceId)
  aud: 'api.lasyncro.com';      // audience
  iat: number;                  // issued at (unix)
  exp: number;                  // expiry (unix, 15–60 min)

  // Actor identity
  actor_type: ActorType;        // 'shop_user' | 'system_service' | 'support_admin'

  // Shop context (for shop_user and some support_admin)
  shop_id?: ShopId;             // required for shop_user; optional for support_admin
  user_id?: UserId;             // for shop_user
  service_id?: string;          // for system_service
  session_id?: string;          // per-login session; rotation anchor

  // Roles & scopes
  shop_roles?: ShopRole[];      // roles for shop_id if actor_type=shop_user
  modules?: ModuleKey[];        // modules accessible in this session (optimization)
  scopes?: string[];            // fine-grained scopes (see §5)

  // Security metadata
  token_version: number;        // v1 – bump for hard revokes
  auth_provider: 'shopify' | 'password' | 'sso' | 'service';
  shopify_shop_domain?: string; // when coming via Shopify
}
```

**Rules:**

* `actor_type` is **mandatory**.
* `shop_id` is **mandatory** for `shop_user`.
* `shop_roles` MUST reflect current roles at token issuance; Core is source of truth.
* `modules` is an **optimization**; permissions are ultimately checked via Entitlements + roles.

Any additional claim must not change the semantics of these locked ones.

---

## 3. Auth Flows

### 3.1 Shopify Embedded App Flow (Merchant)

**Goal:** Authenticate a Shopify merchant into a LaSyncro module UI and issue a `shop_user` JWT.

**Flow (LOCKED semantics):**

1. Merchant opens Shopify app (e.g. LaSyncro Returns) →
   Shopify signs the request with `hmac`, includes `shop`, `timestamp`, etc.

2. LaSyncro Shopify App Backend:

   * Validates HMAC via Shopify secret.
   * Resolves or creates `Shop` & `User` in Core (user can be pseudo-identified by Shopify user ID).
   * Ensures ModuleRegistration exists for `moduleKey`.

3. Auth service issues **short-lived access token**:

   ```ts
   {
     actor_type: 'shop_user',
     auth_provider: 'shopify',
     shopify_shop_domain: '<shop>.myshopify.com',
     shop_id: '<ShopId>',
     user_id: '<UserId>',
     shop_roles: ['OWNER' | 'ADMIN' | ...], // resolved mapping
     modules: ['returnNexus', 'wmsLite', ...],
     scopes: ['module:returnNexus:read', 'module:returnNexus:write'],
     ...
   }
   ```

4. Token is returned to the front-end (via query param, postMessage, or set-cookie w/ httpOnly).

5. Frontend uses `Authorization: Bearer` for all API calls.

**Key constraints:**

* Shopify is **identity provider**, not permissions provider.
* Role mapping (Shopify staff vs LaSyncro roles) is a Core concern; roles must be stored, not inferred ad hoc.

---

### 3.2 Direct SaaS Flow (Non-Shopify / app.lasyncro.com)

For shops created directly on LaSyncro.

1. User logs in (email + password or SSO).
2. Auth service verifies credentials / SSO assertion.
3. Auth service loads:

   * `shop_id` associated.
   * `shop_roles`.
4. Issues JWT with:

   * `actor_type='shop_user'`
   * `auth_provider='password' | 'sso'`
   * Same claim structure as Shopify flow.

Refresh tokens:

* **Opaque** and stored server-side.
* Only Auth service knows them.
* Not used between modules; only for issuing new access tokens.

---

### 3.3 Service-to-Service Auth

Used for:

* Billing → Core / Entitlements
* ReturnNexus → OrderNexus
* WMS-Lite → ProblemSolve
* etc.

**Token:**

* Same JWT structure, but:

```ts
actor_type: 'system_service';
service_id: 'returnNexus';     // or 'skuOs', 'wmsLite', ...
shop_id: undefined;            // unless acting on a specific shop
scopes: ['service:events:publish', 'service:core:read', ...];
```

**Rules:**

* `system_service` tokens are **never** issued to browsers.
* They are rotated via internal secrets (env/secret store).
* These tokens may be long-lived but should still have expiry & rotation.

---

### 3.4 Support Admin Flow

For internal LaSyncro staff:

* `actor_type='support_admin'`
* `shop_id` can be:

  * `null` for global views (e.g. multi-tenant dashboards),
  * or a specific shop being “impersonated”.
* `scopes` must be **strict**:

  * e.g. `admin:read_shop`, `admin:read_billing`, `admin:impersonate_readonly`.

We will **NOT** allow arbitrary impersonation; actions taken in impersonation must be audit-logged.

---

## 4. Permissions Model

Auth answers “who are you?”; Permissions answers “what can you do?”

Permissions are determined by:

1. **ActorType** (hard boundaries)
2. **ShopRole(s)** (coarse capabilities)
3. **Scopes** (fine-grained capabilities)
4. **Entitlements** (module + plan + limits)

### 4.1 ActorType Hard Boundaries (LOCKED)

* `shop_user`:

  * Can only act **within `shop_id`** in token.
  * Cannot access other shops, even if they know IDs.
  * No direct cross-tenant reads.

* `system_service`:

  * May span shops, but only for scopes listed in `scopes`.
  * Not allowed to perform UI-only actions (e.g. “impersonate user”).

* `support_admin`:

  * Only allowed for back-office apps.
  * Must always be logged in Core audit logs with `actor_type='support_admin'`.

### 4.2 Scoped Permission Strings (LOCKED Format)

Scopes are strings:

```text
<namespace>:<resource>:<action>
```

Examples:

* `module:returnNexus:read`
* `module:returnNexus:write`
* `module:skuOs:read`
* `billing:subscriptions:write`
* `core:shops:read`
* `events:publish:analytics`
* `admin:shop:read`
* `admin:shop:impersonate_readonly`

**Rules:**

* All module-level API calls must require at least one `module:<moduleKey>:read|write` scope.
* Backend services **must** check scopes; frontend cannot be trusted.

---

### 4.3 Mapping ShopRole → Default Scopes (v1)

This mapping is part of Auth config; once locked, it’s shared across modules.

Example (conceptual; can be extended but not weakened silently):

```ts
const ROLE_SCOPE_MAPPING: Record<ShopRole, string[]> = {
  OWNER: [
    'module:*:read',
    'module:*:write',
    'billing:*:read',
    'billing:*:write',
    'core:users:read',
    'core:users:write'
  ],
  ADMIN: [
    'module:*:read',
    'module:*:write',
    'billing:*:read',
    'core:users:read',
    'core:users:write'
  ],
  OPS: [
    'module:returnNexus:read',
    'module:returnNexus:write',
    'module:wmsLite:read',
    'module:wmsLite:write',
    'module:skuOs:read'
  ],
  FINANCE: [
    'billing:*:read',
    'module:returnNexus:read',
    'module:marginCore:read'
  ],
  ANALYST: [
    'module:*:read',
    'analytics:*:read'
  ],
  DEV: [
    'core:integrations:read',
    'core:integrations:write',
    'module:*:read'
  ]
};
```

**Rules:**

* Final scopes = union of scopes from all roles + any additional explicit scopes.
* No role may implicitly bypass Entitlements; scope only opens doors, plan/limits still gate usage.

---

## 5. API Auth & Permission Enforcement

### 5.1 HTTP Requirements (LOCKED)

Every non-public endpoint must:

1. Require `Authorization: Bearer <JWT>`.
2. Verify:

   * Signature (RS256).
   * `iss === 'auth.lasyncro.com'`.
   * `aud === 'api.lasyncro.com'`.
   * `exp > now`.
3. Extract claims into a standard `AuthContext` object.

```ts
export interface AuthContext {
  actorType: ActorType;
  shopId?: ShopId;
  userId?: UserId;
  serviceId?: string;
  roles: ShopRole[];
  scopes: string[];
  authProvider: 'shopify' | 'password' | 'sso' | 'service';
}
```

### 5.2 Standard Permission Helpers

All services must use standard helpers, not roll their own.

```ts
export interface PermissionChecker {
  requireScope(scope: string): void;   // throws if missing
  hasScope(scope: string): boolean;
  requireShop(shopId: ShopId): void;   // ensures token.shop_id === shopId (for shop_user)
}
```

Every handler should:

* Validate shop identity:

  * If path includes `:shopId`, `requireShop(pathShopId)` for `shop_user`.
* Validate scope:

  * `requireScope('module:returnNexus:write')` for write endpoints in ReturnNexus, etc.
* Then call Entitlements to check plan/limits.

### 5.3 Order of Enforcement

For any business action:

1. **Auth** – is token valid? is actor_type allowed?
2. **Permissions** – does actor have required scope / role?
3. **Entitlements** – does the module + plan allow this feature/usage?
4. **Business rules** – domain-specific constraints.

Skipping any stage = bug.

---

## 6. Frontend-Specific Rules

Frontends **must not** base security solely on plan or roles; they:

1. Use JWT only for:

   * Figuring out who is logged in.
   * Sending `Authorization` header.
2. Use Entitlements API for:

   * Showing/hiding features (`ModuleEntitlement.features`).
   * Displaying upgrade prompts.
3. Use `shop_roles` ONLY for UI decisions like:

   * Showing admin-only sections (user management, billing).

Security decisions (e.g. “can create RMA”) **must be enforced** in backend.

---

## 7. Session, Rotation & Revocation

### 7.1 Access Token Lifetime

* Default: 15–60 minutes.
* No long-lived access tokens for browsers.

### 7.2 Refresh Tokens

* **Opaque**, stored in Auth DB:

  * `refresh_token_id`, `userId`, `shopId`, `session_id`, `expiresAt`, `revokedAt`.
* Not visible to backend services; only Auth service uses them.
* Re-issue access tokens with **same `session_id`** until revoked or expired.

### 7.3 Forced Logout / Revocation

When:

* User changes password
* Roles change
* Security incident / suspicious activity

Auth service can:

* Bump `token_version` (store per user).
* Reject any token where `token_version` < stored version.
* Revoke individual `session_id` + associated refresh tokens.

---

## 8. Auditing & Compliance

Each backend must log:

* `actor_type`, `user_id` or `service_id`, `shop_id`
* `endpoint`, `method`, `resourceId`
* `decision`: allowed/denied
* Reason if denied (scope missing, entitlement blocked, etc.)

Internal tools must be able to answer:

> “Which actions did support_admin X take on shop Y last week?”

If you can’t answer that, your implementation is non-compliant with this contract.

---

## 9. Forbidden Patterns

**Not allowed in v1:**

* Using Shopify HMAC directly to authorize API calls from the browser (HMAC is for initial handshake only).
* Having a “super secret” backdoor header that bypasses JWT and scopes.
* Per-module custom JWTs with their own claim formats.
* Hardcoding role names deep in modules (always check scopes, not string roles).
* Frontend-only “security” (e.g. hiding a button but not enforcing in backend).

Any of these must be treated as a **security violation**.
