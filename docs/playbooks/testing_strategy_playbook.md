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

### Provider-free isolated integration runs (verified precedent: GH-1255, 2026-10-14)

`npm run test:integration` isolates the **database**. It does not, by itself,
isolate **credentials** or **network egress**. `scripts/with-test-db.js` loads
`<repo root>/.env` via `dotenv`. In a developer checkout that file can hold real
provider credentials, and any call that escapes a mock can reach the internet.

Standing rules (they apply whether or not a brief asks for them; they match
`engineering_workflow.md` §20.2.1 and `agent_operation_guidelines.md`
"INTEGRATION CREDENTIAL AND EGRESS ISOLATION"):

- **Every automated DB/API integration test run must not inherit real provider
  credentials.**
- **A provider-capable run** (any code path that can reach Stripe, Shopify,
  email, push or another external service) additionally requires all of the
  following, proven in the same isolated environment:
  - synthetic provider values only;
  - outbound-network denial proven effective by refused canaries;
  - successful local disposable-DB access.
- **`env -i` alone is not sufficient.** `dotenv` fills every variable the
  environment does not already set. A clean `env -i` environment therefore
  *receives* the root `.env` values if `scripts/with-test-db.js` can find that
  file. Removing variables from the shell does not stop the harness from
  loading them; the file itself must be absent (step 1).
