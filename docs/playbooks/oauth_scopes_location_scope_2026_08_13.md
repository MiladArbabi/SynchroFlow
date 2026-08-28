## DOCUMENT — `OAUTH-SCOPES-01 + SHOPIFY-LOCATION-SCOPE-01`

The existing `shopify_submission_playbook.md` is the correct central operational reference for Shopify installation/OAuth behavior, and the repo already uses dated issue-specific playbooks for implementation contracts.

I recommend **two documentation changes plus one inline-comment correction**. Do not touch the existing untracked `shopify-local-dev-store-playbook.md`.

### 1. New file — `docs/playbooks/oauth_scopes_location_scope_2026_08_13.md`

**BEFORE**

```text
File does not exist.
```

**AFTER**

````md
# OAUTH-SCOPES-01 + SHOPIFY-LOCATION-SCOPE-01
## Canonical Shopify OAuth scope contract

**Date:** 2026-08-13  
**Status:** CLOSED — implemented and runtime-proven  
**Issues:** `OAUTH-SCOPES-01`, `SHOPIFY-LOCATION-SCOPE-01`

---

## Problem

LaSyncro previously maintained Shopify OAuth scopes independently in several
places:

- `shopify.app.toml`
- the authenticated reconnect flow
- the App Store install flow
- `shopifyClient.service.ts`
- `shopify_app_installations.scopes`

Those copies had drifted.

The audited state included:

- `read_locations` missing from the required scope contract;
- the App Store flow omitting `write_inventory`;
- the App Store flow requesting `read_payouts` even though it was not part of
  the canonical application contract;
- OAuth reconnect and fresh install using different requested scope lists;
- the OAuth callback ignoring Shopify's returned `scope`;
- reconnect persistence leaving `shopify_app_installations.scopes` stale.

The persisted database scope string therefore could not be treated as runtime
grant truth.

---

## Canonical required scope contract

The code-level required contract is:

`apps/backend/src/services/shopify/shopifyScopes.ts`

```text
read_products
read_orders
read_customers
read_inventory
write_inventory
read_locations
read_fulfillments
write_fulfillments
read_merchant_managed_fulfillment_orders
write_merchant_managed_fulfillment_orders
````

`SHOPIFY_REQUIRED_SCOPES` is the single code-level source used by:

* OAuth reconnect;
* App Store installation;
* Shopify API client initialization.

`SHOPIFY_REQUIRED_SCOPE_STRING` is used for OAuth authorization URLs.

The `[access_scopes]` value in `shopify.app.toml` must represent the same
required capability contract.

Do not introduce a new independently maintained OAuth scope array.

---

## Requested scopes versus granted scopes

There are three distinct concepts and they must not be conflated.

### 1. Required contract

What LaSyncro requires to operate.

Source:

```text
SHOPIFY_REQUIRED_SCOPES
shopify.app.toml [access_scopes]
```

### 2. OAuth token-response scope

What Shopify returns during the authorization-code token exchange.

The token response may use a compact representation. In the verified
development-store OAuth cycle, Shopify returned seven explicit grants because
write capabilities represented their corresponding read capabilities.

### 3. Effective runtime grants

What Shopify exposes through:

```graphql
currentAppInstallation {
  accessScopes {
    handle
  }
}
```

This is the effective capability set available to the current installation.

The 2026-08-13 runtime proof returned all ten required capabilities.

---

## Persistence contract

`shopify_app_installations.scopes` stores the canonical effective grant set,
not a hard-coded requested list and not the raw compact token-response string.

OAuth persistence therefore follows:

```text
Shopify token response
        ↓
normalize explicit grants
        ↓
expand implied read capabilities
        ↓
validate all required capabilities
        ↓
sort canonical effective scopes
        ↓
persist shopify_app_installations.scopes
```

The following write grants expand to their effective read capabilities before
validation and persistence:

```text
write_inventory
  -> read_inventory

write_fulfillments
  -> read_fulfillments

write_merchant_managed_fulfillment_orders
  -> read_merchant_managed_fulfillment_orders
