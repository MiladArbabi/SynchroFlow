# Testing Strategy & Infrastructure Playbook

**Established:** 2026-08-26
**Scope:** Automated testing across SynchroFlow / laSyncro
**Status:** Canonical testing contract

---

## 1. Purpose

Automated tests exist to protect consequential product behavior.

A test should answer:

> **What behavior or invariant would materially hurt the merchant, product,
> security boundary, or operational workflow if it regressed?**

Tests should primarily protect:

- business rules and commercial invariants;
- state transitions;
- persistence and atomicity;
- inventory correctness;
- authorization and tenant isolation;
- idempotency and retry behavior;
- migrations and schema invariants;
- provider and integration contracts;
- critical user journeys.

Tests should generally **not** exist merely to freeze:

- incidental copy;
- exact headings or paragraph wording;
- arbitrary DOM structure;
- card or wrapper shape;
- presentation details that may legitimately change.

Exact text or structure is appropriate only where it is itself contractual,
such as accessibility labels, security/error contracts, legal or commercial
disclosures, API contracts, or a critical interaction boundary.

---

## 2. Default Test Commands

### Safe foundation gate

```sh
npm test
```

Equivalent to:

```sh
npm run test:foundation
```

and currently runs:

```text
test:config
→ test:db-safety
→ test:contract
```

This path is DB-free.

It must never:

- reset the development database;
- migrate the development database;
- seed the development database;
- execute legacy DB-backed Jest suites implicitly.

`npm run test:fast` currently points to the same safe foundation.

---

## 3. Backend Integration Tests

```sh
npm run test:integration
```

Backend integration tests run through:

```text
scripts/with-test-db.js
```

Lifecycle:

```text
generate synchroflow_test_*
→ fail-closed safety validation
→ create DB with migration role
→ run all migrations
→ verify runtime access as sf_app
→ hand the child PGDATABASE=<generated> + SYNCHROFLOW_DISPOSABLE_TEST_DB=1
→ execute backend-integration Jest project serially
→ close connections
→ drop disposable DB
→ prove DB is gone
```

### Database safety invariants

The integration harness must never operate destructively unless:

- `NODE_ENV=test`;
- the generated DB matches `^synchroflow_test_[A-Za-z0-9_]+$`;
- the test DB differs from normal `PGDATABASE`;
- runtime and migration roles are both present;
- runtime and migration roles are different.

Administration and migrations use the privileged migration role.

Application/runtime verification uses the restricted runtime role (`sf_app`).

Integration databases start from **migrations only**. There is no implicit
`full_identity` seed requirement.

Legacy DB-backed tests remain serial until their fixture isolation is strong
enough for safe parallel execution.

### Disposable-DB isolation enforcement (TEST-DB-ISOLATION-11)

`scripts/with-test-db.js` sets `SYNCHROFLOW_DISPOSABLE_TEST_DB=1` in the child
environment alongside the generated `PGDATABASE`. That marker is the positive
signal that a disposable `synchroflow_test_*` database is in play.

Shared pure predicate:

```text
packages/backend-core/src/config/test-database-safety.ts
disposable-name contract: ^synchroflow_test_[A-Za-z0-9_]+$
```

Under `NODE_ENV=test`, before any knex pool is constructed:

- an explicit, non-empty, non-disposable `PGDATABASE` is rejected;
- with `SYNCHROFLOW_DISPOSABLE_TEST_DB=1`, a missing or unsafe `PGDATABASE` is
  rejected (the disposable DB was lost — fail closed);
- without the harness marker, the historical `backend-legacy` `.env` fallback
  remains temporarily supported.

Both the normal backend-core DB construction (`config/database.config.ts`) and
the privileged `systemDb` (`system-db.ts`) run this check.

The `backend-integration` Jest project additionally has two independent
fail-closed guards over the same disposable-name contract:

- `tests/setup/backend-integration.global-setup.js` — orchestration context;
- `tests/setup/backend-integration.runtime-db-guard.js` (`setupFiles`) — the
  test-runtime context that actually constructs the pools.

Verified behavior:

- a runtime canary proved that during `backend-integration` execution **both**
  the normal DB client and `systemDb` resolve to the exact generated
  `synchroflow_test_*` database;
- direct, unsafe `backend-integration` Jest execution pointed at `synchroflow_db`
  is rejected before any test file runs;
- formal no-leak acceptance: selected real-DB integration suites ran against a
  generated disposable DB, that DB was dropped afterward, zero orphan
  `synchroflow_test_*` databases remained, `synchroflow_db` stayed present, and
  every tracked `synchroflow_db` contamination marker was unchanged (Δ0).