- **Plain `npm run test:integration` is not currently certified as isolated**
  when run from a checkout that contains a root `.env` with real provider
  credentials. Fail-closed enforcement in the harness itself is tracked as
  **GH-1204** ("Integration tests can invoke external providers when local
  secrets are loaded"). Until that lands, compliance comes from the procedure
  below.
- **Explicitly authorised real-provider E2E stays a separate, controlled
  workflow** (§9; `PROVIDER_E2E` in `engineering_workflow.md`). It is never an
  integration run that carries real credentials.
- **A failed isolation preflight means STOP.** No tests run.

The verified procedure (GH-1255):

1. **No repository `.env`.** Run from a worktree that has no `.env`. The runner
   checks the file is absent before it starts. Do not source the root `.env`
   into the shell either.
2. **Fresh, allowlisted environment.** Start the runner with `env -i` and pass
   only an explicit allowlist: `PATH`, `HOME`, `TMPDIR`, the runner's own
   variables, `NODE_ENV`, the `PG*` and `PGMIGRATION_*` connection variables, the
   JWT/encryption secrets, and the provider variable *names* the app reads. The
   preflight fails if any variable outside the allowlist is present.
3. **Synthetic provider credentials.** Every provider-like variable
   (Stripe/Shopify/…) holds a `synthetic-` value. The non-secret
   `SHOPIFY_API_VERSION` is the only exception. The preflight compares SHA-256
   hashes of every variable value with hashes of the root `.env` provider
   values, so the values themselves are never printed, and requires zero
   matches.
4. **Enforced outbound-network denial.** Egress is denied by the operating
   system, not by test code, with loopback PostgreSQL still allowed. The
   GH-1255 runs used a macOS `sandbox-exec` profile:
   `(deny network-outbound)`, allowing only `localhost:*` and Unix sockets,
   with `mDNSResponder` denied. That mechanism is **macOS-specific**. Other
   platforms need an equivalent enforced denial (for example a network
   namespace or a container without egress), proven by the same canaries.
   **Darwin 25 correction (GH-1254, 2026-10-15):** denying the
   `com.apple.mDNSResponder` / `com.apple.dnssd.service` mach names is not
   enough. System DNS still resolved public names through the
   `/var/run/mDNSResponder` Unix socket, which a blanket `(remote unix-socket)`
   allow permits. The profile must also deny that socket explicitly:
   `(deny network-outbound (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))`
   and the same for `/var/run/mDNSResponder`. The DNS canary caught this: the
   first S4-B preflight stopped with `CANARY_DNS_SYSTEM=ALLOWED` before any test ran.
5. **Canaries before any test runs.** Every external canary must be refused:
   HTTPS fetch by hostname, raw TCP to a public IP (`1.1.1.1:443`), `curl`
   HTTPS, and DNS resolution. Loopback PostgreSQL must be reachable as the
   runtime role (non-superuser, no `BYPASSRLS`) and as the migration role. The
   runner stops before Jest if any check fails.
6. **Disposable lifecycle and cleanup proof.** Only then run
   `scripts/with-test-db.js` with the exact suite selection. Capture
   `TEST_DB_CREATED → TEST_DB_MIGRATED → TEST_DB_RUNTIME_OK → TEST_DB_DROPPED`
   for every generated DB. Afterwards prove zero `synchroflow_test_*` orphans
   and that the normal `PGDATABASE` still exists.

Status: the GH-1255 runner lived in an agent scratchpad. It is **not** a
repository script and **not** a CI gate. CI isolation is defined by the
workflows themselves.

Isolation findings recorded during GH-1255:

- **Order-dependent suite (E01-M17a).**
  `opening-inventory-cutover-execution-persistence.migration.test.ts`
  E01-M17a asserts **global** (cross-tenant) zero Slice-E row counts before
  calling `0203.down()`. In the shared per-run disposable DB its outcome
  depends on which suites ran first. It failed in one 40-suite run and passed
  in another with a different order. It is classified as a test-isolation
  defect and is still unresolved.
- **Avoid global-count assertions.** A real-DB suite must not assert global or
  cross-tenant row counts, or migration-down preconditions, that other suites
  in the same run can change. Scope assertions to fixture IDs instead.
- **Sequences are shared, non-transactional state.**
  - Suites must assert identity format and uniqueness, never absolute
    sequence values.
  - Values consumed by other suites, or by rollbacks, are expected gaps.
  - A test that calls `setval` must restore the value in `finally`, as the
    GH-1255 exhaustion test does.
- **Known red baseline at the time.** On 2026-10-14 six opening-inventory
  and Shopify cutover tests failed identically on the untouched baseline
  (`2f8b7cf8`) and on the GH-1255 branch: GH1179-A3,
  CONTRACT-1164-START-05/06, and three `shopify-opening-inventory-cutover`
  executor tests. They are pre-existing and are not GH-1255 regressions.

Isolation findings recorded during GH-1254 S4-B (2026-10-15):

- **Order-dependent suite (GH-1241 S3-B M1 ↔ GH-1254 S4-B).** S3-B M1 now rolls
  back `0213` before `0210` (migration dependency). `0213.down()` refuses while
  held evidence exists. If the S4-B suite runs before S3-B in the **same**
  disposable DB, for example a full `npm run test:integration`, S3-B M1 fails
  closed. Classification: a documented test-harness limitation of the E01-M17a
  class, not a product defect and not a release blocker. The production and
  knex rollback order is unaffected. Targeted runs in separate disposable DBs
  are green: S3-B 18/18 and S4-B 17/17. Unresolved.
- **Savepoint attempts must stay independent.** In DB-invariant tests that run
  several attempts inside one rolled-back transaction, roll back each attempt's
  savepoint even when it succeeds. Otherwise a successful control row leaks into
  later attempts and turns the expected FK/CHECK violation into a unique-index
  violation (S4-B I2).
- **The verified S4-B runner** is scratchpad-only, like GH-1255's, and is not a
  repository script or CI gate. It ran a fresh synthetic PostgreSQL 17 cluster
  inside the same `sandbox-exec` boundary as the canaries, harness and Jest,
  with loopback TCP only and no repository `.env`.

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
- forbidden architectural dependencies remain forbidden;
- production frontend bundles compile with production `NODE_ENV` semantics
  (`tests/contract/frontend-production-build-env.test.ts`; see
  `docs/playbooks/production_deploy_gotchas.md`).

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