```

A missing required capability fails closed with:

```text
SHOPIFY_REQUIRED_SCOPES_MISSING:<scope,...>
```

A missing/empty Shopify token-response scope fails with:

```text
SHOPIFY_GRANTED_SCOPES_MISSING
```

Do not silently persist a partial required grant set.

---

## `read_locations` requirement

`read_locations` is a core LaSyncro capability.

It is required so warehouse/location configuration can resolve Shopify
Location identities into merchant-facing location names.

Without it, Location IDs may be discoverable through inventory-related
operations while Location metadata required for a usable warehouse mapping
workflow remains unavailable.

This scope is therefore required, not optional.

---

## Runtime verification — 2026-08-13

Development store:

```text
development-store-15820042357.myshopify.com
```

Shopify CLI development preview auto-granted all ten required scopes,
including:

```text
read_locations
write_inventory
```

A real OAuth reconnect was then completed through:

```text
GET /api/v1/integrations/oauth/initiate
GET /api/v1/integrations/oauth/callback/shopify
```

Final database proof:

```text
shopify_app_installations persisted_scope_count = 10
has_read_locations = true
has_write_inventory = true

integrations.platform = shopify
integrations.sync_status = COMPLETED

remaining_oauth_state_count = 0
```

Final Shopify runtime proof:

```text
SHOPIFY_HTTP=200
PERSISTED_SCOPE_COUNT=10
RUNTIME_SCOPE_COUNT=10
PERSISTED_EQUALS_RUNTIME=yes
RUNTIME_HAS_READ_LOCATIONS=yes
RUNTIME_HAS_WRITE_INVENTORY=yes
LOCATION_NAME_ACCESS=yes
```

The runtime Location query returned merchant-facing names:

```text
gid://shopify/Location/110070792562
My Custom Location

gid://shopify/Location/110070759794
Shop location
```

This proves that the `read_locations` capability required by the future
warehouse-to-Shopify-location mapping flow is available.

> Scope of this proof: a Shopify CLI **development preview** plus an
> authenticated **reconnect** OAuth cycle against
> `development-store-15820042357.myshopify.com`. It did **not** update the
> **active Shopify app version** used for a genuine fresh merchant / App Store
> install. See "Active app-version deployment — 2026-08-28" below.

---

## Development-store verification safety

For local development verification:

```text
shopify app info
```

must be checked before applying Shopify CLI configuration.

The verified target was:

```text
App:       LaSyncro
Dev store: development-store-15820042357.myshopify.com
```

The development-store scope update was applied using:

```text
shopify app dev
```

Do not substitute:

```text
shopify app deploy
```

during an isolated local/dev-store proof. Production configuration deployment
is a separate explicit operation.

A Shopify CLI development preview does not itself create the local
`shopify_app_installations` or `integrations` records. Local connection state
must still be established through the legitimate LaSyncro OAuth flow.

---

## Active app-version deployment — 2026-08-28 (SHOPIFY-SCOPE-ACTIVE-VERSION-04)

### Dev preview is not the active app-version configuration

`shopify app dev` (previous section) applies a scope set to a local development
preview against one named dev store. It does **not** change the **active Shopify
app version** — the configuration Shopify uses for a genuine fresh merchant /
App Store install. The 2026-08-13 proof was a development-preview grant plus an
authenticated **reconnect** OAuth cycle; it did not, and was not intended to,
update the active app-version config.

### 2026-08-28 provider failure that exposed the stale active version

A real fresh-provider OAuth against a brand-new empty dev store
(`new-dev-dash-for-lasyncro.myshopify.com`) reached Shopify consent and real
token exchange, then **failed closed in the callback** with:

```text
SHOPIFY_REQUIRED_SCOPES_MISSING:read_locations
```

The then-active app version `lasyncro-16`
(`gid://shopify/Version/1063297220609`, created/released 2026-07-24) carried only
9 required scopes and omitted `read_locations`. Every other deployable setting
already matched the canonical config: `application_url`, `embedded=false`,
`use_legacy_install_flow=false`, both OAuth redirect URLs, webhooks API version
`2026-04`, the three privacy compliance topics
(`customers/data_request`, `customers/redact`, `shop/redact`), no extensions.