Scope boundary: historical `backend-legacy` tests that still rely on the old
shared-DB `.env` fallback are **not** migrated by this issue; that cleanup is
tracked separately as **TEST-INFRA-FOUNDATION-12**. This guarantee covers the
`backend-integration` disposable harness and the explicit test-mode unsafe-DB
targeting described above — not yet every backend test.

### Contract-test host portability (TEST-CI-DOTENV-161)

The `contract` project runs in CI with no `.env` on disk (root `.env` is
git-ignored). `backend-core-test-db-failclosed.test.ts` DB-D / DB-E
intentionally exercise the legacy `.env`-fallback branch of `database.config`
(`NODE_ENV` set, no disposable harness, `PGDATABASE` not inherited); they had
been resolving `synchroflow_db` only because the developer root `.env` happened
to be present, so they failed in CI.

Invariant: a DB-free contract test that must exercise the dotenv fallback
supplies its own isolated deterministic fixture — an ephemeral temp dir nested
inside the repo (so workspace resolution still reaches `<repo>/node_modules`)
holding a throwaway `.env` with only the non-secret value under test, used as the
spawned child's `cwd` and removed in a `finally`. Contract tests must never
depend on a host or developer environment file.

The transitional `backend-legacy` `.env` fallback in `database.config` /
`system-db` is unchanged; its removal is still tracked as
**TEST-INFRA-FOUNDATION-12**. Verified: `npx jest tests/contract --runInBand`
(the CI contract command) passes 8 suites / 66 tests.

### OAuth callback regression (SHOP-REVIEW-OAUTH-REGRESSION-162)

`tests/integration/oauth-callback-provider-mocked.test.ts` is the first
automated regression that drives the CURRENT stateless DB-backed
`GET /api/v1/integrations/oauth/callback/shopify` through the real
route/controller against a disposable `synchroflow_test_*` database, with the
Shopify token exchange and identity lookup mocked at the `axios` boundary (no
provider HTTP). It protects the **S3 → S1** transition — a reviewer-fresh tenant
whose warehouse is **one root location with zero bins** — asserting that both the
`integrations` and `shopify_app_installations` rows are persisted, that the OAuth
state is consumed, and that exactly one `integration/sync_requested` domain event
with its owned outbox row is emitted; the token-exchange-failure path, the
missing-access-token path (502 with **no** Admin GraphQL call — Slice 162C), and
the incomplete-grant path (**403** `{"error":"Shopify did not grant all required
permissions"}` + an `oauth_scopes_insufficient` SECURITY audit — Slice 162C) —
each fail-closed with no partial provider state; provider-error log redaction (no
`client_secret` / OAuth code / Admin token); unknown and replayed state (403);
and the **S6** callback-level reinstall merge (`uninstalled_at` cleared, scopes
refreshed, no tenant/warehouse duplication). It does **not** replace the
real-provider OAuth proof (SHOP-REVIEW-OAUTH-PROVIDER-SMOKE-03).

---

## 4. Jest Project Ownership

Every Jest `.test.ts` / `.test.tsx` file must belong to exactly one configured
Jest project.

Permanent invariant:

```text
0 project owners  → configuration failure
2+ project owners → configuration failure
```

Validate with:

```sh
npm run test:config
```

Current project roles:

- `backend-legacy` — transitional ownership for historical backend tests that
  have not yet been classified as genuinely pure vs DB-backed;
- `backend-integration` — explicit real-DB / real-route integration tests;
- `contract` — architecture and invariant contracts;
- `frontend` — historical frontend/JSDOM suite.

`backend-legacy` is transitional and is not the desired permanent definition
of a unit-test layer.

---

## 5. Frontend Tests

```sh
npm run test:frontend
```

The historical frontend suite is currently **diagnostic/non-gating**.

It contains substantial legacy coverage whose value varies, including tests
that assert obsolete product surfaces, copy, presentation shape, or historical
behavior.

Do not repair a red legacy frontend test merely because it is red.

Before repairing it, determine:

1. What invariant does it protect?
2. Is that invariant still part of the product?
3. Would breaking it materially affect the merchant or system?

Then:

```text
meaningful current invariant → modernize the test
obsolete/incidental contract → remove the test
```

New frontend tests should focus on critical interaction behavior rather than
copy or layout stability.

---

## 6. Deprecated and Paused Product Coverage

Deprecated product surfaces should not be kept alive by Jest compatibility
work solely to make historical tests green.

Paused product surfaces may retain tests for future reactivation, but those
tests should not become an active release gate while the product surface itself
is paused.

When old coverage is touched:

```text
still consequential → modernize
obsolete            → delete
paused              → preserve intentionally, non-gating
```

---