The failed callback correctly left **no partial provider state**:

```text
integrations rows                = 0
shopify_app_installations rows   = 0
integration/sync_requested events = 0
```

Root cause was the stale **active app-version configuration** — not
`normalizeAndValidateShopifyGrantedScopes`, and not an invalid Shopify scope.

### Correction — deploy canonical scopes to a new active version

`shopify.app.toml` remained the canonical source and was **not** changed. The
fix was an inspect-before-release deployment of the existing canonical config:

1. Create an **unreleased** version from `shopify.app.toml` at main
   `1e36879a00894818faf74218bcdb12e58a5acd61`:
   - version tag: `scope-read-locations-1e36879a`
   - version ID: `gid://shopify/Version/1106942001153`
   - message: `SHOPIFY-SCOPE-ACTIVE-VERSION-04: add read_locations to canonical OAuth scopes (main 1e36879a)`
2. Pre-release Dev Dashboard inspection of that version confirmed: `read_locations`
   present; all 10 required scopes present; redirect URLs unchanged;
   `embedded=false`; `use_legacy_install_flow=false`; webhooks `2026-04`; privacy
   subscriptions unchanged; no extensions.
3. Release the exact verified version.

Post-release:

```text
scope-read-locations-1e36879a = active
lasyncro-16                   = inactive
```

`shopify app deploy` / `shopify app release` changed Shopify configuration only —
no web / Fly deployment occurred. Repository invariants held: branch `main`,
`HEAD = 1e36879a00894818faf74218bcdb12e58a5acd61`, `shopify.app.toml` clean,
tracked/untracked worktree snapshot unchanged.

### Verified invariant after deployment

The **active** Shopify app configuration now contains all 10 canonical required
scopes, including `read_locations`.

### Not weakened

`normalizeAndValidateShopifyGrantedScopes` was **not** modified. `read_locations`
remains a REQUIRED capability; a fresh install whose grant set omits it still
fails closed with `SHOPIFY_REQUIRED_SCOPES_MISSING:read_locations`.

### Not yet certified

A successful real fresh-provider OAuth has **not** been demonstrated on the new
active version. The next certification step is **SHOP-REVIEW-OAUTH-PROVIDER-SMOKE-03**,
run from P0 against a **brand-new empty dev store** — not
`new-dev-dash-for-lasyncro.myshopify.com` and not any previously used store.
Until that passes, fresh-provider OAuth is not proven and
SHOP-REVIEW-OAUTH-PROVIDER-SMOKE-03 is not closed.

---

## Verification invariant

After every real OAuth install/reconnect, the following invariant should hold:

```text
required capabilities
    ⊆ persisted effective scopes
    = Shopify effective runtime scopes
```

For the current required contract:

```text
persisted scope count = 10
runtime scope count   = 10
persisted == runtime
```

If persisted and runtime scopes differ, do not treat
`shopify_app_installations.scopes` as authoritative until the discrepancy is
explained.

---

## Location mapping dependency

This work originally removed the permission and OAuth-state blockers for:

```text
SHOPIFY-LOCATION-MAP-01
```

**Status update 2026-08-21 — INV-SHOPIFY-LOCATION-10 implemented.**

The approved location-mapping contract is now live:

```text
one laSyncro warehouse
    ↔
at most one Shopify Location per Shopify integration
```

The mapping is persisted on `warehouses.external_location_id`. Internal
warehouse locations resolve their Shopify Location through `warehouse_id`,
rather than carrying duplicated per-bin mappings.

The merchant explicitly selects the mapping in Settings → Warehouse. No
Shopify Location is silently auto-mapped when multiple candidates exist.

The backend validates the selected Shopify Location against the connected
shop before persistence, and the database prevents the same non-null Shopify
Location from being assigned to multiple warehouses in the same shop.

---

## Files owning the contract

```text
shopify.app.toml

apps/backend/src/services/shopify/shopifyScopes.ts

apps/backend/src/api/integrations/integration.controller.ts

apps/backend/src/services/shopify/shopifyClient.service.ts
```

Any future scope addition/removal must audit all four surfaces and complete a
real OAuth runtime proof before being considered closed.