## 7. Contract Tests

```sh
npm run test:contract
```

Contract tests protect architecture and invariant boundaries.

Examples:

- every Jest test has exactly one owner;
- destructive test-DB operations fail closed;
- canonical authority remains in the intended layer;
- forbidden architectural dependencies remain forbidden.

Contract tests should be deterministic and normally DB-free.

---

## 8. Test Database Safety Contracts

```sh
npm run test:db-safety
```

`scripts/test-db-safety.js` is the pure safety boundary.

It performs no SQL, shell execution, filesystem deletion, or environment
mutation.

It validates destructive-operation eligibility before any disposable DB
lifecycle command is allowed to proceed.

Do not duplicate these safety rules inside other scripts. Reuse the canonical
module.

---

## 9. External Providers

Normal automated tests must not make real calls to:

- Stripe;
- Shopify;
- email providers;
- push providers;
- other external side-effecting services.

Provider acceptance/E2E must be an explicit, separately authorized path.

Mocking should preserve the actual boundary being tested rather than mock away
the business behavior itself.

---

## 10. Temporary `--forceExit` Debt

`test:integration` currently uses Jest `--forceExit` as a **temporary
compatibility measure**.

This is not the desired lifecycle model.

A reproduced asynchronous email path can remain active after test teardown and
keep Jest alive. That open-handle defect must be addressed separately.

The target state is:

```text
tests complete
→ owned resources close
→ Jest exits naturally
```

Do not remove `--forceExit` until natural termination has been proven.

Do not treat its presence as evidence that the underlying resource lifecycle is
healthy.

---

## 11. Playwright E2E

```sh
npm run test:e2e
```

Playwright is explicit and separate from the default foundation gate.

Use E2E for critical journeys or boundaries that cannot be adequately proven
at a lower-cost test layer.

Prefer API-level proof when UI rendering is not the behavior under test.

Do not use E2E to freeze cosmetic copy or layout.

The current Playwright path is not yet backed by the disposable Jest
integration DB harness; its environment must be prepared deliberately.

---

## 12. Test Strategy Per Issue

Every engineering issue must explicitly decide its test strategy.

Possible layers include:

- unit;
- API integration;
- DB invariant;
- migration;
- worker/outbox;
- concurrency;
- contract/static;
- Playwright;
- provider E2E;
- live browser verification.

Automated tests are not mandatory for every trivial change.

But consequential defects — especially billing, fulfillment, inventory, auth,
tenant isolation, migrations, Shopify boundaries, entitlements, and durable
outbox behavior — should normally leave permanent regression protection.

When practical:

```text
confirmed defect
→ write failing regression contract
→ prove RED
→ implement fix
→ run same contract
→ prove GREEN
→ run neighboring regression suites
```

Never weaken an assertion merely to make a red test green.

---

## 13. Test Value Rules

### TEST-VALUE-01

Automated tests must protect consequential product behavior, business
invariants, security/tenant boundaries, persistence, state transitions,
integrations, or critical user journeys.

Tests whose primary purpose is asserting incidental copy, presentation
structure, or easily-changing UI shape should not be added unless that exact
presentation is itself contractual.

### TEST-VALUE-02

A red legacy test is not automatically a product defect.

Before repairing it:

- identify the invariant it protects;
- verify that invariant is still relevant;
- delete or replace the test if it protects obsolete behavior.

---

## 14. Current Command Classification

### Safe DB-free

```text
npm test
npm run test:foundation
npm run test:fast
npm run test:config
npm run test:contract
npm run test:db-safety
```

### Safe disposable-DB

```text
npm run test:db-lifecycle
npm run test:integration
```

### Discovery only

```text
npm run test:backend:legacy:list
npm run test:integration:list
```

### Legacy / diagnostic

```text
npm run test:frontend
```

### Explicit E2E

```text
npm run test:e2e
npm run test:e2e:ui
```

---

## 15. Standing Safety Rule

The normal development database is never an automated integration-test
scratchpad.

If a new automated DB test needs real PostgreSQL behavior, route it through the
disposable `synchroflow_test_*` infrastructure rather than resetting
`PGDATABASE`.

This rule takes precedence over historical test patterns.

As of **TEST-DB-ISOLATION-11** this is enforced for the `backend-integration`
project, not merely conventional: under `NODE_ENV=test` the backend-core DB
config, `systemDb`, and two `backend-integration` boundary guards fail closed
unless `PGDATABASE` matches `^synchroflow_test_[A-Za-z0-9_]+$`. The
`backend-legacy` `.env` fallback stays permitted until
**TEST-INFRA-FOUNDATION-12**. See §3 "Disposable-DB isolation enforcement".
